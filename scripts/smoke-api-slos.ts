import { performance } from "node:perf_hooks";
import type { buildWhistleApi } from "../server/app.js";
import type { TicketRecord } from "../server/ticket-spine/types.js";

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;

const { buildWhistleApi: createApp } = await import("../server/app.js");
const { withVerifiedPhone } = await import("./smoke-helpers.js");

type WhistleApi = ReturnType<typeof buildWhistleApi>;

type TimedSample = {
  label: string;
  ms: number;
};

type CreatedTicket = {
  ticket: TicketRecord;
  phone: string;
  phoneVerificationToken: string;
};

const sampleCount = 18;
const thresholds = {
  ticketCreateP95Ms: 800,
  ticketStatusP95Ms: 300,
  verificationQueueP95Ms: 500,
  dashboardP95Ms: 1_000,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function p95(samples: TimedSample[]) {
  assert(samples.length > 0, "Cannot calculate p95 without samples.");
  const sorted = samples.map((sample) => sample.ms).sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

async function timed<T>(label: string, work: () => Promise<T>, bucket: TimedSample[]) {
  const startedAt = performance.now();
  const result = await work();
  bucket.push({ label, ms: performance.now() - startedAt });
  return result;
}

function assertP95(label: string, samples: TimedSample[], thresholdMs: number) {
  const value = p95(samples);
  assert(value <= thresholdMs, `${label} p95 ${rounded(value)}ms exceeded ${thresholdMs}ms. Samples: ${samples.map((sample) => rounded(sample.ms)).join(", ")}`);
  pass(`${label} p95 ${rounded(value)}ms stays under ${thresholdMs}ms across ${samples.length} sample(s)`);
}

async function createMeasuredTicket(app: WhistleApi, index: number, runId: string, createSamples: TimedSample[]): Promise<CreatedTicket> {
  const phone = `+9195${String(Date.now()).slice(-6)}${String(index).padStart(2, "0")}`;
  const payload = await withVerifiedPhone(app, {
    category: index % 3 === 0 ? "water" : index % 3 === 1 ? "roads" : "sanitation",
    language: index % 5 === 0 ? "ta" : "en",
    title: `SLO smoke issue ${index + 1} ${runId}`,
    description: "A civic service issue with enough location detail to exercise the ticket spine under repeated API calls.",
    phone,
    reference: `slo-${runId}-${index}`,
    departmentHint: "Municipal Administration and Water Supply",
    location: {
      district: index % 2 === 0 ? "Chennai" : "Coimbatore",
      area: index % 2 === 0 ? "Velachery" : "Peelamedu",
      address: `SLO smoke street ${index + 1}`,
      landmark: "Ward office",
    },
    evidence: [],
  });

  const create = await timed(
    "ticket-create",
    () =>
      app.inject({
        method: "POST",
        url: "/api/tickets",
        headers: {
          "idempotency-key": `slo-create-${runId}-${index}`,
          "x-whistle-correlation-id": `slo-create-${runId}-${index}`,
        },
        payload,
      }),
    createSamples,
  );
  assert(create.statusCode === 201, `Ticket create ${index + 1} returned ${create.statusCode}; expected 201. Body: ${create.body}`);
  return {
    ticket: create.json<{ ticket: TicketRecord }>().ticket,
    phone,
    phoneVerificationToken: payload.phoneVerificationToken,
  };
}

const app = createApp();
await app.ready();

try {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createSamples: TimedSample[] = [];
  const statusSamples: TimedSample[] = [];
  const queueSamples: TimedSample[] = [];
  const dashboardSamples: TimedSample[] = [];
  const tickets: CreatedTicket[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    tickets.push(await createMeasuredTicket(app, index, runId, createSamples));
  }
  assert(new Set(tickets.map((created) => created.ticket.id)).size === tickets.length, "Ticket IDs must stay unique across a burst of citizen submissions.");

  for (const created of tickets) {
    const status = await timed(
      "ticket-status",
      () =>
        app.inject({
          method: "GET",
          url: `/api/tickets/${encodeURIComponent(created.ticket.id)}`,
          headers: {
            "x-whistle-citizen-phone": created.phone,
            "x-whistle-citizen-token": created.phoneVerificationToken,
          },
        }),
      statusSamples,
    );
    assert(status.statusCode === 200, `Ticket status returned ${status.statusCode}; expected 200. Body: ${status.body}`);
    assert(status.json<{ ticket: { id: string } }>().ticket.id === created.ticket.id, "Ticket status should return the requested ticket.");
  }

  for (let index = 0; index < 8; index += 1) {
    const queue = await timed(
      "verification-queue",
      () =>
        app.inject({
          method: "GET",
          url: "/api/verification/queue",
          headers: {
            "x-whistle-role": "verification",
            "x-whistle-actor": "verification:prototype",
          },
        }),
      queueSamples,
    );
    assert(queue.statusCode === 200, `Verification queue returned ${queue.statusCode}; expected 200. Body: ${queue.body}`);
    assert(queue.json<{ tickets: Array<{ id: string }> }>().tickets.length >= sampleCount, "Verification queue should include seeded SLO tickets.");
  }

  const boundedQueue = await app.inject({
    method: "GET",
    url: "/api/verification/queue?limit=5&offset=0&q=SLO%20smoke",
    headers: {
      "x-whistle-role": "verification",
      "x-whistle-actor": "verification:prototype",
    },
  });
  assert(boundedQueue.statusCode === 200, `Bounded verification queue returned ${boundedQueue.statusCode}; expected 200. Body: ${boundedQueue.body}`);
  const boundedQueueBody = boundedQueue.json<{ tickets: Array<{ id: string }>; page: { limit: number; offset: number; cursor: string | null; returned: number; hasMore: boolean; nextOffset: number | null; nextCursor: string | null } }>();
  assert(boundedQueueBody.tickets.length === 5, `Bounded verification queue should return exactly 5 tickets. Got ${boundedQueueBody.tickets.length}.`);
  assert(boundedQueueBody.page.limit === 5 && boundedQueueBody.page.offset === 0, "Bounded verification queue should echo limit and offset.");
  assert(boundedQueueBody.page.returned === 5, "Bounded verification queue should report returned row count.");
  assert(boundedQueueBody.page.hasMore && boundedQueueBody.page.nextOffset === 5, "Bounded verification queue should expose next offset when more rows exist.");
  assert(boundedQueueBody.page.nextCursor && boundedQueueBody.page.cursor === null, "Bounded verification queue should expose nextCursor for high-volume paging.");
  const cursorQueue = await app.inject({
    method: "GET",
    url: `/api/verification/queue?limit=5&q=SLO%20smoke&cursor=${encodeURIComponent(boundedQueueBody.page.nextCursor)}`,
    headers: {
      "x-whistle-role": "verification",
      "x-whistle-actor": "verification:prototype",
    },
  });
  assert(cursorQueue.statusCode === 200, `Cursor verification queue returned ${cursorQueue.statusCode}; expected 200. Body: ${cursorQueue.body}`);
  const cursorQueueBody = cursorQueue.json<{ tickets: Array<{ id: string }>; page: { cursor: string | null; nextOffset: number | null } }>();
  assert(cursorQueueBody.page.cursor === boundedQueueBody.page.nextCursor, "Cursor verification queue should echo the supplied cursor.");
  assert(cursorQueueBody.page.nextOffset === null, "Cursor verification queue should not encourage offset paging for cursor windows.");
  assert(!cursorQueueBody.tickets.some((ticket) => boundedQueueBody.tickets.map((item) => item.id).includes(ticket.id)), "Cursor verification queue should advance beyond the previous page.");

  for (let index = 0; index < 8; index += 1) {
    const dashboard = await timed(
      "cm-dashboard",
      () =>
        app.inject({
          method: "GET",
          url: "/api/dashboard?role=cm_cell",
          headers: {
            "x-whistle-role": "cm_cell",
            "x-whistle-actor": "cm_cell:prototype",
          },
        }),
      dashboardSamples,
    );
    assert(dashboard.statusCode === 200, `CM dashboard returned ${dashboard.statusCode}; expected 200. Body: ${dashboard.body}`);
    assert(dashboard.json<{ dashboard: { tickets: Array<{ id: string }> } }>().dashboard.tickets.length >= sampleCount, "CM dashboard should include seeded SLO tickets.");
  }

  const boundedDashboard = await app.inject({
    method: "GET",
    url: "/api/dashboard?role=cm_cell&ticketLimit=6&ticketOffset=0&q=SLO%20smoke",
    headers: {
      "x-whistle-role": "cm_cell",
      "x-whistle-actor": "cm_cell:prototype",
    },
  });
  assert(boundedDashboard.statusCode === 200, `Bounded CM dashboard returned ${boundedDashboard.statusCode}; expected 200. Body: ${boundedDashboard.body}`);
  const boundedDashboardBody = boundedDashboard.json<{ dashboard: { readModel: { source: string; ticketRowsHydrated: number; scopedTicketTotal: number }; ticketWindow: { limit: number; offset: number; cursor: string | null; returned: number; total: number; hasMore: boolean; nextOffset: number | null; nextCursor: string | null }; tickets: Array<{ id: string }> } }>().dashboard;
  assert(boundedDashboardBody.tickets.length === 6, `Bounded dashboard should return exactly 6 ticket rows. Got ${boundedDashboardBody.tickets.length}.`);
  assert(boundedDashboardBody.readModel.ticketRowsHydrated === boundedDashboardBody.tickets.length, "Dashboard read model should expose bounded ticket row hydration.");
  assert(boundedDashboardBody.readModel.scopedTicketTotal === boundedDashboardBody.ticketWindow.total, "Dashboard read model should expose the full scoped total.");
  assert(boundedDashboardBody.ticketWindow.limit === 6 && boundedDashboardBody.ticketWindow.offset === 0, "Bounded dashboard should include row window metadata.");
  assert(boundedDashboardBody.ticketWindow.total >= sampleCount, `Bounded dashboard total should include seeded SLO tickets. Got ${boundedDashboardBody.ticketWindow.total}.`);
  assert(boundedDashboardBody.ticketWindow.hasMore && boundedDashboardBody.ticketWindow.nextOffset === 6, "Bounded dashboard should expose next offset when more rows exist.");
  assert(boundedDashboardBody.ticketWindow.nextCursor && boundedDashboardBody.ticketWindow.cursor === null, "Bounded dashboard should expose nextCursor for high-volume queue screens.");
  const cursorDashboard = await app.inject({
    method: "GET",
    url: `/api/dashboard?role=cm_cell&ticketLimit=6&q=SLO%20smoke&ticketCursor=${encodeURIComponent(boundedDashboardBody.ticketWindow.nextCursor)}`,
    headers: {
      "x-whistle-role": "cm_cell",
      "x-whistle-actor": "cm_cell:prototype",
    },
  });
  assert(cursorDashboard.statusCode === 200, `Cursor CM dashboard returned ${cursorDashboard.statusCode}; expected 200. Body: ${cursorDashboard.body}`);
  const cursorDashboardBody = cursorDashboard.json<{ dashboard: { ticketWindow: { cursor: string | null; nextOffset: number | null }; tickets: Array<{ id: string }> } }>().dashboard;
  assert(cursorDashboardBody.ticketWindow.cursor === boundedDashboardBody.ticketWindow.nextCursor, "Cursor dashboard should echo the supplied ticket cursor.");
  assert(cursorDashboardBody.ticketWindow.nextOffset === null, "Cursor dashboard should not encourage offset paging for cursor windows.");
  assert(!cursorDashboardBody.tickets.some((ticket) => boundedDashboardBody.tickets.map((item) => item.id).includes(ticket.id)), "Cursor dashboard should advance beyond the previous page.");

  const citizenTickets = await app.inject({
    method: "GET",
    url: `/api/citizen/tickets?phone=${encodeURIComponent(tickets[0].phone)}&limit=1&offset=0`,
    headers: {
      "x-whistle-citizen-phone": tickets[0].phone,
      "x-whistle-citizen-token": tickets[0].phoneVerificationToken,
    },
  });
  assert(citizenTickets.statusCode === 200, `Citizen bounded tickets returned ${citizenTickets.statusCode}; expected 200. Body: ${citizenTickets.body}`);
  const citizenTicketsBody = citizenTickets.json<{ tickets: Array<{ id: string }>; page: { limit: number; offset: number; cursor: string | null; returned: number; nextCursor: string | null } }>();
  assert(citizenTicketsBody.tickets.length <= 1, "Citizen My Tickets should honor the requested limit.");
  assert(citizenTicketsBody.page.limit === 1 && citizenTicketsBody.page.offset === 0, "Citizen My Tickets should return pagination metadata.");
  assert(citizenTicketsBody.page.cursor === null, "Citizen My Tickets should include cursor metadata.");

  const auditPage = await app.inject({
    method: "GET",
    url: "/api/audit?limit=3",
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
    },
  });
  assert(auditPage.statusCode === 200, `Audit page returned ${auditPage.statusCode}; expected 200. Body: ${auditPage.body}`);
  const auditPageBody = auditPage.json<{ auditEvents: Array<{ id: string }>; page: { limit: number; cursor: string | null; returned: number; hasMore: boolean; nextOffset: number | null; nextCursor: string | null } }>();
  assert(auditPageBody.auditEvents.length === 3, `Audit page should return exactly 3 records. Got ${auditPageBody.auditEvents.length}.`);
  assert(auditPageBody.page.limit === 3 && auditPageBody.page.cursor === null && auditPageBody.page.returned === 3, "Audit page should include bounded window metadata.");
  assert(auditPageBody.page.hasMore && auditPageBody.page.nextOffset === 3 && auditPageBody.page.nextCursor, "Audit page should expose offset and cursor continuation.");
  const auditCursorPage = await app.inject({
    method: "GET",
    url: `/api/audit?limit=3&cursor=${encodeURIComponent(auditPageBody.page.nextCursor)}`,
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
    },
  });
  assert(auditCursorPage.statusCode === 200, `Audit cursor page returned ${auditCursorPage.statusCode}; expected 200. Body: ${auditCursorPage.body}`);
  const auditCursorBody = auditCursorPage.json<{ auditEvents: Array<{ id: string }>; page: { cursor: string | null; nextOffset: number | null } }>();
  assert(auditCursorBody.page.cursor === auditPageBody.page.nextCursor, "Audit cursor page should echo the supplied cursor.");
  assert(auditCursorBody.page.nextOffset === null, "Audit cursor windows should not advertise offset continuation.");
  assert(!auditCursorBody.auditEvents.some((event) => auditPageBody.auditEvents.map((item) => item.id).includes(event.id)), "Audit cursor page should advance beyond the prior page.");

  const outboxPage = await app.inject({
    method: "GET",
    url: "/api/notifications/outbox?limit=3",
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
    },
  });
  assert(outboxPage.statusCode === 200, `Notification outbox page returned ${outboxPage.statusCode}; expected 200. Body: ${outboxPage.body}`);
  const outboxPageBody = outboxPage.json<{ notifications: Array<{ id: string }>; page: { limit: number; cursor: string | null; returned: number; hasMore: boolean; nextCursor: string | null } }>();
  assert(outboxPageBody.notifications.length === 3, `Notification outbox page should return exactly 3 records. Got ${outboxPageBody.notifications.length}.`);
  assert(outboxPageBody.page.limit === 3 && outboxPageBody.page.cursor === null && outboxPageBody.page.returned === 3, "Notification outbox page should include bounded window metadata.");
  assert(outboxPageBody.page.hasMore && outboxPageBody.page.nextCursor, "Notification outbox page should expose cursor continuation.");
  const outboxCursorPage = await app.inject({
    method: "GET",
    url: `/api/notifications/outbox?limit=3&cursor=${encodeURIComponent(outboxPageBody.page.nextCursor)}`,
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
    },
  });
  assert(outboxCursorPage.statusCode === 200, `Notification outbox cursor page returned ${outboxCursorPage.statusCode}; expected 200. Body: ${outboxCursorPage.body}`);
  const outboxCursorBody = outboxCursorPage.json<{ notifications: Array<{ id: string }>; page: { cursor: string | null; nextOffset: number | null } }>();
  assert(outboxCursorBody.page.cursor === outboxPageBody.page.nextCursor, "Notification outbox cursor page should echo the supplied cursor.");
  assert(outboxCursorBody.page.nextOffset === null, "Notification outbox cursor windows should not advertise offset continuation.");
  assert(!outboxCursorBody.notifications.some((notification) => outboxPageBody.notifications.map((item) => item.id).includes(notification.id)), "Notification outbox cursor page should advance beyond the prior page.");

  pass("Bounded and cursor-backed queue, dashboard, audit, notification, and citizen-ticket pagination contracts are enforced");

  assertP95("Complaint submit API", createSamples, thresholds.ticketCreateP95Ms);
  assertP95("Ticket status API", statusSamples, thresholds.ticketStatusP95Ms);
  assertP95("Verification queue API", queueSamples, thresholds.verificationQueueP95Ms);
  assertP95("CM dashboard API", dashboardSamples, thresholds.dashboardP95Ms);
} finally {
  await app.close();
}
