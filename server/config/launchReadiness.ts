import type { AccessSnapshot, AccessRole } from "../access/types.js";
import type { DeploymentPreflightReport } from "./deploymentPreflight.js";
import { isCriticalConfigChange } from "./governance.js";
import type {
  AdminConfigSnapshot,
  ConfigChangeRequest,
  LaunchReadinessCheck,
  LaunchReadinessReport,
  LaunchReadinessStatus,
} from "./types.js";
import { launchEvidenceReferenceIssue } from "./evidenceReferences.js";
import { mvp1ProviderReferenceControlIds, providerReferenceIssueForControl } from "./providerReferences.js";

const requiredRoles: AccessRole[] = ["admin", "cm_cell", "verification", "minister", "department_officer", "mla", "councillor", "worker"];
const requiredSlaStages = ["verification", "local", "ministry", "cm_cell", "rejection_review"];
const assetReviewControls = [
  "asset-logo-approved",
  "asset-portrait-approved",
  "asset-tn-emblem-approved",
  "asset-public-disclaimer-approved",
];
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

function statusFrom(blockers: string[], warnings: string[]): LaunchReadinessStatus {
  if (blockers.length) return "blocker";
  if (warnings.length) return "warning";
  return "pass";
}

function check(
  id: string,
  phase: LaunchReadinessCheck["phase"],
  label: string,
  blockers: string[],
  warnings: string[],
  passSummary: string,
): LaunchReadinessCheck {
  const status = statusFrom(blockers, warnings);
  return {
    id,
    phase,
    label,
    status,
    summary: status === "blocker" ? blockers[0] : status === "warning" ? warnings[0] : passSummary,
    details: status === "blocker" ? blockers : status === "warning" ? warnings : [passSummary],
  };
}

function appControlValue(config: AdminConfigSnapshot, id: string) {
  return config.appControls.find((control) => control.id === id)?.value;
}

function appControlName(config: AdminConfigSnapshot, id: string) {
  return config.appControls.find((control) => control.id === id)?.name ?? id;
}

function appControlNumber(config: AdminConfigSnapshot, id: string) {
  const value = appControlValue(config, id);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isExpired(expiresAt?: string) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
}

export function createLaunchReadinessReport(
  config: AdminConfigSnapshot,
  access: AccessSnapshot,
  changeRequests: ConfigChangeRequest[],
  deploymentPreflight?: DeploymentPreflightReport,
): LaunchReadinessReport {
  const readinessByCategory = new Map(config.readiness.map((item) => [item.categoryId, item]));
  const enabledCategories = config.categories.filter((category) => category.enabled);
  const publicReadyCategories = enabledCategories.filter((category) => {
    const readiness = readinessByCategory.get(category.id);
    return readiness?.launchState === "ready" && readiness.sopStatus === "approved" && readiness.trainingStatus === "approved";
  });
  const pilotOnlyCategories = enabledCategories.filter((category) => readinessByCategory.get(category.id)?.launchState === "pilot_only");

  const categoryBlockers = enabledCategories
    .filter((category) => !readinessByCategory.has(category.id))
    .map((category) => `${category.labelEn} is enabled but has no launch-readiness row.`);
  if (!publicReadyCategories.length) categoryBlockers.push("No public complaint category is launch-ready.");
  const categoryWarnings = pilotOnlyCategories.map((category) => `${category.labelEn} is visible but remains pilot-only for public intake.`);

  const activeUsers = access.users.filter((user) => user.status === "active");
  const activeUserActors = new Set(activeUsers.map((user) => user.actorKey));
  const activeTeams = access.teams.filter((team) => team.status === "active");
  const activeGrants = access.grants.filter((grant) => !isExpired(grant.expiresAt));
  const roleBlockers = requiredRoles.flatMap((role) => {
    const roleTeams = activeTeams.filter((team) => team.role === role);
    const roleGrants = activeGrants.filter((grant) => grant.role === role);
    const missing = [];
    if (!roleTeams.length) missing.push(`${role} has no active team.`);
    if (!roleTeams.some((team) => activeUserActors.has(team.ownerActorKey))) missing.push(`${role} has no active team owner.`);
    if (!roleGrants.length) missing.push(`${role} has no active access grant.`);
    return missing;
  });
  const roleWarnings = activeUsers
    .filter((user) => user.mfaState !== "enabled" && user.mfaState !== "not_required_mvp")
    .map((user) => `${user.displayName} MFA is ${user.mfaState}.`);

  const slaBlockers = requiredSlaStages.flatMap((stage) => {
    const policy = config.slaPolicies.find((item) => item.stage === stage);
    if (!policy) return [`${stage} SLA policy is missing.`];
    if (!policy.enabled) return [`${policy.label} is paused.`];
    if (policy.durationDays < 1) return [`${policy.label} has an invalid duration.`];
    return [];
  });

  const protectedCategories = enabledCategories.filter((category) => category.sensitivity === "protected");
  const protectedBlockers: string[] = [];
  if (protectedCategories.length && appControlValue(config, "protected-bypass") === false) {
    protectedBlockers.push("Protected category bypass is disabled while protected categories are enabled.");
  }
  const hasProtectedOperators = activeGrants.some((grant) => ["cm_cell", "verification"].includes(grant.role) && grant.protectedAccess);
  if (protectedCategories.length && !hasProtectedOperators) {
    protectedBlockers.push("No active CM Cell or Verification grant can access protected queues.");
  }
  const protectedWarnings = activeGrants
    .filter((grant) => grant.protectedAccess && grant.reporterIdentity && !["admin", "cm_cell", "verification"].includes(grant.role))
    .map((grant) => `${grant.role} grant exposes protected reporter identity.`);

  const assetBlockers = assetReviewControls
    .filter((id) => appControlValue(config, id) !== true)
    .map((id) => `${config.appControls.find((control) => control.id === id)?.name ?? id} is not approved for public launch.`);
  const citizenIdentityPolicyMode = String(appControlValue(config, "identity-gov-id-policy-mode") ?? "phone-otp-only");
  const citizenIdentityRequiredCategories = String(appControlValue(config, "identity-gov-id-required-categories") ?? "none");
  const citizenGovIdPolicyEnabled =
    citizenIdentityPolicyMode !== "phone-otp-only" && citizenIdentityRequiredCategories.trim().toLowerCase() !== "none";
  const citizenGovIdPolicyIssue = citizenGovIdPolicyEnabled
    ? providerReferenceIssueForControl(
        "identity-gov-id-provider-config-ref",
        appControlValue(config, "identity-gov-id-provider-config-ref"),
        "Government ID category policy provider/policy reference",
      )
    : null;
  const citizenGovIdPolicyBlockers = citizenGovIdPolicyIssue ? [citizenGovIdPolicyIssue] : [];
  const productionSeamBlockers = productionSeamControls
    .filter((id) => appControlValue(config, id) !== true)
    .map((id) => `${config.appControls.find((control) => control.id === id)?.name ?? id} is still in prototype/mock readiness.`);
  const productionReferenceBlockers = mvp1ProviderReferenceControlIds
    .map((id) => providerReferenceIssueForControl(id, appControlValue(config, id), appControlName(config, id)))
    .filter((item): item is string => Boolean(item));
  const platformPostgresEvidenceBlockers = platformPostgresEvidenceControls
    .map(([id, kind, label]) => launchEvidenceReferenceIssue(appControlValue(config, id), kind, label))
    .filter((item): item is string => Boolean(item));
  const productionSeamRuntimeBlockers =
    deploymentPreflight?.checks
      .filter((item) => item.status === "blocker")
      .map((item) => `Runtime preflight blocker: ${item.label} (${item.observed}).`) ?? [];
  const productionSeamRuntimeWarnings =
    deploymentPreflight?.checks
      .filter((item) => item.status === "warning")
      .map((item) => `Runtime preflight warning: ${item.label} (${item.observed}).`) ?? [];

  const pendingCriticalApprovals = changeRequests.filter(
    (request) => request.status === "pending" && isCriticalConfigChange(config, request.target),
  );
  const governanceBlockers = pendingCriticalApprovals.map((request) => `${request.summary} is pending second-Admin approval.`);

  const operatorUatBlockers = operatorUatControls
    .filter((id) => appControlValue(config, id) !== true)
    .map((id) => `${appControlName(config, id)} is not signed off.`);
  const uatEvidenceIssue = launchEvidenceReferenceIssue(appControlValue(config, "uat-launch-rehearsal-evidence-ref"), "uat_rehearsal");
  if (uatEvidenceIssue) operatorUatBlockers.push(uatEvidenceIssue);
  const uatDefectRegisterIssue = launchEvidenceReferenceIssue(appControlValue(config, "uat-defect-register-ref"), "uat_defect_register");
  if (uatDefectRegisterIssue) operatorUatBlockers.push(uatDefectRegisterIssue);
  const openBlockerDefects = appControlNumber(config, "uat-open-blocker-defects");
  const openCriticalDefects = appControlNumber(config, "uat-open-critical-defects");
  const openMajorDefects = appControlNumber(config, "uat-open-major-defects");
  const openMinorDefects = appControlNumber(config, "uat-open-minor-defects");
  if (openBlockerDefects > 0) operatorUatBlockers.push(`${openBlockerDefects} blocker UAT defect(s) remain open.`);
  if (openCriticalDefects > 0) operatorUatBlockers.push(`${openCriticalDefects} critical UAT defect(s) remain open.`);
  const operatorUatWarnings = [
    openMajorDefects > 0 ? `${openMajorDefects} major UAT defect(s) require launch-owner acceptance or fix before public launch.` : null,
    openMinorDefects > 0 ? `${openMinorDefects} minor UAT defect(s) are recorded for phase-tagged follow-up.` : null,
  ].filter((item): item is string => Boolean(item));

  const deploymentOpsBlockers = deploymentOpsControls
    .filter((id) => appControlValue(config, id) !== true)
    .map((id) => `${appControlName(config, id)} is not signed off.`);
  for (const [id, kind, label] of [
    ["ops-restore-drill-evidence-ref", "restore_drill", "Restore drill evidence reference"],
    ["ops-siem-worm-evidence-ref", "siem_worm", "SIEM/WORM export evidence reference"],
    ["ops-telemetry-launch-watch-evidence-ref", "telemetry_watch", "Telemetry launch watch evidence reference"],
    ["ops-origin-allowlist-evidence-ref", "origin_allowlist", "Browser origin allowlist evidence reference"],
    ["ops-incident-hold-policy-evidence-ref", "incident_hold", "Incident hold policy evidence reference"],
  ] as const) {
    const issue = launchEvidenceReferenceIssue(appControlValue(config, id), kind, label);
    if (issue) deploymentOpsBlockers.push(issue);
  }

  const notificationWarnings = [
    appControlValue(config, "citizen-phone-otp-required") === false ? null : "Citizen phone OTP is enabled without confirming provider readiness.",
    appControlValue(config, "notify-sms") === true ? null : "SMS stage updates are disabled.",
    appControlValue(config, "lang-tamil") === true ? null : "Tamil citizen copy is disabled.",
  ].filter((item): item is string => Boolean(item));

  const checks = [
    check("category-readiness", "V0", "Category launch readiness", categoryBlockers, categoryWarnings, "Enabled categories have readiness rows and at least one public-ready intake path."),
    check("role-access", "V1", "Role and team setup", roleBlockers, roleWarnings, "Required launch roles have active teams, owners, and grants."),
    check("sla-policy", "V1", "SLA and escalation clocks", slaBlockers, [], "Required SLA stages are enabled with valid durations."),
    check("protected-track", "V1", "Protected complaint controls", protectedBlockers, protectedWarnings, "Protected categories are compartmentalized with approved operators."),
    check("asset-review", "V0", "Asset and identity review", assetBlockers, [], "Prototype logos, portraits, emblems, and disclaimers are reviewed for public launch."),
    check(
      "production-seams",
      "V1",
      "Production provider seams",
      [...productionSeamBlockers, ...productionReferenceBlockers, ...platformPostgresEvidenceBlockers, ...citizenGovIdPolicyBlockers, ...productionSeamRuntimeBlockers],
      productionSeamRuntimeWarnings,
      "Government identity approval, OTP/SMS, evidence, notifications, distributed rate limits, Postgres migration/check evidence, deployment, backup, and SIEM seams are production-ready in Admin controls and runtime preflight.",
    ),
    check("governance-approvals", "V1", "Critical approval queue", governanceBlockers, [], "No critical configuration approval is pending."),
    check(
      "operator-uat",
      "V1",
      "Operator UAT and SOP sign-off",
      operatorUatBlockers,
      operatorUatWarnings,
      "MVP1 launch rehearsal, operator SOPs, protected-track handling, and defect triage are signed off.",
    ),
    check(
      "deployment-incident",
      "V1",
      "Deployment and incident sign-off",
      deploymentOpsBlockers,
      [],
      "Restore drill evidence, SIEM/WORM export, telemetry launch watch, origin allowlist, and incident hold rules are signed off.",
    ),
    check("citizen-communications", "V1", "Citizen communication controls", [], notificationWarnings, "Phone verification, Tamil copy, and SMS update controls are enabled."),
  ];

  const blockers = checks.filter((item) => item.status === "blocker").length;
  const warnings = checks.filter((item) => item.status === "warning").length;
  const score = Math.round((checks.filter((item) => item.status === "pass").length + warnings * 0.5) / checks.length * 100);

  return {
    generatedAt: new Date().toISOString(),
    verdict: blockers ? "no_go" : warnings ? "conditional_go" : "go",
    score,
    blockers,
    warnings,
    checks,
    counts: {
      enabledCategories: enabledCategories.length,
      publicReadyCategories: publicReadyCategories.length,
      pilotOnlyCategories: pilotOnlyCategories.length,
      activeTeams: activeTeams.length,
      activeUsers: activeUsers.length,
      pendingCriticalApprovals: pendingCriticalApprovals.length,
    },
  };
}
