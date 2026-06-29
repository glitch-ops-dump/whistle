import { resolve } from "node:path";
import { createDeploymentPreflightReport, deploymentPreflightRuntimeFromEnv } from "../server/config/deploymentPreflight.js";
import { parseEnvFile } from "./env-file.js";

type Options = {
  envFile: string;
  assert: boolean;
  json: boolean;
};

const expectedPasses = new Set([
  "database_persistence",
  "official_identity_provider",
  "official_oidc_signing_source",
  "government_password_account_auth",
  "worker_job_authentication",
  "mock_otp_exposure",
  "distributed_rate_limits",
  "rate_limit_bucket_salt",
  "cors_origin_allowlist",
  "api_security_headers",
  "deployment_secret_material",
]);

const expectedExternalGates = new Set([
  "citizen_otp_provider",
  "evidence_object_storage",
  "evidence_scanning_kms",
  "notification_delivery_provider",
  "deployment_backup_runbook",
  "siem_audit_export",
]);

function parseArgs(argv: string[]): Options {
  const options: Options = {
    envFile: "ops/env/whistle-mvp1-local-uat.env.example",
    assert: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      options.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--assert") {
      options.assert = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertLocalUat(report: ReturnType<typeof createDeploymentPreflightReport>) {
  assert(report.profile === "local", "MVP1 local UAT preflight must stay on local deployment profile.");
  for (const id of expectedPasses) {
    const check = report.checks.find((item) => item.id === id);
    assert(check?.status === "pass", `Expected ${id} to pass in local UAT; got ${check?.status ?? "missing"}.`);
  }
  for (const id of expectedExternalGates) {
    const check = report.checks.find((item) => item.id === id);
    assert(check?.status === "blocker", `Expected ${id} to remain an external launch gate; got ${check?.status ?? "missing"}.`);
  }
  assert(
    report.checks.find((item) => item.id === "otel_metrics_export")?.status === "warning",
    "OpenTelemetry export should remain a warning until a real endpoint is configured.",
  );
}

function renderMarkdown(report: ReturnType<typeof createDeploymentPreflightReport>, envFile: string) {
  const rows = report.checks
    .map((item) => `| ${item.id} | ${item.status} | ${item.observed} |`)
    .join("\n");
  return `# Whistle MVP1 Local UAT Preflight

Env file: \`${envFile}\`  
Profile: \`${report.profile}\`  
Production target: \`${report.productionTarget}\`  
Summary: ${report.summary.passes} pass, ${report.summary.warnings} warning, ${report.summary.blockers} launch gate(s)

This is a local-only UAT harness. Passing official auth, worker auth, Postgres, and rate-limit checks here does not approve staging or production launch.

| Check | Status | Observed |
| --- | --- | --- |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envFile = resolve(process.cwd(), options.envFile);
  const fileEnv = parseEnvFile(envFile);
  const env = { ...process.env, ...fileEnv };
  const report = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(env), env);
  if (options.assert) assertLocalUat(report);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ kind: "whistle-mvp1-local-uat-preflight", envFile, report }, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderMarkdown(report, envFile));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
