import { buildWhistleApi } from "../server/app.js";
import type { AuditEvent, DashboardBriefRun, SlaJobResult, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const verificationHeaders = {
  "x-whistle-role": "verification",
  "x-whistle-actor": "verification:prototype",
};

const workerHeaders = {
  "x-whistle-role": "worker",
  "x-whistle-actor": "worker:prototype",
};

const cmHeaders = {
  "x-whistle-role": "cm_cell",
  "x-whistle-actor": "cm_cell:prototype",
};

const ministerHeaders = {
  "x-whistle-role": "minister",
  "x-whistle-actor": "minister:prototype",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

async function jsonRequest<T>(
  app: WhistleApi,
  options: {
    method: "GET" | "POST";
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  },
  expectedStatus = 200,
) {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    headers: options.headers,
    payload: options.payload,
  });

  assert(
    response.statusCode === expectedStatus,
    `${options.method} ${options.url} returned ${response.statusCode}; expected ${expectedStatus}. Body: ${response.body}`,
  );

  return response.json<T>();
}

async function createTicket(app: WhistleApi) {
  const payload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title: "Storm drain damage near school crossing",
    description: "A storm drain slab has broken near a school crossing and two-wheelers are swerving into traffic.",
    phone: "+91 98765 80001",
    departmentHint: "Corporation / Municipality",
    location: {
      district: "Chennai",
      area: "T. Nagar",
      address: "School Road, T. Nagar",
      landmark: "Near civic school gate",
    },
    evidence: [{ fileName: "drain-slab.jpg", mimeType: "image/jpeg", sizeBytes: 620_000 }],
  });
  const result = await jsonRequest<{ ticket: TicketRecord }>(
    app,
    {
      method: "POST",
      url: "/api/tickets",
      payload,
    },
    201,
  );
  return result.ticket;
}

async function getTicket(app: WhistleApi, ticketId: string) {
  const result = await jsonRequest<{ ticket: TicketRecord }>(app, {
    method: "GET",
    url: `/api/tickets/${encodeURIComponent(ticketId)}`,
    headers: cmHeaders,
  });
  return result.ticket;
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";

  const app = buildWhistleApi();
  await app.ready();

  try {
    const ticket = await createTicket(app);
    await jsonRequest<{ ticket: TicketRecord }>(app, {
      method: "POST",
      url: `/api/verification/${encodeURIComponent(ticket.id)}/decision`,
      headers: verificationHeaders,
      payload: {
        action: "route_local",
        actor: "verification:prototype",
        reason: "Complete civic issue for local action.",
        ownerKey: "mla:t-nagar",
        ownerLabel: "T. Nagar MLA Office",
        scopeValue: "T. Nagar",
      },
    });

    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await jsonRequest<{ result: SlaJobResult }>(app, {
      method: "POST",
      url: "/api/jobs/sla-escalations/run",
      headers: workerHeaders,
      payload: { actor: "worker:prototype", now: future },
    });

    const beforeBrief = await getTicket(app, ticket.id);
    assert(beforeBrief.primaryQueue.kind === "ministry", "Setup ticket should be in ministry queue for the minister brief.");

    const ministerRun = await jsonRequest<{ run: DashboardBriefRun }>(
      app,
      {
        method: "POST",
        url: "/api/dashboard/briefs",
        headers: ministerHeaders,
        payload: {
          role: "minister",
          ministry: "Municipal Administration and Water Supply",
        },
      },
      201,
    );
    assert(ministerRun.run.role === "minister", "Minister brief should be scoped to minister role.");
    assert(ministerRun.run.scope.ministry === "Municipal Administration and Water Supply", "Minister brief should preserve the requested ministry scope.");
    assert(ministerRun.run.brief.recommendedActions.length > 0, "Minister brief should include recommended actions.");
    assert(ministerRun.run.brief.nonMutationGuarantee.includes("cannot change ticket status"), "Minister brief should state non-mutation guarantee.");
    pass("minister can generate a scoped recommend-only SLA brief");

    await jsonRequest(
      app,
      {
        method: "POST",
        url: "/api/dashboard/briefs",
        headers: ministerHeaders,
        payload: {
          role: "minister",
          ministry: "Energy",
        },
      },
      403,
    );
    pass("minister cannot generate a brief outside assigned ministries");

    const cmRun = await jsonRequest<{ run: DashboardBriefRun }>(
      app,
      {
        method: "POST",
        url: "/api/dashboard/briefs",
        headers: cmHeaders,
        payload: {
          role: "cm_cell",
        },
      },
      201,
    );
    assert(cmRun.run.role === "cm_cell", "CM Cell brief should be scoped to CM Cell role.");
    assert(cmRun.run.brief.focusAreas.length > 0, "CM Cell brief should include focus areas.");
    assert(cmRun.run.brief.watchlist.some((item) => item.ticketId === ticket.id), "CM Cell brief should include the active ticket in its watchlist.");
    pass("CM Cell can generate statewide SLA risk brief");

    const afterBrief = await getTicket(app, ticket.id);
    assert(afterBrief.status === beforeBrief.status, "Dashboard brief must not mutate ticket status.");
    assert(afterBrief.primaryQueue.kind === beforeBrief.primaryQueue.kind, "Dashboard brief must not mutate primary queue.");
    assert(afterBrief.sla.stage === beforeBrief.sla.stage && afterBrief.sla.state === beforeBrief.sla.state, "Dashboard brief must not mutate SLA state.");
    assert(afterBrief.updatedAt === beforeBrief.updatedAt, "Dashboard brief must not update ticket updatedAt.");
    pass("dashboard briefs do not mutate ticket lifecycle state");

    const audit = await jsonRequest<{ auditEvents: AuditEvent[] }>(app, {
      method: "GET",
      url: "/api/audit",
      headers: cmHeaders,
    });
    assert(audit.auditEvents.some((event) => event.action === "agent.dashboard_brief.created"), "Dashboard brief generation should be audit logged.");
    pass("dashboard brief run is audit logged");

    pass("dashboard brief smoke completed");
  } finally {
    await app.close();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
    else delete process.env.DATABASE_URL;
    if (originalSeedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
    else process.env.WHISTLE_SEED_DEMO = originalSeedDemo;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
