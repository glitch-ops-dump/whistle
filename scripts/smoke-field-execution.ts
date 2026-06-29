import { buildWhistleApi } from "../server/app.js";
import type { AuditEvent, NotificationIntent, SlaJobResult, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

type CreatedTicket = TicketRecord & { citizenAccessHeaders: Record<string, string> };
type TicketPayload = { ticket: TicketRecord };

const verificationHeaders = {
  "x-whistle-role": "verification",
  "x-whistle-actor": "verification:prototype",
};

const councillorHeaders = {
  "x-whistle-role": "councillor",
  "x-whistle-actor": "councillor:prototype",
};

const departmentOfficerHeaders = {
  "x-whistle-role": "department_officer",
  "x-whistle-actor": "department_officer:prototype",
};

const ministerHeaders = {
  "x-whistle-role": "minister",
  "x-whistle-actor": "minister:prototype",
};

const cmCellHeaders = {
  "x-whistle-role": "cm_cell",
  "x-whistle-actor": "cm_cell:prototype",
};

const workerHeaders = {
  "x-whistle-role": "worker",
  "x-whistle-actor": "worker:prototype",
};

function citizenAccessHeaders(phone: string, phoneVerificationToken: string) {
  return {
    "x-whistle-citizen-phone": phone,
    "x-whistle-citizen-token": phoneVerificationToken,
  };
}

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

async function createTicket(app: WhistleApi, payload: Record<string, unknown>) {
  const verifiedPayload = await withVerifiedPhone(app, payload);
  const result = await jsonRequest<{ ticket: TicketRecord | null; rejected?: { error?: string; message?: string } | null }>(
    app,
    {
      method: "POST",
      url: "/api/tickets",
      payload: verifiedPayload,
    },
    201,
  );
  assert(result.ticket, `Ticket should be accepted, got rejection: ${result.rejected?.message ?? result.rejected?.error ?? "unknown"}`);
  return Object.assign(result.ticket, {
    citizenAccessHeaders: citizenAccessHeaders(String(verifiedPayload.phone), verifiedPayload.phoneVerificationToken),
  }) as CreatedTicket;
}

async function routeToWard(app: WhistleApi, ticketId: string) {
  const result = await jsonRequest<TicketPayload>(app, {
    method: "POST",
    url: `/api/verification/${encodeURIComponent(ticketId)}/decision`,
    headers: verificationHeaders,
    payload: {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Verified complete issue and routed to Ward 48 local execution queue.",
      ownerKey: "local:ward-48",
      ownerLabel: "Ward 48 Local Field Team",
      scopeValue: "Ward 48",
    },
  });
  return result.ticket;
}

async function fieldAction(app: WhistleApi, ticketId: string, payload: Record<string, unknown>, headers = departmentOfficerHeaders, expectedStatus = 200) {
  const result = await jsonRequest<TicketPayload>(
    app,
    {
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(ticketId)}/field-actions`,
      headers,
      payload,
    },
    expectedStatus,
  );
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
    const ticket = await createTicket(app, {
      category: "roads",
      language: "en",
      title: "Damaged road edge near bus stop",
      description: "The road edge near the bus stop has broken away and buses are swerving into two-wheeler traffic.",
      phone: "+91 98765 61001",
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Chennai",
        area: "Velachery",
        address: "Ward 48 bus stop approach road",
        landmark: "Near old water tank",
      },
      evidence: [{ fileName: "road-edge.jpg", mimeType: "image/jpeg", sizeBytes: 440_000 }],
    });

    const routed = await routeToWard(app, ticket.id);
    assert(routed.status === "routed_local" && routed.primaryQueue.scope.value === "Ward 48", "Ticket should be routed to Ward 48 local queue.");

    const visitAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const scheduled = await fieldAction(
      app,
      ticket.id,
      {
        action: "schedule_visit",
        fieldOfficer: "Ward Engineer S. Arun",
        visitAt,
        note: "Field engineer scheduled to inspect road edge and traffic diversion risk.",
      },
      councillorHeaders,
    );
    assert(scheduled.primaryQueue.kind === "local" && scheduled.sla.stage === "local", "Scheduling field visit must not move queue or SLA stage.");
    assert(scheduled.citizenTimeline.some((event) => event.type === "field_visit_scheduled"), "Citizen timeline should show scheduled field visit.");
    pass("local field visit scheduling writes timeline without moving ownership");

    const withFieldReport = await fieldAction(
      app,
      ticket.id,
      {
        action: "add_field_report",
        fieldOfficer: "Ward Engineer S. Arun",
        note: "Field visit confirmed edge failure; barricades placed and resurfacing crew requested.",
        evidence: [{ label: "before", fileName: "road-edge-field-before.jpg", mimeType: "image/jpeg", sizeBytes: 520_000 }],
      },
      councillorHeaders,
    );
    assert(withFieldReport.evidence.some((item) => item.fileName.startsWith("before-")), "Before evidence label should be preserved in evidence metadata.");
    assert(withFieldReport.governmentEvents.some((event) => event.type === "field_report_added"), "Government events should include field report.");
    pass("field report appends before/after evidence metadata and audit-visible history");

    await fieldAction(
      app,
      ticket.id,
      {
        action: "resolve",
        resolutionNote: "Attempted closure without complete checks.",
        checklist: {
          fieldVisitCompleted: true,
          evidenceAttached: false,
          citizenImpactChecked: true,
          safetyRiskClosed: true,
        },
      },
      councillorHeaders,
      409,
    );
    pass("closure is blocked when readiness checklist is incomplete");

    const transferred = await fieldAction(
      app,
      ticket.id,
      {
        action: "transfer",
        reason: "Road resurfacing requires MAWS/corporation contractor scheduling beyond local ward team capacity.",
        ownerKey: "ministry:maws",
        ownerLabel: "Municipal Administration Department Queue",
        scopeKind: "ministry",
        scopeValue: "Municipal Administration and Water Supply",
        queueKind: "ministry",
      },
      councillorHeaders,
    );
    assert(transferred.primaryQueue.kind === "ministry", "Transfer should make ministry the primary queue.");
    assert(transferred.secondaryQueues.some((queue) => queue.kind === "local"), "Transfer should retain local secondary visibility.");
    assert(transferred.sla.stage === "ministry", "Transfer to ministry should start ministry SLA.");
    pass("transfer-with-reason moves primary queue and retains secondary visibility");

    const ministerDirective = await fieldAction(
      app,
      ticket.id,
      {
        action: "add_field_report",
        fieldOfficer: "MAWS Minister Office",
        note: "Minister office directed district owner to clear contractor scheduling and upload closure proof before next SLA review.",
        evidence: [{ label: "field_report", fileName: "minister-directive.txt", mimeType: "text/plain", sizeBytes: 340 }],
      },
      ministerHeaders,
    );
    assert(
      ministerDirective.governmentEvents.some((event) => event.actor === "minister:prototype" && event.type === "field_report_added"),
      "Minister directive should append a government-visible field report.",
    );
    pass("minister can issue assigned-ministry field directive");

    const future = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString();
    const slaJob = await jsonRequest<{ result: SlaJobResult }>(app, {
      method: "POST",
      url: "/api/jobs/sla-escalations/run",
      headers: workerHeaders,
      payload: { actor: "worker:prototype", now: future },
    });
    assert(slaJob.result.actions.some((action) => action.ticketId === ticket.id && action.outcome === "escalated_to_cm_cell"), "SLA job should escalate ministry ticket to CM Cell.");
    const cmEscalated = await fieldAction(
      app,
      ticket.id,
      {
        action: "add_field_report",
        fieldOfficer: "CM Cell Command Desk",
        note: "CM Cell issued a 48-hour directive to the ministry secretary and retained prior ministry visibility.",
        evidence: [{ label: "field_report", fileName: "cm-cell-directive.txt", mimeType: "text/plain", sizeBytes: 420 }],
      },
      cmCellHeaders,
    );
    assert(cmEscalated.primaryQueue.kind === "cm_cell", "CM Cell directive should not move the CM Cell primary queue.");
    assert(cmEscalated.secondaryQueues.some((queue) => queue.kind === "ministry"), "CM Cell escalation should retain ministry secondary visibility.");
    assert(
      cmEscalated.governmentEvents.some((event) => event.actor === "cm_cell:prototype" && event.type === "field_report_added"),
      "CM Cell directive should append a government-visible field report.",
    );
    pass("CM Cell can issue audited directives on escalated tickets while retaining ministry accountability");

    const powerTicket = await createTicket(app, {
      category: "power",
      language: "en",
      title: "Street light feeder fault near junction",
      description: "Street lights are off near a busy junction and residents report repeated near misses after dark.",
      phone: "+91 98765 61002",
      departmentHint: "TANGEDCO",
      location: { district: "Chennai", area: "Velachery", address: "Ward 48 junction" },
      evidence: [],
    });
    await routeToWard(app, powerTicket.id);
    await fieldAction(
      app,
      powerTicket.id,
      {
        action: "transfer",
        reason: "Power feeder fault belongs to the Energy ministry queue.",
        ownerKey: "ministry:energy",
        ownerLabel: "Energy Ministry Queue",
        scopeKind: "ministry",
        scopeValue: "Energy",
        queueKind: "ministry",
      },
      councillorHeaders,
    );
    await fieldAction(
      app,
      powerTicket.id,
      {
        action: "schedule_visit",
        fieldOfficer: "MAWS Department Officer",
        visitAt,
        note: "Out-of-scope MAWS officer should not act on Energy ticket.",
      },
      departmentOfficerHeaders,
      403,
    );
    await fieldAction(
      app,
      powerTicket.id,
      {
        action: "schedule_visit",
        fieldOfficer: "MAWS Minister Office",
        visitAt,
        note: "Out-of-scope minister should not act on Energy ticket.",
      },
      ministerHeaders,
      403,
    );
    pass("department officer and minister field actions are constrained to assigned ministry scope");

    const resolved = await fieldAction(app, ticket.id, {
      action: "resolve",
      resolutionNote: "Road edge repaired, barricades removed, and bus stop approach reopened after field check.",
      checklist: {
        fieldVisitCompleted: true,
        evidenceAttached: true,
        citizenImpactChecked: true,
        safetyRiskClosed: true,
      },
      evidence: [{ label: "after", fileName: "road-edge-after.jpg", mimeType: "image/jpeg", sizeBytes: 620_000 }],
    });
    assert(resolved.status === "resolved", "Complete closure should mark the ticket resolved.");
    assert(resolved.sla.state === "resolved" && resolved.sla.dueAt === null, "Resolved ticket should close the SLA clock.");
    assert(resolved.evidence.some((item) => item.fileName.startsWith("after-")), "After evidence label should be preserved.");
    pass("department officer can resolve assigned-ministry ticket with full closure readiness");

    const reopenPayload = {
      reason: "The repaired road edge has already started breaking again and water is pooling at the same location.",
      evidence: [{ label: "after", fileName: "road-edge-dispute.jpg", mimeType: "image/jpeg", sizeBytes: 410_000 }],
    };
    const reopenHeaders = { ...ticket.citizenAccessHeaders, "idempotency-key": "citizen-reopen-road-001" };
    const reopened = await jsonRequest<TicketPayload>(app, {
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(ticket.id)}/reopen-dispute`,
      headers: reopenHeaders,
      payload: reopenPayload,
    });
    const reopenedRetry = await jsonRequest<TicketPayload & { idempotent?: boolean }>(app, {
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(ticket.id)}/reopen-dispute`,
      headers: reopenHeaders,
      payload: reopenPayload,
    });
    assert(reopenedRetry.idempotent, "Repeated citizen reopen/dispute should be marked idempotent.");
    assert(reopenedRetry.ticket.evidence.length === reopened.ticket.evidence.length, "Repeated citizen reopen/dispute should not duplicate evidence metadata.");
    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(ticket.id)}/reopen-dispute`,
        headers: reopenHeaders,
        payload: { ...reopenPayload, reason: "Changed reopen reason should be rejected by idempotency." },
      },
      409,
    );
    assert(reopened.ticket.status === "reopened", "Citizen dispute should reopen the ticket.");
    assert(reopened.ticket.primaryQueue.kind === "verification", "Reopened ticket should return to verification.");
    assert(reopened.ticket.secondaryQueues.some((queue) => queue.kind === "ministry"), "Reopened ticket should retain prior ministry visibility.");
    assert(reopened.ticket.secondaryQueues.some((queue) => queue.kind === "cm_cell"), "Reopened ticket should add CM Cell secondary visibility.");
    pass("idempotent citizen reopen/dispute returns resolved tickets to verification with oversight visibility");

    const audit = await jsonRequest<{ auditEvents: AuditEvent[] }>(app, {
      method: "GET",
      url: `/api/audit?ticketId=${encodeURIComponent(ticket.id)}`,
      headers: { "x-whistle-role": "cm_cell", "x-whistle-actor": "cm_cell:prototype" },
    });
    assert(audit.auditEvents.some((event) => event.action === "field.resolve"), "Audit ledger should include field.resolve.");
    assert(audit.auditEvents.some((event) => event.action === "citizen.dispute_reopen"), "Audit ledger should include citizen dispute reopen.");

    const notifications = await jsonRequest<{ notifications: NotificationIntent[] }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(ticket.id)}/notifications`,
      headers: ticket.citizenAccessHeaders,
    });
    assert(notifications.notifications.some((item) => item.topic === "ticket_resolved"), "Resolved ticket should queue citizen notification.");
    assert(notifications.notifications.some((item) => item.topic === "ticket_reopened"), "Reopened ticket should queue citizen notification.");
    pass("field execution and reopen/dispute write audit and citizen-safe notifications");

    pass("field execution smoke completed");
  } finally {
    await app.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalSeedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
    else process.env.WHISTLE_SEED_DEMO = originalSeedDemo;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
