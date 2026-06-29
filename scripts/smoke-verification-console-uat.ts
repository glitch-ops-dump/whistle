import { createHash } from "node:crypto";
import { buildWhistleApi } from "../server/app.js";
import type { EvidenceAccessResult, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  deploymentProfile: process.env.WHISTLE_DEPLOYMENT_PROFILE,
  env: process.env.WHISTLE_ENV,
  nodeEnv: process.env.NODE_ENV,
  prototypeOfficialAuth: process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH,
  issuer: process.env.WHISTLE_OFFICIAL_OIDC_ISSUER,
  audience: process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE,
  secret: process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET,
  mfaRequired: process.env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
  exposeMockOtp: process.env.WHISTLE_EXPOSE_MOCK_OTP,
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

async function withApp<T>(run: (app: WhistleApi) => Promise<T>) {
  const app = buildWhistleApi();
  await app.ready();
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

async function createTicket(app: WhistleApi, payload: Record<string, unknown>) {
  const created = await createTicketWithAccess(app, payload);
  return created.ticket;
}

async function createTicketWithAccess(app: WhistleApi, payload: Record<string, unknown>) {
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
  assert(result.ticket, "Ticket should be created for verification console smoke.");
  return { ticket: result.ticket, payload: verifiedPayload };
}

async function uploadCitizenEvidence(app: WhistleApi, ticketId: string, payload: Record<string, unknown> & { phoneVerificationToken: string }) {
  const citizenHeaders = {
    "x-whistle-citizen-phone": String(payload.phone),
    "x-whistle-citizen-token": payload.phoneVerificationToken,
  };
  const bytes = Buffer.from("verification-console-local-uat-evidence-bytes");
  const session = await jsonRequest<{ session: { evidence: { id: string } } }>(
    app,
    {
      method: "POST",
      url: `/api/tickets/${encodeURIComponent(ticketId)}/evidence/upload-session`,
      headers: citizenHeaders,
      payload: {
        fileName: "road-damage-live-upload.jpg",
        mimeType: "image/jpeg",
        sizeBytes: bytes.byteLength,
      },
    },
    201,
  );
  const upload = await app.inject({
    method: "PUT",
    url: `/api/tickets/${encodeURIComponent(ticketId)}/evidence/${encodeURIComponent(session.session.evidence.id)}/upload-binary`,
    headers: {
      ...citizenHeaders,
      "content-type": "image/jpeg",
      "x-whistle-content-sha256": createHash("sha256").update(bytes).digest("hex"),
    },
    payload: bytes,
  });
  assert(upload.statusCode === 200, `Binary evidence upload returned ${upload.statusCode}; expected 200. Body: ${upload.body}`);
  return upload.json<{ evidence: { id: string; storageState: string; checksum?: string } }>().evidence;
}

async function localUatToken(app: WhistleApi, actor = "verification:prototype", role = "verification") {
  const result = await jsonRequest<{ token: string; storageKey: string }>(
    app,
    {
      method: "POST",
      url: "/api/local-uat/official-token",
      payload: { actor, role },
    },
    200,
  );
  assert(result.storageKey === `whistle.officialBearerToken.${actor}`, "Local UAT token endpoint should return the browser storage key.");
  assert(result.token.length > 80, "Local UAT token endpoint should mint a bearer token.");
  return `Bearer ${result.token}`;
}

try {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "local";
  process.env.WHISTLE_SEED_DEMO = "false";
  process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH = "false";
  process.env.WHISTLE_OFFICIAL_OIDC_ISSUER = "https://id.local.whistle.test/realms/whistle";
  process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE = "whistle-government-console";
  process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET = "local-mvp1-oidc-smoke-secret-do-not-use-for-staging-or-production";
  process.env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED = "true";
  delete process.env.DATABASE_URL;
  delete process.env.WHISTLE_ENV;
  delete process.env.NODE_ENV;
  delete process.env.WHISTLE_EXPOSE_MOCK_OTP;

  await withApp(async (app) => {
    const prototypeHeaders = await app.inject({
      method: "GET",
      url: "/api/verification/queue",
      headers: {
        "x-whistle-role": "verification",
        "x-whistle-actor": "verification:prototype",
      },
    });
    assert(prototypeHeaders.statusCode === 403, `Prototype verification headers returned ${prototypeHeaders.statusCode}; expected 403.`);

    const verificationBearer = await localUatToken(app);
    const authHeaders = { authorization: verificationBearer };
    const standardCreated = await createTicketWithAccess(app, {
      category: "roads",
      language: "en",
      title: "Verification console road ticket",
      description: "Road damage near a bus stop needs verification routing to a ward owner.",
      phone: "+91 98765 79001",
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Chennai",
        area: "Velachery",
        landmark: "Near main road bus stop",
      },
      evidence: [],
    });
    const standardTicket = standardCreated.ticket;
    const uploadedEvidence = await uploadCitizenEvidence(app, standardTicket.id, standardCreated.payload);
    assert(uploadedEvidence.storageState === "available", "Citizen binary upload should be scanned and available before console preview.");

    const queue = await jsonRequest<{ tickets: TicketRecord[] }>(app, {
      method: "GET",
      url: "/api/verification/queue",
      headers: authHeaders,
    });
    assert(queue.tickets.some((ticket) => ticket.id === standardTicket.id), "Verification queue should include the newly submitted ticket.");
    pass("verification console local-UAT token can load the queue");

    const evidence = await jsonRequest<{ evidence: EvidenceAccessResult }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(standardTicket.id)}/evidence?role=verification&actor=verification%3Aprototype`,
      headers: authHeaders,
    });
    assert(evidence.evidence.items.length === 1, "Verification evidence access should expose the ticket evidence metadata.");
    assert(evidence.evidence.items[0]?.accessLevel === "preview", "Verification evidence access should provide preview-level access.");
    pass("verification console can read governed evidence through bearer auth");

    const run = await jsonRequest<{ run: { ticketId: string; purpose: string } }>(
      app,
      {
        method: "POST",
        url: `/api/verification/${encodeURIComponent(standardTicket.id)}/agent-runs`,
        headers: authHeaders,
      },
      201,
    );
    assert(run.run.ticketId === standardTicket.id && run.run.purpose === "intake_verification", "Reviewer packet should be created for the selected ticket.");
    pass("verification console can create recommend-only reviewer packets");

    const decision = await jsonRequest<{ ticket: TicketRecord }>(app, {
      method: "POST",
      url: `/api/verification/${encodeURIComponent(standardTicket.id)}/decision`,
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "idempotency-key": "verification-console-smoke-route-001",
      },
      payload: {
        action: "route_local",
        actor: "verification:prototype",
        reason: "Ticket has enough category, location, and evidence for local action.",
        ownerKey: "local:velachery-ward-owner",
        ownerLabel: "Velachery Ward Owner",
        scopeValue: "ward-176",
      },
    });
    assert(decision.ticket.primaryQueue.kind === "local", "Verification route decision should move the ticket to a local primary queue.");
    assert(decision.ticket.secondaryQueues.some((queueItem) => queueItem.kind === "verification"), "Routed tickets should retain verification as secondary visibility.");
    pass("verification console decision action mutates the ticket spine");

    const protectedTicket = await createTicket(app, {
      category: "corruption",
      language: "en",
      title: "Protected intake bribe report",
      description: "A citizen reports an unofficial payment demand and asks for protected handling.",
      phone: "+91 98765 79002",
      departmentHint: "Revenue",
      location: {
        district: "Madurai",
        area: "Taluk Office",
        landmark: "Front counter",
      },
      evidence: [{ fileName: "note-photo.jpg", mimeType: "image/jpeg", sizeBytes: 280_000 }],
    });
    const protectedEvidence = await jsonRequest<{ evidence: EvidenceAccessResult }>(app, {
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(protectedTicket.id)}/evidence?role=verification&actor=verification%3Aprototype`,
      headers: {
        ...authHeaders,
        "x-whistle-access-reason": "Verification intake evidence review",
      },
    });
    assert(protectedEvidence.evidence.protected, "Protected ticket evidence response should be marked protected.");
    assert(protectedEvidence.evidence.items[0]?.accessLevel === "metadata", "Protected intake evidence should stay metadata-only until upload/scan preview is available.");
    assert(!protectedEvidence.evidence.items[0]?.controls, "Protected metadata-level evidence should redact internal controls.");
    assert(!("storageKey" in protectedEvidence.evidence.items[0]), "Protected metadata-level evidence should redact storage keys.");
    pass("verification console supplies access reason for protected evidence");
  });

  process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";
  await withApp(async (app) => {
    const tokenAttempt = await app.inject({
      method: "POST",
      url: "/api/local-uat/official-token",
      payload: { actor: "verification:prototype", role: "verification" },
    });
    assert(tokenAttempt.statusCode === 404, `Production token bootstrap returned ${tokenAttempt.statusCode}; expected 404.`);
  });
  pass("local-UAT browser token endpoint is unavailable outside local runtime");
} finally {
  if (originalEnv.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalEnv.logLevel;
  if (originalEnv.deploymentProfile === undefined) delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  else process.env.WHISTLE_DEPLOYMENT_PROFILE = originalEnv.deploymentProfile;
  if (originalEnv.env === undefined) delete process.env.WHISTLE_ENV;
  else process.env.WHISTLE_ENV = originalEnv.env;
  if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.prototypeOfficialAuth === undefined) delete process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH;
  else process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH = originalEnv.prototypeOfficialAuth;
  if (originalEnv.issuer === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_ISSUER;
  else process.env.WHISTLE_OFFICIAL_OIDC_ISSUER = originalEnv.issuer;
  if (originalEnv.audience === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE;
  else process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE = originalEnv.audience;
  if (originalEnv.secret === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET;
  else process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET = originalEnv.secret;
  if (originalEnv.mfaRequired === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED;
  else process.env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED = originalEnv.mfaRequired;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
  if (originalEnv.exposeMockOtp === undefined) delete process.env.WHISTLE_EXPOSE_MOCK_OTP;
  else process.env.WHISTLE_EXPOSE_MOCK_OTP = originalEnv.exposeMockOtp;
}
