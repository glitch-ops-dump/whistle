process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;

const { buildWhistleApi } = await import("../server/app.js");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

type ReadinessResponse = {
  ok: boolean;
  service: string;
  dependencies: Array<{
    name: string;
    mode: string;
    ok: boolean;
    latencyMs: number;
    error?: string;
  }>;
};

const app = buildWhistleApi();
await app.ready();

try {
  const response = await app.inject({
    method: "GET",
    url: "/api/ready",
    headers: {
      "x-whistle-correlation-id": "readiness-smoke",
    },
  });
  assert(response.statusCode === 200, `Readiness returned ${response.statusCode}; expected 200. Body: ${response.body}`);
  assert(response.headers["x-whistle-correlation-id"] === "readiness-smoke", "Readiness response should echo the request correlation id.");
  const readiness = response.json<ReadinessResponse>();
  assert(readiness.ok, "Readiness response should be ok in dev-memory mode.");
  assert(readiness.service === "whistle-ticket-spine", "Readiness response should identify the service.");
  const dependencyNames = readiness.dependencies.map((dependency) => dependency.name).sort();
  const expectedDependencyNames = [
    "access_control",
    "account_auth",
    "admin_config",
    "citizen_otp_delivery",
    "citizen_phone_verification",
    "evidence_object_store",
    "notification_delivery",
    "official_auth",
    "public_rate_limit",
    "security_export",
    "ticket_spine",
    "telemetry_export",
    "worker_auth",
  ].sort();
  assert(
    JSON.stringify(dependencyNames) === JSON.stringify(expectedDependencyNames),
    `Readiness dependencies were ${dependencyNames.join(", ")}.`,
  );
  assert(readiness.dependencies.every((dependency) => dependency.ok), "Every readiness dependency should be ok.");
  assert(readiness.dependencies.every((dependency) => typeof dependency.latencyMs === "number" && dependency.latencyMs >= 0), "Every readiness dependency should include latency.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "ticket_spine" && dependency.mode === "mvp-dev-memory"), "Readiness should expose the ticket spine repository mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "account_auth" && dependency.mode === "mvp-dev-memory"), "Readiness should expose the account auth repository mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "official_auth" && dependency.mode === "prototype-headers"), "Readiness should expose the official auth provider mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "worker_auth" && dependency.mode === "prototype-open"), "Readiness should expose the worker authentication mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "citizen_otp_delivery" && dependency.mode === "mock-sms-exposed"), "Readiness should expose the OTP delivery provider mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "evidence_object_store" && dependency.mode === "local-mock-object-store"), "Readiness should expose the evidence object-store mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "notification_delivery" && dependency.mode === "mvp-mock-notification-provider"), "Readiness should expose the notification delivery provider mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "security_export" && dependency.mode === "mvp-local-security-export"), "Readiness should expose the security export provider mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "telemetry_export" && dependency.mode === "mvp-local-telemetry"), "Readiness should expose the telemetry export provider mode.");
  assert(readiness.dependencies.some((dependency) => dependency.name === "public_rate_limit" && dependency.mode === "in-memory-rate-limit"), "Readiness should expose the public rate-limit backend mode.");
  pass("API readiness probes all MVP repository dependencies in dev-memory mode");
} finally {
  await app.close();
}
