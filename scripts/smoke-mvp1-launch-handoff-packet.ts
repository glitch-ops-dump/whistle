import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type HandoffPacket = {
  kind: "whistle-mvp1-launch-handoff-packet";
  sourceEnv: string;
  handoff: {
    activeBuild: "MVP1" | "MVP2" | "MVP3" | "MVP4";
    launchReadinessPercent: number;
    lanes: Array<{
      id: string;
      title: string;
      status: "blocked" | "needs_evidence" | "ready_for_review" | "signed_off";
      adminControls: Array<{ id: string; value: string }>;
      runtimeChecks: Array<{ observed: string; remediation: string }>;
      requiredEnv: string[];
      blockers: string[];
    }>;
    holdConditions: string[];
    safeHandlingRules: string[];
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function cli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/mvp1-launch-handoff-packet.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function assertNoSensitiveValues(text: string, values: string[]) {
  for (const value of values) {
    assert(!text.includes(value), `MVP1 launch handoff packet leaked sensitive value: ${value}`);
  }
}

const templateRun = cli(["--env-file", "ops/env/whistle-mvp1-staging.env.example"]);
assert(templateRun.status === 0, `Template handoff packet should generate. stderr: ${templateRun.stderr}`);
assert(templateRun.stdout.includes("# Whistle MVP1 Launch Handoff Packet"), "Markdown handoff packet should include the packet heading.");
assert(templateRun.stdout.includes("Data-backed lanes") === false, "Packet should be a delivery artifact, not only UI copy.");
assert(templateRun.stdout.includes("Platform and Postgres spine"), "Packet should include the Platform/Postgres lane.");
assert(templateRun.stdout.includes("Citizen OTP, notifications, and identity policy"), "Packet should include citizen verification lane.");
assert(templateRun.stdout.includes("Government ID provider/policy reference"), "Packet should include Government ID Admin policy control.");
assert(templateRun.stdout.includes("Launch Hold Conditions"), "Packet should include launch hold conditions.");
assert(templateRun.stdout.includes("Safe Handling Rules"), "Packet should include safe handling rules.");
assert(templateRun.stdout.includes("npm run mvp1:uat-signoff"), "Packet should include UAT sign-off checklist command.");
assert(templateRun.stdout.includes("WHISTLE_OTP_PROVIDER_API_KEY"), "Packet may name required env keys.");
assertNoSensitiveValues(templateRun.stdout, ["REPLACE_WITH", "REPLACE_WITH_OTP_PROVIDER_API_KEY", "REPLACE_WITH_ISO_RESTORE_DRILL_TIMESTAMP"]);
pass("MVP1 handoff packet renders redacted markdown from the staging env template");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "whistle-handoff-packet-"));
const renderedEnvPath = path.join(tempDir, "whistle-staging.env");
const markdownOutPath = path.join(tempDir, "handoff.md");
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
assert(jsonRun.status === 0, `Rendered JSON handoff packet should generate. stderr: ${jsonRun.stderr}`);
assertNoSensitiveValues(jsonRun.stdout, sensitiveValues);
const packet = JSON.parse(jsonRun.stdout) as HandoffPacket;
assert(packet.kind === "whistle-mvp1-launch-handoff-packet", "JSON packet should identify its kind.");
assert(packet.sourceEnv === "whistle-staging.env", "JSON packet should name only the env basename.");
assert(packet.handoff.activeBuild === "MVP1", "Handoff packet should remain scoped to MVP1.");
assert(packet.handoff.lanes.length >= 6, "Handoff packet should include all MVP1 owner lanes.");
assert(packet.handoff.lanes.some((lane) => lane.id === "platform-postgres" && lane.requiredEnv.includes("DATABASE_URL")), "Packet should include Platform/Postgres env ownership.");
assert(
  packet.handoff.lanes.some((lane) => lane.id === "citizen-verification-and-messaging" && lane.adminControls.some((control) => control.id === "identity-gov-id-policy-mode")),
  "Packet should include citizen identity-policy controls.",
);
assert(packet.handoff.holdConditions.some((condition) => condition.includes("critical Admin control")), "Packet should hold launch on pending critical Admin approvals.");
assert(packet.handoff.safeHandlingRules.some((rule) => rule.includes("raw secrets")), "Packet should preserve safe handling rules.");

const markdownRun = cli(["--env-file", renderedEnvPath, "--out", markdownOutPath]);
assert(markdownRun.status === 0, `Rendered markdown handoff packet should write to disk. stderr: ${markdownRun.stderr}`);
const markdown = await fs.readFile(markdownOutPath, "utf8");
assert(markdown.includes("Launch verdict:"), "Rendered markdown should include launch verdict.");
assert(markdown.includes("Runtime checks"), "Rendered markdown should include runtime checks.");
assert(markdown.includes("npm run deployment:packet"), "Rendered markdown should include deployment packet command.");
assertNoSensitiveValues(markdown, sensitiveValues);
pass("MVP1 handoff packet accepts rendered env evidence without leaking secrets");
