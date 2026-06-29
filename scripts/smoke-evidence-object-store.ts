import { createHash } from "node:crypto";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  deploymentProfile: process.env.WHISTLE_DEPLOYMENT_PROFILE,
  env: process.env.WHISTLE_ENV,
  nodeEnv: process.env.NODE_ENV,
  evidenceMode: process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE,
  evidenceEndpoint: process.env.WHISTLE_EVIDENCE_S3_ENDPOINT,
  evidenceBucket: process.env.WHISTLE_EVIDENCE_S3_BUCKET,
  evidenceRegion: process.env.WHISTLE_EVIDENCE_S3_REGION,
  evidenceKmsKeyId: process.env.WHISTLE_EVIDENCE_KMS_KEY_ID,
  evidenceScanner: process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED,
  evidenceResidency: process.env.WHISTLE_EVIDENCE_DATA_RESIDENCY,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
};

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.WHISTLE_SEED_DEMO = "false";
delete process.env.DATABASE_URL;
delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
delete process.env.WHISTLE_ENV;
delete process.env.NODE_ENV;

const { buildWhistleApi } = await import("../server/app.js");
const { withVerifiedPhone } = await import("./smoke-helpers.js");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

async function withApp<T>(run: (app: ReturnType<typeof buildWhistleApi>) => Promise<T>) {
  const app = buildWhistleApi();
  await app.ready();
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

async function createRoadTicket(app: ReturnType<typeof buildWhistleApi>, phone: string, title: string) {
  const payload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title,
    description: "A civic issue used to prove evidence object storage readiness and scan behavior.",
    phone,
    departmentHint: "Corporation / Municipality",
    location: {
      district: "Chennai",
      area: "Velachery",
      landmark: "Main road",
    },
    evidence: [],
  });
  const created = await app.inject({ method: "POST", url: "/api/tickets", payload });
  assert(created.statusCode === 201, `Ticket create returned ${created.statusCode}; expected 201. Body: ${created.body}`);
  return {
    payload,
    ticketId: created.json<{ ticket: { id: string } }>().ticket.id,
  };
}

async function startUploadSession(
  app: ReturnType<typeof buildWhistleApi>,
  ticketId: string,
  payload: { phone: string; phoneVerificationToken: string },
  fileName: string,
  options: { mimeType?: string; sizeBytes?: number } = {},
) {
  const session = await app.inject({
    method: "POST",
    url: `/api/tickets/${encodeURIComponent(ticketId)}/evidence/upload-session`,
    headers: {
      "x-whistle-citizen-phone": payload.phone,
      "x-whistle-citizen-token": payload.phoneVerificationToken,
    },
    payload: {
      fileName,
      mimeType: options.mimeType ?? "image/jpeg",
      sizeBytes: options.sizeBytes ?? 350_000,
    },
  });
  assert(session.statusCode === 201, `Upload session returned ${session.statusCode}; expected 201. Body: ${session.body}`);
  return session.json<{ session: { evidence: { id: string } } }>().session.evidence.id;
}

async function uploadBinary(
  app: ReturnType<typeof buildWhistleApi>,
  ticketId: string,
  evidenceId: string,
  payload: { phone: string; phoneVerificationToken: string },
  bytes: Buffer,
  mimeType = "image/jpeg",
) {
  return app.inject({
    method: "PUT",
    url: `/api/tickets/${encodeURIComponent(ticketId)}/evidence/${encodeURIComponent(evidenceId)}/upload-binary`,
    headers: {
      "content-type": mimeType,
      "x-whistle-content-sha256": createHash("sha256").update(bytes).digest("hex"),
      "x-whistle-citizen-phone": payload.phone,
      "x-whistle-citizen-token": payload.phoneVerificationToken,
    },
    payload: bytes,
  });
}

async function completeUpload(
  app: ReturnType<typeof buildWhistleApi>,
  ticketId: string,
  evidenceId: string,
  payload: { phone: string; phoneVerificationToken: string },
  checksum: string,
) {
  return app.inject({
    method: "POST",
    url: `/api/tickets/${encodeURIComponent(ticketId)}/evidence/${encodeURIComponent(evidenceId)}/complete-upload`,
    headers: {
      "x-whistle-citizen-phone": payload.phone,
      "x-whistle-citizen-token": payload.phoneVerificationToken,
    },
    payload: {
      mimeType: "image/jpeg",
      sizeBytes: 350_000,
      checksum,
    },
  });
}

try {
  process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE = "disabled";
  delete process.env.WHISTLE_EVIDENCE_S3_ENDPOINT;
  delete process.env.WHISTLE_EVIDENCE_S3_BUCKET;
  delete process.env.WHISTLE_EVIDENCE_S3_REGION;
  delete process.env.WHISTLE_EVIDENCE_KMS_KEY_ID;
  delete process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED;
  delete process.env.WHISTLE_EVIDENCE_DATA_RESIDENCY;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Readiness returned ${readiness.statusCode}; expected 503 with disabled evidence store. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "evidence_object_store" && dependency.mode === "evidence-object-store-disabled" && !dependency.ok),
      "Readiness should fail the evidence_object_store dependency when object storage is disabled.",
    );

    const { payload, ticketId } = await createRoadTicket(app, "+91 98765 75551", "Disabled evidence store smoke");
    const evidenceId = await startUploadSession(app, ticketId, payload, "store-disabled-photo.jpg");
    const complete = await completeUpload(app, ticketId, evidenceId, payload, "mvp-sha256:disabled-evidence-store");
    assert(complete.statusCode === 503, `Complete upload returned ${complete.statusCode}; expected 503. Body: ${complete.body}`);
    assert(
      complete.json<{ error: string; message: string }>().error === "evidence_object_store_unavailable",
      "Complete upload should identify evidence object-store unavailability.",
    );

    const scan = await app.inject({
      method: "POST",
      url: "/api/jobs/evidence-scans/run",
      headers: {
        "x-whistle-role": "worker",
        "x-whistle-actor": "worker:prototype",
      },
      payload: { actor: "worker:prototype" },
    });
    assert(scan.statusCode === 200, `Evidence scan returned ${scan.statusCode}; expected 200 when no scan-pending objects exist. Body: ${scan.body}`);
  });
  pass("disabled evidence object-store fails readiness and blocks completed evidence uploads");

  delete process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE;
  delete process.env.WHISTLE_EVIDENCE_S3_ENDPOINT;
  delete process.env.WHISTLE_EVIDENCE_S3_BUCKET;
  delete process.env.WHISTLE_EVIDENCE_S3_REGION;
  delete process.env.WHISTLE_EVIDENCE_KMS_KEY_ID;
  delete process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED;
  delete process.env.WHISTLE_EVIDENCE_DATA_RESIDENCY;
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Production-profile evidence readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "evidence_object_store" && dependency.mode === "evidence-object-store-disabled" && !dependency.ok),
      "Production profile should disable local mock evidence storage when no approved object store is configured.",
    );
  });
  pass("production profile disables local mock evidence storage when provider wiring is missing");

  delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE = "s3-compatible";
  delete process.env.WHISTLE_EVIDENCE_S3_ENDPOINT;
  delete process.env.WHISTLE_EVIDENCE_S3_BUCKET;
  process.env.WHISTLE_EVIDENCE_KMS_KEY_ID = "kms-test-key";
  process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED = "true";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Misconfigured S3 readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "evidence_object_store" && dependency.mode === "s3-compatible-object-store-unimplemented" && !dependency.ok),
      "Readiness should fail when S3-compatible evidence storage is missing endpoint/bucket config.",
    );

    const { payload, ticketId } = await createRoadTicket(app, "+91 98765 75552", "Misconfigured evidence store smoke");
    const evidenceId = await startUploadSession(app, ticketId, payload, "store-misconfigured-photo.jpg");
    const complete = await completeUpload(app, ticketId, evidenceId, payload, "mvp-sha256:misconfigured-evidence-store");
    assert(complete.statusCode === 503, `Misconfigured complete upload returned ${complete.statusCode}; expected 503. Body: ${complete.body}`);
  });
  pass("misconfigured S3-compatible evidence store fails readiness and upload completion");

  process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE = "s3-compatible";
  process.env.WHISTLE_EVIDENCE_S3_ENDPOINT = "https://object-store.tn.example.gov";
  process.env.WHISTLE_EVIDENCE_S3_BUCKET = "whistle-evidence";
  process.env.WHISTLE_EVIDENCE_S3_REGION = "ap-south-1";
  process.env.WHISTLE_EVIDENCE_KMS_KEY_ID = "kms-whistle-evidence";
  process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED = "true";
  process.env.WHISTLE_EVIDENCE_DATA_RESIDENCY = "India";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Configured S3 readiness returned ${readiness.statusCode}; expected 503 until a real adapter exists. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "evidence_object_store" && dependency.mode === "s3-compatible-object-store-unimplemented" && !dependency.ok),
      "Readiness should fail closed for the declared S3-compatible evidence mode until a real adapter exists.",
    );

    const { payload, ticketId } = await createRoadTicket(app, "+91 98765 75553", "Configured S3 fail-closed smoke");
    const evidenceId = await startUploadSession(app, ticketId, payload, "store-configured-photo.jpg");
    const complete = await completeUpload(app, ticketId, evidenceId, payload, "mvp-sha256:configured-evidence-store");
    assert(complete.statusCode === 503, `Configured S3 complete upload returned ${complete.statusCode}; expected 503 until a real adapter exists. Body: ${complete.body}`);
    assert(
      complete.json<{ error: string; message: string }>().message.includes("no real object-store adapter"),
      "Configured S3 complete upload should explain that the real adapter is not implemented.",
    );
  });
  pass("configured S3-compatible evidence store fails closed until a real adapter exists");

  delete process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE;
  delete process.env.WHISTLE_EVIDENCE_S3_ENDPOINT;
  delete process.env.WHISTLE_EVIDENCE_S3_BUCKET;
  delete process.env.WHISTLE_EVIDENCE_S3_REGION;
  delete process.env.WHISTLE_EVIDENCE_KMS_KEY_ID;
  delete process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED;
  delete process.env.WHISTLE_EVIDENCE_DATA_RESIDENCY;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 200, `Local evidence readiness returned ${readiness.statusCode}; expected 200. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "evidence_object_store" && dependency.mode === "local-mock-object-store" && dependency.ok),
      "Local development should still expose the mock evidence object store for smoke coverage.",
    );

    const { payload, ticketId } = await createRoadTicket(app, "+91 98765 75555", "Local evidence store smoke");
    const evidenceId = await startUploadSession(app, ticketId, payload, "store-local-photo.jpg");
    const complete = await completeUpload(app, ticketId, evidenceId, payload, "mvp-sha256:local-evidence-store");
    assert(complete.statusCode === 200, `Local complete upload returned ${complete.statusCode}; expected 200. Body: ${complete.body}`);
    assert(complete.json<{ evidence: { storageState: string } }>().evidence.storageState === "scan_pending", "Local object store completion should queue scan.");

    const scan = await app.inject({
      method: "POST",
      url: "/api/jobs/evidence-scans/run",
      headers: {
        "x-whistle-role": "worker",
        "x-whistle-actor": "worker:prototype",
      },
      payload: { actor: "worker:prototype", limit: 10 },
    });
    assert(scan.statusCode === 200, `Configured evidence scan returned ${scan.statusCode}; expected 200. Body: ${scan.body}`);
    assert(
      scan.json<{ result: { actions: Array<{ evidenceId: string; toState: string }> } }>().result.actions.some((action) => action.evidenceId === evidenceId && action.toState === "available"),
      "Local object-store scan should make clean completed evidence available.",
    );

    const binaryBytes = Buffer.from("real-local-uat-image-bytes");
    const binaryTicket = await createRoadTicket(app, "+91 98765 75556", "Binary evidence upload smoke");
    const binaryEvidenceId = await startUploadSession(app, binaryTicket.ticketId, binaryTicket.payload, "real-binary-photo.jpg", {
      sizeBytes: binaryBytes.byteLength,
    });
    const binaryUpload = await uploadBinary(app, binaryTicket.ticketId, binaryEvidenceId, binaryTicket.payload, binaryBytes);
    assert(binaryUpload.statusCode === 200, `Binary evidence upload returned ${binaryUpload.statusCode}; expected 200. Body: ${binaryUpload.body}`);
    const binaryBody = binaryUpload.json<{ evidence: { storageState: string; checksum?: string }; scan: { actions: Array<{ evidenceId: string; toState: string }> } }>();
    assert(binaryBody.evidence.storageState === "available", "Binary evidence upload should complete and scan to available for local UAT.");
    assert(binaryBody.evidence.checksum === `sha256:${createHash("sha256").update(binaryBytes).digest("hex")}`, "Binary evidence checksum should be recorded from the uploaded bytes.");
    assert(binaryBody.scan.actions.some((action) => action.evidenceId === binaryEvidenceId && action.toState === "available"), "Binary evidence upload should run a scan action for the uploaded evidence.");
  });
  pass("local evidence store records metadata and binary uploads, then scans clean evidence");
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
  if (originalEnv.evidenceMode === undefined) delete process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE;
  else process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE = originalEnv.evidenceMode;
  if (originalEnv.evidenceEndpoint === undefined) delete process.env.WHISTLE_EVIDENCE_S3_ENDPOINT;
  else process.env.WHISTLE_EVIDENCE_S3_ENDPOINT = originalEnv.evidenceEndpoint;
  if (originalEnv.evidenceBucket === undefined) delete process.env.WHISTLE_EVIDENCE_S3_BUCKET;
  else process.env.WHISTLE_EVIDENCE_S3_BUCKET = originalEnv.evidenceBucket;
  if (originalEnv.evidenceRegion === undefined) delete process.env.WHISTLE_EVIDENCE_S3_REGION;
  else process.env.WHISTLE_EVIDENCE_S3_REGION = originalEnv.evidenceRegion;
  if (originalEnv.evidenceKmsKeyId === undefined) delete process.env.WHISTLE_EVIDENCE_KMS_KEY_ID;
  else process.env.WHISTLE_EVIDENCE_KMS_KEY_ID = originalEnv.evidenceKmsKeyId;
  if (originalEnv.evidenceScanner === undefined) delete process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED;
  else process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED = originalEnv.evidenceScanner;
  if (originalEnv.evidenceResidency === undefined) delete process.env.WHISTLE_EVIDENCE_DATA_RESIDENCY;
  else process.env.WHISTLE_EVIDENCE_DATA_RESIDENCY = originalEnv.evidenceResidency;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
}
