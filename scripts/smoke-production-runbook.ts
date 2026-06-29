import fs from "node:fs/promises";
import path from "node:path";
import { createDeploymentPreflightReport, deploymentPreflightRuntimeFromEnv } from "../server/config/deploymentPreflight.js";

const runbookPath = path.resolve(process.cwd(), "docs/whistle-production-runbook.md");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

function checkById(report: ReturnType<typeof createDeploymentPreflightReport>, id: string) {
  const item = report.checks.find((check) => check.id === id);
  assert(item, `Expected deployment preflight check ${id}.`);
  return item;
}

const runbook = await fs.readFile(runbookPath, "utf8");
const requiredPhrases = [
  "# Whistle Production Runbook",
  "Runbook version:",
  "secure ticket spine",
  "neutral-or-approved asset decisions",
  "Required Preflight",
  "For staging or production profile startup",
  "WHISTLE_DEPLOYMENT_RUNBOOK_VERSION",
  "WHISTLE_BACKUP_RESTORE_DRILL_AT",
  "local MVP1 UAT",
  "npm run mvp1:uat-preflight",
  "npm run mvp1:uat-token",
  "npm run mvp1:uat-run",
  "npm run mvp1:defect-register",
  "browser-local bearer tokens",
  "npm run api:dev:mvp1-uat",
  "ops/env/whistle-mvp1-local-uat.env.example",
  "hidden mock OTP responses",
  "Admin console records external provider configuration references",
  "Raw API keys, passwords, OTP values, private keys, object-store credentials, rate-limit salts, and restore-drill timestamps must stay in the approved secret manager",
  "Provider configuration references in Admin must be controlled internal references",
  "secret-manager://whistle/mvp1/official-oidc-mfa/<ref-id>",
  "secret-manager://whistle/mvp1/citizen-otp-provider/<ref-id>",
  "secret-manager://whistle/mvp1/evidence-storage-kms-scanner/<ref-id>",
  "provider-contract://whistle/mvp1/notification-provider/<contract-id>",
  "secret-manager://whistle/mvp1/rate-limit-provider/<ref-id>",
  "ops://whistle/mvp1/observability-siem-telemetry/<ref-id>",
  "Provider readiness flags do not clear MVP1 launch readiness unless the matching controlled reference is also present",
  "Admin console also exposes the MVP1 launch handoff for provider, UAT, and ops teams",
  "Platform/Postgres, Identity, Citizen verification, Evidence/security, Observability/incident, and Operator UAT lanes",
  "matching Admin controls, runtime checks, required env keys, smoke commands, evidence needed, blockers, and launch hold conditions",
  "npm run mvp1:handoff-packet",
  "artifacts/whistle-mvp1-launch-handoff.md",
  "cross-team launch review",
  "Launch evidence references in Admin must use controlled internal references",
  "artifact://whistle/mvp1/postgres-migration/<run-id>",
  "artifact://whistle/mvp1/postgres-mvp-check/<run-id>",
  "artifact://whistle/mvp1/rehearsal-packet/<run-id>",
  "artifact://whistle/mvp1/restore-drill/<run-id>",
  "artifact://whistle/mvp1/siem-worm-export/<run-id>",
  "Raw URLs, local file paths, data URLs, database URLs, or informal notes are not valid launch evidence references",
  "Admin sign-off checkboxes do not clear readiness unless the matching reference passes this format gate",
  "Citizen identity policy is also controlled in Admin",
  "MVP1 defaults to phone OTP only",
  "Aadhaar/Government ID for selected categories",
  "Admin console also records MVP1 operator UAT and SOP sign-off",
  "rehearsal evidence reference",
  "artifact://whistle/mvp1/defect-register/<run-id>",
  "record open Blocker/Critical/Major/Minor defect counts",
  "Operator UAT cannot pass with any open Blocker or Critical defect",
  "citizen lifecycle rehearsal, verification SOP/training, role-dashboard rehearsal, protected-track SOP, and MVP1 defect-triage acceptance",
  "Deployment and incident readiness is also split into separate Admin sign-offs",
  "Restore drill evidence, SIEM/WORM export evidence, telemetry launch watch, browser origin allowlist, and incident hold conditions must each be backed by controlled references",
  "artifact://whistle/mvp1/telemetry-launch-watch/<run-id>",
  "artifact://whistle/mvp1/origin-allowlist/<run-id>",
  "artifact://whistle/mvp1/incident-hold-policy/<run-id>",
  "docs/mvp1-deployment-decisions.md",
  "staging/prod origins, target hosting/runtime, Postgres environment, restore-drill owner/date, and incident hold rules",
  "Provider Configuration",
  "WHISTLE_PROTOTYPE_OFFICIAL_AUTH=false",
  "WHISTLE_OFFICIAL_OIDC_JWKS_URL",
  "local smoke tests only",
  "disable prototype government headers at runtime",
  "WHISTLE_WORKER_SHARED_SECRET",
  "WHISTLE_OTP_PROVIDER_MODE=webhook",
  "disable mock OTP delivery at runtime",
  "WHISTLE_EVIDENCE_OBJECT_STORE_MODE=s3-compatible",
  "disable local/mock evidence object storage at runtime",
  "WHISTLE_NOTIFICATION_PROVIDER_MODE=webhook",
  "Citizen government ID policy mode",
  "disable mock notification delivery at runtime",
  "WHISTLE_RATE_LIMIT_BACKEND=gateway",
  "WHISTLE_RATE_LIMIT_KEY_SALT",
  "disable local/in-memory public rate limiting at runtime",
  "WHISTLE_SECURITY_EXPORT_MODE=webhook",
  "disable local security/audit export at runtime",
  "WHISTLE_TELEMETRY_EXPORT_MODE=otlp-http",
  "WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT",
  "disable local telemetry export at runtime",
  "Sanitized request spans and metrics snapshots export",
  "MVP1 Production-Security Handoff",
  "approved deployment secret manager",
  "Platform/Postgres owner",
  "Attach controlled Admin evidence references for Postgres migration output and the Postgres-backed MVP check",
  "Link the Platform/Postgres lane to the same restore-drill packet used by deployment sign-off",
  "Identity owner",
  "Worker owner",
  "Citizen verification and notification owners",
  "Evidence/security owner",
  "Network/performance owner",
  "Observability/operations owner",
  "all-green staging and production env contract fixture",
  "ops/env/whistle-mvp1-staging.env.example",
  "placeholder-value guard",
  "REPLACE_WITH_*",
  "npm run deployment:preflight:assert",
  "npm run deployment:packet",
  "npm run mvp1:rehearsal-packet",
  "MVP1 launch rehearsal packet",
  "role-specific UAT checklist",
  "MVP1 defect triage policy",
  "Blocker defects are launch holds and cannot be deferred",
  "hidden MVP2-MVP4 feature expansion",
  "redacted evidence artifact",
  "assertProductionDeploymentPreflight",
  "Deployment Steps",
  "Rollback Steps",
  "Backup And Restore Drill",
  "SIEM And Audit Export",
  "Incident Response",
  "Post-Deployment Watch",
  "Launch Hold Conditions",
  "Protected categories must stay pilot-only or disabled",
  "neutral MVP1 placeholder assets",
  "no older than",
];

for (const phrase of requiredPhrases) {
  assert(runbook.includes(phrase), `Production runbook is missing required phrase: ${phrase}`);
}

assert(!runbook.includes("TODO"), "Production runbook should not contain TODO placeholders.");
pass("production runbook covers preflight, providers, deploy, rollback, backup, SIEM, incident, and launch hold controls");

const missingEvidenceEnv = {
  WHISTLE_DEPLOYMENT_PROFILE: "production",
  WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED: "true",
  WHISTLE_BACKUP_RESTORE_DRILL_APPROVED: "true",
} satisfies Record<string, string | undefined>;
const missingEvidenceReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(missingEvidenceEnv), missingEvidenceEnv);
const missingEvidenceCheck = checkById(missingEvidenceReport, "deployment_backup_runbook");
assert(missingEvidenceCheck.status === "blocker", "Runbook preflight should still block when version and restore timestamp are missing.");
assert(missingEvidenceCheck.observed.includes("version=missing"), "Runbook preflight should name missing runbook version.");
assert(missingEvidenceCheck.observed.includes("backupDrillAt=missing"), "Runbook preflight should name missing restore drill timestamp.");

const freshRestoreDrillAt = new Date().toISOString();
const completeEvidenceEnv = {
  WHISTLE_DEPLOYMENT_PROFILE: "production",
  WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED: "true",
  WHISTLE_DEPLOYMENT_RUNBOOK_VERSION: "mvp1-ops-2026-06-01",
  WHISTLE_BACKUP_RESTORE_DRILL_APPROVED: "true",
  WHISTLE_BACKUP_RESTORE_DRILL_AT: freshRestoreDrillAt,
} satisfies Record<string, string | undefined>;
const completeEvidenceReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(completeEvidenceEnv), completeEvidenceEnv);
const completeEvidenceCheck = checkById(completeEvidenceReport, "deployment_backup_runbook");
assert(completeEvidenceCheck.status === "pass", "Runbook preflight should pass only when approval, version, drill approval, and ISO drill timestamp are all present.");
assert(
  completeEvidenceCheck.observed.includes("version=mvp1-ops-2026-06-01") &&
    completeEvidenceCheck.observed.includes(`backupDrillAt=${freshRestoreDrillAt}`) &&
    completeEvidenceCheck.observed.includes("freshness=current"),
  "Runbook preflight should preserve version and fresh restore timestamp evidence.",
);

const staleEvidenceEnv = {
  WHISTLE_DEPLOYMENT_PROFILE: "production",
  WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED: "true",
  WHISTLE_DEPLOYMENT_RUNBOOK_VERSION: "mvp1-ops-2026-06-01",
  WHISTLE_BACKUP_RESTORE_DRILL_APPROVED: "true",
  WHISTLE_BACKUP_RESTORE_DRILL_AT: "2000-01-01T00:00:00.000Z",
} satisfies Record<string, string | undefined>;
const staleEvidenceCheck = checkById(createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(staleEvidenceEnv), staleEvidenceEnv), "deployment_backup_runbook");
assert(staleEvidenceCheck.status === "blocker", "Runbook preflight should block stale restore-drill evidence.");
assert(staleEvidenceCheck.observed.includes("freshness=stale"), "Runbook preflight should name stale restore-drill evidence.");
pass("deployment preflight requires concrete runbook version and fresh restore-drill evidence");
