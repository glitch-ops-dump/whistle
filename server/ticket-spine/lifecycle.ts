import { createHash, randomUUID } from "node:crypto";
import { evidencePolicyViolation } from "../evidence/policy.js";
import { currentCorrelationId } from "../observability/correlation.js";
import type {
  AuditEvent,
  ClosureChecklist,
  CreateTicketCommand,
  CitizenUpdateCommand,
  EscalationCommand,
  EvidenceAccessQuery,
  EvidenceAccessResult,
  EvidenceScanAction,
  EvidenceSecurityControls,
  EvidenceUploadCompletionCommand,
  EvidenceUploadCommand,
  EvidenceUploadSession,
  EvidenceMetadata,
  FieldEvidenceCommand,
  FieldExecutionCommand,
  NotificationIntent,
  QueueAssignment,
  RejectionReviewDecisionCommand,
  SlaClock,
  SlaJobAction,
  CitizenDisputeCommand,
  TicketEvent,
  TicketRecord,
  VerificationDecisionCommand,
} from "./types.js";

export const verificationQueue: QueueAssignment = {
  kind: "verification",
  ownerKey: "team:verification",
  ownerLabel: "Ticket Verification Team",
  scope: { jurisdiction: "state", value: "tamil-nadu" },
};

export const protectedQueue: QueueAssignment = {
  kind: "protected_review",
  ownerKey: "team:protected-screening",
  ownerLabel: "Protected Screening",
  scope: { jurisdiction: "protected", value: "corruption" },
};

export const rejectionReviewQueue: QueueAssignment = {
  kind: "rejection_review",
  ownerKey: "team:cm-rejection-review",
  ownerLabel: "CM-maintained Rejection Review",
  scope: { jurisdiction: "state", value: "tamil-nadu" },
};

export const cmCellQueue: QueueAssignment = {
  kind: "cm_cell",
  ownerKey: "team:cm-cell",
  ownerLabel: "CM Cell",
  scope: { jurisdiction: "state", value: "tamil-nadu" },
};

export type TicketMutation = {
  ticket: TicketRecord;
  auditEvents: AuditEvent[];
  notificationIntents?: NotificationIntent[];
};

export type LifecyclePolicy = {
  slaDays: Record<SlaClock["stage"], number>;
  slaEnabled: Record<SlaClock["stage"], boolean>;
  protectedCategoryIds: ReadonlySet<CreateTicketCommand["category"]>;
  corruptionBypassesLocalRouting: boolean;
};

export type EvidenceScanVerdict = {
  status: "clean" | "blocked";
  reason: string;
  checksum?: string;
  metadataStripped: boolean;
};

export const defaultLifecyclePolicy: LifecyclePolicy = {
  slaDays: {
    verification: 2,
    local: 7,
    ministry: 10,
    cm_cell: 7,
    rejection_review: 3,
  },
  slaEnabled: {
    verification: true,
    local: true,
    ministry: true,
    cm_cell: true,
    rejection_review: true,
  },
  protectedCategoryIds: new Set(["corruption"]),
  corruptionBypassesLocalRouting: true,
};

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function addMinutesIso(minutes: number) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function retentionUntilIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function internalId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function evidenceId() {
  return randomUUID();
}

let ticketSequence = 0;

function ticketId() {
  ticketSequence = (ticketSequence + 1) % 1_679_616;
  const year = new Date().getFullYear();
  const timestamp = Date.now().toString(36).toUpperCase();
  const sequence = ticketSequence.toString(36).toUpperCase().padStart(4, "0");
  const entropy = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `WH-${year}-${timestamp}-${sequence}${entropy}`;
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "verified phone";
  return `XXXXXX${digits.slice(-4)}`;
}

function normalisePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export function hashCitizenPhone(phone: string) {
  return createHash("sha256").update(normalisePhone(phone)).digest("hex");
}

function makeEvent(ticketIdValue: string, type: TicketEvent["type"], message: string, visibility: TicketEvent["visibility"], actor = "system"): TicketEvent {
  return {
    id: internalId("evt"),
    ticketId: ticketIdValue,
    type,
    actor,
    message,
    visibility,
    createdAt: nowIso(),
  };
}

function makeAudit(
  ticketIdValue: string | undefined,
  action: string,
  entityType: AuditEvent["entityType"],
  entityId: string,
  sensitive: boolean,
  reason?: string,
  actor = "system",
  actorRole = "mvp-dev",
): AuditEvent {
  return {
    id: internalId("audit"),
    ticketId: ticketIdValue,
    actor,
    actorRole,
    action,
    entityType,
    entityId,
    reason,
    correlationId: currentCorrelationId() ?? internalId("corr"),
    sensitive,
    createdAt: nowIso(),
  };
}

export function protectedAccessAudit(
  ticket: TicketRecord,
  action: string,
  entityType: AuditEvent["entityType"],
  entityId: string,
  actor: string,
  actorRole: string,
  reason: string,
): AuditEvent {
  return makeAudit(ticket.id, action, entityType, entityId, true, reason, actor, actorRole);
}

function notificationTopicForEvent(event: TicketEvent): NotificationIntent["topic"] | null {
  if (event.type === "phone_verified" || event.type === "protected_screening_started" || event.type === "rejection_review_started") return null;
  if (event.type === "audit_note") return event.message.toLowerCase().includes("sla breached") ? "sla_breached" : null;
  if (
    event.type === "ticket_submitted" ||
    event.type === "verification_started" ||
    event.type === "additional_info_requested" ||
    event.type === "citizen_update_submitted" ||
    event.type === "ticket_rejected" ||
    event.type === "rejection_upheld" ||
    event.type === "ticket_routed" ||
    event.type === "ticket_escalated" ||
    event.type === "field_visit_scheduled" ||
    event.type === "field_report_added" ||
    event.type === "ticket_transferred" ||
    event.type === "ticket_resolved" ||
    event.type === "ticket_reopened"
  ) {
    return event.type;
  }
  return null;
}

function safeStageLabel(topic: NotificationIntent["topic"], ticket: TicketRecord) {
  if (ticket.protected) return "secure status update";
  if (topic === "ticket_submitted") return "complaint submitted";
  if (topic === "verification_started") return "verification started";
  if (topic === "additional_info_requested") return "additional information needed";
  if (topic === "citizen_update_submitted") return "citizen update received";
  if (topic === "ticket_rejected") return "rejection review started";
  if (topic === "rejection_upheld") return "rejection review closed";
  if (topic === "ticket_routed") return `routed to ${ticket.primaryQueue.ownerLabel}`;
  if (topic === "ticket_escalated") return `escalated to ${ticket.primaryQueue.ownerLabel}`;
  if (topic === "field_visit_scheduled") return "field visit scheduled";
  if (topic === "field_report_added") return "field report added";
  if (topic === "ticket_transferred") return `transferred to ${ticket.primaryQueue.ownerLabel}`;
  if (topic === "ticket_resolved") return "resolution submitted";
  if (topic === "ticket_reopened") return "reopen/dispute received";
  return "SLA breach update";
}

const notificationCopy: Record<
  TicketRecord["language"],
  Record<NotificationIntent["topic"], { inApp: string; external: string }>
> = {
  en: {
    ticket_submitted: {
      inApp: "Your complaint was submitted and the verification SLA clock has started.",
      external: "Complaint submitted. Verification has started.",
    },
    verification_started: {
      inApp: "The Ticket Verification Team is checking completeness before routing.",
      external: "Verification is in progress.",
    },
    additional_info_requested: {
      inApp: "The verification team needs more information from you before routing.",
      external: "More information is needed. Open Whistle to respond.",
    },
    citizen_update_submitted: {
      inApp: "Your update was received and the ticket returned to verification.",
      external: "Your update was received.",
    },
    ticket_rejected: {
      inApp: "The ticket moved to CM-maintained rejection review.",
      external: "The ticket is under rejection review.",
    },
    rejection_upheld: {
      inApp: "CM-maintained rejection review upheld and closed the rejection with an audit note.",
      external: "Rejection review closed. Open Whistle for the outcome.",
    },
    ticket_routed: {
      inApp: "The ticket was routed to the accountable owner. SLA tracking continues.",
      external: "The ticket was routed to the accountable owner.",
    },
    ticket_escalated: {
      inApp: "The ticket escalated because the previous SLA stage was missed.",
      external: "The ticket escalated to the next accountability level.",
    },
    field_visit_scheduled: {
      inApp: "A field visit was scheduled by the accountable owner.",
      external: "A field visit was scheduled.",
    },
    field_report_added: {
      inApp: "A field report was added to the ticket history.",
      external: "A field report was added.",
    },
    ticket_transferred: {
      inApp: "The ticket was transferred with a recorded reason.",
      external: "The ticket was transferred to another accountable owner.",
    },
    ticket_resolved: {
      inApp: "The government owner marked the issue resolved with a closure note.",
      external: "The issue was marked resolved. Open Whistle to review.",
    },
    ticket_reopened: {
      inApp: "Your reopen/dispute request was received and returned for review.",
      external: "Your reopen/dispute request was received.",
    },
    sla_breached: {
      inApp: "An SLA breach was recorded and the ticket was flagged for urgent review.",
      external: "SLA breached. The ticket is flagged for urgent review.",
    },
  },
  ta: {
    ticket_submitted: {
      inApp: "உங்கள் புகார் பதிவு செய்யப்பட்டது. சரிபார்ப்பு SLA தொடங்கியது.",
      external: "புகார் பதிவு செய்யப்பட்டது. சரிபார்ப்பு தொடங்கியது.",
    },
    verification_started: {
      inApp: "வழிமாற்றத்திற்கு முன் சரிபார்ப்பு குழு விவரங்களை சரிபார்க்கிறது.",
      external: "சரிபார்ப்பு நடைபெறுகிறது.",
    },
    additional_info_requested: {
      inApp: "வழிமாற்றத்திற்கு முன் கூடுதல் தகவல் தேவைப்படுகிறது.",
      external: "கூடுதல் தகவல் தேவை. Whistle-ஐ திறந்து பதிலளிக்கவும்.",
    },
    citizen_update_submitted: {
      inApp: "உங்கள் புதுப்பிப்பு பெறப்பட்டது. புகார் மீண்டும் சரிபார்ப்புக்கு சென்றது.",
      external: "உங்கள் புதுப்பிப்பு பெறப்பட்டது.",
    },
    ticket_rejected: {
      inApp: "புகார் CM பராமரிக்கும் நிராகரிப்பு மதிப்பாய்வுக்கு சென்றது.",
      external: "புகார் நிராகரிப்பு மதிப்பாய்வில் உள்ளது.",
    },
    rejection_upheld: {
      inApp: "CM பராமரிக்கும் நிராகரிப்பு மதிப்பாய்வு நிராகரிப்பை உறுதிசெய்து மூடியது.",
      external: "நிராகரிப்பு மதிப்பாய்வு முடிந்தது. முடிவைக் காண Whistle-ஐ திறக்கவும்.",
    },
    ticket_routed: {
      inApp: "புகார் பொறுப்புள்ள அலுவலரிடம் அனுப்பப்பட்டது. SLA கண்காணிப்பு தொடர்கிறது.",
      external: "புகார் பொறுப்புள்ள அலுவலரிடம் அனுப்பப்பட்டது.",
    },
    ticket_escalated: {
      inApp: "முந்தைய SLA நிலை தவறியதால் புகார் அடுத்த பொறுப்பு நிலைக்கு உயர்த்தப்பட்டது.",
      external: "புகார் அடுத்த பொறுப்பு நிலைக்கு உயர்த்தப்பட்டது.",
    },
    field_visit_scheduled: {
      inApp: "பொறுப்புள்ள அலுவலர் களப் பார்வையை திட்டமிட்டுள்ளார்.",
      external: "களப் பார்வை திட்டமிடப்பட்டது.",
    },
    field_report_added: {
      inApp: "புகார் வரலாற்றில் கள அறிக்கை சேர்க்கப்பட்டது.",
      external: "கள அறிக்கை சேர்க்கப்பட்டது.",
    },
    ticket_transferred: {
      inApp: "பதிவு செய்யப்பட்ட காரணத்துடன் புகார் மற்றொரு பொறுப்பாளருக்கு மாற்றப்பட்டது.",
      external: "புகார் மற்றொரு பொறுப்பாளருக்கு மாற்றப்பட்டது.",
    },
    ticket_resolved: {
      inApp: "அரசு பொறுப்பாளர் தீர்வு குறிப்புடன் பிரச்சினையை தீர்ந்ததாக குறித்துள்ளார்.",
      external: "பிரச்சினை தீர்ந்ததாக குறிக்கப்பட்டது. மதிப்பாய்வுக்கு Whistle-ஐ திறக்கவும்.",
    },
    ticket_reopened: {
      inApp: "உங்கள் மீண்டும் திறப்பு/எதிர்ப்பு கோரிக்கை பெறப்பட்டு மதிப்பாய்வுக்கு அனுப்பப்பட்டது.",
      external: "உங்கள் மீண்டும் திறப்பு/எதிர்ப்பு கோரிக்கை பெறப்பட்டது.",
    },
    sla_breached: {
      inApp: "SLA மீறல் பதிவு செய்யப்பட்டது. அவசர மதிப்பாய்வுக்கு குறிக்கப்பட்டது.",
      external: "SLA மீறப்பட்டது. அவசர மதிப்பாய்வுக்கு குறிக்கப்பட்டது.",
    },
  },
};

function externalPrefix(channel: NotificationIntent["channel"], language: TicketRecord["language"]) {
  if (channel === "whatsapp") return language === "ta" ? "Whistle WhatsApp புதுப்பிப்பு" : "Whistle WhatsApp update";
  if (channel === "sms") return language === "ta" ? "Whistle SMS" : "Whistle SMS";
  return "Whistle";
}

function channelsForNotification(ticket: TicketRecord, topic: NotificationIntent["topic"]): NotificationIntent["channel"][] {
  const channels: NotificationIntent["channel"][] = ["in_app", "sms"];
  const whatsappTopics: NotificationIntent["topic"][] = [
    "ticket_submitted",
    "additional_info_requested",
    "citizen_update_submitted",
    "ticket_rejected",
    "ticket_routed",
    "ticket_escalated",
    "field_visit_scheduled",
    "field_report_added",
    "ticket_transferred",
    "ticket_resolved",
    "ticket_reopened",
    "sla_breached",
  ];
  if (!ticket.protected && whatsappTopics.includes(topic)) channels.push("whatsapp");
  return channels;
}

function safeNotificationMessage(topic: NotificationIntent["topic"], ticket: TicketRecord, channel: NotificationIntent["channel"], event: TicketEvent) {
  const copy = notificationCopy[ticket.language][topic];
  if (channel === "in_app" && !ticket.protected) return `${ticket.id}: ${copy.inApp}`;
  const label = safeStageLabel(topic, ticket);
  if (ticket.protected) return `${externalPrefix(channel, ticket.language)} ${ticket.id}: ${label}. Open Whistle for details.`;
  return `${externalPrefix(channel, ticket.language)} ${ticket.id}: ${copy.external} Stage: ${label}.`;
}

function notificationIntentsForEvents(ticket: TicketRecord, events: TicketEvent[]): NotificationIntent[] {
  const now = nowIso();
  return events.flatMap((event) => {
    const topic = notificationTopicForEvent(event);
    if (!topic || (event.visibility !== "citizen" && event.visibility !== "protected")) return [];
    const channels = channelsForNotification(ticket, topic);
    return channels.map((channel) => ({
      id: internalId("notification"),
      ticketId: ticket.id,
      channel,
      status: "queued",
      topic,
      language: ticket.language,
      recipientMasked: ticket.citizenPhoneMasked,
      safeMessage: safeNotificationMessage(topic, ticket, channel, event),
      sensitive: ticket.protected,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }));
  });
}

function withNotifications(mutation: TicketMutation, events: TicketEvent[]): TicketMutation {
  return {
    ...mutation,
    notificationIntents: notificationIntentsForEvents(mutation.ticket, events),
  };
}

function slaFor(stage: SlaClock["stage"], policy: LifecyclePolicy): SlaClock {
  const enabled = policy.slaEnabled[stage];
  return {
    stage,
    state: enabled ? "on_track" : "paused",
    dueAt: enabled ? addDaysIso(policy.slaDays[stage]) : null,
    paused: !enabled,
  };
}

function isProtectedCategory(category: CreateTicketCommand["category"], policy: LifecyclePolicy) {
  return policy.protectedCategoryIds.has(category) || (category === "corruption" && policy.corruptionBypassesLocalRouting);
}

function evidenceControls(isProtected: boolean, storageState: EvidenceMetadata["storageState"]): EvidenceSecurityControls {
  return {
    classification: isProtected ? "protected" : "standard",
    retentionPolicy: isProtected ? "protected_365_days" : "standard_180_days",
    retentionUntil: retentionUntilIso(isProtected ? 365 : 180),
    encryptionContext: isProtected ? "evidence:protected" : "evidence:standard",
    metadataStripped: storageState === "metadata_only" || storageState === "available",
    downloadAllowed: false,
    watermarkRequired: true,
  };
}

function evidenceMetadata(command: CreateTicketCommand, isProtected: boolean): EvidenceMetadata[] {
  return (command.evidence ?? []).map((item) => ({
    ...item,
    id: evidenceId(),
    storageState: "metadata_only",
    controls: evidenceControls(isProtected, "metadata_only"),
  }));
}

function citizenUpdateEvidence(command: CitizenUpdateCommand, isProtected: boolean): EvidenceMetadata[] {
  return (command.evidence ?? []).map((item) => ({
    ...item,
    id: evidenceId(),
    storageState: "metadata_only",
    controls: evidenceControls(isProtected, "metadata_only"),
  }));
}

function fieldEvidenceMetadata(items: FieldEvidenceCommand[] = [], isProtected = false): EvidenceMetadata[] {
  return items.map(({ label, ...item }) => ({
    ...item,
    fileName: label ? `${label}-${item.fileName}` : item.fileName,
    id: evidenceId(),
    storageState: "metadata_only",
    controls: evidenceControls(isProtected, "metadata_only"),
  }));
}

export function closureChecklistReady(checklist: ClosureChecklist) {
  return Boolean(
    checklist &&
      checklist.fieldVisitCompleted &&
      checklist.evidenceAttached &&
      checklist.citizenImpactChecked &&
      checklist.safetyRiskClosed,
  );
}

function evidenceStorageKey(ticketIdValue: string, evidenceIdValue: string, fileName: string) {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "evidence";
  return `tickets/${ticketIdValue}/evidence/${evidenceIdValue}/${safeName}`;
}

function mockSignedUrl(purpose: "upload" | "preview", storageKey: string, expiresAt: string) {
  return `mock-whistle-evidence://${purpose}/${encodeURIComponent(storageKey)}?expires=${encodeURIComponent(expiresAt)}`;
}

function isBlockedEvidence(evidence: EvidenceMetadata) {
  return evidencePolicyViolation(evidence) !== null;
}

function ministryLabel(ticket: TicketRecord) {
  if (ticket.departmentHint?.toLowerCase().includes("tangedco")) return "Energy Ministry Queue";
  if (ticket.departmentHint?.toLowerCase().includes("revenue")) return "Revenue Ministry Queue";
  return "Municipal Administration Ministry Queue";
}

function ministryScopeValue(ticket: TicketRecord) {
  if (ticket.departmentHint?.toLowerCase().includes("tangedco")) return "Energy";
  if (ticket.departmentHint?.toLowerCase().includes("revenue")) return "Revenue";
  if (ticket.category === "power") return "Energy";
  if (ticket.category === "safety") return "Home";
  if (ticket.category === "health") return "Health and Family Welfare";
  if (ticket.category === "education") return "School Education";
  if (ticket.category === "revenue") return "Revenue";
  if (ticket.category === "ration") return "Cooperation, Food and Consumer Protection";
  return "Municipal Administration and Water Supply";
}

function uniqueQueues(assignments: QueueAssignment[]) {
  const seen = new Set<string>();
  return assignments.filter((assignment) => {
    const key = `${assignment.kind}:${assignment.ownerKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createTicketRecord(command: CreateTicketCommand, policy: LifecyclePolicy = defaultLifecyclePolicy): TicketMutation {
  const createdAt = nowIso();
  const isProtected = isProtectedCategory(command.category, policy);
  const idValue = ticketId();
  const primaryQueue = isProtected ? protectedQueue : verificationQueue;
  const citizenTimeline = [
    makeEvent(idValue, "ticket_submitted", "Complaint submitted in Whistle.", "citizen", "citizen"),
    makeEvent(idValue, "phone_verified", "Phone verified for ticket tracking.", "citizen", "system"),
    makeEvent(
      idValue,
      isProtected ? "protected_screening_started" : "verification_started",
      isProtected ? "Protected screening started before local visibility." : "Ticket Verification Team review started.",
      isProtected ? "protected" : "citizen",
      "system",
    ),
  ];
  const ticket: TicketRecord = {
    id: idValue,
    category: command.category,
    language: command.language,
    title: command.title,
    description: command.description,
    reference: command.reference,
    departmentHint: command.departmentHint,
    status: "submitted",
    protected: isProtected,
    citizenPhoneMasked: maskPhone(command.phone),
    citizenPhoneHash: hashCitizenPhone(command.phone),
    location: command.location,
    evidence: evidenceMetadata(command, isProtected),
    primaryQueue,
    secondaryQueues: [],
    sla: slaFor("verification", policy),
    citizenTimeline,
    governmentEvents: [makeEvent(idValue, "verification_started", `Primary queue assigned to ${primaryQueue.ownerLabel}.`, "government")],
    createdAt,
    updatedAt: createdAt,
  };

  return {
    ticket,
    auditEvents: [
      makeAudit(ticket.id, "ticket.create", "ticket", ticket.id, ticket.protected),
      makeAudit(ticket.id, "queue.assign_primary", "queue", primaryQueue.ownerKey, ticket.protected, primaryQueue.ownerLabel),
    ],
    notificationIntents: notificationIntentsForEvents(ticket, citizenTimeline),
  };
}

export function applyVerificationDecision(ticket: TicketRecord, command: VerificationDecisionCommand, policy: LifecyclePolicy = defaultLifecyclePolicy): TicketMutation {
  const actorRole = command.actorRole ?? "verification";
  const auditReason = command.accessDecision ? `${command.reason} | access=${command.accessDecision}` : command.reason;

  if (command.action === "request_info") {
    const event = makeEvent(ticket.id, "additional_info_requested", command.citizenMessage, "citizen", command.actor);
    return withNotifications(
      {
        ticket: {
          ...ticket,
          status: "needs_info",
          primaryQueue: {
            kind: "citizen",
            ownerKey: `citizen:${ticket.citizenPhoneMasked}`,
            ownerLabel: "Awaiting citizen update",
            scope: { jurisdiction: "state", value: "citizen" },
          },
          secondaryQueues: [verificationQueue],
          sla: { ...ticket.sla, state: "paused", paused: true },
          citizenTimeline: [...ticket.citizenTimeline, event],
          governmentEvents: [
            ...ticket.governmentEvents,
            makeEvent(ticket.id, "additional_info_requested", `Requested missing fields: ${command.missingFields.join(", ")}`, "government", command.actor),
          ],
          updatedAt: nowIso(),
        },
        auditEvents: [makeAudit(ticket.id, "verification.request_info", "ticket", ticket.id, ticket.protected, auditReason, command.actor, actorRole)],
      },
      [event],
    );
  }

  if (command.action === "reject") {
    const event = makeEvent(ticket.id, "ticket_rejected", "Ticket rejected by verification and moved to CM-maintained review.", "citizen", command.actor);
    const reviewEvent = makeEvent(ticket.id, "rejection_review_started", "Independent CM-maintained rejection review started.", "citizen", "system");
    return withNotifications(
      {
        ticket: {
          ...ticket,
          status: "rejected",
          primaryQueue: rejectionReviewQueue,
          secondaryQueues: [verificationQueue],
          sla: slaFor("rejection_review", policy),
          citizenTimeline: [...ticket.citizenTimeline, event, reviewEvent],
          governmentEvents: [...ticket.governmentEvents, makeEvent(ticket.id, "ticket_rejected", command.reason, "government", command.actor)],
          updatedAt: nowIso(),
        },
        auditEvents: [
          makeAudit(ticket.id, "verification.reject", "ticket", ticket.id, ticket.protected, auditReason, command.actor, actorRole),
          makeAudit(ticket.id, "queue.assign_rejection_review", "queue", rejectionReviewQueue.ownerKey, ticket.protected, "Mandatory rejected-ticket review", command.actor, actorRole),
        ],
      },
      [event, reviewEvent],
    );
  }

  if (command.action === "route_protected") {
    const event = makeEvent(ticket.id, "protected_screening_started", "Protected review continues before local visibility.", "protected", command.actor);
    return withNotifications({
      ticket: {
        ...ticket,
        protected: true,
        status: "verified",
        primaryQueue: protectedQueue,
        secondaryQueues: [verificationQueue],
        citizenTimeline: [...ticket.citizenTimeline, event],
        governmentEvents: [...ticket.governmentEvents, makeEvent(ticket.id, "protected_screening_started", command.reason, "protected", command.actor)],
        updatedAt: nowIso(),
      },
      auditEvents: [makeAudit(ticket.id, "verification.route_protected", "ticket", ticket.id, true, auditReason, command.actor, actorRole)],
    }, [event]);
  }

  const localQueue: QueueAssignment = {
    kind: "local",
    ownerKey: command.ownerKey,
    ownerLabel: command.ownerLabel,
    scope: { jurisdiction: "ward", value: command.scopeValue },
  };
  const event = makeEvent(ticket.id, "ticket_routed", `Verified and routed to ${localQueue.ownerLabel}.`, "citizen", command.actor);
  return withNotifications(
    {
      ticket: {
        ...ticket,
        status: "routed_local",
        primaryQueue: localQueue,
        secondaryQueues: [verificationQueue, cmCellQueue],
        sla: slaFor("local", policy),
        citizenTimeline: [...ticket.citizenTimeline, event],
        governmentEvents: [...ticket.governmentEvents, makeEvent(ticket.id, "ticket_routed", command.reason, "government", command.actor)],
        updatedAt: nowIso(),
      },
      auditEvents: [
        makeAudit(ticket.id, "verification.route_local", "ticket", ticket.id, ticket.protected, auditReason, command.actor, actorRole),
        makeAudit(ticket.id, "queue.assign_primary", "queue", localQueue.ownerKey, ticket.protected, localQueue.ownerLabel, command.actor, actorRole),
      ],
    },
    [event],
  );
}

export function applyRejectionReviewDecision(ticket: TicketRecord, command: RejectionReviewDecisionCommand, policy: LifecyclePolicy = defaultLifecyclePolicy): TicketMutation {
  if (command.action === "request_info") {
    const event = makeEvent(ticket.id, "additional_info_requested", command.citizenMessage, "citizen", command.actor);
    const governmentEvent = makeEvent(
      ticket.id,
      "additional_info_requested",
      `CM rejection review requested missing fields: ${command.missingFields.join(", ")}`,
      "government",
      command.actor,
    );
    return withNotifications(
      {
        ticket: {
          ...ticket,
          status: "needs_info",
          primaryQueue: {
            kind: "citizen",
            ownerKey: `citizen:${ticket.citizenPhoneMasked}`,
            ownerLabel: "Awaiting citizen update",
            scope: { jurisdiction: "state", value: "citizen" },
          },
          secondaryQueues: uniqueQueues([rejectionReviewQueue, verificationQueue, cmCellQueue]),
          sla: { ...ticket.sla, state: "paused", paused: true },
          citizenTimeline: [...ticket.citizenTimeline, event],
          governmentEvents: [...ticket.governmentEvents, governmentEvent],
          updatedAt: nowIso(),
        },
        auditEvents: [
          makeAudit(ticket.id, "rejection_review.request_info", "ticket", ticket.id, ticket.protected, command.reason, command.actor, "rejection-review"),
          makeAudit(ticket.id, "queue.await_citizen", "queue", `citizen:${ticket.citizenPhoneMasked}`, ticket.protected, "CM rejection review requested citizen clarification", command.actor, "rejection-review"),
        ],
      },
      [event],
    );
  }

  if (command.action === "uphold_rejection") {
    const event = makeEvent(ticket.id, "rejection_upheld", "CM-maintained review upheld the rejection and closed the ticket.", "citizen", command.actor);
    const governmentEvent = makeEvent(ticket.id, "rejection_upheld", command.closureNote, "government", command.actor);
    return withNotifications(
      {
        ticket: {
          ...ticket,
          status: "closed",
          primaryQueue: rejectionReviewQueue,
          secondaryQueues: [verificationQueue],
          sla: { ...ticket.sla, state: "resolved", dueAt: null, paused: false },
          citizenTimeline: [...ticket.citizenTimeline, event],
          governmentEvents: [...ticket.governmentEvents, governmentEvent],
          updatedAt: nowIso(),
        },
        auditEvents: [
          makeAudit(ticket.id, "rejection_review.uphold", "ticket", ticket.id, ticket.protected, command.reason, command.actor, "rejection-review"),
          makeAudit(ticket.id, "ticket.close_after_rejection_review", "ticket", ticket.id, ticket.protected, command.closureNote, command.actor, "rejection-review"),
        ],
      },
      [event],
    );
  }

  const localQueue: QueueAssignment = {
    kind: "local",
    ownerKey: command.ownerKey,
    ownerLabel: command.ownerLabel,
    scope: { jurisdiction: "ward", value: command.scopeValue },
  };
  const event = makeEvent(ticket.id, "ticket_routed", `Rejection overturned and routed to ${localQueue.ownerLabel}.`, "citizen", command.actor);
  const governmentEvent = makeEvent(ticket.id, "ticket_routed", `Rejection overturned: ${command.reason}`, "government", command.actor);
  return withNotifications(
    {
      ticket: {
        ...ticket,
        status: "routed_local",
        primaryQueue: localQueue,
        secondaryQueues: uniqueQueues([rejectionReviewQueue, verificationQueue, cmCellQueue]),
        sla: slaFor("local", policy),
        citizenTimeline: [...ticket.citizenTimeline, event],
        governmentEvents: [...ticket.governmentEvents, governmentEvent],
        updatedAt: nowIso(),
      },
      auditEvents: [
        makeAudit(ticket.id, "rejection_review.overturn", "ticket", ticket.id, ticket.protected, command.reason, command.actor, "rejection-review"),
        makeAudit(ticket.id, "queue.assign_primary", "queue", localQueue.ownerKey, ticket.protected, localQueue.ownerLabel, command.actor, "rejection-review"),
      ],
    },
    [event],
  );
}

export function applyCitizenUpdate(ticket: TicketRecord, command: CitizenUpdateCommand, policy: LifecyclePolicy = defaultLifecyclePolicy): TicketMutation {
  const conflict = citizenUpdateConflict(ticket);
  if (conflict) throw new Error(conflict.message);
  const actor = command.actor ?? "citizen";
  const updatedEvidence = citizenUpdateEvidence(command, ticket.protected);
  const detail = command.details.trim();
  const event = makeEvent(ticket.id, "citizen_update_submitted", "Citizen submitted additional information. Ticket returned to verification.", "citizen", actor);
  return withNotifications(
    {
      ticket: {
        ...ticket,
        status: "submitted",
        description: `${ticket.description}\n\nCitizen update: ${detail}`,
        location: command.address ? { ...ticket.location, address: command.address } : ticket.location,
        evidence: [...ticket.evidence, ...updatedEvidence],
        primaryQueue: verificationQueue,
        secondaryQueues: [],
        sla: slaFor("verification", policy),
        citizenTimeline: [...ticket.citizenTimeline, event],
        governmentEvents: [
          ...ticket.governmentEvents,
          makeEvent(ticket.id, "citizen_update_submitted", `Citizen update received${updatedEvidence.length ? ` with ${updatedEvidence.length} evidence item(s)` : ""}.`, "government", actor),
        ],
        updatedAt: nowIso(),
      },
      auditEvents: [
        makeAudit(ticket.id, "citizen.update", "ticket", ticket.id, ticket.protected, "Additional information submitted"),
        makeAudit(ticket.id, "queue.assign_primary", "queue", verificationQueue.ownerKey, ticket.protected, "Returned to verification after citizen update"),
      ],
    },
    [event],
  );
}

export function citizenUpdateConflict(ticket: TicketRecord) {
  if (ticket.status === "needs_info" && ticket.primaryQueue.kind === "citizen" && ticket.sla.paused && ticket.sla.state === "paused") return null;
  return {
    error: "citizen_update_not_allowed",
    message:
      "Citizen updates are accepted only while the ticket is awaiting citizen information. Routed, rejected, resolved, or closed tickets must use the dispute/reopen or review flow.",
  };
}

export function applyEscalation(ticket: TicketRecord, command: EscalationCommand, policy: LifecyclePolicy = defaultLifecyclePolicy): TicketMutation {
  const previousPrimary = ticket.primaryQueue;
  const targetQueue: QueueAssignment =
    command.target === "cm_cell"
      ? cmCellQueue
      : {
          kind: "ministry",
          ownerKey: command.ownerKey ?? `ministry:${ticket.category}`,
          ownerLabel: command.ownerLabel ?? ministryLabel(ticket),
          scope: { jurisdiction: "ministry", value: command.scopeValue ?? ministryScopeValue(ticket) },
        };
  const status = command.target === "cm_cell" ? "escalated_cm_cell" : "escalated_ministry";
  const stage = command.target === "cm_cell" ? "cm_cell" : "ministry";
  const citizenMessage =
    command.target === "cm_cell"
      ? "SLA breached at ministry level and ticket escalated to CM Cell."
      : `SLA breached at local level and ticket escalated to ${targetQueue.ownerLabel}.`;
  const event = makeEvent(ticket.id, "ticket_escalated", citizenMessage, "citizen", command.actor);

  return withNotifications(
    {
      ticket: {
        ...ticket,
        status,
        primaryQueue: targetQueue,
        secondaryQueues: uniqueQueues([previousPrimary, ...ticket.secondaryQueues]).filter((queue) => `${queue.kind}:${queue.ownerKey}` !== `${targetQueue.kind}:${targetQueue.ownerKey}`),
        sla: slaFor(stage, policy),
        citizenTimeline: [...ticket.citizenTimeline, event],
        governmentEvents: [...ticket.governmentEvents, makeEvent(ticket.id, "ticket_escalated", command.reason, "government", command.actor)],
        updatedAt: nowIso(),
      },
      auditEvents: [
        makeAudit(ticket.id, `sla.escalate.${command.target}`, "ticket", ticket.id, ticket.protected, command.reason),
        makeAudit(ticket.id, "queue.assign_primary", "queue", targetQueue.ownerKey, ticket.protected, targetQueue.ownerLabel),
      ],
    },
    [event],
  );
}

export function applySlaBreachFlag(ticket: TicketRecord, actor: string, reason: string): TicketMutation {
  const secondaryQueues = ticket.sla.stage === "verification" ? uniqueQueues([...ticket.secondaryQueues, cmCellQueue]) : ticket.secondaryQueues;
  const citizenMessage =
    ticket.sla.stage === "verification"
      ? "Verification SLA breached. The ticket remains in verification and is visible for supervisor review."
      : `${ticket.primaryQueue.ownerLabel} SLA breached. The ticket has been flagged for urgent review.`;
  const event = makeEvent(ticket.id, "audit_note", citizenMessage, "citizen", actor);

  return withNotifications(
    {
      ticket: {
        ...ticket,
        secondaryQueues,
        sla: {
          ...ticket.sla,
          state: "breached",
          paused: false,
        },
        citizenTimeline: [...ticket.citizenTimeline, event],
        governmentEvents: [...ticket.governmentEvents, makeEvent(ticket.id, "audit_note", reason, "government", actor)],
        updatedAt: nowIso(),
      },
      auditEvents: [makeAudit(ticket.id, "sla.mark_breached", "sla", ticket.sla.stage, ticket.protected, reason)],
    },
    [event],
  );
}

export function applySlaJobTransition(ticket: TicketRecord, actor: string, policy: LifecyclePolicy = defaultLifecyclePolicy): { mutation: TicketMutation; action: SlaJobAction } | null {
  if (ticket.sla.paused || ticket.sla.state === "breached" || ticket.status === "closed" || ticket.status === "resolved") return null;

  const previousStage = ticket.sla.stage;
  const previousQueue = ticket.primaryQueue.kind;

  if (previousStage === "local") {
    const reason = "Local / MLA SLA breached; job escalated ticket to assigned ministry and retained prior queue visibility.";
    const mutation = applyEscalation(
      ticket,
      {
        actor,
        reason,
        target: "ministry",
      },
      policy,
    );
    return {
      mutation,
      action: {
        ticketId: ticket.id,
        title: ticket.title,
        previousStage,
        previousQueue,
        nextStage: mutation.ticket.sla.stage,
        nextQueue: mutation.ticket.primaryQueue.kind,
        outcome: "escalated_to_ministry",
        reason,
      },
    };
  }

  if (previousStage === "ministry") {
    const reason = "Ministry SLA breached; job escalated ticket to CM Cell and retained ministry as secondary visibility.";
    const mutation = applyEscalation(
      ticket,
      {
        actor,
        reason,
        target: "cm_cell",
      },
      policy,
    );
    return {
      mutation,
      action: {
        ticketId: ticket.id,
        title: ticket.title,
        previousStage,
        previousQueue,
        nextStage: mutation.ticket.sla.stage,
        nextQueue: mutation.ticket.primaryQueue.kind,
        outcome: "escalated_to_cm_cell",
        reason,
      },
    };
  }

  const reason = `${previousStage} SLA breached; job flagged ticket without changing primary ownership.`;
  const mutation = applySlaBreachFlag(ticket, actor, reason);
  return {
    mutation,
    action: {
      ticketId: ticket.id,
      title: ticket.title,
      previousStage,
      previousQueue,
      nextStage: mutation.ticket.sla.stage,
      nextQueue: mutation.ticket.primaryQueue.kind,
      outcome: "marked_breached",
      reason,
    },
  };
}

export function createEvidenceUploadSession(ticket: TicketRecord, command: EvidenceUploadCommand): { mutation: TicketMutation; session: EvidenceUploadSession } {
  const actor = command.actor ?? "citizen";
  const id = evidenceId();
  const storageKey = evidenceStorageKey(ticket.id, id, command.fileName);
  const expiresAt = addMinutesIso(15);
  const evidence: EvidenceMetadata = {
    id,
    fileName: command.fileName,
    mimeType: command.mimeType,
    sizeBytes: command.sizeBytes,
    storageState: "upload_pending",
    storageKey,
    controls: evidenceControls(ticket.protected, "upload_pending"),
  };
  const event = makeEvent(ticket.id, "audit_note", `Evidence upload session created for ${command.fileName}.`, "government", actor);

  return {
    mutation: {
      ticket: {
        ...ticket,
        evidence: [...ticket.evidence, evidence],
        governmentEvents: [...ticket.governmentEvents, event],
        updatedAt: nowIso(),
      },
      auditEvents: [
        makeAudit(ticket.id, "evidence.upload_session_created", "evidence", evidence.id, ticket.protected, "Signed upload session issued"),
      ],
    },
    session: {
      evidence,
      uploadMethod: "PUT",
      uploadUrl: mockSignedUrl("upload", storageKey, expiresAt),
      expiresAt,
      requiredHeaders: {
        "content-type": command.mimeType,
        "x-whistle-evidence-id": evidence.id,
        "x-whistle-encryption-context": evidence.controls.encryptionContext,
        "x-whistle-retention-policy": evidence.controls.retentionPolicy,
        "x-whistle-metadata-policy": "strip-before-preview",
      },
    },
  };
}

export function evidenceUploadCompletionConflict(ticket: TicketRecord, evidenceId: string, command: EvidenceUploadCompletionCommand): string | null {
  const evidence = ticket.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return "evidence_not_found";
  if (evidence.storageState !== "upload_pending") return `Evidence ${evidence.id} is ${evidence.storageState}; only upload_pending evidence can be completed.`;
  if (!evidence.storageKey) return `Evidence ${evidence.id} does not have an object-storage key.`;
  if (evidence.mimeType !== command.mimeType) return `Uploaded content type ${command.mimeType} does not match signed session type ${evidence.mimeType}.`;
  if (evidence.sizeBytes !== command.sizeBytes) return `Uploaded size ${command.sizeBytes} does not match signed session size ${evidence.sizeBytes}.`;
  return null;
}

export function completeEvidenceUpload(ticket: TicketRecord, evidenceId: string, command: EvidenceUploadCompletionCommand): TicketMutation | null {
  const conflict = evidenceUploadCompletionConflict(ticket, evidenceId, command);
  if (conflict) return null;

  const actor = command.actor ?? "citizen";
  const completedEvidence = ticket.evidence.map((evidence) => {
    if (evidence.id !== evidenceId) return evidence;
    return {
      ...evidence,
      checksum: command.checksum,
      storageState: "scan_pending" as const,
      controls: {
        ...evidence.controls,
        metadataStripped: false,
      },
    };
  });
  const event = makeEvent(ticket.id, "audit_note", "Evidence upload completed and queued for scanning.", "government", actor);

  return {
    ticket: {
      ...ticket,
      evidence: completedEvidence,
      governmentEvents: [...ticket.governmentEvents, event],
      updatedAt: nowIso(),
    },
    auditEvents: [
      makeAudit(ticket.id, "evidence.upload_completed", "evidence", evidenceId, ticket.protected, "Object upload completed; evidence is waiting for scan", actor, "evidence-uploader"),
    ],
  };
}

export function applyEvidenceScan(ticket: TicketRecord, actor: string, scanVerdicts?: ReadonlyMap<string, EvidenceScanVerdict>): { mutation: TicketMutation; actions: EvidenceScanAction[] } | null {
  const candidates = ticket.evidence.filter((evidence) => evidence.storageState === "scan_pending");
  if (!candidates.length) return null;

  const actions: EvidenceScanAction[] = [];
  const scannedEvidence = ticket.evidence.map((evidence) => {
    if (evidence.storageState !== "scan_pending") return evidence;
    const verdict = scanVerdicts?.get(evidence.id);
    if (scanVerdicts && !verdict) return evidence;

    const blocked = verdict ? verdict.status === "blocked" : isBlockedEvidence(evidence);
    const toState: EvidenceMetadata["storageState"] = blocked ? "blocked" : "available";
    const checksum = verdict?.checksum ?? (blocked ? evidence.checksum : evidence.checksum ?? `mvp-sha256:${evidence.id.slice(0, 12)}`);
    actions.push({
      ticketId: ticket.id,
      evidenceId: evidence.id,
      fileName: evidence.fileName,
      fromState: evidence.storageState,
      toState,
      reason: verdict?.reason ?? (blocked ? "Evidence failed MVP content-type/name guardrail." : "Evidence passed MVP malware-scan placeholder."),
    });
    return {
      ...evidence,
      storageState: toState,
      checksum,
      controls: {
        ...evidence.controls,
        metadataStripped: verdict?.metadataStripped ?? !blocked,
      },
    };
  });

  if (!actions.length) return null;

  return {
    mutation: {
      ticket: {
        ...ticket,
        evidence: scannedEvidence,
        governmentEvents: [
          ...ticket.governmentEvents,
          makeEvent(ticket.id, "audit_note", `Evidence scan processed ${actions.length} item(s).`, "government", actor),
        ],
        updatedAt: nowIso(),
      },
      auditEvents: actions.map((action) =>
        makeAudit(ticket.id, action.toState === "blocked" ? "evidence.scan_blocked" : "evidence.scan_available", "evidence", action.evidenceId, ticket.protected, action.reason),
      ),
    },
    actions,
  };
}

export function createEvidenceAccessResult(ticket: TicketRecord, query: EvidenceAccessQuery): { result: EvidenceAccessResult; auditEvents: AuditEvent[] } {
  const expiresAt = addMinutesIso(10);
  const role = query.role;
  const canPreviewProtected = role === "cm_cell" || role === "verification" || role === "admin";
  const canPreviewStandard = canPreviewProtected || role === "minister" || role === "department_officer";
  const items = ticket.evidence.map((evidence) => {
    const protectedDenied = ticket.protected && !canPreviewProtected;
    const previewAllowed = !protectedDenied && (ticket.protected ? canPreviewProtected : canPreviewStandard) && evidence.storageState === "available";
    const accessLevel: "hidden" | "metadata" | "preview" = protectedDenied ? "hidden" : previewAllowed ? "preview" : "metadata";
    if (accessLevel === "hidden") {
      return {
        id: evidence.id,
        accessLevel,
        deniedReason: "Protected evidence is restricted to CM Cell, verification/protected screening, and Admin audit roles.",
      };
    }
    if (accessLevel === "metadata") {
      return {
        id: evidence.id,
        accessLevel,
        fileName: evidence.fileName,
        mimeType: evidence.mimeType,
        sizeBytes: evidence.sizeBytes,
        storageState: evidence.storageState,
      };
    }
    return {
      ...evidence,
      accessLevel,
      previewUrl: previewAllowed && evidence.storageKey ? mockSignedUrl("preview", evidence.storageKey, expiresAt) : undefined,
      expiresAt: previewAllowed ? expiresAt : undefined,
      watermark: previewAllowed ? `${role}:${query.actor ?? "prototype"}:${ticket.id}` : undefined,
    };
  });

  return {
    result: {
      ticketId: ticket.id,
      role,
      protected: ticket.protected,
      items,
    },
    auditEvents: [
      makeAudit(
        ticket.id,
        ticket.protected ? "evidence.protected_access_list" : "evidence.access_list",
        "access",
        ticket.id,
        ticket.protected,
        ticket.protected ? `Protected evidence access reason: ${query.accessReason ?? "not provided"}` : `Evidence access listed for ${role}`,
        query.actor,
        role,
      ),
    ],
  };
}

export function applyFieldExecution(ticket: TicketRecord, command: FieldExecutionCommand, policy: LifecyclePolicy = defaultLifecyclePolicy): TicketMutation {
  if (command.action === "schedule_visit") {
    const event = makeEvent(
      ticket.id,
      "field_visit_scheduled",
      `Field visit scheduled for ${command.visitAt} by ${command.fieldOfficer}.`,
      "citizen",
      command.actor,
    );
    const governmentEvent = makeEvent(ticket.id, "field_visit_scheduled", command.note, "government", command.actor);
    return withNotifications(
      {
        ticket: {
          ...ticket,
          citizenTimeline: [...ticket.citizenTimeline, event],
          governmentEvents: [...ticket.governmentEvents, governmentEvent],
          updatedAt: nowIso(),
        },
        auditEvents: [
          makeAudit(ticket.id, "field.visit_scheduled", "ticket", ticket.id, ticket.protected, command.note, command.actor, "field-operator"),
        ],
      },
      [event],
    );
  }

  if (command.action === "add_field_report") {
    const evidence = fieldEvidenceMetadata(command.evidence, ticket.protected);
    const event = makeEvent(ticket.id, "field_report_added", "Field report added by the accountable owner.", "citizen", command.actor);
    const governmentEvent = makeEvent(
      ticket.id,
      "field_report_added",
      `${command.fieldOfficer}: ${command.note}${evidence.length ? ` (${evidence.length} evidence item(s))` : ""}`,
      "government",
      command.actor,
    );
    return withNotifications(
      {
        ticket: {
          ...ticket,
          evidence: [...ticket.evidence, ...evidence],
          citizenTimeline: [...ticket.citizenTimeline, event],
          governmentEvents: [...ticket.governmentEvents, governmentEvent],
          updatedAt: nowIso(),
        },
        auditEvents: [
          makeAudit(ticket.id, "field.report_added", "ticket", ticket.id, ticket.protected, command.note, command.actor, "field-operator"),
          ...evidence.map((item) =>
            makeAudit(ticket.id, "field.evidence_attached", "evidence", item.id, ticket.protected, "Field report evidence attached", command.actor, "field-operator"),
          ),
        ],
      },
      [event],
    );
  }

  if (command.action === "transfer") {
    const targetQueue: QueueAssignment = {
      kind: command.queueKind,
      ownerKey: command.ownerKey,
      ownerLabel: command.ownerLabel,
      scope: { jurisdiction: command.scopeKind, value: command.scopeValue },
    };
    const stage: SlaClock["stage"] = command.queueKind === "ministry" ? "ministry" : "local";
    const status: TicketRecord["status"] = command.queueKind === "ministry" ? "escalated_ministry" : "routed_local";
    const event = makeEvent(ticket.id, "ticket_transferred", `Ticket transferred to ${targetQueue.ownerLabel}.`, "citizen", command.actor);
    const governmentEvent = makeEvent(ticket.id, "ticket_transferred", command.reason, "government", command.actor);
    return withNotifications(
      {
        ticket: {
          ...ticket,
          status,
          primaryQueue: targetQueue,
          secondaryQueues: uniqueQueues([ticket.primaryQueue, ...ticket.secondaryQueues]).filter((queue) => `${queue.kind}:${queue.ownerKey}` !== `${targetQueue.kind}:${targetQueue.ownerKey}`),
          sla: slaFor(stage, policy),
          citizenTimeline: [...ticket.citizenTimeline, event],
          governmentEvents: [...ticket.governmentEvents, governmentEvent],
          updatedAt: nowIso(),
        },
        auditEvents: [
          makeAudit(ticket.id, "field.transfer", "ticket", ticket.id, ticket.protected, command.reason, command.actor, "field-operator"),
          makeAudit(ticket.id, "queue.assign_primary", "queue", targetQueue.ownerKey, ticket.protected, targetQueue.ownerLabel, command.actor, "field-operator"),
        ],
      },
      [event],
    );
  }

  const evidence = fieldEvidenceMetadata(command.evidence, ticket.protected);
  const event = makeEvent(ticket.id, "ticket_resolved", "Issue marked resolved with closure note.", "citizen", command.actor);
  const governmentEvent = makeEvent(
    ticket.id,
    "ticket_resolved",
    `${command.resolutionNote} Checklist: field visit=${command.checklist.fieldVisitCompleted}, evidence=${command.checklist.evidenceAttached}, citizen impact=${command.checklist.citizenImpactChecked}, safety=${command.checklist.safetyRiskClosed}.`,
    "government",
    command.actor,
  );
  return withNotifications(
    {
      ticket: {
        ...ticket,
        status: "resolved",
        evidence: [...ticket.evidence, ...evidence],
        sla: { ...ticket.sla, state: "resolved", dueAt: null, paused: false },
        citizenTimeline: [...ticket.citizenTimeline, event],
        governmentEvents: [...ticket.governmentEvents, governmentEvent],
        updatedAt: nowIso(),
      },
      auditEvents: [
        makeAudit(ticket.id, "field.resolve", "ticket", ticket.id, ticket.protected, command.resolutionNote, command.actor, "field-operator"),
        ...evidence.map((item) =>
          makeAudit(ticket.id, "field.closure_evidence_attached", "evidence", item.id, ticket.protected, "Closure evidence attached", command.actor, "field-operator"),
        ),
      ],
    },
    [event],
  );
}

export function applyCitizenDispute(ticket: TicketRecord, command: CitizenDisputeCommand, policy: LifecyclePolicy = defaultLifecyclePolicy): TicketMutation {
  const actor = command.actor ?? "citizen";
  const evidence = fieldEvidenceMetadata(command.evidence, ticket.protected);
  const event = makeEvent(ticket.id, "ticket_reopened", "Citizen submitted a reopen/dispute request.", "citizen", actor);
  const governmentEvent = makeEvent(ticket.id, "ticket_reopened", `Citizen dispute: ${command.reason}`, "government", actor);
  return withNotifications(
    {
      ticket: {
        ...ticket,
        status: "reopened",
        evidence: [...ticket.evidence, ...evidence],
        primaryQueue: verificationQueue,
        secondaryQueues: uniqueQueues([ticket.primaryQueue, ...ticket.secondaryQueues, cmCellQueue]),
        sla: slaFor("verification", policy),
        citizenTimeline: [...ticket.citizenTimeline, event],
        governmentEvents: [...ticket.governmentEvents, governmentEvent],
        updatedAt: nowIso(),
      },
      auditEvents: [
        makeAudit(ticket.id, "citizen.dispute_reopen", "ticket", ticket.id, ticket.protected, command.reason, actor, "citizen"),
        makeAudit(ticket.id, "queue.assign_primary", "queue", verificationQueue.ownerKey, ticket.protected, "Reopened for verification review", actor, "citizen"),
        ...evidence.map((item) =>
          makeAudit(ticket.id, "citizen.dispute_evidence_attached", "evidence", item.id, ticket.protected, "Citizen dispute evidence attached", actor, "citizen"),
        ),
      ],
    },
    [event],
  );
}

export const demoTicketCommands: CreateTicketCommand[] = [
  {
    category: "sanitation",
    language: "en",
    title: "Sewage overflow near Velachery school gate",
    description: "Sewage water is overflowing near a Velachery school gate. Needs urgent verification and local routing.",
    phone: "+91 98765 42010",
    departmentHint: "Corporation / Municipality",
    location: { district: "Chennai", area: "Velachery", landmark: "Near school gate" },
    evidence: [{ fileName: "velachery-school-overflow.jpg", mimeType: "image/jpeg", sizeBytes: 824000 }],
  },
  {
    category: "sanitation",
    language: "en",
    title: "Sewage overflow near Velachery school gate - ministry proof due",
    description: "The same school-gate sanitation issue needs ministry follow-up because local proof has not been uploaded.",
    phone: "+91 98765 42011",
    departmentHint: "Municipal Administration and Water Supply",
    location: { district: "Chennai", area: "Velachery", landmark: "Near school gate" },
    evidence: [],
  },
  {
    category: "corruption",
    language: "en",
    title: "Protected contractor-pressure report linked to Velachery drain repair",
    description: "A citizen reports pressure to suppress field proof for the Velachery drain repair. Keep this protected until authorized review.",
    phone: "+91 98765 42012",
    departmentHint: "CM Cell / Vigilance",
    location: { district: "Chennai", area: "Velachery", landmark: "Near ward office" },
    evidence: [{ fileName: "receipt-reference.pdf", mimeType: "application/pdf", sizeBytes: 420000 }],
  },
  {
    category: "power",
    language: "en",
    title: "Street lights out near Velachery school-gate repair zone",
    description: "Street lights are out near the same school-gate repair zone and residents report unsafe movement after dark.",
    phone: "+91 98765 42013",
    departmentHint: "TANGEDCO / Local Body",
    location: { district: "Chennai", area: "Velachery", landmark: "School gate approach" },
    evidence: [{ fileName: "night-street-video.mp4", mimeType: "video/mp4", sizeBytes: 2400000 }],
  },
  {
    category: "sanitation",
    language: "en",
    title: "Sewage overflow near Velachery school gate - CM Cell escalation",
    description: "Sewage is still backing up near the school gate after local and ministry clocks slipped.",
    phone: "+91 98765 42014",
    departmentHint: "Corporation / Municipality",
    location: { district: "Chennai", area: "Velachery", landmark: "Near school gate" },
    evidence: [{ fileName: "velachery-overflow-escalated.jpg", mimeType: "image/jpeg", sizeBytes: 924000 }],
  },
  {
    category: "roads",
    language: "en",
    title: "School-zone access path damaged by Velachery overflow",
    description: "The access path beside the same school-gate overflow is damaged and needs local closure proof.",
    phone: "+91 98765 42015",
    departmentHint: "Corporation / Municipality",
    location: { district: "Chennai", area: "Velachery", landmark: "Near school gate" },
    evidence: [{ fileName: "school-access-path.jpg", mimeType: "image/jpeg", sizeBytes: 784000 }],
  },
];
