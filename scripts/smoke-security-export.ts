import { createServer, type IncomingMessage } from "node:http";
import { buildWhistleApi } from "../server/app.js";
import type { AuditExportPackage, ConfigChangeRequest } from "../server/config/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
  deploymentProfile: process.env.WHISTLE_DEPLOYMENT_PROFILE,
  env: process.env.WHISTLE_ENV,
  nodeEnv: process.env.NODE_ENV,
  mode: process.env.WHISTLE_SECURITY_EXPORT_MODE,
  webhookUrl: process.env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL,
  apiKey: process.env.WHISTLE_SECURITY_EXPORT_API_KEY,
  legacyWebhookUrl: process.env.WHISTLE_AUDIT_EXPORT_WEBHOOK_URL,
  legacyApiKey: process.env.WHISTLE_AUDIT_EXPORT_API_KEY,
};

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.WHISTLE_SEED_DEMO = "false";
delete process.env.DATABASE_URL;
delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
delete process.env.WHISTLE_ENV;
delete process.env.NODE_ENV;

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

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
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

async function startSecurityExportWebhook() {
  const requests: Array<{ authorization: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
    requests.push({
      authorization: String(request.headers.authorization ?? ""),
      body,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        providerExportId: body.kind === "audit_export" ? `worm_${String((body.exportPackage as { id?: unknown } | undefined)?.id ?? "audit")}` : "siem_log_received",
        reason: "Security export webhook accepted payload.",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "Security export webhook smoke server did not expose a port.");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/security-export`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function eventually(condition: () => boolean, message: string) {
  for (let index = 0; index < 20; index += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(false, message);
}

try {
  process.env.WHISTLE_SECURITY_EXPORT_MODE = "disabled";
  delete process.env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL;
  delete process.env.WHISTLE_SECURITY_EXPORT_API_KEY;
  delete process.env.WHISTLE_AUDIT_EXPORT_WEBHOOK_URL;
  delete process.env.WHISTLE_AUDIT_EXPORT_API_KEY;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Disabled security export readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "security_export" && dependency.mode === "security-export-disabled" && !dependency.ok),
      "Readiness should fail when security export is disabled.",
    );

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/admin/governance/audit-export",
      headers: adminHeaders,
    });
    assert(exportResponse.statusCode === 503, `Disabled security export returned ${exportResponse.statusCode}; expected 503. Body: ${exportResponse.body}`);
    assert(exportResponse.json<{ error: string }>().error === "security_export_failed", "Disabled export should fail closed instead of pretending WORM storage happened.");
  });
  pass("disabled security export fails readiness and governance export delivery");

  delete process.env.WHISTLE_SECURITY_EXPORT_MODE;
  delete process.env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL;
  delete process.env.WHISTLE_SECURITY_EXPORT_API_KEY;
  delete process.env.WHISTLE_AUDIT_EXPORT_WEBHOOK_URL;
  delete process.env.WHISTLE_AUDIT_EXPORT_API_KEY;
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Production-profile security export readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "security_export" && dependency.mode === "security-export-disabled" && !dependency.ok),
      "Production profile should disable local SIEM/WORM export when no approved provider is configured.",
    );
  });
  pass("production profile disables local SIEM/WORM export when provider wiring is missing");

  delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  process.env.WHISTLE_SECURITY_EXPORT_MODE = "webhook";
  delete process.env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL;
  process.env.WHISTLE_SECURITY_EXPORT_API_KEY = "security-export-smoke-secret";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Misconfigured security export readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "security_export" && dependency.mode === "siem-worm-webhook-export" && !dependency.ok),
      "Readiness should fail when SIEM/WORM webhook URL is missing.",
    );
  });
  pass("misconfigured SIEM/WORM security export fails readiness");

  const webhook = await startSecurityExportWebhook();
  try {
    process.env.WHISTLE_SECURITY_EXPORT_MODE = "webhook";
    process.env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL = webhook.url;
    process.env.WHISTLE_SECURITY_EXPORT_API_KEY = "security-export-smoke-secret";

    await withApp(async (app) => {
      const readiness = await app.inject({ method: "GET", url: "/api/ready" });
      assert(readiness.statusCode === 200, `Configured security export readiness returned ${readiness.statusCode}; expected 200. Body: ${readiness.body}`);
      assert(
        readiness
          .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
          .dependencies.some((dependency) => dependency.name === "security_export" && dependency.mode === "siem-worm-webhook-export" && dependency.ok),
        "Readiness should pass when SIEM/WORM webhook is configured.",
      );

      const ticketPayload = await withVerifiedPhone(app, {
        category: "roads",
        language: "en",
        title: "Security export road complaint",
        description: "Complaint text should not be copied into security export webhook payloads.",
        phone: "+91 98765 37777",
        departmentHint: "Corporation / Municipality",
        location: {
          district: "Chennai",
          area: "Velachery",
          landmark: "Security export smoke",
        },
        evidence: [],
      });
      const ticket = await app.inject({
        method: "POST",
        url: "/api/tickets",
        headers: { "idempotency-key": "security-export-ticket-smoke" },
        payload: ticketPayload,
      });
      assert(ticket.statusCode === 201, `Security export ticket returned ${ticket.statusCode}; expected 201. Body: ${ticket.body}`);

      const changeRequest = await app.inject({
        method: "POST",
        url: "/api/admin/governance/config-change-requests",
        headers: adminHeaders,
        payload: {
          target: { kind: "app_control", id: "ops-maintenance", value: true },
          reason: "Security export smoke creates governance metadata for WORM export.",
        },
      });
      assert(changeRequest.statusCode === 201, `Security export config request returned ${changeRequest.statusCode}; expected 201. Body: ${changeRequest.body}`);

      const exportResponse = await app.inject({
        method: "GET",
        url: "/api/admin/governance/audit-export",
        headers: adminHeaders,
      });
      assert(exportResponse.statusCode === 200, `Configured security export returned ${exportResponse.statusCode}; expected 200. Body: ${exportResponse.body}`);
      const payload = exportResponse.json<{
        exportPackage: AuditExportPackage;
        exportDelivery: { status: string; provider: string; providerExportId?: string };
        configChangeRequests: ConfigChangeRequest[];
      }>();
      assert(payload.exportPackage.controls.productionStorage === "external_worm_siem", "Configured export should declare external WORM/SIEM storage.");
      assert(payload.exportDelivery.status === "exported", "Configured export should report external delivery.");
      assert(payload.exportDelivery.provider === "siem-worm-webhook-export", "Configured export should preserve the provider mode.");
      assert(payload.exportDelivery.providerExportId?.startsWith("worm_"), "Configured export should preserve provider export id.");
    });

    await eventually(
      () => webhook.requests.some((request) => request.body.kind === "security_log") && webhook.requests.some((request) => request.body.kind === "audit_export"),
      "Security export webhook should receive both request logs and audit export packages.",
    );
    for (const request of webhook.requests) {
      assert(request.authorization === "Bearer security-export-smoke-secret", "Security export webhook should receive configured bearer credential.");
    }
    const auditExportRequest = webhook.requests.find((request) => request.body.kind === "audit_export");
    assert(auditExportRequest, "Security export webhook should receive an audit_export payload.");
    const serializedAuditExport = JSON.stringify(auditExportRequest.body);
    assert(!serializedAuditExport.includes("+91"), "Audit export webhook payload must not include raw phone numbers.");
    assert(!serializedAuditExport.includes("Complaint text should not be copied"), "Audit export webhook payload must not include raw complaint descriptions.");
    assert(serializedAuditExport.includes("eventHash"), "Audit export webhook payload should include audit hash-chain fields for reconciliation.");
  } finally {
    await webhook.close();
  }
  pass("SIEM/WORM webhook receives sanitized request logs and redacted audit export packages");
} finally {
  if (originalEnv.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalEnv.logLevel;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
  if (originalEnv.deploymentProfile === undefined) delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  else process.env.WHISTLE_DEPLOYMENT_PROFILE = originalEnv.deploymentProfile;
  if (originalEnv.env === undefined) delete process.env.WHISTLE_ENV;
  else process.env.WHISTLE_ENV = originalEnv.env;
  if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.mode === undefined) delete process.env.WHISTLE_SECURITY_EXPORT_MODE;
  else process.env.WHISTLE_SECURITY_EXPORT_MODE = originalEnv.mode;
  if (originalEnv.webhookUrl === undefined) delete process.env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL;
  else process.env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL = originalEnv.webhookUrl;
  if (originalEnv.apiKey === undefined) delete process.env.WHISTLE_SECURITY_EXPORT_API_KEY;
  else process.env.WHISTLE_SECURITY_EXPORT_API_KEY = originalEnv.apiKey;
  if (originalEnv.legacyWebhookUrl === undefined) delete process.env.WHISTLE_AUDIT_EXPORT_WEBHOOK_URL;
  else process.env.WHISTLE_AUDIT_EXPORT_WEBHOOK_URL = originalEnv.legacyWebhookUrl;
  if (originalEnv.legacyApiKey === undefined) delete process.env.WHISTLE_AUDIT_EXPORT_API_KEY;
  else process.env.WHISTLE_AUDIT_EXPORT_API_KEY = originalEnv.legacyApiKey;
}
