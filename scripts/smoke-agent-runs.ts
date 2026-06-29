import { buildWhistleApi } from "../server/app.js";
import type { AgentRecommendationRun, AuditEvent, NotificationIntent, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const verificationHeaders = {
  "x-whistle-role": "verification",
  "x-whistle-actor": "verification:prototype",
};

const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
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
    method: "GET" | "POST" | "PATCH";
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

async function createTicket(app: WhistleApi, payload: Record<string, unknown>) {
  const verifiedPayload = await withVerifiedPhone(app, payload);
  const result = await jsonRequest<{ ticket: TicketRecord | null }>(
    app,
    {
      method: "POST",
      url: "/api/tickets",
      payload: verifiedPayload,
    },
    201,
  );
  assert(result.ticket, "Ticket should be created for agent smoke test.");
  return result.ticket;
}

async function getTicket(app: WhistleApi, ticketId: string) {
  const result = await jsonRequest<{ ticket: TicketRecord }>(app, {
    method: "GET",
    url: `/api/tickets/${encodeURIComponent(ticketId)}`,
    headers: verificationHeaders,
  });
  return result.ticket;
}

async function runAgent(app: WhistleApi, ticketId: string, headers = verificationHeaders) {
  const result = await jsonRequest<{ run: AgentRecommendationRun }>(
    app,
    {
      method: "POST",
      url: `/api/verification/${encodeURIComponent(ticketId)}/agent-runs`,
      headers,
    },
    201,
  );
  return result.run;
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";

  const app = buildWhistleApi();
  await app.ready();

  try {
    const sparseTicket = await createTicket(app, {
      category: "roads",
      language: "en",
      title: "Pothole near bus stop needs repair",
      description: "There is a large pothole near the bus stop and it is risky during rain.",
      phone: "+91 98765 70001",
      location: {
        district: "Chennai",
        area: "Anna Nagar",
      },
      evidence: [],
    });

    const beforeTicket = await getTicket(app, sparseTicket.id);
    const beforeNotifications = await jsonRequest<{ notifications: NotificationIntent[] }>(app, {
      method: "GET",
      url: `/api/notifications/outbox?ticketId=${encodeURIComponent(sparseTicket.id)}`,
      headers: verificationHeaders,
    });

    const run = await runAgent(app, sparseTicket.id);
    assert(run.ticketId === sparseTicket.id, "Agent run should be tied to the target ticket.");
    assert(run.purpose === "intake_verification", "Agent run should use the intake verification purpose.");
    assert(run.recommendation.primaryAction === "request_info", "Sparse non-protected ticket should recommend requesting more information.");
    assert(run.recommendation.missingFields.includes("address or landmark"), "Recommendation should identify missing location detail.");
    assert(run.recommendation.missingFields.includes("supporting photo or reference"), "Recommendation should identify missing evidence.");
    assert(run.recommendation.nonMutationGuarantee.includes("cannot change ticket status"), "Recommendation should state the non-mutation guarantee.");
    pass("verification can create a recommend-only intake packet");

    const afterTicket = await getTicket(app, sparseTicket.id);
    assert(afterTicket.status === beforeTicket.status, "Agent run must not mutate ticket status.");
    assert(afterTicket.primaryQueue.kind === beforeTicket.primaryQueue.kind, "Agent run must not mutate primary queue.");
    assert(afterTicket.sla.stage === beforeTicket.sla.stage && afterTicket.sla.state === beforeTicket.sla.state, "Agent run must not mutate SLA state.");
    assert(afterTicket.updatedAt === beforeTicket.updatedAt, "Agent run must not update ticket updatedAt.");
    assert(afterTicket.citizenTimeline.length === beforeTicket.citizenTimeline.length, "Agent run must not add citizen timeline events.");
    assert(afterTicket.governmentEvents.length === beforeTicket.governmentEvents.length, "Agent run must not add government timeline events.");

    const afterNotifications = await jsonRequest<{ notifications: NotificationIntent[] }>(app, {
      method: "GET",
      url: `/api/notifications/outbox?ticketId=${encodeURIComponent(sparseTicket.id)}`,
      headers: verificationHeaders,
    });
    assert(afterNotifications.notifications.length === beforeNotifications.notifications.length, "Agent run must not queue notifications.");
    pass("recommendation run does not mutate ticket, SLA, timeline, or notifications");

    const agentRuns = await jsonRequest<{ runs: AgentRecommendationRun[] }>(app, {
      method: "GET",
      url: `/api/verification/${encodeURIComponent(sparseTicket.id)}/agent-runs`,
      headers: verificationHeaders,
    });
    assert(agentRuns.runs.some((item) => item.id === run.id), "Agent run history should include the created recommendation.");

    const audit = await jsonRequest<{ auditEvents: AuditEvent[] }>(app, {
      method: "GET",
      url: `/api/audit?ticketId=${encodeURIComponent(sparseTicket.id)}`,
      headers: verificationHeaders,
    });
    assert(audit.auditEvents.some((event) => event.entityType === "agent" && event.action === "agent.recommendation.created"), "Agent run should be audit logged.");
    pass("agent run history and audit ledger are inspectable");

    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(sparseTicket.id)}/agent-runs`,
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );
    pass("minister role cannot create intake recommendations");

    const protectedTicket = await createTicket(app, {
      category: "corruption",
      language: "en",
      title: "Bribe demand at local office",
      description: "An official demanded an unofficial cash payment to process a certificate and warned against complaining.",
      phone: "+91 98765 70002",
      departmentHint: "Revenue",
      location: {
        district: "Madurai",
        area: "Taluk Office",
        landmark: "Main counter",
      },
      evidence: [{ fileName: "receipt-note.jpg", mimeType: "image/jpeg", sizeBytes: 410_000 }],
    });
    const protectedRun = await runAgent(app, protectedTicket.id);
    assert(protectedRun.recommendation.primaryAction === "route_protected", "Protected/corruption ticket should recommend protected routing.");
    assert(protectedRun.recommendation.protectedSignal.flagged, "Protected recommendation should carry protected signal flags.");
    pass("protected corruption intake receives protected-track recommendation");

    // Admin kill switch: the recommend-only intake agent can be disabled and re-enabled.
    await jsonRequest(app, {
      method: "PATCH",
      url: "/api/admin/config/app-controls/feature-agent-intake",
      headers: adminHeaders,
      payload: { value: false },
    });
    const disabled = await jsonRequest<{ error: string }>(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(sparseTicket.id)}/agent-runs`,
        headers: verificationHeaders,
      },
      403,
    );
    assert(disabled.error === "agent_intake_disabled", "Disabled intake agent should report agent_intake_disabled.");
    await jsonRequest(app, {
      method: "PATCH",
      url: "/api/admin/config/app-controls/feature-agent-intake",
      headers: adminHeaders,
      payload: { value: true },
    });
    await runAgent(app, sparseTicket.id);
    pass("Admin can disable and re-enable the recommend-only intake agent feature flag");

    pass("agent recommendation smoke completed");
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
