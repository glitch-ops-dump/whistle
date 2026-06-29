import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createDeploymentPreflightReport, deploymentPreflightRuntimeFromEnv } from "../server/config/deploymentPreflight.js";
import { applyEnv, parseEnvFile } from "./env-file.js";
import { createLocalUatOfficialToken } from "./mvp1-local-uat-token.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

const envFile = resolve(process.cwd(), "ops/env/whistle-mvp1-local-uat.env.example");
const env = parseEnvFile(envFile);
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
const report = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(env), env);

assert(env.WHISTLE_DEPLOYMENT_PROFILE === "local", "Local UAT env must stay on local deployment profile.");
assert(env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH === "false", "Local UAT should disable prototype official headers.");
assert(Boolean(env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET), "Local UAT should configure an HS256 OIDC smoke secret.");
assert(env.WHISTLE_WORKER_AUTH_REQUIRED === "true", "Local UAT should require worker token auth.");
assert(Boolean(env.WHISTLE_WORKER_SHARED_SECRET), "Local UAT should configure a worker smoke secret.");
assert(env.WHISTLE_RATE_LIMIT_BACKEND === "postgres", "Local UAT should use Postgres-backed public rate limits.");
assert(env.WHISTLE_EXPOSE_MOCK_OTP === "false", "Local UAT should hide mock OTP values from API responses.");

for (const id of ["database_persistence", "official_identity_provider", "worker_job_authentication", "distributed_rate_limits", "mock_otp_exposure"]) {
  const check = report.checks.find((item) => item.id === id);
  assert(check?.status === "pass", `Expected ${id} to pass in local UAT preflight; got ${check?.status ?? "missing"}.`);
}

for (const id of ["citizen_otp_provider", "evidence_object_storage", "notification_delivery_provider", "deployment_backup_runbook", "siem_audit_export"]) {
  const check = report.checks.find((item) => item.id === id);
  assert(check?.status === "blocker", `Expected ${id} to remain a real external launch gate; got ${check?.status ?? "missing"}.`);
}

assert(packageJson.scripts["api:dev:mvp1-uat"]?.includes("run-mvp1-local-uat-api.ts"), "api:dev:mvp1-uat should load the local UAT env runner.");
assert(packageJson.scripts["mvp1:uat-preflight"]?.includes("mvp1-local-uat-preflight.ts"), "mvp1:uat-preflight should run local UAT preflight.");
assert(packageJson.scripts["mvp1:uat-token"]?.includes("mvp1-local-uat-token.ts"), "mvp1:uat-token should mint local UAT browser tokens.");
assert(packageJson.scripts["mvp1:uat-seed"]?.includes("mvp1-local-uat-seed.ts"), "mvp1:uat-seed should create local role-test data.");
assert(packageJson.scripts["mvp1:uat-run"]?.includes("mvp1-local-uat-run.ts"), "mvp1:uat-run should execute local role assertions.");
const seedScript = readFileSync(resolve(process.cwd(), "scripts/mvp1-local-uat-seed.ts"), "utf8");
for (const fixture of ["cm-escalated", "ministry-queue", "mla-local", "councillor-ward-48", "protected-corruption", "rejection-review", "verification-new"]) {
  assert(seedScript.includes(fixture), `Local UAT seed should include ${fixture} fixture.`);
}
assert(seedScript.includes("protectedVisibility"), "Local UAT seed should assert protected-ticket role visibility.");
assert(seedScript.includes("--quiet"), "Local UAT seed should support quiet verification without printing bearer tokens.");
const runScript = readFileSync(resolve(process.cwd(), "scripts/mvp1-local-uat-run.ts"), "utf8");
for (const contract of ["--seed-file", "assertFreshSeedState", "database drifted", "dashboardContains", "addFieldReport", "/api/rejection-review/", "protected-read-guardrail"]) {
  assert(runScript.includes(contract), `Local UAT runner should include ${contract} contract.`);
}
for (const relativePath of [
  "docs/mvp1-local-uat-guide.md",
  "docs/whistle-production-runbook.md",
  "scripts/mvp1-launch-rehearsal-packet.ts",
  "server/config/launchHandoff.ts",
  "src/AdminConsole.tsx",
]) {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  assert(
    source.includes("mvp1:uat-seed -- --json --quiet --run-id"),
    `${relativePath} should keep seed JSON generation quiet so bearer tokens do not print to stdout.`,
  );
  assert(
    !source.includes("mvp1:uat-seed -- --json --run-id"),
    `${relativePath} should not document noisy seed JSON generation.`,
  );
}

const cli = execFileSync("npm", ["run", "mvp1:uat-preflight", "--", "--json"], { encoding: "utf8" });
const parsed = JSON.parse(cli.slice(cli.indexOf("{"))) as { kind?: string; report?: { profile?: string; summary?: { blockers?: number } } };
assert(parsed.kind === "whistle-mvp1-local-uat-preflight", "Local UAT preflight CLI should emit stable JSON kind.");
assert(parsed.report?.profile === "local", "Local UAT preflight CLI should stay local.");
assert((parsed.report?.summary?.blockers ?? 0) > 0, "Local UAT preflight should preserve external launch gates.");

const tokenCli = execFileSync("npm", ["run", "mvp1:uat-token", "--", "--json", "--actor", "admin:prototype", "--role", "admin"], { encoding: "utf8" });
const tokenJson = JSON.parse(tokenCli.slice(tokenCli.indexOf("{"))) as { kind?: string; storageKey?: string; token?: string };
assert(tokenJson.kind === "whistle-mvp1-local-uat-official-token", "Local UAT token CLI should emit stable JSON kind.");
assert(tokenJson.storageKey === "whistle.officialBearerToken.admin:prototype", "Local UAT token CLI should emit the browser storage key.");
assert(Boolean(tokenJson.token), "Local UAT token CLI should emit a bearer token.");

process.env.LOG_LEVEL = "silent";
process.env.WHISTLE_SEED_DEMO = "false";
applyEnv(env, { override: true });

const { buildWhistleApi } = await import("../server/app.js");

async function withApp<T>(run: (app: ReturnType<typeof buildWhistleApi>) => Promise<T>) {
  const app = buildWhistleApi();
  await app.ready();
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

async function bearer(actor: string, role: string) {
  return `Bearer ${await createLocalUatOfficialToken({ actor, role, env })}`;
}

await withApp(async (app) => {
  const prototypeHeaderAttempt = await app.inject({
    method: "GET",
    url: "/api/admin/config",
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
    },
  });
  assert(
    prototypeHeaderAttempt.statusCode === 403,
    `Local UAT admin prototype headers returned ${prototypeHeaderAttempt.statusCode}; expected 403. Body: ${prototypeHeaderAttempt.body}`,
  );

  const adminConfig = await app.inject({
    method: "GET",
    url: "/api/admin/config",
    headers: {
      authorization: await bearer("admin:prototype", "admin"),
    },
  });
  assert(adminConfig.statusCode === 200, `Local UAT admin token returned ${adminConfig.statusCode}; expected 200. Body: ${adminConfig.body}`);

  const adminAccess = await app.inject({
    method: "GET",
    url: "/api/admin/access",
    headers: {
      authorization: await bearer("admin:prototype", "admin"),
    },
  });
  assert(adminAccess.statusCode === 200, `Local UAT admin access token returned ${adminAccess.statusCode}; expected 200. Body: ${adminAccess.body}`);

  const verificationQueue = await app.inject({
    method: "GET",
    url: "/api/verification/queue",
    headers: {
      authorization: await bearer("verification:prototype", "verification"),
    },
  });
  assert(verificationQueue.statusCode === 200, `Local UAT verification token returned ${verificationQueue.statusCode}; expected 200. Body: ${verificationQueue.body}`);

  const ministerDashboard = await app.inject({
    method: "GET",
    url: "/api/dashboard?role=minister&ministry=Municipal+Administration+and+Water+Supply&ticketLimit=3",
    headers: {
      authorization: await bearer("minister:prototype", "minister"),
    },
  });
  assert(ministerDashboard.statusCode === 200, `Local UAT minister dashboard token returned ${ministerDashboard.statusCode}; expected 200. Body: ${ministerDashboard.body}`);

  const noMfaToken = await createLocalUatOfficialToken({ actor: "admin:prototype", role: "admin", env, mfa: false });
  const noMfa = await app.inject({
    method: "GET",
    url: "/api/admin/config",
    headers: {
      authorization: `Bearer ${noMfaToken}`,
    },
  });
  assert(noMfa.statusCode === 403, `Local UAT no-MFA token returned ${noMfa.statusCode}; expected 403. Body: ${noMfa.body}`);
});

pass("MVP1 local UAT runtime exercises OIDC, worker auth, Postgres, and rate limits without faking production providers");
