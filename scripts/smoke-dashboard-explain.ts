process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;
process.env.WHISTLE_SEED_DEMO = "false";

const { buildWhistleApi } = await import("../server/app.js");
const { withVerifiedPhone } = await import("./smoke-helpers.js");
import type { DashboardExplanation, RoleDashboard, TicketRecord } from "../server/ticket-spine/types.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
};

const verificationHeaders = {
  "x-whistle-role": "verification",
  "x-whistle-actor": "verification:prototype",
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
  const response = await app.inject(options);
  assert(response.statusCode === expectedStatus, `${options.method} ${options.url} returned ${response.statusCode}; expected ${expectedStatus}. Body: ${response.body}`);
  return response.json<T>();
}

async function createTicket(app: WhistleApi, payload: Record<string, unknown>) {
  const verifiedPayload = await withVerifiedPhone(app, payload);
  const result = await jsonRequest<{ ticket: TicketRecord }>(
    app,
    {
      method: "POST",
      url: "/api/tickets",
      payload: verifiedPayload,
    },
    201,
  );
  return result.ticket;
}

function kpiValue(explanation: DashboardExplanation, key: keyof RoleDashboard["kpis"]) {
  const kpi = explanation.kpis.find((item) => item.key === key);
  assert(kpi, `Explanation should include KPI ${key}.`);
  return kpi.value;
}

const app = buildWhistleApi();
await app.ready();

try {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const roadTicket = await createTicket(app, {
    category: "roads",
    language: "en",
    title: `Dashboard explanation road issue ${runId}`,
    description: "A road issue for dashboard count explainability testing with sufficient civic detail.",
    phone: `+9193${Date.now().toString().slice(-8)}`,
    departmentHint: "Municipal Administration and Water Supply",
    location: {
      district: "Chennai",
      area: "Velachery",
      address: "Dashboard explanation road",
      landmark: "Ward office",
    },
    evidence: [],
  });

  const protectedTicket = await createTicket(app, {
    category: "corruption",
    language: "en",
    title: `Dashboard explanation protected issue ${runId}`,
    description: "A protected complaint for verifying dashboard explanations do not leak protected detail.",
    phone: `+9192${Date.now().toString().slice(-8)}`,
    departmentHint: "Revenue Department",
    location: {
      district: "Chennai",
      area: "Velachery",
      address: "Protected dashboard explanation location",
      landmark: "Taluk office",
    },
    evidence: [],
  });
  assert(protectedTicket.protected, "Corruption setup ticket should be protected.");

  await jsonRequest<{ ticket: TicketRecord }>(app, {
    method: "POST",
    url: `/api/verification/${encodeURIComponent(roadTicket.id)}/decision`,
    headers: verificationHeaders,
    payload: {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Complete issue for dashboard explanation routing.",
      ownerKey: "ward:48",
      ownerLabel: "Ward 48 Local Owner",
      scopeValue: "Ward 48",
    },
  });

  const cmDashboard = await jsonRequest<{ dashboard: RoleDashboard }>(app, {
    method: "GET",
    url: "/api/dashboard?role=cm_cell",
    headers: cmHeaders,
  });
  const adminExplanation = await jsonRequest<{ explanation: DashboardExplanation }>(app, {
    method: "GET",
    url: "/api/dashboard/explain?role=cm_cell",
    headers: adminHeaders,
  });
  assert(adminExplanation.explanation.role === "cm_cell", "Admin explanation should explain the requested CM Cell dashboard role.");
  assert(adminExplanation.explanation.source.inputRecords >= 2, "Explanation should disclose input record count.");
  assert(adminExplanation.explanation.source.projection.source === "ticket_graph", "Dev-memory explanation should disclose the ticket-graph projection source.");
  assert(adminExplanation.explanation.source.projection.ticketRowsHydrated === cmDashboard.dashboard.tickets.length, "Explanation projection metadata should match dashboard row hydration.");
  assert(adminExplanation.explanation.source.projection.scopedTicketTotal === cmDashboard.dashboard.ticketWindow.total, "Explanation projection metadata should match dashboard scoped totals.");
  assert(adminExplanation.explanation.source.sourceTables.includes("tickets"), "Explanation should name source tables.");
  assert(kpiValue(adminExplanation.explanation, "openTickets") === cmDashboard.dashboard.kpis.openTickets, "Open-ticket explanation value should match dashboard KPI.");
  assert(kpiValue(adminExplanation.explanation, "protectedCount") === cmDashboard.dashboard.kpis.protectedCount, "Protected-count explanation value should match dashboard KPI.");
  assert(adminExplanation.explanation.privacyGuarantees.some((item) => item.includes("phone")), "Explanation should state privacy guarantees.");
  pass("Admin can explain CM Cell dashboard counts without opening an operational ticket queue");

  const ministerExplanation = await jsonRequest<{ explanation: DashboardExplanation }>(app, {
    method: "GET",
    url: "/api/dashboard/explain?role=minister&ministry=Municipal%20Administration%20and%20Water%20Supply",
    headers: ministerHeaders,
  });
  assert(ministerExplanation.explanation.role === "minister", "Minister explanation should preserve role.");
  assert(kpiValue(ministerExplanation.explanation, "protectedCount") === 0, "Minister explanation should not count protected tickets.");
  assert(ministerExplanation.explanation.visibility.hiddenProtectedRecords === null, "Minister explanation should redact exact hidden protected-ticket counts.");
  assert(ministerExplanation.explanation.visibility.hiddenProtectedRecordsRedacted, "Minister explanation should flag hidden protected-ticket counts as redacted.");
  assert(ministerExplanation.explanation.appliedFilters.some((filter) => filter.key === "ministry"), "Minister explanation should show the ministry filter rule.");
  pass("Role explanations preserve ministry scope and protected-ticket masking");

  await jsonRequest(
    app,
    {
      method: "GET",
      url: "/api/dashboard/explain?role=cm_cell",
      headers: ministerHeaders,
    },
    403,
  );
  pass("Non-Admin roles cannot explain another role's dashboard");

  const redactedSearch = await jsonRequest<{ explanation: DashboardExplanation }>(app, {
    method: "GET",
    url: "/api/dashboard/explain?role=cm_cell&q=very-sensitive-search-text",
    headers: adminHeaders,
  });
  assert(redactedSearch.explanation.appliedFilters.some((filter) => filter.key === "q" && filter.value === "redacted search text"), "Search text should be redacted in explanations.");

  const serialized = JSON.stringify([adminExplanation.explanation, ministerExplanation.explanation, redactedSearch.explanation]);
  assert(!serialized.includes(roadTicket.id), "Dashboard explanations must not include ticket ids.");
  assert(!serialized.includes(roadTicket.title), "Dashboard explanations must not include ticket titles.");
  assert(!serialized.includes("very-sensitive-search-text"), "Dashboard explanations must not echo raw search text.");
  pass("dashboard explanations expose count logic without ticket details or raw search text");
} finally {
  await app.close();
}
