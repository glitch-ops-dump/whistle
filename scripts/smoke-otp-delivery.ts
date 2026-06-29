import { createServer, type IncomingMessage } from "node:http";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  deploymentProfile: process.env.WHISTLE_DEPLOYMENT_PROFILE,
  env: process.env.WHISTLE_ENV,
  nodeEnv: process.env.NODE_ENV,
  exposeMockOtp: process.env.WHISTLE_EXPOSE_MOCK_OTP,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
  otpProviderMode: process.env.WHISTLE_OTP_PROVIDER_MODE,
  otpWebhookUrl: process.env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL,
  otpApiKey: process.env.WHISTLE_OTP_PROVIDER_API_KEY,
  rateLimitEnabled: process.env.WHISTLE_RATE_LIMIT_ENABLED,
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

async function startOtpWebhook() {
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
    response.end(JSON.stringify({ providerMessageId: `sms_live_${String(body.challengeId)}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "OTP webhook test server did not expose a port.");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/otp`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

try {
  process.env.WHISTLE_EXPOSE_MOCK_OTP = "false";
  delete process.env.WHISTLE_OTP_PROVIDER_MODE;
  delete process.env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL;
  delete process.env.WHISTLE_OTP_PROVIDER_API_KEY;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 200, `Readiness returned ${readiness.statusCode}; expected 200. Body: ${readiness.body}`);
    assert(
      readiness.json<{ dependencies: Array<{ name: string; mode: string }> }>().dependencies.some((dependency) => dependency.name === "citizen_otp_delivery" && dependency.mode === "mock-sms-hidden"),
      "Readiness should expose hidden mock OTP delivery mode when mock exposure is disabled.",
    );

    const start = await app.inject({
      method: "POST",
      url: "/api/citizen/otp/start",
      payload: {
        phone: "+91 98765 18888",
        language: "en",
      },
    });
    assert(start.statusCode === 201, `OTP start returned ${start.statusCode}; expected 201. Body: ${start.body}`);
    const challenge = start.json<{
      challenge: {
        challengeId: string;
        mockOtp?: string;
        delivery: string;
        deliveryProvider: string;
        providerMessageId: string;
      };
    }>().challenge;
    assert(challenge.delivery === "sms_mock", "OTP start should still route through the configured mock SMS provider in MVP.");
    assert(challenge.deliveryProvider === "mock-sms-hidden", "OTP delivery should report the hidden mock provider mode.");
    assert(challenge.providerMessageId.startsWith("mock_sms_"), "OTP delivery should include a provider message id seam.");
    assert(!("mockOtp" in challenge) || challenge.mockOtp === undefined, "OTP start must not expose the mock OTP when exposure is disabled.");

    const verify = await app.inject({
      method: "POST",
      url: "/api/citizen/otp/verify",
      payload: {
        challengeId: challenge.challengeId,
        otp: "123456",
      },
    });
    assert(verify.statusCode === 200, `OTP verify returned ${verify.statusCode}; expected 200. Body: ${verify.body}`);
  });
  pass("citizen OTP delivery seam can hide prototype OTP exposure while preserving verification");

  delete process.env.WHISTLE_EXPOSE_MOCK_OTP;
  delete process.env.WHISTLE_OTP_PROVIDER_MODE;
  delete process.env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL;
  delete process.env.WHISTLE_OTP_PROVIDER_API_KEY;
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";
  process.env.WHISTLE_RATE_LIMIT_ENABLED = "false";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Production-profile OTP readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "citizen_otp_delivery" && dependency.mode === "otp-provider-disabled" && !dependency.ok),
      "Production profile should disable mock OTP delivery when no approved provider is configured.",
    );
    const start = await app.inject({
      method: "POST",
      url: "/api/citizen/otp/start",
      payload: { phone: "+91 98765 16666", language: "en" },
    });
    assert(start.statusCode === 503, `Production-profile OTP start returned ${start.statusCode}; expected 503. Body: ${start.body}`);
    assert(start.json<{ error: string }>().error === "citizen_otp_delivery_unavailable", "Production-profile OTP start should return a delivery-unavailable error.");
  });
  pass("production profile disables mock OTP delivery when provider wiring is missing");

  delete process.env.WHISTLE_RATE_LIMIT_ENABLED;
  delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  process.env.WHISTLE_OTP_PROVIDER_MODE = "disabled";
  delete process.env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL;
  delete process.env.WHISTLE_OTP_PROVIDER_API_KEY;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Disabled OTP readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "citizen_otp_delivery" && dependency.mode === "otp-provider-disabled" && !dependency.ok),
      "Readiness should fail when the OTP provider is disabled.",
    );
    const start = await app.inject({
      method: "POST",
      url: "/api/citizen/otp/start",
      payload: { phone: "+91 98765 19999", language: "en" },
    });
    assert(start.statusCode === 503, `Disabled OTP start returned ${start.statusCode}; expected 503. Body: ${start.body}`);
    assert(start.json<{ error: string }>().error === "citizen_otp_delivery_unavailable", "Disabled OTP start should return a delivery-unavailable error.");
  });
  pass("disabled citizen OTP provider fails readiness and does not create fake challenges");

  const webhook = await startOtpWebhook();
  try {
    process.env.WHISTLE_OTP_PROVIDER_MODE = "webhook";
    process.env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL = webhook.url;
    process.env.WHISTLE_OTP_PROVIDER_API_KEY = "otp-provider-smoke-secret";

    await withApp(async (app) => {
      const readiness = await app.inject({ method: "GET", url: "/api/ready" });
      assert(readiness.statusCode === 200, `Webhook OTP readiness returned ${readiness.statusCode}; expected 200. Body: ${readiness.body}`);
      assert(
        readiness
          .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
          .dependencies.some((dependency) => dependency.name === "citizen_otp_delivery" && dependency.mode === "sms-webhook-provider" && dependency.ok),
        "Readiness should pass for a configured webhook OTP provider.",
      );

      const start = await app.inject({
        method: "POST",
        url: "/api/citizen/otp/start",
        payload: { phone: "+91 98765 17777", language: "ta" },
      });
      assert(start.statusCode === 201, `Webhook OTP start returned ${start.statusCode}; expected 201. Body: ${start.body}`);
      const challenge = start.json<{
        challenge: {
          challengeId: string;
          mockOtp?: string;
          phone?: string;
          delivery: string;
          deliveryProvider: string;
          providerMessageId: string;
        };
      }>().challenge;
      assert(challenge.delivery === "sms_provider", "Webhook OTP start should report provider delivery.");
      assert(challenge.deliveryProvider === "sms-webhook-provider", "Webhook OTP start should expose provider mode metadata.");
      assert(challenge.providerMessageId.startsWith("sms_live_"), "Webhook OTP start should preserve provider message id.");
      assert(!("mockOtp" in challenge) || challenge.mockOtp === undefined, "Webhook OTP start must not expose the OTP.");
      assert(!("phone" in challenge), "Webhook OTP response must not expose raw phone.");

      assert(webhook.requests.length === 1, `Expected one webhook request, got ${webhook.requests.length}.`);
      const providerRequest = webhook.requests[0];
      assert(providerRequest.authorization === "Bearer otp-provider-smoke-secret", "Webhook OTP provider should receive the configured bearer credential.");
      assert(providerRequest.body.phone === "+919876517777", "Webhook OTP provider should receive the normalized destination phone.");
      assert(providerRequest.body.phoneMasked === "XXXXXX7777", "Webhook OTP provider should receive masked phone metadata.");
      assert(providerRequest.body.otp === "123456", "Webhook OTP provider should receive the verification code.");
      assert(providerRequest.body.language === "ta", "Webhook OTP provider should receive the citizen language.");

      const verify = await app.inject({
        method: "POST",
        url: "/api/citizen/otp/verify",
        payload: {
          challengeId: challenge.challengeId,
          otp: "123456",
        },
      });
      assert(verify.statusCode === 200, `Webhook OTP verify returned ${verify.statusCode}; expected 200. Body: ${verify.body}`);
    });
  } finally {
    await webhook.close();
  }
  pass("webhook citizen OTP provider sends OTP out-of-band without leaking it through the API");
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
  if (originalEnv.exposeMockOtp === undefined) delete process.env.WHISTLE_EXPOSE_MOCK_OTP;
  else process.env.WHISTLE_EXPOSE_MOCK_OTP = originalEnv.exposeMockOtp;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
  if (originalEnv.otpProviderMode === undefined) delete process.env.WHISTLE_OTP_PROVIDER_MODE;
  else process.env.WHISTLE_OTP_PROVIDER_MODE = originalEnv.otpProviderMode;
  if (originalEnv.otpWebhookUrl === undefined) delete process.env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL;
  else process.env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL = originalEnv.otpWebhookUrl;
  if (originalEnv.otpApiKey === undefined) delete process.env.WHISTLE_OTP_PROVIDER_API_KEY;
  else process.env.WHISTLE_OTP_PROVIDER_API_KEY = originalEnv.otpApiKey;
  if (originalEnv.rateLimitEnabled === undefined) delete process.env.WHISTLE_RATE_LIMIT_ENABLED;
  else process.env.WHISTLE_RATE_LIMIT_ENABLED = originalEnv.rateLimitEnabled;
}
