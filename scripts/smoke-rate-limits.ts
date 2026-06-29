import { createServer, type IncomingMessage } from "node:http";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  otpStartMax: process.env.WHISTLE_RATE_LIMIT_OTP_START_MAX,
  otpStartWindow: process.env.WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS,
  authOtpStartMax: process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_START_MAX,
  authOtpStartWindow: process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_START_WINDOW_SECONDS,
  authOtpVerifyMax: process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_MAX,
  authOtpVerifyWindow: process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_WINDOW_SECONDS,
  authLoginMax: process.env.WHISTLE_RATE_LIMIT_AUTH_LOGIN_MAX,
  authLoginWindow: process.env.WHISTLE_RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS,
  authPasswordResetMax: process.env.WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_MAX,
  authPasswordResetWindow: process.env.WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_WINDOW_SECONDS,
  ticketCreateMax: process.env.WHISTLE_RATE_LIMIT_TICKET_CREATE_MAX,
  ticketCreateWindow: process.env.WHISTLE_RATE_LIMIT_TICKET_CREATE_WINDOW_SECONDS,
  backend: process.env.WHISTLE_RATE_LIMIT_BACKEND,
  gatewayUrl: process.env.WHISTLE_RATE_LIMIT_GATEWAY_URL,
  gatewayApiKey: process.env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY,
  keySalt: process.env.WHISTLE_RATE_LIMIT_KEY_SALT,
  deploymentProfile: process.env.WHISTLE_DEPLOYMENT_PROFILE,
  whistleEnv: process.env.WHISTLE_ENV,
  nodeEnv: process.env.NODE_ENV,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
};

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.WHISTLE_SEED_DEMO = "false";
delete process.env.DATABASE_URL;

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

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function startRateLimitGateway() {
  const requests: Array<{ authorization: string; body: Record<string, unknown> }> = [];
  const buckets = new Map<string, { count: number; resetAt: number }>();
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
    if (body.kind === "health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (body.kind !== "check") {
      response.writeHead(400).end();
      return;
    }
    const limit = Number(body.limit);
    const windowMs = Number(body.windowMs);
    const now = Number(body.now);
    const bucketKey = `${String(body.ruleId)}:${String(body.bucketKey)}`;
    const existing = buckets.get(bucketKey);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        allowed: bucket.count <= limit,
        limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt: bucket.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "Rate-limit gateway smoke server did not expose a port.");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/rate-limit`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function configureLowLimits() {
  process.env.WHISTLE_RATE_LIMIT_OTP_START_MAX = "2";
  process.env.WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS = "60";
  process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_START_MAX = "2";
  process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_START_WINDOW_SECONDS = "60";
  process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_MAX = "1";
  process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_WINDOW_SECONDS = "60";
  process.env.WHISTLE_RATE_LIMIT_AUTH_LOGIN_MAX = "1";
  process.env.WHISTLE_RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS = "60";
  process.env.WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_MAX = "1";
  process.env.WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_WINDOW_SECONDS = "60";
  process.env.WHISTLE_RATE_LIMIT_TICKET_CREATE_MAX = "1";
  process.env.WHISTLE_RATE_LIMIT_TICKET_CREATE_WINDOW_SECONDS = "60";
}

async function runAccountAuthRateLimitAssertions(app: ReturnType<typeof buildWhistleApi>) {
  const authPhone = "+919811101111";
  for (let index = 0; index < 2; index += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/start",
      payload: { phone: authPhone, language: "en" },
    });
    assert(response.statusCode === 201, `Auth OTP start ${index + 1} returned ${response.statusCode}; expected 201. Body: ${response.body}`);
    assert(response.headers["ratelimit-limit"] === "2", "Auth OTP start should expose the configured rate limit.");
  }
  const authOtpStartLimited = await app.inject({
    method: "POST",
    url: "/api/auth/otp/start",
    payload: { phone: authPhone, language: "en" },
  });
  assert(authOtpStartLimited.statusCode === 429, `Third auth OTP start returned ${authOtpStartLimited.statusCode}; expected 429. Body: ${authOtpStartLimited.body}`);
  assert(authOtpStartLimited.json<{ rule: string }>().rule === "auth.otp_start", "Auth OTP start rate-limit response should identify the auth OTP start rule.");

  const verifyStart = await app.inject({
    method: "POST",
    url: "/api/auth/otp/start",
    payload: { phone: "+919811102222", language: "en" },
  });
  assert(verifyStart.statusCode === 201, `Auth OTP verify setup returned ${verifyStart.statusCode}; expected 201. Body: ${verifyStart.body}`);
  const challenge = verifyStart.json<{ challenge: { challengeId: string } }>().challenge;
  const wrongVerify = await app.inject({
    method: "POST",
    url: "/api/auth/otp/verify",
    payload: { challengeId: challenge.challengeId, otp: "000000" },
  });
  assert(wrongVerify.statusCode !== 429, `First auth OTP verify should not be rate-limited. Body: ${wrongVerify.body}`);
  const verifyLimited = await app.inject({
    method: "POST",
    url: "/api/auth/otp/verify",
    payload: { challengeId: challenge.challengeId, otp: "000000" },
  });
  assert(verifyLimited.statusCode === 429, `Second auth OTP verify returned ${verifyLimited.statusCode}; expected 429. Body: ${verifyLimited.body}`);
  assert(verifyLimited.json<{ rule: string }>().rule === "auth.otp_verify", "Auth OTP verify rate-limit response should identify the auth OTP verify rule.");

  const badLogin = {
    surface: "citizen",
    phone: "+919811103333",
    password: "Wrong@123",
  };
  const firstLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: badLogin });
  assert(firstLogin.statusCode !== 429, `First auth login should not be rate-limited. Body: ${firstLogin.body}`);
  const loginLimited = await app.inject({ method: "POST", url: "/api/auth/login", payload: badLogin });
  assert(loginLimited.statusCode === 429, `Second auth login returned ${loginLimited.statusCode}; expected 429. Body: ${loginLimited.body}`);
  assert(loginLimited.json<{ rule: string }>().rule === "auth.login", "Auth login rate-limit response should identify the auth login rule.");

  const resetPayload = {
    surface: "citizen",
    phone: "+919811104444",
    newPassword: "Citizen@789",
    phoneVerificationToken: "mvp-invalid-reset-token",
  };
  const firstReset = await app.inject({ method: "POST", url: "/api/auth/password/reset", payload: resetPayload });
  assert(firstReset.statusCode !== 429, `First auth password reset should not be rate-limited. Body: ${firstReset.body}`);
  const resetLimited = await app.inject({ method: "POST", url: "/api/auth/password/reset", payload: resetPayload });
  assert(resetLimited.statusCode === 429, `Second auth password reset returned ${resetLimited.statusCode}; expected 429. Body: ${resetLimited.body}`);
  assert(resetLimited.json<{ rule: string }>().rule === "auth.password_reset", "Auth password reset rate-limit response should identify the auth password reset rule.");
}

async function runCitizenRateLimitAssertions(app: ReturnType<typeof buildWhistleApi>) {
  const limitedPhone = "+919800001111";
  for (let index = 0; index < 2; index += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/api/citizen/otp/start",
      payload: { phone: limitedPhone, language: "en" },
    });
    assert(response.statusCode === 201, `OTP start ${index + 1} returned ${response.statusCode}; expected 201. Body: ${response.body}`);
    assert(response.headers["ratelimit-limit"] === "2", "OTP start should expose the configured rate limit.");
  }

  const otpLimited = await app.inject({
    method: "POST",
    url: "/api/citizen/otp/start",
    payload: { phone: limitedPhone, language: "en" },
  });
  assert(otpLimited.statusCode === 429, `Third OTP start returned ${otpLimited.statusCode}; expected 429. Body: ${otpLimited.body}`);
  assert(otpLimited.headers["retry-after"], "Rate-limited response should include Retry-After.");
  assert(otpLimited.json<{ rule: string }>().rule === "citizen.otp_start", "OTP rate-limit response should identify the OTP start rule.");

  const differentPhone = await app.inject({
    method: "POST",
    url: "/api/citizen/otp/start",
    payload: { phone: "+919800002222", language: "en" },
  });
  assert(differentPhone.statusCode === 201, `Different phone OTP start returned ${differentPhone.statusCode}; expected 201. Body: ${differentPhone.body}`);

  const ticketPhone = "+919800003333";
  const ticketPayload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title: "Rate limited road complaint",
    description: "Street damage is unsafe for two-wheelers and needs local inspection before the next rain.",
    phone: ticketPhone,
    departmentHint: "Municipal Administration and Water Supply",
    location: {
      district: "Chennai",
      area: "Velachery",
      address: "Velachery Main Road",
    },
    evidence: [],
  });

  const firstTicket = await app.inject({
    method: "POST",
    url: "/api/tickets",
    payload: ticketPayload,
  });
  assert(firstTicket.statusCode === 201, `First ticket create returned ${firstTicket.statusCode}; expected 201. Body: ${firstTicket.body}`);

  const secondTicket = await app.inject({
    method: "POST",
    url: "/api/tickets",
    payload: {
      ...ticketPayload,
      title: "Second rate limited road complaint",
      description: "A second complaint from the same phone should hit the configured MVP public intake guardrail.",
    },
  });
  assert(secondTicket.statusCode === 429, `Second ticket create returned ${secondTicket.statusCode}; expected 429. Body: ${secondTicket.body}`);
  assert(secondTicket.json<{ rule: string }>().rule === "citizen.ticket_create", "Ticket create rate-limit response should identify the ticket create rule.");
  const spoofedOfficialTicket = await app.inject({
    method: "POST",
    url: "/api/tickets",
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
    },
    payload: {
      ...ticketPayload,
      title: "Spoofed official role should not bypass intake rate limits",
      description: "A citizen public endpoint must remain rate-limited even if the caller sends fake official role headers.",
    },
  });
  assert(
    spoofedOfficialTicket.statusCode === 429,
    `Spoofed official-role ticket create returned ${spoofedOfficialTicket.statusCode}; expected 429. Body: ${spoofedOfficialTicket.body}`,
  );

  const adminConfig = await app.inject({
    method: "GET",
    url: "/api/admin/config",
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
    },
  });
  assert(adminConfig.statusCode === 200, `Admin config returned ${adminConfig.statusCode}; expected 200. Body: ${adminConfig.body}`);
  assert(!adminConfig.headers["ratelimit-limit"], "Government/Admin routes should not receive public citizen rate-limit headers.");
}

try {
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "local";
  delete process.env.WHISTLE_ENV;
  configureLowLimits();
  delete process.env.WHISTLE_RATE_LIMIT_BACKEND;
  delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_URL;
  delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY;
  delete process.env.WHISTLE_RATE_LIMIT_KEY_SALT;

  await withApp(async (app) => {
    const ready = await app.inject({ method: "GET", url: "/api/ready" });
    assert(ready.statusCode === 200, `In-memory rate-limit readiness returned ${ready.statusCode}; expected 200. Body: ${ready.body}`);
    assert(
      ready
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "public_rate_limit" && dependency.mode === "in-memory-rate-limit" && dependency.ok),
      "Readiness should report the local in-memory public rate limiter.",
    );
    await runAccountAuthRateLimitAssertions(app);
    await runCitizenRateLimitAssertions(app);
  });
  pass("account auth and citizen public routes are rate-limited per phone/IP bucket and do not apply to government routes");
  pass("citizen ticket creation cannot bypass rate limits with spoofed official headers");

  process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";
  delete process.env.WHISTLE_RATE_LIMIT_BACKEND;
  delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_URL;
  delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY;
  delete process.env.WHISTLE_RATE_LIMIT_KEY_SALT;

  await withApp(async (app) => {
    const ready = await app.inject({ method: "GET", url: "/api/ready" });
    assert(ready.statusCode === 503, `Production profile rate-limit readiness returned ${ready.statusCode}; expected 503. Body: ${ready.body}`);
    assert(
      ready
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "public_rate_limit" && dependency.mode === "public-rate-limit-disabled" && !dependency.ok),
      "Production profile without a shared public rate-limit backend should disable local in-memory rate limiting.",
    );
  });
  pass("production profile disables local in-memory public rate limiting when no shared backend is configured");

  process.env.WHISTLE_DEPLOYMENT_PROFILE = "local";
  process.env.WHISTLE_RATE_LIMIT_BACKEND = "gateway";
  delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_URL;
  process.env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY = "rate-limit-smoke-secret";

  await withApp(async (app) => {
    const ready = await app.inject({ method: "GET", url: "/api/ready" });
    assert(ready.statusCode === 503, `Misconfigured gateway readiness returned ${ready.statusCode}; expected 503. Body: ${ready.body}`);
    assert(
      ready
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "public_rate_limit" && dependency.mode === "distributed-http-rate-limit" && !dependency.ok),
      "Readiness should fail when the distributed public rate-limit gateway is missing config.",
    );
  });
  pass("misconfigured distributed public rate-limit gateway fails readiness");

  const gateway = await startRateLimitGateway();
  try {
    process.env.WHISTLE_RATE_LIMIT_BACKEND = "gateway";
    process.env.WHISTLE_RATE_LIMIT_GATEWAY_URL = gateway.url;
    process.env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY = "rate-limit-smoke-secret";
    process.env.WHISTLE_RATE_LIMIT_KEY_SALT = "smoke-rate-limit-salt";

    await withApp(async (app) => {
      const ready = await app.inject({ method: "GET", url: "/api/ready" });
      assert(ready.statusCode === 200, `Distributed gateway readiness returned ${ready.statusCode}; expected 200. Body: ${ready.body}`);
      assert(
        ready
          .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
          .dependencies.some((dependency) => dependency.name === "public_rate_limit" && dependency.mode === "distributed-http-rate-limit" && dependency.ok),
        "Readiness should pass for a configured distributed public rate-limit gateway.",
      );
      await runAccountAuthRateLimitAssertions(app);
      await runCitizenRateLimitAssertions(app);
    });
    const checkRequests = gateway.requests.filter((request) => request.body.kind === "check");
    assert(checkRequests.length > 0, "Distributed gateway should receive public rate-limit check calls.");
    for (const request of gateway.requests) {
      assert(request.authorization === "Bearer rate-limit-smoke-secret", "Distributed rate-limit gateway should receive configured bearer credential.");
    }
    for (const request of checkRequests) {
      assert(typeof request.body.bucketKey === "string" && /^[a-f0-9]{64}$/.test(request.body.bucketKey), "Gateway bucket key should be a SHA-256 hash.");
      assert(!JSON.stringify(request.body).includes("+9198"), "Gateway payload must not expose raw citizen or account phone numbers.");
      assert(!("key" in request.body), "Gateway payload must not expose the raw local rate-limit key.");
    }
  } finally {
    await gateway.close();
  }
  pass("distributed public rate-limit gateway enforces limits using hashed citizen keys");
} finally {
  if (originalEnv.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalEnv.logLevel;
  if (originalEnv.otpStartMax === undefined) delete process.env.WHISTLE_RATE_LIMIT_OTP_START_MAX;
  else process.env.WHISTLE_RATE_LIMIT_OTP_START_MAX = originalEnv.otpStartMax;
  if (originalEnv.otpStartWindow === undefined) delete process.env.WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS;
  else process.env.WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS = originalEnv.otpStartWindow;
  if (originalEnv.authOtpStartMax === undefined) delete process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_START_MAX;
  else process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_START_MAX = originalEnv.authOtpStartMax;
  if (originalEnv.authOtpStartWindow === undefined) delete process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_START_WINDOW_SECONDS;
  else process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_START_WINDOW_SECONDS = originalEnv.authOtpStartWindow;
  if (originalEnv.authOtpVerifyMax === undefined) delete process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_MAX;
  else process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_MAX = originalEnv.authOtpVerifyMax;
  if (originalEnv.authOtpVerifyWindow === undefined) delete process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_WINDOW_SECONDS;
  else process.env.WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_WINDOW_SECONDS = originalEnv.authOtpVerifyWindow;
  if (originalEnv.authLoginMax === undefined) delete process.env.WHISTLE_RATE_LIMIT_AUTH_LOGIN_MAX;
  else process.env.WHISTLE_RATE_LIMIT_AUTH_LOGIN_MAX = originalEnv.authLoginMax;
  if (originalEnv.authLoginWindow === undefined) delete process.env.WHISTLE_RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS;
  else process.env.WHISTLE_RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS = originalEnv.authLoginWindow;
  if (originalEnv.authPasswordResetMax === undefined) delete process.env.WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_MAX;
  else process.env.WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_MAX = originalEnv.authPasswordResetMax;
  if (originalEnv.authPasswordResetWindow === undefined) delete process.env.WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_WINDOW_SECONDS;
  else process.env.WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_WINDOW_SECONDS = originalEnv.authPasswordResetWindow;
  if (originalEnv.ticketCreateMax === undefined) delete process.env.WHISTLE_RATE_LIMIT_TICKET_CREATE_MAX;
  else process.env.WHISTLE_RATE_LIMIT_TICKET_CREATE_MAX = originalEnv.ticketCreateMax;
  if (originalEnv.ticketCreateWindow === undefined) delete process.env.WHISTLE_RATE_LIMIT_TICKET_CREATE_WINDOW_SECONDS;
  else process.env.WHISTLE_RATE_LIMIT_TICKET_CREATE_WINDOW_SECONDS = originalEnv.ticketCreateWindow;
  if (originalEnv.backend === undefined) delete process.env.WHISTLE_RATE_LIMIT_BACKEND;
  else process.env.WHISTLE_RATE_LIMIT_BACKEND = originalEnv.backend;
  if (originalEnv.gatewayUrl === undefined) delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_URL;
  else process.env.WHISTLE_RATE_LIMIT_GATEWAY_URL = originalEnv.gatewayUrl;
  if (originalEnv.gatewayApiKey === undefined) delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY;
  else process.env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY = originalEnv.gatewayApiKey;
  if (originalEnv.keySalt === undefined) delete process.env.WHISTLE_RATE_LIMIT_KEY_SALT;
  else process.env.WHISTLE_RATE_LIMIT_KEY_SALT = originalEnv.keySalt;
  if (originalEnv.deploymentProfile === undefined) delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  else process.env.WHISTLE_DEPLOYMENT_PROFILE = originalEnv.deploymentProfile;
  if (originalEnv.whistleEnv === undefined) delete process.env.WHISTLE_ENV;
  else process.env.WHISTLE_ENV = originalEnv.whistleEnv;
  if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
}
