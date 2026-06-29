import type { PublicAssetPolicy } from "../config/assetPolicy.js";

export type Language = "en" | "ta";

export type CategoryId =
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

export type TicketStatus =
  | "submitted"
  | "needs_info"
  | "rejected"
  | "verified"
  | "routed_local"
  | "escalated_ministry"
  | "escalated_cm_cell"
  | "reopened"
  | "resolved"
  | "closed";

export type QueueKind =
  | "citizen"
  | "verification"
  | "protected_review"
  | "rejection_review"
  | "local"
  | "mla"
  | "ministry"
  | "cm_cell";

export type SlaStage = "verification" | "local" | "ministry" | "cm_cell" | "rejection_review";

export type SlaState = "on_track" | "due_soon" | "breached" | "paused" | "resolved";

export type EvidenceSecurityControls = {
  classification: "standard" | "protected";
  retentionPolicy: "standard_180_days" | "protected_365_days";
  retentionUntil: string | null;
  encryptionContext: "evidence:standard" | "evidence:protected";
  metadataStripped: boolean;
  downloadAllowed: boolean;
  watermarkRequired: boolean;
};

export type EvidenceMetadata = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageState: "metadata_only" | "upload_pending" | "scan_pending" | "available" | "blocked";
  storageKey?: string;
  checksum?: string;
  controls: EvidenceSecurityControls;
};

export type TicketLocation = {
  district: string;
  area: string;
  address?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
};

export type QueueAssignment = {
  kind: QueueKind;
  ownerKey: string;
  ownerLabel: string;
  scope: {
    jurisdiction: "state" | "district" | "constituency" | "ward" | "ministry" | "protected";
    value: string;
  };
};

export type SlaClock = {
  stage: SlaStage;
  state: SlaState;
  dueAt: string | null;
  paused: boolean;
};

export type TicketEvent = {
  id: string;
  ticketId: string;
  type:
    | "ticket_submitted"
    | "phone_verified"
    | "verification_started"
    | "protected_screening_started"
    | "additional_info_requested"
    | "citizen_update_submitted"
    | "ticket_rejected"
    | "rejection_review_started"
    | "rejection_upheld"
    | "ticket_routed"
    | "ticket_escalated"
    | "field_visit_scheduled"
    | "field_report_added"
    | "ticket_transferred"
    | "ticket_resolved"
    | "ticket_reopened"
    | "audit_note";
  actor: string;
  message: string;
  createdAt: string;
  visibility: "citizen" | "government" | "protected";
};

export type AuditEvent = {
  id: string;
  ticketId?: string;
  actor: string;
  actorRole: string;
  action: string;
  entityType: "ticket" | "evidence" | "queue" | "sla" | "access" | "notification" | "agent";
  entityId: string;
  reason?: string;
  correlationId: string;
  sensitive: boolean;
  createdAt: string;
  previousHash?: string;
  eventHash?: string;
  chainSequence?: number;
};

export type TicketRecord = {
  id: string;
  category: CategoryId;
  language: Language;
  title: string;
  description: string;
  reference?: string;
  departmentHint?: string;
  status: TicketStatus;
  protected: boolean;
  citizenPhoneMasked: string;
  citizenPhoneHash: string;
  location: TicketLocation;
  evidence: EvidenceMetadata[];
  primaryQueue: QueueAssignment;
  secondaryQueues: QueueAssignment[];
  sla: SlaClock;
  citizenTimeline: TicketEvent[];
  governmentEvents: TicketEvent[];
  createdAt: string;
  updatedAt: string;
};

export type CreateTicketCommand = {
  category: CategoryId;
  language: Language;
  title: string;
  description: string;
  phone: string;
  phoneVerificationToken?: string;
  reference?: string;
  departmentHint?: string;
  location: TicketLocation;
  evidence?: Array<Pick<EvidenceMetadata, "fileName" | "mimeType" | "sizeBytes">>;
};

export type VerificationDecisionAuditContext = {
  actorRole?: Extract<GovRole, "verification">;
  accessDecision?: string;
};

export type VerificationDecisionCommand = VerificationDecisionAuditContext &
  (
    | {
      action: "request_info";
      actor: string;
      reason: string;
      missingFields: string[];
      citizenMessage: string;
    }
  | {
      action: "reject";
      actor: string;
      reason: string;
    }
  | {
      action: "route_local";
      actor: string;
      reason: string;
      ownerKey: string;
      ownerLabel: string;
      scopeValue: string;
    }
  | {
      action: "route_protected";
      actor: string;
      reason: string;
    }
  );

export type RejectionReviewDecisionCommand =
  | {
      action: "uphold_rejection";
      actor: string;
      reason: string;
      closureNote: string;
    }
  | {
      action: "request_info";
      actor: string;
      reason: string;
      missingFields: string[];
      citizenMessage: string;
    }
  | {
      action: "overturn_and_route";
      actor: string;
      reason: string;
      ownerKey: string;
      ownerLabel: string;
      scopeValue: string;
    };

export type CitizenUpdateCommand = {
  actor?: string;
  details: string;
  address?: string;
  evidence?: Array<Pick<EvidenceMetadata, "fileName" | "mimeType" | "sizeBytes">>;
};

export type FieldEvidenceCommand = Pick<EvidenceMetadata, "fileName" | "mimeType" | "sizeBytes"> & {
  label?: "before" | "after" | "field_report" | "closure";
};

export type ClosureChecklist = {
  fieldVisitCompleted: boolean;
  evidenceAttached: boolean;
  citizenImpactChecked: boolean;
  safetyRiskClosed: boolean;
};

export type FieldExecutionCommand =
  | {
      action: "schedule_visit";
      actor: string;
      fieldOfficer: string;
      visitAt: string;
      note: string;
    }
  | {
      action: "add_field_report";
      actor: string;
      fieldOfficer: string;
      note: string;
      evidence?: FieldEvidenceCommand[];
    }
  | {
      action: "transfer";
      actor: string;
      reason: string;
      ownerKey: string;
      ownerLabel: string;
      scopeKind: QueueAssignment["scope"]["jurisdiction"];
      scopeValue: string;
      queueKind: Extract<QueueAssignment["kind"], "local" | "mla" | "ministry">;
    }
  | {
      action: "resolve";
      actor: string;
      resolutionNote: string;
      checklist: ClosureChecklist;
      evidence?: FieldEvidenceCommand[];
    };

export type CitizenDisputeCommand = {
  actor?: string;
  reason: string;
  evidence?: FieldEvidenceCommand[];
};

export type EscalationCommand = {
  actor: string;
  reason: string;
  target: "ministry" | "cm_cell";
  ownerKey?: string;
  ownerLabel?: string;
  scopeValue?: string;
};

export type SlaJobCommand = {
  actor?: string;
  now?: string;
  limit?: number;
};

export type SlaJobAction = {
  ticketId: string;
  title: string;
  previousStage: SlaStage;
  previousQueue: QueueAssignment["kind"];
  nextStage: SlaStage;
  nextQueue: QueueAssignment["kind"];
  outcome: "escalated_to_ministry" | "escalated_to_cm_cell" | "marked_breached";
  reason: string;
};

export type SlaJobResult = {
  checkedAt: string;
  batchLimit: number;
  dueCount: number;
  hasMore: boolean;
  escalatedCount: number;
  breachedCount: number;
  skippedCount: number;
  actions: SlaJobAction[];
};

export type IdempotencyRecord = {
  scope: string;
  key: string;
  requestHash: string;
  action: "ticket.create" | "verification.decision" | "citizen.update" | "citizen.dispute_reopen";
  responseTicketId?: string;
  createdAt: string;
};

export type GovRole = "cm_cell" | "minister" | "department_officer" | "mla" | "councillor" | "verification" | "admin";

export type EvidenceUploadCommand = Pick<EvidenceMetadata, "fileName" | "mimeType" | "sizeBytes"> & {
  actor?: string;
};

export type EvidenceUploadCompletionCommand = Pick<EvidenceMetadata, "mimeType" | "sizeBytes"> & {
  actor?: string;
  checksum: string;
};

export type EvidenceUploadSession = {
  evidence: EvidenceMetadata;
  uploadMethod: "PUT";
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
};

export type EvidenceScanJobCommand = {
  actor?: string;
  now?: string;
  limit?: number;
};

export type EvidenceScanAction = {
  ticketId: string;
  evidenceId: string;
  fileName: string;
  fromState: EvidenceMetadata["storageState"];
  toState: EvidenceMetadata["storageState"];
  reason: string;
};

export type EvidenceScanJobResult = {
  checkedAt: string;
  batchLimit: number;
  checkedTicketCount: number;
  hasMore: boolean;
  scannedCount: number;
  availableCount: number;
  blockedCount: number;
  skippedCount: number;
  actions: EvidenceScanAction[];
};

export type EvidenceAccessRole = GovRole | "citizen";

export type EvidenceAccessQuery = {
  role: EvidenceAccessRole;
  actor?: string;
  accessReason?: string;
};

export type EvidenceAccessItem = Pick<EvidenceMetadata, "id"> & {
  accessLevel: "hidden" | "metadata" | "preview";
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  storageState?: EvidenceMetadata["storageState"];
  controls?: EvidenceSecurityControls;
  previewUrl?: string;
  expiresAt?: string;
  watermark?: string;
  deniedReason?: string;
};

export type EvidenceAccessResult = {
  ticketId: string;
  role: EvidenceAccessRole;
  protected: boolean;
  items: EvidenceAccessItem[];
};

export type NotificationChannel = "in_app" | "sms" | "whatsapp";

export type NotificationStatus = "queued" | "sent" | "failed" | "suppressed";

export type NotificationIntent = {
  id: string;
  ticketId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  topic:
    | "ticket_submitted"
    | "verification_started"
    | "additional_info_requested"
    | "citizen_update_submitted"
    | "ticket_rejected"
    | "rejection_upheld"
    | "ticket_routed"
    | "ticket_escalated"
    | "field_visit_scheduled"
    | "field_report_added"
    | "ticket_transferred"
    | "ticket_resolved"
    | "ticket_reopened"
    | "sla_breached";
  language: Language;
  recipientMasked: string;
  safeMessage: string;
  sensitive: boolean;
  provider?: string;
  providerMessageId?: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type NotificationJobCommand = {
  actor?: string;
  now?: string;
  limit?: number;
};

export type NotificationJobResult = {
  checkedAt: string;
  batchLimit: number;
  queuedCount: number;
  hasMore: boolean;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  actions: Array<{
    notificationId: string;
    ticketId: string;
    channel: NotificationChannel;
    status: NotificationStatus;
    providerMessageId?: string;
    reason: string;
  }>;
};

export type DashboardFilter = {
  role: GovRole;
  ministry?: string;
  district?: string;
  constituency?: string;
  ward?: string;
  queue?: QueueKind | "all";
  primaryQueue?: QueueKind | "all";
  q?: string;
  ticketLimit?: number;
  ticketOffset?: number;
  ticketCursor?: string;
};

export type ResultWindow = {
  limit: number;
  offset: number;
  cursor: string | null;
  total: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor: string | null;
};

export type DashboardReadModel = {
  source: "ticket_graph" | "postgres_sql_projection";
  aggregateStrategy: "in_memory_ticket_graph" | "bounded_sql_aggregates";
  ticketRowsHydrated: number;
  scopedTicketTotal: number;
};

export type DashboardKpis = {
  openTickets: number;
  slaBreached: number;
  dueToday: number;
  dueIn48h: number;
  escalatedToCmCell: number;
  protectedCount: number;
  rejectionReview: number;
  averageAgeHours: number;
};

export type DashboardMetricRow = {
  key: string;
  label: string;
  openTickets: number;
  slaBreached: number;
  dueIn48h: number;
  protectedCount: number;
};

export type DashboardTicketSummary = {
  id: string;
  title: string;
  category: CategoryId;
  status: TicketStatus;
  protected: boolean;
  district: string;
  area: string;
  ministry: string;
  primaryQueue: QueueAssignment;
  secondaryQueues: QueueAssignment[];
  sla: SlaClock;
  citizenIdentityVisible: boolean;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RoleDashboard = {
  role: GovRole;
  scope: DashboardFilter;
  readModel: DashboardReadModel;
  kpis: DashboardKpis;
  byDistrict: DashboardMetricRow[];
  byMinistry: DashboardMetricRow[];
  ticketWindow: ResultWindow;
  tickets: DashboardTicketSummary[];
};

export type DashboardKpiExplanation = {
  key: keyof DashboardKpis;
  label: string;
  value: number;
  definition: string;
  sourceFields: string[];
};

export type DashboardExplanation = {
  role: GovRole;
  scope: DashboardFilter;
  generatedAt: string;
  source: {
    system: "whistle-ticket-spine";
    inputRecords: number;
    scopedRecords: number;
    readModel: "role-dashboard";
    projection: DashboardReadModel;
    sourceTables: string[];
  };
  visibility: {
    protectedPolicy: string;
    adminPolicy: string;
    roleScopeRule: string;
    hiddenProtectedRecords: number | null;
    hiddenProtectedRecordsRedacted: boolean;
    hiddenProtectedRecordPolicy: string;
  };
  appliedFilters: Array<{ key: keyof DashboardFilter; value: string; rule: string }>;
  kpis: DashboardKpiExplanation[];
  groupings: Array<{ key: "byDistrict" | "byMinistry"; definition: string; sourceFields: string[]; rowCount: number }>;
  privacyGuarantees: string[];
};

export type AgentRecommendationAction = "route_local" | "request_info" | "route_protected" | "reject_candidate";

export type AgentDuplicateCandidate = {
  ticketId: string;
  district: string;
  category: CategoryId;
  similarityReason: string;
};

export type IntakeAgentRecommendation = {
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

export type AgentRecommendationRun = {
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

export type DashboardBriefRiskLevel = "low" | "watch" | "elevated" | "critical";

export type DashboardBriefFocusArea = {
  label: string;
  value: string;
  detail: string;
  tone: DashboardBriefRiskLevel;
};

export type DashboardBriefAction = {
  label: string;
  owner: string;
  reason: string;
  due: string;
  readOnly: true;
};

export type DashboardBriefWatchItem = {
  ticketId: string;
  title: string;
  district: string;
  ministry: string;
  queue: QueueAssignment["kind"];
  slaState: SlaState;
  dueAt: string | null;
  reason: string;
  protected: boolean;
};

export type DashboardBrief = {
  role: Extract<GovRole, "cm_cell" | "minister">;
  scope: DashboardFilter;
  generatedAt: string;
  headline: string;
  summary: string;
  riskLevel: DashboardBriefRiskLevel;
  kpis: Pick<DashboardKpis, "openTickets" | "slaBreached" | "dueToday" | "dueIn48h" | "escalatedToCmCell" | "protectedCount" | "averageAgeHours">;
  focusAreas: DashboardBriefFocusArea[];
  recommendedActions: DashboardBriefAction[];
  watchlist: DashboardBriefWatchItem[];
  nonMutationGuarantee: string;
};

export type DashboardBriefRun = {
  id: string;
  actor: string;
  purpose: "dashboard_sla_brief";
  role: Extract<GovRole, "cm_cell" | "minister">;
  scope: DashboardFilter;
  promptVersion: string;
  modelVersion: string;
  inputHash: string;
  brief: DashboardBrief;
  createdAt: string;
};

export type PublicTrendMetrics = {
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  slaBreached: number;
  dueIn48h: number;
  escalatedToCmCell: number;
};

export type PublicMetricRow = PublicTrendMetrics & {
  key: string;
  label: string;
};

export type PublicInsights = {
  enabled: true;
  generatedAt: string;
  assetPolicy: PublicAssetPolicy;
  privacy: {
    threshold: number;
    publicationDelayHours: number;
    publicVisibleTickets: number;
    withheldRecentTickets: number;
    protectedCount: number;
    withheldSmallCellRows: number;
    withheldSmallCellTickets: number;
    excludedFields: string[];
    protectedPolicy: string;
  };
  trends: {
    month: PublicTrendMetrics;
    allTime: PublicTrendMetrics;
  };
  openIssues: {
    byDistrict: PublicMetricRow[];
    byMinistry: PublicMetricRow[];
    byCategory: PublicMetricRow[];
  };
};
