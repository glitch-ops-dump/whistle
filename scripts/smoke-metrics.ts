process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;

const { buildWhistleApi } = await import("../server/app.js");
const { withVerifiedPhone } = await import("./smoke-helpers.js");
import type { HttpMetricsSnapshot, RouteMetrics } from "../server/observability/metrics.js";
import type { TicketRecord } from "../server/ticket-spine/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function route(metrics: HttpMetricsSnapshot, method: string, routePattern: string): RouteMetrics | undefined {
  return metrics.routes.find((item) => item.method === method && item.route === routePattern);
}

function assertRoute(metrics: HttpMetricsSnapshot, method: string, routePattern: string) {
  const entry = route(metrics, method, routePattern);
  assert(entry, `Metrics should include ${method} ${routePattern}. Routes: ${metrics.routes.map((item) => `${item.method} ${item.route}`).join(", ")}`);
  assert(entry.requests >= 1, `${method} ${routePattern} should have at least one request.`);
  assert(typeof entry.latencyMs.p95 === "number" && entry.latencyMs.p95 >= 0, `${method} ${routePattern} should include p95 latency.`);
  assert(Object.values(entry.buckets).some((count) => count >= 1), `${method} ${routePattern} should include latency bucket counts.`);
  return entry;
}

const app = buildWhistleApi();
await app.ready();

try {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const phone = `+9194${Date.now().toString().slice(-8)}`;

  const denied = await app.inject({
    method: "GET",
    url: "/api/metrics",
    headers: {
      "x-whistle-role": "minister",
      "x-whistle-actor": "minister:prototype",
    },
  });
  assert(denied.statusCode === 403, `Minister metrics request returned ${denied.statusCode}; expected 403. Body: ${denied.body}`);

  const ready = await app.inject({
    method: "GET",
    url: "/api/ready",
    headers: { "x-whistle-correlation-id": `metrics-ready-${runId}` },
  });
  assert(ready.statusCode === 200, `Readiness returned ${ready.statusCode}; expected 200. Body: ${ready.body}`);

  const payload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title: `Metrics smoke road issue ${runId}`,
    description: "A civic issue for observability metrics coverage.",
    phone,
    reference: `metrics-${runId}`,
    departmentHint: "Municipal Administration and Water Supply",
    location: {
      district: "Chennai",
      area: "Velachery",
      address: "Metrics smoke road",
      landmark: "Ward office",
    },
    evidence: [],
  });

  const lookup = await app.inject({
    method: "GET",
    url: `/api/citizen/tickets?phone=${encodeURIComponent(phone)}`,
    headers: {
      "x-whistle-citizen-phone": phone,
      "x-whistle-citizen-token": payload.phoneVerificationToken,
      "x-whistle-correlation-id": `metrics-lookup-${runId}`,
    },
  });
  assert(lookup.statusCode === 200, `Citizen lookup returned ${lookup.statusCode}; expected 200. Body: ${lookup.body}`);

  const create = await app.inject({
    method: "POST",
    url: "/api/tickets",
    headers: {
      "idempotency-key": `metrics-create-${runId}`,
      "x-whistle-correlation-id": `metrics-create-${runId}`,
    },
    payload,
  });
  assert(create.statusCode === 201, `Ticket create returned ${create.statusCode}; expected 201. Body: ${create.body}`);
  const ticket = create.json<{ ticket: TicketRecord }>().ticket;

  const status = await app.inject({
    method: "GET",
    url: `/api/tickets/${encodeURIComponent(ticket.id)}`,
    headers: {
      "x-whistle-citizen-phone": phone,
      "x-whistle-citizen-token": payload.phoneVerificationToken,
      "x-whistle-correlation-id": `metrics-status-${runId}`,
    },
  });
  assert(status.statusCode === 200, `Ticket status returned ${status.statusCode}; expected 200. Body: ${status.body}`);

  const metricsResponse = await app.inject({
    method: "GET",
    url: "/api/metrics",
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
      "x-whistle-correlation-id": `metrics-admin-${runId}`,
    },
  });
  assert(metricsResponse.statusCode === 200, `Admin metrics returned ${metricsResponse.statusCode}; expected 200. Body: ${metricsResponse.body}`);
  const metrics = metricsResponse.json<{ metrics: HttpMetricsSnapshot }>().metrics;

  assert(metrics.service === "whistle-ticket-spine", "Metrics should identify the Whistle ticket-spine service.");
  assert(metrics.requests >= 6, `Metrics should count prior requests. Got ${metrics.requests}.`);
  assert(typeof metrics.uptimeMs === "number" && metrics.uptimeMs >= 0, "Metrics should include uptime.");
  assert(metrics.statusCodes["200"] >= 1, "Metrics should include 200 status counts.");
  assert(metrics.statusCodes["201"] >= 1, "Metrics should include 201 status counts.");
  assert(metrics.statusCodes["403"] >= 1, "Metrics should include the denied metrics-read status count.");

  assertRoute(metrics, "GET", "/api/ready");
  assertRoute(metrics, "GET", "/api/citizen/tickets");
  assertRoute(metrics, "POST", "/api/tickets");
  assertRoute(metrics, "GET", "/api/tickets/:ticketId");
  const metricsRoute = assertRoute(metrics, "GET", "/api/metrics");
  assert(metricsRoute.statusCodes["403"] >= 1, "Metrics route should record denied access without exposing request details.");

  const serialized = JSON.stringify(metrics);
  assert(!serialized.includes(phone.slice(-8)), "Metrics snapshot must not include citizen phone numbers.");
  assert(!serialized.includes(ticket.title), "Metrics snapshot must not include ticket titles.");
  pass("observability metrics expose route counters and latency summaries without citizen details");
} finally {
  await app.close();
}
