import type { AccessSnapshot, AccessRole } from "../access/types.js";
import type { DeploymentPreflightReport } from "./deploymentPreflight.js";
import { launchEvidenceReferenceIssue } from "./evidenceReferences.js";
import { isCriticalConfigChange } from "./governance.js";
import { createLaunchReadinessReport } from "./launchReadiness.js";
import { mvp1ProviderReferenceControlIds, providerReferenceIssueForControl } from "./providerReferences.js";
import type {
  AdminConfigSnapshot,
  ConfigChangeRequest,
  MvpPhaseScope,
  MvpPhaseStatus,
  MvpLaunchWorkstream,
  MvpScopeItem,
  MvpScopeReport,
} from "./types.js";

const mvpOrder = ["MVP1", "MVP2", "MVP3", "MVP4"] as const;
const productionSeamControls = [
  "infra-official-oidc-mfa-ready",
  "infra-worker-auth-ready",
  "infra-citizen-otp-provider-ready",
  "infra-evidence-storage-ready",
  "infra-notification-provider-ready",
  "infra-distributed-rate-limit-ready",
  "infra-deployment-runbook-ready",
];
const operatorUatControls = [
  "uat-citizen-lifecycle-rehearsed",
  "uat-verification-sop-approved",
  "uat-role-dashboard-rehearsed",
  "uat-protected-track-sop-approved",
  "uat-defect-triage-ready",
];
const deploymentOpsControls = [
  "ops-restore-drill-signed-off",
  "ops-siem-worm-signed-off",
  "ops-telemetry-launch-watch-signed-off",
  "ops-origin-allowlist-signed-off",
  "ops-incident-hold-policy-signed-off",
];
const platformPostgresEvidenceControls = [
  ["platform-postgres-migration-evidence-ref", "postgres_migration", "Postgres migration evidence reference"],
  ["platform-postgres-mvp-check-evidence-ref", "postgres_mvp_check", "Postgres MVP check evidence reference"],
] as const;

function controlEnabled(config: AdminConfigSnapshot, id: string) {
  return config.appControls.find((control) => control.id === id)?.value === true;
}

function scoreItem(status: MvpPhaseStatus) {
  if (status === "done") return 100;
  if (status === "partial") return 55;
  if (status === "blocked") return 15;
  return 0;
}

function phaseStatus(items: MvpScopeItem[]): MvpPhaseStatus {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (items.every((item) => item.status === "done")) return "done";
  if (items.some((item) => item.status === "done" || item.status === "partial")) return "partial";
  return "not_started";
}

function phaseImplementation(items: MvpScopeItem[]) {
  return Math.round(items.reduce((total, item) => total + scoreItem(item.status), 0) / Math.max(1, items.length));
}

function hasActiveGrant(access: AccessSnapshot, role: AccessRole, action?: string) {
  return access.grants.some((grant) => {
    const active = !grant.expiresAt || new Date(grant.expiresAt).getTime() > Date.now();
    return active && grant.role === role && (!action || grant.actions.includes(action));
  });
}

function allCoreRolesConfigured(access: AccessSnapshot) {
  const roles: AccessRole[] = ["admin", "cm_cell", "verification", "minister", "mla"];
  return roles.every((role) => hasActiveGrant(access, role));
}

function enabledReadyCategories(config: AdminConfigSnapshot) {
  const readinessByCategory = new Map(config.readiness.map((item) => [item.categoryId, item]));
  return config.categories.filter((category) => {
    const readiness = readinessByCategory.get(category.id);
    return category.enabled && readiness?.launchState === "ready" && readiness.sopStatus === "approved" && readiness.trainingStatus === "approved";
  });
}

function enabledProtectedCategories(config: AdminConfigSnapshot) {
  return config.categories.filter((category) => category.enabled && category.sensitivity === "protected");
}

function productionSeamGaps(config: AdminConfigSnapshot, deploymentPreflight?: DeploymentPreflightReport) {
  const adminControlGaps = productionSeamControls
    .filter((id) => !controlEnabled(config, id))
    .map((id) => `${config.appControls.find((control) => control.id === id)?.name ?? id} is not production-ready.`);
  const providerReferenceGaps = mvp1ProviderReferenceControlIds
    .map((id) => providerReferenceIssueForControl(id, config.appControls.find((control) => control.id === id)?.value, appControlName(config, id)))
    .filter((item): item is string => Boolean(item));
  const platformPostgresEvidenceGaps = platformPostgresEvidenceControls
    .map(([id, kind, label]) => launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === id)?.value, kind, label))
    .filter((item): item is string => Boolean(item));
  const citizenIdentityPolicyMode = String(config.appControls.find((control) => control.id === "identity-gov-id-policy-mode")?.value ?? "phone-otp-only");
  const citizenIdentityRequiredCategories = String(config.appControls.find((control) => control.id === "identity-gov-id-required-categories")?.value ?? "none");
  const citizenGovIdPolicyIssue =
    citizenIdentityPolicyMode !== "phone-otp-only" && citizenIdentityRequiredCategories.trim().toLowerCase() !== "none"
      ? providerReferenceIssueForControl(
          "identity-gov-id-provider-config-ref",
          config.appControls.find((control) => control.id === "identity-gov-id-provider-config-ref")?.value,
          "Government ID category policy provider/policy reference",
        )
      : null;
  const citizenGovIdPolicyGap = citizenGovIdPolicyIssue ? [citizenGovIdPolicyIssue] : [];
  const runtimeGaps =
    deploymentPreflight?.checks
      .filter((item) => item.status === "blocker")
      .map((item) => `Runtime preflight still blocks ${item.label}: ${item.observed}.`) ?? [];
  return [...adminControlGaps, ...providerReferenceGaps, ...platformPostgresEvidenceGaps, ...citizenGovIdPolicyGap, ...runtimeGaps];
}

function appControlName(config: AdminConfigSnapshot, id: string) {
  return config.appControls.find((control) => control.id === id)?.name ?? id;
}

function appControlNumber(config: AdminConfigSnapshot, id: string) {
  const value = config.appControls.find((control) => control.id === id)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function blockerLabels(deploymentPreflight: DeploymentPreflightReport | undefined, ids: string[]) {
  return (
    deploymentPreflight?.checks
      .filter((item) => ids.includes(item.id) && item.status === "blocker")
      .map((item) => `${item.label}: ${item.observed}`) ?? []
  );
}

function allControlsEnabled(config: AdminConfigSnapshot, ids: string[]) {
  return ids.every((id) => controlEnabled(config, id));
}

function mvp1LaunchWorkstreams(
  config: AdminConfigSnapshot,
  access: AccessSnapshot,
  deploymentPreflight?: DeploymentPreflightReport,
): MvpLaunchWorkstream[] {
  const assetControlIds = ["asset-logo-approved", "asset-portrait-approved", "asset-tn-emblem-approved", "asset-public-disclaimer-approved"];
  const providerControlIds = [
    "infra-official-oidc-mfa-ready",
    "infra-worker-auth-ready",
    "infra-citizen-otp-provider-ready",
    "infra-evidence-storage-ready",
    "infra-notification-provider-ready",
    "infra-distributed-rate-limit-ready",
  ];
  const opsControlIds = ["infra-deployment-runbook-ready", ...deploymentOpsControls];
  const runtimeCoreIds = ["database_persistence"];
  const runtimeProviderIds = [
    "official_identity_provider",
    "official_oidc_signing_source",
    "worker_job_authentication",
    "citizen_otp_provider",
    "mock_otp_exposure",
    "evidence_object_storage",
    "evidence_scanning_kms",
    "notification_delivery_provider",
    "distributed_rate_limits",
    "rate_limit_bucket_salt",
  ];
  const runtimeOpsIds = ["cors_origin_allowlist", "api_security_headers", "deployment_secret_material", "deployment_backup_runbook", "siem_audit_export", "otel_metrics_export"];
  const assetBlockers = assetControlIds.filter((id) => !controlEnabled(config, id)).map((id) => `${appControlName(config, id)} is pending.`);
  const providerBlockers = [
    ...providerControlIds.filter((id) => !controlEnabled(config, id)).map((id) => `${appControlName(config, id)} is pending.`),
    ...mvp1ProviderReferenceControlIds
      .map((id) => providerReferenceIssueForControl(id, config.appControls.find((control) => control.id === id)?.value, appControlName(config, id)))
      .filter((item): item is string => Boolean(item)),
    ...blockerLabels(deploymentPreflight, runtimeProviderIds),
  ];
  const coreBlockers = [
    ...platformPostgresEvidenceControls
      .map(([id, kind, label]) => launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === id)?.value, kind, label))
      .filter((item): item is string => Boolean(item)),
    ...blockerLabels(deploymentPreflight, runtimeCoreIds),
  ];
  const opsBlockers = [
    ...opsControlIds.filter((id) => !controlEnabled(config, id)).map((id) => `${appControlName(config, id)} is pending.`),
    launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "ops-restore-drill-evidence-ref")?.value, "restore_drill"),
    launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "ops-siem-worm-evidence-ref")?.value, "siem_worm"),
    launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "ops-telemetry-launch-watch-evidence-ref")?.value, "telemetry_watch"),
    launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "ops-origin-allowlist-evidence-ref")?.value, "origin_allowlist"),
    launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "ops-incident-hold-policy-evidence-ref")?.value, "incident_hold"),
    ...blockerLabels(deploymentPreflight, runtimeOpsIds),
  ].filter((item): item is string => Boolean(item));
  const uatBlockers = [
    ...(!hasActiveGrant(access, "verification") ? ["Verification operator grant is missing."] : []),
    ...(!hasActiveGrant(access, "cm_cell") ? ["CM Cell operator grant is missing."] : []),
    ...(!hasActiveGrant(access, "minister") ? ["Minister operator grant is missing."] : []),
    ...(!hasActiveGrant(access, "mla") ? ["MLA operator grant is missing."] : []),
    ...operatorUatControls.filter((id) => !controlEnabled(config, id)).map((id) => `${appControlName(config, id)} is pending.`),
    launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "uat-launch-rehearsal-evidence-ref")?.value, "uat_rehearsal"),
    launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "uat-defect-register-ref")?.value, "uat_defect_register"),
    appControlNumber(config, "uat-open-blocker-defects") > 0 ? `${appControlNumber(config, "uat-open-blocker-defects")} blocker UAT defect(s) remain open.` : null,
    appControlNumber(config, "uat-open-critical-defects") > 0 ? `${appControlNumber(config, "uat-open-critical-defects")} critical UAT defect(s) remain open.` : null,
  ].filter((item): item is string => Boolean(item));
  const uatSignoffDone =
    allControlsEnabled(config, operatorUatControls) &&
    !launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "uat-launch-rehearsal-evidence-ref")?.value, "uat_rehearsal") &&
    !launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "uat-defect-register-ref")?.value, "uat_defect_register") &&
    appControlNumber(config, "uat-open-blocker-defects") === 0 &&
    appControlNumber(config, "uat-open-critical-defects") === 0;
  return [
    {
      id: "mvp1-core-spine-hardening",
      phaseId: "MVP1",
      title: "Core ticket-spine hardening",
      owner: "engineering",
      status: coreBlockers.length ? "partial" : "done",
      parallelizable: true,
      summary: "Keep the citizen PWA, verification queue, SLA jobs, audit, and dashboards stable while replacing prototype runtime seams.",
      nextActions: [
        "Keep all runtime seams fail-closed for production and staging profiles.",
        "Run mvp:check and Postgres-backed checks after every MVP1 change.",
        "Do not add MVP2-MVP4 features until MVP1 launch gates are green.",
      ],
      blockers: coreBlockers,
      evidence: [
        "Ticket lifecycle, SLA escalation, role dashboards, worker jobs, audit, and Postgres persistence smoke tests are passing.",
        "Production/staging profiles already fail closed for official auth, OTP, evidence storage, notifications, and local public rate limits.",
        "The MVP1 local UAT harness exercises mobile/password account sessions, local official-token government access, worker-token jobs, Postgres persistence, and Postgres-backed rate limits without treating smoke providers as production-ready.",
        "Admin now tracks controlled migration-output and Postgres-backed MVP-check evidence references so platform proof is separate from raw DATABASE_URL or CI logs.",
      ],
    },
    {
      id: "mvp1-assets-and-public-identity",
      phaseId: "MVP1",
      title: "Asset and public identity approvals",
      owner: "government_ops",
      status: assetBlockers.length ? "blocked" : "done",
      parallelizable: true,
      summary: "Use Whistle-owned neutral placeholder assets unless official marks, portraits, or emblems are separately approved.",
      nextActions: [
        "Keep MVP1 public surfaces on the neutral Whistle placeholder logo, civic mark, and service illustration.",
        "Record any future move to official marks, portraits, or emblems through Admin critical config approvals.",
        "Do not reintroduce protected identity material without legal/public-use approval.",
      ],
      blockers: assetBlockers,
      evidence: ["MVP1 defaults use neutral Whistle-owned placeholder assets, so public launch is not blocked on protected marks or likenesses."],
    },
    {
      id: "mvp1-provider-and-scale-readiness",
      phaseId: "MVP1",
      title: "Provider and scale readiness",
      owner: "external_provider",
      status: providerBlockers.length ? "blocked" : "done",
      parallelizable: true,
      summary: "Approve the production mobile/password identity policy or mandated SSO path, plus worker auth, OTP/SMS, evidence storage/KMS/scanning, notifications, and distributed rate limits.",
      nextActions: [
        "Collect the approved identity decision, provider endpoints, credentials, KMS IDs, and rate-limit salt for staging.",
        "Set production-like environment variables and verify deployment preflight.",
        "Keep mock providers disabled for staging, pilot, UAT, and production profiles.",
      ],
      blockers: providerBlockers,
      evidence: [
        "Deployment preflight names each provider/runtime blocker and smoke tests prove configured provider seams pass readiness.",
        "The production runbook now gives parallel provider/security teams an exact MVP1 env handoff, and deployment-preflight smoke includes all-green staging and production contract fixtures.",
        "The repo includes a staging env template and preflight CLI so provider teams can validate rendered secret-manager envs without exposing secrets.",
        "The repo includes a local MVP1 UAT env harness for operator testing of real auth/rate-limit paths while preserving external launch gates.",
        "A redacted MVP1 readiness packet can be generated from a rendered env file for security, provider, and UAT review without printing secret values.",
        "Production and staging runtime profiles disable in-memory public rate limiting when a shared backend is not configured.",
        "Admin exposes concrete external-provider options and citizen identity-policy controls; MVP1 stays phone-OTP-only unless a future Government ID category policy has an approved provider/policy reference.",
      ],
    },
    {
      id: "mvp1-operator-uat-and-sop",
      phaseId: "MVP1",
      title: "Operator UAT and SOP sign-off",
      owner: "uat_ops",
      status: uatSignoffDone && !uatBlockers.length ? "done" : uatBlockers.length ? "partial" : "partial",
      parallelizable: true,
      summary: "Run launch rehearsal with Verification, MLA, Minister, CM Cell, and Admin operators against the MVP1 flows only.",
      nextActions: [
        "Run end-to-end UAT for submit, verify, request-info, route, escalate, reject-review, resolve, and citizen status tracking.",
        "Confirm operator SOP/training for verification and protected-track handling.",
        "Use the MVP1 launch rehearsal packet, local UAT role runner, sign-off checklist, and defect-register template to keep role-specific sign-off focused on MVP1 flows.",
        "Attach the MVP1 defect register and keep blocker/critical UAT defects at zero before sign-off.",
      ],
      blockers: uatBlockers,
      evidence: [
        "Core role grants exist in the default access snapshot; production identity approval and real operator accounts remain separate launch gates.",
        "MVP1 launch rehearsal packet maps citizen, verification, MLA, minister, CM Cell, Admin, and worker/security flows to redacted smoke evidence and operator sign-off.",
        "The local UAT role runner validates CM Cell, minister, department officer, MLA, councillor, verification, protected-read, and rejection-review assertions against a seeded run without printing bearer tokens.",
        "The MVP1 UAT sign-off checklist maps each role scenario to Admin controls, evidence references, owners, and pass criteria.",
        "The MVP1 defect-register generator produces a redacted template mapped to rehearsal scenarios, severity policy, Admin evidence controls, and zero blocker/critical launch rules.",
        "Admin launch controls now track rehearsal evidence, defect-register evidence, open defect counts, citizen lifecycle rehearsal, role-dashboard rehearsal, verification SOP, protected-track SOP, and MVP1 defect-triage acceptance.",
        "The rehearsal packet and Admin UAT panel define Blocker, Critical, Major, and Minor defect triage lanes so blocker/critical launch holds and MVP2-MVP4 deferrals are explicit.",
      ],
    },
    {
      id: "mvp1-deployment-and-incident-readiness",
      phaseId: "MVP1",
      title: "Deployment, backup, and incident readiness",
      owner: "security_legal",
      status: opsBlockers.length ? "blocked" : "done",
      parallelizable: true,
      summary: "Approve runbook evidence, fresh restore drill, SIEM/WORM export, CORS origins, and incident-response hold conditions.",
      nextActions: [
        "Run a restore drill against the production-like database and set the ISO timestamp.",
        "Configure SIEM/WORM webhook export and telemetry endpoint.",
        "Approve launch hold conditions for provider failure, SLA worker lag, and protected-track incidents.",
      ],
      blockers: opsBlockers,
      evidence: [
        "Production runbook smoke tests require runbook version and fresh restore-drill evidence before launch readiness can pass.",
        "Admin launch controls now track restore-drill evidence, SIEM/WORM export evidence, telemetry launch watch, origin allowlist, and incident hold policy as separate sign-offs.",
        "Deployment sign-offs require controlled evidence references for restore drill, SIEM/WORM, telemetry launch watch, origin allowlist, and incident hold policy.",
      ],
    },
  ];
}

function mvp1Items(config: AdminConfigSnapshot, access: AccessSnapshot, deploymentPreflight?: DeploymentPreflightReport): MvpScopeItem[] {
  const readyCategories = enabledReadyCategories(config);
  const allSlaStagesEnabled = ["verification", "local", "ministry", "cm_cell", "rejection_review"].every((stage) => {
    const policy = config.slaPolicies.find((item) => item.stage === stage);
    return Boolean(policy?.enabled && policy.durationDays > 0);
  });
  const protectedCategories = enabledProtectedCategories(config);
  const protectedReady =
    !protectedCategories.length ||
    (controlEnabled(config, "protected-bypass") &&
      access.grants.some((grant) => ["cm_cell", "verification"].includes(grant.role) && grant.protectedAccess));
  const assetsApproved = ["asset-logo-approved", "asset-portrait-approved", "asset-tn-emblem-approved", "asset-public-disclaimer-approved"].every((id) =>
    controlEnabled(config, id),
  );
  const productionGaps = productionSeamGaps(config, deploymentPreflight);
  const uatSignoffReady =
    allControlsEnabled(config, operatorUatControls) &&
    !launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "uat-launch-rehearsal-evidence-ref")?.value, "uat_rehearsal") &&
    !launchEvidenceReferenceIssue(config.appControls.find((control) => control.id === "uat-defect-register-ref")?.value, "uat_defect_register") &&
    appControlNumber(config, "uat-open-blocker-defects") === 0 &&
    appControlNumber(config, "uat-open-critical-defects") === 0;
  return [
    {
      id: "citizen-pwa",
      label: "Citizen PWA submission, OTP, tracking, SLA, and clarification loop",
      status: readyCategories.length ? "done" : "blocked",
      evidence: [
        "Citizen categories are generated from Admin readiness config.",
        "Admin maintenance mode pauses new public citizen intake while preserving existing ticket tracking.",
        "Phone OTP is required by default before ticket creation and My Tickets lookup.",
        "Ticket status, timeline, notifications, add-more-info, and dispute flows use the ticket spine.",
      ],
      gaps: readyCategories.length ? ["Production SMS/OTP provider is still a deployment decision."] : ["No launch-ready public category is enabled."],
    },
    {
      id: "verification-routing",
      label: "Verification intake with route, request-info, reject, and protected flagging",
      status: hasActiveGrant(access, "verification") ? "done" : "blocked",
      evidence: [
        "Verification role has governed access grants.",
        "Verification decisions are lifecycle-owned and idempotent.",
        "Rejected tickets enter CM-maintained rejection review.",
      ],
      gaps: ["Real verifier SOP and training sign-off remain operational tasks."],
    },
    {
      id: "role-dashboards",
      label: "Role-scoped MLA, Minister, CM Cell, and Admin views",
      status: allCoreRolesConfigured(access) ? "done" : "blocked",
      evidence: [
        "Access grants scope users by role, ministry, constituency, state, queue, and system configuration.",
        "Dashboards read governed projections and preserve primary/secondary queue visibility.",
        "Dashboard explanation endpoint supports count accountability for Admin.",
      ],
      gaps: allCoreRolesConfigured(access) ? ["Production must approve mobile/password operator identity with Admin-mandated OTP, or configure OIDC/MFA if government SSO policy requires it."] : ["One or more core launch roles has no active grant."],
    },
    {
      id: "sla-audit",
      label: "SLA ladder, escalation jobs, notification jobs, and append-only audit",
      status: allSlaStagesEnabled ? "done" : "blocked",
      evidence: [
        "Verification, local/MLA, ministry, CM Cell, and rejection-review SLA policies are configured.",
        "Escalation jobs preserve secondary visibility and write audit events.",
        "Notifications are queued with citizen-safe copy.",
      ],
      gaps: ["Production worker authentication and provider integration are still needed."],
    },
    {
      id: "protected-track",
      label: "Protected complaint compartmentalization and identity masking",
      status: protectedReady ? "partial" : "blocked",
      evidence: [
        "Protected categories bypass local routing.",
        "Local/MLA/ministry visibility is restricted for protected corruption cases.",
        "Sensitive evidence access is role-scoped and audited.",
        "Government access to protected ticket detail, evidence, audit, and notification logs requires an explicit access reason and writes sensitive audit events.",
      ],
      gaps: protectedReady
        ? ["Legal/vigilance SOP and break-glass operating policy still require formal approval before broad corruption launch."]
        : ["Protected categories are enabled without a valid bypass/operator setup."],
    },
    {
      id: "asset-identity-approval",
      label: "Asset, emblem, portrait, and public disclaimer approvals",
      status: assetsApproved ? "done" : "blocked",
      evidence: [
        "Admin controls explicitly track that MVP1 uses neutral placeholder logo, civic mark, portrait replacement, and disclaimer wording.",
        "Citizen and public transparency configuration expose only neutral Whistle-owned placeholder assets by default.",
      ],
      gaps: assetsApproved ? [] : ["Public launch must not proceed until protected marks and likenesses are approved or replaced with neutral assets."],
    },
    {
      id: "operator-uat-signoff",
      label: "MVP1 operator rehearsal, SOP sign-off, and defect-triage acceptance",
      status: uatSignoffReady ? "done" : "partial",
      evidence: [
        "Admin App Controls include critical sign-offs for citizen lifecycle rehearsal, verification SOP, role dashboards, protected-track SOP, defect triage, and rehearsal evidence reference.",
        "Each UAT sign-off is governed through second-Admin approval like other launch-gate controls.",
        "The local UAT role runner, sign-off checklist, and defect-register generator produce repeatable token-free evidence for role-scope assertions, operator approvals, and launch defect triage.",
        "MVP1 defect triage requires a controlled defect-register reference, zero open blocker/critical defects, and phase-tagged deferrals for non-blocking issues.",
      ],
      gaps: uatSignoffReady
        ? []
        : ["Operators still need to run the MVP1 rehearsal, attach rehearsal and defect-register evidence, approve SOP/training, clear blocker/critical defects, and accept the MVP1 defect-triage process."],
    },
    {
      id: "production-security",
      label: "Production auth, object storage, observability, backup, and deployment hardening",
      status: productionGaps.length ? "blocked" : "partial",
      evidence: [
        "Postgres-backed persistence, request correlation, request metrics, API readiness, and backup/restore drills exist.",
        "Production and staging runtime profiles fail closed for government APIs when official OIDC is not configured, even if the startup preflight path is bypassed.",
        "Production and staging runtime profiles disable mock citizen OTP delivery when an approved provider is not configured.",
        "Production and staging runtime profiles disable local/mock evidence object storage when S3-compatible storage is not configured.",
        "Deployment preflight treats HS256 OIDC secrets as local smoke-test only and requires HTTPS JWKS key rotation for staging/production government consoles.",
        "Evidence uses a governed upload-session seam with scan/metadata controls in the MVP.",
        "Production and staging runtime profiles disable mock notification delivery when an approved provider is not configured.",
        "Bounded SLA, evidence-scan, and notification worker jobs can be run through an authenticated worker runner.",
        "Public citizen endpoints support distributed gateway and Postgres-backed rate-limit seams with hashed bucket keys for high-volume launch.",
        "MVP1 local UAT preflight verifies mobile/password account sessions, local official-token auth, worker token auth, Postgres persistence, hidden mock OTP responses, and Postgres rate limits together while preserving external provider blockers.",
        "Deployment preflight blocks staging/production when public rate-limit bucket hashing lacks a deployment-specific secret salt.",
        "API responses emit baseline security headers and production/staging deployments require an explicit browser origin allowlist.",
        "Governance audit exports can deliver redacted packages and sanitized request logs to a SIEM/WORM webhook.",
        "Production and staging runtime profiles disable local SIEM/WORM export when an approved provider is not configured.",
        "Telemetry export can send sanitized request spans and metrics snapshots to an OpenTelemetry HTTP endpoint.",
        "Production and staging runtime profiles disable local telemetry export when an approved OpenTelemetry endpoint is not configured.",
        "Staging and production startup preflight fails when any deployment blocker remains, including missing Postgres persistence.",
        "Deployment-preflight smoke proves a complete real-provider env contract can make both staging and production preflight all green without weakening fail-closed defaults.",
        "Deployment preflight now blocks obvious copied-template, localhost, example, and smoke-test env values for staging/production.",
        "Deployment readiness packet smoke verifies redaction of database passwords, API keys, worker tokens, rate-limit salts, and restore-drill timestamps.",
        "Production runbook coverage is checked by smoke tests and deployment preflight requires runbook version plus fresh restore-drill timestamp evidence.",
        "Admin launch controls now track provider and deployment seams separately from ordinary feature toggles.",
        "Admin launch controls now require controlled artifact references for Postgres migration output and the Postgres-backed MVP check before production seams can pass.",
        "Direct ticket and ticket-notification reads enforce the same operational scope boundaries used by dashboards and evidence access.",
        "Verification audit and notification-outbox reads require ticket-scoped visibility; broad operational log pages are limited to Admin and CM Cell.",
      ],
      gaps: productionGaps.length ? productionGaps : ["Run production security/UAT sign-off before promoting beyond controlled pilot."],
    },
  ];
}

function mvp2Items(config: AdminConfigSnapshot): MvpScopeItem[] {
  return [
    {
      id: "public-transparency",
      label: "Aggregate public transparency portal and privacy thresholds",
      status: controlEnabled(config, "feature-public") ? "partial" : "blocked",
      evidence: [
        "Public insights API is aggregate-only and controlled by an Admin feature flag.",
        "Public insights apply a configurable publication delay and small-cell threshold before publishing aggregates.",
        "Transparency UI exists as a separate surface from operational dashboards.",
      ],
      gaps: ["Production reconciliation jobs and public communications copy are not final."],
    },
    {
      id: "recommend-only-intake",
      label: "Recommend-only agent runs for intake classification and missing-info detection",
      status: "partial",
      evidence: [
        "Agent runs produce advisory packets with reasons, confidence, privacy flags, and audit events.",
        "Agent runs cannot mutate lifecycle state.",
      ],
      gaps: ["External model/provider decision, evaluation harness, prompt governance, and human-review SOP remain open."],
    },
    {
      id: "cm-ministry-briefs",
      label: "Recommend-only CM and ministry SLA briefs",
      status: "partial",
      evidence: [
        "Dashboard brief endpoint creates scoped non-mutating recommendation summaries.",
        "Minister briefs are constrained to assigned ministry scope.",
      ],
      gaps: ["Production brief scheduling, approval workflow, and measured usefulness criteria remain pending."],
    },
    {
      id: "notification-channels",
      label: "SMS/WhatsApp/in-app template governance",
      status: "partial",
      evidence: [
        "Notification template controls and protected-category copy guardrails exist.",
        "Protected notifications avoid WhatsApp in the MVP template policy.",
      ],
      gaps: ["Approved SMS/WhatsApp providers, delivery receipts, opt-out policy, and language QA remain production tasks."],
    },
  ];
}

function mvp3Items(): MvpScopeItem[] {
  return [
    {
      id: "field-actions",
      label: "Field action workflow for visits, field reports, transfers, directives, and resolution",
      status: "partial",
      evidence: [
        "Field-action endpoint supports visit scheduling, reports, transfer-with-reason, directives, and closure checklist.",
        "Actions are role/scope checked and write audit plus citizen-safe notifications.",
      ],
      gaps: ["Dedicated Department Officer and Councillor workbenches are not full products yet."],
    },
    {
      id: "closure-quality",
      label: "Closure evidence, citizen reopen/dispute, and closure quality signals",
      status: "partial",
      evidence: [
        "Resolution requires closure-readiness checklist.",
        "Resolved tickets can be reopened/disputed by verified citizens and return to verification with oversight visibility.",
      ],
      gaps: ["Closure quality analytics, field photo policy, and dispute review SOP need productization."],
    },
    {
      id: "field-ops-consoles",
      label: "Department officer and local/councillor workbenches",
      status: "not_started",
      evidence: ["Field execution primitives exist in the API but are not yet packaged as separate daily workbench products."],
      gaps: ["Build focused workbench UIs for daily queue execution, owner assignment, workload balancing, and field visit management."],
    },
    {
      id: "integrations-offline",
      label: "Government integrations and low-connectivity field operations",
      status: "not_started",
      evidence: ["Architecture proposal reserves integrations and offline/field complexity for MVP3."],
      gaps: ["Existing grievance systems, department systems, offline sync rules, and data-sharing contracts are unresolved."],
    },
  ];
}

function mvp4Items(config: AdminConfigSnapshot, changeRequests: ConfigChangeRequest[]): MvpScopeItem[] {
  const pendingCritical = changeRequests.some((request) => request.status === "pending" && isCriticalConfigChange(config, request.target));
  return [
    {
      id: "advanced-governance",
      label: "Advanced governance, approvals, audit exports, and backup/restore evidence",
      status: "partial",
      evidence: [
        "Critical Admin changes require second-Admin approval.",
        "Governance audit export package and Postgres backup/restore drill exist in the MVP.",
      ],
      gaps: pendingCritical ? ["Pending critical approvals must be cleared before production governance sign-off."] : ["WORM storage/SIEM export and formal retention policy are still needed."],
    },
    {
      id: "strong-identity",
      label: "Approved OIDC/MFA, category-specific government ID, KMS, and protected workflow hardening",
      status: "not_started",
      evidence: ["Prototype role headers and mock citizen OTP are intentionally marked as MVP-only."],
      gaps: ["Government-approved identity provider, category-specific ID policy, KMS/HSM, and break-glass process are unresolved."],
    },
    {
      id: "data-warehouse-scale",
      label: "Data warehouse, long-term analytics, policy simulation, and multi-jurisdiction packs",
      status: "not_started",
      evidence: ["The V1 architecture keeps Postgres as source of truth and defers analytics warehouse to later phases."],
      gaps: ["Warehouse model, reconciliation, anonymization, simulation methodology, and reusable jurisdiction packs remain future work."],
    },
    {
      id: "multi-channel-native",
      label: "Native apps, kiosks, call-center assisted filing, and cross-system integrations",
      status: "not_started",
      evidence: ["Roadmap explicitly defers native apps, kiosks, call-center, and broad integrations until core workflow stabilizes."],
      gaps: ["Channel strategy, support operations, native wrappers, assisted filing workflows, and integration SLAs remain undefined."],
    },
  ];
}

function phase(
  input: Omit<MvpPhaseScope, "status" | "implementationPercent"> & { items: MvpScopeItem[] },
): MvpPhaseScope {
  return {
    ...input,
    status: phaseStatus(input.items),
    implementationPercent: phaseImplementation(input.items),
  };
}

export function createMvpScopeReport(
  config: AdminConfigSnapshot,
  access: AccessSnapshot,
  changeRequests: ConfigChangeRequest[],
  deploymentPreflight?: DeploymentPreflightReport,
): MvpScopeReport {
  const launchReadiness = createLaunchReadinessReport(config, access, changeRequests, deploymentPreflight);
  const mvp1ProductionReadiness =
    launchReadiness.verdict === "go" ? launchReadiness.score : launchReadiness.verdict === "conditional_go" ? Math.min(65, launchReadiness.score) : Math.min(35, launchReadiness.score);
  const mvp1 = phase({
    id: "MVP1",
    title: "Core accountability launch",
    purpose: "Prove that Whistle can receive, verify, route, escalate, audit, and explain tickets safely.",
    launchReadinessPercent: mvp1ProductionReadiness,
    includedSurfaces: ["Citizen PWA", "Verification Console", "MLA Dashboard", "Minister Dashboard", "CM Cell Dashboard", "Admin Console"],
    deferredSurfaces: ["Public transparency", "Autonomous agents", "Full field workbenches", "Native mobile apps"],
    exitCriteria: [
      "Citizens can submit and track tickets through the lifecycle.",
      "Verification can route, request information, reject, and protect sensitive cases.",
      "Role-scoped dashboards do not leak unrelated data or protected identity.",
      "SLA breaches escalate upward and preserve secondary visibility.",
      "Admin can configure users, access, categories, SLA, privacy, and launch gates.",
    ],
    items: mvp1Items(config, access, deploymentPreflight),
    nextActions: [
      "Replace prototype OTP/evidence seams and approve the mobile/password operator identity policy or configure mandated SSO.",
      "Keep neutral placeholder assets locked unless official assets are legally approved.",
      "Run UAT with Verification, MLA, Minister, CM Cell, and Admin operators.",
    ],
  });

  const mvp2 = phase({
    id: "MVP2",
    title: "Transparency and recommend-only intelligence",
    purpose: "Add public aggregate trust surfaces and AI-assisted recommendations after MVP1 workflow stabilizes.",
    launchReadinessPercent: Math.min(65, mvp1.launchReadinessPercent),
    includedSurfaces: ["Public Transparency Portal", "Agent recommendation history", "CM/ministry recommendation briefs", "Notification template governance"],
    deferredSurfaces: ["Autonomous state changes", "Raw public ticket data", "Agent access to unrestricted protected evidence"],
    exitCriteria: [
      "Public aggregate counts reconcile with internal counts.",
      "Agents are logged, reviewable, schema-valid, and unable to mutate lifecycle state.",
      "Admin can pause public visibility and category exposure.",
    ],
    items: mvp2Items(config),
    nextActions: [
      "Define reconciliation checks and public communications policy for aggregate transparency.",
      "Add agent evaluation datasets and reviewer acceptance metrics.",
      "Integrate approved notification providers with delivery receipts.",
    ],
  });

  const mvp3 = phase({
    id: "MVP3",
    title: "Field execution and department operations",
    purpose: "Move from oversight dashboards into daily closure workflows for department and local teams.",
    launchReadinessPercent: 30,
    includedSurfaces: ["Department Officer Workbench", "Councillor/Local Workbench", "Field visit and closure workflows", "Citizen reopen/dispute"],
    deferredSurfaces: ["Native apps unless usage proves need", "Deep department integrations until source-of-truth boundaries are clear"],
    exitCriteria: [
      "Field teams can manage daily work from queues.",
      "Before/after evidence and transfer reasons are auditable.",
      "Closure decisions and reopen/dispute rates are measurable.",
    ],
    items: mvp3Items(),
    nextActions: [
      "Design separate field workbench IA instead of adding generic dashboard tabs.",
      "Implement owner assignment and workload balancing.",
      "Define offline and low-connectivity behavior before field pilot.",
    ],
  });

  const mvp4 = phase({
    id: "MVP4",
    title: "Advanced governance and scale",
    purpose: "Harden Whistle into a statewide/multi-jurisdiction accountability platform after operational model proof.",
    launchReadinessPercent: 15,
    includedSurfaces: ["Advanced protected workflow", "Audit/export compliance", "Warehouse analytics", "Native/kiosk/call-center channels"],
    deferredSurfaces: ["Any advanced identity or surveillance-adjacent feature without legal approval"],
    exitCriteria: [
      "Sensitive workflows have approved legal, operational, and audit controls.",
      "Warehouse and audit exports reconcile with operational records.",
      "Multi-channel filing preserves one lifecycle, one SLA model, and one audit trail.",
    ],
    items: mvp4Items(config, changeRequests),
    nextActions: [
      "Decide government identity, data residency, KMS, and WORM/SIEM standards.",
      "Define integration governance and source-of-truth boundaries.",
      "Package reusable jurisdiction configuration only after Tamil Nadu pilot evidence.",
    ],
  });

  const phases = [mvp1, mvp2, mvp3, mvp4];
  const overallImplementationPercent = Math.round(
    phases.reduce((total, item, index) => total + item.implementationPercent * [0.55, 0.2, 0.15, 0.1][index], 0),
  );
  const overallLaunchReadinessPercent = Math.round(
    phases.reduce((total, item, index) => total + item.launchReadinessPercent * [0.65, 0.18, 0.1, 0.07][index], 0),
  );

  return {
    generatedAt: new Date().toISOString(),
    source: "admin_config_and_access_snapshot",
    activeBuild: "MVP1",
    currentBuildOrder: [...mvpOrder],
    overallImplementationPercent,
    overallLaunchReadinessPercent,
    activeBuildWorkstreams: mvp1LaunchWorkstreams(config, access, deploymentPreflight),
    principles: [
      "MVP1 proves operational accountability before public transparency or autonomy.",
      "The ticket spine owns lifecycle state, queues, SLAs, audit, and notifications.",
      "Agents and dashboards read governed projections; they do not own state transitions.",
      "Protected complaints remain compartmentalized until SOP, legal, and safety controls are approved.",
    ],
    phases,
  };
}
