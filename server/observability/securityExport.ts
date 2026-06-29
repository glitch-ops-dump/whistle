import type { ConfigChangeRequest, AuditExportPackage } from "../config/types.js";
import type { AuditEvent } from "../ticket-spine/types.js";
import type { StructuredRequestLog } from "./requestLog.js";

type EnvLike = Record<string, string | undefined>;

export type SecurityExportStorageMode = "not_enabled_mvp" | "external_worm_siem";

export type SecurityExportResult = {
  status: "exported" | "failed" | "skipped";
  provider: string;
  reason: string;
  providerExportId?: string;
  lastError?: string;
};

export type SecurityAuditExportInput = {
  exportPackage: AuditExportPackage;
  auditEvents: AuditEvent[];
  configChangeRequests: ConfigChangeRequest[];
};

export type SecurityExportProvider = {
  readonly mode: string;
  readonly productionStorage: SecurityExportStorageMode;
  healthCheck(): Promise<void>;
  exportRequestLog(entry: StructuredRequestLog): Promise<void>;
  exportAuditPackage(input: SecurityAuditExportInput): Promise<SecurityExportResult>;
};

function modeFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_SECURITY_EXPORT_MODE?.trim().toLowerCase() ?? "";
}

function deploymentRequiresSecurityExport(env: EnvLike = process.env) {
  const value = (env.WHISTLE_DEPLOYMENT_PROFILE ?? env.WHISTLE_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  return ["production", "prod", "staging", "stage", "pilot", "uat"].includes(value);
}

function webhookUrlFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL?.trim() ?? env.WHISTLE_AUDIT_EXPORT_WEBHOOK_URL?.trim() ?? "";
}

function webhookApiKeyFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_SECURITY_EXPORT_API_KEY?.trim() ?? env.WHISTLE_AUDIT_EXPORT_API_KEY?.trim() ?? "";
}

function safeConfigChangeRequest(request: ConfigChangeRequest) {
  return {
    id: request.id,
    targetKind: request.target.kind,
    targetId: "id" in request.target ? request.target.id : undefined,
    summary: request.summary,
    requestedBy: request.requestedBy,
    decidedBy: request.decidedBy,
    status: request.status,
    requestedAt: request.requestedAt,
    decidedAt: request.decidedAt,
    appliedAt: request.appliedAt,
  };
}

function safeAuditEvent(event: AuditEvent) {
  return {
    id: event.id,
    ticketId: event.ticketId,
    actorRole: event.actorRole,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    reason: event.sensitive ? undefined : event.reason,
    correlationId: event.correlationId,
    sensitive: event.sensitive,
    createdAt: event.createdAt,
    previousHash: event.previousHash,
    eventHash: event.eventHash,
    chainSequence: event.chainSequence,
  };
}

export class LocalSecurityExportProvider implements SecurityExportProvider {
  readonly mode = "mvp-local-security-export";
  readonly productionStorage = "not_enabled_mvp";

  async healthCheck() {
    return;
  }

  async exportRequestLog() {
    return;
  }

  async exportAuditPackage(input: SecurityAuditExportInput): Promise<SecurityExportResult> {
    return {
      status: "skipped",
      provider: "mvp-local",
      providerExportId: `local_${input.exportPackage.id}`,
      reason: "Generated local governance export package; external SIEM/WORM export is not enabled in MVP local mode.",
    };
  }
}

export class DisabledSecurityExportProvider implements SecurityExportProvider {
  readonly mode = "security-export-disabled";
  readonly productionStorage = "not_enabled_mvp";

  async healthCheck() {
    throw new Error("Security export provider is disabled; configure SIEM/WORM export before production launch.");
  }

  async exportRequestLog() {
    return;
  }

  async exportAuditPackage(): Promise<SecurityExportResult> {
    return {
      status: "failed",
      provider: "disabled",
      reason: "Security export provider is disabled.",
      lastError: "security_export_disabled",
    };
  }
}

export class WebhookSecurityExportProvider implements SecurityExportProvider {
  readonly mode = "siem-worm-webhook-export";
  readonly productionStorage = "external_worm_siem";

  constructor(private readonly webhookUrl = webhookUrlFromEnv(), private readonly apiKey = webhookApiKeyFromEnv()) {}

  async healthCheck() {
    if (!this.webhookUrl) throw new Error("WHISTLE_SECURITY_EXPORT_WEBHOOK_URL is required for SIEM/WORM security export.");
    if (!this.apiKey) throw new Error("WHISTLE_SECURITY_EXPORT_API_KEY is required for SIEM/WORM security export.");
  }

  async exportRequestLog(entry: StructuredRequestLog) {
    await this.post({
      kind: "security_log",
      service: entry.service,
      event: entry.event,
      correlationId: entry.correlationId,
      requestId: entry.requestId,
      method: entry.method,
      path: entry.path,
      route: entry.route,
      statusCode: entry.statusCode,
      durationMs: entry.durationMs,
      role: entry.role,
      actor: entry.actor,
      errorName: entry.errorName,
      errorMessage: entry.errorMessage,
    });
  }

  async exportAuditPackage(input: SecurityAuditExportInput): Promise<SecurityExportResult> {
    try {
      await this.healthCheck();
      const response = await this.post({
        kind: "audit_export",
        exportPackage: input.exportPackage,
        auditEvents: input.auditEvents.map(safeAuditEvent),
        configChangeRequests: input.configChangeRequests.map(safeConfigChangeRequest),
      });
      const payload = (await response.json().catch(() => ({}))) as { providerExportId?: unknown; exportId?: unknown; reason?: unknown };
      return {
        status: "exported",
        provider: this.mode,
        providerExportId: String(payload.providerExportId ?? payload.exportId ?? input.exportPackage.id),
        reason: typeof payload.reason === "string" ? payload.reason : "Security export package accepted by SIEM/WORM webhook.",
      };
    } catch (error) {
      return {
        status: "failed",
        provider: this.mode,
        reason: "Security export package delivery failed.",
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async post(payload: Record<string, unknown>) {
    await this.healthCheck();
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Security export webhook returned ${response.status}.`);
    return response;
  }
}

export function securityExportModeFromRuntimeEnv(env: EnvLike = process.env) {
  const mode = modeFromEnv(env);
  if (mode === "disabled") return "security-export-disabled";
  if (mode === "webhook" || mode === "siem-webhook" || mode === "worm-webhook") return "siem-worm-webhook-export";
  if (deploymentRequiresSecurityExport(env)) return "security-export-disabled";
  return "mvp-local-security-export";
}

export function createSecurityExportProvider(): SecurityExportProvider {
  const mode = modeFromEnv();
  if (mode === "disabled") return new DisabledSecurityExportProvider();
  if (mode === "webhook" || mode === "siem-webhook" || mode === "worm-webhook") return new WebhookSecurityExportProvider();
  if (deploymentRequiresSecurityExport()) return new DisabledSecurityExportProvider();
  return new LocalSecurityExportProvider();
}
