import pg from "pg";
import { AUDIT_GENESIS_HASH, chainAuditEvent } from "../audit/hashChain.js";
import { currentCorrelationId } from "../observability/correlation.js";
import type { EvidenceObjectStore } from "../evidence/objectStore.js";
import { MockNotificationDeliveryProvider, type NotificationDeliveryProvider } from "../notifications/provider.js";
import { createDashboardExplanationFromDashboard, isSlaBreached, ticketSummary } from "./dashboard.js";
import { cursorForDashboardTicket, decodeTicketCursor } from "./pagination.js";
import {
  applyCitizenUpdate,
  citizenUpdateConflict,
  applyCitizenDispute,
  applyEvidenceScan,
  applyFieldExecution,
  applyRejectionReviewDecision,
  applySlaJobTransition,
  applyVerificationDecision,
  completeEvidenceUpload as completeEvidenceUploadMutation,
  createEvidenceAccessResult,
  createEvidenceUploadSession as createEvidenceUploadSessionMutation,
  createTicketRecord,
  internalId,
} from "./lifecycle.js";
import type { EvidenceScanVerdict, LifecyclePolicy, TicketMutation } from "./lifecycle.js";
import type { CursorListOptions, TicketListOptions } from "./repository.js";
import type {
  AgentRecommendationRun,
  AuditEvent,
  CitizenDisputeCommand,
  CitizenUpdateCommand,
  CreateTicketCommand,
  DashboardBriefRun,
  DashboardExplanation,
  DashboardFilter,
  DashboardKpis,
  DashboardMetricRow,
  EvidenceAccessQuery,
  EvidenceAccessResult,
  EvidenceMetadata,
  EvidenceSecurityControls,
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
  QueueAssignment,
  RejectionReviewDecisionCommand,
  RoleDashboard,
  SlaClock,
  SlaJobAction,
  SlaJobCommand,
  SlaJobResult,
  TicketEvent,
  TicketRecord,
  VerificationDecisionCommand,
} from "./types.js";

type Queryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
};

type DbStatusContext = {
  actor?: string;
  reason?: string;
};

type TicketRow = {
  id: string;
  category_id: TicketRecord["category"];
  language: TicketRecord["language"];
  title: string;
  description: string;
  reference: string | null;
  department_hint: string | null;
  status: TicketRecord["status"];
  is_protected: boolean;
  citizen_phone_masked: string;
  citizen_phone_hash: string | null;
  location: TicketRecord["location"];
  created_at: Date;
  updated_at: Date;
};

type QueueRow = {
  queue_kind: QueueAssignment["kind"];
  owner_key: string;
  owner_label: string;
  scope_kind: QueueAssignment["scope"]["jurisdiction"];
  scope_value: string;
  is_primary: boolean;
};

type SlaRow = {
  stage: SlaClock["stage"];
  state: SlaClock["state"];
  due_at: Date | null;
  paused_at: Date | null;
};

type EventRow = {
  id: string;
  ticket_id: string;
  event_type: TicketEvent["type"];
  actor_key: string;
  message: string;
  visibility: TicketEvent["visibility"];
  created_at: Date;
};

type EvidenceRow = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: string;
  storage_state: EvidenceMetadata["storageState"];
  storage_key: string | null;
  checksum: string | null;
  security_controls: EvidenceSecurityControls | null;
};

type AuditRow = {
  id: string;
  ticket_id: string | null;
  actor_key: string;
  actor_role: string;
  action: string;
  entity_type: AuditEvent["entityType"];
  entity_id: string;
  reason: string | null;
  correlation_id: string;
  sensitive: boolean;
  created_at: Date;
  previous_hash: string | null;
  event_hash: string | null;
  chain_sequence: string | null;
};

type NotificationRow = {
  id: string;
  ticket_id: string;
  channel: NotificationIntent["channel"];
  status: NotificationIntent["status"];
  topic: NotificationIntent["topic"];
  language: NotificationIntent["language"];
  recipient_masked: string;
  safe_message: string;
  sensitive: boolean;
  provider: NotificationIntent["provider"] | null;
  provider_message_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
};

type IdempotencyRow = {
  scope: string;
  key: string;
  request_hash: string;
  action: IdempotencyRecord["action"];
  response_ticket_id: string | null;
  created_at: Date;
};

type AgentRunRow = {
  id: string;
  ticket_id: string;
  actor_key: string;
  purpose: AgentRecommendationRun["purpose"];
  prompt_version: string;
  model_version: string;
  input_hash: string;
  recommendation: AgentRecommendationRun["recommendation"];
  created_at: Date;
};

type DashboardBriefRunRow = {
  id: string;
  actor_key: string;
  purpose: DashboardBriefRun["purpose"];
  role: DashboardBriefRun["role"];
  scope: DashboardBriefRun["scope"];
  prompt_version: string;
  model_version: string;
  input_hash: string;
  brief: DashboardBriefRun["brief"];
  created_at: Date;
};

type DashboardKpiRow = {
  total: string;
  open_tickets: string;
  sla_breached: string;
  due_today: string;
  due_in_48h: string;
  escalated_to_cm_cell: string;
  protected_count: string;
  rejection_review: string;
  average_age_hours: string | null;
};

type DashboardMetricSqlRow = {
  key: string;
  label: string;
  open_tickets: string;
  sla_breached: string;
  due_in_48h: string;
  protected_count: string;
};

export class PostgresTicketRepository {
  readonly mode = "mvp-postgres";

  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async healthCheck() {
    await this.pool.query("select 1 from tickets limit 1");
  }

  async createTicket(command: CreateTicketCommand, policy?: LifecyclePolicy) {
    const mutation = createTicketRecord(command, policy);
    await this.inTransaction(
      async (client) => {
        await this.insertTicketGraph(client, mutation.ticket, mutation.auditEvents, mutation.notificationIntents ?? []);
      },
      { actor: "citizen", reason: "Citizen submitted complaint" },
    );
    return mutation.ticket;
  }

  async getTicket(ticketId: string) {
    return this.getTicketWithClient(this.pool, ticketId);
  }

  async getIdempotencyRecord(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query<IdempotencyRow>(
      `
        select scope, key, request_hash, action, response_ticket_id, created_at
        from idempotency_records
        where scope = $1 and key = $2
      `,
      [scope, key],
    );
    const row = result.rows[0];
    return row ? rowToIdempotencyRecord(row) : null;
  }

  async reserveIdempotencyRecord(record: Omit<IdempotencyRecord, "responseTicketId">): Promise<{ record: IdempotencyRecord; inserted: boolean }> {
    const result = await this.pool.query<IdempotencyRow>(
      `
        insert into idempotency_records (scope, key, request_hash, action, created_at)
        values ($1, $2, $3, $4, $5)
        on conflict (scope, key) do nothing
        returning scope, key, request_hash, action, response_ticket_id, created_at
      `,
      [record.scope, record.key, record.requestHash, record.action, record.createdAt],
    );
    if (result.rows[0]) return { record: rowToIdempotencyRecord(result.rows[0]), inserted: true };
    const existing = await this.getIdempotencyRecord(record.scope, record.key);
    if (existing) return { record: existing, inserted: false };
    throw new Error(`Idempotency record ${record.scope}:${record.key} was not reserved`);
  }

  async finalizeIdempotencyRecord(record: IdempotencyRecord & { responseTicketId: string }): Promise<IdempotencyRecord> {
    const result = await this.pool.query<IdempotencyRow>(
      `
        update idempotency_records
        set response_ticket_id = $5
        where scope = $1
          and key = $2
          and request_hash = $3
          and action = $4
          and (response_ticket_id is null or response_ticket_id = $5)
        returning scope, key, request_hash, action, response_ticket_id, created_at
      `,
      [record.scope, record.key, record.requestHash, record.action, record.responseTicketId],
    );
    if (result.rows[0]) return rowToIdempotencyRecord(result.rows[0]);
    throw new Error(`Idempotency record ${record.scope}:${record.key} was not finalized`);
  }

  async listTickets() {
    const result = await this.pool.query<{ id: string }>(
      `
        select id
        from tickets
        order by updated_at desc
      `,
    );
    const tickets = await Promise.all(result.rows.map((row) => this.getTicket(row.id)));
    return tickets.filter((ticket): ticket is TicketRecord => ticket !== null);
  }

  async listCitizenTickets(citizenPhoneHash: string, options?: TicketListOptions) {
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const cursor = decodeTicketCursor(options?.cursor, "citizen-updated-desc");
    const values: unknown[] = [citizenPhoneHash];
    let cursorClause = "";
    if (cursor?.updatedAt) {
      values.push(cursor.updatedAt, cursor.id);
      cursorClause = `
        and (
          updated_at < $2::timestamptz
          or (updated_at = $2::timestamptz and id < $3::text)
        )
      `;
    }
    let limitClause = "";
    if (limit) {
      values.push(limit, offset);
      const limitParam = values.length - 1;
      const offsetParam = values.length;
      limitClause = `limit $${limitParam} offset $${offsetParam}`;
    }
    const result = await this.pool.query<{ id: string }>(
      `
        select id
        from tickets
        where citizen_phone_hash = $1
        ${cursorClause}
        order by updated_at desc, id desc
        ${limitClause}
      `,
      values,
    );
    const tickets = await Promise.all(result.rows.map((row) => this.getTicket(row.id)));
    return tickets.filter((ticket): ticket is TicketRecord => ticket !== null);
  }

  async listVerificationQueue(options?: TicketListOptions) {
    const query = options?.q?.trim() ? `%${options.q.trim()}%` : null;
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const cursor = decodeTicketCursor(options?.cursor, "verification-created-asc");
    const values: unknown[] = [query];
    let cursorClause = "";
    if (cursor?.createdAt) {
      values.push(cursor.createdAt, cursor.id);
      cursorClause = `
        and (
          t.created_at > $2::timestamptz
          or (t.created_at = $2::timestamptz and t.id > $3::text)
        )
      `;
    }
    let limitClause = "";
    if (limit) {
      values.push(limit, offset);
      const limitParam = values.length - 1;
      const offsetParam = values.length;
      limitClause = `limit $${limitParam} offset $${offsetParam}`;
    }
    const result = await this.pool.query<{ id: string }>(
      `
        select t.id
        from tickets t
        join ticket_queue_assignments q on q.ticket_id = t.id
        where q.released_at is null
          and q.is_primary = true
          and q.queue_kind in ('verification', 'protected_review')
          and t.status in ('submitted', 'needs_info')
          and (
            $1::text is null
            or t.id ilike $1
            or t.title ilike $1
            or t.category_id ilike $1
            or t.status ilike $1
            or t.location->>'district' ilike $1
            or t.location->>'area' ilike $1
            or q.owner_label ilike $1
          )
          ${cursorClause}
        order by t.created_at asc, t.id asc
        ${limitClause}
      `,
      values,
    );
    const tickets = await Promise.all(result.rows.map((row) => this.getTicket(row.id)));
    return tickets.filter((ticket): ticket is TicketRecord => ticket !== null);
  }

  async getRoleDashboard(filter: DashboardFilter): Promise<RoleDashboard> {
    const params = dashboardSqlParams(filter);
    const filterParams = params.slice(0, 8);
    const limit = filter.ticketLimit ?? 50;
    const offset = filter.ticketOffset ?? 0;
    const cursor = decodeTicketCursor(filter.ticketCursor, "dashboard-sla-updated-desc");
    const cursorSlaRank = typeof cursor?.slaBreached === "boolean" ? (cursor.slaBreached ? 1 : 0) : null;
    const pageParams = [...filterParams, cursorSlaRank, cursor?.updatedAt ?? null, cursor?.id ?? null, limit + 1, offset];
    const kpiResult = await this.pool.query<DashboardKpiRow>(
      `
        ${dashboardScopedCte}
        select
          count(*)::text as total,
          coalesce(sum(case when is_open then 1 else 0 end), 0)::text as open_tickets,
          coalesce(sum(case when sla_breached then 1 else 0 end), 0)::text as sla_breached,
          coalesce(sum(case when due_today then 1 else 0 end), 0)::text as due_today,
          coalesce(sum(case when due_in_48h then 1 else 0 end), 0)::text as due_in_48h,
          coalesce(sum(case when status = 'escalated_cm_cell' or primary_queue_kind = 'cm_cell' then 1 else 0 end), 0)::text as escalated_to_cm_cell,
          coalesce(sum(case when is_protected then 1 else 0 end), 0)::text as protected_count,
          coalesce(sum(case when primary_queue_kind = 'rejection_review' then 1 else 0 end), 0)::text as rejection_review,
          round(avg(extract(epoch from (now() - created_at)) / 3600) filter (where is_open))::text as average_age_hours
        from scoped
      `,
      filterParams,
    );
    const districtResult = await this.pool.query<DashboardMetricSqlRow>(
      `
        ${dashboardScopedCte}
        select
          lower(district) as key,
          district as label,
          coalesce(sum(case when is_open then 1 else 0 end), 0)::text as open_tickets,
          coalesce(sum(case when sla_breached then 1 else 0 end), 0)::text as sla_breached,
          coalesce(sum(case when due_in_48h then 1 else 0 end), 0)::text as due_in_48h,
          coalesce(sum(case when is_protected then 1 else 0 end), 0)::text as protected_count
        from scoped
        group by district
        order by coalesce(sum(case when sla_breached then 1 else 0 end), 0) desc,
                 coalesce(sum(case when is_open then 1 else 0 end), 0) desc,
                 district asc
      `,
      filterParams,
    );
    const ministryResult = await this.pool.query<DashboardMetricSqlRow>(
      `
        ${dashboardScopedCte}
        select
          lower(ministry) as key,
          ministry as label,
          coalesce(sum(case when is_open then 1 else 0 end), 0)::text as open_tickets,
          coalesce(sum(case when sla_breached then 1 else 0 end), 0)::text as sla_breached,
          coalesce(sum(case when due_in_48h then 1 else 0 end), 0)::text as due_in_48h,
          coalesce(sum(case when is_protected then 1 else 0 end), 0)::text as protected_count
        from scoped
        group by ministry
        order by coalesce(sum(case when sla_breached then 1 else 0 end), 0) desc,
                 coalesce(sum(case when is_open then 1 else 0 end), 0) desc,
                 ministry asc
      `,
      filterParams,
    );
    const pageResult = await this.pool.query<{ id: string }>(
      `
        ${dashboardScopedCte}
        select id
        from scoped
        where (
          $9::int is null
          or (case when sla_breached then 1 else 0 end) < $9::int
          or (
            (case when sla_breached then 1 else 0 end) = $9::int
            and (
              updated_at < $10::timestamptz
              or (updated_at = $10::timestamptz and id < $11::text)
            )
          )
        )
        order by sla_breached desc, updated_at desc, id desc
        limit $12 offset $13
      `,
      pageParams,
    );
    const pageRows = pageResult.rows.slice(0, limit);
    const pageTickets = (await Promise.all(pageRows.map((row) => this.getTicket(row.id)))).filter((ticket): ticket is TicketRecord => ticket !== null);
    const kpis = rowToDashboardKpis(kpiResult.rows[0]);
    const total = Number(kpiResult.rows[0]?.total ?? 0);
    const hasMore = pageResult.rows.length > limit;
    const nextCursorSource = pageTickets.at(-1);
    return {
      role: filter.role,
      scope: filter,
      readModel: {
        source: "postgres_sql_projection",
        aggregateStrategy: "bounded_sql_aggregates",
        ticketRowsHydrated: pageTickets.length,
        scopedTicketTotal: total,
      },
      kpis,
      byDistrict: districtResult.rows.map(rowToDashboardMetricRow),
      byMinistry: ministryResult.rows.map(rowToDashboardMetricRow),
      ticketWindow: {
        limit,
        offset,
        cursor: filter.ticketCursor ?? null,
        total,
        returned: pageTickets.length,
        hasMore,
        nextOffset: !filter.ticketCursor && hasMore ? offset + limit : null,
        nextCursor: hasMore && nextCursorSource ? cursorForDashboardTicket(nextCursorSource, isSlaBreached(nextCursorSource)) : null,
      },
      tickets: pageTickets.map((ticket) => ticketSummary(ticket, filter)),
    };
  }

  async getDashboardExplanation(filter: DashboardFilter): Promise<DashboardExplanation> {
    const [dashboard, inputRecords, hiddenProtectedRecords] = await Promise.all([
      this.getRoleDashboard(filter),
      this.countTicketRecords(),
      this.countHiddenProtectedRecords(filter),
    ]);
    return createDashboardExplanationFromDashboard(dashboard, inputRecords, hiddenProtectedRecords);
  }

  async decide(ticketId: string, command: VerificationDecisionCommand, policy?: LifecyclePolicy) {
    return this.inTransaction(
      async (client) => {
        const existing = await this.getTicketWithClient(client, ticketId);
        if (!existing) return null;

        const mutation = applyVerificationDecision(existing, command, policy);
        const existingEventIds = new Set([...existing.citizenTimeline, ...existing.governmentEvents].map((event) => event.id));
        const newEvents = [...mutation.ticket.citizenTimeline, ...mutation.ticket.governmentEvents].filter((event) => !existingEventIds.has(event.id));

        await client.query(
          `
            update tickets
            set status = $2,
                is_protected = $3,
                updated_at = $4
            where id = $1
          `,
          [mutation.ticket.id, mutation.ticket.status, mutation.ticket.protected, mutation.ticket.updatedAt],
        );
        await client.query("update ticket_queue_assignments set released_at = now() where ticket_id = $1 and released_at is null", [mutation.ticket.id]);
        await this.insertQueueAssignments(client, mutation.ticket);
        await client.query("update sla_clock_segments set ended_at = now() where ticket_id = $1 and ended_at is null", [mutation.ticket.id]);
        await this.insertSla(client, mutation.ticket);
        await this.insertEvents(client, newEvents);
        await this.insertAuditEvents(client, mutation.auditEvents);
        await this.insertNotificationIntents(client, mutation.notificationIntents ?? []);
        return mutation.ticket;
      },
      { actor: command.actor, reason: command.reason },
    );
  }

  async submitCitizenUpdate(ticketId: string, command: CitizenUpdateCommand, policy?: LifecyclePolicy) {
    return this.inTransaction(
      async (client) => {
        const existing = await this.getTicketWithClient(client, ticketId);
        if (!existing) return null;
        if (citizenUpdateConflict(existing)) return null;

        const mutation = applyCitizenUpdate(existing, command, policy);
        const existingEventIds = new Set([...existing.citizenTimeline, ...existing.governmentEvents].map((event) => event.id));
        const newEvents = [...mutation.ticket.citizenTimeline, ...mutation.ticket.governmentEvents].filter((event) => !existingEventIds.has(event.id));
        const existingEvidenceIds = new Set(existing.evidence.map((evidence) => evidence.id));
        const newEvidence = mutation.ticket.evidence.filter((evidence) => !existingEvidenceIds.has(evidence.id));

        await client.query(
          `
            update tickets
            set status = $2,
                description = $3,
                location = $4,
                updated_at = $5
            where id = $1
          `,
          [mutation.ticket.id, mutation.ticket.status, mutation.ticket.description, JSON.stringify(mutation.ticket.location), mutation.ticket.updatedAt],
        );
        await client.query("update ticket_queue_assignments set released_at = now() where ticket_id = $1 and released_at is null", [mutation.ticket.id]);
        await this.insertQueueAssignments(client, mutation.ticket);
        await client.query("update sla_clock_segments set ended_at = now() where ticket_id = $1 and ended_at is null", [mutation.ticket.id]);
        await this.insertSla(client, mutation.ticket);
        await this.insertEvidenceItems(client, mutation.ticket.id, newEvidence);
        await this.insertEvents(client, newEvents);
        await this.insertAuditEvents(client, mutation.auditEvents);
        await this.insertNotificationIntents(client, mutation.notificationIntents ?? []);
        return mutation.ticket;
      },
      { actor: command.actor ?? "citizen", reason: "Citizen submitted additional information" },
    );
  }

  async applyFieldExecution(ticketId: string, command: FieldExecutionCommand, policy?: LifecyclePolicy) {
    return this.inTransaction(
      async (client) => {
        const existing = await this.getTicketWithClient(client, ticketId);
        if (!existing) return null;

        const mutation = applyFieldExecution(existing, command, policy);
        await this.applyTicketMutation(client, existing, mutation);
        return mutation.ticket;
      },
      { actor: command.actor, reason: fieldExecutionStatusReason(command) },
    );
  }

  async submitCitizenDispute(ticketId: string, command: CitizenDisputeCommand, policy?: LifecyclePolicy) {
    return this.inTransaction(
      async (client) => {
        const existing = await this.getTicketWithClient(client, ticketId);
        if (!existing) return null;

        const mutation = applyCitizenDispute(existing, command, policy);
        await this.applyTicketMutation(client, existing, mutation);
        return mutation.ticket;
      },
      { actor: command.actor ?? "citizen", reason: command.reason },
    );
  }

  async reviewRejection(ticketId: string, command: RejectionReviewDecisionCommand, policy?: LifecyclePolicy) {
    return this.inTransaction(
      async (client) => {
        const existing = await this.getTicketWithClient(client, ticketId);
        if (!existing) return null;

        const mutation = applyRejectionReviewDecision(existing, command, policy);
        await this.applyTicketMutation(client, existing, mutation);
        return mutation.ticket;
      },
      { actor: command.actor, reason: command.reason },
    );
  }

  async createEvidenceUploadSession(ticketId: string, command: EvidenceUploadCommand): Promise<EvidenceUploadSession | null> {
    return this.inTransaction(async (client) => {
      const existing = await this.getTicketWithClient(client, ticketId);
      if (!existing) return null;

      const { mutation, session } = createEvidenceUploadSessionMutation(existing, command);
      const existingEventIds = new Set([...existing.citizenTimeline, ...existing.governmentEvents].map((event) => event.id));
      const newEvents = [...mutation.ticket.citizenTimeline, ...mutation.ticket.governmentEvents].filter((event) => !existingEventIds.has(event.id));
      const existingEvidenceIds = new Set(existing.evidence.map((evidence) => evidence.id));
      const newEvidence = mutation.ticket.evidence.filter((evidence) => !existingEvidenceIds.has(evidence.id));

      await client.query("update tickets set updated_at = $2 where id = $1", [mutation.ticket.id, mutation.ticket.updatedAt]);
      await this.insertEvidenceItems(client, mutation.ticket.id, newEvidence);
      await this.insertEvents(client, newEvents);
      await this.insertAuditEvents(client, mutation.auditEvents);
      return session;
    });
  }

  async completeEvidenceUpload(ticketId: string, evidenceId: string, command: EvidenceUploadCompletionCommand): Promise<TicketRecord | null> {
    return this.inTransaction(async (client) => {
      const existing = await this.getTicketWithClient(client, ticketId);
      if (!existing) return null;

      const mutation = completeEvidenceUploadMutation(existing, evidenceId, command);
      if (!mutation) return null;
      const completedEvidence = mutation.ticket.evidence.find((evidence) => evidence.id === evidenceId);
      if (!completedEvidence) return null;
      const existingEventIds = new Set([...existing.citizenTimeline, ...existing.governmentEvents].map((event) => event.id));
      const newEvents = [...mutation.ticket.citizenTimeline, ...mutation.ticket.governmentEvents].filter((event) => !existingEventIds.has(event.id));

      await client.query("update tickets set updated_at = $2 where id = $1", [mutation.ticket.id, mutation.ticket.updatedAt]);
      await client.query(
        `
          update evidence_objects
          set storage_state = $3,
              checksum = $4,
              security_controls = $5
          where ticket_id = $1 and id = $2
        `,
        [
          mutation.ticket.id,
          completedEvidence.id,
          completedEvidence.storageState,
          completedEvidence.checksum ?? null,
          JSON.stringify(completedEvidence.controls),
        ],
      );
      await this.insertEvents(client, newEvents);
      await this.insertAuditEvents(client, mutation.auditEvents);
      return mutation.ticket;
    });
  }

  async listEvidenceAccess(ticketId: string, query: EvidenceAccessQuery): Promise<EvidenceAccessResult | null> {
    return this.inTransaction(async (client) => {
      const existing = await this.getTicketWithClient(client, ticketId);
      if (!existing) return null;

      const { result, auditEvents } = createEvidenceAccessResult(existing, query);
      await this.insertAuditEvents(client, auditEvents);
      return result;
    });
  }

  async runEvidenceScanJob(command: EvidenceScanJobCommand, objectStore?: EvidenceObjectStore): Promise<EvidenceScanJobResult> {
    const checkedAt = command.now ?? new Date().toISOString();
    const batchLimit = command.limit ?? 100;
    return this.inTransaction(async (client) => {
      const result = await client.query<{ ticket_id: string }>(
        `
          select distinct ticket_id
          from evidence_objects
          where storage_state = 'scan_pending'
          order by ticket_id asc
          limit $1
        `,
        [batchLimit + 1],
      );
      const batchRows = result.rows.slice(0, batchLimit);
      const actions: EvidenceScanAction[] = [];
      let skippedCount = 0;

      for (const row of batchRows) {
        const existing = await this.getTicketWithClient(client, row.ticket_id);
        if (!existing) {
          skippedCount += 1;
          continue;
        }

        const candidates = existing.evidence.filter((evidence) => evidence.storageState === "scan_pending");
        const verdicts = new Map<string, EvidenceScanVerdict>();
        if (objectStore) {
          for (const evidence of candidates) {
            const scanResult = await objectStore.scanObject(existing, evidence, command.actor ?? "evidence:scanner");
            if (scanResult.status === "missing") {
              skippedCount += 1;
              continue;
            }
            verdicts.set(evidence.id, {
              status: scanResult.status,
              reason: scanResult.reason,
              checksum: scanResult.checksum,
              metadataStripped: scanResult.metadataStripped,
            });
          }
        }
        if (objectStore && !verdicts.size) continue;

        const scan = applyEvidenceScan(existing, command.actor ?? "evidence:scanner", objectStore ? verdicts : undefined);
        if (!scan) {
          skippedCount += 1;
          continue;
        }

        const existingEventIds = new Set([...existing.citizenTimeline, ...existing.governmentEvents].map((event) => event.id));
        const newEvents = [...scan.mutation.ticket.citizenTimeline, ...scan.mutation.ticket.governmentEvents].filter((event) => !existingEventIds.has(event.id));

        await client.query("update tickets set updated_at = $2 where id = $1", [scan.mutation.ticket.id, scan.mutation.ticket.updatedAt]);
        for (const evidence of scan.mutation.ticket.evidence) {
          await client.query(
            `
              update evidence_objects
              set storage_state = $3,
                  checksum = $4,
                  security_controls = $5
              where ticket_id = $1 and id = $2
            `,
            [scan.mutation.ticket.id, evidence.id, evidence.storageState, evidence.checksum ?? null, JSON.stringify(evidence.controls)],
          );
        }
        await this.insertEvents(client, newEvents);
        await this.insertAuditEvents(client, scan.mutation.auditEvents);
        actions.push(...scan.actions);
      }

      return {
        checkedAt,
        batchLimit,
        checkedTicketCount: batchRows.length,
        hasMore: result.rows.length > batchLimit,
        scannedCount: actions.length,
        availableCount: actions.filter((action) => action.toState === "available").length,
        blockedCount: actions.filter((action) => action.toState === "blocked").length,
        skippedCount,
        actions,
      };
    });
  }

  async listNotifications(ticketId?: string, options?: CursorListOptions) {
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const cursor = decodeTicketCursor(options?.cursor, "notification-created-desc");
    const values: unknown[] = [ticketId ?? null];
    let cursorClause = "";
    if (cursor?.createdAt) {
      values.push(cursor.createdAt, cursor.id);
      cursorClause = `
        and (
          created_at < $2::timestamptz
          or (created_at = $2::timestamptz and id < $3::text)
        )
      `;
    }
    let limitClause = "";
    if (limit) {
      values.push(limit, offset);
      const limitParam = values.length - 1;
      const offsetParam = values.length;
      limitClause = `limit $${limitParam} offset $${offsetParam}`;
    }
    const result = await this.pool.query<NotificationRow>(
      `
        select id, ticket_id, channel, status, topic, language, recipient_masked, safe_message,
               sensitive, provider, provider_message_id, attempts, last_error, created_at, updated_at, sent_at
        from notification_outbox
        where ($1::text is null or ticket_id = $1)
        ${cursorClause}
        order by created_at desc, id desc
        ${limitClause}
      `,
      values,
    );
    return result.rows.map(rowToNotification);
  }

  async runNotificationJob(command: NotificationJobCommand, provider: NotificationDeliveryProvider = new MockNotificationDeliveryProvider()): Promise<NotificationJobResult> {
    const checkedAt = command.now ?? new Date().toISOString();
    const batchLimit = command.limit ?? 100;
    return this.inTransaction(async (client) => {
      const result = await client.query<NotificationRow>(
        `
          select id, ticket_id, channel, status, topic, language, recipient_masked, safe_message,
                 sensitive, provider, provider_message_id, attempts, last_error, created_at, updated_at, sent_at
          from notification_outbox
          where status = 'queued'
          order by created_at asc, id asc
          limit $1
        `,
        [batchLimit + 1],
      );
      const batchRows = result.rows.slice(0, batchLimit);
      const actions: NotificationJobResult["actions"] = [];

      for (const row of batchRows) {
        const notification = rowToNotification(row);
        const delivery = await provider.deliver(notification);
        await client.query(
          `
            update notification_outbox
            set status = $2,
                provider = $3,
                provider_message_id = $4,
                attempts = attempts + 1,
                last_error = $5,
                updated_at = $6,
                sent_at = case when $2 = 'sent' then $6 else sent_at end
            where id = $1
          `,
          [row.id, delivery.status, delivery.provider, delivery.providerMessageId ?? null, delivery.lastError ?? null, checkedAt],
        );
        actions.push({
          notificationId: row.id,
          ticketId: row.ticket_id,
          channel: row.channel,
          status: delivery.status,
          providerMessageId: delivery.providerMessageId,
          reason: delivery.reason,
        });
        await this.insertAuditEvents(client, [
          notificationAudit(
            {
              ...notification,
              status: delivery.status,
              provider: delivery.provider,
              providerMessageId: delivery.providerMessageId,
              attempts: notification.attempts + 1,
              lastError: delivery.lastError,
              updatedAt: checkedAt,
              sentAt: delivery.status === "sent" ? checkedAt : notification.sentAt,
            },
            command.actor ?? "notification:worker",
            checkedAt,
          ),
        ]);
      }

      return {
        checkedAt,
        batchLimit,
        queuedCount: batchRows.length,
        hasMore: result.rows.length > batchLimit,
        sentCount: actions.filter((action) => action.status === "sent").length,
        failedCount: actions.filter((action) => action.status === "failed").length,
        suppressedCount: actions.filter((action) => action.status === "suppressed").length,
        actions,
      };
    });
  }

  async runSlaEscalationJob(command: SlaJobCommand, policy?: LifecyclePolicy): Promise<SlaJobResult> {
    const checkedAt = command.now ?? new Date().toISOString();
    const batchLimit = command.limit ?? 100;
    return this.inTransaction(
      async (client) => {
        const result = await client.query<{ id: string }>(
          `
            select t.id
            from tickets t
            join sla_clock_segments s on s.ticket_id = t.id
            where s.ended_at is null
              and s.due_at is not null
              and s.paused_at is null
              and s.state <> 'breached'
              and s.due_at <= $1
              and t.status not in ('resolved', 'closed')
            order by s.due_at asc, t.created_at asc, t.id asc
            limit $2
          `,
          [checkedAt, batchLimit + 1],
        );
        const batchRows = result.rows.slice(0, batchLimit);
        const actions: SlaJobAction[] = [];
        let skippedCount = 0;

        for (const row of batchRows) {
          const existing = await this.getTicketWithClient(client, row.id);
          if (!existing) {
            skippedCount += 1;
            continue;
          }

          const transition = applySlaJobTransition(existing, command.actor ?? "sla:worker", policy);
          if (!transition) {
            skippedCount += 1;
            continue;
          }

          await this.applyTicketMutation(client, existing, transition.mutation);
          actions.push(transition.action);
        }

        return {
          checkedAt,
          batchLimit,
          dueCount: batchRows.length,
          hasMore: result.rows.length > batchLimit,
          escalatedCount: actions.filter((action) => action.outcome.startsWith("escalated")).length,
          breachedCount: actions.filter((action) => action.outcome === "marked_breached").length,
          skippedCount,
          actions,
        };
      },
      { actor: command.actor ?? "sla:worker", reason: "SLA escalation job evaluated due tickets" },
    );
  }

  async listAudit(ticketId?: string, options?: CursorListOptions) {
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const cursor = decodeTicketCursor(options?.cursor, "audit-chain-desc");
    const values: unknown[] = [ticketId ?? null];
    let cursorClause = "";
    if (typeof cursor?.chainSequence === "number") {
      values.push(cursor.chainSequence, cursor.id);
      cursorClause = `
        and (
          chain_sequence < $2::bigint
          or (chain_sequence = $2::bigint and id::text < $3::text)
        )
      `;
    }
    let limitClause = "";
    if (limit) {
      values.push(limit, offset);
      const limitParam = values.length - 1;
      const offsetParam = values.length;
      limitClause = `limit $${limitParam} offset $${offsetParam}`;
    }
    const result = await this.pool.query<AuditRow>(
      `
        select id, ticket_id, actor_key, actor_role, action, entity_type, entity_id, reason,
               correlation_id, sensitive, created_at, previous_hash, event_hash, chain_sequence
        from audit_ledger
        where ($1::text is null or ticket_id = $1)
        ${cursorClause}
        order by chain_sequence desc, id desc
        ${limitClause}
      `,
      values,
    );
    return result.rows.map(rowToAudit);
  }

  async recordAuditEvents(events: AuditEvent[]) {
    if (!events.length) return;
    await this.inTransaction(async (client) => {
      await this.insertAuditEvents(client, events);
    });
  }

  async recordAgentRun(run: AgentRecommendationRun) {
    return this.inTransaction(async (client) => {
      await client.query(
        `
          insert into agent_recommendation_runs (
            id, ticket_id, actor_key, purpose, prompt_version, model_version,
            input_hash, recommendation, created_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          run.id,
          run.ticketId,
          run.actor,
          run.purpose,
          run.promptVersion,
          run.modelVersion,
          run.inputHash,
          JSON.stringify(run.recommendation),
          run.createdAt,
        ],
      );
      await this.insertAuditEvents(client, [agentRunAudit(run)]);
      return run;
    });
  }

  async listAgentRuns(ticketId?: string) {
    const result = await this.pool.query<AgentRunRow>(
      `
        select id, ticket_id, actor_key, purpose, prompt_version, model_version, input_hash, recommendation, created_at
        from agent_recommendation_runs
        where ($1::text is null or ticket_id = $1)
        order by created_at desc
      `,
      [ticketId ?? null],
    );
    return result.rows.map(rowToAgentRun);
  }

  async recordDashboardBriefRun(run: DashboardBriefRun) {
    return this.inTransaction(async (client) => {
      await client.query(
        `
          insert into dashboard_brief_runs (
            id, actor_key, purpose, role, scope, prompt_version, model_version,
            input_hash, brief, created_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          run.id,
          run.actor,
          run.purpose,
          run.role,
          JSON.stringify(run.scope),
          run.promptVersion,
          run.modelVersion,
          run.inputHash,
          JSON.stringify(run.brief),
          run.createdAt,
        ],
      );
      await this.insertAuditEvents(client, [dashboardBriefRunAudit(run)]);
      return run;
    });
  }

  async listDashboardBriefRuns(role?: DashboardBriefRun["role"]) {
    const result = await this.pool.query<DashboardBriefRunRow>(
      `
        select id, actor_key, purpose, role, scope, prompt_version, model_version, input_hash, brief, created_at
        from dashboard_brief_runs
        where ($1::text is null or role = $1)
        order by created_at desc
      `,
      [role ?? null],
    );
    return result.rows.map(rowToDashboardBriefRun);
  }

  async close() {
    await this.pool.end();
  }

  private async inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>, statusContext?: DbStatusContext) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const correlationId = currentCorrelationId();
      if (statusContext?.actor) await client.query("select set_config('whistle.actor', $1, true)", [statusContext.actor]);
      if (statusContext?.reason) await client.query("select set_config('whistle.status_reason', $1, true)", [statusContext.reason]);
      if (correlationId) await client.query("select set_config('whistle.correlation_id', $1, true)", [correlationId]);
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async countTicketRecords() {
    const result = await this.pool.query<{ count: string }>("select count(*)::text as count from tickets");
    return numberFromSql(result.rows[0]?.count);
  }

  private async countHiddenProtectedRecords(filter: DashboardFilter) {
    if (filter.role === "cm_cell" || filter.role === "verification") return 0;
    const result = await this.pool.query<{ count: string }>("select count(*)::text as count from tickets where is_protected = true");
    return numberFromSql(result.rows[0]?.count);
  }

  private async getTicketWithClient(client: Queryable, ticketId: string): Promise<TicketRecord | null> {
    const ticketResult = await client.query<TicketRow>(
      `
        select id, category_id, language, title, description, reference, department_hint, status,
               is_protected, citizen_phone_masked, citizen_phone_hash, location, created_at, updated_at
        from tickets
        where id = $1
      `,
      [ticketId],
    );
    const ticketRow = ticketResult.rows[0];
    if (!ticketRow) return null;

    const queueResult = await client.query<QueueRow>(
      `
        select queue_kind, owner_key, owner_label, scope_kind, scope_value, is_primary
        from ticket_queue_assignments
        where ticket_id = $1 and released_at is null
        order by is_primary desc, assigned_at asc
      `,
      [ticketId],
    );
    const slaResult = await client.query<SlaRow>(
      `
        select stage, state, due_at, paused_at
        from sla_clock_segments
        where ticket_id = $1 and ended_at is null
        order by started_at desc
        limit 1
      `,
      [ticketId],
    );
    const evidenceResult = await client.query<EvidenceRow>(
      `
        select id, file_name, mime_type, size_bytes, storage_state, storage_key, checksum, security_controls
        from evidence_objects
        where ticket_id = $1
        order by created_at asc
      `,
      [ticketId],
    );
    const eventResult = await client.query<EventRow>(
      `
        select id, ticket_id, event_type, actor_key, message, visibility, created_at
        from ticket_events
        where ticket_id = $1
        order by created_at asc
      `,
      [ticketId],
    );

    const primaryQueue = queueResult.rows.find((row) => row.is_primary);
    if (!primaryQueue) throw new Error(`Ticket ${ticketId} has no active primary queue`);

    const events = eventResult.rows.map(rowToEvent);
    return {
      id: ticketRow.id,
      category: ticketRow.category_id,
      language: ticketRow.language,
      title: ticketRow.title,
      description: ticketRow.description,
      reference: ticketRow.reference ?? undefined,
      departmentHint: ticketRow.department_hint ?? undefined,
      status: ticketRow.status,
      protected: ticketRow.is_protected,
      citizenPhoneMasked: ticketRow.citizen_phone_masked,
      citizenPhoneHash: ticketRow.citizen_phone_hash ?? "",
      location: ticketRow.location,
      evidence: evidenceResult.rows.map(rowToEvidence),
      primaryQueue: rowToQueue(primaryQueue),
      secondaryQueues: queueResult.rows.filter((row) => !row.is_primary).map(rowToQueue),
      sla: slaResult.rows[0] ? rowToSla(slaResult.rows[0]) : { stage: "verification", state: "on_track", dueAt: null, paused: false },
      citizenTimeline: events.filter((event) => event.visibility === "citizen" || event.visibility === "protected"),
      governmentEvents: events.filter((event) => event.visibility === "government" || event.visibility === "protected"),
      createdAt: ticketRow.created_at.toISOString(),
      updatedAt: ticketRow.updated_at.toISOString(),
    };
  }

  private async insertTicketGraph(client: Queryable, ticket: TicketRecord, auditEvents: AuditEvent[], notificationIntents: NotificationIntent[]) {
    await client.query(
      `
        insert into tickets (
          id, category_id, language, title, description, reference, department_hint,
          status, is_protected, citizen_phone_masked, citizen_phone_hash, location, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        ticket.id,
        ticket.category,
        ticket.language,
        ticket.title,
        ticket.description,
        ticket.reference ?? null,
        ticket.departmentHint ?? null,
        ticket.status,
        ticket.protected,
        ticket.citizenPhoneMasked,
        ticket.citizenPhoneHash,
        JSON.stringify(ticket.location),
        ticket.createdAt,
        ticket.updatedAt,
      ],
    );
    await this.insertQueueAssignments(client, ticket);
    await this.insertSla(client, ticket);
    await this.insertEvidence(client, ticket);
    await this.insertEvents(client, [...ticket.citizenTimeline, ...ticket.governmentEvents]);
    await this.insertAuditEvents(client, auditEvents);
    await this.insertNotificationIntents(client, notificationIntents);
  }

  private async applyTicketMutation(client: Queryable, existing: TicketRecord, mutation: TicketMutation) {
    const existingEventIds = new Set([...existing.citizenTimeline, ...existing.governmentEvents].map((event) => event.id));
    const newEvents = [...mutation.ticket.citizenTimeline, ...mutation.ticket.governmentEvents].filter((event) => !existingEventIds.has(event.id));
    const existingEvidenceIds = new Set(existing.evidence.map((evidence) => evidence.id));
    const newEvidence = mutation.ticket.evidence.filter((evidence) => !existingEvidenceIds.has(evidence.id));
    const queueChanged = queueSignature(existing) !== queueSignature(mutation.ticket);
    const slaChanged = slaSignature(existing) !== slaSignature(mutation.ticket);

    await client.query(
      `
        update tickets
        set status = $2,
            is_protected = $3,
            updated_at = $4
        where id = $1
      `,
      [mutation.ticket.id, mutation.ticket.status, mutation.ticket.protected, mutation.ticket.updatedAt],
    );
    if (queueChanged) {
      await client.query("update ticket_queue_assignments set released_at = now() where ticket_id = $1 and released_at is null", [mutation.ticket.id]);
      await this.insertQueueAssignments(client, mutation.ticket);
    }
    if (slaChanged) {
      await client.query("update sla_clock_segments set ended_at = now() where ticket_id = $1 and ended_at is null", [mutation.ticket.id]);
      await this.insertSla(client, mutation.ticket);
    }
    await this.insertEvidenceItems(client, mutation.ticket.id, newEvidence);
    await this.insertEvents(client, newEvents);
    await this.insertAuditEvents(client, mutation.auditEvents);
    await this.insertNotificationIntents(client, mutation.notificationIntents ?? []);
  }

  private async insertQueueAssignments(client: Queryable, ticket: TicketRecord) {
    const assignments = [ticket.primaryQueue, ...ticket.secondaryQueues];
    for (const [index, assignment] of assignments.entries()) {
      await client.query(
        `
          insert into ticket_queue_assignments (
            ticket_id, queue_kind, owner_key, owner_label, scope_kind, scope_value, is_primary
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [ticket.id, assignment.kind, assignment.ownerKey, assignment.ownerLabel, assignment.scope.jurisdiction, assignment.scope.value, index === 0],
      );
    }
  }

  private async insertSla(client: Queryable, ticket: TicketRecord) {
    await client.query(
      `
        insert into sla_clock_segments (ticket_id, stage, state, due_at, paused_at)
        values ($1, $2, $3, $4, $5)
      `,
      [ticket.id, ticket.sla.stage, ticket.sla.state, ticket.sla.dueAt, ticket.sla.paused ? new Date().toISOString() : null],
    );
  }

  private async insertEvidence(client: Queryable, ticket: TicketRecord) {
    await this.insertEvidenceItems(client, ticket.id, ticket.evidence);
  }

  private async insertEvidenceItems(client: Queryable, ticketId: string, evidenceItems: EvidenceMetadata[]) {
    for (const evidence of evidenceItems) {
      await client.query(
        `
          insert into evidence_objects (id, ticket_id, file_name, mime_type, size_bytes, storage_key, storage_state, checksum, security_controls)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          evidence.id,
          ticketId,
          evidence.fileName,
          evidence.mimeType,
          evidence.sizeBytes,
          evidence.storageKey ?? null,
          evidence.storageState,
          evidence.checksum ?? null,
          JSON.stringify(evidence.controls),
        ],
      );
    }
  }

  private async insertEvents(client: Queryable, events: TicketEvent[]) {
    for (const event of events) {
      await client.query(
        `
          insert into ticket_events (ticket_id, event_type, actor_key, message, visibility, created_at)
          values ($1, $2, $3, $4, $5, $6)
        `,
        [event.ticketId, event.type, event.actor, event.message, event.visibility, event.createdAt],
      );
    }
  }

  private async insertAuditEvents(client: Queryable, auditEvents: AuditEvent[]) {
    let previousHash = await this.latestAuditHash(client);
    for (const event of auditEvents) {
      const chainedEvent = chainAuditEvent(event, previousHash);
      await client.query(
        `
          insert into audit_ledger (
            ticket_id, actor_key, actor_role, action, entity_type, entity_id,
            reason, correlation_id, sensitive, created_at, previous_hash, event_hash
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          chainedEvent.ticketId ?? null,
          chainedEvent.actor,
          chainedEvent.actorRole,
          chainedEvent.action,
          chainedEvent.entityType,
          chainedEvent.entityId,
          chainedEvent.reason ?? null,
          chainedEvent.correlationId,
          chainedEvent.sensitive,
          chainedEvent.createdAt,
          chainedEvent.previousHash ?? AUDIT_GENESIS_HASH,
          chainedEvent.eventHash ?? null,
        ],
      );
      previousHash = chainedEvent.eventHash ?? previousHash;
    }
  }

  private async latestAuditHash(client: Queryable) {
    const result = await client.query<{ event_hash: string | null }>(
      `
        select event_hash
        from audit_ledger
        where event_hash is not null
        order by chain_sequence desc
        limit 1
      `,
    );
    return result.rows[0]?.event_hash ?? AUDIT_GENESIS_HASH;
  }

  private async insertNotificationIntents(client: Queryable, notificationIntents: NotificationIntent[]) {
    for (const notification of notificationIntents) {
      await client.query(
        `
          insert into notification_outbox (
            id, ticket_id, channel, status, topic, language, recipient_masked,
            safe_message, sensitive, provider, provider_message_id, attempts, last_error, created_at, updated_at, sent_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `,
        [
          notification.id,
          notification.ticketId,
          notification.channel,
          notification.status,
          notification.topic,
          notification.language,
          notification.recipientMasked,
          notification.safeMessage,
          notification.sensitive,
          notification.provider ?? null,
          notification.providerMessageId ?? null,
          notification.attempts,
          notification.lastError ?? null,
          notification.createdAt,
          notification.updatedAt,
          notification.sentAt ?? null,
        ],
      );
    }
  }
}

const dashboardScopedCte = `
  with active_queues as (
    select
      ticket_id,
      string_agg(owner_key || ' ' || owner_label || ' ' || scope_value || ' ' || queue_kind, ' ') as queue_search_text,
      min(scope_value) filter (where queue_kind = 'ministry' and scope_kind = 'ministry') as assigned_ministry,
      bool_or(queue_kind = $6) as matches_queue,
      bool_or(queue_kind = 'ministry' and scope_kind = 'ministry' and lower(scope_value) = lower($2::text)) as matches_ministry,
      bool_or(lower(scope_value) = lower($4::text)) as matches_constituency,
      bool_or(queue_kind in ('local', 'mla')) as has_local_or_mla_queue,
      bool_or(queue_kind = 'local' and lower(scope_value) = lower($5::text)) as matches_ward
    from ticket_queue_assignments
    where released_at is null
    group by ticket_id
  ),
  scoped_source as (
    select
      t.id,
      t.title,
      t.description,
      t.category_id,
      t.department_hint,
      t.status,
      t.is_protected,
      t.location,
      coalesce(t.location->>'district', 'Unknown district') as district,
      coalesce(t.location->>'area', '') as area,
      t.created_at,
      t.updated_at,
      primary_queue.queue_kind as primary_queue_kind,
      coalesce(sla.state, 'on_track') as sla_state,
      sla.due_at,
      sla.paused_at,
      active_queues.queue_search_text,
      coalesce(active_queues.assigned_ministry, '') as assigned_ministry,
      coalesce(active_queues.matches_queue, false) as matches_queue,
      coalesce(active_queues.matches_ministry, false) as matches_ministry,
      coalesce(active_queues.matches_constituency, false) as matches_constituency,
      coalesce(active_queues.has_local_or_mla_queue, false) as has_local_or_mla_queue,
      coalesce(active_queues.matches_ward, false) as matches_ward,
      case
        when $1::text in ('minister', 'department_officer') then coalesce(active_queues.assigned_ministry, 'Unassigned ministry')
        when lower(coalesce(t.department_hint, '')) like '%tangedco%' then 'Energy'
        when lower(coalesce(t.department_hint, '')) like '%revenue%' then 'Revenue'
        when t.category_id = 'corruption' then 'CM Cell / Vigilance'
        when t.category_id in ('roads', 'water', 'sanitation') then 'Municipal Administration and Water Supply'
        when t.category_id = 'power' then 'Energy'
        when t.category_id = 'safety' then 'Home'
        when t.category_id = 'health' then 'Health and Family Welfare'
        when t.category_id = 'education' then 'School Education'
        when t.category_id = 'revenue' then 'Revenue'
        when t.category_id = 'ration' then 'Cooperation, Food and Consumer Protection'
        else 'CM Cell Routing'
      end as ministry
    from tickets t
    join ticket_queue_assignments primary_queue
      on primary_queue.ticket_id = t.id
      and primary_queue.released_at is null
      and primary_queue.is_primary = true
    left join active_queues on active_queues.ticket_id = t.id
    left join sla_clock_segments sla
      on sla.ticket_id = t.id
      and sla.ended_at is null
    where ($3::text is null or lower(t.location->>'district') = lower($3::text))
      and ($6::text is null or coalesce(active_queues.matches_queue, false))
      and ($7::text is null or primary_queue.queue_kind = $7::text)
  ),
  scoped as (
    select
      *,
      status not in ('resolved', 'closed') as is_open,
      (
        status not in ('resolved', 'closed')
        and due_at is not null
        and paused_at is null
        and sla_state <> 'paused'
        and (sla_state = 'breached' or due_at < now())
      ) as sla_breached,
      (
        status not in ('resolved', 'closed')
        and due_at is not null
        and paused_at is null
        and sla_state <> 'paused'
        and due_at >= now()
        and due_at <= now() + interval '24 hours'
      ) as due_today,
      (
        status not in ('resolved', 'closed')
        and due_at is not null
        and paused_at is null
        and sla_state <> 'paused'
        and due_at >= now()
        and due_at <= now() + interval '48 hours'
      ) as due_in_48h
    from scoped_source
    where
      (not is_protected or $1::text in ('cm_cell', 'verification'))
      and (
        ($1::text = 'cm_cell')
        or ($1::text = 'verification' and primary_queue_kind in ('verification', 'protected_review', 'rejection_review'))
        or ($1::text in ('minister', 'department_officer') and $2::text is not null and matches_ministry)
        or (
          $1::text = 'mla'
          and (
            ($4::text is not null and matches_constituency)
            or ($3::text is not null and lower(district) = lower($3::text) and has_local_or_mla_queue)
          )
        )
        or ($1::text = 'councillor' and $5::text is not null and matches_ward)
      )
      and (
        $8::text is null
        or (
          id || ' ' || title || ' ' || description || ' ' || category_id || ' ' || status || ' ' ||
          district || ' ' || area || ' ' || ministry || ' ' || assigned_ministry || ' ' || coalesce(queue_search_text, '')
        ) ilike $8
      )
  )
`;

function dashboardSqlParams(filter: DashboardFilter) {
  const queue = filter.queue && filter.queue !== "all" ? filter.queue : null;
  const primaryQueue = filter.primaryQueue && filter.primaryQueue !== "all" ? filter.primaryQueue : null;
  const query = filter.q ? `%${filter.q.trim()}%` : null;
  return [
    filter.role,
    filter.ministry ?? null,
    filter.district ?? null,
    filter.constituency ?? null,
    filter.ward ?? null,
    queue,
    primaryQueue,
    query,
    filter.ticketLimit ?? 50,
    filter.ticketOffset ?? 0,
  ];
}

function numberFromSql(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowToDashboardKpis(row?: DashboardKpiRow): DashboardKpis {
  return {
    openTickets: numberFromSql(row?.open_tickets),
    slaBreached: numberFromSql(row?.sla_breached),
    dueToday: numberFromSql(row?.due_today),
    dueIn48h: numberFromSql(row?.due_in_48h),
    escalatedToCmCell: numberFromSql(row?.escalated_to_cm_cell),
    protectedCount: numberFromSql(row?.protected_count),
    rejectionReview: numberFromSql(row?.rejection_review),
    averageAgeHours: numberFromSql(row?.average_age_hours),
  };
}

function rowToDashboardMetricRow(row: DashboardMetricSqlRow): DashboardMetricRow {
  return {
    key: row.key,
    label: row.label,
    openTickets: numberFromSql(row.open_tickets),
    slaBreached: numberFromSql(row.sla_breached),
    dueIn48h: numberFromSql(row.due_in_48h),
    protectedCount: numberFromSql(row.protected_count),
  };
}

function queueSignature(ticket: TicketRecord) {
  return [ticket.primaryQueue, ...ticket.secondaryQueues]
    .map((queue, index) => [index === 0, queue.kind, queue.ownerKey, queue.ownerLabel, queue.scope.jurisdiction, queue.scope.value].join(":"))
    .join("|");
}

function slaSignature(ticket: TicketRecord) {
  return [ticket.sla.stage, ticket.sla.state, ticket.sla.dueAt ?? "", ticket.sla.paused ? "paused" : "running"].join(":");
}

function rowToQueue(row: QueueRow): QueueAssignment {
  return {
    kind: row.queue_kind,
    ownerKey: row.owner_key,
    ownerLabel: row.owner_label,
    scope: { jurisdiction: row.scope_kind, value: row.scope_value },
  };
}

function rowToSla(row: SlaRow): SlaClock {
  return {
    stage: row.stage,
    state: row.state,
    dueAt: row.due_at?.toISOString() ?? null,
    paused: row.paused_at !== null || row.state === "paused",
  };
}

function rowToEvidence(row: EvidenceRow): EvidenceMetadata {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageState: row.storage_state,
    storageKey: row.storage_key ?? undefined,
    checksum: row.checksum ?? undefined,
    controls: row.security_controls ?? {
      classification: "standard",
      retentionPolicy: "standard_180_days",
      retentionUntil: null,
      encryptionContext: "evidence:standard",
      metadataStripped: true,
      downloadAllowed: false,
      watermarkRequired: true,
    },
  };
}

function rowToEvent(row: EventRow): TicketEvent {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    type: row.event_type,
    actor: row.actor_key,
    message: row.message,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
  };
}

function rowToAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    ticketId: row.ticket_id ?? undefined,
    actor: row.actor_key,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason ?? undefined,
    correlationId: row.correlation_id,
    sensitive: row.sensitive,
    createdAt: row.created_at.toISOString(),
    previousHash: row.previous_hash ?? undefined,
    eventHash: row.event_hash ?? undefined,
    chainSequence: row.chain_sequence ? Number(row.chain_sequence) : undefined,
  };
}

function rowToNotification(row: NotificationRow): NotificationIntent {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    channel: row.channel,
    status: row.status,
    topic: row.topic,
    language: row.language,
    recipientMasked: row.recipient_masked,
    safeMessage: row.safe_message,
    sensitive: row.sensitive,
    provider: row.provider ?? undefined,
    providerMessageId: row.provider_message_id ?? undefined,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    sentAt: row.sent_at?.toISOString() ?? undefined,
  };
}

function rowToIdempotencyRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    scope: row.scope,
    key: row.key,
    requestHash: row.request_hash,
    action: row.action,
    responseTicketId: row.response_ticket_id ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function rowToAgentRun(row: AgentRunRow): AgentRecommendationRun {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    actor: row.actor_key,
    purpose: row.purpose,
    promptVersion: row.prompt_version,
    modelVersion: row.model_version,
    inputHash: row.input_hash,
    recommendation: row.recommendation,
    createdAt: row.created_at.toISOString(),
  };
}

function rowToDashboardBriefRun(row: DashboardBriefRunRow): DashboardBriefRun {
  return {
    id: row.id,
    actor: row.actor_key,
    purpose: row.purpose,
    role: row.role,
    scope: row.scope,
    promptVersion: row.prompt_version,
    modelVersion: row.model_version,
    inputHash: row.input_hash,
    brief: row.brief,
    createdAt: row.created_at.toISOString(),
  };
}

function fieldExecutionStatusReason(command: FieldExecutionCommand) {
  if (command.action === "resolve") return command.resolutionNote;
  if (command.action === "transfer") return command.reason;
  return command.note;
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
