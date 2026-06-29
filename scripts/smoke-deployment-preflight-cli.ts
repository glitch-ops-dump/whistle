import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type DeploymentPreflightPayload = {
  report: {
    profile: "local" | "test" | "staging" | "production";
    productionReady: boolean;
    summary: {
      blockers: number;
      warnings: number;
      passes: number;
    };
    checks: Array<{
      id: string;
      status: "pass" | "warning" | "blocker";
      observed: string;
    }>;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function cli(args: string[]) {
  const tsx = path.resolve(process.cwd(), "node_modules/.bin/tsx");
  return spawnSync(tsx, ["scripts/deployment-preflight-report.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function parseJson(stdout: string): DeploymentPreflightPayload {
  return JSON.parse(stdout) as DeploymentPreflightPayload;
}

function checkById(payload: DeploymentPreflightPayload, id: string) {
  const item = payload.report.checks.find((check) => check.id === id);
  assert(item, `Expected check ${id}.`);
  return item;
}

function assertNoSecretValue(text: string, value: string) {
  assert(!text.includes(value), `Deployment preflight leaked malformed secret value: ${value}`);
}

const templatePath = "ops/env/whistle-mvp1-staging.env.example";
const templateRun = cli(["--env-file", templatePath, "--json"]);
assert(templateRun.status === 0, `Template preflight CLI should report without assert failure. stderr: ${templateRun.stderr}`);
const templatePayload = parseJson(templateRun.stdout);
assert(templatePayload.report.profile === "staging", `Template env should resolve staging profile, got ${templatePayload.report.profile}.`);
assert(!templatePayload.report.productionReady, "Template env must not be treated as production ready.");
const placeholderCheck = checkById(templatePayload, "deployment_secret_material");
assert(placeholderCheck.status === "blocker", "Template env should be blocked by placeholder-value guard.");
assert(
  placeholderCheck.observed.includes("DATABASE_URL") &&
    placeholderCheck.observed.includes("WHISTLE_OTP_PROVIDER_API_KEY") &&
    !placeholderCheck.observed.includes("REPLACE_WITH"),
  "Placeholder guard should name env keys without leaking placeholder values.",
);

const templateAssertRun = cli(["--env-file", templatePath, "--assert", "--strict"]);
assert(templateAssertRun.status !== 0, "Assert mode should fail for the unrendered env template.");
assert(templateAssertRun.stderr.includes("deployment preflight failed"), "Assert mode should explain the deployment preflight failure.");
pass("deployment preflight CLI blocks copied env templates with placeholder values");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "whistle-preflight-"));
const renderedEnvPath = path.join(tempDir, "whistle-staging.env");
const malformedEnvPath = path.join(tempDir, "malformed-staging.env");
const freshRestoreDrillAt = new Date().toISOString();
await fs.writeFile(
  malformedEnvPath,
  [
    "WHISTLE_DEPLOYMENT_PROFILE=staging",
    "WHISTLE_SECURITY_EXPORT_API_KEY malformed-secret-value-that-must-not-leak",
    "",
  ].join("\n"),
  "utf8",
);
const malformedRun = cli(["--env-file", malformedEnvPath, "--json"]);
assert(malformedRun.status !== 0, "Deployment preflight should fail closed for malformed env lines.");
assert(malformedRun.stderr.includes("line 2"), "Deployment preflight malformed env error should include line number.");
assert(malformedRun.stderr.includes("WHISTLE_SECURITY_EXPORT_API_KEY"), "Deployment preflight malformed env error should include recoverable key name.");
assertNoSecretValue(malformedRun.stderr, "malformed-secret-value-that-must-not-leak");
pass("deployment preflight CLI fails closed and redacts malformed secret values");

await fs.writeFile(
  renderedEnvPath,
  [
    "WHISTLE_DEPLOYMENT_PROFILE=staging",
    "DATABASE_URL=postgres://whistle_app:fixture-db-pass-not-real-20260629@postgres.whistle.invalid:5432/whistle",
    "WHISTLE_PROTOTYPE_OFFICIAL_AUTH=false",
    "WHISTLE_OFFICIAL_OIDC_ISSUER=https://id.whistle.invalid/realms/whistle",
    "WHISTLE_OFFICIAL_OIDC_AUDIENCE=whistle-government-console",
    "WHISTLE_OFFICIAL_OIDC_JWKS_URL=https://id.whistle.invalid/realms/whistle/protocol/openid-connect/certs",
    "WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED=true",
    "WHISTLE_WORKER_AUTH_REQUIRED=true",
    "WHISTLE_WORKER_SHARED_SECRET=fixture-worker-shared-secret-not-real-20260629",
    "WHISTLE_OTP_PROVIDER_MODE=webhook",
    "WHISTLE_OTP_PROVIDER_WEBHOOK_URL=https://sms.whistle.invalid/otp",
    "WHISTLE_OTP_PROVIDER_API_KEY=fixture-otp-provider-key-not-real-20260629",
    "WHISTLE_EXPOSE_MOCK_OTP=false",
    "WHISTLE_EVIDENCE_OBJECT_STORE_MODE=s3-compatible",
    "WHISTLE_EVIDENCE_S3_ENDPOINT=https://object-store.whistle.invalid",
    "WHISTLE_EVIDENCE_S3_BUCKET=whistle-evidence",
    "WHISTLE_EVIDENCE_S3_REGION=ap-south-1",
    "WHISTLE_EVIDENCE_KMS_KEY_ID=fixture-kms-whistle-evidence-not-real",
    "WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED=true",
    "WHISTLE_EVIDENCE_DATA_RESIDENCY=India",
    "WHISTLE_NOTIFICATION_PROVIDER_MODE=webhook",
    "WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL=https://notify.whistle.invalid/messages",
    "WHISTLE_NOTIFICATION_PROVIDER_API_KEY=fixture-notification-provider-key-not-real-20260629",
    "WHISTLE_RATE_LIMIT_BACKEND=gateway",
    "WHISTLE_RATE_LIMIT_GATEWAY_URL=https://rate-limit.whistle.invalid/check",
    "WHISTLE_RATE_LIMIT_GATEWAY_API_KEY=fixture-rate-limit-gateway-key-not-real-20260629",
    "WHISTLE_RATE_LIMIT_KEY_SALT=fixture-rate-limit-salt-not-real-20260629",
    "WHISTLE_ALLOWED_ORIGINS=https://whistle.invalid,https://console.whistle.invalid",
    "WHISTLE_SECURITY_HEADERS_ENABLED=true",
    "WHISTLE_SECURITY_EXPORT_MODE=webhook",
    "WHISTLE_SECURITY_EXPORT_WEBHOOK_URL=https://siem.whistle.invalid/security-export",
    "WHISTLE_SECURITY_EXPORT_API_KEY=fixture-security-export-key-not-real-20260629",
    "WHISTLE_TELEMETRY_EXPORT_MODE=otlp-http",
    "WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.whistle.invalid/v1/traces",
    "WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED=true",
    "WHISTLE_DEPLOYMENT_RUNBOOK_VERSION=mvp1-ops-2026-06-01",
    "WHISTLE_BACKUP_RESTORE_DRILL_APPROVED=true",
    `WHISTLE_BACKUP_RESTORE_DRILL_AT=${freshRestoreDrillAt}`,
    "",
  ].join("\n"),
  "utf8",
);

const renderedRun = cli(["--env-file", renderedEnvPath, "--json"]);
assert(renderedRun.status === 0, `Rendered production-like env should report without assert failure. stderr: ${renderedRun.stderr}`);
const renderedPayload = parseJson(renderedRun.stdout);
assert(!renderedPayload.report.productionReady, "Rendered env should stay blocked until the real evidence object-store adapter exists.");
assert(renderedPayload.report.summary.blockers === 1, `Rendered env should have exactly one blocker, got ${renderedPayload.report.summary.blockers}.`);
assert(renderedPayload.report.summary.warnings === 0, "Rendered env should have no warnings in strict mode.");
assert(checkById(renderedPayload, "deployment_secret_material").status === "pass", "Rendered env should pass placeholder guard.");
const evidenceCheck = checkById(renderedPayload, "evidence_object_storage");
assert(evidenceCheck.status === "blocker", "Rendered env should still block on evidence object storage.");
assert(evidenceCheck.observed === "s3-compatible-object-store-unimplemented", `Rendered env should observe the fail-closed evidence adapter mode, got ${evidenceCheck.observed}.`);

const renderedAssertRun = cli(["--env-file", renderedEnvPath, "--assert", "--strict", "--json"]);
assert(renderedAssertRun.status !== 0, "Assert mode should fail while the real evidence object-store adapter is missing.");
assert(renderedAssertRun.stderr.includes("evidence_object_storage"), "Assert mode should name the missing evidence object-store adapter blocker.");
pass("deployment preflight CLI keeps rendered env blocked only on the missing real evidence adapter");
