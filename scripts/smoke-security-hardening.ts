process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
delete process.env.WHISTLE_ALLOWED_ORIGINS;
delete process.env.WHISTLE_CORS_ALLOWED_ORIGINS;
delete process.env.WHISTLE_SECURITY_HEADERS_ENABLED;
delete process.env.WHISTLE_HSTS_ENABLED;

import { readFileSync } from "node:fs";
const { buildWhistleApi } = await import("../server/app.js");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function header(response: { headers: Record<string, string | string[] | undefined> }, name: string) {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

const localApp = buildWhistleApi();
await localApp.ready();

try {
  const response = await localApp.inject({
    method: "GET",
    url: "/api/health",
    headers: {
      origin: "https://citizen.whistle.example.gov",
    },
  });
  assert(response.statusCode === 200, `Health returned ${response.statusCode}; expected 200. Body: ${response.body}`);
  assert(header(response, "access-control-allow-origin") === "https://citizen.whistle.example.gov", "Local mode should allow the request origin for development.");
  assert(header(response, "x-content-type-options") === "nosniff", "API should emit x-content-type-options=nosniff.");
  assert(header(response, "x-frame-options") === "DENY", "API should deny framing.");
  assert(header(response, "referrer-policy") === "no-referrer", "API should suppress referrer propagation.");
  assert(header(response, "cross-origin-resource-policy") === "same-origin", "API should emit cross-origin-resource-policy=same-origin.");
  assert(header(response, "content-security-policy")?.includes("default-src 'none'"), "API should emit a restrictive default CSP.");
  assert(header(response, "cache-control") === "no-store", "API should default to no-store.");
  assert(!header(response, "strict-transport-security"), "Local HTTP responses should not emit HSTS.");
} finally {
  await localApp.close();
}

process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";
process.env.WHISTLE_ALLOWED_ORIGINS = "https://citizen.whistle.example.gov,https://console.whistle.example.gov";
const productionApp = buildWhistleApi();
await productionApp.ready();

try {
  const allowed = await productionApp.inject({
    method: "GET",
    url: "/api/health",
    headers: {
      origin: "https://console.whistle.example.gov",
    },
  });
  assert(allowed.statusCode === 200, `Allowed-origin health returned ${allowed.statusCode}; expected 200. Body: ${allowed.body}`);
  assert(header(allowed, "access-control-allow-origin") === "https://console.whistle.example.gov", "Allowed production origin should receive a CORS allow header.");
  assert(header(allowed, "strict-transport-security") === "max-age=31536000; includeSubDomains", "Production profile should emit HSTS by default.");

  const denied = await productionApp.inject({
    method: "GET",
    url: "/api/health",
    headers: {
      origin: "https://untrusted.example.gov",
    },
  });
  assert(!header(denied, "access-control-allow-origin"), "Untrusted production origin should not receive a CORS allow header.");
} finally {
  await productionApp.close();
  delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  delete process.env.WHISTLE_ALLOWED_ORIGINS;
}

pass("API security headers and production CORS allowlist are enforced");

const frontendAuthSources = ["src/authApi.ts", "src/officialAuthClient.ts"].map((path) => readFileSync(path, "utf8")).join("\n");
assert(
  !/localStorage\.setItem\([^)]*(sessionToken|officialBearerToken|accountSessionToken|whistle\.officialBearerToken|whistle\.accountSessionToken)/.test(frontendAuthSources),
  "Frontend auth clients must not persist session or official bearer tokens in localStorage.",
);
assert(frontendAuthSources.includes('credentials: "include"'), "Frontend auth clients should send HttpOnly session cookies with auth requests.");
pass("frontend auth clients avoid localStorage bearer persistence and use cookie credentials");
