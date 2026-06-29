import { buildWhistleApi } from "../server/app.js";
import { withVerifiedPhone } from "./smoke-helpers.js";
import { runWorkerJobs } from "./run-worker-jobs.js";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
  workerAuthRequired: process.env.WHISTLE_WORKER_AUTH_REQUIRED,
  workerSharedSecret: process.env.WHISTLE_WORKER_SHARED_SECRET,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;
process.env.WHISTLE_SEED_DEMO = "false";
process.env.WHISTLE_WORKER_AUTH_REQUIRED = "true";
process.env.WHISTLE_WORKER_SHARED_SECRET = "worker-runner-smoke-secret";

const app = buildWhistleApi();

try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert(address && typeof address === "object", "Worker runner smoke API did not expose a port.");
  const apiBaseUrl = `http://127.0.0.1:${address.port}`;

  const dryRun = await runWorkerJobs({
    apiBaseUrl,
    actor: "worker:prototype",
    jobs: ["sla", "evidence", "notifications"],
    batchLimit: 7,
    maxPasses: 2,
    dryRun: true,
  });
  assert(dryRun.dryRun, "Worker runner dry-run should report dryRun=true.");
  assert(dryRun.jobs.length === 3, "Worker runner dry-run should include all requested jobs.");
  assert(dryRun.jobs.every((job) => job.passes.length === 0), "Worker runner dry-run must not call job endpoints.");
  pass("worker runner dry-run reports planned jobs without mutating queues");

  const payload = await withVerifiedPhone(app, {
    category: "roads",
    language: "en",
    title: "Worker runner notification smoke",
    description: "A ticket that proves the worker runner can call authenticated job endpoints with bounded batches.",
    phone: "+919766661111",
    departmentHint: "Corporation / Municipality",
    location: {
      district: "Chennai",
      area: "T Nagar",
      address: "Burkit Road",
    },
    evidence: [],
  });
  const ticket = await app.inject({
    method: "POST",
    url: "/api/tickets",
    payload,
  });
  assert(ticket.statusCode === 201, `Worker runner smoke ticket create returned ${ticket.statusCode}; expected 201. Body: ${ticket.body}`);

  const run = await runWorkerJobs({
    apiBaseUrl,
    actor: "worker:prototype",
    token: "worker-runner-smoke-secret",
    jobs: ["notifications"],
    batchLimit: 1,
    maxPasses: 1,
  });
  const notificationJob = run.jobs.find((job) => job.job === "notifications");
  assert(notificationJob?.passes.length === 1, "Worker runner should execute one notification pass.");
  assert(notificationJob.passes[0].statusCode === 200, "Worker runner notification pass should return HTTP 200.");
  assert(notificationJob.passes[0].result.batchLimit === 1, "Worker runner should send the bounded batch limit.");
  pass("worker runner executes authenticated bounded notification job through the API");

  let failed = false;
  try {
    await runWorkerJobs({
      apiBaseUrl,
      actor: "worker:prototype",
      token: "wrong-worker-secret",
      jobs: ["notifications"],
      batchLimit: 1,
      maxPasses: 1,
    });
  } catch (error) {
    failed = true;
    assert(error instanceof Error && error.message.includes("403"), "Worker runner should surface forbidden worker-token failures.");
  }
  assert(failed, "Worker runner should fail when the worker token is wrong.");
  pass("worker runner surfaces worker authentication failures");
} finally {
  await app.close();
  if (originalEnv.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalEnv.logLevel;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
  if (originalEnv.workerAuthRequired === undefined) delete process.env.WHISTLE_WORKER_AUTH_REQUIRED;
  else process.env.WHISTLE_WORKER_AUTH_REQUIRED = originalEnv.workerAuthRequired;
  if (originalEnv.workerSharedSecret === undefined) delete process.env.WHISTLE_WORKER_SHARED_SECRET;
  else process.env.WHISTLE_WORKER_SHARED_SECRET = originalEnv.workerSharedSecret;
}
