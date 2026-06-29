import { DevTicketRepository } from "./devRepository.js";
import type { LifecyclePolicy } from "./lifecycle.js";
import { PostgresTicketRepository } from "./postgresRepository.js";
import type { EvidenceObjectStore } from "../evidence/objectStore.js";
import type { NotificationDeliveryProvider } from "../notifications/provider.js";
import type {
  AgentRecommendationRun,
  AuditEvent,
  CitizenDisputeCommand,
  CitizenUpdateCommand,
  CreateTicketCommand,
  DashboardBriefRun,
  DashboardExplanation,
  DashboardFilter,
  EvidenceAccessQuery,
  EvidenceAccessResult,
  EvidenceScanJobCommand,
  EvidenceScanJobResult,
  EvidenceUploadCompletionCommand,
  EvidenceUploadCommand,
  EvidenceUploadSession,
  FieldExecutionCommand,
  IdempotencyRecord,
  NotificationIntent,
  NotificationJobCommand,
  NotificationJobResult,
  RejectionReviewDecisionCommand,
  RoleDashboard,
  SlaJobCommand,
  SlaJobResult,
  TicketRecord,
  VerificationDecisionCommand,
} from "./types.js";

export type TicketListOptions = {
  limit?: number;
  offset?: number;
  q?: string;
  cursor?: string;
};

export type CursorListOptions = {
  limit?: number;
  offset?: number;
  cursor?: string;
};

export type TicketRepository = {
  readonly mode: string;
  healthCheck(): Promise<void>;
  createTicket(command: CreateTicketCommand, policy?: LifecyclePolicy): Promise<TicketRecord>;
  getTicket(ticketId: string): Promise<TicketRecord | null>;
  getIdempotencyRecord(scope: string, key: string): Promise<IdempotencyRecord | null>;
  reserveIdempotencyRecord(record: Omit<IdempotencyRecord, "responseTicketId">): Promise<{ record: IdempotencyRecord; inserted: boolean }>;
  finalizeIdempotencyRecord(record: IdempotencyRecord & { responseTicketId: string }): Promise<IdempotencyRecord>;
  listTickets(): Promise<TicketRecord[]>;
  listCitizenTickets(citizenPhoneHash: string, options?: TicketListOptions): Promise<TicketRecord[]>;
  listVerificationQueue(options?: TicketListOptions): Promise<TicketRecord[]>;
  getRoleDashboard(filter: DashboardFilter): Promise<RoleDashboard>;
  getDashboardExplanation(filter: DashboardFilter): Promise<DashboardExplanation>;
  submitCitizenUpdate(ticketId: string, command: CitizenUpdateCommand, policy?: LifecyclePolicy): Promise<TicketRecord | null>;
  applyFieldExecution(ticketId: string, command: FieldExecutionCommand, policy?: LifecyclePolicy): Promise<TicketRecord | null>;
  submitCitizenDispute(ticketId: string, command: CitizenDisputeCommand, policy?: LifecyclePolicy): Promise<TicketRecord | null>;
  reviewRejection(ticketId: string, command: RejectionReviewDecisionCommand, policy?: LifecyclePolicy): Promise<TicketRecord | null>;
  createEvidenceUploadSession(ticketId: string, command: EvidenceUploadCommand): Promise<EvidenceUploadSession | null>;
  completeEvidenceUpload(ticketId: string, evidenceId: string, command: EvidenceUploadCompletionCommand): Promise<TicketRecord | null>;
  listEvidenceAccess(ticketId: string, query: EvidenceAccessQuery): Promise<EvidenceAccessResult | null>;
  runEvidenceScanJob(command: EvidenceScanJobCommand, objectStore?: EvidenceObjectStore): Promise<EvidenceScanJobResult>;
  listNotifications(ticketId?: string, options?: CursorListOptions): Promise<NotificationIntent[]>;
  runNotificationJob(command: NotificationJobCommand, provider?: NotificationDeliveryProvider): Promise<NotificationJobResult>;
  recordAgentRun(run: AgentRecommendationRun): Promise<AgentRecommendationRun>;
  listAgentRuns(ticketId?: string): Promise<AgentRecommendationRun[]>;
  recordDashboardBriefRun(run: DashboardBriefRun): Promise<DashboardBriefRun>;
  listDashboardBriefRuns(role?: DashboardBriefRun["role"]): Promise<DashboardBriefRun[]>;
  decide(ticketId: string, command: VerificationDecisionCommand, policy?: LifecyclePolicy): Promise<TicketRecord | null>;
  runSlaEscalationJob(command: SlaJobCommand, policy?: LifecyclePolicy): Promise<SlaJobResult>;
  listAudit(ticketId?: string, options?: CursorListOptions): Promise<AuditEvent[]>;
  recordAuditEvents(events: AuditEvent[]): Promise<void>;
  close(): Promise<void>;
};

export function createTicketRepository(): TicketRepository {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return new PostgresTicketRepository(databaseUrl);
  return new DevTicketRepository();
}
