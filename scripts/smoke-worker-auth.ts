const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  prototypeOfficialAuth: process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
  workerAuthRequired: process.env.WHISTLE_WORKER_AUTH_REQUIRED,
  workerSharedSecret: process.env.WHISTLE_WORKER_SHARED_SECRET,
  workerToken: process.env.WHISTLE_WORKER_TOKEN,
};

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.WHISTLE_SEED_DEMO = "false";
delete process.env.DATABASE_URL;
delete process.env.WHISTLE_WORKER_TOKEN;

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

try {
  process.env.WHISTLE_WORKER_AUTH_REQUIRED = "true";
  delete process.env.WHISTLE_WORKER_SHARED_SECRET;
  delete process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH;

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Readiness returned ${readiness.statusCode}; expected 503 when worker auth is required without a secret. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "worker_auth" && dependency.mode === "shared-token-missing" && !dependency.ok),
      "Readiness should fail worker_auth when worker auth is required without WHISTLE_WORKER_SHARED_SECRET.",
    );

    const job = await app.inject({
      method: "POST",
      url: "/api/jobs/notifications/run",
      headers: {
        "x-whistle-role": "worker",
        "x-whistle-actor": "worker:prototype",
      },
      payload: { actor: "worker:prototype", limit: 1 },
    });
    assert(job.statusCode === 403, `Worker job returned ${job.statusCode}; expected 403 without a configured worker secret. Body: ${job.body}`);
  });
  pass("worker auth readiness blocks required-worker mode when the shared secret is missing");

  process.env.WHISTLE_WORKER_SHARED_SECRET = "test-worker-secret";
  process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH = "false";

  await withApp(async (app) => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/jobs/notifications/run",
      headers: {
        "x-whistle-role": "worker",
        "x-whistle-actor": "worker:prototype",
      },
      payload: { actor: "worker:prototype", limit: 1 },
    });
    assert(missing.statusCode === 403, `Worker job without token returned ${missing.statusCode}; expected 403. Body: ${missing.body}`);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/jobs/notifications/run",
      headers: {
        "x-whistle-role": "worker",
        "x-whistle-actor": "worker:prototype",
        "x-whistle-worker-token": "wrong-secret",
      },
      payload: { actor: "worker:prototype", limit: 1 },
    });
    assert(wrong.statusCode === 403, `Worker job with wrong token returned ${wrong.statusCode}; expected 403. Body: ${wrong.body}`);

    const allowed = await app.inject({
      method: "POST",
      url: "/api/jobs/notifications/run",
      headers: {
        "x-whistle-role": "worker",
        "x-whistle-actor": "worker:prototype",
        "x-whistle-worker-token": "test-worker-secret",
      },
      payload: { actor: "worker:prototype", limit: 1 },
    });
    assert(allowed.statusCode === 200, `Worker job with valid token returned ${allowed.statusCode}; expected 200. Body: ${allowed.body}`);
    assert(allowed.json<{ result: { batchLimit: number } }>().result.batchLimit === 1, "Worker job should still honor bounded batch limits after token auth.");

    const bearer = await app.inject({
      method: "POST",
      url: "/api/jobs/notifications/run",
      headers: {
        "x-whistle-role": "worker",
        "x-whistle-actor": "worker:prototype",
        authorization: "Bearer test-worker-secret",
      },
      payload: { actor: "worker:prototype", limit: 1 },
    });
    assert(bearer.statusCode === 200, `Worker job with bearer token returned ${bearer.statusCode}; expected 200. Body: ${bearer.body}`);
  });
  pass("worker jobs require a valid shared token and can run independently of prototype official headers");
} finally {
  if (originalEnv.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalEnv.logLevel;
  if (originalEnv.prototypeOfficialAuth === undefined) delete process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH;
  else process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH = originalEnv.prototypeOfficialAuth;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
  if (originalEnv.workerAuthRequired === undefined) delete process.env.WHISTLE_WORKER_AUTH_REQUIRED;
  else process.env.WHISTLE_WORKER_AUTH_REQUIRED = originalEnv.workerAuthRequired;
  if (originalEnv.workerSharedSecret === undefined) delete process.env.WHISTLE_WORKER_SHARED_SECRET;
  else process.env.WHISTLE_WORKER_SHARED_SECRET = originalEnv.workerSharedSecret;
  if (originalEnv.workerToken === undefined) delete process.env.WHISTLE_WORKER_TOKEN;
  else process.env.WHISTLE_WORKER_TOKEN = originalEnv.workerToken;
}
