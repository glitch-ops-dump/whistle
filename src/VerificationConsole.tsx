import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  EyeOff,
  FileText,
  Filter,
  Landmark,
  LockKeyhole,
  MapPin,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import { newClientNonce } from "./idempotency";
import { officialAuthHeadersAsync } from "./officialAuthClient";
import {
  CitizenVisibleUpdateCard,
  RolePatternSummary,
  SlaLadderCard,
  roleConsolePatterns,
  type SelectedTicketSummary,
} from "./roleConsolePattern";

type CategoryId =
  | "corruption"
  | "roads"
  | "water"
  | "power"
  | "sanitation"
  | "safety"
  | "health"
  | "education"
  | "revenue"
  | "ration"
  | "other";

type QueueKind = "citizen" | "verification" | "protected_review" | "rejection_review" | "local" | "mla" | "ministry" | "cm_cell";
type SlaState = "on_track" | "due_soon" | "breached" | "paused" | "resolved";
type ActionMode = "route_local" | "request_info" | "route_protected" | "reject";
type FilterMode = "all" | "standard" | "protected" | "due";
type AgentRecommendationAction = "route_local" | "request_info" | "route_protected" | "reject_candidate";

type QueueAssignment = {
  kind: QueueKind;
  ownerKey: string;
  ownerLabel: string;
  scope: {
    jurisdiction: string;
    value: string;
  };
};

type SlaClock = {
  stage: string;
  state: SlaState;
  dueAt: string | null;
  paused: boolean;
};

type EvidenceMetadata = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageState: string;
};

type EvidenceSecurityControls = {
  classification: "standard" | "protected";
  retentionPolicy: string;
  retentionUntil: string | null;
  encryptionContext: string;
  metadataStripped: boolean;
  downloadAllowed: boolean;
  watermarkRequired: boolean;
};

type EvidenceAccessItem = Pick<EvidenceMetadata, "id"> & {
  accessLevel: "hidden" | "metadata" | "preview";
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  storageState?: string;
  controls?: EvidenceSecurityControls;
  previewUrl?: string;
  expiresAt?: string;
  watermark?: string;
  deniedReason?: string;
};

type EvidenceAccessResult = {
  ticketId: string;
  role: string;
  protected: boolean;
  items: EvidenceAccessItem[];
};

type TicketEvent = {
  id: string;
  ticketId: string;
  type: string;
  actor: string;
  message: string;
  createdAt: string;
  visibility: "citizen" | "government" | "protected";
};

type VerificationTicket = {
  id: string;
  category: CategoryId;
  language: "en" | "ta";
  title: string;
  description: string;
  reference?: string;
  departmentHint?: string;
  status: string;
  protected: boolean;
  citizenPhoneMasked: string;
  location: {
    district: string;
    area: string;
    address?: string;
    landmark?: string;
  };
  evidence: EvidenceMetadata[];
  primaryQueue: QueueAssignment;
  secondaryQueues: QueueAssignment[];
  sla: SlaClock;
  citizenTimeline: TicketEvent[];
  governmentEvents: TicketEvent[];
  createdAt: string;
  updatedAt: string;
};

type AgentDuplicateCandidate = {
  ticketId: string;
  district: string;
  category: CategoryId;
  similarityReason: string;
};

type IntakeAgentRecommendation = {
  primaryAction: AgentRecommendationAction;
  confidence: number;
  suggestedCategory: CategoryId;
  suggestedDepartment: string;
  recommendedOwner: {
    ownerKey: string;
    ownerLabel: string;
    scopeValue: string;
  } | null;
  missingFields: string[];
  evidenceAssessment: {
    usefulCount: number;
    needsMoreEvidence: boolean;
    note: string;
  };
  locationAssessment: {
    confidence: number;
    missing: string[];
  };
  protectedSignal: {
    flagged: boolean;
    reasons: string[];
  };
  duplicateCandidates: AgentDuplicateCandidate[];
  rejectionGuardrails: string[];
  draftCitizenMessage: string;
  reviewerSummary: string;
  reasons: string[];
  nonMutationGuarantee: string;
};

type AgentRecommendationRun = {
  id: string;
  ticketId: string;
  actor: string;
  purpose: "intake_verification";
  promptVersion: string;
  modelVersion: string;
  inputHash: string;
  recommendation: IntakeAgentRecommendation;
  createdAt: string;
};

type RuntimeAssets = {
  logo: string;
  emblem: string;
};

declare global {
  interface Window {
    __WHISTLE_VERIFICATION_ASSETS__?: RuntimeAssets;
  }
}

const ASSETS: RuntimeAssets = window.__WHISTLE_VERIFICATION_ASSETS__ ?? {
  logo: "/assets/brand/whistle-fake-logo.svg",
  emblem: "/assets/brand/whistle-civic-mark.svg",
};

const API_BASE = import.meta.env.VITE_WHISTLE_API_BASE ?? "http://localhost:3001";
const verificationAuth = { role: "verification", actor: "verification:prototype" };

const filterItems: { id: FilterMode; label: string }[] = [
  { id: "all", label: "All intake" },
  { id: "standard", label: "Standard civic" },
  { id: "protected", label: "Protected" },
  { id: "due", label: "SLA watch" },
];

const categoryLabels: Record<CategoryId, string> = {
  corruption: "Corruption",
  roads: "Roads",
  water: "Water",
  power: "Power",
  sanitation: "Sanitation",
  safety: "Public Safety",
  health: "Health",
  education: "Education",
  revenue: "Revenue",
  ration: "Ration / PDS",
  other: "Other",
};

const agentActionLabels: Record<AgentRecommendationAction, string> = {
  route_local: "Route to local owner",
  request_info: "Request more info",
  route_protected: "Keep protected",
  reject_candidate: "Review for rejection",
};

function formatAge(iso: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatDue(dueAt: string | null) {
  if (!dueAt) return "No active SLA";
  const hours = Math.round((new Date(dueAt).getTime() - Date.now()) / 36e5);
  if (hours < 0) return `${Math.abs(hours)}h breached`;
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

function sizeLabel(bytes: number) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function ownerKeyFromLabel(label: string) {
  return `local:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "owner"}`;
}

function slaTone(ticket: VerificationTicket) {
  if (ticket.sla.state === "breached") return "danger";
  if (ticket.sla.state === "due_soon") return "warn";
  if (!ticket.sla.dueAt) return "neutral";
  const hours = (new Date(ticket.sla.dueAt).getTime() - Date.now()) / 36e5;
  return hours <= 24 ? "warn" : "good";
}

async function fetchQueue() {
  const response = await verificationFetch(`${API_BASE}/api/verification/queue`);
  if (!response.ok) throw new Error(`Queue request failed (${response.status})`);
  return (await response.json()) as { tickets: VerificationTicket[] };
}

async function verificationFetch(input: RequestInfo | URL, init: RequestInit = {}, authOptions: { json?: boolean; accessReason?: string } = {}) {
  const headers = {
    ...((init.headers as Record<string, string> | undefined) ?? {}),
    ...(await officialAuthHeadersAsync(verificationAuth, authOptions)),
  };
  const first = await fetch(input, { ...init, credentials: "include", headers });
  if (first.status !== 401 && first.status !== 403) return first;
  const retryHeaders = {
    ...((init.headers as Record<string, string> | undefined) ?? {}),
    ...(await officialAuthHeadersAsync(verificationAuth, { ...authOptions, forceRefresh: true })),
  };
  return fetch(input, { ...init, credentials: "include", headers: retryHeaders });
}

async function sendDecision(ticketId: string, mode: ActionMode, form: DecisionFormState, idempotencyKey: string) {
  const common = {
    actor: "verification:prototype",
    reason: form.reason.trim(),
  };
  const body =
    mode === "route_local"
      ? {
          ...common,
          action: "route_local",
          ownerKey: ownerKeyFromLabel(form.ownerLabel),
          ownerLabel: form.ownerLabel.trim(),
          scopeValue: form.scopeValue.trim(),
        }
      : mode === "request_info"
        ? {
            ...common,
            action: "request_info",
            citizenMessage: form.citizenMessage.trim(),
            missingFields: form.missingFields
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          }
        : mode === "route_protected"
          ? {
              ...common,
              action: "route_protected",
            }
          : {
              ...common,
              action: "reject",
            };

  const response = await verificationFetch(`${API_BASE}/api/verification/${ticketId}/decision`, {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  }, { json: true });
  if (!response.ok) throw new Error(`Decision failed (${response.status})`);
  return (await response.json()) as { ticket: VerificationTicket };
}

async function fetchAgentRuns(ticketId: string) {
  const response = await verificationFetch(`${API_BASE}/api/verification/${ticketId}/agent-runs`);
  if (!response.ok) throw new Error(`Recommendation history failed (${response.status})`);
  return (await response.json()) as { runs: AgentRecommendationRun[] };
}

async function createAgentRun(ticketId: string) {
  const response = await verificationFetch(`${API_BASE}/api/verification/${ticketId}/agent-runs`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`Recommendation failed (${response.status})`);
  return (await response.json()) as { run: AgentRecommendationRun };
}

async function fetchEvidenceAccess(ticketId: string) {
  const response = await verificationFetch(
    `${API_BASE}/api/tickets/${encodeURIComponent(ticketId)}/evidence?role=verification&actor=verification%3Aprototype`,
    {},
    { accessReason: "Verification intake evidence review" },
  );
  if (!response.ok) throw new Error(`Evidence access failed (${response.status})`);
  return (await response.json()) as { evidence: EvidenceAccessResult };
}

type DecisionFormState = {
  reason: string;
  ownerLabel: string;
  scopeValue: string;
  missingFields: string;
  citizenMessage: string;
};

const initialForm: DecisionFormState = {
  reason: "Complaint has enough Velachery location detail and evidence to begin local field action.",
  ownerLabel: "Velachery MLA Office",
  scopeValue: "Velachery",
  missingFields: "nearest school gate, current overflow photo",
  citizenMessage: "Please add the nearest school gate and one current overflow photo so the verification team can route your complaint correctly.",
};

function VerificationConsole() {
  const [tickets, setTickets] = useState<VerificationTicket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>("route_local");
  const [form, setForm] = useState<DecisionFormState>(initialForm);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionDraftKey, setDecisionDraftKey] = useState(() => newClientNonce("verification-decision"));
  const [notice, setNotice] = useState<string | null>(null);
  const [agentRuns, setAgentRuns] = useState<Record<string, AgentRecommendationRun[]>>({});
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [evidenceAccess, setEvidenceAccess] = useState<Record<string, EvidenceAccessResult>>({});
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const loadQueue = async (preferredId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchQueue();
      setTickets(result.tickets);
      setSelectedId((current) => {
        if (preferredId && result.tickets.some((ticket) => ticket.id === preferredId)) return preferredId;
        if (current && result.tickets.some((ticket) => ticket.id === current)) return current;
        return result.tickets[0]?.id ?? null;
      });
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "Could not load verification queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQueue();
  }, []);

  useEffect(() => {
    setDecisionDraftKey(newClientNonce("verification-decision"));
  }, [selectedId, actionMode]);

  const filteredTickets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "standard" && !ticket.protected) ||
        (filter === "protected" && ticket.protected) ||
        (filter === "due" && slaTone(ticket) !== "good");
      const matchesQuery =
        !needle ||
        ticket.id.toLowerCase().includes(needle) ||
        ticket.title.toLowerCase().includes(needle) ||
        ticket.location.district.toLowerCase().includes(needle) ||
        categoryLabels[ticket.category].toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, tickets]);

  const selectedTicket = filteredTickets.find((ticket) => ticket.id === selectedId) ?? filteredTickets[0] ?? tickets.find((ticket) => ticket.id === selectedId) ?? null;
  const selectedAgentRun = selectedTicket ? (agentRuns[selectedTicket.id]?.[0] ?? null) : null;
  const selectedPatternTicket: SelectedTicketSummary | undefined = selectedTicket
    ? {
        id: selectedTicket.id,
        title: selectedTicket.title,
        owner: selectedTicket.primaryQueue.ownerLabel,
        status: selectedTicket.status.replaceAll("_", " "),
      }
    : undefined;

  const stats = useMemo(
    () => ({
      total: tickets.length,
      protectedCount: tickets.filter((ticket) => ticket.protected).length,
      dueWatch: tickets.filter((ticket) => slaTone(ticket) !== "good").length,
      evidenceItems: tickets.reduce((sum, ticket) => sum + ticket.evidence.length, 0),
    }),
    [tickets],
  );

  useEffect(() => {
    if (!selectedTicket || agentRuns[selectedTicket.id]) return;
    setAgentError(null);
    fetchAgentRuns(selectedTicket.id)
      .then((result) => {
        setAgentRuns((current) => ({ ...current, [selectedTicket.id]: result.runs }));
      })
      .catch((historyError) => {
        setAgentError(historyError instanceof Error ? historyError.message : "Could not load recommendation history");
      });
  }, [agentRuns, selectedTicket]);

  useEffect(() => {
    if (!selectedTicket || evidenceAccess[selectedTicket.id]) return;
    setEvidenceBusy(true);
    setEvidenceError(null);
    fetchEvidenceAccess(selectedTicket.id)
      .then((result) => {
        setEvidenceAccess((current) => ({ ...current, [selectedTicket.id]: result.evidence }));
      })
      .catch((accessError) => {
        setEvidenceError(accessError instanceof Error ? accessError.message : "Could not load governed evidence access");
      })
      .finally(() => setEvidenceBusy(false));
  }, [evidenceAccess, selectedTicket]);

  const generateAgentRun = async () => {
    if (!selectedTicket) return;
    setAgentBusy(true);
    setAgentError(null);
    try {
      const result = await createAgentRun(selectedTicket.id);
      setAgentRuns((current) => ({
        ...current,
        [selectedTicket.id]: [result.run, ...(current[selectedTicket.id] ?? [])],
      }));
      setNotice(`${selectedTicket.id}: reviewer packet generated. No ticket state was changed.`);
    } catch (runError) {
      setAgentError(runError instanceof Error ? runError.message : "Could not generate recommendation");
    } finally {
      setAgentBusy(false);
    }
  };

  const submitDecision = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTicket) return;
    setDecisionBusy(true);
    setError(null);
    try {
      const result = await sendDecision(selectedTicket.id, actionMode, form, decisionDraftKey);
      setNotice(`${selectedTicket.id} saved: primary queue is now ${result.ticket.primaryQueue.ownerLabel}.`);
      setForm(initialForm);
      setDecisionDraftKey(newClientNonce("verification-decision"));
      await loadQueue();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Could not save decision");
    } finally {
      setDecisionBusy(false);
    }
  };

  return (
    <div className="verification-app">
      <aside className="verification-sidebar">
        <div className="verification-brand">
          <img alt="Whistle logo" src={ASSETS.logo} />
          <div>
            <strong>Whistle</strong>
            <span>Verification Console</span>
          </div>
        </div>
        <nav aria-label="Verification filters">
          {filterItems.map((item) => (
            <button className={filter === item.id ? "active" : ""} key={item.id} onClick={() => setFilter(item.id)} type="button">
              <Filter size={16} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="verification-sidebar-note">
          <ShieldCheck size={20} />
          <strong>Intake mandate</strong>
          <span>Verify completeness, protect sensitive identity, and route only human-approved tickets.</span>
        </div>
      </aside>

      <main className="verification-main">
        <header className="verification-topbar">
          <div>
            <span className="system-label">Ticket Verification Team</span>
            <h1>Intake decision bench</h1>
            <p>Every complaint starts here before local, ministry, protected, or rejection-review ownership.</p>
          </div>
          <div className="topbar-actions">
            <img alt="Neutral civic service mark" src={ASSETS.emblem} />
            <button className="ghost-button" onClick={() => void loadQueue(selectedTicket?.id)} type="button">
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        <section className="verification-kpis" aria-label="Verification queue summary">
          <Metric icon={FileText} label="Awaiting review" value={stats.total} note="Primary verification/protected queue" />
          <Metric icon={ShieldAlert} label="Protected intake" value={stats.protectedCount} note="Hidden from local owners" tone="danger" />
          <Metric icon={TimerReset} label="SLA watch" value={stats.dueWatch} note="Due soon or breached" tone="warn" />
          <Metric icon={LockKeyhole} label="Evidence files" value={stats.evidenceItems} note="Files stored and scanned in local UAT" />
        </section>

        <RolePatternSummary pattern={roleConsolePatterns.verification} selectedTicket={selectedPatternTicket} />

        {notice ? (
          <div className="verification-notice">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} type="button">Dismiss</button>
          </div>
        ) : null}

        {error ? (
          <div className="verification-error">
            <AlertTriangle size={18} />
            <span>{error}. Make sure the ticket-spine API is running on {API_BASE}.</span>
          </div>
        ) : null}

        <section className="verification-workbench">
          <div className="queue-panel">
            <div className="panel-header">
              <div>
                <span>Queue</span>
                <h2>Complaints needing intake decision</h2>
              </div>
              <div className="search-shell">
                <Search size={16} />
                <input aria-label="Search queue" onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, district, category" value={query} />
              </div>
            </div>

            <div className="queue-list" aria-live="polite">
              {loading ? <div className="empty-state">Loading verification queue...</div> : null}
              {!loading && filteredTickets.length === 0 ? <div className="empty-state">No tickets match this filter.</div> : null}
              {filteredTickets.map((ticket) => (
                <button
                  className={`ticket-row ${selectedTicket?.id === ticket.id ? "active" : ""}`}
                  key={ticket.id}
                  onClick={() => setSelectedId(ticket.id)}
                  type="button"
                >
                  <div className="ticket-row-main">
                    <strong>{ticket.title}</strong>
                    <span>{ticket.id} · {categoryLabels[ticket.category]} · {ticket.location.district}</span>
                  </div>
                  <div className="ticket-row-meta">
                    <span className={`sla-chip ${slaTone(ticket)}`}>{formatDue(ticket.sla.dueAt)}</span>
                    {ticket.protected ? <span className="protected-chip">Protected</span> : null}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="detail-panel">
            {selectedTicket ? (
              <>
                <div className="detail-header">
                  <div>
                    <span>{selectedTicket.id}</span>
                    <h2>{selectedTicket.title}</h2>
                    <p>{selectedTicket.description}</p>
                  </div>
                  <span className={`status-badge ${selectedTicket.protected ? "protected" : ""}`}>
                    {selectedTicket.protected ? "Protected screening" : "Verification"}
                  </span>
                </div>

                <div className="decision-grid">
                  <InfoBlock icon={MapPin} label="Location" value={`${selectedTicket.location.area}, ${selectedTicket.location.district}`} note={selectedTicket.location.landmark ?? "No landmark"} />
                  <InfoBlock icon={Landmark} label="Department hint" value={selectedTicket.departmentHint ?? "Not selected"} note="Verifier can correct during routing" />
                  <InfoBlock icon={Clock3} label="SLA" value={formatDue(selectedTicket.sla.dueAt)} note={`Stage: ${selectedTicket.sla.stage}`} />
                  <InfoBlock icon={EyeOff} label="Citizen identity" value={selectedTicket.citizenPhoneMasked} note="Masked in intake view" />
                </div>

                <div className="verification-pattern-grid">
                  <SlaLadderCard pattern={roleConsolePatterns.verification} selectedTicket={selectedPatternTicket} />
                  <CitizenVisibleUpdateCard
                    message={selectedAgentRun?.recommendation.draftCitizenMessage}
                    pattern={roleConsolePatterns.verification}
                    selectedTicket={selectedPatternTicket}
                  />
                </div>

                <section className="inspection-panel">
                  <div className="panel-header compact">
                    <div>
                      <span>Verification checklist</span>
                      <h3>Data quality and guardrails</h3>
                    </div>
                  </div>
                  <div className="checklist">
                    <CheckItem label="Category and department hint reviewed" ok />
                    <CheckItem label="Issue location has district and area" ok={Boolean(selectedTicket.location.district && selectedTicket.location.area)} />
                    <CheckItem label="Evidence metadata captured" ok={selectedTicket.evidence.length > 0} />
                    <CheckItem label="Protected complaint guarded from local visibility" ok={!selectedTicket.protected || selectedTicket.primaryQueue.kind === "protected_review"} />
                  </div>
                </section>

                <section className="agent-panel">
                  <div className="panel-header compact">
                    <div>
                      <span>Recommend-only intelligence</span>
                      <h3>Reviewer packet</h3>
                    </div>
                    <button className="ghost-button mini" disabled={agentBusy} onClick={generateAgentRun} type="button">
                      <Sparkles size={15} />
                      {agentBusy ? "Generating..." : selectedAgentRun ? "Run again" : "Generate"}
                    </button>
                  </div>
                  {agentError ? (
                    <div className="agent-error">
                      <AlertTriangle size={16} />
                      <span>{agentError}</span>
                    </div>
                  ) : null}
                  {selectedAgentRun ? (
                    <AgentRecommendationCard run={selectedAgentRun} />
                  ) : (
                    <div className="agent-empty">
                      <Sparkles size={18} />
                      <div>
                        <strong>No recommendation generated yet</strong>
                        <span>Creates category, routing, duplicate, privacy, and draft-message advice for the human verifier.</span>
                      </div>
                    </div>
                  )}
                </section>

                <section className="evidence-panel">
                  <div className="panel-header compact">
                    <div>
                      <span>Governed evidence</span>
                      <h3>Role-scoped access and controls</h3>
                    </div>
                  </div>
                  {evidenceBusy ? <div className="empty-state tight">Loading governed evidence access...</div> : null}
                  {evidenceError ? (
                    <div className="agent-error">
                      <AlertTriangle size={16} />
                      <span>{evidenceError}</span>
                    </div>
                  ) : null}
                  {evidenceAccess[selectedTicket.id]?.items.length ? (
                    <div className="evidence-list">
                      {evidenceAccess[selectedTicket.id].items.map((item) => (
                        <div className="evidence-row" key={item.id}>
                          <FileText size={16} />
                          <div className="evidence-main">
                            <strong>{item.fileName ?? "Protected evidence"}</strong>
                            {item.mimeType && item.sizeBytes !== undefined && item.storageState ? <span>{item.mimeType} · {sizeLabel(item.sizeBytes)} · {item.storageState.replaceAll("_", " ")}</span> : null}
                            {item.controls ? (
                              <small>
                                {item.controls.classification} · {item.controls.encryptionContext} · {item.controls.metadataStripped ? "metadata stripped" : "strip pending"}
                              </small>
                            ) : null}
                            {item.watermark ? <small>Watermark: {item.watermark}</small> : null}
                            {item.deniedReason ? <small>{item.deniedReason}</small> : null}
                          </div>
                          <span className={`access-chip ${item.accessLevel}`}>{item.accessLevel}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    !evidenceBusy && <div className="empty-state tight">No evidence attached. You may request more information before routing.</div>
                  )}
                </section>

                <section className="action-panel">
                  <div className="panel-header compact">
                    <div>
                      <span>Decision</span>
                      <h3>Human-approved intake action</h3>
                    </div>
                  </div>
                  <div className="action-tabs">
                    <button className={actionMode === "route_local" ? "active" : ""} onClick={() => setActionMode("route_local")} type="button">
                      <Route size={15} /> Route
                    </button>
                    <button className={actionMode === "request_info" ? "active" : ""} onClick={() => setActionMode("request_info")} type="button">
                      <UserRoundCheck size={15} /> Request info
                    </button>
                    <button className={actionMode === "route_protected" ? "active" : ""} onClick={() => setActionMode("route_protected")} type="button">
                      <ShieldAlert size={15} /> Protect
                    </button>
                    <button className={actionMode === "reject" ? "active danger" : ""} onClick={() => setActionMode("reject")} type="button">
                      <XCircle size={15} /> Reject
                    </button>
                  </div>
                  <form className="decision-form" onSubmit={submitDecision}>
                    {actionMode === "route_local" ? (
                      <div className="form-grid two">
                        <label>
                          Owner
                          <input onChange={(event) => setForm({ ...form, ownerLabel: event.target.value })} required value={form.ownerLabel} />
                        </label>
                        <label>
                          Scope
                          <input onChange={(event) => setForm({ ...form, scopeValue: event.target.value })} required value={form.scopeValue} />
                        </label>
                      </div>
                    ) : null}
                    {actionMode === "request_info" ? (
                      <>
                        <label>
                          Missing fields
                          <input onChange={(event) => setForm({ ...form, missingFields: event.target.value })} required value={form.missingFields} />
                        </label>
                        <label>
                          Citizen message
                          <textarea onChange={(event) => setForm({ ...form, citizenMessage: event.target.value })} required rows={3} value={form.citizenMessage} />
                        </label>
                      </>
                    ) : null}
                    <label>
                      Decision reason
                      <textarea onChange={(event) => setForm({ ...form, reason: event.target.value })} required rows={3} value={form.reason} />
                    </label>
                    <button className="primary-button" disabled={decisionBusy} type="submit">
                      {decisionBusy ? "Saving..." : "Save decision"}
                      <ArrowRight size={16} />
                    </button>
                  </form>
                </section>
              </>
            ) : (
              <div className="empty-detail">
                <ShieldCheck size={36} />
                <h2>No ticket selected</h2>
                <p>Submit a citizen complaint or refresh the queue to begin verification.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note, tone = "neutral" }: { icon: typeof FileText; label: string; value: number; note: string; tone?: "neutral" | "warn" | "danger" }) {
  return (
    <div className={`verification-metric ${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value.toLocaleString("en-IN")}</strong>
      <small>{note}</small>
    </div>
  );
}

function InfoBlock({ icon: Icon, label, value, note }: { icon: typeof MapPin; label: string; value: string; note: string }) {
  return (
    <div className="info-block">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`check-item ${ok ? "ok" : "warn"}`}>
      {ok ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
      <span>{label}</span>
    </div>
  );
}

function AgentRecommendationCard({ run }: { run: AgentRecommendationRun }) {
  const recommendation = run.recommendation;
  return (
    <div className="agent-card">
      <div className="agent-summary">
        <div>
          <span className="agent-label">Recommendation</span>
          <strong>{agentActionLabels[recommendation.primaryAction]}</strong>
          <small>{recommendation.reviewerSummary}</small>
        </div>
        <div className="agent-score">
          <strong>{Math.round(recommendation.confidence * 100)}%</strong>
          <span>confidence</span>
        </div>
      </div>

      <div className="agent-chip-grid">
        <span>{categoryLabels[recommendation.suggestedCategory]}</span>
        <span>{recommendation.suggestedDepartment}</span>
        <span>{recommendation.evidenceAssessment.usefulCount} evidence item(s)</span>
        <span>{recommendation.protectedSignal.flagged ? "Protected signal" : "No protected signal"}</span>
      </div>

      {recommendation.recommendedOwner ? (
        <div className="agent-callout">
          <Route size={16} />
          <span>
            Suggested owner: <strong>{recommendation.recommendedOwner.ownerLabel}</strong> · {recommendation.recommendedOwner.scopeValue}
          </span>
        </div>
      ) : null}

      {recommendation.missingFields.length ? (
        <div className="agent-callout warn">
          <AlertTriangle size={16} />
          <span>Missing: {recommendation.missingFields.join(", ")}</span>
        </div>
      ) : null}

      <div className="agent-two-col">
        <div>
          <span className="agent-label">Reasons</span>
          <ul>
            {recommendation.reasons.slice(0, 4).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
        <div>
          <span className="agent-label">Draft citizen message</span>
          <p>{recommendation.draftCitizenMessage}</p>
        </div>
      </div>

      {recommendation.duplicateCandidates.length ? (
        <div className="duplicate-list">
          <span className="agent-label">Possible duplicate cluster</span>
          {recommendation.duplicateCandidates.map((candidate) => (
            <span key={candidate.ticketId}>
              {candidate.ticketId} · {candidate.district} · {candidate.similarityReason}
            </span>
          ))}
        </div>
      ) : null}

      <div className="agent-guardrail">
        <ShieldCheck size={16} />
        <span>{recommendation.nonMutationGuarantee}</span>
      </div>
    </div>
  );
}

export default VerificationConsole;
