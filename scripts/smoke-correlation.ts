process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;

const { buildWhistleApi } = await import("../server/app.js");
const { withVerifiedPhone } = await import("./smoke-helpers.js");
import type { AuditEvent, TicketRecord } from "../server/ticket-spine/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

const app = buildWhistleApi();
await app.ready();

try {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createCorrelationId = `corr-create-${runId}`;
  const routeCorrelationId = `corr-route-${runId}`;
  const payload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title: `Correlation smoke road issue ${runId}`,
    description: "A road cave-in near the bus stop needs urgent verification and local routing for repair.",
    phone: `+9197${Date.now().toString().slice(-8)}`,
    departmentHint: "Municipal Administration and Water Supply",
    location: {
      district: "Chennai",
      area: "Velachery",
      address: "Velachery Main Road near the bus stop",
    },
    evidence: [],
  });

  const create = await app.inject({
    method: "POST",
    url: "/api/tickets",
    headers: {
      "x-whistle-correlation-id": createCorrelationId,
      "idempotency-key": `corr-create-${runId}`,
    },
    payload,
  });
  assert(create.statusCode === 201, `Ticket create returned ${create.statusCode}; expected 201. Body: ${create.body}`);
  assert(create.headers["x-whistle-correlation-id"] === createCorrelationId, "Create response should echo x-whistle-correlation-id.");
  const ticket = create.json<{ ticket: TicketRecord }>().ticket;

  const route = await app.inject({
    method: "POST",
    url: `/api/verification/${encodeURIComponent(ticket.id)}/decision`,
    headers: {
      "x-whistle-role": "verification",
      "x-whistle-actor": "verification:prototype",
      "x-request-id": routeCorrelationId,
      "idempotency-key": `corr-route-${runId}`,
    },
    payload: {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Correlation smoke confirms the request id is copied into audit events.",
      ownerKey: "ward:48",
      ownerLabel: "Ward 48 Local Owner",
      scopeValue: "Ward 48",
    },
  });
  assert(route.statusCode === 200, `Verification route returned ${route.statusCode}; expected 200. Body: ${route.body}`);
  assert(route.headers["x-whistle-correlation-id"] === routeCorrelationId, "Route response should echo x-request-id as Whistle correlation id.");

  const audit = await app.inject({
    method: "GET",
    url: `/api/audit?ticketId=${encodeURIComponent(ticket.id)}`,
    headers: {
      "x-whistle-role": "verification",
      "x-whistle-actor": "verification:prototype",
    },
  });
  assert(audit.statusCode === 200, `Audit returned ${audit.statusCode}; expected 200. Body: ${audit.body}`);
  const auditEvents = audit.json<{ auditEvents: AuditEvent[] }>().auditEvents;
  assert(auditEvents.some((event) => event.action === "ticket.create" && event.correlationId === createCorrelationId), "ticket.create audit event should keep the request correlation id.");
  assert(auditEvents.some((event) => event.action === "verification.route_local" && event.correlationId === routeCorrelationId), "verification.route_local audit event should keep the fallback request id.");
  pass("ticket and verification audit events preserve request correlation ids");
} finally {
  await app.close();
}
