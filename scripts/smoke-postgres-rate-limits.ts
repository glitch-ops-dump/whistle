import pg from "pg";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
  backend: process.env.WHISTLE_RATE_LIMIT_BACKEND,
  keySalt: process.env.WHISTLE_RATE_LIMIT_KEY_SALT,
  otpStartMax: process.env.WHISTLE_RATE_LIMIT_OTP_START_MAX,
  otpStartWindow: process.env.WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

async function startApp() {
  const { buildWhistleApi } = await import("../server/app.js");
  const app = buildWhistleApi();
  await app.ready();
  return app;
}

async function run() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for Postgres-backed rate-limit smoke.");

  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  process.env.WHISTLE_SEED_DEMO = "false";
  process.env.WHISTLE_RATE_LIMIT_BACKEND = "postgres";
  process.env.WHISTLE_RATE_LIMIT_KEY_SALT = "postgres-rate-limit-smoke-salt";
  process.env.WHISTLE_RATE_LIMIT_OTP_START_MAX = "2";
  process.env.WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS = "120";

  const appA = await startApp();
  const appB = await startApp();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const phoneLocal = `9${String(Date.now() % 1_000_000_000).padStart(9, "0")}`;
  const phone = `+91 ${phoneLocal}`;

  try {
    const ready = await appA.inject({ method: "GET", url: "/api/ready" });
    assert(ready.statusCode === 200, `Postgres rate-limit readiness returned ${ready.statusCode}; expected 200. Body: ${ready.body}`);
    assert(
      ready
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean }> }>()
        .dependencies.some((dependency) => dependency.name === "public_rate_limit" && dependency.mode === "postgres-rate-limit" && dependency.ok),
      "Readiness should report a healthy Postgres-backed public rate limiter.",
    );

    for (const [index, app] of [appA, appB].entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/api/citizen/otp/start",
        payload: { phone, language: "en" },
      });
      assert(response.statusCode === 201, `Cross-instance OTP start ${index + 1} returned ${response.statusCode}; expected 201. Body: ${response.body}`);
      assert(response.headers["ratelimit-limit"] === "2", "Postgres rate-limit response should expose the configured limit.");
    }

    const limited = await appA.inject({
      method: "POST",
      url: "/api/citizen/otp/start",
      payload: { phone, language: "en" },
    });
    assert(limited.statusCode === 429, `Cross-instance third OTP start returned ${limited.statusCode}; expected 429. Body: ${limited.body}`);
    assert(limited.json<{ rule: string }>().rule === "citizen.otp_start", "Postgres rate-limit response should identify the OTP start rule.");

    const rows = await pool.query<{ rule_id: string; bucket_key: string; request_count: number }>(
      `
        select rule_id, bucket_key, request_count
        from public_rate_limit_buckets
        where rule_id = 'citizen.otp_start'
        order by updated_at desc
        limit 5
      `,
    );
    const row = rows.rows.find((item) => item.request_count >= 3);
    assert(row, "Postgres rate-limit bucket should record the cross-instance request count.");
    assert(/^[a-f0-9]{64}$/.test(row.bucket_key), "Postgres rate-limit bucket key should be a SHA-256 hash.");
    assert(!row.bucket_key.includes(phoneLocal), "Postgres rate-limit bucket key must not expose raw citizen phone digits.");

    await pool.query("delete from public_rate_limit_buckets where rule_id = $1 and bucket_key = $2", [row.rule_id, row.bucket_key]);
    pass("Postgres public rate limiter shares hashed buckets across API instances");
  } finally {
    await appA.close();
    await appB.close();
    await pool.end();
  }
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (originalEnv.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalEnv.databaseUrl;
    if (originalEnv.logLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalEnv.logLevel;
    if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
    else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
    if (originalEnv.backend === undefined) delete process.env.WHISTLE_RATE_LIMIT_BACKEND;
    else process.env.WHISTLE_RATE_LIMIT_BACKEND = originalEnv.backend;
    if (originalEnv.keySalt === undefined) delete process.env.WHISTLE_RATE_LIMIT_KEY_SALT;
    else process.env.WHISTLE_RATE_LIMIT_KEY_SALT = originalEnv.keySalt;
    if (originalEnv.otpStartMax === undefined) delete process.env.WHISTLE_RATE_LIMIT_OTP_START_MAX;
    else process.env.WHISTLE_RATE_LIMIT_OTP_START_MAX = originalEnv.otpStartMax;
    if (originalEnv.otpStartWindow === undefined) delete process.env.WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS;
    else process.env.WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS = originalEnv.otpStartWindow;
  });
