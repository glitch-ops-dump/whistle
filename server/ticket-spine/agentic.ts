import { createHash } from "node:crypto";
import type { AdminConfigSnapshot } from "../config/types.js";
import { ministryForTicket } from "./dashboard.js";
import { internalId } from "./lifecycle.js";
import type {
  AgentDuplicateCandidate,
  AgentRecommendationRun,
  CategoryId,
  IntakeAgentRecommendation,
  TicketRecord,
} from "./types.js";

const PROMPT_VERSION = "intake-verification-v2.0";
const MODEL_VERSION = "deterministic-prototype-rules";

// Feature-flag gate for the recommend-only intake agent. Defaults to enabled because the
// deterministic baseline already ships in MVP1; Admin can disable it as a kill switch, and
// the future model-backed path will respect the same flag.
export function isIntakeAgentEnabled(config: AdminConfigSnapshot) {
  return config.appControls.find((control) => control.id === "feature-agent-intake")?.value !== false;
}

const categorySignals: Array<{ category: CategoryId; words: string[] }> = [
  { category: "corruption", words: ["bribe", "cash", "commission", "unofficial", "corrupt", "kickback", "demand"] },
  { category: "roads", words: ["road", "pothole", "street", "footpath", "drain cover", "traffic"] },
  { category: "water", words: ["water", "leak", "drinking", "tanker", "sewage", "pipeline"] },
  { category: "power", words: ["power", "electric", "street light", "tangedco", "transformer"] },
  { category: "sanitation", words: ["garbage", "waste", "drain", "sewer", "sanitation"] },
  { category: "safety", words: ["unsafe", "crime", "police", "danger", "public safety"] },
  { category: "health", words: ["hospital", "clinic", "medicine", "health", "doctor"] },
  { category: "education", words: ["school", "teacher", "student", "classroom", "education"] },
  { category: "revenue", words: ["certificate", "land record", "patta", "taluk", "revenue"] },
  { category: "ration", words: ["ration", "pds", "fair price", "rice", "card"] },
];

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function combinedText(ticket: TicketRecord) {
  return [ticket.title, ticket.description, ticket.departmentHint, ticket.reference, ticket.location.area, ticket.location.landmark].filter(Boolean).join(" ").toLowerCase();
}

function suggestedCategory(ticket: TicketRecord): CategoryId {
  const text = combinedText(ticket);
  const scored = categorySignals
    .map((signal) => ({
      category: signal.category,
      score: signal.words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].category : ticket.category;
}

function locationMissing(ticket: TicketRecord) {
  const missing: string[] = [];
  if (!ticket.location.district) missing.push("district");
  if (!ticket.location.area) missing.push("area");
  if (!ticket.location.address && !ticket.location.landmark && (!ticket.location.latitude || !ticket.location.longitude)) missing.push("address or landmark");
  return missing;
}

function protectedReasons(ticket: TicketRecord) {
  const text = combinedText(ticket);
  const reasons: string[] = [];
  if (ticket.protected) reasons.push("Ticket is already in protected intake.");
  if (ticket.category === "corruption") reasons.push("Category is corruption.");
  if (["bribe", "unofficial payment", "cash demand", "retaliation", "threat"].some((word) => text.includes(word))) {
    reasons.push("Complaint text contains corruption or retaliation-risk signals.");
  }
  return reasons;
}

function duplicateCandidates(ticket: TicketRecord, tickets: TicketRecord[]): AgentDuplicateCandidate[] {
  const titleWords = new Set(normalize(ticket.title).split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  return tickets
    .filter((candidate) => candidate.id !== ticket.id)
    .map((candidate) => {
      const sameDistrict = normalize(candidate.location.district) === normalize(ticket.location.district);
      const sameArea = normalize(candidate.location.area) === normalize(ticket.location.area);
      const sameCategory = candidate.category === ticket.category;
      const overlap = normalize(candidate.title)
        .split(/[^a-z0-9]+/)
        .filter((word) => titleWords.has(word)).length;
      const score = Number(sameDistrict) + Number(sameArea) + Number(sameCategory) + overlap;
      return { candidate, score, sameArea, sameCategory };
    })
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ candidate, sameArea, sameCategory }) => ({
      ticketId: candidate.id,
      district: candidate.location.district,
      category: candidate.category,
      similarityReason: [sameCategory ? "same category" : null, sameArea ? "same area" : "same district", "similar complaint wording"].filter(Boolean).join(", "),
    }));
}

function localOwner(ticket: TicketRecord) {
  const scopeValue = ticket.location.area || ticket.location.district || "local-scope";
  const slug = normalize(scopeValue).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "local-owner";
  return {
    ownerKey: `local:${slug}`,
    ownerLabel: `${scopeValue} Local/MLA Owner`,
    scopeValue,
  };
}

function inputHash(ticket: TicketRecord) {
  const payload = {
    id: ticket.id,
    category: ticket.category,
    title: ticket.title,
    description: ticket.description,
    location: ticket.location,
    evidenceCount: ticket.evidence.length,
    updatedAt: ticket.updatedAt,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function recommendationFor(ticket: TicketRecord, allTickets: TicketRecord[]): IntakeAgentRecommendation {
  const missing = locationMissing(ticket);
  const protectedSignalReasons = protectedReasons(ticket);
  const suggested = suggestedCategory(ticket);
  const duplicates = duplicateCandidates(ticket, allTickets);
  const needsEvidence = ticket.evidence.length === 0 && !ticket.protected;
  const missingFields = [...missing, ...(needsEvidence ? ["supporting photo or reference"] : [])];
  const suggestedDepartment = ministryForTicket({ ...ticket, category: suggested });

  let primaryAction: IntakeAgentRecommendation["primaryAction"] = "route_local";
  if (protectedSignalReasons.length) primaryAction = "route_protected";
  else if (missingFields.length) primaryAction = "request_info";
  else if (ticket.description.trim().length < 24) primaryAction = "reject_candidate";

  const routeOwner = primaryAction === "route_local" ? localOwner(ticket) : null;
  const confidenceBase = 0.58 + (ticket.description.length > 80 ? 0.12 : 0) + (ticket.location.district ? 0.08 : 0) + (ticket.evidence.length ? 0.08 : 0);
  const confidence = Math.min(0.94, Math.max(0.42, Number(confidenceBase.toFixed(2))));

  const reasons = [
    `Suggested category: ${suggested}.`,
    `Suggested department: ${suggestedDepartment}.`,
    missingFields.length ? `Missing fields: ${missingFields.join(", ")}.` : "Location and evidence are sufficient for human routing review.",
    protectedSignalReasons.length ? `Protected signals: ${protectedSignalReasons.join(" ")}` : "No protected corruption signal beyond configured category policy.",
    duplicates.length ? `${duplicates.length} possible duplicate or cluster candidate(s) found.` : "No strong duplicate candidate found in the current queue.",
  ];

  return {
    primaryAction,
    confidence,
    suggestedCategory: suggested,
    suggestedDepartment,
    recommendedOwner: routeOwner,
    missingFields,
    evidenceAssessment: {
      usefulCount: ticket.evidence.length,
      needsMoreEvidence: needsEvidence,
      note: needsEvidence ? "No evidence is attached; request a photo/reference before local routing unless urgency overrides." : "Evidence metadata is present for human inspection.",
    },
    locationAssessment: {
      confidence: missing.length ? 0.54 : ticket.location.landmark || ticket.location.address ? 0.86 : 0.72,
      missing,
    },
    protectedSignal: {
      flagged: protectedSignalReasons.length > 0,
      reasons: protectedSignalReasons,
    },
    duplicateCandidates: duplicates,
    rejectionGuardrails: [
      "Do not reject only because evidence is missing; request information first when the issue is government-addressable.",
      "Rejected tickets must enter CM-maintained rejection review.",
      "Protected/corruption signals must not be exposed to local or MLA queues before authorized screening.",
    ],
    draftCitizenMessage: missingFields.length
      ? `Please add ${missingFields.join(", ")} so the verification team can route your complaint safely.`
      : `Your complaint has enough information for verification review. The government team will route it to the accountable owner after human approval.`,
    reviewerSummary: `${primaryAction.replace("_", " ")} recommended with ${Math.round(confidence * 100)}% confidence for ${ticket.location.district || "unknown district"}.`,
    reasons,
    nonMutationGuarantee: "This recommendation cannot change ticket status, queue, SLA, notifications, or audit state without a separate human-approved decision.",
  };
}

export function createIntakeAgentRun(ticket: TicketRecord, allTickets: TicketRecord[], actor: string): AgentRecommendationRun {
  return {
    id: internalId("agent"),
    ticketId: ticket.id,
    actor,
    purpose: "intake_verification",
    promptVersion: PROMPT_VERSION,
    modelVersion: MODEL_VERSION,
    inputHash: inputHash(ticket),
    recommendation: recommendationFor(ticket, allTickets),
    createdAt: new Date().toISOString(),
  };
}
