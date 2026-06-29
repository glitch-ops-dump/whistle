import { buildWhistleApi } from "../server/app.js";
import type { AuditExportPackage, ConfigChangeRequest } from "../server/config/types.js";
import type { AuditEvent, TicketRecord } from "../server/ticket-spine/types.js";
import { withVerifiedPhone } from "./smoke-helpers.js";

type WhistleApi = ReturnType<typeof buildWhistleApi>;

const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
};

const cmHeaders = {
  "x-whistle-role": "cm_cell",
  "x-whistle-actor": "cm_cell:prototype",
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
    headers: options.headers ?? adminHeaders,
    payload: options.payload,
  });

  assert(
    response.statusCode === expectedStatus,
    `${options.method} ${options.url} returned ${response.statusCode}; expected ${expectedStatus}. Body: ${response.body}`,
  );

  return response.json<T>();
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSeedDemo = process.env.WHISTLE_SEED_DEMO;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_SEED_DEMO = "false";

  const app = buildWhistleApi();
  await app.ready();

  try {
    const governanceTicketPayload = await withVerifiedPhone(app, {
      category: "roads",
      language: "en",
      title: "Audit export road complaint",
      description: "Smoke test complaint to generate audit events for governance export.",
      phone: "+91 98765 33333",
      departmentHint: "Corporation / Municipality",
      location: {
        district: "Chennai",
        area: "Velachery",
        landmark: "Governance smoke",
      },
      evidence: [],
    });
    const ticketResponse = await jsonRequest<{ ticket: TicketRecord }>(
      app,
      {
        method: "POST",
        url: "/api/tickets",
        payload: governanceTicketPayload,
      },
      201,
    );

    const request = await jsonRequest<{ changeRequest: ConfigChangeRequest }>(
      app,
      {
        method: "POST",
        url: "/api/admin/governance/config-change-requests",
        payload: {
          target: {
            kind: "app_control",
            id: "ops-maintenance",
            value: true,
          },
          reason: "Governance smoke creates a pending request for audit export reconciliation.",
        },
      },
      201,
    );
    assert(request.changeRequest.status === "pending", "Governance smoke change request should be pending.");

    await jsonRequest(
      app,
      {
        method: "GET",
        url: "/api/admin/governance/audit-export",
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
        },
      },
      403,
    );
    pass("audit export rejects roles without export grant");

    const exportResponse = await jsonRequest<{
      exportPackage: AuditExportPackage;
      exportDelivery: { status: string; provider: string; providerExportId?: string };
      auditEvents: AuditEvent[];
      configChangeRequests: ConfigChangeRequest[];
    }>(app, {
      method: "GET",
      url: `/api/admin/governance/audit-export?ticketId=${encodeURIComponent(ticketResponse.ticket.id)}`,
    });
    assert(exportResponse.exportPackage.ticketId === ticketResponse.ticket.id, "Ticket-filtered audit export should echo ticket id.");
    assert(exportResponse.exportPackage.counts.auditEvents === exportResponse.auditEvents.length, "Audit export count should match returned audit events.");
    assert(exportResponse.exportPackage.counts.configChangeRequests >= 1, "Audit export should include config governance request count.");
    assert(exportResponse.configChangeRequests.some((item) => item.id === request.changeRequest.id), "Audit export should include config change request metadata.");
    assert(exportResponse.exportPackage.controls.redaction === "metadata_only_for_sensitive_records", "Audit export should declare redaction control.");
    assert(exportResponse.exportPackage.controls.productionStorage === "not_enabled_mvp", "Local audit export should declare that production storage is not enabled.");
    assert(exportResponse.exportDelivery.status === "skipped" && exportResponse.exportDelivery.provider === "mvp-local", "Local audit export should expose skipped external delivery.");
    pass("admin audit export includes ticket audit and config approval metadata");

    const cmExport = await jsonRequest<{ exportPackage: AuditExportPackage; exportDelivery: { status: string } }>(app, {
      method: "GET",
      url: "/api/admin/governance/audit-export",
      headers: cmHeaders,
    });
    assert(cmExport.exportPackage.counts.auditEvents >= exportResponse.exportPackage.counts.auditEvents, "CM Cell statewide export should include audit event counts.");
    assert(cmExport.exportDelivery.status === "skipped", "CM Cell local export should still be explicit about external delivery state.");
    pass("CM Cell can generate statewide governance export package");

    pass("governance smoke completed");
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
