import type { AccessSnapshot } from "../access/types.js";
import type { DeploymentPreflightReport } from "./deploymentPreflight.js";
import { launchEvidenceReferenceIssue } from "./evidenceReferences.js";
import { createLaunchReadinessReport } from "./launchReadiness.js";
import { createMvpScopeReport } from "./mvpScope.js";
import type {
  AdminConfigSnapshot,
  AppControlConfig,
  ConfigChangeRequest,
  Mvp1LaunchHandoffLane,
  Mvp1LaunchHandoffLaneStatus,
  Mvp1LaunchHandoffReport,
  MvpLaunchWorkstreamOwner,
} from "./types.js";
import { providerReferenceIssueForControl, providerReferenceKindForControl } from "./providerReferences.js";

type LaneSpec = {
  id: string;
  owner: MvpLaunchWorkstreamOwner | "platform" | "identity" | "observability";
  title: string;
  purpose: string;
  controlIds: string[];
  runtimeCheckIds: string[];
  requiredEnv: string[];
  commands: string[];
  nextActions: string[];
  evidenceNeeded: string[];
};

const laneSpecs: LaneSpec[] = [
  {
    id: "platform-postgres",
    owner: "platform",
    title: "Platform and Postgres spine",
    purpose: "Run the secure ticket spine on durable Postgres with migrations, backup, restore, and shared public-rate buckets.",
    controlIds: [
      "platform-postgres-migration-evidence-ref",
      "platform-postgres-mvp-check-evidence-ref",
      "ops-restore-drill-evidence-ref",
      "infra-rate-limit-config-ref",
      "infra-distributed-rate-limit-ready",
    ],
    runtimeCheckIds: ["database_persistence", "distributed_rate_limits", "rate_limit_bucket_salt"],
    requiredEnv: ["DATABASE_URL", "WHISTLE_RATE_LIMIT_BACKEND", "WHISTLE_RATE_LIMIT_KEY_SALT"],
    commands: [
      "DATABASE_URL=<target-postgres> npm run db:migrate",
      "DATABASE_URL=<target-postgres> npm run mvp:check:postgres",
      "npm run mvp1:uat-preflight",
    ],
    nextActions: ["Provision target Postgres.", "Run migrations.", "Attach migration, Postgres MVP check, and backup/restore evidence before launch approval."],
    evidenceNeeded: ["Controlled migration output artifact", "Postgres-backed MVP check artifact", "Backup/restore drill packet"],
  },
  {
    id: "identity-and-worker-auth",
    owner: "identity",
    title: "Official identity and worker auth",
    purpose: "Approve the government-console identity model and require service authentication for all worker jobs.",
    controlIds: ["infra-official-oidc-config-ref", "infra-official-oidc-mfa-ready", "infra-worker-auth-config-ref", "infra-worker-auth-ready"],
    runtimeCheckIds: ["official_identity_provider", "official_oidc_signing_source", "worker_job_authentication"],
    requiredEnv: [
      "WHISTLE_PROTOTYPE_OFFICIAL_AUTH",
      "WHISTLE_OFFICIAL_OIDC_ISSUER",
      "WHISTLE_OFFICIAL_OIDC_AUDIENCE",
      "WHISTLE_OFFICIAL_OIDC_JWKS_URL",
      "WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED",
      "WHISTLE_WORKER_AUTH_REQUIRED",
      "WHISTLE_WORKER_SHARED_SECRET",
    ],
    commands: ["npm run smoke:official-auth", "npm run smoke:worker-auth", "npm run deployment:preflight:assert -- --env-file <rendered-env>"],
    nextActions: ["Approve mobile/password plus OTP policy or attach SSO metadata.", "Confirm OTP/MFA assurance policy.", "Configure worker token in the approved runtime."],
    evidenceNeeded: ["Identity policy or OIDC issuer/audience/JWKS reference", "OTP/MFA assurance proof", "Worker runtime secret-manager reference"],
  },
  {
    id: "citizen-verification-and-messaging",
    owner: "external_provider",
    title: "Citizen OTP, notifications, and identity policy",
    purpose: "Keep MVP1 phone-OTP-first while wiring approved OTP/SMS and status-update providers without leaking citizen data.",
    controlIds: [
      "citizen-phone-otp-required",
      "identity-gov-id-policy-mode",
      "identity-gov-id-required-categories",
      "identity-gov-id-provider-config-ref",
      "infra-citizen-otp-config-ref",
      "infra-citizen-otp-provider-ready",
      "infra-notification-provider-config-ref",
      "infra-notification-provider-ready",
    ],
    runtimeCheckIds: ["citizen_otp_provider", "mock_otp_exposure", "notification_delivery_provider"],
    requiredEnv: [
      "WHISTLE_OTP_PROVIDER_MODE",
      "WHISTLE_OTP_PROVIDER_WEBHOOK_URL",
      "WHISTLE_OTP_PROVIDER_API_KEY",
      "WHISTLE_EXPOSE_MOCK_OTP",
      "WHISTLE_NOTIFICATION_PROVIDER_MODE",
      "WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL",
      "WHISTLE_NOTIFICATION_PROVIDER_API_KEY",
    ],
    commands: ["npm run smoke:otp-delivery", "npm run smoke:notification-provider", "npm run smoke:notification-templates"],
    nextActions: ["Attach OTP/SMS provider reference.", "Attach notification provider reference.", "Keep Government ID disabled unless policy-approved."],
    evidenceNeeded: ["Provider contract/reference", "Delivery receipt test", "Citizen-safe Tamil/English copy approval"],
  },
  {
    id: "evidence-and-protected-security",
    owner: "security_legal",
    title: "Evidence, KMS, scanner, and protected handling",
    purpose: "Protect citizen evidence and corruption/protected reports with private storage, KMS, malware scanning, and SOP sign-off.",
    controlIds: ["infra-evidence-storage-config-ref", "infra-evidence-storage-ready", "uat-protected-track-sop-approved"],
    runtimeCheckIds: ["evidence_object_storage", "evidence_scanning_kms"],
    requiredEnv: [
      "WHISTLE_EVIDENCE_OBJECT_STORE_MODE",
      "WHISTLE_EVIDENCE_S3_ENDPOINT",
      "WHISTLE_EVIDENCE_S3_BUCKET",
      "WHISTLE_EVIDENCE_S3_REGION",
      "WHISTLE_EVIDENCE_KMS_KEY_ID",
      "WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED",
      "WHISTLE_EVIDENCE_DATA_RESIDENCY",
    ],
    commands: ["npm run smoke:evidence-object-store", "npm run smoke:lifecycle", "npm run smoke:security-export"],
    nextActions: ["Attach storage/KMS/scanner reference.", "Approve protected-track SOP.", "Verify sensitive audit access reasons."],
    evidenceNeeded: ["KMS key reference", "Scanner approval", "Protected-track SOP approval"],
  },
  {
    id: "observability-and-incident",
    owner: "observability",
    title: "Observability, SIEM/WORM, and incident holds",
    purpose: "Prove launch watch, immutable audit export, CORS origins, security headers, and explicit incident hold rules.",
    controlIds: [
      "infra-deployment-observability-config-ref",
      "infra-deployment-runbook-ready",
      "ops-restore-drill-evidence-ref",
      "ops-restore-drill-signed-off",
      "ops-siem-worm-evidence-ref",
      "ops-siem-worm-signed-off",
      "ops-telemetry-launch-watch-evidence-ref",
      "ops-telemetry-launch-watch-signed-off",
      "ops-origin-allowlist-evidence-ref",
      "ops-origin-allowlist-signed-off",
      "ops-incident-hold-policy-evidence-ref",
      "ops-incident-hold-policy-signed-off",
    ],
    runtimeCheckIds: ["cors_origin_allowlist", "api_security_headers", "deployment_secret_material", "deployment_backup_runbook", "siem_audit_export", "otel_metrics_export"],
    requiredEnv: [
      "WHISTLE_ALLOWED_ORIGINS",
      "WHISTLE_SECURITY_HEADERS_ENABLED",
      "WHISTLE_SECURITY_EXPORT_MODE",
      "WHISTLE_SECURITY_EXPORT_WEBHOOK_URL",
      "WHISTLE_SECURITY_EXPORT_API_KEY",
      "WHISTLE_TELEMETRY_EXPORT_MODE",
      "WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT",
      "WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED",
      "WHISTLE_DEPLOYMENT_RUNBOOK_VERSION",
      "WHISTLE_BACKUP_RESTORE_DRILL_APPROVED",
      "WHISTLE_BACKUP_RESTORE_DRILL_AT",
    ],
    commands: ["npm run smoke:metrics", "npm run smoke:telemetry-export", "npm run smoke:production-runbook", "npm run deployment:packet -- --env-file <rendered-env>"],
    nextActions: ["Attach restore drill evidence.", "Attach SIEM/WORM export proof.", "Approve launch hold conditions."],
    evidenceNeeded: ["Restore drill packet", "SIEM/WORM export proof", "Telemetry launch watch proof", "Origin allowlist proof", "Incident hold policy"],
  },
  {
    id: "operator-uat",
    owner: "uat_ops",
    title: "Operator UAT and SOP sign-off",
    purpose: "Run role-specific MVP1 rehearsal without expanding MVP2-MVP4 scope.",
    controlIds: [
      "uat-launch-rehearsal-evidence-ref",
      "uat-citizen-lifecycle-rehearsed",
      "uat-verification-sop-approved",
      "uat-role-dashboard-rehearsed",
      "uat-protected-track-sop-approved",
      "uat-defect-register-ref",
      "uat-open-blocker-defects",
      "uat-open-critical-defects",
      "uat-open-major-defects",
      "uat-open-minor-defects",
      "uat-defect-triage-ready",
    ],
    runtimeCheckIds: [],
    requiredEnv: [],
    commands: [
      "npm run mvp1:rehearsal-packet -- --out artifacts/whistle-mvp1-launch-rehearsal.md",
      "npm run mvp1:uat-seed -- --json --quiet --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.json",
      "npm run mvp1:uat-run -- --run-id <run-id> --seed-file artifacts/whistle-mvp1-local-uat-seed.json --out artifacts/whistle-mvp1-local-uat-run.md",
      "npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md",
      "npm run mvp1:uat-signoff -- --run-id <run-id> --out artifacts/whistle-mvp1-uat-signoff.md",
      "npm run mvp:check",
    ],
    nextActions: ["Run citizen lifecycle rehearsal.", "Run role dashboard rehearsal and automated role assertions.", "Attach signed UAT checklist, defect register, and clear blocker/critical defects."],
    evidenceNeeded: ["Rehearsal packet reference", "Local role assertion artifact", "Signed UAT checklist", "Defect register reference with zero blocker/critical defects"],
  },
];

function isPendingReference(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return true;
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("pending-") || normalized.startsWith("not-enabled");
}

function redactedControlValue(control: AppControlConfig | undefined) {
  if (!control) return "missing";
  if (typeof control.value === "boolean") return control.value ? "true" : "false";
  if (typeof control.value === "number") return String(control.value);
  const value = control.value.trim();
  if (!value) return "empty";
  if (value.startsWith("pending-") || value.startsWith("not-enabled")) return value;
  if (/^(artifact|secret-manager|ops|runbook|siem|policy):\/\//.test(value)) return value;
  if (control.id.includes("config-ref") || control.id.includes("evidence-ref")) return "set-redacted";
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function controlReady(control: AppControlConfig | undefined) {
  if (!control) return false;
  if (control.id === "platform-postgres-migration-evidence-ref") return launchEvidenceReferenceIssue(control.value, "postgres_migration") === null;
  if (control.id === "platform-postgres-mvp-check-evidence-ref") return launchEvidenceReferenceIssue(control.value, "postgres_mvp_check") === null;
  if (control.id === "uat-launch-rehearsal-evidence-ref") return launchEvidenceReferenceIssue(control.value, "uat_rehearsal") === null;
  if (control.id === "uat-defect-register-ref") return launchEvidenceReferenceIssue(control.value, "uat_defect_register") === null;
  if (control.id === "uat-open-blocker-defects" || control.id === "uat-open-critical-defects") return control.value === 0;
  if (control.id === "uat-open-major-defects" || control.id === "uat-open-minor-defects") return typeof control.value === "number";
  if (control.id === "ops-restore-drill-evidence-ref") return launchEvidenceReferenceIssue(control.value, "restore_drill") === null;
  if (control.id === "ops-siem-worm-evidence-ref") return launchEvidenceReferenceIssue(control.value, "siem_worm") === null;
  if (control.id === "ops-telemetry-launch-watch-evidence-ref") return launchEvidenceReferenceIssue(control.value, "telemetry_watch") === null;
  if (control.id === "ops-origin-allowlist-evidence-ref") return launchEvidenceReferenceIssue(control.value, "origin_allowlist") === null;
  if (control.id === "ops-incident-hold-policy-evidence-ref") return launchEvidenceReferenceIssue(control.value, "incident_hold") === null;
  if (providerReferenceKindForControl(control.id) && control.id !== "identity-gov-id-provider-config-ref") {
    return providerReferenceIssueForControl(control.id, control.value, control.name) === null;
  }
  if (control.valueType === "boolean") return control.value === true || !control.critical;
  if (control.id === "identity-gov-id-provider-config-ref") return true;
  return !isPendingReference(control.value);
}

function laneStatus(blockers: string[], controls: Mvp1LaunchHandoffLane["adminControls"], runtimeChecks: Mvp1LaunchHandoffLane["runtimeChecks"]): Mvp1LaunchHandoffLaneStatus {
  if (runtimeChecks.some((check) => check.status === "blocker")) return "blocked";
  if (blockers.length) return "needs_evidence";
  if (runtimeChecks.some((check) => check.status === "warning")) return "ready_for_review";
  if (controls.every((control) => control.ready)) return "signed_off";
  return "ready_for_review";
}

export function createMvp1LaunchHandoffReport(
  config: AdminConfigSnapshot,
  access: AccessSnapshot,
  changeRequests: ConfigChangeRequest[],
  deploymentPreflight: DeploymentPreflightReport,
): Mvp1LaunchHandoffReport {
  const mvpScope = createMvpScopeReport(config, access, changeRequests, deploymentPreflight);
  const launchReadiness = createLaunchReadinessReport(config, access, changeRequests, deploymentPreflight);
  const controlsById = new Map(config.appControls.map((control) => [control.id, control]));
  const checksById = new Map(deploymentPreflight.checks.map((check) => [check.id, check]));
  const lanes = laneSpecs.map((spec): Mvp1LaunchHandoffLane => {
    const adminControls = spec.controlIds.map((id) => {
      const control = controlsById.get(id);
      return {
        id,
        name: control?.name ?? id,
        value: redactedControlValue(control),
        critical: control?.critical ?? false,
        ready: controlReady(control),
      };
    });
    const runtimeChecks = spec.runtimeCheckIds.flatMap((id) => {
      const check = checksById.get(id);
      if (!check) return [];
      return [{
        id: check.id,
        label: check.label,
        status: check.status,
        observed: check.observed,
        remediation: check.remediation,
      }];
    });
    const blockers = [
      ...adminControls
        .filter((control) => !control.ready)
        .map((control) => `${control.name} is pending.`),
      ...runtimeChecks
        .filter((check) => check.status === "blocker")
        .map((check) => `${check.label}: ${check.observed}`),
    ];
    return {
      id: spec.id,
      owner: spec.owner,
      title: spec.title,
      purpose: spec.purpose,
      status: laneStatus(blockers, adminControls, runtimeChecks),
      adminControls,
      runtimeChecks,
      requiredEnv: spec.requiredEnv,
      commands: spec.commands,
      blockers,
      nextActions: spec.nextActions,
      evidenceNeeded: spec.evidenceNeeded,
    };
  });

  return {
    kind: "whistle-mvp1-launch-handoff",
    generatedAt: new Date().toISOString(),
    source: "admin_config_access_and_deployment_preflight",
    activeBuild: mvpScope.activeBuild,
    implementationPercent: mvpScope.phases.find((phase) => phase.id === "MVP1")?.implementationPercent ?? 0,
    launchReadinessPercent: mvpScope.phases.find((phase) => phase.id === "MVP1")?.launchReadinessPercent ?? 0,
    launchVerdict: launchReadiness.verdict,
    launchScore: launchReadiness.score,
    lanes,
    commands: [
      "npm run mvp:check",
      "DATABASE_URL=<target-postgres> npm run mvp:check:postgres",
      "npm run deployment:preflight:assert -- --env-file <rendered-env>",
      "npm run deployment:packet -- --env-file <rendered-env> --out artifacts/whistle-mvp1-readiness-packet.md",
      "npm run mvp1:rehearsal-packet -- --out artifacts/whistle-mvp1-launch-rehearsal.md",
      "npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md",
      "npm run mvp1:uat-signoff -- --run-id <run-id> --out artifacts/whistle-mvp1-uat-signoff.md",
    ],
    holdConditions: [
      "Any lane has a blocker.",
      "Any production preflight blocker exists.",
      "Any critical Admin control is pending second-Admin approval.",
      "Any protected identity, raw evidence, raw phone, API key, token, salt, or restore timestamp appears in a shared packet.",
      "Operator UAT has not signed citizen lifecycle, verification SOP, role dashboard, protected-track SOP, and defect triage.",
      "Any blocker or critical UAT defect remains open in the defect register.",
    ],
    safeHandlingRules: [
      "Keep raw secrets in the approved secret manager and rendered env only.",
      "Share artifact references, provider references, and redacted readiness packets in Admin.",
      "Do not make Admin sign-offs override runtime deployment preflight.",
      "Keep MVP1 phone-OTP-only unless a future Government ID category policy has legal approval and provider reference.",
    ],
  };
}
