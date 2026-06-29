import { createServer, type IncomingMessage } from "node:http";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
  deploymentProfile: process.env.WHISTLE_DEPLOYMENT_PROFILE,
  env: process.env.WHISTLE_ENV,
  nodeEnv: process.env.NODE_ENV,
  mode: process.env.WHISTLE_TELEMETRY_EXPORT_MODE,
  endpoint: process.env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: process.env.WHISTLE_OTEL_EXPORTER_OTLP_HEADERS,
  bearer: process.env.WHISTLE_OTEL_EXPORTER_OTLP_BEARER_TOKEN,
  otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  otelHeaders: process.env.OTEL_EXPORTER_OTLP_HEADERS,
};

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.WHISTLE_SEED_DEMO = "false";
delete process.env.DATABASE_URL;
delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
delete process.env.WHISTLE_ENV;
delete process.env.NODE_ENV;

const { buildWhistleApi } = await import("../server/app.js");

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

async function startTelemetryEndpoint() {
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
    response.end(JSON.stringify({ accepted: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "Telemetry smoke endpoint did not expose a port.");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/otlp`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
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

async function eventually(condition: () => boolean, message: string) {
  for (let index = 0; index < 20; index += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(false, message);
}

try {
  process.env.WHISTLE_TELEMETRY_EXPORT_MODE = "disabled";
  delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_HEADERS;
  delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_BEARER_TOKEN;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_HEADERS;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Disabled telemetry readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "telemetry_export" && dependency.mode === "telemetry-export-disabled" && !dependency.ok),
      "Readiness should fail when telemetry export is disabled.",
    );
  });
  pass("disabled telemetry export fails readiness");

  delete process.env.WHISTLE_TELEMETRY_EXPORT_MODE;
  delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_HEADERS;
  delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_BEARER_TOKEN;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Production-profile telemetry readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "telemetry_export" && dependency.mode === "telemetry-export-disabled" && !dependency.ok),
      "Production profile should disable local telemetry export when no approved OpenTelemetry endpoint is configured.",
    );
  });
  pass("production profile disables local telemetry export when provider wiring is missing");

  delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  process.env.WHISTLE_TELEMETRY_EXPORT_MODE = "otlp-http";
  delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Misconfigured telemetry readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "telemetry_export" && dependency.mode === "otlp-http-telemetry-export" && !dependency.ok),
      "Readiness should fail when telemetry exporter endpoint is missing.",
    );
  });
  pass("misconfigured telemetry export fails readiness");

  const endpoint = await startTelemetryEndpoint();
  try {
    process.env.WHISTLE_TELEMETRY_EXPORT_MODE = "otlp-http";
    process.env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT = endpoint.url;
    process.env.WHISTLE_OTEL_EXPORTER_OTLP_BEARER_TOKEN = "telemetry-smoke-token";

    await withApp(async (app) => {
      const readiness = await app.inject({ method: "GET", url: "/api/ready" });
      assert(readiness.statusCode === 200, `Configured telemetry readiness returned ${readiness.statusCode}; expected 200. Body: ${readiness.body}`);
      assert(
        readiness
          .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
          .dependencies.some((dependency) => dependency.name === "telemetry_export" && dependency.mode === "otlp-http-telemetry-export" && dependency.ok),
        "Readiness should pass when telemetry exporter endpoint is configured.",
      );

      const deniedMetrics = await app.inject({
        method: "GET",
        url: "/api/metrics",
        headers: {
          "x-whistle-role": "minister",
          "x-whistle-actor": "minister:prototype",
          "x-whistle-correlation-id": "telemetry-denied-metrics",
        },
      });
      assert(deniedMetrics.statusCode === 403, `Denied metrics returned ${deniedMetrics.statusCode}; expected 403. Body: ${deniedMetrics.body}`);

      const adminMetrics = await app.inject({
        method: "GET",
        url: "/api/metrics",
        headers: {
          "x-whistle-role": "admin",
          "x-whistle-actor": "admin:prototype",
          "x-whistle-correlation-id": "telemetry-admin-metrics",
        },
      });
      assert(adminMetrics.statusCode === 200, `Admin metrics returned ${adminMetrics.statusCode}; expected 200. Body: ${adminMetrics.body}`);
    });

    await eventually(
      () => endpoint.requests.some((request) => request.body.kind === "request_span") && endpoint.requests.some((request) => request.body.kind === "metrics_snapshot"),
      "Telemetry endpoint should receive request spans and metrics snapshots.",
    );

    for (const request of endpoint.requests) {
      assert(request.authorization === "Bearer telemetry-smoke-token", "Telemetry endpoint should receive configured bearer token.");
    }
    const serialized = JSON.stringify(endpoint.requests);
    assert(serialized.includes("GET /api/metrics"), "Telemetry request span should include route-level span names.");
    assert(serialized.includes("whistle-ticket-spine"), "Telemetry payload should include service name.");
    assert(!serialized.includes("phone="), "Telemetry payload must not include citizen query strings.");
  } finally {
    await endpoint.close();
  }
  pass("configured telemetry export sends sanitized request spans and metrics snapshots");
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
  if (originalEnv.mode === undefined) delete process.env.WHISTLE_TELEMETRY_EXPORT_MODE;
  else process.env.WHISTLE_TELEMETRY_EXPORT_MODE = originalEnv.mode;
  if (originalEnv.endpoint === undefined) delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT;
  else process.env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT = originalEnv.endpoint;
  if (originalEnv.headers === undefined) delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_HEADERS;
  else process.env.WHISTLE_OTEL_EXPORTER_OTLP_HEADERS = originalEnv.headers;
  if (originalEnv.bearer === undefined) delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_BEARER_TOKEN;
  else process.env.WHISTLE_OTEL_EXPORTER_OTLP_BEARER_TOKEN = originalEnv.bearer;
  if (originalEnv.otelEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEnv.otelEndpoint;
  if (originalEnv.otelHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
  else process.env.OTEL_EXPORTER_OTLP_HEADERS = originalEnv.otelHeaders;
}
