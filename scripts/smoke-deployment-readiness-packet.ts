import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnvFile } from "./env-file.js";

type ReadinessPacket = {
  kind: "whistle-mvp1-readiness-packet";
  profile: "local" | "test" | "staging" | "production";
  strictReady: boolean;
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
  ownerLanes: Array<{
    owner: string;
    set: number;
    total: number;
    missing: string[];
    placeholder: string[];
  }>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function cli(args: string[]) {
  const tsx = path.resolve(process.cwd(), "node_modules/.bin/tsx");
  return spawnSync(tsx, ["scripts/deployment-readiness-packet.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function assertNoSecretValues(text: string, values: string[]) {
  for (const value of values) {
    assert(!text.includes(value), `Readiness packet leaked secret/template value: ${value}`);
  }
}

const templateRun = cli(["--env-file", "ops/env/whistle-mvp1-staging.env.example"]);
assert(templateRun.status === 0, `Template packet generation should succeed. stderr: ${templateRun.stderr}`);
assert(templateRun.stdout.includes("# Whistle MVP1 Readiness Packet"), "Markdown packet should include the packet heading.");
assert(templateRun.stdout.includes("Owner Checklist"), "Markdown packet should include owner checklist.");
assert(templateRun.stdout.includes("deployment_secret_material"), "Markdown packet should include placeholder guard check.");
assert(templateRun.stdout.includes("WHISTLE_OTP_PROVIDER_API_KEY"), "Markdown packet may name incomplete env keys.");
assertNoSecretValues(templateRun.stdout, ["REPLACE_WITH", "REPLACE_WITH_OTP_PROVIDER_API_KEY", "REPLACE_WITH_ISO_RESTORE_DRILL_TIMESTAMP"]);
pass("readiness packet redacts copied template values while preserving owner/key evidence");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "whistle-readiness-packet-"));
const renderedEnvPath = path.join(tempDir, "whistle-staging.env");
const malformedEnvPath = path.join(tempDir, "malformed-staging.env");
const markdownOutPath = path.join(tempDir, "packet.md");
const freshRestoreDrillAt = new Date().toISOString();
const sensitiveValues = [
  "fixture-db-pass-not-real-20260629",
  "fixture-worker-shared-secret-not-real-20260629",
  "fixture-otp-provider-key-not-real-20260629",
  "fixture-notification-provider-key-not-real-20260629",
  "fixture-rate-limit-gateway-key-not-real-20260629",
  "fixture-security-export-key-not-real-20260629",
  "fixture-rate-limit-salt-not-real-20260629",
  freshRestoreDrillAt,
];

await fs.writeFile(
  malformedEnvPath,
  [
    "WHISTLE_DEPLOYMENT_PROFILE=staging",
    "WHISTLE_OTP_PROVIDER_API_KEY super-secret-value-that-must-not-leak",
    "WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED=true",
    "",
  ].join("\n"),
  "utf8",
);
const malformedRun = cli(["--env-file", malformedEnvPath]);
assert(malformedRun.status !== 0, "Malformed readiness env should fail closed.");
assert(malformedRun.stderr.includes("line 2"), "Malformed readiness env error should include line number.");
assert(malformedRun.stderr.includes("WHISTLE_OTP_PROVIDER_API_KEY"), "Malformed readiness env error should include the key name when recoverable.");
assertNoSecretValues(malformedRun.stderr, ["super-secret-value-that-must-not-leak"]);
try {
  parseEnvFile(malformedEnvPath);
  throw new Error("Shared env parser should reject malformed env lines.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  assert(message.includes("line 2"), "Shared env parser error should include line number.");
  assert(message.includes("WHISTLE_OTP_PROVIDER_API_KEY"), "Shared env parser error should include recoverable key name.");
  assertNoSecretValues(message, ["super-secret-value-that-must-not-leak"]);
}
pass("readiness env parsing fails closed and redacts malformed secret values");

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

const jsonRun = cli(["--env-file", renderedEnvPath, "--format", "json"]);
assert(jsonRun.status === 0, `Rendered JSON packet should generate. stderr: ${jsonRun.stderr}`);
assertNoSecretValues(jsonRun.stdout, sensitiveValues);
const packet = JSON.parse(jsonRun.stdout) as ReadinessPacket;
assert(packet.kind === "whistle-mvp1-readiness-packet", "JSON packet should identify its kind.");
assert(packet.profile === "staging", "Rendered packet should preserve staging profile.");
assert(!packet.strictReady, "Rendered packet should not be strict-ready until the real evidence object-store adapter exists.");
assert(packet.summary.blockers === 1 && packet.summary.warnings === 0, "Rendered packet should have only the evidence object-store blocker.");
assert(packet.checks.some((check) => check.id === "evidence_object_storage" && check.status === "blocker"), "Rendered packet should preserve the fail-closed evidence object-store blocker.");
assert(packet.ownerLanes.every((lane) => lane.missing.length === 0 && lane.placeholder.length === 0), "Rendered packet should have no missing or placeholder owner-lane keys.");

const markdownRun = cli(["--env-file", renderedEnvPath, "--out", markdownOutPath]);
assert(markdownRun.status === 0, `Rendered markdown packet should write to disk. stderr: ${markdownRun.stderr}`);
const markdown = await fs.readFile(markdownOutPath, "utf8");
assert(markdown.includes("Strict ready: no"), "Rendered markdown packet should show fail-closed strict readiness.");
assert(markdown.includes("evidence_object_storage"), "Rendered markdown packet should include the fail-closed evidence object-store blocker.");
assert(markdown.includes("Launch Hold Conditions"), "Rendered markdown packet should include launch hold conditions.");
assert(markdown.includes("npm run deployment:preflight:assert"), "Rendered markdown packet should include deployment assert command.");
assertNoSecretValues(markdown, sensitiveValues);
pass("readiness packet accepts rendered env and does not leak secret values");
