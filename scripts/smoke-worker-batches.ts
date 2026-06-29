import { buildWhistleApi } from "../server/app.js";
import type { EvidenceScanJobResult, EvidenceUploadSession, NotificationJobResult, SlaJobResult, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;
process.env.WHISTLE_SEED_DEMO = "false";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

const verificationHeaders = {
  "x-whistle-role": "verification",
  "x-whistle-actor": "verification:prototype",
};

const workerHeaders = {
  "x-whistle-role": "worker",
  "x-whistle-actor": "worker:prototype",
};

function citizenHeaders(phone: string, token: string) {
  return {
    "x-whistle-citizen-phone": phone,
    "x-whistle-citizen-token": token,
  };
}

const app = buildWhistleApi();
await app.ready();

try {
  const created: Array<{ ticket: TicketRecord; phone: string; token: string }> = [];

  for (let index = 0; index < 3; index += 1) {
    const phone = `+91971234${String(index).padStart(4, "0")}`;
    const payload = await withVerifiedPhone(app, {
      category: "roads",
      language: "en",
      title: `Worker batch road issue ${index + 1}`,
      description: "A civic road issue used to prove worker jobs process bounded batches under high-volume conditions.",
      phone,
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Chennai",
        area: "Velachery",
        landmark: `Batch smoke ${index + 1}`,
      },
      evidence: [],
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/tickets",
      payload,
    });
    assert(response.statusCode === 201, `Ticket ${index + 1} create returned ${response.statusCode}; expected 201. Body: ${response.body}`);
    created.push({ ticket: response.json<{ ticket: TicketRecord }>().ticket, phone, token: payload.phoneVerificationToken });
  }

  const notificationJob = await app.inject({
    method: "POST",
    url: "/api/jobs/notifications/run",
    headers: workerHeaders,
    payload: { actor: "worker:prototype", limit: 2 },
  });
  assert(notificationJob.statusCode === 200, `Notification batch job returned ${notificationJob.statusCode}; expected 200. Body: ${notificationJob.body}`);
  const notificationResult = notificationJob.json<{ result: NotificationJobResult }>().result;
  assert(notificationResult.batchLimit === 2, "Notification job should echo the requested batch limit.");
  assert(notificationResult.queuedCount === 2, `Notification job should process only 2 queued records. Got ${notificationResult.queuedCount}.`);
  assert(notificationResult.actions.length === 2, "Notification job actions should match the bounded batch.");
  assert(notificationResult.hasMore, "Notification job should report hasMore when queued notifications remain.");
  pass("notification worker processes a bounded batch and reports continuation");

  for (let index = 0; index < created.length; index += 1) {
    const item = created[index];
    const uploadSession = await app.inject({
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(item.ticket.id)}/evidence/upload-session`,
      headers: citizenHeaders(item.phone, item.token),
      payload: {
        fileName: `worker-batch-${index + 1}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 180_000 + index,
      },
    });
    assert(uploadSession.statusCode === 201, `Evidence upload-session ${index + 1} returned ${uploadSession.statusCode}; expected 201. Body: ${uploadSession.body}`);
    const session = uploadSession.json<{ session: EvidenceUploadSession }>().session;
    const complete = await app.inject({
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(item.ticket.id)}/evidence/${encodeURIComponent(session.evidence.id)}/complete-upload`,
      headers: citizenHeaders(item.phone, item.token),
      payload: {
        mimeType: "image/jpeg",
        sizeBytes: 180_000 + index,
        checksum: `mvp-sha256:worker-batch-${index + 1}`,
      },
    });
    assert(complete.statusCode === 200, `Evidence complete-upload ${index + 1} returned ${complete.statusCode}; expected 200. Body: ${complete.body}`);
  }

  const evidenceJob = await app.inject({
    method: "POST",
    url: "/api/jobs/evidence-scans/run",
    headers: workerHeaders,
    payload: { actor: "worker:prototype", limit: 2 },
  });
  assert(evidenceJob.statusCode === 200, `Evidence scan batch job returned ${evidenceJob.statusCode}; expected 200. Body: ${evidenceJob.body}`);
  const evidenceResult = evidenceJob.json<{ result: EvidenceScanJobResult }>().result;
  assert(evidenceResult.batchLimit === 2, "Evidence scan job should echo the requested batch limit.");
  assert(evidenceResult.checkedTicketCount === 2, `Evidence scan job should inspect only 2 pending tickets. Got ${evidenceResult.checkedTicketCount}.`);
  assert(evidenceResult.actions.length >= 2, "Evidence scan job should scan evidence for the bounded ticket batch.");
  assert(evidenceResult.hasMore, "Evidence scan job should report hasMore when scan-pending evidence remains.");
  pass("evidence scan worker processes a bounded batch and reports continuation");

  for (let index = 0; index < created.length; index += 1) {
    const item = created[index];
    const route = await app.inject({
      method: "POST",
      url: `/api/verification/${encodeURIComponent(item.ticket.id)}/decision`,
      headers: verificationHeaders,
      payload: {
        action: "route_local",
        actor: "verification:prototype",
        reason: "Complete complaint for local SLA batch validation.",
        ownerKey: "mla:velachery",
        ownerLabel: "Velachery MLA Office",
        scopeValue: "Velachery",
      },
    });
    assert(route.statusCode === 200, `Route-local ${index + 1} returned ${route.statusCode}; expected 200. Body: ${route.body}`);
  }

  const slaJob = await app.inject({
    method: "POST",
    url: "/api/jobs/sla-escalations/run",
    headers: workerHeaders,
    payload: {
      actor: "worker:prototype",
      now: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      limit: 2,
    },
  });
  assert(slaJob.statusCode === 200, `SLA batch job returned ${slaJob.statusCode}; expected 200. Body: ${slaJob.body}`);
  const slaResult = slaJob.json<{ result: SlaJobResult }>().result;
  assert(slaResult.batchLimit === 2, "SLA job should echo the requested batch limit.");
  assert(slaResult.dueCount === 2, `SLA job should process only 2 due tickets. Got ${slaResult.dueCount}.`);
  assert(slaResult.actions.length === 2, "SLA job actions should match the bounded batch.");
  assert(slaResult.actions.every((action) => action.outcome === "escalated_to_ministry"), "SLA batch should escalate local tickets to ministry.");
  assert(slaResult.hasMore, "SLA job should report hasMore when due tickets remain.");
  pass("SLA worker processes a bounded batch and reports continuation");
} finally {
  await app.close();
}
