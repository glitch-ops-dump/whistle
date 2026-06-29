import type { HttpMetricsSnapshot } from "./metrics.js";
import type { StructuredRequestLog } from "./requestLog.js";

type EnvLike = Record<string, string | undefined>;

export type TelemetryExportProvider = {
  readonly mode: string;
  healthCheck(): Promise<void>;
  exportRequestSpan(entry: StructuredRequestLog): Promise<void>;
  exportMetricsSnapshot(snapshot: HttpMetricsSnapshot): Promise<void>;
};

function modeFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_TELEMETRY_EXPORT_MODE?.trim().toLowerCase() ?? "";
}

function deploymentRequiresTelemetryExport(env: EnvLike = process.env) {
  const value = (env.WHISTLE_DEPLOYMENT_PROFILE ?? env.WHISTLE_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  return ["production", "prod", "staging", "stage", "pilot", "uat"].includes(value);
}

function endpointFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? "";
}

function headersFromEnv(env: EnvLike = process.env) {
  const configured = env.WHISTLE_OTEL_EXPORTER_OTLP_HEADERS?.trim() ?? env.OTEL_EXPORTER_OTLP_HEADERS?.trim() ?? "";
  const headers: Record<string, string> = {};
  for (const part of configured.split(",").map((item) => item.trim()).filter(Boolean)) {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim();
    const value = rawValue.join("=").trim();
    if (key && value) headers[key] = value;
  }
  const bearer = env.WHISTLE_OTEL_EXPORTER_OTLP_BEARER_TOKEN?.trim();
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return headers;
}

function isOtlpMode(value: string, endpoint: string) {
  return ["otlp-http", "otel-http", "webhook"].includes(value) || Boolean(endpoint);
}

export class LocalTelemetryExportProvider implements TelemetryExportProvider {
  readonly mode = "mvp-local-telemetry";

  async healthCheck() {
    return;
  }

  async exportRequestSpan() {
    return;
  }

  async exportMetricsSnapshot() {
    return;
  }
}

export class DisabledTelemetryExportProvider implements TelemetryExportProvider {
  readonly mode = "telemetry-export-disabled";

  async healthCheck() {
    throw new Error("Telemetry export provider is disabled; configure OpenTelemetry export before production launch.");
  }

  async exportRequestSpan() {
    return;
  }

  async exportMetricsSnapshot() {
    return;
  }
}

export class OtlpHttpTelemetryExportProvider implements TelemetryExportProvider {
  readonly mode = "otlp-http-telemetry-export";

  constructor(private readonly endpoint = endpointFromEnv(), private readonly extraHeaders = headersFromEnv()) {}

  async healthCheck() {
    if (!this.endpoint) throw new Error("WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT is required for OpenTelemetry HTTP export.");
  }

  async exportRequestSpan(entry: StructuredRequestLog) {
    await this.post({
      kind: "request_span",
      resource: {
        serviceName: entry.service,
      },
      span: {
        name: `${entry.method} ${entry.route}`,
        correlationId: entry.correlationId,
        requestId: entry.requestId,
        method: entry.method,
        path: entry.path,
        route: entry.route,
        statusCode: entry.statusCode,
        durationMs: entry.durationMs,
        role: entry.role,
        errorName: entry.errorName,
        errorMessage: entry.errorMessage,
      },
    });
  }

  async exportMetricsSnapshot(snapshot: HttpMetricsSnapshot) {
    await this.post({
      kind: "metrics_snapshot",
      resource: {
        serviceName: snapshot.service,
      },
      metrics: snapshot,
    });
  }

  private async post(payload: Record<string, unknown>) {
    await this.healthCheck();
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.extraHeaders,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`OpenTelemetry HTTP exporter returned ${response.status}.`);
  }
}

export function telemetryExportModeFromRuntimeEnv(env: EnvLike = process.env) {
  const mode = modeFromEnv(env);
  const endpoint = endpointFromEnv(env);
  if (mode === "disabled") return "telemetry-export-disabled";
  if (isOtlpMode(mode, endpoint)) return "otlp-http-telemetry-export";
  if (deploymentRequiresTelemetryExport(env)) return "telemetry-export-disabled";
  return "mvp-local-telemetry";
}

export function createTelemetryExportProvider(): TelemetryExportProvider {
  const mode = modeFromEnv();
  const endpoint = endpointFromEnv();
  if (mode === "disabled") return new DisabledTelemetryExportProvider();
  if (isOtlpMode(mode, endpoint)) return new OtlpHttpTelemetryExportProvider();
  if (deploymentRequiresTelemetryExport()) return new DisabledTelemetryExportProvider();
  return new LocalTelemetryExportProvider();
}
