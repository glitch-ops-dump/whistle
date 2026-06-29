process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;

const { buildWhistleApi } = await import("../server/app.js");
import type { StructuredRequestLog } from "../server/observability/requestLog.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function durationHeader(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  assert(raw, "Response should include x-whistle-duration-ms.");
  const parsed = Number(raw);
  assert(Number.isFinite(parsed) && parsed >= 0, `x-whistle-duration-ms should be a non-negative number; got ${raw}.`);
}

const entries: StructuredRequestLog[] = [];
const app = buildWhistleApi({
  requestLogSink: (entry) => entries.push(entry),
});
await app.ready();

try {
  const ready = await app.inject({
    method: "GET",
    url: "/api/ready",
    headers: {
      "x-whistle-correlation-id": "request-log-ready",
    },
  });
  assert(ready.statusCode === 200, `Readiness returned ${ready.statusCode}; expected 200. Body: ${ready.body}`);
  assert(ready.headers["x-whistle-correlation-id"] === "request-log-ready", "Readiness should echo the correlation id.");
  durationHeader(ready.headers["x-whistle-duration-ms"]);

  const readyLog = entries.find((entry) => entry.event === "http_request_completed" && entry.correlationId === "request-log-ready");
  assert(readyLog, "Readiness request should create a structured completion log.");
  assert(readyLog.method === "GET", "Request log should include method.");
  assert(readyLog.path === "/api/ready", "Request log should include the path without query string.");
  assert(readyLog.route === "/api/ready", "Request log should include the route pattern.");
  assert(readyLog.statusCode === 200, "Request log should include response status.");
  assert(typeof readyLog.durationMs === "number" && readyLog.durationMs >= 0, "Request log should include durationMs.");

  const admin = await app.inject({
    method: "GET",
    url: "/api/admin/config",
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
      "x-whistle-correlation-id": "request-log-admin",
    },
  });
  assert(admin.statusCode === 200, `Admin config returned ${admin.statusCode}; expected 200. Body: ${admin.body}`);
  const adminLog = entries.find((entry) => entry.event === "http_request_completed" && entry.correlationId === "request-log-admin");
  assert(adminLog?.role === "admin", "Government request log should include role.");
  assert(adminLog.actor === "admin:prototype", "Government request log should include sanitized actor.");

  const phone = "+91 98000 04444";
  const otpStart = await app.inject({
    method: "POST",
    url: "/api/citizen/otp/start",
    payload: { phone, language: "en" },
  });
  assert(otpStart.statusCode === 201, `OTP start returned ${otpStart.statusCode}; expected 201. Body: ${otpStart.body}`);
  const { challenge } = otpStart.json<{ challenge: { challengeId: string; mockOtp: string } }>();
  const otpVerify = await app.inject({
    method: "POST",
    url: "/api/citizen/otp/verify",
    payload: { challengeId: challenge.challengeId, otp: challenge.mockOtp },
  });
  assert(otpVerify.statusCode === 200, `OTP verify returned ${otpVerify.statusCode}; expected 200. Body: ${otpVerify.body}`);
  const { verification } = otpVerify.json<{ verification: { verificationToken: string } }>();
  const lookup = await app.inject({
    method: "GET",
    url: `/api/citizen/tickets?phone=${encodeURIComponent(phone)}`,
    headers: {
      "x-whistle-correlation-id": "request-log-phone",
      "x-whistle-citizen-phone": phone,
      "x-whistle-citizen-token": verification.verificationToken,
    },
  });
  assert(lookup.statusCode === 200, `Citizen ticket lookup returned ${lookup.statusCode}; expected 200. Body: ${lookup.body}`);
  const lookupLog = entries.find((entry) => entry.event === "http_request_completed" && entry.correlationId === "request-log-phone");
  assert(lookupLog?.path === "/api/citizen/tickets", "Citizen lookup log should omit the query string.");
  assert(!JSON.stringify(lookupLog).includes("98000"), "Citizen lookup log should not contain the phone query value.");
  pass("structured request logs preserve correlation, duration, route metadata, role context, and omit citizen query values");
} finally {
  await app.close();
}
