import { buildWhistleApi } from "../server/app.js";
import { verifyAuditHashChain } from "../server/audit/hashChain.js";
import { withVerifiedPhone } from "./smoke-helpers.js";
import type { AuditEvent, EvidenceAccessResult, EvidenceScanJobResult, EvidenceUploadSession } from "../server/ticket-spine/types.js";
import pg from "pg";

type InjectableApp = ReturnType<typeof buildWhistleApi>;
type ReadinessResponse = {
  ok: boolean;
  dependencies: Array<{ name: string; mode: string; ok: boolean }>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function closeApp(app: InjectableApp) {
  await app.close();
}

async function startApp() {
  const app = buildWhistleApi();
  await app.ready();
  return app;
}

async function fetchAllAuditEvents(app: InjectableApp, headers: Record<string, string>) {
  const events: AuditEvent[] = [];
  let cursor: string | null = null;
  for (let pageIndex = 0; pageIndex < 50; pageIndex += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/audit?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      headers,
    });
    assert(response.statusCode === 200, `Audit page ${pageIndex + 1} returned ${response.statusCode}; expected 200. Body: ${response.body}`);
    const body = response.json<{ auditEvents: AuditEvent[]; page: { hasMore: boolean; nextCursor: string | null } }>();
    events.push(...body.auditEvents);
    if (!body.page.hasMore) return events;
    assert(body.page.nextCursor, "Audit page with more rows should include nextCursor.");
    cursor = body.page.nextCursor;
  }
  throw new Error("Audit pagination did not terminate within 50 pages.");
}

async function assertAuditLedgerAppendOnly(connectionString: string, auditEventId: string) {
  const pool = new pg.Pool({ connectionString });
  try {
    async function expectBlocked(label: string, query: string) {
      let blockedMessage = "";
      try {
        await pool.query(query, [auditEventId]);
      } catch (error) {
        blockedMessage = error instanceof Error ? error.message : String(error);
      }
      assert(
        blockedMessage.includes("audit_ledger is append-only"),
        `${label} should be blocked by the audit append-only trigger. Got: ${blockedMessage || "no error"}`,
      );
    }

    await expectBlocked("Audit ledger UPDATE", "update audit_ledger set reason = reason where id = $1");
    await expectBlocked("Audit ledger DELETE", "delete from audit_ledger where id = $1");
  } finally {
    await pool.end();
  }
}

async function assertTicketStatusHistory(connectionString: string, ticketId: string) {
  const pool = new pg.Pool({ connectionString });
  try {
    const result = await pool.query<{
      from_status: string | null;
      to_status: string;
      actor_key: string;
      correlation_id: string;
    }>(
      `
        select from_status, to_status, actor_key, correlation_id
        from ticket_status_history
        where ticket_id = $1
        order by changed_at asc, created_at asc
      `,
      [ticketId],
    );
    const transitions = result.rows.map((row) => `${row.from_status ?? "new"}->${row.to_status}`);
    assert(
      transitions.includes("new->submitted"),
      `Postgres ticket_status_history should record ticket creation. Got: ${transitions.join(", ")}`,
    );
    assert(
      transitions.includes("submitted->routed_local"),
      `Postgres ticket_status_history should record verification routing. Got: ${transitions.join(", ")}`,
    );
    assert(
      result.rows.every((row) => row.actor_key && row.correlation_id),
      "Postgres ticket_status_history rows should include actor and correlation fields, even when populated by the database trigger.",
    );
    const creation = result.rows.find((row) => row.from_status === null && row.to_status === "submitted");
    const routedLocal = result.rows.find((row) => row.from_status === "submitted" && row.to_status === "routed_local");
    assert(creation, "Ticket creation status history row should be present.");
    assert(creation.actor_key === "citizen", `Ticket creation status history should record citizen actor. Got: ${creation.actor_key}`);
    assert(creation.correlation_id === createCorrelationId, `Ticket creation status history should preserve correlation id. Got: ${creation.correlation_id}`);
    assert(routedLocal, "Verification routing status history row should be present.");
    assert(
      routedLocal.actor_key === "verification:prototype",
      `Verification routing status history should record verifier actor. Got: ${routedLocal.actor_key}`,
    );
    assert(routedLocal.correlation_id === routeCorrelationId, `Verification routing status history should preserve correlation id. Got: ${routedLocal.correlation_id}`);
  } finally {
    await pool.end();
  }
}

type RlsContext = {
  role?: string;
  citizenPhoneHash?: string;
  scopeKeys?: string;
};

async function withRlsContext<T>(client: pg.PoolClient, context: RlsContext, work: () => Promise<T>) {
  await client.query("begin");
  try {
    await client.query("set local role whistle_app");
    if (context.role) await client.query("select set_config('whistle.role', $1, true)", [context.role]);
    if (context.citizenPhoneHash) await client.query("select set_config('whistle.citizen_phone_hash', $1, true)", [context.citizenPhoneHash]);
    if (context.scopeKeys) await client.query("select set_config('whistle.scope_keys', $1, true)", [context.scopeKeys]);
    const result = await work();
    await client.query("rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function assertPostgresRlsScopes(connectionString: string, ticketId: string, protectedTicketId: string) {
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    const ownerView = await client.query<{ citizen_phone_hash: string }>("select citizen_phone_hash from tickets where id = $1", [ticketId]);
    const citizenPhoneHash = ownerView.rows[0]?.citizen_phone_hash;
    assert(citizenPhoneHash, "RLS smoke needs the persisted citizen_phone_hash from the owner connection.");

    async function ticketCount(context: RlsContext, id: string) {
      return withRlsContext(client, context, async () => {
        const result = await client.query<{ count: string }>("select count(*)::text as count from tickets where id = $1", [id]);
        return Number(result.rows[0].count);
      });
    }

    async function evidenceCount(context: RlsContext, id: string) {
      return withRlsContext(client, context, async () => {
        const result = await client.query<{ count: string }>("select count(*)::text as count from evidence_objects where ticket_id = $1", [id]);
        return Number(result.rows[0].count);
      });
    }

    async function visibleTicketIds(context: RlsContext, ids: string[]) {
      return withRlsContext(client, context, async () => {
        const result = await client.query<{ id: string }>("select id from tickets where id = any($1::text[]) order by id", [ids]);
        return result.rows.map((row) => row.id);
      });
    }

    assert((await ticketCount({}, ticketId)) === 0, "RLS app role should see no tickets without Whistle context.");
    assert((await ticketCount({ role: "citizen", citizenPhoneHash: "wrong-hash" }, ticketId)) === 0, "RLS should block citizen access with the wrong phone hash.");
    assert((await ticketCount({ role: "citizen", citizenPhoneHash }, ticketId)) === 1, "RLS should allow citizen access to their own ticket hash.");
    assert((await ticketCount({ role: "councillor", scopeKeys: "ward:ward 48" }, ticketId)) === 1, "RLS should allow the scoped local owner to read its ward ticket.");
    assert((await ticketCount({ role: "councillor", scopeKeys: "ward:ward 48" }, protectedTicketId)) === 0, "RLS should block local owner access to protected tickets.");
    assert((await ticketCount({ role: "cm_cell" }, protectedTicketId)) === 1, "RLS should allow CM Cell access to protected tickets.");
    assert((await evidenceCount({ role: "councillor", scopeKeys: "ward:ward 48" }, protectedTicketId)) === 0, "RLS should block protected evidence rows from local owners.");
    assert((await evidenceCount({ role: "cm_cell" }, protectedTicketId)) >= 1, "RLS should allow CM Cell to read protected evidence rows.");

    const localVisibleIds = await visibleTicketIds({ role: "councillor", scopeKeys: "ward:ward 48" }, [ticketId, protectedTicketId]);
    assert(localVisibleIds.length === 1 && localVisibleIds[0] === ticketId, `RLS local owner scope should expose only the ward ticket. Got: ${localVisibleIds.join(", ")}`);
  } finally {
    client.release();
    await pool.end();
  }
}

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "DATABASE_URL is required. Run with DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle after npm run db:migrate.");

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const createCorrelationId = `pg-create-corr-${runId}`;
const protectedCreateCorrelationId = `pg-protected-create-corr-${runId}`;
const routeCorrelationId = `pg-route-corr-${runId}`;
const phone = `+9198${Date.now().toString().slice(-8)}`;
const protectedPhone = `+9197${Date.now().toString().slice(-8)}`;
const citizenHeaders = (phoneVerificationToken: string) => ({
  "x-whistle-citizen-phone": phone,
  "x-whistle-citizen-token": phoneVerificationToken,
});
const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
};
const verificationHeaders = {
  "x-whistle-role": "verification",
  "x-whistle-actor": "verification:prototype",
};
const cmCellHeaders = {
  "x-whistle-role": "cm_cell",
  "x-whistle-actor": "cm_cell:prototype",
};
const workerHeaders = {
  "x-whistle-role": "worker",
  "x-whistle-actor": "worker:prototype",
};

const app = await startApp();

try {
  const health = await app.inject({ method: "GET", url: "/api/health" });
  assert(health.statusCode === 200, `Health returned ${health.statusCode}; expected 200. Body: ${health.body}`);
  assert(health.json<{ mode: string }>().mode === "mvp-postgres", "API must be using Postgres ticket repository for this smoke.");

  const ready = await app.inject({ method: "GET", url: "/api/ready" });
  assert(ready.statusCode === 200, `Readiness returned ${ready.statusCode}; expected 200. Body: ${ready.body}`);
  const readiness = ready.json<ReadinessResponse>();
  assert(readiness.ok, "Postgres readiness should be ok after migration.");
  assert(readiness.dependencies.every((dependency) => dependency.ok), "Every Postgres readiness dependency should be ok.");
  assert(
    readiness.dependencies
      .filter((dependency) => !["citizen_otp_delivery", "evidence_object_store", "notification_delivery", "official_auth", "public_rate_limit", "security_export", "telemetry_export", "worker_auth"].includes(dependency.name))
      .every((dependency) => dependency.mode.includes("postgres")),
    `Postgres readiness should use Postgres-backed dependencies. Modes: ${readiness.dependencies.map((dependency) => dependency.mode).join(", ")}`,
  );
  assert(
    readiness.dependencies.some((dependency) => dependency.name === "official_auth" && dependency.mode === "prototype-headers"),
    "Postgres readiness should expose the configured official auth dependency.",
  );
  assert(
    readiness.dependencies.some((dependency) => dependency.name === "worker_auth" && dependency.mode === "prototype-open"),
    "Postgres readiness should expose the configured worker authentication dependency.",
  );
  assert(
    readiness.dependencies.some((dependency) => dependency.name === "citizen_otp_delivery" && dependency.mode === "mock-sms-exposed"),
    "Postgres readiness should expose the configured citizen OTP delivery provider dependency.",
  );
  assert(
    readiness.dependencies.some((dependency) => dependency.name === "notification_delivery" && dependency.mode === "mvp-mock-notification-provider"),
    "Postgres readiness should expose the configured notification delivery provider dependency.",
  );
  assert(
    readiness.dependencies.some((dependency) => dependency.name === "evidence_object_store" && dependency.mode === "local-mock-object-store"),
    "Postgres readiness should expose the configured evidence object-store dependency.",
  );
  assert(
    readiness.dependencies.some((dependency) => dependency.name === "security_export" && dependency.mode === "mvp-local-security-export"),
    "Postgres readiness should expose the configured security export dependency.",
  );
  assert(
    readiness.dependencies.some((dependency) => dependency.name === "telemetry_export" && dependency.mode === "mvp-local-telemetry"),
    "Postgres readiness should expose the configured telemetry export dependency.",
  );
  assert(
    readiness.dependencies.some((dependency) => dependency.name === "public_rate_limit" && dependency.mode === "in-memory-rate-limit"),
    "Postgres readiness should expose the configured public rate-limit backend dependency.",
  );

  const config = await app.inject({
    method: "GET",
    url: "/api/admin/config",
    headers: adminHeaders,
  });
  assert(config.statusCode === 200, `Admin config returned ${config.statusCode}; expected 200. Body: ${config.body}`);
  assert(config.json<{ mode: string }>().mode === "mvp-postgres", "Admin config must be using Postgres config repository.");

  const access = await app.inject({
    method: "GET",
    url: "/api/admin/access",
    headers: adminHeaders,
  });
  assert(access.statusCode === 200, `Admin access returned ${access.statusCode}; expected 200. Body: ${access.body}`);
  assert(access.json<{ mode: string }>().mode === "mvp-access-postgres", "Admin access must be using Postgres access repository.");

  const ticketPayload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title: `Postgres road hazard ${runId}`,
    description: "A deep pothole is blocking buses and two-wheelers near the junction during peak hours.",
    phone,
    reference: `pg-smoke-${runId}`,
    departmentHint: "Municipal Administration and Water Supply",
    location: {
      district: "Chennai",
      area: "Velachery",
      address: "Velachery Main Road near bus stop",
      landmark: "Near ward office",
    },
    evidence: [
      {
        fileName: `pothole-${runId}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 742_000,
      },
    ],
  });

  const create = await app.inject({
    method: "POST",
    url: "/api/tickets",
    headers: {
      "idempotency-key": `pg-create-${runId}`,
      "x-whistle-correlation-id": createCorrelationId,
    },
    payload: ticketPayload,
  });
  assert(create.statusCode === 201, `Ticket create returned ${create.statusCode}; expected 201. Body: ${create.body}`);
  assert(create.headers["x-whistle-correlation-id"] === createCorrelationId, "Postgres create response should echo x-whistle-correlation-id.");
  const createdTicket = create.json<{ ticket: { id: string; status: string; citizenPhoneHash?: string } }>().ticket;
  assert(createdTicket.status === "submitted", `New Postgres ticket status should be submitted; got ${createdTicket.status}.`);
  assert(!("citizenPhoneHash" in createdTicket), "Citizen phone hash must not be exposed in ticket create response.");

  const protectedTicketPayload = await withVerifiedPhone(app, {
    category: "corruption",
    language: "en",
    title: `Postgres protected report ${runId}`,
    description: "A citizen reports a demand for unofficial payment before a local office will process a service request.",
    phone: protectedPhone,
    reference: `pg-protected-smoke-${runId}`,
    departmentHint: "Revenue Department",
    location: {
      district: "Chennai",
      area: "Velachery",
      address: "Protected intake smoke location",
      landmark: "Taluk office",
    },
    evidence: [
      {
        fileName: `protected-${runId}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 384_000,
      },
    ],
  });

  const protectedCreate = await app.inject({
    method: "POST",
    url: "/api/tickets",
    headers: {
      "idempotency-key": `pg-protected-create-${runId}`,
      "x-whistle-correlation-id": protectedCreateCorrelationId,
    },
    payload: protectedTicketPayload,
  });
  assert(protectedCreate.statusCode === 201, `Protected ticket create returned ${protectedCreate.statusCode}; expected 201. Body: ${protectedCreate.body}`);
  const protectedTicket = protectedCreate.json<{ ticket: { id: string; status: string; protected: boolean; citizenPhoneHash?: string } }>().ticket;
  assert(protectedTicket.protected, "Corruption smoke ticket should enter the protected track.");
  assert(!("citizenPhoneHash" in protectedTicket), "Protected ticket create response must not expose citizen phone hash.");

  const replay = await app.inject({
    method: "POST",
    url: "/api/tickets",
    headers: { "idempotency-key": `pg-create-${runId}` },
    payload: ticketPayload,
  });
  assert(replay.statusCode === 200, `Idempotent replay returned ${replay.statusCode}; expected 200. Body: ${replay.body}`);
  assert(replay.json<{ ticket: { id: string }; idempotent?: boolean }>().ticket.id === createdTicket.id, "Idempotent replay should return the same persisted ticket.");

  await closeApp(app);

  const restartedApp = await startApp();
  try {
    const myTickets = await restartedApp.inject({
      method: "GET",
      url: `/api/citizen/tickets?phone=${encodeURIComponent(phone)}`,
      headers: citizenHeaders(ticketPayload.phoneVerificationToken),
    });
    assert(myTickets.statusCode === 200, `Citizen tickets returned ${myTickets.statusCode}; expected 200. Body: ${myTickets.body}`);
    assert(
      myTickets.json<{ tickets: Array<{ id: string }> }>().tickets.some((ticket) => ticket.id === createdTicket.id),
      "Citizen My Tickets must find the ticket after an API restart.",
    );

    const directTicket = await restartedApp.inject({
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(createdTicket.id)}`,
      headers: citizenHeaders(ticketPayload.phoneVerificationToken),
    });
    assert(directTicket.statusCode === 200, `Citizen direct ticket returned ${directTicket.statusCode}; expected 200. Body: ${directTicket.body}`);
    assert(directTicket.json<{ ticket: { id: string } }>().ticket.id === createdTicket.id, "Verified citizen token should open its own persisted ticket.");

    const uploadSessionResponse = await restartedApp.inject({
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(createdTicket.id)}/evidence/upload-session`,
      headers: citizenHeaders(ticketPayload.phoneVerificationToken),
      payload: {
        fileName: `pg-follow-up-${runId}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 512_000,
      },
    });
    assert(uploadSessionResponse.statusCode === 201, `Evidence upload-session returned ${uploadSessionResponse.statusCode}; expected 201. Body: ${uploadSessionResponse.body}`);
    const uploadSession = uploadSessionResponse.json<{ session: EvidenceUploadSession }>().session;

    const earlyEvidenceScan = await restartedApp.inject({
      method: "POST",
      url: "/api/jobs/evidence-scans/run",
      headers: workerHeaders,
      payload: { actor: "worker:prototype" },
    });
    assert(earlyEvidenceScan.statusCode === 200, `Early evidence scan returned ${earlyEvidenceScan.statusCode}; expected 200. Body: ${earlyEvidenceScan.body}`);
    assert(
      earlyEvidenceScan.json<{ result: EvidenceScanJobResult }>().result.actions.every((action) => action.evidenceId !== uploadSession.evidence.id),
      "Postgres evidence scan must ignore upload_pending evidence.",
    );

    const completeUpload = await restartedApp.inject({
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(createdTicket.id)}/evidence/${encodeURIComponent(uploadSession.evidence.id)}/complete-upload`,
      headers: citizenHeaders(ticketPayload.phoneVerificationToken),
      payload: {
        mimeType: "image/jpeg",
        sizeBytes: 512_000,
        checksum: `mvp-sha256:pg-${runId}`,
      },
    });
    assert(completeUpload.statusCode === 200, `Evidence complete-upload returned ${completeUpload.statusCode}; expected 200. Body: ${completeUpload.body}`);
    assert(completeUpload.json<{ evidence: { storageState: string } }>().evidence.storageState === "scan_pending", "Postgres upload completion should persist scan_pending.");

    const completedEvidenceScan = await restartedApp.inject({
      method: "POST",
      url: "/api/jobs/evidence-scans/run",
      headers: workerHeaders,
      payload: { actor: "worker:prototype" },
    });
    assert(completedEvidenceScan.statusCode === 200, `Completed evidence scan returned ${completedEvidenceScan.statusCode}; expected 200. Body: ${completedEvidenceScan.body}`);
    const completedScanAction = completedEvidenceScan
      .json<{ result: EvidenceScanJobResult }>()
      .result.actions.find((action) => action.evidenceId === uploadSession.evidence.id);
    assert(completedScanAction?.toState === "available", "Postgres evidence scan should process completed uploads into available state.");
    assert(completedScanAction.reason.includes("Local scanner"), "Postgres evidence scan should use the configured object-store scanner seam.");

    const verificationEvidence = await restartedApp.inject({
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(createdTicket.id)}/evidence?role=verification&actor=verification%3Aprototype`,
      headers: verificationHeaders,
    });
    assert(verificationEvidence.statusCode === 200, `Verification evidence returned ${verificationEvidence.statusCode}; expected 200. Body: ${verificationEvidence.body}`);
    assert(
      verificationEvidence
        .json<{ evidence: EvidenceAccessResult }>()
        .evidence.items.some((item) => item.id === uploadSession.evidence.id && item.storageState === "available" && item.accessLevel === "preview"),
      "Verification should preview completed and scanned evidence from Postgres.",
    );

    const verificationQueue = await restartedApp.inject({
      method: "GET",
      url: `/api/verification/queue?q=${encodeURIComponent(createdTicket.id)}`,
      headers: verificationHeaders,
    });
    assert(verificationQueue.statusCode === 200, `Verification queue returned ${verificationQueue.statusCode}; expected 200. Body: ${verificationQueue.body}`);
    assert(
      verificationQueue.json<{ tickets: Array<{ id: string }> }>().tickets.some((ticket) => ticket.id === createdTicket.id),
      "Persisted submitted ticket must appear in verification queue.",
    );

    const route = await restartedApp.inject({
      method: "POST",
      url: `/api/verification/${encodeURIComponent(createdTicket.id)}/decision`,
      headers: {
        ...verificationHeaders,
        "idempotency-key": `pg-route-${runId}`,
        "x-request-id": routeCorrelationId,
      },
      payload: {
        action: "route_local",
        actor: "verification:prototype",
        reason: "Postgres smoke confirms the complaint has complete road-location evidence.",
        ownerKey: "ward:48",
        ownerLabel: "Ward 48 Local Owner",
        scopeValue: "Ward 48",
      },
    });
    assert(route.statusCode === 200, `Verification route returned ${route.statusCode}; expected 200. Body: ${route.body}`);
    assert(route.headers["x-whistle-correlation-id"] === routeCorrelationId, "Postgres route response should echo x-request-id as Whistle correlation id.");
    assert(route.json<{ ticket: { status: string; primaryQueue: { kind: string } } }>().ticket.primaryQueue.kind === "local", "Verification route should persist local ownership.");

    const dashboard = await restartedApp.inject({
      method: "GET",
      url: `/api/dashboard?role=cm_cell&q=${encodeURIComponent(createdTicket.id)}`,
      headers: cmCellHeaders,
    });
    assert(dashboard.statusCode === 200, `CM dashboard returned ${dashboard.statusCode}; expected 200. Body: ${dashboard.body}`);
    const dashboardBody = dashboard.json<{
      dashboard: {
        readModel: { source: string; aggregateStrategy: string; ticketRowsHydrated: number; scopedTicketTotal: number };
        ticketWindow: { limit: number; returned: number; total: number; nextCursor: string | null };
        kpis: { openTickets: number };
        tickets: Array<{ id: string }>;
      };
    }>().dashboard;
    assert(dashboardBody.readModel.source === "postgres_sql_projection", `Postgres dashboard should use SQL projection read model. Got: ${dashboardBody.readModel.source}`);
    assert(dashboardBody.readModel.aggregateStrategy === "bounded_sql_aggregates", "Postgres dashboard should calculate KPIs/groupings with bounded SQL aggregates.");
    assert(dashboardBody.readModel.ticketRowsHydrated === dashboardBody.tickets.length, "Postgres dashboard read model should hydrate only returned ticket rows.");
    assert(dashboardBody.ticketWindow.returned === dashboardBody.tickets.length, "Postgres dashboard window should match returned ticket rows.");
    assert(dashboardBody.ticketWindow.total >= dashboardBody.tickets.length, "Postgres dashboard window should report total scoped rows.");
    assert(
      dashboardBody.tickets.some((ticket) => ticket.id === createdTicket.id),
      "CM Cell dashboard must include the persisted routed ticket.",
    );

    const cursorDashboard = await restartedApp.inject({
      method: "GET",
      url: "/api/dashboard?role=cm_cell&ticketLimit=1",
      headers: cmCellHeaders,
    });
    assert(cursorDashboard.statusCode === 200, `Cursor seed dashboard returned ${cursorDashboard.statusCode}; expected 200. Body: ${cursorDashboard.body}`);
    const cursorSeed = cursorDashboard.json<{
      dashboard: {
        ticketWindow: { total: number; nextCursor: string | null };
        tickets: Array<{ id: string }>;
      };
    }>().dashboard;
    if (cursorSeed.ticketWindow.total > 1) {
      assert(cursorSeed.ticketWindow.nextCursor, "Postgres dashboard should return nextCursor when a cursor window has more rows.");
      const cursorNext = await restartedApp.inject({
        method: "GET",
        url: `/api/dashboard?role=cm_cell&ticketLimit=1&ticketCursor=${encodeURIComponent(cursorSeed.ticketWindow.nextCursor)}`,
        headers: cmCellHeaders,
      });
      assert(cursorNext.statusCode === 200, `Cursor next dashboard returned ${cursorNext.statusCode}; expected 200. Body: ${cursorNext.body}`);
      const cursorNextBody = cursorNext.json<{ dashboard: { ticketWindow: { cursor: string | null; nextOffset: number | null }; tickets: Array<{ id: string }> } }>().dashboard;
      assert(cursorNextBody.ticketWindow.cursor === cursorSeed.ticketWindow.nextCursor, "Postgres dashboard should echo the supplied cursor.");
      assert(cursorNextBody.ticketWindow.nextOffset === null, "Postgres dashboard cursor windows should not advertise offset continuation.");
      assert(cursorNextBody.tickets[0]?.id !== cursorSeed.tickets[0]?.id, "Postgres dashboard cursor should advance past the prior ticket row.");
    }

    const dashboardExplanation = await restartedApp.inject({
      method: "GET",
      url: `/api/dashboard/explain?role=cm_cell&q=${encodeURIComponent(createdTicket.id)}`,
      headers: adminHeaders,
    });
    assert(dashboardExplanation.statusCode === 200, `CM dashboard explanation returned ${dashboardExplanation.statusCode}; expected 200. Body: ${dashboardExplanation.body}`);
    const explanationBody = dashboardExplanation.json<{
      explanation: {
        source: {
          inputRecords: number;
          scopedRecords: number;
          projection: { source: string; aggregateStrategy: string; ticketRowsHydrated: number; scopedTicketTotal: number };
        };
        kpis: Array<{ key: string; value: number }>;
      };
    }>().explanation;
    assert(explanationBody.source.projection.source === "postgres_sql_projection", `Postgres dashboard explanation should use SQL projection source. Got: ${explanationBody.source.projection.source}`);
    assert(explanationBody.source.projection.aggregateStrategy === "bounded_sql_aggregates", "Postgres dashboard explanation should use bounded SQL aggregates.");
    assert(explanationBody.source.projection.ticketRowsHydrated === dashboardBody.readModel.ticketRowsHydrated, "Explanation projection metadata should match dashboard hydration.");
    assert(explanationBody.source.scopedRecords === dashboardBody.ticketWindow.total, "Explanation scoped records should match dashboard total.");
    assert(explanationBody.source.inputRecords >= dashboardBody.ticketWindow.total, "Explanation input record count should be at least the scoped dashboard total.");
    assert(
      explanationBody.kpis.some((kpi) => kpi.key === "openTickets" && kpi.value === dashboardBody.kpis.openTickets),
      "Postgres explanation should expose KPI values derived from the SQL projection.",
    );

    const auditPage = await restartedApp.inject({
      method: "GET",
      url: "/api/audit?limit=1",
      headers: adminHeaders,
    });
    assert(auditPage.statusCode === 200, `Postgres audit page returned ${auditPage.statusCode}; expected 200. Body: ${auditPage.body}`);
    const auditPageBody = auditPage.json<{ auditEvents: Array<{ id: string }>; page: { hasMore: boolean; nextCursor: string | null } }>();
    if (auditPageBody.page.hasMore) {
      assert(auditPageBody.page.nextCursor, "Postgres audit page should expose nextCursor when more audit rows exist.");
      const auditNext = await restartedApp.inject({
        method: "GET",
        url: `/api/audit?limit=1&cursor=${encodeURIComponent(auditPageBody.page.nextCursor)}`,
        headers: adminHeaders,
      });
      assert(auditNext.statusCode === 200, `Postgres audit cursor page returned ${auditNext.statusCode}; expected 200. Body: ${auditNext.body}`);
      const auditNextBody = auditNext.json<{ auditEvents: Array<{ id: string }>; page: { cursor: string | null; nextOffset: number | null } }>();
      assert(auditNextBody.page.cursor === auditPageBody.page.nextCursor, "Postgres audit cursor page should echo the supplied cursor.");
      assert(auditNextBody.page.nextOffset === null, "Postgres audit cursor windows should not advertise offset continuation.");
      assert(auditNextBody.auditEvents[0]?.id !== auditPageBody.auditEvents[0]?.id, "Postgres audit cursor should advance past the prior audit row.");
    }

    const outboxPage = await restartedApp.inject({
      method: "GET",
      url: "/api/notifications/outbox?limit=1",
      headers: adminHeaders,
    });
    assert(outboxPage.statusCode === 200, `Postgres notification outbox page returned ${outboxPage.statusCode}; expected 200. Body: ${outboxPage.body}`);
    const outboxPageBody = outboxPage.json<{ notifications: Array<{ id: string }>; page: { hasMore: boolean; nextCursor: string | null } }>();
    if (outboxPageBody.page.hasMore) {
      assert(outboxPageBody.page.nextCursor, "Postgres notification outbox should expose nextCursor when more notification rows exist.");
      const outboxNext = await restartedApp.inject({
        method: "GET",
        url: `/api/notifications/outbox?limit=1&cursor=${encodeURIComponent(outboxPageBody.page.nextCursor)}`,
        headers: adminHeaders,
      });
      assert(outboxNext.statusCode === 200, `Postgres notification outbox cursor page returned ${outboxNext.statusCode}; expected 200. Body: ${outboxNext.body}`);
      const outboxNextBody = outboxNext.json<{ notifications: Array<{ id: string }>; page: { cursor: string | null; nextOffset: number | null } }>();
      assert(outboxNextBody.page.cursor === outboxPageBody.page.nextCursor, "Postgres notification cursor page should echo the supplied cursor.");
      assert(outboxNextBody.page.nextOffset === null, "Postgres notification cursor windows should not advertise offset continuation.");
      assert(outboxNextBody.notifications[0]?.id !== outboxPageBody.notifications[0]?.id, "Postgres notification cursor should advance past the prior row.");
    }

    const notifications = await restartedApp.inject({
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(createdTicket.id)}/notifications`,
      headers: citizenHeaders(ticketPayload.phoneVerificationToken),
    });
    assert(notifications.statusCode === 200, `Citizen notifications returned ${notifications.statusCode}; expected 200. Body: ${notifications.body}`);
    assert(notifications.json<{ notifications: unknown[] }>().notifications.length >= 1, "Persisted ticket should expose citizen-safe notification history.");

    const audit = await restartedApp.inject({
      method: "GET",
      url: `/api/audit?ticketId=${encodeURIComponent(createdTicket.id)}`,
      headers: cmCellHeaders,
    });
    assert(audit.statusCode === 200, `Audit returned ${audit.statusCode}; expected 200. Body: ${audit.body}`);
    const auditEvents = audit.json<{ auditEvents: AuditEvent[] }>().auditEvents;
    assert(auditEvents.length >= 2, "Postgres audit ledger should include create and route events.");
    assert(auditEvents.some((event) => event.action === "ticket.create" && event.correlationId === createCorrelationId), "Postgres ticket.create audit should preserve request correlation id.");
    assert(auditEvents.some((event) => event.action === "verification.route_local" && event.correlationId === routeCorrelationId), "Postgres route audit should preserve request correlation id.");
    assert(auditEvents.every((event) => event.previousHash && event.eventHash && event.chainSequence), "Postgres ticket audit events should include hash-chain metadata.");

    const hashedEvents = (await fetchAllAuditEvents(restartedApp, cmCellHeaders))
      .filter((event) => event.previousHash && event.eventHash)
      .sort((left, right) => (left.chainSequence ?? 0) - (right.chainSequence ?? 0));
    const chain = verifyAuditHashChain(hashedEvents);
    assert(chain.ok, chain.reason);
    const auditEventForMutationCheck = auditEvents.find((event) => event.action === "ticket.create")?.id ?? auditEvents[0]?.id;
    assert(auditEventForMutationCheck, "Postgres audit append-only check needs at least one persisted audit event id.");
    await assertAuditLedgerAppendOnly(databaseUrl, auditEventForMutationCheck);
    await assertTicketStatusHistory(databaseUrl, createdTicket.id);
    await assertPostgresRlsScopes(databaseUrl, createdTicket.id, protectedTicket.id);
  } finally {
    await closeApp(restartedApp);
  }

  console.log("PASS Postgres-backed ticket spine persists OTP, ticket, idempotency, routing, dashboards, notifications, append-only audit, status history, and RLS scope guards.");
} catch (error) {
  try {
    await closeApp(app);
  } catch {
    // App may already be closed after the restart phase.
  }
  throw error;
}
