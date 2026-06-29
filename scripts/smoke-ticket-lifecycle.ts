import { buildWhistleApi } from "../server/app.js";
import { verifyAuditHashChain } from "../server/audit/hashChain.js";
import { DevTicketRepository } from "../server/ticket-spine/devRepository.js";
import type {
  AuditEvent,
  EvidenceAccessResult,
  EvidenceScanJobResult,
  EvidenceUploadSession,
  NotificationIntent,
  NotificationJobResult,
  RoleDashboard,
  SlaJobResult,
  TicketRecord,
} from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

type CreatedTicket = TicketRecord & { citizenAccessHeaders: Record<string, string> };
type TicketPayload = { ticket: TicketRecord };

const verificationHeaders = {
  "x-whistle-role": "verification",
  "x-whistle-actor": "verification:prototype",
};

const workerHeaders = {
  "x-whistle-role": "worker",
  "x-whistle-actor": "worker:prototype",
};

const cmCellHeaders = {
  "x-whistle-role": "cm_cell",
  "x-whistle-actor": "cm_cell:prototype",
  "x-whistle-access-reason": "Lifecycle smoke CM protected review access.",
};

const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
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

async function fetchAllAuditEvents(app: WhistleApi) {
  const events: AuditEvent[] = [];
  let cursor: string | null = null;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = await jsonRequest<{ auditEvents: AuditEvent[]; page: { hasMore: boolean; nextCursor: string | null } }>(app, {
      method: "GET",
      url: `/api/audit?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      headers: cmCellHeaders,
    });
    events.push(...page.auditEvents);
    if (!page.page.hasMore) return events;
    assert(page.page.nextCursor, "Audit page with more rows should include nextCursor.");
    cursor = page.page.nextCursor;
  }
  throw new Error("Audit pagination did not terminate within 20 pages.");
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

async function getTicket(app: WhistleApi, ticketId: string, headers?: Record<string, string>) {
  const result = await jsonRequest<TicketPayload>(
    app,
    {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(ticketId)}`,
      headers: headers ?? cmCellHeaders,
    },
  );
  return result.ticket;
}

async function decide(app: WhistleApi, ticketId: string, payload: Record<string, unknown>) {
  const result = await jsonRequest<TicketPayload>(
    app,
    {
      method: "POST",
      url: `/api/verification/${encodeURIComponent(ticketId)}/decision`,
      headers: verificationHeaders,
      payload,
    },
  );
  return result.ticket;
}

async function reviewRejection(app: WhistleApi, ticketId: string, payload: Record<string, unknown>, expectedStatus = 200) {
  const result = await jsonRequest<TicketPayload>(
    app,
    {
      method: "POST",
      url: `/api/rejection-review/${encodeURIComponent(ticketId)}/decision`,
      headers: cmCellHeaders,
      payload,
    },
    expectedStatus,
  );
  return result.ticket;
}

async function dashboard(app: WhistleApi, query: Record<string, string>, headers?: Record<string, string>) {
  const params = new URLSearchParams(query);
  const result = await jsonRequest<{ dashboard: RoleDashboard }>(
    app,
    {
      method: "GET",
      url: `/api/dashboard?${params.toString()}`,
      headers,
    },
  );
  return result.dashboard;
}

function includesTicket(dashboardResult: RoleDashboard, ticketId: string) {
  return dashboardResult.tickets.some((ticket) => ticket.id === ticketId);
}

async function assertIdempotencyReservationContract() {
  const repository = new DevTicketRepository();
  const reservation = {
    scope: "ticket.create:citizen",
    key: "reservation-contract-001",
    requestHash: "reservation-contract-hash",
    action: "ticket.create" as const,
    createdAt: new Date().toISOString(),
  };
  const first = await repository.reserveIdempotencyRecord(reservation);
  assert(first.inserted, "First idempotency reservation should win the key.");
  assert(!first.record.responseTicketId, "Reserved idempotency record should not require a response ticket before mutation.");
  const second = await repository.reserveIdempotencyRecord(reservation);
  assert(!second.inserted, "Duplicate idempotency reservation should not win the key.");
  assert(!second.record.responseTicketId, "Duplicate reservation should see the in-progress record.");
  const ticket = await repository.createTicket({
    category: "roads",
    language: "en",
    title: "Reservation contract smoke",
    description: "Idempotency reservation smoke ticket for duplicate-prevention coverage.",
    phone: "+91 98765 44444",
    departmentHint: "Corporation / Municipality",
    location: {
      district: "Chennai",
      area: "Velachery",
    },
    evidence: [],
  });
  const finalized = await repository.finalizeIdempotencyRecord({ ...reservation, responseTicketId: ticket.id });
  assert(finalized.responseTicketId === ticket.id, "Finalized idempotency record should point to the mutation response ticket.");
  await repository.close();
  pass("idempotency records reserve keys before mutation and finalize after response persistence");
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";
  await assertIdempotencyReservationContract();

  const app = buildWhistleApi();
  await app.ready();

  try {
    await jsonRequest<{ control: { id: string; value: boolean } }>(app, {
      method: "PATCH",
      url: "/api/admin/config/app-controls/citizen-phone-otp-required",
      headers: adminHeaders,
      payload: { value: true },
    });

    const otpTicketPayload = {
      category: "roads",
      language: "en",
      title: "OTP protected road complaint",
      description: "Road surface has failed near a school and needs routing after citizen phone verification.",
      phone: "+91 98765 10001",
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Chennai",
        area: "Velachery",
        landmark: "Near school gate",
      },
      evidence: [],
    };
    await jsonRequest(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        payload: otpTicketPayload,
      },
      401,
    );
    const otpStart = await jsonRequest<{ challenge: { challengeId: string; mockOtp: string; phoneMasked: string } }>(
      app,
      {
        method: "POST",
        url: "/api/citizen/otp/start",
        payload: { phone: otpTicketPayload.phone, language: "en" },
      },
      201,
    );
    assert(otpStart.challenge.mockOtp === "123456", "MVP mock OTP should be visible for prototype testing.");
    await jsonRequest(
      app,
      {
        method: "POST",
        url: "/api/citizen/otp/verify",
        payload: { challengeId: otpStart.challenge.challengeId, otp: "000000" },
      },
      401,
    );
    const otpVerified = await jsonRequest<{ verification: { verificationToken: string; phoneMasked: string } }>(app, {
      method: "POST",
      url: "/api/citizen/otp/verify",
      payload: { challengeId: otpStart.challenge.challengeId, otp: otpStart.challenge.mockOtp },
    });
    assert(otpVerified.verification.phoneMasked === otpStart.challenge.phoneMasked, "OTP verification should preserve masked phone.");
    await jsonRequest(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        payload: {
          ...otpTicketPayload,
          phone: "+91 98765 10002",
          phoneVerificationToken: otpVerified.verification.verificationToken,
        },
      },
      403,
    );
    await jsonRequest(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        payload: {
          ...otpTicketPayload,
          phoneVerificationToken: otpVerified.verification.verificationToken,
          evidence: [{ fileName: "browser-script.svg", mimeType: "image/svg+xml", sizeBytes: 2_000 }],
        },
      },
      400,
    );
    pass("citizen phone OTP token is required, mock-verifiable, and phone-bound");

    const idempotentCreatePayload = await withVerifiedPhone(app, {
      category: "sanitation",
      language: "en",
      title: "Overflowing garbage bin near bus stop",
      description: "Garbage has not been cleared for four days near a busy bus stop and the area smells unsafe for commuters.",
      phone: "+91 98765 10101",
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Chennai",
        area: "Adyar",
        landmark: "Near bus stop",
      },
      evidence: [],
    });
    const idempotentCreateHeaders = { "idempotency-key": "citizen-create-sanit-001" };
    const firstCreate = await jsonRequest<{ ticket: TicketRecord; idempotent?: boolean }>(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        headers: idempotentCreateHeaders,
        payload: idempotentCreatePayload,
      },
      201,
    );
    const secondCreate = await jsonRequest<{ ticket: TicketRecord; idempotent?: boolean }>(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        headers: idempotentCreateHeaders,
        payload: idempotentCreatePayload,
      },
      200,
    );
    assert(firstCreate.ticket.id === secondCreate.ticket.id, "Repeated create request with the same idempotency key should return the original ticket.");
    assert(secondCreate.idempotent, "Repeated create request should be marked idempotent.");
    await jsonRequest(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        headers: idempotentCreateHeaders,
        payload: { ...idempotentCreatePayload, title: "Changed garbage bin complaint title" },
      },
      409,
    );
    pass("ticket creation is idempotent and rejects changed payload reuse");

    const idempotentDecisionTicket = await createTicket(app, {
      category: "power",
      language: "en",
      title: "Street light not working near library",
      description: "The street light outside the public library has been dark for several nights and pedestrians are avoiding the lane.",
      phone: "+91 98765 20202",
      departmentHint: "TANGEDCO",
      location: {
        district: "Madurai",
        area: "Tallakulam",
        landmark: "Near public library",
      },
      evidence: [],
    });
    const idempotentDecisionPayload = {
      action: "request_info",
      actor: "verification:prototype",
      reason: "Need exact pole number before routing.",
      missingFields: ["pole number"],
      citizenMessage: "Please add the nearby pole number or a clearer landmark for the street light complaint.",
    };
    const idempotentDecisionHeaders = { ...verificationHeaders, "idempotency-key": "verify-decision-power-001" };
    const firstDecision = await jsonRequest<TicketPayload>(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(idempotentDecisionTicket.id)}/decision`,
        headers: idempotentDecisionHeaders,
        payload: idempotentDecisionPayload,
      },
    );
    const secondDecision = await jsonRequest<TicketPayload & { idempotent?: boolean }>(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(idempotentDecisionTicket.id)}/decision`,
        headers: idempotentDecisionHeaders,
        payload: idempotentDecisionPayload,
      },
    );
    assert(firstDecision.ticket.id === secondDecision.ticket.id, "Repeated verification decision should return the same ticket.");
    assert(secondDecision.idempotent, "Repeated verification decision should be marked idempotent.");
    assert(secondDecision.ticket.status === "needs_info", "Idempotent verification retry should preserve the original decision outcome.");
    const actorOnlyDecisionReplay = await jsonRequest<TicketPayload & { idempotent?: boolean }>(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(idempotentDecisionTicket.id)}/decision`,
        headers: idempotentDecisionHeaders,
        payload: { ...idempotentDecisionPayload, actor: "verification:spoofed-client" },
      },
    );
    assert(actorOnlyDecisionReplay.idempotent, "Client-supplied verifier actor changes should not alter authenticated idempotency replay.");
    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(idempotentDecisionTicket.id)}/decision`,
        headers: idempotentDecisionHeaders,
        payload: { ...idempotentDecisionPayload, reason: "Changed decision reason should be rejected." },
      },
      409,
    );
    pass("verification decisions are idempotent and reject changed payload reuse");

    const roadTicket = await createTicket(app, {
      category: "roads",
      language: "en",
      title: "Broken storm drain cover outside school",
      description: "A broken storm drain cover is creating a hazard for school children and two-wheelers during peak traffic hours.",
      phone: "+91 98765 11111",
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Chennai",
        area: "Velachery",
        address: "School Road, Velachery",
        landmark: "Near government school gate",
      },
      evidence: [{ fileName: "broken-drain.jpg", mimeType: "image/jpeg", sizeBytes: 550_000 }],
    });

    assert(roadTicket.status === "submitted", "New civic ticket should start as submitted.");
    assert(roadTicket.primaryQueue.kind === "verification", "New civic ticket should enter verification queue.");
    assert(roadTicket.sla.stage === "verification" && roadTicket.sla.state === "on_track", "New ticket should start verification SLA.");
    assert(roadTicket.evidence.every((item) => item.controls.classification === "standard"), "Standard civic evidence should carry standard security classification.");
    assert(roadTicket.evidence.every((item) => item.controls.downloadAllowed === false), "Evidence downloads should be disabled by default.");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/citizen/tickets?phone=${encodeURIComponent("+91 98765 11111")}`,
      },
      401,
    );
    const citizenTickets = await jsonRequest<{ tickets: Array<TicketRecord & { citizenPhoneHash?: string; phone?: string }> }>(app, {
      method: "GET",
      url: `/api/citizen/tickets?phone=${encodeURIComponent("+91 98765 11111")}`,
      headers: roadTicket.citizenAccessHeaders,
    });
    assert(citizenTickets.tickets.some((ticket) => ticket.id === roadTicket.id), "Citizen My Tickets lookup should return tickets for the verified phone.");
    assert(!citizenTickets.tickets.some((ticket) => "citizenPhoneHash" in ticket || "phone" in ticket), "Citizen ticket list must not expose raw phone or lookup hash.");

    const otherOwnerPayload = await withVerifiedPhone(app, {
      phone: "+91 98765 99999",
      language: "en",
    });
    const otherCitizenTickets = await jsonRequest<{ tickets: TicketRecord[] }>(app, {
      method: "GET",
      url: `/api/citizen/tickets?phone=${encodeURIComponent("+91 98765 99999")}`,
      headers: citizenAccessHeaders(String(otherOwnerPayload.phone), otherOwnerPayload.phoneVerificationToken),
    });
    assert(!otherCitizenTickets.tickets.some((ticket) => ticket.id === roadTicket.id), "Citizen My Tickets lookup must not leak tickets for another phone.");
    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/citizen/tickets?phone=${encodeURIComponent("+91 98765 11111")}`,
        headers: citizenAccessHeaders(String(otherOwnerPayload.phone), otherOwnerPayload.phoneVerificationToken),
      },
      403,
    );
    pass("citizen My Tickets lookup requires the verified phone and does not expose phone/hash");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}`,
      },
      401,
    );
    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}`,
        headers: citizenAccessHeaders(String(otherOwnerPayload.phone), otherOwnerPayload.phoneVerificationToken),
      },
      403,
    );
    const citizenOwnedTicket = await getTicket(app, roadTicket.id, roadTicket.citizenAccessHeaders);
    assert(citizenOwnedTicket.id === roadTicket.id, "Verified citizen owner should read their own ticket by id.");
    pass("citizen direct ticket access requires the owning phone verification token");

    const queue = await jsonRequest<{ tickets: TicketRecord[] }>(app, {
      method: "GET",
      url: "/api/verification/queue",
      headers: verificationHeaders,
    });
    assert(queue.tickets.some((ticket) => ticket.id === roadTicket.id), "Verification queue should include the new civic ticket.");
    pass("citizen submission enters verification with SLA and queue visibility");

    const infoRequested = await decide(app, roadTicket.id, {
      action: "request_info",
      actor: "verification:spoofed-client",
      reason: "Landmark and fresh photo are needed before routing.",
      missingFields: ["fresh photo", "clear landmark"],
      citizenMessage: "Please add a fresh photo and a clearer landmark so the team can route this complaint.",
    });
    assert(infoRequested.status === "needs_info", "Request-info decision should move ticket to needs_info.");
    assert(infoRequested.primaryQueue.kind === "citizen", "Request-info decision should make citizen action primary.");
    assert(infoRequested.secondaryQueues.some((queueItem) => queueItem.kind === "verification"), "Verification should retain secondary visibility.");
    assert(infoRequested.sla.paused && infoRequested.sla.state === "paused", "Awaiting-citizen ticket should pause SLA.");

    const citizenUpdatePayload = {
      details: "Added the fresh photo and updated the landmark near the school gate.",
      address: "School Road, Velachery, Chennai",
      evidence: [{ fileName: "fresh-drain-photo.jpg", mimeType: "image/jpeg", sizeBytes: 620_000 }],
    };
    const citizenUpdateHeaders = { ...roadTicket.citizenAccessHeaders, "idempotency-key": "citizen-update-road-001" };
    const citizenUpdate = await jsonRequest<TicketPayload>(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/citizen-update`,
        headers: citizenUpdateHeaders,
        payload: citizenUpdatePayload,
      },
    );
    const citizenUpdateRetry = await jsonRequest<TicketPayload & { idempotent?: boolean }>(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/citizen-update`,
        headers: citizenUpdateHeaders,
        payload: citizenUpdatePayload,
      },
    );
    assert(citizenUpdateRetry.idempotent, "Repeated citizen update should be marked idempotent.");
    assert(citizenUpdateRetry.ticket.evidence.length === citizenUpdate.ticket.evidence.length, "Repeated citizen update should not append duplicate evidence metadata.");
    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/citizen-update`,
        headers: citizenUpdateHeaders,
        payload: { ...citizenUpdatePayload, details: "Changed update should be rejected by idempotency." },
      },
      409,
    );
    assert(citizenUpdate.ticket.status === "submitted", "Citizen update should return ticket to submitted.");
    assert(citizenUpdate.ticket.primaryQueue.kind === "verification", "Citizen update should return ticket to verification.");
    assert(citizenUpdate.ticket.sla.stage === "verification" && !citizenUpdate.ticket.sla.paused, "Citizen update should restart verification SLA.");
    assert(citizenUpdate.ticket.evidence.length === 2, "Citizen update should append evidence metadata.");
    pass("request-info and idempotent citizen resubmission flow returns to verification");

    const uploadSession = await jsonRequest<{ session: EvidenceUploadSession }>(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence/upload-session`,
        headers: roadTicket.citizenAccessHeaders,
        payload: {
          fileName: "follow-up-video.mp4",
          mimeType: "video/mp4",
          sizeBytes: 2_400_000,
        },
      },
      201,
    );
    assert(uploadSession.session.uploadUrl.startsWith("mock-whistle-evidence://upload/"), "Evidence upload should use mock signed upload URL.");
    assert(uploadSession.session.evidence.controls.encryptionContext === "evidence:standard", "Standard evidence upload should use standard encryption context.");
    assert(uploadSession.session.evidence.controls.retentionPolicy === "standard_180_days", "Standard evidence upload should carry a retention policy.");
    assert(uploadSession.session.requiredHeaders["x-whistle-encryption-context"] === "evidence:standard", "Signed upload should require the evidence encryption context header.");
    assert(uploadSession.session.requiredHeaders["x-whistle-metadata-policy"] === "strip-before-preview", "Signed upload should require metadata stripping before preview.");
    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence/upload-session`,
        headers: roadTicket.citizenAccessHeaders,
        payload: {
          fileName: "browser-script.svg",
          mimeType: "image/svg+xml",
          sizeBytes: 2_000,
        },
      },
      400,
    );

    const earlyScanResult = await jsonRequest<{ result: EvidenceScanJobResult }>(
      app,
      {
        method: "POST",
        url: "/api/jobs/evidence-scans/run",
        headers: workerHeaders,
        payload: { actor: "worker:prototype" },
      },
    );
    assert(
      earlyScanResult.result.actions.every((action) => action.evidenceId !== uploadSession.session.evidence.id),
      "Evidence scanner should ignore upload-pending evidence until upload completion is recorded.",
    );

    const pendingEvidence = await jsonRequest<{ evidence: EvidenceAccessResult }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence?role=verification&actor=verification%3Aprototype`,
      headers: verificationHeaders,
    });
    const pendingUpload = pendingEvidence.evidence.items.find((item) => item.id === uploadSession.session.evidence.id);
    assert(pendingUpload?.storageState === "upload_pending", "Upload-session evidence should stay upload_pending before completion.");
    assert(pendingUpload.accessLevel === "metadata", "Upload-pending evidence must not be previewable.");
    assert(!("storageKey" in pendingUpload), "Metadata-level evidence access must not expose object-storage keys.");
    assert(!("checksum" in pendingUpload), "Metadata-level evidence access must not expose object checksums.");
    assert(!pendingUpload.controls, "Metadata-level evidence access must not expose internal security controls.");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence?role=minister&actor=minister%3Aprototype`,
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );

    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence/upload-session`,
        headers: citizenAccessHeaders(String(otherOwnerPayload.phone), otherOwnerPayload.phoneVerificationToken),
        payload: {
          fileName: "wrong-owner-follow-up.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 220_000,
        },
      },
      403,
    );

    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence/${encodeURIComponent(uploadSession.session.evidence.id)}/complete-upload`,
        headers: citizenAccessHeaders(String(otherOwnerPayload.phone), otherOwnerPayload.phoneVerificationToken),
        payload: {
          mimeType: "video/mp4",
          sizeBytes: 2_400_000,
          checksum: "mvp-sha256:wrong-owner",
        },
      },
      403,
    );

    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence/${encodeURIComponent(uploadSession.session.evidence.id)}/complete-upload`,
        headers: roadTicket.citizenAccessHeaders,
        payload: {
          mimeType: "image/jpeg",
          sizeBytes: 2_400_000,
          checksum: "mvp-sha256:mismatched-type",
        },
      },
      409,
    );

    const completedUpload = await jsonRequest<{ ticket: TicketRecord; evidence: NonNullable<EvidenceUploadSession["evidence"]> }>(app, {
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence/${encodeURIComponent(uploadSession.session.evidence.id)}/complete-upload`,
      headers: roadTicket.citizenAccessHeaders,
      payload: {
        mimeType: "video/mp4",
        sizeBytes: 2_400_000,
        checksum: "mvp-sha256:follow-up-video",
      },
    });
    assert(completedUpload.evidence.storageState === "scan_pending", "Completed upload should become scan_pending.");
    assert(completedUpload.evidence.checksum === "mvp-sha256:follow-up-video", "Completed upload should persist the object checksum.");

    const scanResult = await jsonRequest<{ result: EvidenceScanJobResult }>(
      app,
      {
        method: "POST",
        url: "/api/jobs/evidence-scans/run",
        headers: workerHeaders,
        payload: { actor: "worker:prototype" },
      },
    );
    const completedScanAction = scanResult.result.actions.find((action) => action.evidenceId === uploadSession.session.evidence.id);
    assert(completedScanAction?.toState === "available", "Evidence scan job should make completed upload-session evidence available.");
    assert(completedScanAction.reason.includes("Local scanner"), "Evidence scan should use the object-store scanner seam before preview.");

    const standardEvidence = await jsonRequest<{ evidence: EvidenceAccessResult }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence?role=verification&actor=verification%3Aspoofed-standard`,
      headers: verificationHeaders,
    });
    const standardPreview = standardEvidence.evidence.items.find((item) => item.accessLevel === "preview");
    assert(standardPreview, "Verification should receive preview access for available standard evidence.");
    assert(standardPreview.controls?.metadataStripped, "Previewable evidence should be marked metadata-stripped after scan.");
    assert(standardPreview.controls?.downloadAllowed === false, "Previewable evidence should still disallow direct downloads.");
    assert(Boolean(standardPreview.controls?.retentionUntil), "Evidence should carry an explicit retention deadline.");
    assert(standardPreview.watermark?.includes("verification:prototype"), "Previewable evidence watermark should use authenticated actor.");
    assert(!standardPreview.watermark?.includes("spoofed-standard"), "Previewable evidence watermark must ignore query actor spoofing.");

    const verificationEvidence = await jsonRequest<{ evidence: EvidenceAccessResult }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/evidence?role=verification&actor=verification%3Aprototype`,
      headers: verificationHeaders,
    });
    assert(verificationEvidence.evidence.role === "verification", "Verification console should receive evidence through the verification access role.");
    assert(verificationEvidence.evidence.items.some((item) => item.accessLevel === "preview"), "Verification console should receive preview access to available standard evidence.");
    const verificationPreviewItems = verificationEvidence.evidence.items.filter((item) => item.accessLevel === "preview");
    assert(verificationPreviewItems.every((item) => item.controls?.watermarkRequired), "Verification preview evidence access should expose watermark-required controls.");
    assert(
      verificationEvidence.evidence.items
        .filter((item) => item.accessLevel === "metadata")
        .every((item) => !("storageKey" in item) && !("checksum" in item) && !item.controls),
      "Verification metadata-level evidence access should redact storage keys, checksums, and controls.",
    );
    pass("evidence upload completion, scan, and standard preview access work with security controls");

    const routed = await decide(app, roadTicket.id, {
      action: "route_local",
      actor: "verification:prototype",
      reason: "Complaint is complete and belongs to Velachery local ownership.",
      ownerKey: "mla:velachery",
      ownerLabel: "Velachery MLA Office",
      scopeValue: "Velachery",
    });
    assert(routed.status === "routed_local", "Route-local decision should move ticket to local queue.");
    assert(routed.primaryQueue.kind === "local", "Route-local decision should assign local primary queue.");
    assert(routed.sla.stage === "local", "Route-local decision should start local SLA.");
    pass("verification can route a complete ticket to local/MLA ownership");

    const prematureMinisterDashboard = await dashboard(
      app,
      { role: "minister", ministry: "Municipal Administration and Water Supply" },
      { "x-whistle-role": "minister", "x-whistle-actor": "minister:prototype" },
    );
    assert(!includesTicket(prematureMinisterDashboard, roadTicket.id), "Minister dashboard must not include locally assigned tickets based only on category mapping.");
    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}`,
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );
    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/field-actions`,
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
        payload: {
          action: "schedule_visit",
          fieldOfficer: "MAWS Minister Office",
          visitAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          note: "Category-derived ministry access should not be enough for field action.",
        },
      },
      403,
    );
    pass("minister dashboards, ticket reads, and field actions require active ministry assignment scope");

    const routedCitizenUpdate = await jsonRequest<{ error: string; message: string }>(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/citizen-update`,
        headers: { ...roadTicket.citizenAccessHeaders, "idempotency-key": "citizen-update-routed-rejected-001" },
        payload: {
          details: "Trying to send the routed ticket back to verification after ownership changed.",
          evidence: [{ fileName: "late-route-reset.jpg", mimeType: "image/jpeg", sizeBytes: 120_000 }],
        },
      },
      409,
    );
    assert(routedCitizenUpdate.error === "citizen_update_not_allowed", "Citizen update should reject routed tickets.");
    const stillRouted = await getTicket(app, roadTicket.id);
    assert(stillRouted.status === "routed_local" && stillRouted.primaryQueue.kind === "local", "Rejected citizen update must preserve routed local ownership.");
    pass("citizen updates cannot reset routed tickets back to verification");

    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const firstSla = await jsonRequest<{ result: SlaJobResult }>(app, {
      method: "POST",
      url: "/api/jobs/sla-escalations/run",
      headers: workerHeaders,
      payload: { actor: "worker:prototype", now: future },
    });
    assert(firstSla.result.actions.some((action) => action.ticketId === roadTicket.id && action.outcome === "escalated_to_ministry"), "First SLA job should escalate local ticket to ministry.");

    const ministryTicket = await getTicket(app, roadTicket.id);
    assert(ministryTicket.primaryQueue.kind === "ministry", "Ticket should become ministry-primary after local SLA breach.");
    assert(ministryTicket.secondaryQueues.some((queueItem) => queueItem.kind === "local"), "Local queue should remain secondary after ministry escalation.");
    const primaryMinistryDashboard = await dashboard(
      app,
      { role: "minister", ministry: "Municipal Administration and Water Supply", primaryQueue: "ministry" },
      { "x-whistle-role": "minister", "x-whistle-actor": "minister:prototype" },
    );
    assert(includesTicket(primaryMinistryDashboard, roadTicket.id), "Minister primaryQueue=ministry dashboard should include ministry-owned tickets.");

    const secondSla = await jsonRequest<{ result: SlaJobResult }>(app, {
      method: "POST",
      url: "/api/jobs/sla-escalations/run",
      headers: workerHeaders,
      payload: { actor: "worker:prototype", now: future },
    });
    assert(secondSla.result.actions.some((action) => action.ticketId === roadTicket.id && action.outcome === "escalated_to_cm_cell"), "Second SLA job should escalate ministry ticket to CM Cell.");

    const cmTicket = await getTicket(app, roadTicket.id);
    assert(cmTicket.primaryQueue.kind === "cm_cell", "Ticket should become CM Cell-primary after ministry SLA breach.");
    assert(cmTicket.secondaryQueues.some((queueItem) => queueItem.kind === "ministry"), "Ministry should remain secondary after CM Cell escalation.");
    pass("SLA jobs escalate local to ministry, then ministry to CM Cell with secondary visibility");

    const cmDashboard = await dashboard(
      app,
      { role: "cm_cell", queue: "cm_cell" },
      { "x-whistle-role": "cm_cell", "x-whistle-actor": "cm_cell:prototype" },
    );
    assert(includesTicket(cmDashboard, roadTicket.id), "CM Cell dashboard should include CM-escalated ticket.");

    const ministryDashboard = await dashboard(
      app,
      { role: "minister", ministry: "Municipal Administration and Water Supply" },
      { "x-whistle-role": "minister", "x-whistle-actor": "minister:prototype" },
    );
    assert(includesTicket(ministryDashboard, roadTicket.id), "Minister dashboard should retain assigned-ministry visibility after CM escalation.");
    const postEscalationPrimaryMinistryDashboard = await dashboard(
      app,
      { role: "minister", ministry: "Municipal Administration and Water Supply", primaryQueue: "ministry" },
      { "x-whistle-role": "minister", "x-whistle-actor": "minister:prototype" },
    );
    assert(!includesTicket(postEscalationPrimaryMinistryDashboard, roadTicket.id), "Minister primaryQueue=ministry dashboard should exclude tickets once CM Cell is primary.");

    await dashboard(
      app,
      { role: "minister", ministry: "Rural Development & Panchayat Raj" },
      { "x-whistle-role": "minister", "x-whistle-actor": "minister:prototype" },
    );
    await jsonRequest(
      app,
      {
        method: "GET",
        url: "/api/dashboard?role=minister&ministry=Health%20and%20Family%20Welfare",
        headers: { "x-whistle-role": "minister", "x-whistle-actor": "minister:prototype" },
      },
      403,
    );

    const mlaDashboard = await dashboard(
      app,
      { role: "mla", constituency: "Velachery" },
      { "x-whistle-role": "mla", "x-whistle-actor": "mla:prototype" },
    );
    assert(includesTicket(mlaDashboard, roadTicket.id), "MLA dashboard should retain escalated-out secondary visibility.");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: "/api/dashboard?role=mla&constituency=Anna%20Nagar",
        headers: { "x-whistle-role": "mla", "x-whistle-actor": "mla:prototype" },
      },
      403,
    );
    pass("role-scoped dashboards preserve CM, minister, and MLA visibility");

    const protectedTicket = await createTicket(app, {
      category: "corruption",
      language: "en",
      title: "Bribe demand for certificate processing",
      description: "A citizen reports a demand for unofficial payment before certificate processing. Keep this protected for screened review.",
      phone: "+91 98765 22222",
      departmentHint: "Revenue",
      location: {
        district: "Coimbatore",
        area: "Peelamedu",
        landmark: "Taluk office",
      },
      evidence: [{ fileName: "protected-note.pdf", mimeType: "application/pdf", sizeBytes: 350_000 }],
    });
    assert(protectedTicket.protected, "Corruption ticket should be marked protected.");
    assert(protectedTicket.primaryQueue.kind === "protected_review", "Protected ticket should bypass local visibility.");
    assert(protectedTicket.evidence.every((item) => item.controls.classification === "protected"), "Protected ticket evidence should carry protected security classification.");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(protectedTicket.id)}`,
        headers: {
          "x-whistle-role": "cm_cell",
          "x-whistle-actor": "cm_cell:prototype",
        },
      },
      400,
    );

    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(protectedTicket.id)}/decision`,
        headers: verificationHeaders,
        payload: {
          action: "route_local",
          actor: "verification:prototype",
          reason: "Attempt to expose protected ticket to local owner should be blocked.",
          ownerKey: "mla:coimbatore-south",
          ownerLabel: "Coimbatore South MLA Office",
          scopeValue: "Coimbatore South",
        },
      },
      409,
    );

    const protectedAfterBlockedRoute = await getTicket(app, protectedTicket.id);
    assert(protectedAfterBlockedRoute.primaryQueue.kind === "protected_review", "Blocked protected route should preserve protected primary queue.");

    const protectedEvidenceForCitizen = await jsonRequest<{ evidence: EvidenceAccessResult }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(protectedTicket.id)}/evidence?role=citizen`,
      headers: protectedTicket.citizenAccessHeaders,
    });
    const hiddenProtectedEvidence = protectedEvidenceForCitizen.evidence.items[0];
    assert(hiddenProtectedEvidence?.accessLevel === "hidden", "Protected citizen evidence access should return hidden records.");
    assert(Boolean(hiddenProtectedEvidence.deniedReason), "Hidden protected evidence should explain why access is denied.");
    assert(!("storageKey" in hiddenProtectedEvidence), "Hidden protected evidence must not expose storage keys.");
    assert(!("checksum" in hiddenProtectedEvidence), "Hidden protected evidence must not expose checksums.");
    assert(!("controls" in hiddenProtectedEvidence), "Hidden protected evidence must not expose security controls.");
    assert(!("fileName" in hiddenProtectedEvidence), "Hidden protected evidence must not expose filenames.");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(protectedTicket.id)}`,
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );

    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(protectedTicket.id)}/evidence?role=minister&actor=minister%3Aprototype`,
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );
    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(protectedTicket.id)}/evidence/upload-session`,
        headers: {
          "x-whistle-role": "department_officer",
          "x-whistle-actor": "department_officer:prototype",
        },
        payload: {
          fileName: "protected-field-note.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 340_000,
        },
      },
      403,
    );

    await jsonRequest(
      app,
      {
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(protectedTicket.id)}/evidence?role=verification&actor=verification%3Aprototype`,
        headers: verificationHeaders,
      },
      400,
    );

    const protectedEvidenceForVerification = await jsonRequest<{ evidence: EvidenceAccessResult }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(protectedTicket.id)}/evidence?role=verification&actor=verification%3Aspoofed-protected`,
      headers: {
        ...verificationHeaders,
        "x-whistle-access-reason": "Verification smoke protected evidence review.",
      },
    });
    assert(protectedEvidenceForVerification.evidence.items.every((item) => item.accessLevel !== "hidden"), "Verification should retain governed metadata access to protected intake evidence.");
    assert(
      protectedEvidenceForVerification.evidence.items.every((item) => item.accessLevel === "metadata" && !("storageKey" in item) && !("checksum" in item) && !item.controls),
      "Verification protected metadata access should redact storage keys, checksums, and controls until preview is allowed.",
    );

    const protectedAudit = await jsonRequest<{ auditEvents: AuditEvent[] }>(app, {
      method: "GET",
      url: `/api/audit?ticketId=${encodeURIComponent(protectedTicket.id)}`,
      headers: cmCellHeaders,
    });
    assert(protectedAudit.auditEvents.some((event) => event.action === "protected.ticket.read"), "Protected ticket read should be break-glass audited.");
    const protectedEvidenceAudit = protectedAudit.auditEvents.find((event) => event.action === "evidence.protected_access_list");
    assert(protectedEvidenceAudit, "Protected evidence access should be break-glass audited.");
    assert(protectedEvidenceAudit.actor === "verification:prototype", "Protected evidence audit actor should come from authenticated context.");
    assert(protectedEvidenceAudit.actorRole === "verification", "Protected evidence audit role should come from authenticated context.");
    assert(!JSON.stringify(protectedAudit.auditEvents).includes("spoofed-protected"), "Protected evidence audit must not preserve query actor spoofing.");
    assert(protectedAudit.auditEvents.some((event) => event.action === "protected.audit.read"), "Protected audit inspection should itself be audited.");

    const protectedCmDashboard = await dashboard(
      app,
      { role: "cm_cell", queue: "protected_review" },
      { "x-whistle-role": "cm_cell", "x-whistle-actor": "cm_cell:prototype" },
    );
    assert(includesTicket(protectedCmDashboard, protectedTicket.id), "CM Cell should see protected queue tickets.");

    const protectedMlaDashboard = await dashboard(
      app,
      { role: "mla", constituency: "Velachery" },
      { "x-whistle-role": "mla", "x-whistle-actor": "mla:prototype" },
    );
    assert(!includesTicket(protectedMlaDashboard, protectedTicket.id), "MLA dashboard should not expose protected corruption ticket.");
    pass("protected corruption tickets require access reasons, audit protected reads, and mask restricted evidence");

    await jsonRequest(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(roadTicket.id)}/decision`,
        headers: verificationHeaders,
        payload: {
          action: "reject",
          actor: "verification:prototype",
          reason: "Attempt to re-decide a CM-escalated ticket should be blocked.",
        },
      },
      409,
    );

    const cmTicketAfterBlockedDecision = await getTicket(app, roadTicket.id);
    assert(cmTicketAfterBlockedDecision.primaryQueue.kind === "cm_cell", "Blocked re-decision should preserve CM Cell primary queue.");
    pass("verification decisions are blocked after a ticket leaves intake");

    const waterTicket = await createTicket(app, {
      category: "water",
      language: "en",
      title: "Water tanker not reaching street",
      description: "The scheduled drinking water tanker has not reached the street for three days and elderly residents are affected.",
      phone: "+91 98765 33333",
      departmentHint: "Metro Water / Local Body",
      location: {
        district: "Madurai",
        area: "K. Pudur",
        landmark: "Near ration shop",
      },
      evidence: [],
    });
    const rejected = await decide(app, waterTicket.id, {
      action: "reject",
      actor: "verification:prototype",
      reason: "Insufficient government-addressable details; must enter independent rejection review.",
    });
    assert(rejected.status === "rejected", "Rejected ticket should carry rejected status.");
    assert(rejected.primaryQueue.kind === "rejection_review", "Rejected ticket should enter CM-maintained rejection review.");
    assert(rejected.sla.stage === "rejection_review", "Rejected ticket should use rejection-review SLA.");

    const rejectionDashboard = await dashboard(
      app,
      { role: "cm_cell", queue: "rejection_review" },
      { "x-whistle-role": "cm_cell", "x-whistle-actor": "cm_cell:prototype" },
    );
    assert(includesTicket(rejectionDashboard, waterTicket.id), "CM Cell dashboard should expose rejection-review queue.");
    pass("verification rejections enter CM-maintained review");

    const overturned = await reviewRejection(app, waterTicket.id, {
      action: "overturn_and_route",
      actor: "cm_cell:prototype",
      reason: "CM review found enough address and impact detail; restore the case to local execution.",
      ownerKey: "local:madurai-k-pudur",
      ownerLabel: "Madurai K. Pudur Local Field Team",
      scopeValue: "Madurai K. Pudur",
    });
    assert(overturned.status === "routed_local", "Overturned rejection should restore the ticket to local routing.");
    assert(overturned.primaryQueue.kind === "local", "Overturned rejection should make local execution the primary queue.");
    assert(overturned.secondaryQueues.some((queue) => queue.kind === "rejection_review"), "Overturned rejection should retain rejection-review visibility.");
    assert(overturned.sla.stage === "local", "Overturned rejection should restart the local SLA.");

    const sparseTicket = await createTicket(app, {
      category: "roads",
      language: "en",
      title: "Road complaint without location clarity",
      description: "The road has repeated damage but the exact stretch and landmark need to be clarified for government routing.",
      phone: "+91 98765 33334",
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Salem",
        area: "Fairlands",
      },
      evidence: [],
    });
    await decide(app, sparseTicket.id, {
      action: "reject",
      actor: "verification:prototype",
      reason: "Verification rejected due to unclear local jurisdiction; CM review must decide whether to request citizen details.",
    });
    const clarification = await reviewRejection(app, sparseTicket.id, {
      action: "request_info",
      actor: "cm_cell:prototype",
      reason: "Issue appears government-addressable; request exact street and landmark instead of closing.",
      missingFields: ["Exact street", "Nearest landmark"],
      citizenMessage: "CM review found this may be valid. Please add the exact street and nearest landmark so we can route it.",
    });
    assert(clarification.status === "needs_info", "Rejection review request-info should send the ticket back to the citizen.");
    assert(clarification.primaryQueue.kind === "citizen", "Rejection review request-info should make citizen response the primary queue.");
    assert(clarification.secondaryQueues.some((queue) => queue.kind === "rejection_review"), "Clarification should retain rejection-review oversight.");
    assert(clarification.sla.paused, "Clarification should pause the rejection-review SLA while waiting for citizen input.");

    const duplicateTicket = await createTicket(app, {
      category: "water",
      language: "en",
      title: "Duplicate tanker complaint already resolved",
      description: "This appears to duplicate an already resolved tanker delivery complaint and has no new location or impact details.",
      phone: "+91 98765 33335",
      departmentHint: "Metro Water / Local Body",
      location: {
        district: "Madurai",
        area: "K. Pudur",
      },
      evidence: [],
    });
    await decide(app, duplicateTicket.id, {
      action: "reject",
      actor: "verification:prototype",
      reason: "Duplicate of an existing resolved complaint; independent review required before closure.",
    });
    const upheld = await reviewRejection(app, duplicateTicket.id, {
      action: "uphold_rejection",
      actor: "cm_cell:prototype",
      reason: "CM review confirmed this is a duplicate with no new actionable details.",
      closureNote: "Rejection upheld because the complaint duplicates an already resolved issue and does not include new evidence.",
    });
    assert(upheld.status === "closed", "Upheld rejection should close the ticket.");
    assert(upheld.sla.state === "resolved" && upheld.sla.dueAt === null, "Upheld rejection should close the rejection-review SLA.");
    const closedCitizenUpdate = await jsonRequest<{ error: string; message: string }>(
      app,
      {
        method: "POST",
        url: `/api/tickets/${encodeURIComponent(duplicateTicket.id)}/citizen-update`,
        headers: { ...duplicateTicket.citizenAccessHeaders, "idempotency-key": "citizen-update-closed-rejected-001" },
        payload: {
          details: "Trying to restart a closed ticket through the generic citizen update route.",
          evidence: [],
        },
      },
      409,
    );
    assert(closedCitizenUpdate.error === "citizen_update_not_allowed", "Citizen update should reject closed tickets.");
    pass("CM-maintained rejection review can overturn, request citizen details, or uphold closure");

    const notificationJob = await jsonRequest<{ result: NotificationJobResult }>(app, {
      method: "POST",
      url: "/api/jobs/notifications/run",
      headers: workerHeaders,
      payload: { actor: "worker:prototype" },
    });
    assert(notificationJob.result.sentCount > 0, "Notification job should deliver queued MVP notifications.");

    const roadNotifications = await jsonRequest<{ notifications: NotificationIntent[] }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(roadTicket.id)}/notifications`,
      headers: roadTicket.citizenAccessHeaders,
    });
    assert(roadNotifications.notifications.length > 0, "Citizen ticket should have notification history.");
    assert(roadNotifications.notifications.every((notification) => notification.status === "sent"), "Notification job should mark ticket notifications sent.");
    const rejectionNotifications = await jsonRequest<{ notifications: NotificationIntent[] }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(duplicateTicket.id)}/notifications`,
      headers: duplicateTicket.citizenAccessHeaders,
    });
    assert(rejectionNotifications.notifications.some((notification) => notification.topic === "rejection_upheld"), "Upheld rejection should queue citizen notification.");
    pass("citizen notification history is generated and delivered by MVP worker");

    const roadAudit = await jsonRequest<{ auditEvents: AuditEvent[] }>(
      app,
      {
        method: "GET",
        url: `/api/audit?ticketId=${encodeURIComponent(roadTicket.id)}`,
        headers: {
          "x-whistle-role": "verification",
          "x-whistle-actor": "verification:prototype",
        },
      },
    );
    assert(roadAudit.auditEvents.length >= 8, "Ticket lifecycle should produce audit events across creation, evidence, routing, SLA, and notifications.");
    assert(roadAudit.auditEvents.every((event) => event.previousHash && event.eventHash && event.chainSequence), "Ticket-filtered audit events should include hash-chain metadata.");
    const verifierDecisionAudit = roadAudit.auditEvents.find((event) => event.action === "verification.request_info");
    assert(verifierDecisionAudit, "Request-info verification decision should be audited.");
    assert(verifierDecisionAudit.actor === "verification:prototype", "Verification decision audit actor should come from authenticated context.");
    assert(verifierDecisionAudit.actorRole === "verification", "Verification decision audit role should come from authenticated context.");
    assert(verifierDecisionAudit.reason?.includes("access=allowed:verification.decision:queue:verification"), "Verification decision audit should include access decision context.");
    assert(!JSON.stringify(roadAudit.auditEvents).includes("verification:spoofed-client"), "Verification decision audit must not preserve caller-provided actor spoofing.");

    const orderedAudit = (await fetchAllAuditEvents(app)).slice().sort((left, right) => (left.chainSequence ?? 0) - (right.chainSequence ?? 0));
    const chain = verifyAuditHashChain(orderedAudit);
    assert(chain.ok, chain.reason);
    pass("ticket lifecycle writes a tamper-evident audit trail");

    pass("ticket lifecycle smoke completed");
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
