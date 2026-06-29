import { createServer, type IncomingMessage } from "node:http";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  deploymentProfile: process.env.WHISTLE_DEPLOYMENT_PROFILE,
  env: process.env.WHISTLE_ENV,
  nodeEnv: process.env.NODE_ENV,
  notificationMode: process.env.WHISTLE_NOTIFICATION_PROVIDER_MODE,
  notificationWebhookUrl: process.env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL,
  notificationApiKey: process.env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
};

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.WHISTLE_SEED_DEMO = "false";
delete process.env.DATABASE_URL;
delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
delete process.env.WHISTLE_ENV;
delete process.env.NODE_ENV;

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

async function startNotificationWebhook() {
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
        status: "sent",
        providerMessageId: `notify_live_${String(body.channel)}_${String(body.notificationId)}`,
        reason: "Webhook provider accepted citizen-safe notification.",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "Notification webhook test server did not expose a port.");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/notifications`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function createTicket(app: ReturnType<typeof buildWhistleApi>, phone: string, title: string) {
  const payload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title,
    description: "A civic issue that should queue citizen-safe notification records for delivery provider verification.",
    phone,
    departmentHint: "Corporation / Municipality",
    location: {
      district: "Chennai",
      area: "Velachery",
      landmark: "Bus depot",
    },
    evidence: [],
  });
  const created = await app.inject({ method: "POST", url: "/api/tickets", payload });
  assert(created.statusCode === 201, `Ticket create returned ${created.statusCode}; expected 201. Body: ${created.body}`);
  return created.json<{ ticket: { id: string } }>().ticket.id;
}

try {
  process.env.WHISTLE_NOTIFICATION_PROVIDER_MODE = "disabled";
  delete process.env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL;
  delete process.env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Readiness returned ${readiness.statusCode}; expected 503 with disabled notification provider. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "notification_delivery" && dependency.mode === "notification-provider-disabled" && !dependency.ok),
      "Readiness should fail the notification_delivery dependency when delivery provider is disabled.",
    );

    const ticketId = await createTicket(app, "+91 98765 74441", "Disabled provider notification smoke");

    const job = await app.inject({
      method: "POST",
      url: "/api/jobs/notifications/run",
      headers: {
        "x-whistle-role": "worker",
        "x-whistle-actor": "worker:prototype",
      },
      payload: { actor: "worker:prototype" },
    });
    assert(job.statusCode === 200, `Notification job returned ${job.statusCode}; expected 200. Body: ${job.body}`);
    const result = job.json<{ result: { failedCount: number; sentCount: number; actions: Array<{ status: string; reason: string }> } }>().result;
    assert(result.sentCount === 0, "Disabled notification provider must not mark messages as sent.");
    assert(result.failedCount > 0, "Disabled notification provider should mark queued delivery attempts failed.");
    assert(
      result.actions.every((action) => action.status === "failed" && action.reason.includes("provider")),
      "Disabled notification provider actions should explain failed provider delivery.",
    );

    const notifications = await app.inject({
      method: "GET",
      url: `/api/tickets/${encodeURIComponent(ticketId)}/notifications`,
      headers: {
        "x-whistle-role": "cm_cell",
        "x-whistle-actor": "cm_cell:prototype",
      },
    });
    assert(notifications.statusCode === 200, `Notifications returned ${notifications.statusCode}; expected 200. Body: ${notifications.body}`);
    assert(
      notifications
        .json<{ notifications: Array<{ status: string; provider?: string; lastError?: string }> }>()
        .notifications.every((notification) => notification.status === "failed" && notification.provider === "disabled" && notification.lastError === "notification_provider_disabled"),
      "Notification outbox should preserve failed delivery status and provider error.",
    );
  });
  pass("notification provider seam fails readiness and records failed delivery attempts when disabled");

  delete process.env.WHISTLE_NOTIFICATION_PROVIDER_MODE;
  delete process.env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL;
  delete process.env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY;
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Production-profile notification readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "notification_delivery" && dependency.mode === "notification-provider-disabled" && !dependency.ok),
      "Production profile should disable mock notification delivery when no approved provider is configured.",
    );
  });
  pass("production profile disables mock notification delivery when provider wiring is missing");

  delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  process.env.WHISTLE_NOTIFICATION_PROVIDER_MODE = "webhook";
  delete process.env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL;
  process.env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY = "notification-provider-smoke-secret";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Misconfigured webhook readiness returned ${readiness.statusCode}; expected 503. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "notification_delivery" && dependency.mode === "notification-webhook-provider" && !dependency.ok),
      "Readiness should fail when webhook notification provider is missing URL config.",
    );
  });
  pass("misconfigured webhook notification provider fails readiness");

  const webhook = await startNotificationWebhook();
  try {
    process.env.WHISTLE_NOTIFICATION_PROVIDER_MODE = "webhook";
    process.env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL = webhook.url;
    process.env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY = "notification-provider-smoke-secret";

    await withApp(async (app) => {
      const readiness = await app.inject({ method: "GET", url: "/api/ready" });
      assert(readiness.statusCode === 200, `Webhook notification readiness returned ${readiness.statusCode}; expected 200. Body: ${readiness.body}`);
      assert(
        readiness
          .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
          .dependencies.some((dependency) => dependency.name === "notification_delivery" && dependency.mode === "notification-webhook-provider" && dependency.ok),
        "Readiness should pass for a configured webhook notification provider.",
      );

      const ticketId = await createTicket(app, "+91 98765 74442", "Webhook provider notification smoke");
      const job = await app.inject({
        method: "POST",
        url: "/api/jobs/notifications/run",
        headers: {
          "x-whistle-role": "worker",
          "x-whistle-actor": "worker:prototype",
        },
        payload: { actor: "worker:prototype", limit: 10 },
      });
      assert(job.statusCode === 200, `Webhook notification job returned ${job.statusCode}; expected 200. Body: ${job.body}`);
      const result = job.json<{ result: { failedCount: number; sentCount: number; actions: Array<{ status: string; channel: string; providerMessageId?: string }> } }>().result;
      assert(result.failedCount === 0, "Configured webhook notification provider should not fail delivery attempts.");
      assert(result.sentCount >= 3, "Configured webhook notification provider should send in-app plus external citizen updates.");
      assert(result.actions.every((action) => action.status === "sent" && action.providerMessageId), "Notification actions should expose provider message ids.");

      assert(webhook.requests.length >= 2, `Expected external SMS/WhatsApp webhook calls, got ${webhook.requests.length}.`);
      for (const request of webhook.requests) {
        assert(request.authorization === "Bearer notification-provider-smoke-secret", "Webhook provider should receive configured bearer credential.");
        assert(request.body.ticketId === ticketId, "Webhook payload should include ticket id for provider correlation.");
        assert(request.body.safeMessage && typeof request.body.safeMessage === "string", "Webhook payload should include citizen-safe message.");
        assert(!("phone" in request.body), "Webhook notification payload must not expose raw phone.");
      }

      const notifications = await app.inject({
        method: "GET",
        url: `/api/tickets/${encodeURIComponent(ticketId)}/notifications`,
        headers: {
          "x-whistle-role": "cm_cell",
          "x-whistle-actor": "cm_cell:prototype",
        },
      });
      assert(notifications.statusCode === 200, `Webhook notifications returned ${notifications.statusCode}; expected 200. Body: ${notifications.body}`);
      assert(
        notifications
          .json<{ notifications: Array<{ status: string; provider?: string; providerMessageId?: string; lastError?: string }> }>()
          .notifications.every((notification) => notification.status === "sent" && notification.provider && notification.providerMessageId && !notification.lastError),
        "Notification outbox should preserve sent status, provider, and provider message ids.",
      );
    });
  } finally {
    await webhook.close();
  }
  pass("webhook notification provider records delivery receipts without exposing raw phone");
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
  if (originalEnv.notificationMode === undefined) delete process.env.WHISTLE_NOTIFICATION_PROVIDER_MODE;
  else process.env.WHISTLE_NOTIFICATION_PROVIDER_MODE = originalEnv.notificationMode;
  if (originalEnv.notificationWebhookUrl === undefined) delete process.env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL;
  else process.env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL = originalEnv.notificationWebhookUrl;
  if (originalEnv.notificationApiKey === undefined) delete process.env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY;
  else process.env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY = originalEnv.notificationApiKey;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
}
