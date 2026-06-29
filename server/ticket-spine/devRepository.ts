import {
  applyCitizenUpdate,
  citizenUpdateConflict,
  applyCitizenDispute,
  applyEscalation,
  applyEvidenceScan,
  applyFieldExecution,
  applyRejectionReviewDecision,
  applySlaJobTransition,
  applyVerificationDecision,
  completeEvidenceUpload as completeEvidenceUploadMutation,
  createEvidenceAccessResult,
  createEvidenceUploadSession as createEvidenceUploadSessionMutation,
  createTicketRecord,
  demoTicketCommands,
  internalId,
} from "./lifecycle.js";
import { AUDIT_GENESIS_HASH, chainAuditEvent } from "../audit/hashChain.js";
import { currentCorrelationId } from "../observability/correlation.js";
import { createDashboardExplanation, createRoleDashboard } from "./dashboard.js";
import { decodeTicketCursor, isAfterAuditCursor, isAfterCitizenCursor, isAfterNotificationCursor, isAfterVerificationCursor } from "./pagination.js";
import type { EvidenceScanVerdict, LifecyclePolicy, TicketMutation } from "./lifecycle.js";
import type { CursorListOptions, TicketListOptions } from "./repository.js";
import type { EvidenceObjectStore } from "../evidence/objectStore.js";
import { MockNotificationDeliveryProvider, type NotificationDeliveryProvider } from "../notifications/provider.js";
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
  EvidenceScanAction,
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
  SlaJobAction,
  SlaJobCommand,
  SlaJobResult,
  TicketRecord,
  VerificationDecisionCommand,
} from "./types.js";

function normaliseListQuery(value: string) {
  return value.trim().toLowerCase();
}

function sliceList<T>(items: T[], options?: CursorListOptions) {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? items.length;
  return items.slice(offset, offset + limit);
}

export class DevTicketRepository {
  readonly mode = "mvp-dev-memory";

  private readonly tickets = new Map<string, TicketRecord>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly notificationOutbox: NotificationIntent[] = [];
  private readonly agentRuns: AgentRecommendationRun[] = [];
  private readonly dashboardBriefRuns: DashboardBriefRun[] = [];
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>();

  constructor() {
    if (process.env.WHISTLE_SEED_DEMO !== "false") this.seedDemoTickets();
  }

  async healthCheck() {
    return;
  }

  async createTicket(command: CreateTicketCommand, policy?: LifecyclePolicy) {
    const mutation = createTicketRecord(command, policy);
    this.tickets.set(mutation.ticket.id, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    this.notificationOutbox.push(...(mutation.notificationIntents ?? []));
    return mutation.ticket;
  }

  async getTicket(ticketId: string) {
    return this.tickets.get(ticketId) ?? null;
  }

  async getIdempotencyRecord(scope: string, key: string) {
    return this.idempotencyRecords.get(`${scope}:${key}`) ?? null;
  }

  async reserveIdempotencyRecord(record: Omit<IdempotencyRecord, "responseTicketId">) {
    const recordKey = `${record.scope}:${record.key}`;
    const existing = this.idempotencyRecords.get(recordKey);
    if (existing) return { record: existing, inserted: false };
    this.idempotencyRecords.set(recordKey, record);
    return { record, inserted: true };
  }

  async finalizeIdempotencyRecord(record: IdempotencyRecord & { responseTicketId: string }) {
    const recordKey = `${record.scope}:${record.key}`;
    const existing = this.idempotencyRecords.get(recordKey);
    if (!existing) throw new Error(`Idempotency record ${record.scope}:${record.key} was not reserved`);
    if (existing.action !== record.action || existing.requestHash !== record.requestHash) {
      throw new Error(`Idempotency record ${record.scope}:${record.key} does not match the reserved request`);
    }
    const completed = { ...existing, responseTicketId: record.responseTicketId };
    this.idempotencyRecords.set(recordKey, completed);
    return completed;
  }

  async listTickets() {
    return [...this.tickets.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listCitizenTickets(citizenPhoneHash: string, options?: TicketListOptions) {
    const cursor = decodeTicketCursor(options?.cursor, "citizen-updated-desc");
    return sliceList(
      [...this.tickets.values()]
        .filter((ticket) => ticket.citizenPhoneHash === citizenPhoneHash)
        .sort((a, b) => {
          const updatedDelta = b.updatedAt.localeCompare(a.updatedAt);
          if (updatedDelta !== 0) return updatedDelta;
          return b.id.localeCompare(a.id);
        })
        .filter((ticket) => !cursor || isAfterCitizenCursor(ticket, cursor)),
      options,
    );
  }

  async listVerificationQueue(options?: TicketListOptions) {
    const query = options?.q ? normaliseListQuery(options.q) : null;
    const cursor = decodeTicketCursor(options?.cursor, "verification-created-asc");
    return sliceList(
      [...this.tickets.values()]
        .filter((ticket) => ["verification", "protected_review"].includes(ticket.primaryQueue.kind))
        .filter((ticket) => ["submitted", "needs_info"].includes(ticket.status))
        .filter((ticket) => {
          if (!query) return true;
          return [ticket.id, ticket.title, ticket.category, ticket.status, ticket.location.district, ticket.location.area, ticket.primaryQueue.ownerLabel]
            .join(" ")
            .toLowerCase()
            .includes(query);
        })
        .sort((a, b) => {
          const createdDelta = a.createdAt.localeCompare(b.createdAt);
          if (createdDelta !== 0) return createdDelta;
          return a.id.localeCompare(b.id);
        })
        .filter((ticket) => !cursor || isAfterVerificationCursor(ticket, cursor)),
      options,
    );
  }

  async getRoleDashboard(filter: DashboardFilter): Promise<RoleDashboard> {
    return createRoleDashboard(await this.listTickets(), filter);
  }

  async getDashboardExplanation(filter: DashboardFilter): Promise<DashboardExplanation> {
    return createDashboardExplanation(await this.listTickets(), filter);
  }

  async decide(ticketId: string, command: VerificationDecisionCommand, policy?: LifecyclePolicy) {
    const existing = this.tickets.get(ticketId);
    if (!existing) return null;

    const mutation = applyVerificationDecision(existing, command, policy);
    this.tickets.set(ticketId, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    this.notificationOutbox.push(...(mutation.notificationIntents ?? []));
    return mutation.ticket;
  }

  async submitCitizenUpdate(ticketId: string, command: CitizenUpdateCommand, policy?: LifecyclePolicy) {
    const existing = this.tickets.get(ticketId);
    if (!existing) return null;
    if (citizenUpdateConflict(existing)) return null;

    const mutation = applyCitizenUpdate(existing, command, policy);
    this.tickets.set(ticketId, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    this.notificationOutbox.push(...(mutation.notificationIntents ?? []));
    return mutation.ticket;
  }

  async applyFieldExecution(ticketId: string, command: FieldExecutionCommand, policy?: LifecyclePolicy) {
    const existing = this.tickets.get(ticketId);
    if (!existing) return null;

    const mutation = applyFieldExecution(existing, command, policy);
    this.tickets.set(ticketId, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    this.notificationOutbox.push(...(mutation.notificationIntents ?? []));
    return mutation.ticket;
  }

  async submitCitizenDispute(ticketId: string, command: CitizenDisputeCommand, policy?: LifecyclePolicy) {
    const existing = this.tickets.get(ticketId);
    if (!existing) return null;

    const mutation = applyCitizenDispute(existing, command, policy);
    this.tickets.set(ticketId, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    this.notificationOutbox.push(...(mutation.notificationIntents ?? []));
    return mutation.ticket;
  }

  async reviewRejection(ticketId: string, command: RejectionReviewDecisionCommand, policy?: LifecyclePolicy) {
    const existing = this.tickets.get(ticketId);
    if (!existing) return null;

    const mutation = applyRejectionReviewDecision(existing, command, policy);
    this.tickets.set(ticketId, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    this.notificationOutbox.push(...(mutation.notificationIntents ?? []));
    return mutation.ticket;
  }

  async createEvidenceUploadSession(ticketId: string, command: EvidenceUploadCommand): Promise<EvidenceUploadSession | null> {
    const existing = this.tickets.get(ticketId);
    if (!existing) return null;

    const { mutation, session } = createEvidenceUploadSessionMutation(existing, command);
    this.tickets.set(ticketId, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    return session;
  }

  async completeEvidenceUpload(ticketId: string, evidenceId: string, command: EvidenceUploadCompletionCommand): Promise<TicketRecord | null> {
    const existing = this.tickets.get(ticketId);
    if (!existing) return null;

    const mutation = completeEvidenceUploadMutation(existing, evidenceId, command);
    if (!mutation) return null;
    this.tickets.set(ticketId, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    return mutation.ticket;
  }

  async listEvidenceAccess(ticketId: string, query: EvidenceAccessQuery): Promise<EvidenceAccessResult | null> {
    const existing = this.tickets.get(ticketId);
    if (!existing) return null;

    const { result, auditEvents } = createEvidenceAccessResult(existing, query);
    this.appendAuditEvents(auditEvents);
    return result;
  }

  async runEvidenceScanJob(command: EvidenceScanJobCommand, objectStore?: EvidenceObjectStore): Promise<EvidenceScanJobResult> {
    const checkedAt = command.now ?? new Date().toISOString();
    const batchLimit = command.limit ?? 100;
    const pendingTickets = [...this.tickets.values()]
      .filter((ticket) => ticket.evidence.some((evidence) => evidence.storageState === "scan_pending"))
      .sort((a, b) => a.id.localeCompare(b.id));
    const batchTickets = pendingTickets.slice(0, batchLimit);
    const actions: EvidenceScanAction[] = [];
    let skippedCount = 0;

    for (const ticket of batchTickets) {
      const candidates = ticket.evidence.filter((evidence) => evidence.storageState === "scan_pending");
      const verdicts = new Map<string, EvidenceScanVerdict>();
      if (objectStore) {
        for (const evidence of candidates) {
          const result = await objectStore.scanObject(ticket, evidence, command.actor ?? "evidence:scanner");
          if (result.status === "missing") {
            skippedCount += 1;
            continue;
          }
          verdicts.set(evidence.id, {
            status: result.status,
            reason: result.reason,
            checksum: result.checksum,
            metadataStripped: result.metadataStripped,
          });
        }
      }
      if (objectStore && !verdicts.size) continue;
      const scan = applyEvidenceScan(ticket, command.actor ?? "evidence:scanner", objectStore ? verdicts : undefined);
      if (!scan) {
        skippedCount += 1;
        continue;
      }
      this.tickets.set(ticket.id, scan.mutation.ticket);
      this.appendAuditEvents(scan.mutation.auditEvents);
      actions.push(...scan.actions);
    }

    return {
      checkedAt,
      batchLimit,
      checkedTicketCount: batchTickets.length,
      hasMore: pendingTickets.length > batchLimit,
      scannedCount: actions.length,
      availableCount: actions.filter((action) => action.toState === "available").length,
      blockedCount: actions.filter((action) => action.toState === "blocked").length,
      skippedCount,
      actions,
    };
  }

  async runSlaEscalationJob(command: SlaJobCommand, policy?: LifecyclePolicy): Promise<SlaJobResult> {
    const checkedAt = command.now ?? new Date().toISOString();
    const checkedDate = new Date(checkedAt);
    const batchLimit = command.limit ?? 100;
    const dueTickets = [...this.tickets.values()]
      .filter((ticket) => isSlaDue(ticket, checkedDate))
      .sort((a, b) => {
        const dueDelta = (a.sla.dueAt ?? "").localeCompare(b.sla.dueAt ?? "");
        if (dueDelta !== 0) return dueDelta;
        const createdDelta = a.createdAt.localeCompare(b.createdAt);
        if (createdDelta !== 0) return createdDelta;
        return a.id.localeCompare(b.id);
      });
    const batchTickets = dueTickets.slice(0, batchLimit);
    const actions: SlaJobAction[] = [];
    let skippedCount = 0;

    for (const ticket of batchTickets) {
      const transition = applySlaJobTransition(ticket, command.actor ?? "sla:worker", policy);
      if (!transition) {
        skippedCount += 1;
        continue;
      }
      this.tickets.set(ticket.id, transition.mutation.ticket);
      this.appendAuditEvents(transition.mutation.auditEvents);
      this.notificationOutbox.push(...(transition.mutation.notificationIntents ?? []));
      actions.push(transition.action);
    }

    return {
      checkedAt,
      batchLimit,
      dueCount: batchTickets.length,
      hasMore: dueTickets.length > batchLimit,
      escalatedCount: actions.filter((action) => action.outcome.startsWith("escalated")).length,
      breachedCount: actions.filter((action) => action.outcome === "marked_breached").length,
      skippedCount,
      actions,
    };
  }

  async listAudit(ticketId?: string, options?: CursorListOptions) {
    const cursor = decodeTicketCursor(options?.cursor, "audit-chain-desc");
    return sliceList(
      (ticketId ? this.auditEvents.filter((event) => event.ticketId === ticketId) : [...this.auditEvents])
        .sort((a, b) => {
          const sequenceDelta = (b.chainSequence ?? 0) - (a.chainSequence ?? 0);
          if (sequenceDelta !== 0) return sequenceDelta;
          return b.id.localeCompare(a.id);
        })
        .filter((event) => !cursor || isAfterAuditCursor(event, cursor)),
      options,
    );
  }

  async recordAuditEvents(events: AuditEvent[]) {
    this.appendAuditEvents(events);
  }

  async listNotifications(ticketId?: string, options?: CursorListOptions) {
    const cursor = decodeTicketCursor(options?.cursor, "notification-created-desc");
    return sliceList(
      this.notificationOutbox
        .filter((notification) => !ticketId || notification.ticketId === ticketId)
        .sort((a, b) => {
          const createdDelta = b.createdAt.localeCompare(a.createdAt);
          if (createdDelta !== 0) return createdDelta;
          return b.id.localeCompare(a.id);
        })
        .filter((notification) => !cursor || isAfterNotificationCursor(notification, cursor)),
      options,
    );
  }

  async runNotificationJob(command: NotificationJobCommand, provider: NotificationDeliveryProvider = new MockNotificationDeliveryProvider()): Promise<NotificationJobResult> {
    const checkedAt = command.now ?? new Date().toISOString();
    const batchLimit = command.limit ?? 100;
    const queued = this.notificationOutbox
      .filter((notification) => notification.status === "queued")
      .sort((a, b) => {
        const createdDelta = a.createdAt.localeCompare(b.createdAt);
        if (createdDelta !== 0) return createdDelta;
        return a.id.localeCompare(b.id);
      });
    const batchNotifications = queued.slice(0, batchLimit);
    const actions: NotificationJobResult["actions"] = [];

    for (const notification of batchNotifications) {
      const delivery = await provider.deliver(notification);
      notification.status = delivery.status;
      notification.provider = delivery.provider;
      notification.providerMessageId = delivery.providerMessageId;
      notification.attempts += 1;
      notification.updatedAt = checkedAt;
      notification.lastError = delivery.lastError;
      if (delivery.status === "sent") notification.sentAt = checkedAt;
      actions.push({
        notificationId: notification.id,
        ticketId: notification.ticketId,
        channel: notification.channel,
        status: notification.status,
        providerMessageId: delivery.providerMessageId,
        reason: delivery.reason,
      });
      this.appendAuditEvents([notificationAudit(notification, command.actor ?? "notification:worker", checkedAt)]);
    }

    return {
      checkedAt,
      batchLimit,
      queuedCount: batchNotifications.length,
      hasMore: queued.length > batchLimit,
      sentCount: actions.filter((action) => action.status === "sent").length,
      failedCount: actions.filter((action) => action.status === "failed").length,
      suppressedCount: actions.filter((action) => action.status === "suppressed").length,
      actions,
    };
  }

  async recordAgentRun(run: AgentRecommendationRun) {
    this.agentRuns.unshift(run);
    this.appendAuditEvents([agentRunAudit(run)]);
    return run;
  }

  async listAgentRuns(ticketId?: string) {
    return this.agentRuns.filter((run) => !ticketId || run.ticketId === ticketId);
  }

  async recordDashboardBriefRun(run: DashboardBriefRun) {
    this.dashboardBriefRuns.unshift(run);
    this.appendAuditEvents([dashboardBriefRunAudit(run)]);
    return run;
  }

  async listDashboardBriefRuns(role?: DashboardBriefRun["role"]) {
    return this.dashboardBriefRuns.filter((run) => !role || run.role === role);
  }

  async close() {
    return;
  }

  private seedDemoTickets() {
    const tickets = demoTicketCommands.map((command) => this.storeMutation(createTicketRecord(command)));
    const [, waterTicket, , powerTicket, sanitationTicket, localRoadTicket] = tickets;

    if (waterTicket) {
      this.storeMutation(
        applyVerificationDecision(waterTicket, {
          action: "route_local",
          actor: "verification:demo",
          reason: "Complete Velachery sanitation complaint routed to MLA/local queue before MAWS escalation.",
          ownerKey: "mla:velachery",
          ownerLabel: "Velachery MLA Office",
          scopeValue: "Velachery",
        }),
      );
    }

    if (powerTicket) {
      const routed = this.storeMutation(
        applyVerificationDecision(powerTicket, {
          action: "route_local",
          actor: "verification:demo",
          reason: "School-zone safety issue verified and routed to Velachery local office.",
          ownerKey: "mla:velachery",
          ownerLabel: "Velachery MLA Office",
          scopeValue: "Velachery",
        }),
      );
      this.storeMutation(
        applyEscalation(routed, {
          actor: "sla:demo",
          reason: "Local SLA breached; escalated to Energy ministry queue.",
          target: "ministry",
          ownerKey: "ministry:energy",
          ownerLabel: "Energy Ministry Queue",
          scopeValue: "Energy",
        }),
      );
    }

    if (sanitationTicket) {
      const routed = this.storeMutation(
        applyVerificationDecision(sanitationTicket, {
          action: "route_local",
          actor: "verification:demo",
          reason: "Sanitation issue verified and routed to local body.",
          ownerKey: "mla:velachery",
          ownerLabel: "Velachery MLA Office",
          scopeValue: "Velachery",
        }),
      );
      const ministry = this.storeMutation(
        applyEscalation(routed, {
          actor: "sla:demo",
          reason: "Local SLA breached; escalated to Municipal Administration ministry.",
          target: "ministry",
          ownerKey: "ministry:maws",
          ownerLabel: "Municipal Administration Ministry Queue",
          scopeValue: "Municipal Administration and Water Supply",
        }),
      );
      this.storeMutation(
        applyEscalation(ministry, {
          actor: "sla:demo",
          reason: "Ministry SLA breached; escalated to CM Cell.",
          target: "cm_cell",
        }),
      );
    }

    if (localRoadTicket) {
      this.storeMutation(
        applyVerificationDecision(localRoadTicket, {
          action: "route_local",
          actor: "verification:demo",
          reason: "School-zone access issue verified and routed to Velachery MLA office.",
          ownerKey: "mla:velachery",
          ownerLabel: "Velachery MLA Office",
          scopeValue: "Velachery",
        }),
      );
    }
  }

  private storeMutation(mutation: TicketMutation) {
    this.tickets.set(mutation.ticket.id, mutation.ticket);
    this.appendAuditEvents(mutation.auditEvents);
    this.notificationOutbox.push(...(mutation.notificationIntents ?? []));
    return mutation.ticket;
  }

  private appendAuditEvents(events: AuditEvent[]) {
    let previousHash = this.auditEvents.at(-1)?.eventHash ?? AUDIT_GENESIS_HASH;
    for (const event of events) {
      const chained = chainAuditEvent(event, previousHash, this.auditEvents.length + 1);
      this.auditEvents.push(chained);
      previousHash = chained.eventHash ?? previousHash;
    }
  }
}

function isSlaDue(ticket: TicketRecord, checkedAt: Date) {
  if (!ticket.sla.dueAt || ticket.sla.paused || ticket.sla.state === "breached") return false;
  if (["resolved", "closed"].includes(ticket.status)) return false;
  return new Date(ticket.sla.dueAt).getTime() <= checkedAt.getTime();
}

function notificationAudit(notification: NotificationIntent, actor: string, createdAt: string): AuditEvent {
  return {
    id: internalId("audit"),
    ticketId: notification.ticketId,
    actor,
    actorRole: "notification-worker",
    action: `notification.${notification.status}`,
    entityType: "notification",
    entityId: notification.id,
    reason: `${notification.channel} ${notification.status} via ${notification.provider ?? "unconfigured-provider"}`,
    correlationId: currentCorrelationId() ?? internalId("corr"),
    sensitive: notification.sensitive,
    createdAt,
  };
}

function agentRunAudit(run: AgentRecommendationRun): AuditEvent {
  return {
    id: internalId("audit"),
    ticketId: run.ticketId,
    actor: run.actor,
    actorRole: "agent-runner",
    action: "agent.recommendation.created",
    entityType: "agent",
    entityId: run.id,
    reason: `${run.recommendation.primaryAction} recommended at ${Math.round(run.recommendation.confidence * 100)}% confidence`,
    correlationId: currentCorrelationId() ?? internalId("corr"),
    sensitive: run.recommendation.protectedSignal.flagged,
    createdAt: run.createdAt,
  };
}

function dashboardBriefRunAudit(run: DashboardBriefRun): AuditEvent {
  return {
    id: internalId("audit"),
    actor: run.actor,
    actorRole: "agent-runner",
    action: "agent.dashboard_brief.created",
    entityType: "agent",
    entityId: run.id,
    reason: `${run.role} ${run.brief.riskLevel} dashboard brief generated`,
    correlationId: currentCorrelationId() ?? internalId("corr"),
    sensitive: run.role === "cm_cell" && run.brief.kpis.protectedCount > 0,
    createdAt: run.createdAt,
  };
}
