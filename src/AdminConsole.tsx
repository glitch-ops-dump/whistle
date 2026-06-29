import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Database,
  EyeOff,
  KeyRound,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  ToggleLeft,
  UserCog,
  UsersRound,
} from "lucide-react";
import {
  approveConfigChangeRequest,
  createConfigChangeRequest,
  fetchAdminConfig,
  fetchConfigChangeRequests,
  fetchDeploymentPreflight,
  fetchGovernanceAuditExport,
  fetchLaunchReadiness,
  fetchMvp1LaunchHandoff,
  fetchMvpScope,
  isCriticalApprovalRequired,
  patchAdminAppControl,
  patchAdminCategory,
  patchAdminCategoryReadiness,
  patchAdminSlaPolicy,
  rejectConfigChangeRequest,
  type AuditExportDelivery,
  type AuditExportPackage,
  type AdminAppControl,
  type AdminCategoryConfig,
  type AdminCategoryReadiness,
  type AdminSlaPolicy,
  type ConfigChangeRequest,
  type ConfigChangeTarget,
  type DeploymentPreflightReport,
  type LaunchReadinessReport,
  type MvpLaunchWorkstream,
  type Mvp1LaunchHandoffReport,
  type MvpPhaseStatus,
  type MvpScopeReport,
} from "./adminConfigApi";
import {
  createAccessGrant,
  createAccessTeam,
  createAccessUser,
  createTeamMembership,
  fetchAdminAccess,
  fetchEffectiveAccess,
  updateAccessGrant,
  updateAccessTeam,
  updateAccessUser,
  updateTeamMembership,
  type AccessGrant as ApiAccessGrant,
  type AccessRole,
  type AccessScopeKind,
  type AccessSnapshot,
  type AccessTeam as ApiAccessTeam,
  type AccessUser,
  type AdminAccessPayload,
  type EffectiveAccess,
  type TeamMembership as ApiTeamMembership,
} from "./adminAccessApi";

type AdminSection = "access" | "launch" | "sla" | "audit";
type UserStatus = "Active" | "Pending" | "Deactivated";
type TeamKind = "CM Cell" | "Minister Team" | "Department Officer" | "MLA Team" | "Local Owner" | "Verification" | "Rejection Review" | "Admin" | "Worker";
type ScopeType = "Statewide" | "District" | "Ministry" | "Constituency" | "Local Body" | "Queue" | "Protected" | "App";
type AuditTone = "good" | "warn" | "danger" | "neutral";

type AdminUser = {
  id: string;
  actorKey?: string;
  name: string;
  title: string;
  phone: string;
  email: string;
  status: UserStatus;
  mfa: "Enabled" | "Pending" | "MVP bypass";
  lastSeen: string;
};

type Team = {
  id: string;
  name: string;
  kind: TeamKind;
  ownerUserId: string | null;
  status: "Active" | "Needs owner" | "Acting" | "Inactive";
  defaultScope: string;
};

type TeamMembership = {
  id?: string;
  userId: string;
  teamId: string;
  role: string;
  expiresAt: string | null;
};

type AccessGrant = {
  id: string;
  targetType: "Team" | "User";
  targetId: string;
  role: string;
  scopeType: ScopeType;
  scope: string;
  protectedQueue: boolean;
  reporterIdentity: boolean;
  actions: string[];
  expiresAt: string | null;
};

type PermissionProfile = {
  id: string;
  role: string;
  protectedQueue: boolean;
  reporterIdentity: boolean;
  evidenceAccess: "Hidden" | "Metadata only" | "Full evidence";
  canApproveConfig: boolean;
  allowedActions: string[];
};

type AppControl = {
  id: AdminAppControl["id"];
  group: AdminAppControl["group"] | "SLA";
  name: string;
  value: string | boolean | number;
  valueType: AdminAppControl["valueType"];
  critical: boolean;
};

type CategoryConfig = AdminCategoryConfig;
type CategoryReadiness = AdminCategoryReadiness;
type SlaPolicy = AdminSlaPolicy;

type AdminAuditEvent = {
  id: string;
  time: string;
  actor: string;
  action: string;
  summary: string;
  tone: AuditTone;
};

type RuntimeAssets = {
  logo: string;
  emblem: string;
};

declare global {
  interface Window {
    __WHISTLE_ADMIN_ASSETS__?: RuntimeAssets;
  }
}

const ASSETS: RuntimeAssets = window.__WHISTLE_ADMIN_ASSETS__ ?? {
  logo: "/assets/brand/whistle-fake-logo.svg",
  emblem: "/assets/brand/whistle-civic-mark.svg",
};

const navItems: { id: AdminSection; label: string; icon: typeof UsersRound; title: string; search: string }[] = [
  { id: "access", label: "Access", icon: UsersRound, title: "Manage users, teams, role scopes, and permissions", search: "Search user, team, scope..." },
  { id: "launch", label: "Launch Controls", icon: ShieldAlert, title: "Clear MVP1 launch gates and provider readiness", search: "Search blocker, provider, evidence..." },
  { id: "sla", label: "SLA/Categories", icon: SlidersHorizontal, title: "Configure categories, SLAs, and readiness matrix", search: "Search category, SLA, owner..." },
  { id: "audit", label: "Audit", icon: ClipboardList, title: "Review setup risks, approvals, and audit export", search: "Search audit, risk, approval..." },
];

const adminSectionIds = new Set<AdminSection>(navItems.map((item) => item.id));

function adminSectionFromLocation(): AdminSection {
  const section = window.location.hash.replace("#", "");
  if (adminSectionIds.has(section as AdminSection)) return section as AdminSection;
  if (["scope", "uat", "controls"].includes(section)) return "launch";
  if (["users", "teams", "permissions"].includes(section)) return "access";
  if (["categories", "readiness", "sla-policies"].includes(section)) return "sla";
  return "launch";
}

const scopeCatalog = [
  "Tamil Nadu statewide",
  "Municipal Administration & Water Supply",
  "Highways and Minor Ports",
  "Food and Civil Supplies",
  "Chennai North constituency",
  "Thiruvallur East constituency",
  "Ward 48 local body",
  "CM Cell protected queue",
  "Rejected ticket review queue",
  "System configuration",
];

const initialUsers: AdminUser[] = [
  {
    id: "usr-admin-01",
    name: "Meera Iyer",
    title: "State platform administrator",
    phone: "+91 90000 25005",
    email: "meera.iyer@gov.tn",
    status: "Active",
    mfa: "Enabled",
    lastSeen: "Today 10:30",
  },
  {
    id: "usr-cm-01",
    name: "Anitha Raman",
    title: "CM Cell Director",
    phone: "+91 90000 21001",
    email: "anitha.raman@gov.tn",
    status: "Active",
    mfa: "Enabled",
    lastSeen: "Today 09:40",
  },
  {
    id: "usr-cm-02",
    name: "S. Prakash",
    title: "CM escalation officer",
    phone: "+91 90000 21002",
    email: "prakash.s@gov.tn",
    status: "Active",
    mfa: "Enabled",
    lastSeen: "Today 08:55",
  },
  {
    id: "usr-min-01",
    name: "R. Kavitha",
    title: "Minister office secretary",
    phone: "+91 90000 22010",
    email: "kavitha.r@gov.tn",
    status: "Active",
    mfa: "Enabled",
    lastSeen: "Yesterday 18:20",
  },
  {
    id: "usr-mla-01",
    name: "M. Selvi",
    title: "MLA constituency coordinator",
    phone: "+91 90000 23003",
    email: "selvi.m@gov.tn",
    status: "Active",
    mfa: "Enabled",
    lastSeen: "Today 07:42",
  },
  {
    id: "usr-local-01",
    name: "D. Arun",
    title: "Ward field supervisor",
    phone: "+91 90000 24004",
    email: "arun.d@gov.tn",
    status: "Pending",
    mfa: "Pending",
    lastSeen: "Invite sent",
  },
];

const initialTeams: Team[] = [
  {
    id: "team-admin",
    name: "State Admin Secretariat",
    kind: "Admin",
    ownerUserId: "usr-admin-01",
    status: "Active",
    defaultScope: "System configuration",
  },
  {
    id: "team-cm-command",
    name: "CM Cell Command",
    kind: "CM Cell",
    ownerUserId: "usr-cm-01",
    status: "Active",
    defaultScope: "Tamil Nadu statewide",
  },
  {
    id: "team-cm-review",
    name: "Independent Rejection Review",
    kind: "Rejection Review",
    ownerUserId: "usr-cm-02",
    status: "Active",
    defaultScope: "Rejected ticket review queue",
  },
  {
    id: "team-min-maws",
    name: "MAWS Minister Team",
    kind: "Minister Team",
    ownerUserId: "usr-min-01",
    status: "Active",
    defaultScope: "Municipal Administration & Water Supply",
  },
  {
    id: "team-mla-chennai",
    name: "Chennai North MLA Office",
    kind: "MLA Team",
    ownerUserId: "usr-mla-01",
    status: "Active",
    defaultScope: "Chennai North constituency",
  },
  {
    id: "team-ward-48",
    name: "Ward 48 Local Field Cell",
    kind: "Local Owner",
    ownerUserId: null,
    status: "Needs owner",
    defaultScope: "Ward 48 local body",
  },
];

const initialMemberships: TeamMembership[] = [
  { userId: "usr-admin-01", teamId: "team-admin", role: "Platform admin", expiresAt: null },
  { userId: "usr-cm-01", teamId: "team-cm-command", role: "Director", expiresAt: null },
  { userId: "usr-cm-02", teamId: "team-cm-command", role: "Escalation officer", expiresAt: null },
  { userId: "usr-cm-02", teamId: "team-cm-review", role: "Review lead", expiresAt: null },
  { userId: "usr-min-01", teamId: "team-min-maws", role: "Minister office admin", expiresAt: null },
  { userId: "usr-mla-01", teamId: "team-mla-chennai", role: "Constituency coordinator", expiresAt: null },
  { userId: "usr-local-01", teamId: "team-ward-48", role: "Field supervisor", expiresAt: "Expired 28 May 2026" },
];

const initialGrants: AccessGrant[] = [
  {
    id: "grant-admin-team",
    targetType: "Team",
    targetId: "team-admin",
    role: "Admin",
    scopeType: "App",
    scope: "System configuration",
    protectedQueue: true,
    reporterIdentity: false,
    actions: ["Manage users", "Manage teams", "Configure app controls", "Review audit"],
    expiresAt: null,
  },
  {
    id: "grant-admin-direct",
    targetType: "User",
    targetId: "usr-admin-01",
    role: "Admin",
    scopeType: "App",
    scope: "System configuration",
    protectedQueue: true,
    reporterIdentity: false,
    actions: ["Manage users", "Configure app controls"],
    expiresAt: null,
  },
  {
    id: "grant-cm-command",
    targetType: "Team",
    targetId: "team-cm-command",
    role: "CM Cell",
    scopeType: "Statewide",
    scope: "Tamil Nadu statewide",
    protectedQueue: true,
    reporterIdentity: true,
    actions: ["Statewide oversight", "Issue directive", "View protected metadata"],
    expiresAt: null,
  },
  {
    id: "grant-rejection",
    targetType: "Team",
    targetId: "team-cm-review",
    role: "Rejection Review",
    scopeType: "Queue",
    scope: "Rejected ticket review queue",
    protectedQueue: true,
    reporterIdentity: true,
    actions: ["Reverse rejection", "Confirm rejection", "Flag verifier"],
    expiresAt: null,
  },
  {
    id: "grant-minister",
    targetType: "Team",
    targetId: "team-min-maws",
    role: "Minister Team",
    scopeType: "Ministry",
    scope: "Municipal Administration & Water Supply",
    protectedQueue: false,
    reporterIdentity: false,
    actions: ["Monitor ministry", "Request field report", "Review CM escalations"],
    expiresAt: null,
  },
  {
    id: "grant-mla",
    targetType: "Team",
    targetId: "team-mla-chennai",
    role: "MLA Team",
    scopeType: "Constituency",
    scope: "Chennai North constituency",
    protectedQueue: false,
    reporterIdentity: false,
    actions: ["Monitor constituency", "Request local action", "View secondary escalations"],
    expiresAt: null,
  },
  {
    id: "grant-local",
    targetType: "Team",
    targetId: "team-ward-48",
    role: "Local Owner",
    scopeType: "Local Body",
    scope: "Ward 48 local body",
    protectedQueue: false,
    reporterIdentity: false,
    actions: ["Accept local assignment", "Add field note", "Mark resolved"],
    expiresAt: "Expired 28 May 2026",
  },
];

const initialPermissions: PermissionProfile[] = [
  {
    id: "perm-admin",
    role: "Admin",
    protectedQueue: true,
    reporterIdentity: false,
    evidenceAccess: "Metadata only",
    canApproveConfig: true,
    allowedActions: ["Manage users", "Configure permissions", "Edit app controls", "View audit"],
  },
  {
    id: "perm-cm",
    role: "CM Cell",
    protectedQueue: true,
    reporterIdentity: true,
    evidenceAccess: "Full evidence",
    canApproveConfig: false,
    allowedActions: ["Statewide oversight", "Issue directive", "Request audit"],
  },
  {
    id: "perm-minister",
    role: "Minister Team",
    protectedQueue: false,
    reporterIdentity: false,
    evidenceAccess: "Metadata only",
    canApproveConfig: false,
    allowedActions: ["Monitor ministry", "Request field report"],
  },
  {
    id: "perm-mla",
    role: "MLA Team",
    protectedQueue: false,
    reporterIdentity: false,
    evidenceAccess: "Hidden",
    canApproveConfig: false,
    allowedActions: ["Monitor constituency", "Request local action"],
  },
  {
    id: "perm-local",
    role: "Local Owner",
    protectedQueue: false,
    reporterIdentity: false,
    evidenceAccess: "Metadata only",
    canApproveConfig: false,
    allowedActions: ["Accept assignment", "Add field note", "Resolve"],
  },
];

const initialControls: AppControl[] = [
  { id: "privacy-local", group: "Privacy", name: "Mask identity below ministry", value: true, valueType: "boolean", critical: true },
  { id: "protected-bypass", group: "Protected", name: "Corruption bypasses local routing", value: true, valueType: "boolean", critical: true },
  { id: "notify-sms", group: "Notifications", name: "SMS stage updates", value: true, valueType: "boolean", critical: false },
  {
    id: "notify-template",
    group: "Notifications",
    name: "Citizen stage template",
    value: "Ticket {{ticketId}} moved to {{currentQueue}}.",
    valueType: "string",
    critical: false,
  },
  { id: "lang-tamil", group: "Language", name: "Tamil citizen copy", value: true, valueType: "boolean", critical: false },
  { id: "citizen-phone-otp-required", group: "Privacy", name: "Citizen phone OTP required", value: false, valueType: "boolean", critical: false },
  { id: "official-user-otp-required", group: "Privacy", name: "Government user login OTP required", value: false, valueType: "boolean", critical: true },
  { id: "identity-gov-id-policy-mode", group: "Privacy", name: "Citizen government ID policy mode", value: "phone-otp-only", valueType: "string", critical: true },
  { id: "identity-gov-id-required-categories", group: "Privacy", name: "Government ID required categories", value: "none", valueType: "string", critical: true },
  { id: "identity-gov-id-provider-config-ref", group: "Infrastructure", name: "Government ID provider/policy reference", value: "not-enabled-for-mvp1", valueType: "string", critical: true },
  { id: "platform-postgres-migration-evidence-ref", group: "Infrastructure", name: "Postgres migration evidence reference", value: "artifact://whistle/mvp1/postgres-migration/local-uat-assumed", valueType: "string", critical: true },
  { id: "platform-postgres-mvp-check-evidence-ref", group: "Infrastructure", name: "Postgres MVP check evidence reference", value: "artifact://whistle/mvp1/postgres-mvp-check/local-uat-assumed", valueType: "string", critical: true },
  { id: "feature-public", group: "Feature Flags", name: "Public aggregate insights", value: true, valueType: "boolean", critical: false },
  { id: "public-publish-delay-hours", group: "Feature Flags", name: "Public insight publication delay", value: 24, valueType: "number", critical: false },
  { id: "ops-maintenance", group: "Operations", name: "Maintenance mode", value: false, valueType: "boolean", critical: false },
  { id: "infra-official-oidc-config-ref", group: "Infrastructure", name: "Official OIDC/MFA config reference", value: "pending-secret-manager-ref", valueType: "string", critical: true },
  { id: "infra-official-oidc-mfa-ready", group: "Infrastructure", name: "Official OIDC/MFA provider ready", value: false, valueType: "boolean", critical: true },
  { id: "infra-worker-auth-config-ref", group: "Infrastructure", name: "Worker auth secret reference", value: "pending-secret-manager-ref", valueType: "string", critical: true },
  { id: "infra-worker-auth-ready", group: "Infrastructure", name: "Worker service authentication ready", value: false, valueType: "boolean", critical: true },
  { id: "infra-citizen-otp-config-ref", group: "Infrastructure", name: "Citizen OTP/SMS provider reference", value: "pending-provider-contract-ref", valueType: "string", critical: true },
  { id: "infra-citizen-otp-provider-ready", group: "Infrastructure", name: "Citizen OTP/SMS provider ready", value: false, valueType: "boolean", critical: true },
  { id: "infra-evidence-storage-config-ref", group: "Infrastructure", name: "Evidence storage/KMS/scanner reference", value: "pending-security-approval-ref", valueType: "string", critical: true },
  { id: "infra-evidence-storage-ready", group: "Infrastructure", name: "Evidence storage, scanning, and KMS ready", value: false, valueType: "boolean", critical: true },
  { id: "infra-notification-provider-config-ref", group: "Infrastructure", name: "Notification provider reference", value: "pending-provider-contract-ref", valueType: "string", critical: true },
  { id: "infra-notification-provider-ready", group: "Infrastructure", name: "Notification provider contracts ready", value: false, valueType: "boolean", critical: true },
  { id: "infra-rate-limit-config-ref", group: "Infrastructure", name: "Distributed rate-limit provider reference", value: "pending-platform-approval-ref", valueType: "string", critical: true },
  { id: "infra-distributed-rate-limit-ready", group: "Infrastructure", name: "Distributed public rate limiting ready", value: false, valueType: "boolean", critical: true },
  { id: "infra-deployment-observability-config-ref", group: "Infrastructure", name: "Deployment/SIEM/telemetry reference", value: "pending-ops-evidence-ref", valueType: "string", critical: true },
  { id: "infra-deployment-runbook-ready", group: "Infrastructure", name: "Deployment, backup, and SIEM runbook ready", value: false, valueType: "boolean", critical: true },
  { id: "uat-launch-rehearsal-evidence-ref", group: "Operations", name: "MVP1 rehearsal evidence reference", value: "artifact://whistle/mvp1/rehearsal-packet/local-uat-assumed", valueType: "string", critical: true },
  { id: "uat-citizen-lifecycle-rehearsed", group: "Operations", name: "Citizen submit and track rehearsal complete", value: false, valueType: "boolean", critical: true },
  { id: "uat-verification-sop-approved", group: "Operations", name: "Verification SOP and training approved", value: false, valueType: "boolean", critical: true },
  { id: "uat-role-dashboard-rehearsed", group: "Operations", name: "Role dashboard rehearsal complete", value: false, valueType: "boolean", critical: true },
  { id: "uat-protected-track-sop-approved", group: "Operations", name: "Protected-track SOP approved", value: false, valueType: "boolean", critical: true },
  { id: "uat-defect-register-ref", group: "Operations", name: "MVP1 defect register reference", value: "artifact://whistle/mvp1/defect-register/local-uat-assumed", valueType: "string", critical: true },
  { id: "uat-open-blocker-defects", group: "Operations", name: "Open blocker UAT defects", value: 0, valueType: "number", critical: true },
  { id: "uat-open-critical-defects", group: "Operations", name: "Open critical UAT defects", value: 0, valueType: "number", critical: true },
  { id: "uat-open-major-defects", group: "Operations", name: "Open major UAT defects", value: 0, valueType: "number", critical: true },
  { id: "uat-open-minor-defects", group: "Operations", name: "Open minor UAT defects", value: 0, valueType: "number", critical: false },
  { id: "uat-defect-triage-ready", group: "Operations", name: "MVP1 defect triage queue accepted", value: false, valueType: "boolean", critical: true },
  { id: "ops-restore-drill-evidence-ref", group: "Operations", name: "Restore drill evidence reference", value: "artifact://whistle/mvp1/restore-drill/local-uat-assumed", valueType: "string", critical: true },
  { id: "ops-restore-drill-signed-off", group: "Operations", name: "Production-like restore drill signed off", value: false, valueType: "boolean", critical: true },
  { id: "ops-siem-worm-evidence-ref", group: "Operations", name: "SIEM/WORM export evidence reference", value: "artifact://whistle/mvp1/siem-worm-export/local-uat-assumed", valueType: "string", critical: true },
  { id: "ops-siem-worm-signed-off", group: "Operations", name: "SIEM/WORM export signed off", value: false, valueType: "boolean", critical: true },
  { id: "ops-telemetry-launch-watch-evidence-ref", group: "Operations", name: "Telemetry launch watch evidence reference", value: "artifact://whistle/mvp1/telemetry-launch-watch/local-uat-assumed", valueType: "string", critical: true },
  { id: "ops-telemetry-launch-watch-signed-off", group: "Operations", name: "Telemetry launch watch signed off", value: false, valueType: "boolean", critical: true },
  { id: "ops-origin-allowlist-evidence-ref", group: "Operations", name: "Browser origin allowlist evidence reference", value: "artifact://whistle/mvp1/origin-allowlist/local-uat-assumed", valueType: "string", critical: true },
  { id: "ops-origin-allowlist-signed-off", group: "Operations", name: "Browser origin allowlist signed off", value: false, valueType: "boolean", critical: true },
  { id: "ops-incident-hold-policy-evidence-ref", group: "Operations", name: "Incident hold policy evidence reference", value: "artifact://whistle/mvp1/incident-hold-policy/local-uat-assumed", valueType: "string", critical: true },
  { id: "ops-incident-hold-policy-signed-off", group: "Operations", name: "Incident hold conditions signed off", value: false, valueType: "boolean", critical: true },
];

type ExternalServiceConfig = {
  id: string;
  title: string;
  owner: string;
  readinessControlId: string;
  referenceControlId: string;
  checks: string[];
  requiredEnv: string[];
  secretEnv: string[];
  options: Array<{
    label: string;
    value: string;
    note: string;
  }>;
  policyControlIds?: string[];
  optionSummary: string;
};

type PlatformPostgresItem = {
  id: string;
  title: string;
  owner: string;
  evidenceControlId: string;
  checks: string[];
  proof: string;
  commands: string[];
};

type OperatorUatItem = {
  id: string;
  title: string;
  owner: string;
  controlId: string;
  flows: string[];
  evidence: string;
};

type OperatorUatTriageLane = {
  severity: "Blocker" | "Critical" | "Major" | "Minor";
  decision: string;
  examples: string[];
  action: string;
};

type OperatorUatDefectItem = {
  id: string;
  label: string;
  controlId: string;
  launchRule: string;
  tone: "danger" | "warn" | "neutral";
};

type DeploymentOpsItem = {
  id: string;
  title: string;
  owner: string;
  controlId: string;
  evidenceControlId?: string;
  checks: string[];
  proof: string;
};

type DeploymentQuestionItem = {
  id: string;
  title: string;
  owner: string;
  question: string;
  answerFormat: string;
  why: string;
};

type UatCommand = {
  label: string;
  command: string;
};

type UatRoleAccount = {
  label: string;
  actor: string;
  role: string;
  surface: string;
  path: string;
  storageKey: string;
};

type UatSeedScenario = {
  key: string;
  title: string;
  queue: string;
  status: string;
  surface: string;
  assertion: string;
};

const platformPostgresItems: PlatformPostgresItem[] = [
  {
    id: "migration-output",
    title: "Postgres migration output",
    owner: "Platform owner",
    evidenceControlId: "platform-postgres-migration-evidence-ref",
    checks: ["database_persistence"],
    proof: "Attach the migration run artifact proving the target schema was applied to the staging or production Postgres cluster.",
    commands: ["DATABASE_URL=<target-postgres> npm run db:migrate"],
  },
  {
    id: "postgres-mvp-check",
    title: "Postgres-backed MVP check",
    owner: "Engineering owner",
    evidenceControlId: "platform-postgres-mvp-check-evidence-ref",
    checks: ["database_persistence", "distributed_rate_limits", "rate_limit_bucket_salt"],
    proof: "Attach the Postgres check artifact proving tickets, config, access, phone verification, backup/restore, and public rate buckets run against durable storage.",
    commands: ["DATABASE_URL=<target-postgres> npm run mvp:check:postgres"],
  },
  {
    id: "restore-linkage",
    title: "Backup/restore drill linkage",
    owner: "Database / platform owner",
    evidenceControlId: "ops-restore-drill-evidence-ref",
    checks: ["deployment_backup_runbook", "database_persistence"],
    proof: "Link the same restore-drill packet used by deployment sign-off so platform proof covers schema, ticket spine data, audit chain, and correlation IDs together.",
    commands: ["npm run smoke:postgres-backup-restore", "npm run deployment:packet -- --env-file <rendered-env>"],
  },
];

const externalServiceConfigs: ExternalServiceConfig[] = [
  {
    id: "official-identity",
    title: "Government identity / MFA",
    owner: "Identity owner",
    readinessControlId: "infra-official-oidc-mfa-ready",
    referenceControlId: "infra-official-oidc-config-ref",
    checks: ["official_identity_provider", "official_oidc_signing_source"],
    requiredEnv: ["WHISTLE_OFFICIAL_OIDC_ISSUER", "WHISTLE_OFFICIAL_OIDC_AUDIENCE", "WHISTLE_OFFICIAL_OIDC_JWKS_URL", "WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED"],
    secretEnv: ["IdP signing keys stay behind HTTPS JWKS; no HS256 secret outside local UAT"],
    options: [
      { label: "Local dev", value: "Prototype headers", note: "Allowed only on local developer machines." },
      { label: "MVP1 UAT", value: "Mobile/password + optional OTP", note: "Account login mints local official tokens for role-console testing." },
      { label: "Staging/production", value: "Approved identity policy", note: "Use mobile/password with mandated OTP if approved, or OIDC/MFA if government SSO policy requires it." },
    ],
    optionSummary: "Approve the government-console identity model before launch: mobile/password with Admin-mandated OTP, or an OIDC/MFA provider if policy requires SSO.",
  },
  {
    id: "worker-auth",
    title: "Worker service authentication",
    owner: "Platform owner",
    readinessControlId: "infra-worker-auth-ready",
    referenceControlId: "infra-worker-auth-config-ref",
    checks: ["worker_job_authentication"],
    requiredEnv: ["WHISTLE_WORKER_AUTH_REQUIRED", "WHISTLE_WORKER_SHARED_SECRET"],
    secretEnv: ["WHISTLE_WORKER_SHARED_SECRET"],
    options: [
      { label: "Disabled/open", value: "Prototype only", note: "Never use for shared UAT or production." },
      { label: "MVP1 launch", value: "Shared worker token", note: "Every SLA/evidence/notification job caller must authenticate." },
      { label: "Future hardening", value: "Managed workload identity", note: "Can replace shared token after platform choice." },
    ],
    optionSummary: "SLA, evidence-scan, and notification workers must authenticate with an approved service token.",
  },
  {
    id: "citizen-otp",
    title: "Citizen OTP / SMS",
    owner: "Citizen verification owner",
    readinessControlId: "infra-citizen-otp-provider-ready",
    referenceControlId: "infra-citizen-otp-config-ref",
    checks: ["citizen_otp_provider", "mock_otp_exposure"],
    requiredEnv: ["WHISTLE_OTP_PROVIDER_MODE", "WHISTLE_OTP_PROVIDER_WEBHOOK_URL", "WHISTLE_EXPOSE_MOCK_OTP"],
    secretEnv: ["WHISTLE_OTP_PROVIDER_API_KEY"],
    options: [
      { label: "MVP default", value: "Phone OTP only", note: "Citizen phone verification remains the baseline launch policy." },
      { label: "Provider mode", value: "WHISTLE_OTP_PROVIDER_MODE=webhook", note: "Approved SMS provider with hidden OTP responses." },
      { label: "Future policy", value: "Govt ID by category", note: "Use only after state policy, legal review, and provider reference." },
    ],
    policyControlIds: ["citizen-phone-otp-required", "identity-gov-id-policy-mode", "identity-gov-id-required-categories", "identity-gov-id-provider-config-ref"],
    optionSummary: "Use webhook delivery with provider receipts, retry policy, abuse monitoring, and hidden OTP responses.",
  },
  {
    id: "evidence",
    title: "Evidence storage / KMS / scanning",
    owner: "Evidence security owner",
    readinessControlId: "infra-evidence-storage-ready",
    referenceControlId: "infra-evidence-storage-config-ref",
    checks: ["evidence_object_storage", "evidence_scanning_kms"],
    requiredEnv: ["WHISTLE_EVIDENCE_OBJECT_STORE_MODE", "WHISTLE_EVIDENCE_S3_ENDPOINT", "WHISTLE_EVIDENCE_S3_BUCKET", "WHISTLE_EVIDENCE_KMS_KEY_ID", "WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED"],
    secretEnv: ["Object-store credentials from secret manager"],
    options: [
      { label: "Local dev", value: "Mock/local metadata", note: "No raw production evidence." },
      { label: "MVP1 launch", value: "S3-compatible private bucket", note: "Short-lived upload sessions and private object access." },
      { label: "Required controls", value: "KMS + scanner + India residency", note: "Protected reports cannot launch without these." },
    ],
    optionSummary: "Use private object storage, short-lived signed URLs, KMS encryption, scanner declaration, retention, and data-residency approval.",
  },
  {
    id: "notifications",
    title: "Citizen notifications",
    owner: "Notification owner",
    readinessControlId: "infra-notification-provider-ready",
    referenceControlId: "infra-notification-provider-config-ref",
    checks: ["notification_delivery_provider"],
    requiredEnv: ["WHISTLE_NOTIFICATION_PROVIDER_MODE", "WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL"],
    secretEnv: ["WHISTLE_NOTIFICATION_PROVIDER_API_KEY"],
    options: [
      { label: "Local dev", value: "Mock/in-app only", note: "Safe for prototypes and unit smoke tests." },
      { label: "MVP1 launch", value: "SMS webhook", note: "Stage updates with delivery receipts." },
      { label: "Protected track", value: "No WhatsApp for protected tickets", note: "Use generic citizen-safe notification copy." },
    ],
    optionSummary: "Use approved SMS/WhatsApp provider contracts, localized templates, delivery receipts, and protected-ticket copy restrictions.",
  },
  {
    id: "rate-limits",
    title: "Distributed public rate limits",
    owner: "Network/performance owner",
    readinessControlId: "infra-distributed-rate-limit-ready",
    referenceControlId: "infra-rate-limit-config-ref",
    checks: ["distributed_rate_limits", "rate_limit_bucket_salt"],
    requiredEnv: ["WHISTLE_RATE_LIMIT_BACKEND", "WHISTLE_RATE_LIMIT_GATEWAY_URL", "WHISTLE_RATE_LIMIT_KEY_SALT"],
    secretEnv: ["WHISTLE_RATE_LIMIT_GATEWAY_API_KEY"],
    options: [
      { label: "Local dev", value: "In-memory", note: "Single-process only; not launch-safe." },
      { label: "MVP1 launch", value: "Postgres or gateway", note: "Shared buckets across app instances." },
      { label: "Privacy", value: "Secret salt + hashed keys", note: "Never store raw phone/IP buckets." },
    ],
    optionSummary: "Use a shared backend such as gateway, Postgres, Redis, or edge rate limiting with hashed citizen buckets.",
  },
  {
    id: "deployment-observability",
    title: "Deployment, SIEM, telemetry",
    owner: "Observability/operations owner",
    readinessControlId: "infra-deployment-runbook-ready",
    referenceControlId: "infra-deployment-observability-config-ref",
    checks: ["cors_origin_allowlist", "deployment_secret_material", "deployment_backup_runbook", "siem_audit_export", "otel_metrics_export"],
    requiredEnv: ["WHISTLE_ALLOWED_ORIGINS", "WHISTLE_DEPLOYMENT_RUNBOOK_VERSION", "WHISTLE_BACKUP_RESTORE_DRILL_AT", "WHISTLE_SECURITY_EXPORT_MODE", "WHISTLE_TELEMETRY_EXPORT_MODE"],
    secretEnv: ["WHISTLE_SECURITY_EXPORT_API_KEY", "WHISTLE_AUDIT_EXPORT_API_KEY", "OTLP bearer/header secrets"],
    options: [
      { label: "Origins", value: "Explicit allowlist", note: "Citizen PWA and government consoles only." },
      { label: "Audit export", value: "SIEM/WORM webhook", note: "Redacted immutable retention path." },
      { label: "Telemetry", value: "OTLP HTTP", note: "SLO and saturation watch during launch." },
    ],
    optionSummary: "Approve runbook version, restore-drill evidence, SIEM/WORM export, telemetry endpoint, and origin allowlist before launch.",
  },
];

const operatorUatItems: OperatorUatItem[] = [
  {
    id: "citizen-lifecycle",
    title: "Citizen lifecycle rehearsal",
    owner: "Citizen support + Verification",
    controlId: "uat-citizen-lifecycle-rehearsed",
    flows: ["Submit complaint", "Phone OTP", "My Tickets lookup", "Add more info", "Citizen-safe updates"],
    evidence: "Attach rehearsal packet or UAT run id covering submit, track, clarification, and closure/dispute behavior.",
  },
  {
    id: "verification-sop",
    title: "Verification SOP and training",
    owner: "Verification lead",
    controlId: "uat-verification-sop-approved",
    flows: ["Data completeness", "Request info", "Route", "Reject", "Rejection review handoff"],
    evidence: "Confirm operators can clear intake in two days and know when to request missing evidence instead of rejecting.",
  },
  {
    id: "role-dashboards",
    title: "Role dashboard rehearsal",
    owner: "MLA, Minister, CM Cell offices",
    controlId: "uat-role-dashboard-rehearsed",
    flows: ["MLA local queue", "Minister ministry queue", "CM Cell escalation view", "Primary/secondary queue visibility"],
    evidence: "Run role-scoped dashboards with representative actors and confirm no protected identity leakage.",
  },
  {
    id: "protected-track",
    title: "Protected-track SOP",
    owner: "CM Cell + protected review",
    controlId: "uat-protected-track-sop-approved",
    flows: ["Corruption intake", "Protected screening", "Masked identity", "Sensitive audit reason", "CM/review access"],
    evidence: "Approve protected complaint handling before expanding beyond controlled pilot categories.",
  },
  {
    id: "defect-triage",
    title: "MVP1 defect triage",
    owner: "UAT operations",
    controlId: "uat-defect-triage-ready",
    flows: ["Severity labels", "Launch hold rule", "Owner assignment", "Retest evidence", "MVP2 deferral rule"],
    evidence: "Accept a single triage queue so MVP1 bugs are not mixed with MVP2-MVP4 feature ideas.",
  },
];

const operatorUatTriageLanes: OperatorUatTriageLane[] = [
  {
    severity: "Blocker",
    decision: "Launch hold",
    examples: ["Citizen cannot submit/track", "Protected identity leak", "SLA/audit/routing broken", "Any production preflight blocker"],
    action: "Fix, retest, and attach evidence before sign-off.",
  },
  {
    severity: "Critical",
    decision: "Fix or explicit launch-owner acceptance",
    examples: ["Dashboard answers wrong operating question", "Citizen copy creates duplicate complaints", "Worker recovery needs manual runbook"],
    action: "Assign owner, acceptance test, due date, and approving authority.",
  },
  {
    severity: "Major",
    decision: "Triage before launch",
    examples: ["Secondary queue count is unclear", "Admin wording needs polish", "Pilot owner is ambiguous"],
    action: "Keep in MVP1 only if active launch flow safety or clarity is affected.",
  },
  {
    severity: "Minor",
    decision: "Can defer with owner",
    examples: ["Copy polish", "Visual spacing", "Convenience filter", "MVP2 transparency idea"],
    action: "Log with phase tag and owner; do not expand MVP1 for convenience work.",
  },
];

const operatorUatDefectItems: OperatorUatDefectItem[] = [
  {
    id: "blocker",
    label: "Blocker defects",
    controlId: "uat-open-blocker-defects",
    launchRule: "Must be zero. Cannot defer to MVP2-MVP4.",
    tone: "danger",
  },
  {
    id: "critical",
    label: "Critical defects",
    controlId: "uat-open-critical-defects",
    launchRule: "Must be fixed or explicitly accepted before launch.",
    tone: "danger",
  },
  {
    id: "major",
    label: "Major defects",
    controlId: "uat-open-major-defects",
    launchRule: "Must be triaged with owner, phase tag, and acceptance.",
    tone: "warn",
  },
  {
    id: "minor",
    label: "Minor defects",
    controlId: "uat-open-minor-defects",
    launchRule: "Can defer with owner and retest path.",
    tone: "neutral",
  },
];

const uatCommands: UatCommand[] = [
  { label: "Start Postgres", command: "npm run db:up" },
  { label: "Apply schema", command: "DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run db:migrate" },
  { label: "Check local UAT env", command: "npm run mvp1:uat-preflight" },
  { label: "Seed browser data", command: "npm run mvp1:uat-seed -- --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.md" },
  { label: "Seed assertion JSON", command: "npm run mvp1:uat-seed -- --json --quiet --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.json" },
  { label: "Run role assertions", command: "npm run mvp1:uat-run -- --run-id <run-id> --seed-file artifacts/whistle-mvp1-local-uat-seed.json --out artifacts/whistle-mvp1-local-uat-run.md" },
  { label: "Generate defect register", command: "npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md" },
  { label: "Generate sign-off checklist", command: "npm run mvp1:uat-signoff -- --run-id <run-id> --out artifacts/whistle-mvp1-uat-signoff.md" },
  { label: "Run API", command: "npm run api:dev:mvp1-uat" },
  { label: "Run frontend", command: "npm run dev -- --host 127.0.0.1" },
];

const uatRoleAccounts: UatRoleAccount[] = [
  { label: "Prototype Admin", actor: "admin:prototype", role: "Admin", surface: "Admin controls", path: "/admin.html#launch", storageKey: "whistle.officialBearerToken.admin:prototype" },
  { label: "Second Admin Reviewer", actor: "admin:reviewer", role: "Admin", surface: "Governance approvals", path: "/admin.html#launch", storageKey: "whistle.officialBearerToken.admin:reviewer" },
  { label: "Verification Officer", actor: "verification:prototype", role: "Verification", surface: "Verification console", path: "/verification.html", storageKey: "whistle.officialBearerToken.verification:prototype" },
  { label: "CM Cell Officer", actor: "cm_cell:prototype", role: "CM Cell", surface: "CM Cell dashboard", path: "/cm-cell.html", storageKey: "whistle.officialBearerToken.cm_cell:prototype" },
  { label: "MAWS Minister", actor: "minister:prototype", role: "Minister", surface: "Ministry console", path: "/ministry.html", storageKey: "whistle.officialBearerToken.minister:prototype" },
  { label: "MAWS Department Officer", actor: "department_officer:prototype", role: "Department Officer", surface: "Ministry queue", path: "/ministry.html", storageKey: "whistle.officialBearerToken.department_officer:prototype" },
  { label: "Velachery MLA", actor: "mla:prototype", role: "MLA", surface: "MLA dashboard", path: "/mla.html", storageKey: "whistle.officialBearerToken.mla:prototype" },
  { label: "Ward 48 Councillor", actor: "councillor:prototype", role: "Councillor", surface: "Local scope", path: "/mla.html", storageKey: "whistle.officialBearerToken.councillor:prototype" },
];

const uatSeedScenarios: UatSeedScenario[] = [
  {
    key: "cm-escalated",
    title: "Velachery sanitation CM escalation",
    queue: "Primary CM Cell",
    status: "Escalated",
    surface: "CM Cell tickets",
    assertion: "Escalated ticket remains visible to ministry/local secondary queues.",
  },
  {
    key: "ministry-queue",
    title: "Velachery sanitation MAWS proof queue",
    queue: "Primary ministry",
    status: "In progress",
    surface: "Ministry dashboard",
    assertion: "Minister sees only assigned-ministry tickets and SLA risk.",
  },
  {
    key: "mla-local",
    title: "Velachery sanitation local visit",
    queue: "Primary local",
    status: "Assigned",
    surface: "MLA dashboard",
    assertion: "MLA can close local issues before escalation.",
  },
  {
    key: "councillor-ward-48",
    title: "Ward 48 local queue",
    queue: "Primary local",
    status: "Assigned",
    surface: "Councillor scope",
    assertion: "Councillor/local owner sees ward-level issue only.",
  },
  {
    key: "awaiting-citizen",
    title: "Awaiting citizen clarification",
    queue: "Citizen",
    status: "Awaiting citizen",
    surface: "Verification console",
    assertion: "SLA pauses while citizen is asked for missing information.",
  },
  {
    key: "protected-corruption",
    title: "Protected corruption screening",
    queue: "Protected review",
    status: "Screening",
    surface: "CM/protected queue",
    assertion: "Protected identity remains hidden from local, MLA, and minister roles.",
  },
  {
    key: "rejection-review",
    title: "CM-maintained rejection review",
    queue: "Rejection review",
    status: "Rejected review",
    surface: "CM Cell review",
    assertion: "Rejected tickets are reviewed outside local visibility.",
  },
  {
    key: "verification-new",
    title: "Fresh intake item",
    queue: "Verification",
    status: "Submitted",
    surface: "Verification console",
    assertion: "Manual route, request-info, reject, and protected-flag paths can be tested.",
  },
  {
    key: "resolved",
    title: "Resolved closure sample",
    queue: "Local history",
    status: "Resolved",
    surface: "Ticket detail",
    assertion: "Closure checklist, citizen timeline, and reopen/dispute paths are inspectable.",
  },
];

const deploymentOpsItems: DeploymentOpsItem[] = [
  {
    id: "restore-drill",
    title: "Production-like restore drill",
    owner: "Database / platform owner",
    controlId: "ops-restore-drill-signed-off",
    evidenceControlId: "ops-restore-drill-evidence-ref",
    checks: ["deployment_backup_runbook", "database_persistence"],
    proof: "Attach the restore-drill packet or CI run proving schema, tickets, audit hash chain, and correlation IDs restore together.",
  },
  {
    id: "siem-worm",
    title: "SIEM/WORM audit export",
    owner: "Security owner",
    controlId: "ops-siem-worm-signed-off",
    evidenceControlId: "ops-siem-worm-evidence-ref",
    checks: ["siem_audit_export"],
    proof: "Attach the SIEM/WORM webhook or WORM-store evidence showing redacted audit exports are accepted.",
  },
  {
    id: "telemetry-watch",
    title: "Telemetry launch watch",
    owner: "Observability owner",
    controlId: "ops-telemetry-launch-watch-signed-off",
    evidenceControlId: "ops-telemetry-launch-watch-evidence-ref",
    checks: ["otel_metrics_export"],
    proof: "Confirm API SLO, route counters, saturation signals, and sanitized OpenTelemetry export are watched during launch.",
  },
  {
    id: "origin-allowlist",
    title: "Origin allowlist and headers",
    owner: "Network/security owner",
    controlId: "ops-origin-allowlist-signed-off",
    evidenceControlId: "ops-origin-allowlist-evidence-ref",
    checks: ["cors_origin_allowlist", "api_security_headers", "deployment_secret_material"],
    proof: "Confirm browser origins, copied-template guards, HSTS, and API security headers are production-safe.",
  },
  {
    id: "incident-holds",
    title: "Incident hold conditions",
    owner: "CM Cell + operations owner",
    controlId: "ops-incident-hold-policy-signed-off",
    evidenceControlId: "ops-incident-hold-policy-evidence-ref",
    checks: ["deployment_backup_runbook", "siem_audit_export", "otel_metrics_export"],
    proof: "Confirm hold rules for provider failure, SLA worker lag, protected-track incidents, and evidence pipeline failure.",
  },
];

const deploymentQuestionItems: DeploymentQuestionItem[] = [
  {
    id: "domains",
    title: "Staging/prod domains and browser origins",
    owner: "Deployment owner",
    question: "What exact HTTPS origins will host the citizen PWA, government consoles, and API in staging and production?",
    answerFormat: "staging citizen=https://..., staging govt=https://..., staging api=https://..., prod citizen=https://..., prod govt=https://..., prod api=https://...",
    why: "The API must reject unknown browser origins before any public or government UAT launch.",
  },
  {
    id: "runtime",
    title: "Target hosting and runtime",
    owner: "Platform owner",
    question: "Where will the static frontend, API process, background workers, and scheduled jobs run for staging and production?",
    answerFormat: "frontend=<platform>, api=<runtime>, workers=<runtime>, scheduler=<runtime>, region=<approved region>",
    why: "The deployment preflight and runbook must match the actual runtime shape, not a placeholder architecture.",
  },
  {
    id: "postgres",
    title: "Postgres environment confirmation",
    owner: "Database owner",
    question: "Which managed Postgres environments are approved for staging and production, and who controls schema migration execution?",
    answerFormat: "staging db=<managed service/ref>, prod db=<managed service/ref>, migration owner=<name/team>, backup policy=<policy ref>",
    why: "The secure ticket spine depends on durable ticket, audit, SLA, access, and rate-limit data.",
  },
  {
    id: "restore",
    title: "Backup/restore owner and drill date",
    owner: "Database + operations owners",
    question: "Who owns the production-like restore drill and what exact drill date/window should be recorded before launch?",
    answerFormat: "owner=<name/team>, drill window=<YYYY-MM-DD HH:mm zone>, evidence ref=artifact://whistle/mvp1/restore-drill/<run-id>",
    why: "MVP1 should not launch until the team proves tickets, audit chain, config, and correlation IDs can be restored together.",
  },
  {
    id: "incident-holds",
    title: "Incident launch-hold rules",
    owner: "CM Cell + operations owner",
    question: "Which incidents must pause launch or intake immediately, and who has authority to resume?",
    answerFormat: "hold if=<conditions>, commander=<role>, resume authority=<role>, evidence ref=artifact://whistle/mvp1/incident-hold-policy/<run-id>",
    why: "Protected identity leaks, provider outages, evidence failures, and SLA-worker lag need pre-agreed stop rules.",
  },
];

const launchEvidenceReferenceHints: Record<string, string> = {
  "platform-postgres-migration-evidence-ref": "Expected: artifact://whistle/mvp1/postgres-migration/<run-id>",
  "platform-postgres-mvp-check-evidence-ref": "Expected: artifact://whistle/mvp1/postgres-mvp-check/<run-id>",
  "uat-launch-rehearsal-evidence-ref": "Expected: artifact://whistle/mvp1/rehearsal-packet/<run-id>",
  "uat-defect-register-ref": "Expected: artifact://whistle/mvp1/defect-register/<run-id>",
  "ops-restore-drill-evidence-ref": "Expected: artifact://whistle/mvp1/restore-drill/<run-id>",
  "ops-siem-worm-evidence-ref": "Expected: artifact://whistle/mvp1/siem-worm-export/<run-id>",
  "ops-telemetry-launch-watch-evidence-ref": "Expected: artifact://whistle/mvp1/telemetry-launch-watch/<run-id>",
  "ops-origin-allowlist-evidence-ref": "Expected: artifact://whistle/mvp1/origin-allowlist/<run-id>",
  "ops-incident-hold-policy-evidence-ref": "Expected: artifact://whistle/mvp1/incident-hold-policy/<run-id>",
};

const providerReferenceHints: Record<string, string> = {
  "infra-official-oidc-config-ref": "Expected: secret-manager://whistle/mvp1/official-oidc-mfa/<ref-id>",
  "infra-worker-auth-config-ref": "Expected: secret-manager://whistle/mvp1/worker-auth/<ref-id>",
  "infra-citizen-otp-config-ref": "Expected: secret-manager://whistle/mvp1/citizen-otp-provider/<ref-id>",
  "infra-evidence-storage-config-ref": "Expected: secret-manager://whistle/mvp1/evidence-storage-kms-scanner/<ref-id>",
  "infra-notification-provider-config-ref": "Expected: provider-contract://whistle/mvp1/notification-provider/<contract-id>",
  "infra-rate-limit-config-ref": "Expected: secret-manager://whistle/mvp1/rate-limit-provider/<ref-id>",
  "infra-deployment-observability-config-ref": "Expected: ops://whistle/mvp1/observability-siem-telemetry/<ref-id>",
  "identity-gov-id-provider-config-ref": "Expected when enabled: policy://whistle/mvp1/gov-id-policy/<policy-id>",
};

function providerReferenceUiIssue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "reference pending";
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("pending-") || normalized.startsWith("not-enabled")) return "reference pending";
  if (/^https?:\/\//.test(normalized) || /^file:\/\//.test(normalized) || /^data:/.test(normalized) || /^postgres:\/\//.test(normalized)) {
    return "raw ref blocked";
  }
  if (!/^(secret-manager|provider-contract|ops|policy|kms):\/\//.test(normalized)) return "controlled ref required";
  if (!normalized.includes("mvp1")) return "MVP1 ref required";
  return null;
}

function launchEvidenceUiIssue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "evidence pending";
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("pending-") || normalized.startsWith("not-enabled")) return "evidence pending";
  if (/^https?:\/\//.test(normalized) || /^file:\/\//.test(normalized) || /^data:/.test(normalized) || /^postgres:\/\//.test(normalized)) {
    return "raw evidence blocked";
  }
  if (!/^(artifact|runbook|ops|siem):\/\//.test(normalized)) return "controlled artifact required";
  if (!normalized.includes("mvp1")) return "MVP1 evidence required";
  return null;
}

const initialCategories: CategoryConfig[] = [
  { id: "corruption", labelEn: "Corruption", labelTa: "ஊழல்", sensitivity: "protected", enabled: true },
  { id: "roads", labelEn: "Roads", labelTa: "சாலைகள்", sensitivity: "identity_masked", enabled: true },
  { id: "water", labelEn: "Water", labelTa: "தண்ணீர்", sensitivity: "identity_masked", enabled: true },
  { id: "power", labelEn: "Power", labelTa: "மின்சாரம்", sensitivity: "identity_masked", enabled: true },
  { id: "sanitation", labelEn: "Sanitation", labelTa: "சுகாதாரம்", sensitivity: "identity_masked", enabled: true },
  { id: "safety", labelEn: "Public Safety", labelTa: "பொது பாதுகாப்பு", sensitivity: "identity_masked", enabled: true },
  { id: "health", labelEn: "Health", labelTa: "சுகாதார சேவை", sensitivity: "identity_masked", enabled: true },
  { id: "education", labelEn: "Education", labelTa: "கல்வி", sensitivity: "identity_masked", enabled: true },
  { id: "revenue", labelEn: "Revenue", labelTa: "வருவாய்", sensitivity: "identity_masked", enabled: true },
  { id: "ration", labelEn: "Ration / PDS", labelTa: "ரேஷன் / பொது விநியோகம்", sensitivity: "identity_masked", enabled: true },
  { id: "other", labelEn: "Other", labelTa: "மற்றவை", sensitivity: "identity_masked", enabled: true },
];

const initialReadiness: CategoryReadiness[] = [
  {
    categoryId: "corruption",
    primaryOwner: "Protected Screening / CM Cell",
    slaSummary: "State-configured protected screening before any wider routing",
    escalationPath: "Protected screening -> CM Cell/protected authority",
    roleAccess: ["Verification", "CM Cell", "Protected Review"],
    publicVisibility: "No raw public visibility; aggregate-only after policy approval",
    privacyLevel: "protected",
    sopStatus: "scheduled",
    trainingStatus: "scheduled",
    launchState: "pilot_only",
    notes: "Keep protected-only until legal, vigilance, evidence, and safety SOPs are approved.",
  },
  {
    categoryId: "roads",
    primaryOwner: "Local/MLA, then Highways or Local Body",
    slaSummary: "2d verification, 7d local, 10d ministry",
    escalationPath: "Local/MLA -> Ministry -> CM Cell",
    roleAccess: ["Verification", "MLA", "Minister", "CM Cell"],
    publicVisibility: "V2 aggregate only",
    privacyLevel: "identity_masked",
    sopStatus: "approved",
    trainingStatus: "approved",
    launchState: "ready",
    notes: "Core civic launch category.",
  },
  {
    categoryId: "water",
    primaryOwner: "Local/MLA, then MAWS",
    slaSummary: "2d verification, 7d local, 10d ministry",
    escalationPath: "Local/MLA -> Municipal Administration and Water Supply -> CM Cell",
    roleAccess: ["Verification", "MLA", "Minister", "CM Cell"],
    publicVisibility: "V2 aggregate only",
    privacyLevel: "identity_masked",
    sopStatus: "approved",
    trainingStatus: "approved",
    launchState: "ready",
    notes: "Core civic launch category.",
  },
  {
    categoryId: "safety",
    primaryOwner: "Verification-approved public safety authority",
    slaSummary: "State-configured based on severity",
    escalationPath: "Verification -> Approved authority -> CM Cell",
    roleAccess: ["Verification", "Restricted Owner", "CM Cell"],
    publicVisibility: "V2 aggregate only with thresholds",
    privacyLevel: "identity_masked",
    sopStatus: "scheduled",
    trainingStatus: "scheduled",
    launchState: "pilot_only",
    notes: "Pilot with restricted SOP because public-safety reports can be sensitive.",
  },
];

const initialSlaPolicies: SlaPolicy[] = [
  { stage: "verification", label: "Verification SLA", durationDays: 2, escalationTarget: "Verification lead", enabled: true },
  { stage: "local", label: "Local / MLA SLA", durationDays: 7, escalationTarget: "Assigned ministry", enabled: true },
  { stage: "ministry", label: "Ministry SLA", durationDays: 10, escalationTarget: "CM Cell", enabled: true },
  { stage: "cm_cell", label: "CM Cell intervention SLA", durationDays: 7, escalationTarget: "CM Cell Director", enabled: true },
  { stage: "rejection_review", label: "Rejection review SLA", durationDays: 3, escalationTarget: "CM-maintained review lead", enabled: true },
];

const initialAuditEvents: AdminAuditEvent[] = [
  {
    id: "audit-001",
    time: "Today 10:30",
    actor: "Meera Iyer",
    action: "Opened admin console",
    summary: "Reviewed users, access grants, app controls, and setup health.",
    tone: "neutral",
  },
  {
    id: "audit-002",
    time: "Yesterday 17:12",
    actor: "Meera Iyer",
    action: "Minister team grant saved",
    summary: "MAWS Minister Team scoped to Municipal Administration & Water Supply.",
    tone: "good",
  },
  {
    id: "audit-003",
    time: "Yesterday 16:44",
    actor: "Setup health",
    action: "Risk flagged",
    summary: "Ward 48 Local Field Cell has no owner.",
    tone: "warn",
  },
];

const fallbackMvpScopeReport: MvpScopeReport = {
  generatedAt: "local-prototype",
  source: "admin_config_and_access_snapshot",
  activeBuild: "MVP1",
  currentBuildOrder: ["MVP1", "MVP2", "MVP3", "MVP4"],
  overallImplementationPercent: 55,
  overallLaunchReadinessPercent: 33,
  principles: [
    "MVP1 proves operational accountability before public transparency or autonomy.",
    "The ticket spine owns lifecycle state, queues, SLAs, audit, and notifications.",
    "Agents and dashboards read governed projections; they do not own state transitions.",
    "Protected complaints stay compartmentalized until legal, SOP, and safety controls are approved.",
  ],
  activeBuildWorkstreams: [
    {
      id: "mvp1-core-spine-hardening",
      phaseId: "MVP1",
      title: "Core ticket-spine hardening",
      owner: "engineering",
      status: "partial",
      parallelizable: true,
      summary: "Keep MVP1 flows stable while production runtime seams are replaced.",
      nextActions: ["Run MVP1 regression checks after every change.", "Keep MVP2-MVP4 out of active build work."],
      blockers: ["Production identity and provider seams still need approved wiring."],
      evidence: ["Citizen, verification, SLA, audit, and dashboard prototype flows exist."],
    },
    {
      id: "mvp1-assets-and-public-identity",
      phaseId: "MVP1",
      title: "Asset and public identity approvals",
      owner: "government_ops",
      status: "done",
      parallelizable: true,
      summary: "Use neutral Whistle-owned placeholder assets unless official marks are separately approved.",
      nextActions: ["Keep MVP1 public surfaces on neutral assets.", "Record any future official-asset use through Admin critical config controls."],
      blockers: [],
      evidence: ["Neutral placeholder logo, civic mark, portrait replacement, and disclaimer clear the MVP1 asset gate."],
    },
    {
      id: "mvp1-provider-and-scale-readiness",
      phaseId: "MVP1",
      title: "Provider and scale readiness",
      owner: "external_provider",
      status: "blocked",
      parallelizable: true,
      summary: "Approve government identity policy and configure OTP/SMS, evidence, notification, and rate-limit providers.",
      nextActions: ["Collect identity decision, provider endpoints, and credentials.", "Verify deployment preflight in staging."],
      blockers: ["Provider contracts and runtime variables are pending."],
      evidence: ["Deployment preflight names unresolved production seams."],
    },
    {
      id: "mvp1-operator-uat-and-sop",
      phaseId: "MVP1",
      title: "Operator UAT and SOP sign-off",
      owner: "uat_ops",
      status: "partial",
      parallelizable: true,
      summary: "Run MVP1-only rehearsal with Verification, MLA, Minister, CM Cell, and Admin operators.",
      nextActions: ["Generate the MVP1 launch rehearsal packet.", "Test submit, verify, route, escalate, reject-review, resolve, and track.", "Capture only MVP1 defects."],
      blockers: ["MVP1 rehearsal evidence and operator SOP sign-offs are pending."],
      evidence: ["Core role surfaces exist for UAT and Admin now tracks rehearsal evidence plus critical sign-off controls."],
    },
    {
      id: "mvp1-deployment-and-incident-readiness",
      phaseId: "MVP1",
      title: "Deployment, backup, and incident readiness",
      owner: "security_legal",
      status: "blocked",
      parallelizable: true,
      summary: "Approve runbook evidence, restore drill, SIEM/WORM export, telemetry, and incident hold conditions.",
      nextActions: ["Run a restore drill against production-like data.", "Configure SIEM/WORM and telemetry exports.", "Approve launch hold conditions."],
      blockers: ["Deployment, backup, SIEM, and incident evidence are pending."],
      evidence: ["Production runbook smoke tests define the required evidence."],
    },
  ],
  phases: [
    {
      id: "MVP1",
      title: "Core accountability launch",
      purpose: "Prove that Whistle can receive, verify, route, escalate, audit, and explain tickets safely.",
      status: "partial",
      implementationPercent: 65,
      launchReadinessPercent: 35,
      includedSurfaces: ["Citizen PWA", "Verification Console", "MLA Dashboard", "Minister Dashboard", "CM Cell Dashboard", "Admin Console"],
      deferredSurfaces: ["Public transparency", "Autonomous agents", "Full field workbenches", "Native apps"],
      exitCriteria: [
        "Citizens submit and track tickets through the lifecycle.",
        "Verification routes, requests information, rejects, and protects sensitive cases.",
        "Role-scoped dashboards do not leak unrelated data.",
      ],
      items: [
        {
          id: "citizen-pwa",
          label: "Citizen PWA and verified ticket tracking",
          status: "done",
          evidence: ["Prototype PWA and ticket spine flows exist."],
          gaps: ["Production OTP/SMS provider is pending."],
        },
        {
          id: "role-dashboards",
          label: "Verification, MLA, Minister, CM Cell, and Admin surfaces",
          status: "partial",
          evidence: ["Role surfaces exist and read live MVP data when API is available."],
          gaps: ["Production identity-policy approval and government UAT are pending."],
        },
        {
          id: "asset-identity-approval",
          label: "Asset, emblem, portrait, and disclaimer approvals",
          status: "done",
          evidence: ["MVP1 defaults use neutral Whistle-owned placeholder assets."],
          gaps: [],
        },
        {
          id: "operator-uat-signoff",
          label: "MVP1 operator rehearsal and SOP sign-off",
          status: "partial",
          evidence: ["Admin App Controls track rehearsal evidence, SOP approvals, role-dashboard rehearsal, protected-track SOP, and defect triage."],
          gaps: ["Real operator rehearsal sign-off is pending."],
        },
      ],
      nextActions: ["Approve mobile/password plus OTP policy or configure mandated SSO.", "Run V1 UAT with core operators."],
    },
    {
      id: "MVP2",
      title: "Transparency and recommend-only intelligence",
      purpose: "Add aggregate public trust surfaces and AI recommendations after MVP1 stabilizes.",
      status: "partial",
      implementationPercent: 50,
      launchReadinessPercent: 25,
      includedSurfaces: ["Public Transparency Portal", "Recommendation history", "CM/ministry briefs"],
      deferredSurfaces: ["Autonomous lifecycle mutation", "Raw public ticket details"],
      exitCriteria: ["Public aggregates reconcile with internal counts.", "Agent recommendations remain non-mutating."],
      items: [
        {
          id: "public-transparency",
          label: "Aggregate public transparency",
          status: "partial",
          evidence: ["Prototype aggregate transparency exists."],
          gaps: ["Publishing delay and privacy threshold policy are pending."],
        },
      ],
      nextActions: ["Define public threshold policy.", "Add agent evaluation data and reviewer acceptance criteria."],
    },
    {
      id: "MVP3",
      title: "Field execution and department operations",
      purpose: "Move from oversight into daily closure workflows for department and local teams.",
      status: "partial",
      implementationPercent: 35,
      launchReadinessPercent: 15,
      includedSurfaces: ["Department Officer Workbench", "Councillor/Local Workbench", "Field visits", "Citizen reopen/dispute"],
      deferredSurfaces: ["Deep integrations", "Offline sync until field pilot design is approved"],
      exitCriteria: ["Field teams execute daily work from queues.", "Closure evidence and reopen rates are auditable."],
      items: [
        {
          id: "field-actions",
          label: "Field action API primitives",
          status: "partial",
          evidence: ["Field action workflow exists in the MVP API."],
          gaps: ["Dedicated field workbench UIs are not complete."],
        },
      ],
      nextActions: ["Design field workbench IA.", "Add owner assignment and workload balancing."],
    },
    {
      id: "MVP4",
      title: "Advanced governance and scale",
      purpose: "Harden Whistle into a statewide and reusable accountability platform.",
      status: "not_started",
      implementationPercent: 15,
      launchReadinessPercent: 10,
      includedSurfaces: ["Advanced protected workflow", "Audit exports", "Warehouse analytics", "Native/kiosk/call-center channels"],
      deferredSurfaces: ["Any advanced identity feature without legal approval"],
      exitCriteria: ["Sensitive workflows are approved and auditable.", "Warehouse and audit exports reconcile with operational records."],
      items: [
        {
          id: "advanced-governance",
          label: "Advanced governance and scale-out",
          status: "not_started",
          evidence: ["Roadmap reserves this for later phases."],
          gaps: ["OIDC, KMS, SIEM/WORM, data warehouse, native, kiosk, and integration decisions remain open."],
        },
      ],
      nextActions: ["Decide hosting, identity, data residency, KMS, and audit export standards."],
    },
  ],
};

const fallbackMvp1LaunchHandoffReport: Mvp1LaunchHandoffReport = {
  kind: "whistle-mvp1-launch-handoff",
  generatedAt: "local-prototype",
  source: "admin_config_access_and_deployment_preflight",
  activeBuild: "MVP1",
  implementationPercent: 78,
  launchReadinessPercent: 35,
  launchVerdict: "no_go",
  launchScore: 35,
  lanes: [
    {
      id: "platform-postgres",
      owner: "platform",
      title: "Platform and Postgres spine",
      purpose: "Run the secure ticket spine on durable Postgres with migrations, backup, restore, and shared public-rate buckets.",
      status: "needs_evidence",
      adminControls: [],
      runtimeChecks: [],
      requiredEnv: ["DATABASE_URL", "WHISTLE_RATE_LIMIT_BACKEND", "WHISTLE_RATE_LIMIT_KEY_SALT"],
      commands: ["DATABASE_URL=<target-postgres> npm run db:migrate", "DATABASE_URL=<target-postgres> npm run mvp:check:postgres"],
      blockers: ["Target Postgres, backup, restore, and shared rate-limit evidence must be attached."],
      nextActions: ["Provision target Postgres.", "Run migrations.", "Attach backup/restore evidence."],
      evidenceNeeded: ["Migration output", "Postgres-backed MVP check", "Backup/restore drill packet"],
    },
    {
      id: "identity-and-worker-auth",
      owner: "identity",
      title: "Official identity and worker auth",
      purpose: "Approve the government-console identity model and require service authentication for all worker jobs.",
      status: "blocked",
      adminControls: [],
      runtimeChecks: [],
      requiredEnv: ["WHISTLE_PROTOTYPE_OFFICIAL_AUTH", "WHISTLE_OFFICIAL_OIDC_ISSUER", "WHISTLE_WORKER_SHARED_SECRET"],
      commands: ["npm run smoke:official-auth", "npm run smoke:worker-auth"],
      blockers: ["Government identity-policy approval and worker secret-manager reference are pending."],
      nextActions: ["Approve mobile/password plus OTP policy or attach SSO metadata.", "Confirm OTP/MFA claim policy.", "Configure worker token."],
      evidenceNeeded: ["Identity policy or OIDC issuer/audience/JWKS reference", "OTP/MFA assurance proof", "Worker runtime secret-manager reference"],
    },
    {
      id: "citizen-verification-and-messaging",
      owner: "external_provider",
      title: "Citizen OTP, notifications, and identity policy",
      purpose: "Keep MVP1 phone-OTP-first while wiring approved OTP/SMS and status-update providers.",
      status: "needs_evidence",
      adminControls: [],
      runtimeChecks: [],
      requiredEnv: ["WHISTLE_OTP_PROVIDER_MODE", "WHISTLE_NOTIFICATION_PROVIDER_MODE", "WHISTLE_EXPOSE_MOCK_OTP"],
      commands: ["npm run smoke:otp-delivery", "npm run smoke:notification-provider", "npm run smoke:notification-templates"],
      blockers: ["OTP/SMS and notification provider references are pending."],
      nextActions: ["Attach OTP/SMS provider reference.", "Attach notification provider reference.", "Keep Government ID disabled unless policy-approved."],
      evidenceNeeded: ["Provider contract/reference", "Delivery receipt test", "Citizen-safe Tamil/English copy approval"],
    },
    {
      id: "evidence-and-protected-security",
      owner: "security_legal",
      title: "Evidence, KMS, scanner, and protected handling",
      purpose: "Protect citizen evidence and corruption/protected reports with private storage, KMS, malware scanning, and SOP sign-off.",
      status: "blocked",
      adminControls: [],
      runtimeChecks: [],
      requiredEnv: ["WHISTLE_EVIDENCE_OBJECT_STORE_MODE", "WHISTLE_EVIDENCE_KMS_KEY_ID", "WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED"],
      commands: ["npm run smoke:evidence-object-store", "npm run smoke:lifecycle", "npm run smoke:security-export"],
      blockers: ["Evidence object store, KMS, scanner, and protected-track SOP approval are pending."],
      nextActions: ["Attach storage/KMS/scanner reference.", "Approve protected-track SOP.", "Verify sensitive audit access reasons."],
      evidenceNeeded: ["KMS key reference", "Scanner approval", "Protected-track SOP approval"],
    },
    {
      id: "observability-and-incident",
      owner: "observability",
      title: "Observability, SIEM/WORM, and incident holds",
      purpose: "Prove launch watch, immutable audit export, CORS origins, security headers, and explicit incident hold rules.",
      status: "needs_evidence",
      adminControls: [],
      runtimeChecks: [],
      requiredEnv: ["WHISTLE_ALLOWED_ORIGINS", "WHISTLE_SECURITY_EXPORT_MODE", "WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT"],
      commands: ["npm run smoke:metrics", "npm run smoke:telemetry-export", "npm run smoke:production-runbook"],
      blockers: ["Restore drill, SIEM/WORM, telemetry, origin allowlist, and incident hold evidence are pending."],
      nextActions: ["Attach restore drill evidence.", "Attach SIEM/WORM export proof.", "Approve launch hold conditions."],
      evidenceNeeded: ["Restore drill packet", "SIEM/WORM export proof", "Launch watch owner and incident hold policy"],
    },
    {
      id: "operator-uat",
      owner: "uat_ops",
      title: "Operator UAT and SOP sign-off",
      purpose: "Run role-specific MVP1 rehearsal without expanding MVP2-MVP4 scope.",
      status: "needs_evidence",
      adminControls: [],
      runtimeChecks: [],
      requiredEnv: [],
      commands: [
        "npm run mvp1:rehearsal-packet -- --out artifacts/whistle-mvp1-launch-rehearsal.md",
        "npm run mvp1:uat-run -- --run-id <run-id> --seed-file artifacts/whistle-mvp1-local-uat-seed.json --out artifacts/whistle-mvp1-local-uat-run.md",
        "npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md",
        "npm run mvp:check",
      ],
      blockers: ["MVP1 rehearsal evidence and operator SOP sign-offs are pending."],
      nextActions: ["Run citizen lifecycle rehearsal.", "Run role dashboard rehearsal and automated role assertions.", "Accept defect triage policy."],
      evidenceNeeded: ["Rehearsal packet reference", "Local role assertion artifact", "Signed UAT checklist", "Defect triage queue acceptance"],
    },
  ],
  commands: [
    "npm run mvp:check",
    "DATABASE_URL=<target-postgres> npm run mvp:check:postgres",
    "npm run deployment:preflight:assert -- --env-file <rendered-env>",
    "npm run deployment:packet -- --env-file <rendered-env> --out artifacts/whistle-mvp1-readiness-packet.md",
    "npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md",
  ],
  holdConditions: [
    "Any lane has a blocker.",
    "Any production preflight blocker exists.",
    "Any critical Admin control is pending second-Admin approval.",
    "Any protected identity, raw evidence, raw phone, API key, token, salt, or restore timestamp appears in a shared packet.",
  ],
  safeHandlingRules: [
    "Keep raw secrets in the approved secret manager and rendered env only.",
    "Share artifact references, provider references, and redacted readiness packets in Admin.",
    "Do not make Admin sign-offs override runtime deployment preflight.",
    "Keep MVP1 phone-OTP-only unless a future Government ID category policy has legal approval and provider reference.",
  ],
};

function displayValue(value: string | boolean | number) {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (typeof value === "number") return `${value} days`;
  return value;
}

function governanceTone(status: ConfigChangeRequest["status"]) {
  if (status === "approved") return "good";
  if (status === "rejected") return "danger";
  return "warn";
}

function targetLabel(target: ConfigChangeTarget) {
  if (target.kind === "category") return `Category ${target.id}`;
  if (target.kind === "sla_policy") return `SLA ${target.stage.replaceAll("_", " ")}`;
  if (target.kind === "category_readiness") return `Readiness ${target.categoryId}`;
  return `App control ${target.id}`;
}

function readinessLabel(value: string) {
  return value.replaceAll("_", " ");
}

function readinessTone(value: CategoryReadiness["launchState"] | CategoryReadiness["sopStatus"] | CategoryReadiness["trainingStatus"]) {
  if (value === "ready" || value === "approved") return "good";
  if (value === "blocked" || value === "required") return "danger";
  return "warn";
}

function mvpStatusTone(status: MvpPhaseStatus): "good" | "warn" | "danger" | "neutral" {
  if (status === "done") return "good";
  if (status === "partial") return "warn";
  if (status === "blocked") return "danger";
  return "neutral";
}

function mvpWorkstreamStatusLabel(workstream: MvpLaunchWorkstream) {
  if (workstream.status === "blocked" && workstream.blockers.length > 0) return "launch gated";
  return workstream.status.replaceAll("_", " ");
}

function mvp1HandoffStatusTone(status: Mvp1LaunchHandoffReport["lanes"][number]["status"]): "good" | "warn" | "danger" | "neutral" {
  if (status === "signed_off") return "good";
  if (status === "blocked") return "danger";
  if (status === "needs_evidence") return "warn";
  return "neutral";
}

function mvp1HandoffStatusLabel(status: Mvp1LaunchHandoffReport["lanes"][number]["status"]) {
  return status.replaceAll("_", " ");
}

function statusTone(status: UserStatus | Team["status"]) {
  if (status === "Active") return "good";
  if (status === "Deactivated" || status === "Needs owner" || status === "Inactive") return "danger";
  return "warn";
}

function actorKeyForUser(user: AdminUser) {
  return user.actorKey ?? user.email ?? user.id;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function formatDateTime(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function isExpiredDate(value: string | null) {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? value.startsWith("Expired") : parsed <= Date.now();
}

function mapMfaState(state: AccessUser["mfaState"]): AdminUser["mfa"] {
  if (state === "enabled") return "Enabled";
  if (state === "pending") return "Pending";
  return "MVP bypass";
}

function roleTitle(actorKey: string) {
  const role = actorKey.split(":")[0];
  if (role === "cm_cell") return "CM Cell user";
  if (role === "minister") return "Minister office user";
  if (role === "department_officer") return "Department officer user";
  if (role === "mla") return "MLA office user";
  if (role === "councillor") return "Local owner user";
  if (role === "verification") return "Verification user";
  if (role === "worker") return "Worker identity";
  if (role === "admin") return "Platform administrator";
  return "Government user";
}

function mapAccessUser(user: AccessUser): AdminUser {
  const emailName = slugify(user.actorKey).replaceAll("-", ".");
  return {
    id: user.id,
    actorKey: user.actorKey,
    name: user.displayName,
    title: roleTitle(user.actorKey),
    phone: "+91 90000 00000",
    email: `${emailName || "official"}@gov.tn`,
    status: user.status === "active" ? "Active" : "Deactivated",
    mfa: mapMfaState(user.mfaState),
    lastSeen: `Created ${formatDateTime(user.createdAt) ?? "in MVP"}`,
  };
}

function teamKindFromRole(role: AccessRole): TeamKind {
  if (role === "cm_cell") return "CM Cell";
  if (role === "minister") return "Minister Team";
  if (role === "department_officer") return "Department Officer";
  if (role === "mla") return "MLA Team";
  if (role === "councillor") return "Local Owner";
  if (role === "verification") return "Verification";
  if (role === "worker") return "Worker";
  return "Admin";
}

function roleFromTeamKind(kind: TeamKind): AccessRole {
  if (kind === "CM Cell" || kind === "Rejection Review") return "cm_cell";
  if (kind === "Minister Team") return "minister";
  if (kind === "Department Officer") return "department_officer";
  if (kind === "MLA Team") return "mla";
  if (kind === "Local Owner") return "councillor";
  if (kind === "Verification") return "verification";
  if (kind === "Worker") return "worker";
  return "admin";
}

function scopeTypeFromKind(kind: AccessScopeKind): ScopeType {
  if (kind === "state") return "Statewide";
  if (kind === "district") return "District";
  if (kind === "constituency") return "Constituency";
  if (kind === "ward") return "Local Body";
  if (kind === "queue") return "Queue";
  if (kind === "protected") return "Protected";
  if (kind === "system") return "App";
  return "Ministry";
}

function scopeKindFromTeam(kind: TeamKind): AccessScopeKind {
  if (kind === "Admin" || kind === "Worker") return "system";
  if (kind === "CM Cell") return "state";
  if (kind === "Rejection Review" || kind === "Verification") return "queue";
  if (kind === "MLA Team") return "constituency";
  if (kind === "Local Owner") return "ward";
  return "ministry";
}

function scopeKindFromScope(scope: string, fallback: AccessScopeKind): AccessScopeKind {
  const normalized = scope.toLowerCase();
  if (normalized.includes("statewide") || normalized === "tamil nadu") return "state";
  if (normalized.includes("constituency")) return "constituency";
  if (normalized.includes("ward") || normalized.includes("local body")) return "ward";
  if (normalized.includes("queue")) return "queue";
  if (normalized.includes("configuration")) return "system";
  if (normalized.includes("protected")) return "protected";
  return fallback;
}

function normalizedScopeValue(scope: string, kind: AccessScopeKind) {
  if (kind === "state") return "Tamil Nadu";
  if (kind === "system" && scope === "System configuration") return "whistle";
  if (scope.includes("&")) return scope.replaceAll("&", "and");
  return scope;
}

function actionsForRole(role: AccessRole) {
  if (role === "admin") return ["admin.config.read", "admin.config.write", "admin.config.approve", "access.manage", "audit.read", "audit.export"];
  if (role === "cm_cell") return ["dashboard.read", "ticket.read", "evidence.read", "audit.read", "audit.export"];
  if (role === "minister" || role === "department_officer") return ["dashboard.read", "ticket.read", "evidence.read", "field.action.write"];
  if (role === "verification") return ["verification.queue", "verification.decision", "ticket.read", "evidence.read"];
  if (role === "worker") return ["jobs.sla_escalations.run", "jobs.evidence_scans.run", "jobs.notifications.run"];
  return ["dashboard.read", "ticket.read"];
}

function mapAccessTeam(team: ApiAccessTeam, usersByActor: Map<string, AdminUser>): Team {
  const owner = usersByActor.get(team.ownerActorKey);
  return {
    id: team.id,
    name: team.name,
    kind: team.name.toLowerCase().includes("rejection") ? "Rejection Review" : teamKindFromRole(team.role),
    ownerUserId: owner?.id ?? null,
    status: team.status === "inactive" ? "Inactive" : owner ? "Active" : "Needs owner",
    defaultScope: team.defaultScopeValue,
  };
}

function mapTeamMembership(membership: ApiTeamMembership): TeamMembership {
  return {
    id: membership.id,
    userId: membership.userId,
    teamId: membership.teamId,
    role: membership.roleLabel,
    expiresAt: membership.expiresAt ?? null,
  };
}

function mapAccessGrant(grant: ApiAccessGrant): AccessGrant {
  return {
    id: grant.id,
    targetType: grant.targetType === "user" ? "User" : "Team",
    targetId: grant.targetId,
    role: teamKindFromRole(grant.role),
    scopeType: scopeTypeFromKind(grant.scopeKind),
    scope: grant.scopeValue,
    protectedQueue: grant.protectedAccess,
    reporterIdentity: grant.reporterIdentity,
    actions: grant.actions,
    expiresAt: formatDateTime(grant.expiresAt),
  };
}

function mapAccessSnapshot(snapshot: AccessSnapshot) {
  const users = snapshot.users.map(mapAccessUser);
  const usersByActor = new Map(users.map((user) => [actorKeyForUser(user), user]));
  const teams = snapshot.teams.map((team) => mapAccessTeam(team, usersByActor));
  return {
    users,
    teams,
    memberships: snapshot.memberships.map(mapTeamMembership),
    grants: snapshot.grants.map(mapAccessGrant),
    auditEvents: snapshot.reviewEvents.map((event) => ({
      id: event.id,
      time: formatDateTime(event.createdAt) ?? "MVP API",
      actor: event.actor,
      action: event.action,
      summary: event.summary,
      tone: "good" as AuditTone,
    })),
  };
}

function mergeAuditEvents(apiEvents: AdminAuditEvent[], current: AdminAuditEvent[]) {
  const apiEventIds = new Set(apiEvents.map((event) => event.id));
  return [...apiEvents, ...current.filter((event) => !apiEventIds.has(event.id))];
}

export default function AdminConsole() {
  const [activeSection, setActiveSection] = useState<AdminSection>(() => adminSectionFromLocation());
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [memberships, setMemberships] = useState<TeamMembership[]>(initialMemberships);
  const [grants, setGrants] = useState<AccessGrant[]>(initialGrants);
  const [permissions, setPermissions] = useState<PermissionProfile[]>(initialPermissions);
  const [controls, setControls] = useState<AppControl[]>(initialControls);
  const [categories, setCategories] = useState<CategoryConfig[]>(initialCategories);
  const [readiness, setReadiness] = useState<CategoryReadiness[]>(initialReadiness);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicy[]>(initialSlaPolicies);
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>(initialAuditEvents);
  const [configMode, setConfigMode] = useState("local-prototype");
  const [configError, setConfigError] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [savingConfigId, setSavingConfigId] = useState<string | null>(null);
  const [changeRequests, setChangeRequests] = useState<ConfigChangeRequest[]>([]);
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [governanceError, setGovernanceError] = useState<string | null>(null);
  const [savingGovernanceId, setSavingGovernanceId] = useState<string | null>(null);
  const [auditExport, setAuditExport] = useState<AuditExportPackage | null>(null);
  const [auditExportDelivery, setAuditExportDelivery] = useState<AuditExportDelivery | null>(null);
  const [launchReadiness, setLaunchReadiness] = useState<LaunchReadinessReport | null>(null);
  const [launchReadinessMode, setLaunchReadinessMode] = useState("local-prototype");
  const [launchReadinessError, setLaunchReadinessError] = useState<string | null>(null);
  const [launchReadinessLoading, setLaunchReadinessLoading] = useState(false);
  const [mvpScope, setMvpScope] = useState<MvpScopeReport | null>(null);
  const [mvpScopeMode, setMvpScopeMode] = useState("local-prototype");
  const [mvpScopeError, setMvpScopeError] = useState<string | null>(null);
  const [mvpScopeLoading, setMvpScopeLoading] = useState(false);
  const [mvp1LaunchHandoff, setMvp1LaunchHandoff] = useState<Mvp1LaunchHandoffReport | null>(null);
  const [mvp1LaunchHandoffMode, setMvp1LaunchHandoffMode] = useState("local-prototype");
  const [mvp1LaunchHandoffError, setMvp1LaunchHandoffError] = useState<string | null>(null);
  const [mvp1LaunchHandoffLoading, setMvp1LaunchHandoffLoading] = useState(false);
  const [deploymentPreflight, setDeploymentPreflight] = useState<DeploymentPreflightReport | null>(null);
  const [deploymentPreflightError, setDeploymentPreflightError] = useState<string | null>(null);
  const [deploymentPreflightLoading, setDeploymentPreflightLoading] = useState(false);
  const [accessMode, setAccessMode] = useState("local-prototype");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null);
  const [effectiveAccess, setEffectiveAccess] = useState<EffectiveAccess | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("usr-cm-02");
  const [selectedTeamId, setSelectedTeamId] = useState("team-cm-command");
  const [userDraft, setUserDraft] = useState("");
  const [teamDraft, setTeamDraft] = useState("");
  const [platformPostgresEvidenceDrafts, setPlatformPostgresEvidenceDrafts] = useState<Record<string, string>>({});
  const [externalConfigDrafts, setExternalConfigDrafts] = useState<Record<string, string>>({});
  const [operatorUatEvidenceDraft, setOperatorUatEvidenceDraft] = useState("pending-uat-rehearsal-packet-ref");
  const [operatorUatDefectRegisterDraft, setOperatorUatDefectRegisterDraft] = useState("pending-uat-defect-register-ref");
  const [operatorUatDefectDrafts, setOperatorUatDefectDrafts] = useState<Record<string, string>>({});
  const [deploymentOpsEvidenceDrafts, setDeploymentOpsEvidenceDrafts] = useState<Record<string, string>>({});
  const [newTeamKind, setNewTeamKind] = useState<TeamKind>("Minister Team");
  const [membershipRole, setMembershipRole] = useState("Viewer");
  const [accessScope, setAccessScope] = useState("Tamil Nadu statewide");
  const [notificationDraft, setNotificationDraft] = useState("Ticket {{ticketId}} moved to {{currentQueue}}.");

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? users[0];
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const selectedMemberships = memberships.filter((membership) => membership.userId === selectedUser.id);
  const selectedTeamIds = selectedMemberships.map((membership) => membership.teamId);
  const selectedTeams = teams.filter((team) => selectedTeamIds.includes(team.id));
  const effectiveGrants = grants.filter(
    (grant) => (grant.targetType === "User" && grant.targetId === selectedUser.id) || selectedTeamIds.includes(grant.targetId),
  );
  const riskItems = useMemo(
    () => buildRiskItems({ teams, grants, memberships, permissions, controls, categories, readiness }),
    [teams, grants, memberships, permissions, controls, categories, readiness],
  );
  const effectiveScopes = effectiveAccess
    ? Array.from(new Set(effectiveAccess.grants.map((grant) => `${scopeTypeFromKind(grant.scopeKind)}: ${grant.scopeValue}`)))
    : Array.from(new Set(effectiveGrants.map((grant) => `${grant.scopeType}: ${grant.scope}`)));
  const effectiveActions = effectiveAccess ? effectiveAccess.actions : Array.from(new Set(effectiveGrants.flatMap((grant) => grant.actions)));
  const canSeeProtected = effectiveAccess ? effectiveAccess.protectedAccess : effectiveGrants.some((grant) => grant.protectedQueue);
  const canSeeReporter = effectiveAccess ? effectiveAccess.reporterIdentity : effectiveGrants.some((grant) => grant.reporterIdentity);

  function selectSection(section: AdminSection) {
    setActiveSection(section);
    window.history.replaceState(null, "", `#${section}`);
  }

  function applyAccessPayload(payload: AdminAccessPayload, preferred?: { userId?: string; teamId?: string }) {
    const mapped = mapAccessSnapshot(payload.access);
    if (!mapped.users.length || !mapped.teams.length) return;
    setAccessMode(payload.mode);
    setUsers(mapped.users);
    setTeams(mapped.teams);
    setMemberships(mapped.memberships);
    setGrants(mapped.grants);
    setAuditEvents((current) => mergeAuditEvents(mapped.auditEvents, current));
    const nextUserId = preferred?.userId ?? selectedUserId;
    const nextTeamId = preferred?.teamId ?? selectedTeamId;
    setSelectedUserId(mapped.users.some((user) => user.id === nextUserId) ? nextUserId : mapped.users[0].id);
    setSelectedTeamId(mapped.teams.some((team) => team.id === nextTeamId) ? nextTeamId : mapped.teams[0].id);
  }

  async function refreshAccess(preferred?: { userId?: string; teamId?: string; audit?: boolean }) {
    setAccessLoading(true);
    setAccessError(null);
    try {
      const payload = await fetchAdminAccess();
      applyAccessPayload(payload, preferred);
      if (preferred?.audit) addAudit("Access data refreshed", `Loaded ${payload.mode} users, teams, memberships, and grants.`, "good");
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Admin access API unavailable";
      setAccessMode("local-prototype");
      setAccessError(message);
      if (preferred?.audit) addAudit("Access refresh failed", "Using local prototype access fallback.", "warn");
      return null;
    } finally {
      setAccessLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    async function loadConfig() {
      setConfigLoading(true);
      setConfigError(null);
      try {
        const payload = await fetchAdminConfig();
        if (!mounted) return;
        setConfigMode(payload.mode);
        applyConfigSnapshot(payload.config);
      } catch (error) {
        if (!mounted) return;
        setConfigMode("local-prototype");
        setConfigError(error instanceof Error ? error.message : "Admin config API unavailable");
      } finally {
        if (mounted) setConfigLoading(false);
      }
    }

    void loadConfig();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveSection(adminSectionFromLocation());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    void refreshGovernance();
  }, []);

  useEffect(() => {
    void refreshLaunchReadiness();
  }, []);

  useEffect(() => {
    void refreshMvpScope();
  }, []);

  useEffect(() => {
    void refreshMvp1LaunchHandoff();
  }, []);

  useEffect(() => {
    void refreshDeploymentPreflight();
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadAccess() {
      setAccessLoading(true);
      setAccessError(null);
      try {
        const payload = await fetchAdminAccess();
        if (!mounted) return;
        applyAccessPayload(payload);
      } catch (error) {
        if (!mounted) return;
        setAccessMode("local-prototype");
        setAccessError(error instanceof Error ? error.message : "Admin access API unavailable");
      } finally {
        if (mounted) setAccessLoading(false);
      }
    }

    void loadAccess();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (accessMode === "local-prototype" || !selectedUser?.actorKey) {
      setEffectiveAccess(null);
      return;
    }
    const controller = new AbortController();
    async function loadEffectiveAccess() {
      try {
        const payload = await fetchEffectiveAccess(actorKeyForUser(selectedUser), controller.signal);
        setEffectiveAccess(payload.effectiveAccess);
      } catch {
        setEffectiveAccess(null);
      }
    }

    void loadEffectiveAccess();
    return () => controller.abort();
  }, [accessMode, selectedUser]);

  function userName(userId: string | null) {
    if (!userId) return "No owner";
    return users.find((user) => user.id === userId)?.name ?? "Unknown user";
  }

  function teamName(teamId: string) {
    return teams.find((team) => team.id === teamId)?.name ?? "Unknown team";
  }

  function targetName(grant: AccessGrant) {
    if (grant.targetType === "User") return users.find((user) => user.id === grant.targetId)?.name ?? "Unknown user";
    return teamName(grant.targetId);
  }

  function addAudit(action: string, summary: string, tone: AuditTone = "neutral") {
    setAuditEvents((current) => [
      { id: `audit-${Date.now()}`, time: "Now", actor: "Meera Iyer", action, summary, tone },
      ...current,
    ]);
  }

  function applyConfigSnapshot(config: { categories: CategoryConfig[]; readiness?: CategoryReadiness[]; slaPolicies: SlaPolicy[]; appControls: AdminAppControl[] }) {
    setCategories(config.categories);
    if (config.readiness?.length) setReadiness(config.readiness);
    setSlaPolicies(config.slaPolicies);
    setControls(config.appControls);
    const template = config.appControls.find((control) => control.id === "notify-template");
    if (typeof template?.value === "string") setNotificationDraft(template.value);
    setPlatformPostgresEvidenceDrafts((current) => {
      const next = { ...current };
      for (const item of platformPostgresItems) {
        const reference = config.appControls.find((control) => control.id === item.evidenceControlId);
        if (typeof reference?.value === "string") next[item.evidenceControlId] = reference.value;
      }
      return next;
    });
    setExternalConfigDrafts((current) => {
      const next = { ...current };
      for (const service of externalServiceConfigs) {
        const reference = config.appControls.find((control) => control.id === service.referenceControlId);
        if (typeof reference?.value === "string") next[service.referenceControlId] = reference.value;
      }
      return next;
    });
    const uatEvidenceReference = config.appControls.find((control) => control.id === "uat-launch-rehearsal-evidence-ref");
    if (typeof uatEvidenceReference?.value === "string") setOperatorUatEvidenceDraft(uatEvidenceReference.value);
    const uatDefectRegisterReference = config.appControls.find((control) => control.id === "uat-defect-register-ref");
    if (typeof uatDefectRegisterReference?.value === "string") setOperatorUatDefectRegisterDraft(uatDefectRegisterReference.value);
    setOperatorUatDefectDrafts((current) => {
      const next = { ...current };
      for (const item of operatorUatDefectItems) {
        const control = config.appControls.find((entry) => entry.id === item.controlId);
        if (typeof control?.value === "number") next[item.controlId] = String(control.value);
      }
      return next;
    });
    setDeploymentOpsEvidenceDrafts((current) => {
      const next = { ...current };
      for (const item of deploymentOpsItems) {
        if (!item.evidenceControlId) continue;
        const reference = config.appControls.find((control) => control.id === item.evidenceControlId);
        if (typeof reference?.value === "string") next[item.evidenceControlId] = reference.value;
      }
      return next;
    });
  }

  function upsertChangeRequest(request: ConfigChangeRequest) {
    setChangeRequests((current) => [request, ...current.filter((item) => item.id !== request.id)]);
  }

  async function refreshGovernance(audit = false) {
    setGovernanceLoading(true);
    setGovernanceError(null);
    try {
      const payload = await fetchConfigChangeRequests();
      setChangeRequests(payload.changeRequests);
      if (audit) addAudit("Governance queue refreshed", `Loaded ${payload.changeRequests.length} configuration approval request(s).`, "good");
      return payload.changeRequests;
    } catch (error) {
      setGovernanceError(error instanceof Error ? error.message : "Governance API unavailable");
      if (audit) addAudit("Governance refresh failed", "Approval queue could not be refreshed from the API.", "warn");
      return null;
    } finally {
      setGovernanceLoading(false);
    }
  }

  async function proposeGovernedChange(target: ConfigChangeTarget, reason: string, label: string) {
    setGovernanceError(null);
    try {
      const result = await createConfigChangeRequest(target, reason);
      upsertChangeRequest(result.changeRequest);
      setConfigError("Critical change queued for second-Admin approval.");
      addAudit("Approval requested", `${label} queued for second-Admin approval.`, "warn");
      return result.changeRequest;
    } catch (error) {
      setGovernanceError(error instanceof Error ? error.message : "Approval request failed");
      addAudit("Approval request failed", `${label} could not be queued for approval.`, "danger");
      return null;
    }
  }

  async function approveGovernanceRequest(requestId: string) {
    setSavingGovernanceId(`approve:${requestId}`);
    setGovernanceError(null);
    try {
      const result = await approveConfigChangeRequest(requestId, "Prototype second-Admin approval from governance queue.");
      upsertChangeRequest(result.changeRequest);
      applyConfigSnapshot(result.config);
      void refreshLaunchReadiness();
      void refreshMvpScope();
      void refreshMvp1LaunchHandoff();
      void refreshDeploymentPreflight();
      addAudit("Config approval applied", result.changeRequest.summary, "good");
    } catch (error) {
      setGovernanceError(error instanceof Error ? error.message : "Approval failed");
      addAudit("Config approval failed", "Second-Admin approval could not be applied.", "danger");
    } finally {
      setSavingGovernanceId(null);
    }
  }

  async function rejectGovernanceRequest(requestId: string) {
    setSavingGovernanceId(`reject:${requestId}`);
    setGovernanceError(null);
    try {
      const result = await rejectConfigChangeRequest(requestId, "Prototype second-Admin rejected this change.");
      upsertChangeRequest(result.changeRequest);
      addAudit("Config approval rejected", result.changeRequest.summary, "warn");
    } catch (error) {
      setGovernanceError(error instanceof Error ? error.message : "Rejection failed");
      addAudit("Config rejection failed", "Second-Admin rejection could not be applied.", "danger");
    } finally {
      setSavingGovernanceId(null);
    }
  }

  async function generateAuditExport() {
    setSavingGovernanceId("audit-export");
    setGovernanceError(null);
    try {
      const result = await fetchGovernanceAuditExport();
      setAuditExport(result.exportPackage);
      setAuditExportDelivery(result.exportDelivery);
      setChangeRequests(result.configChangeRequests);
      addAudit("Audit export generated", `${result.exportPackage.counts.auditEvents} audit event(s) and ${result.exportPackage.counts.configChangeRequests} config request(s) packaged.`, "good");
    } catch (error) {
      setGovernanceError(error instanceof Error ? error.message : "Audit export failed");
      addAudit("Audit export failed", "Governance audit export package could not be generated.", "danger");
    } finally {
      setSavingGovernanceId(null);
    }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = userDraft.trim();
    if (!name) return;
    const uniqueSuffix = Date.now();
    const emailName = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
    const actorKey = `official:${slugify(name) || "user"}-${uniqueSuffix}`;
    setSavingAccessId("user");
    try {
      const result = await createAccessUser({
        actorKey,
        displayName: name,
        status: "active",
        mfaState: "pending",
      });
      const user = mapAccessUser(result.user);
      setUsers((current) => [user, ...current.filter((item) => item.id !== user.id)]);
      setSelectedUserId(user.id);
      setUserDraft("");
      setAccessError(null);
      addAudit("User invited", `${name} added through the Admin access API.`, "good");
      await refreshAccess({ userId: user.id });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "User invite saved locally");
    } finally {
      setSavingAccessId(null);
    }
    const user: AdminUser = {
      id: `usr-${uniqueSuffix}`,
      actorKey,
      name,
      title: "New government user",
      phone: "+91 90000 00000",
      email: `${emailName || "new.user"}@gov.tn`,
      status: "Pending",
      mfa: "Pending",
      lastSeen: "Invite created now",
    };
    setUsers((current) => [user, ...current]);
    setSelectedUserId(user.id);
    setUserDraft("");
    addAudit("User invited", `${name} added locally because the Admin access API was not reachable.`, "warn");
  }

  async function toggleUserStatus(userId: string) {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    const nextStatus = user.status === "Deactivated" ? "Active" : "Deactivated";
    setSavingAccessId(`user:${userId}`);
    try {
      const result = await updateAccessUser(userId, { status: nextStatus === "Active" ? "active" : "inactive" });
      const mapped = mapAccessUser(result.user);
      setUsers((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
      setAccessError(null);
      addAudit("User status changed", `${mapped.name} set to ${mapped.status} through the Admin access API.`, "warn");
      await refreshAccess({ userId });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "User status saved locally");
    } finally {
      setSavingAccessId(null);
    }
    setUsers((current) =>
      current.map((item) =>
        item.id === userId ? { ...item, status: item.status === "Deactivated" ? "Active" : "Deactivated" } : item,
      ),
    );
    addAudit("User status changed", `${user.name} status toggled locally because the Admin access API was not reachable.`, "warn");
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = teamDraft.trim();
    if (!name) return;
    const role = roleFromTeamKind(newTeamKind);
    const fallbackScopeKind = scopeKindFromTeam(newTeamKind);
    const defaultScopeKind = scopeKindFromScope(accessScope, fallbackScopeKind);
    const defaultScopeValue = normalizedScopeValue(accessScope, defaultScopeKind);
    setSavingAccessId("team");
    try {
      const result = await createAccessTeam({
        name,
        role,
        ownerActorKey: actorKeyForUser(selectedUser),
        defaultScopeKind,
        defaultScopeValue,
      });
      const mappedTeam = mapAccessTeam(result.team, new Map(users.map((user) => [actorKeyForUser(user), user])));
      setTeams((current) => [mappedTeam, ...current.filter((team) => team.id !== mappedTeam.id)]);
      setSelectedTeamId(mappedTeam.id);
      setTeamDraft("");
      setAccessError(null);
      addAudit("Team created", `${name} created through the Admin access API.`, "good");
      await refreshAccess({ teamId: mappedTeam.id });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "Team saved locally");
    } finally {
      setSavingAccessId(null);
    }
    const team: Team = {
      id: `team-${Date.now()}`,
      name,
      kind: newTeamKind,
      ownerUserId: selectedUser.id,
      status: "Active",
      defaultScope: accessScope,
    };
    setTeams((current) => [team, ...current]);
    setSelectedTeamId(team.id);
    setTeamDraft("");
    addAudit("Team created", `${name} created locally because the Admin access API was not reachable.`, "warn");
  }

  async function addMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const existing = memberships.find((membership) => membership.userId === selectedUser.id && membership.teamId === selectedTeam.id);
    const existingExpired = Boolean(existing && isExpiredDate(existing.expiresAt));
    setSavingAccessId("membership");
    try {
      const result = await createTeamMembership({
        userId: selectedUser.id,
        teamId: selectedTeam.id,
        roleLabel: membershipRole,
      });
      const membership = mapTeamMembership(result.membership);
      setMemberships((current) => [membership, ...current.filter((item) => item.id !== membership.id)]);
      setAccessError(null);
      addAudit(
        existing ? (existingExpired ? "Membership restored" : "Membership updated") : "Membership assigned",
        `${selectedUser.name} ${existing ? (existingExpired ? "restored to" : "updated in") : "added to"} ${selectedTeam.name} through the Admin access API.`,
        "good",
      );
      await refreshAccess({ userId: selectedUser.id, teamId: selectedTeam.id });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "Membership saved locally");
    } finally {
      setSavingAccessId(null);
    }
    if (existing) {
      setMemberships((current) =>
        current.map((item) => (item.id === existing.id ? { ...item, role: membershipRole, expiresAt: null } : item)),
      );
    } else {
      setMemberships((current) => [{ userId: selectedUser.id, teamId: selectedTeam.id, role: membershipRole, expiresAt: null }, ...current]);
    }
    addAudit("Membership saved", `${selectedUser.name} membership saved locally because the Admin access API was not reachable.`, "warn");
  }

  async function toggleTeamStatus(teamId: string) {
    const team = teams.find((item) => item.id === teamId);
    if (!team) return;
    const nextStatus = team.status === "Inactive" ? "active" : "inactive";
    setSavingAccessId(`team:${teamId}`);
    try {
      const result = await updateAccessTeam(teamId, { status: nextStatus });
      const usersByActor = new Map(users.map((user) => [actorKeyForUser(user), user]));
      const mapped = mapAccessTeam(result.team, usersByActor);
      setTeams((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
      setAccessError(null);
      addAudit("Team status changed", `${mapped.name} set to ${mapped.status} through the Admin access API.`, "warn");
      await refreshAccess({ teamId });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "Team status saved locally");
    } finally {
      setSavingAccessId(null);
    }
    setTeams((current) =>
      current.map((item) => (item.id === teamId ? { ...item, status: item.status === "Inactive" ? "Active" : "Inactive" } : item)),
    );
    addAudit("Team status changed", `${team.name} status toggled locally because the Admin access API was not reachable.`, "warn");
  }

  async function toggleMembershipExpiry(membershipId: string | undefined) {
    if (!membershipId) return;
    const membership = memberships.find((item) => item.id === membershipId);
    if (!membership) return;
    const nextExpiresAt = isExpiredDate(membership.expiresAt) ? null : new Date().toISOString();
    setSavingAccessId(`membership:${membershipId}`);
    try {
      const result = await updateTeamMembership(membershipId, { expiresAt: nextExpiresAt });
      const mapped = mapTeamMembership(result.membership);
      setMemberships((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
      setAccessError(null);
      addAudit(
        nextExpiresAt ? "Membership revoked" : "Membership restored",
        `${selectedUser.name} membership in ${teamName(mapped.teamId)} saved through the Admin access API.`,
        "warn",
      );
      await refreshAccess({ userId: selectedUser.id, teamId: selectedTeam.id });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "Membership expiry saved locally");
    } finally {
      setSavingAccessId(null);
    }
    setMemberships((current) =>
      current.map((item) => (item.id === membershipId ? { ...item, expiresAt: nextExpiresAt } : item)),
    );
    addAudit("Membership expiry changed", `${selectedUser.name} membership changed locally because the Admin access API was not reachable.`, "warn");
  }

  async function grantCmAccess() {
    setSavingAccessId("grant-user");
    try {
      const result = await createAccessGrant({
        targetType: "user",
        targetId: selectedUser.id,
        role: "cm_cell",
        scopeKind: "state",
        scopeValue: "Tamil Nadu",
        protectedAccess: true,
        reporterIdentity: false,
        actions: ["dashboard.read", "ticket.read", "evidence.read"],
        expiresAt: "2026-06-30T23:59:59.000Z",
      });
      const grant = mapAccessGrant(result.grant);
      setGrants((current) => [grant, ...current.filter((item) => item.id !== grant.id)]);
      setAccessError(null);
      addAudit("Temporary CM access granted", `${selectedUser.name} received acting statewide CM access through the Admin access API.`, "good");
      await refreshAccess({ userId: selectedUser.id });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "Grant saved locally");
    } finally {
      setSavingAccessId(null);
    }
    const grant: AccessGrant = {
      id: `grant-${Date.now()}`,
      targetType: "User",
      targetId: selectedUser.id,
      role: "CM Cell",
      scopeType: "Statewide",
      scope: "Tamil Nadu statewide",
      protectedQueue: true,
      reporterIdentity: false,
      actions: ["Statewide oversight", "View CM queue"],
      expiresAt: "30 Jun 2026",
    };
    setGrants((current) => [grant, ...current]);
    addAudit("Temporary CM access granted", `${selectedUser.name} received local acting statewide CM access until 30 Jun 2026.`, "warn");
  }

  async function addTeamAccess() {
    const role = selectedTeam.kind;
    const scopeType: ScopeType =
      role === "Admin"
        ? "App"
        : role === "CM Cell"
          ? "Statewide"
          : role === "Rejection Review" || role === "Verification"
            ? "Queue"
            : role === "MLA Team"
              ? "Constituency"
              : role === "Local Owner"
                ? "Local Body"
                : "Ministry";
    const apiRole = roleFromTeamKind(role);
    const fallbackScopeKind = scopeKindFromTeam(role);
    const scopeKind = scopeKindFromScope(accessScope, fallbackScopeKind);
    const scopeValue = normalizedScopeValue(accessScope, scopeKind);
    setSavingAccessId("grant-team");
    try {
      const result = await createAccessGrant({
        targetType: "team",
        targetId: selectedTeam.id,
        role: apiRole,
        scopeKind,
        scopeValue,
        protectedAccess: role === "CM Cell" || role === "Rejection Review",
        reporterIdentity: role === "CM Cell" || role === "Rejection Review",
        actions: actionsForRole(apiRole),
      });
      const grant = mapAccessGrant(result.grant);
      setGrants((current) => [grant, ...current.filter((item) => item.id !== grant.id)]);
      setAccessError(null);
      addAudit("Access grant created", `${selectedTeam.name} scoped through the Admin access API.`, "good");
      await refreshAccess({ teamId: selectedTeam.id });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "Grant saved locally");
    } finally {
      setSavingAccessId(null);
    }
    const grant: AccessGrant = {
      id: `grant-${Date.now()}`,
      targetType: "Team",
      targetId: selectedTeam.id,
      role,
      scopeType,
      scope: accessScope,
      protectedQueue: role === "CM Cell" || role === "Rejection Review",
      reporterIdentity: role === "CM Cell" || role === "Rejection Review",
      actions: role === "Admin" ? ["Manage users", "Configure app controls"] : ["View scoped workspace", "Monitor SLA"],
      expiresAt: null,
    };
    setGrants((current) => [grant, ...current]);
    addAudit("Access grant created", `${selectedTeam.name} scoped locally because the Admin access API was not reachable.`, "warn");
  }

  async function toggleGrantFlag(grantId: string, field: "protectedQueue" | "reporterIdentity") {
    const grant = grants.find((item) => item.id === grantId);
    if (!grant) return;
    const nextValue = !grant[field];
    setSavingAccessId(`grant:${grantId}:${field}`);
    try {
      const result = await updateAccessGrant(grantId, {
        [field === "protectedQueue" ? "protectedAccess" : "reporterIdentity"]: nextValue,
      });
      const mapped = mapAccessGrant(result.grant);
      setGrants((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
      setAccessError(null);
      addAudit("Access visibility changed", `${targetName(mapped)} ${field} saved through the Admin access API.`, "warn");
      await refreshAccess({ userId: selectedUser.id, teamId: selectedTeam.id });
      return;
    } catch (error) {
      setAccessMode("local-prototype");
      setAccessError(error instanceof Error ? error.message : "Grant visibility saved locally");
    } finally {
      setSavingAccessId(null);
    }
    setGrants((current) => current.map((item) => (item.id === grantId ? { ...item, [field]: !item[field] } : item)));
    addAudit("Access visibility changed", `${targetName(grant)} ${field} toggled locally because the Admin access API was not reachable.`, "warn");
  }

  function togglePermission(profileId: string, field: "protectedQueue" | "reporterIdentity" | "canApproveConfig") {
    const profile = permissions.find((item) => item.id === profileId);
    setPermissions((current) => current.map((item) => (item.id === profileId ? { ...item, [field]: !item[field] } : item)));
    addAudit("Permission profile changed", `${profile?.role ?? "Permission"} ${field} toggled.`, "warn");
  }

  function cycleEvidence(profileId: string) {
    const profile = permissions.find((item) => item.id === profileId);
    const order: PermissionProfile["evidenceAccess"][] = ["Hidden", "Metadata only", "Full evidence"];
    setPermissions((current) =>
      current.map((item) =>
        item.id === profileId ? { ...item, evidenceAccess: order[(order.indexOf(item.evidenceAccess) + 1) % order.length] } : item,
      ),
    );
    addAudit("Evidence permission changed", `${profile?.role ?? "Permission"} evidence access cycled.`, "warn");
  }

  async function refreshLaunchReadiness(audit = false) {
    setLaunchReadinessLoading(true);
    setLaunchReadinessError(null);
    try {
      const payload = await fetchLaunchReadiness();
      setLaunchReadiness(payload.report);
      setLaunchReadinessMode(payload.mode);
      if (audit) addAudit("Launch readiness refreshed", `${payload.report.verdict.replaceAll("_", " ")} at ${payload.report.score}%.`, "good");
      return payload.report;
    } catch (error) {
      setLaunchReadinessMode("local-prototype");
      setLaunchReadinessError(error instanceof Error ? error.message : "Launch readiness API unavailable");
      if (audit) addAudit("Launch readiness refresh failed", "Using local setup risks until the readiness API is reachable.", "warn");
      return null;
    } finally {
      setLaunchReadinessLoading(false);
    }
  }

  async function refreshMvpScope(audit = false) {
    setMvpScopeLoading(true);
    setMvpScopeError(null);
    try {
      const payload = await fetchMvpScope();
      setMvpScope(payload.scope);
      setMvpScopeMode(payload.mode);
      if (audit) {
        addAudit(
          "MVP scope refreshed",
          `${payload.scope.activeBuild} active, ${payload.scope.overallImplementationPercent}% implementation mapped.`,
          "good",
        );
      }
      return payload.scope;
    } catch (error) {
      setMvpScopeMode("local-prototype");
      setMvpScope(fallbackMvpScopeReport);
      setMvpScopeError(error instanceof Error ? error.message : "MVP scope API unavailable");
      if (audit) addAudit("MVP scope refresh failed", "Using local MVP scope fallback until the Admin API is reachable.", "warn");
      return fallbackMvpScopeReport;
    } finally {
      setMvpScopeLoading(false);
    }
  }

  async function refreshMvp1LaunchHandoff(audit = false) {
    setMvp1LaunchHandoffLoading(true);
    setMvp1LaunchHandoffError(null);
    try {
      const payload = await fetchMvp1LaunchHandoff();
      setMvp1LaunchHandoff(payload.handoff);
      setMvp1LaunchHandoffMode(payload.mode);
      if (audit) {
        addAudit(
          "MVP1 handoff refreshed",
          `${payload.handoff.lanes.length} launch lanes, ${payload.handoff.launchReadinessPercent}% readiness.`,
          payload.handoff.launchVerdict === "go" ? "good" : "warn",
        );
      }
      return payload.handoff;
    } catch (error) {
      setMvp1LaunchHandoffMode("local-prototype");
      setMvp1LaunchHandoff(fallbackMvp1LaunchHandoffReport);
      setMvp1LaunchHandoffError(error instanceof Error ? error.message : "MVP1 launch handoff API unavailable");
      if (audit) addAudit("MVP1 handoff refresh failed", "Using local launch handoff fallback until the Admin API is reachable.", "warn");
      return fallbackMvp1LaunchHandoffReport;
    } finally {
      setMvp1LaunchHandoffLoading(false);
    }
  }

  async function refreshDeploymentPreflight(audit = false) {
    setDeploymentPreflightLoading(true);
    setDeploymentPreflightError(null);
    try {
      const payload = await fetchDeploymentPreflight();
      setDeploymentPreflight(payload.report);
      if (audit) {
        addAudit(
          "Deployment preflight refreshed",
          `${payload.report.summary.blockers} blockers, ${payload.report.summary.warnings} warnings for ${payload.report.profile}.`,
          payload.report.productionReady ? "good" : "warn",
        );
      }
      return payload.report;
    } catch (error) {
      setDeploymentPreflightError(error instanceof Error ? error.message : "Deployment preflight API unavailable");
      if (audit) addAudit("Deployment preflight refresh failed", "Production security and scale blockers could not be checked.", "warn");
      return null;
    } finally {
      setDeploymentPreflightLoading(false);
    }
  }

  async function refreshConfig() {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const payload = await fetchAdminConfig();
      setConfigMode(payload.mode);
      applyConfigSnapshot(payload.config);
      void refreshLaunchReadiness();
      void refreshMvpScope();
      void refreshMvp1LaunchHandoff();
      void refreshDeploymentPreflight();
      addAudit("Admin config refreshed", `Loaded ${payload.mode} app configuration from API.`, "good");
    } catch (error) {
      setConfigMode("local-prototype");
      setConfigError(error instanceof Error ? error.message : "Admin config API unavailable");
      addAudit("Admin config refresh failed", "Using local prototype configuration fallback.", "warn");
    } finally {
      setConfigLoading(false);
    }
  }

  async function toggleCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return;
    const nextEnabled = !category.enabled;
    setSavingConfigId(categoryId);
    setCategories((current) => current.map((item) => (item.id === categoryId ? { ...item, enabled: nextEnabled } : item)));
    try {
      const result = await patchAdminCategory(categoryId, { enabled: nextEnabled });
      setCategories((current) => current.map((item) => (item.id === categoryId ? result.category : item)));
      addAudit("Category config saved", `${category.labelEn} ${nextEnabled ? "enabled" : "disabled"} through Admin API.`, "warn");
    } catch (error) {
      if (isCriticalApprovalRequired(error)) {
        setCategories((current) => current.map((item) => (item.id === categoryId ? category : item)));
        await proposeGovernedChange(
          { kind: "category", id: categoryId, patch: { enabled: nextEnabled } },
          `Change ${category.labelEn} citizen intake availability to ${nextEnabled ? "enabled" : "disabled"}.`,
          `${category.labelEn} category availability`,
        );
      } else {
        setConfigError(error instanceof Error ? error.message : "Category update failed");
        addAudit("Category config fallback", `${category.labelEn} updated locally only.`, "warn");
      }
    } finally {
      setSavingConfigId(null);
    }
  }

  async function cycleCategorySensitivity(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return;
    const order: CategoryConfig["sensitivity"][] = ["public_aggregate", "identity_masked", "protected"];
    const nextSensitivity = order[(order.indexOf(category.sensitivity) + 1) % order.length];
    setSavingConfigId(`${categoryId}:sensitivity`);
    setCategories((current) => current.map((item) => (item.id === categoryId ? { ...item, sensitivity: nextSensitivity } : item)));
    try {
      const result = await patchAdminCategory(categoryId, { sensitivity: nextSensitivity });
      setCategories((current) => current.map((item) => (item.id === categoryId ? result.category : item)));
      addAudit("Category sensitivity saved", `${category.labelEn} set to ${nextSensitivity}.`, "warn");
    } catch (error) {
      if (isCriticalApprovalRequired(error)) {
        setCategories((current) => current.map((item) => (item.id === categoryId ? category : item)));
        await proposeGovernedChange(
          { kind: "category", id: categoryId, patch: { sensitivity: nextSensitivity } },
          `Change ${category.labelEn} sensitivity to ${nextSensitivity.replaceAll("_", " ")}.`,
          `${category.labelEn} sensitivity`,
        );
      } else {
        setConfigError(error instanceof Error ? error.message : "Category sensitivity update failed");
        addAudit("Category sensitivity fallback", `${category.labelEn} sensitivity updated locally only.`, "warn");
      }
    } finally {
      setSavingConfigId(null);
    }
  }

  async function cycleReadinessField(categoryId: string, field: "launchState" | "sopStatus" | "trainingStatus") {
    const item = readiness.find((entry) => entry.categoryId === categoryId);
    const category = categories.find((entry) => entry.id === categoryId);
    if (!item) return;
    const orders = {
      launchState: ["ready", "pilot_only", "blocked"] as CategoryReadiness["launchState"][],
      sopStatus: ["approved", "scheduled", "required"] as CategoryReadiness["sopStatus"][],
      trainingStatus: ["approved", "scheduled", "required"] as CategoryReadiness["trainingStatus"][],
    };
    const currentValue = item[field];
    const order = orders[field] as string[];
    const nextValue = order[(order.indexOf(currentValue) + 1) % order.length];
    const patch = { [field]: nextValue } as Partial<Omit<CategoryReadiness, "categoryId">>;
    setSavingConfigId(`${categoryId}:${field}`);
    setReadiness((current) => current.map((entry) => (entry.categoryId === categoryId ? { ...entry, ...patch } : entry)));
    try {
      const result = await patchAdminCategoryReadiness(categoryId, patch);
      setReadiness((current) => current.map((entry) => (entry.categoryId === categoryId ? result.readiness : entry)));
      addAudit("Readiness matrix saved", `${category?.labelEn ?? categoryId} ${field} set to ${String(nextValue).replaceAll("_", " ")}.`, "warn");
    } catch (error) {
      if (isCriticalApprovalRequired(error)) {
        setReadiness((current) => current.map((entry) => (entry.categoryId === categoryId ? item : entry)));
        await proposeGovernedChange(
          { kind: "category_readiness", categoryId, patch },
          `Change ${category?.labelEn ?? categoryId} launch readiness ${field} to ${String(nextValue).replaceAll("_", " ")}.`,
          `${category?.labelEn ?? categoryId} readiness`,
        );
      } else {
        setConfigError(error instanceof Error ? error.message : "Readiness update failed");
        addAudit("Readiness matrix fallback", `${category?.labelEn ?? categoryId} readiness updated locally only.`, "warn");
      }
    } finally {
      setSavingConfigId(null);
    }
  }

  async function adjustSla(stage: string, delta: number) {
    const policy = slaPolicies.find((item) => item.stage === stage);
    if (!policy) return;
    const nextDays = Math.max(1, Math.min(60, policy.durationDays + delta));
    setSavingConfigId(stage);
    setSlaPolicies((current) => current.map((item) => (item.stage === stage ? { ...item, durationDays: nextDays } : item)));
    try {
      const result = await patchAdminSlaPolicy(stage, { durationDays: nextDays });
      setSlaPolicies((current) => current.map((item) => (item.stage === stage ? result.policy : item)));
      addAudit("SLA policy saved", `${policy.label} set to ${nextDays} day(s).`, "warn");
    } catch (error) {
      if (isCriticalApprovalRequired(error)) {
        setSlaPolicies((current) => current.map((item) => (item.stage === stage ? policy : item)));
        await proposeGovernedChange(
          { kind: "sla_policy", stage, patch: { durationDays: nextDays } },
          `Change ${policy.label} from ${policy.durationDays} to ${nextDays} day(s).`,
          `${policy.label} duration`,
        );
      } else {
        setConfigError(error instanceof Error ? error.message : "SLA update failed");
        addAudit("SLA policy fallback", `${policy.label} updated locally only.`, "warn");
      }
    } finally {
      setSavingConfigId(null);
    }
  }

  async function toggleSla(stage: string) {
    const policy = slaPolicies.find((item) => item.stage === stage);
    if (!policy) return;
    const nextEnabled = !policy.enabled;
    setSavingConfigId(`${stage}:enabled`);
    setSlaPolicies((current) => current.map((item) => (item.stage === stage ? { ...item, enabled: nextEnabled } : item)));
    try {
      const result = await patchAdminSlaPolicy(stage, { enabled: nextEnabled });
      setSlaPolicies((current) => current.map((item) => (item.stage === stage ? result.policy : item)));
      addAudit("SLA policy status saved", `${policy.label} ${nextEnabled ? "enabled" : "disabled"}.`, "warn");
    } catch (error) {
      if (isCriticalApprovalRequired(error)) {
        setSlaPolicies((current) => current.map((item) => (item.stage === stage ? policy : item)));
        await proposeGovernedChange(
          { kind: "sla_policy", stage, patch: { enabled: nextEnabled } },
          `Change ${policy.label} status to ${nextEnabled ? "enabled" : "paused"}.`,
          `${policy.label} status`,
        );
      } else {
        setConfigError(error instanceof Error ? error.message : "SLA status update failed");
        addAudit("SLA policy status fallback", `${policy.label} status updated locally only.`, "warn");
      }
    } finally {
      setSavingConfigId(null);
    }
  }

  async function changeControl(controlId: string, overrideValue?: string | boolean | number, auditLabel?: string) {
    const control = controls.find((item) => item.id === controlId);
    if (!control) return;
    const nextValue =
      overrideValue !== undefined
        ? overrideValue
        : typeof control.value === "boolean"
          ? !control.value
          : typeof control.value === "number"
            ? control.value === 14
              ? 2
              : control.value + 1
            : control.id === "notify-template"
              ? notificationDraft
              : String(control.value);
    setSavingConfigId(controlId);
    setControls((current) =>
      current.map((item) => {
        if (item.id !== controlId) return item;
        return { ...item, value: nextValue };
      }),
    );
    try {
      const result = await patchAdminAppControl(controlId, nextValue);
      setControls((current) => current.map((item) => (item.id === controlId ? { ...result.control } : item)));
      void refreshLaunchReadiness();
      void refreshMvpScope();
      void refreshMvp1LaunchHandoff();
      void refreshDeploymentPreflight();
      addAudit("App control saved", `${auditLabel ?? control.name} updated through Admin API.`, "warn");
    } catch (error) {
      if (isCriticalApprovalRequired(error)) {
        setControls((current) => current.map((item) => (item.id === controlId ? control : item)));
        await proposeGovernedChange(
          { kind: "app_control", id: controlId, value: nextValue },
          `Change ${control.name} from ${displayValue(control.value)} to ${displayValue(nextValue)}.`,
          auditLabel ?? control.name,
        );
      } else {
        setConfigError(error instanceof Error ? error.message : "App control update failed");
        addAudit("App control fallback", `${auditLabel ?? control.name} updated locally only.`, "warn");
      }
    } finally {
      setSavingConfigId(null);
    }
  }

  function controlById(controlId: string) {
    return controls.find((control) => control.id === controlId);
  }

  function externalServiceChecks(service: ExternalServiceConfig) {
    return deploymentPreflight?.checks.filter((check) => service.checks.includes(check.id)) ?? [];
  }

  function externalServiceTone(service: ExternalServiceConfig): "good" | "warn" | "danger" | "neutral" {
    const readiness = controlById(service.readinessControlId)?.value === true;
    const referenceIssue = providerReferenceUiIssue(controlById(service.referenceControlId)?.value);
    const checks = externalServiceChecks(service);
    if (checks.some((check) => check.status === "blocker")) return "danger";
    if (referenceIssue) return "warn";
    if (!readiness || checks.some((check) => check.status === "warning")) return "warn";
    if (!checks.length) return "neutral";
    return "good";
  }

  function externalServiceStatus(service: ExternalServiceConfig) {
    const readiness = controlById(service.readinessControlId)?.value === true;
    const referenceIssue = providerReferenceUiIssue(controlById(service.referenceControlId)?.value);
    const checks = externalServiceChecks(service);
    if (checks.some((check) => check.status === "blocker")) return "runtime blocked";
    if (referenceIssue) return referenceIssue;
    if (!readiness) return "admin approval pending";
    if (checks.some((check) => check.status === "warning")) return "runtime warning";
    if (!checks.length) return "not checked";
    return "ready";
  }

  async function saveExternalReference(service: ExternalServiceConfig) {
    const value = (externalConfigDrafts[service.referenceControlId] ?? "").trim();
    if (!value) return;
    await changeControl(service.referenceControlId, value, `${service.title} external config reference`);
  }

  function platformPostgresChecks(item: PlatformPostgresItem) {
    return deploymentPreflight?.checks.filter((check) => item.checks.includes(check.id)) ?? [];
  }

  function platformPostgresTone(item: PlatformPostgresItem): "good" | "warn" | "danger" | "neutral" {
    const evidenceIssue = launchEvidenceUiIssue(controlById(item.evidenceControlId)?.value);
    const checks = platformPostgresChecks(item);
    if (checks.some((check) => check.status === "blocker")) return "danger";
    if (evidenceIssue || checks.some((check) => check.status === "warning")) return "warn";
    if (!checks.length) return "neutral";
    return "good";
  }

  function platformPostgresStatus(item: PlatformPostgresItem) {
    const evidenceIssue = launchEvidenceUiIssue(controlById(item.evidenceControlId)?.value);
    const checks = platformPostgresChecks(item);
    if (checks.some((check) => check.status === "blocker")) return "runtime blocked";
    if (evidenceIssue) return evidenceIssue;
    if (checks.some((check) => check.status === "warning")) return "runtime warning";
    if (!checks.length) return "not checked";
    return "evidence ready";
  }

  async function savePlatformPostgresEvidence(item: PlatformPostgresItem) {
    const value = (platformPostgresEvidenceDrafts[item.evidenceControlId] ?? "").trim();
    if (!value) return;
    await changeControl(item.evidenceControlId, value, `${item.title} evidence reference`);
  }

  function renderPlatformPostgresReadiness() {
    const platformLane = mvp1LaunchHandoff?.lanes.find((lane) => lane.id === "platform-postgres");
    return (
      <div className="platform-postgres-panel deployment-ops-panel">
        <div className="panel-header compact">
          <div>
            <span>Platform/Postgres</span>
            <h2>Durable ticket-spine evidence</h2>
          </div>
          <StatusChip label={platformLane?.status ?? "needs evidence"} tone={platformLane ? launchCheckTone(platformLane.status === "signed_off" ? "pass" : platformLane.status === "blocked" ? "blocker" : "warning") : "warn"} />
        </div>
        <div className="control-note">
          <Database size={16} />
          <span>
            Record controlled artifacts for migration output and Postgres-backed MVP checks. These references prove platform execution;
            they do not expose raw database URLs or replace runtime deployment preflight.
          </span>
        </div>
        <div className="deployment-ops-grid">
          {platformPostgresItems.map((item) => {
            const evidenceDraft = platformPostgresEvidenceDrafts[item.evidenceControlId] ?? String(controlById(item.evidenceControlId)?.value ?? "");
            const checks = platformPostgresChecks(item);
            const priorityChecks = checks.filter((check) => check.status !== "pass");
            return (
              <article className={platformPostgresTone(item)} key={item.id}>
                <div className="deployment-ops-head">
                  <div>
                    <span>{item.owner}</span>
                    <strong>{item.title}</strong>
                  </div>
                  <StatusChip label={platformPostgresStatus(item)} tone={platformPostgresTone(item)} />
                </div>
                <p>{item.proof}</p>
                <form className="deployment-ops-evidence" onSubmit={(event) => { event.preventDefault(); void savePlatformPostgresEvidence(item); }}>
                  <label>
                    Evidence reference
                    <input
                      aria-label={`${item.title} evidence reference`}
                      onChange={(event) =>
                        setPlatformPostgresEvidenceDrafts((current) => ({ ...current, [item.evidenceControlId]: event.target.value }))
                      }
                      placeholder={launchEvidenceReferenceHints[item.evidenceControlId]}
                      value={evidenceDraft}
                    />
                    <small className="evidence-ref-hint">{launchEvidenceReferenceHints[item.evidenceControlId]}</small>
                  </label>
                  <button disabled={savingConfigId === item.evidenceControlId || !evidenceDraft.trim()} type="submit">
                    {savingConfigId === item.evidenceControlId ? "Saving..." : "Save evidence"}
                  </button>
                </form>
                <div className="deployment-ops-checks">
                  {item.commands.map((command) => (
                    <div key={command}>
                      <StatusChip label="command" tone="neutral" />
                      <span>{command}</span>
                      <small>Run against the target staging or production environment and attach the redacted artifact reference.</small>
                    </div>
                  ))}
                  {(priorityChecks.length ? priorityChecks : checks.slice(0, 2)).map((check) => (
                    <div key={check.id}>
                      <StatusChip label={check.status} tone={preflightStatusTone(check.status)} />
                      <span>{check.label}</span>
                      <small>{check.remediation}</small>
                    </div>
                  ))}
                  {!checks.length && <span>Refresh deployment preflight to bind this platform proof to runtime checks.</span>}
                </div>
              </article>
            );
          })}
        </div>
        {platformLane?.blockers.length ? (
          <div className="deployment-ops-status blocker">
            <strong>Platform lane blockers</strong>
            {platformLane.blockers.slice(0, 4).map((blocker) => (
              <span key={blocker}>{blocker}</span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderExternalProviderConfiguration() {
    return (
      <div className="external-config-panel">
        <div className="panel-header compact">
          <div>
            <span>External providers</span>
            <h2>MVP1 launch-gate configuration</h2>
          </div>
          <button className="text-button" disabled={deploymentPreflightLoading} onClick={() => void refreshDeploymentPreflight(true)} type="button">
            {deploymentPreflightLoading ? "Checking..." : "Refresh preflight"}
          </button>
        </div>
        <div className="control-note">
          <ShieldAlert size={16} />
          <span>
            Store provider URLs, secret-manager references, evidence links, and readiness approvals here. Do not paste raw passwords,
            API keys, OTP values, private keys, or object-store credentials into Admin.
          </span>
        </div>
        <div className="external-config-grid">
          {externalServiceConfigs.map((service) => {
            const readinessControl = controlById(service.readinessControlId);
            const referenceControl = controlById(service.referenceControlId);
            const checks = externalServiceChecks(service);
            const priorityChecks = checks.filter((check) => check.status !== "pass");
            const draft = externalConfigDrafts[service.referenceControlId] ?? String(referenceControl?.value ?? "");
            return (
              <article className={externalServiceTone(service)} key={service.id}>
                <div className="external-config-head">
                  <div>
                    <span>{service.owner}</span>
                    <strong>{service.title}</strong>
                  </div>
                  <StatusChip label={externalServiceStatus(service)} tone={externalServiceTone(service)} />
                </div>
                <p>{service.optionSummary}</p>
                <form className="external-config-reference" onSubmit={(event) => { event.preventDefault(); void saveExternalReference(service); }}>
                  <label>
                    Config or evidence reference
                    <input
                      aria-label={`${service.title} config reference`}
                      onChange={(event) =>
                        setExternalConfigDrafts((current) => ({ ...current, [service.referenceControlId]: event.target.value }))
                      }
                      placeholder={providerReferenceHints[service.referenceControlId]}
                      value={draft}
                    />
                    <small className="evidence-ref-hint">{providerReferenceHints[service.referenceControlId]}</small>
                  </label>
                  <button disabled={savingConfigId === service.referenceControlId || !draft.trim()} type="submit">
                    {savingConfigId === service.referenceControlId ? "Saving..." : "Save ref"}
                  </button>
                </form>
                <div className="external-config-actions">
                  <button
                    className="text-button"
                    disabled={savingConfigId === service.readinessControlId}
                    onClick={() => void changeControl(service.readinessControlId, !(readinessControl?.value === true), `${service.title} readiness flag`)}
                    type="button"
                  >
                    {savingConfigId === service.readinessControlId
                      ? "Saving..."
                      : readinessControl?.value === true
                        ? "Unset readiness"
                        : "Mark ready for approval"}
                  </button>
                  <span>{readinessControl?.name ?? service.readinessControlId}</span>
                </div>
                <div className="external-config-options">
                  <strong>Configuration options</strong>
                  <div>
                    {service.options.map((option) => (
                      <span key={`${service.id}-${option.label}`}>
                        <b>{option.label}</b>
                        <code>{option.value}</code>
                        <small>{option.note}</small>
                      </span>
                    ))}
                  </div>
                </div>
                {service.policyControlIds?.length ? (
                  <div className="external-config-policy">
                    <strong>Admin policy controls</strong>
                    <div>
                      {service.policyControlIds.map((controlId) => {
                        const policyControl = controlById(controlId);
                        return (
                          <span key={controlId}>
                            <b>{policyControl?.name ?? controlId}</b>
                            <code>{displayValue(policyControl?.value ?? "missing")}</code>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="external-config-env">
                  <strong>Required env/options</strong>
                  <div>
                    {service.requiredEnv.map((key) => (
                      <code key={key}>{key}</code>
                    ))}
                  </div>
                </div>
                <div className="external-config-env secret">
                  <strong>Secret material</strong>
                  <div>
                    {service.secretEnv.map((key) => (
                      <code key={key}>{key}</code>
                    ))}
                  </div>
                </div>
                <div className="external-config-checks">
                  {(priorityChecks.length ? priorityChecks : checks.slice(0, 2)).map((check) => (
                    <div key={check.id}>
                      <StatusChip label={check.status} tone={preflightStatusTone(check.status)} />
                      <span>{check.label}</span>
                      <small>{check.remediation}</small>
                    </div>
                  ))}
                  {!checks.length && <span>Run deployment preflight to bind this provider to runtime checks.</span>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  function renderOperatorUatSignoff() {
    const uatReadinessCheck = launchReadiness?.checks.find((check) => check.id === "operator-uat");
    const readyCount = operatorUatItems.filter((item) => controlById(item.controlId)?.value === true).length;
    const blockerDefects = Number(controlById("uat-open-blocker-defects")?.value ?? 0);
    const criticalDefects = Number(controlById("uat-open-critical-defects")?.value ?? 0);
    const defectHoldCount = blockerDefects + criticalDefects;
    async function saveOperatorDefectCount(controlId: string) {
      const raw = operatorUatDefectDrafts[controlId] ?? String(controlById(controlId)?.value ?? "0");
      const numeric = Math.max(0, Math.min(365, Number.parseInt(raw, 10) || 0));
      await changeControl(controlId, numeric, controlById(controlId)?.name ?? controlId);
    }
    return (
      <div className="operator-uat-panel">
        <div className="panel-header compact">
          <div>
            <span>MVP1 rehearsal</span>
            <h2>Operator UAT and SOP sign-off</h2>
          </div>
          <StatusChip label={uatReadinessCheck?.status ?? `${readyCount}/${operatorUatItems.length} signed`} tone={uatReadinessCheck ? launchCheckTone(uatReadinessCheck.status) : "warn"} />
        </div>
        <div className="control-note">
          <ClipboardList size={16} />
          <span>
            Track real operator rehearsal here before MVP1 launch: citizen lifecycle, verification SOP, role dashboards, protected track,
            and the defect triage process. These approvals do not bypass runtime preflight or external-provider gates.
          </span>
        </div>
        <form className="operator-uat-evidence" onSubmit={(event) => { event.preventDefault(); void changeControl("uat-launch-rehearsal-evidence-ref", operatorUatEvidenceDraft.trim(), "MVP1 rehearsal evidence reference"); }}>
          <label>
            Rehearsal packet / UAT evidence reference
            <input
              aria-label="MVP1 rehearsal evidence reference"
              onChange={(event) => setOperatorUatEvidenceDraft(event.target.value)}
              placeholder="artifact://whistle/mvp1/rehearsal-packet/uat-run-001"
              value={operatorUatEvidenceDraft}
            />
            <small className="evidence-ref-hint">{launchEvidenceReferenceHints["uat-launch-rehearsal-evidence-ref"]}</small>
          </label>
          <button disabled={savingConfigId === "uat-launch-rehearsal-evidence-ref" || !operatorUatEvidenceDraft.trim()} type="submit">
            {savingConfigId === "uat-launch-rehearsal-evidence-ref" ? "Saving..." : "Save evidence"}
          </button>
        </form>
        <div className="operator-defect-register">
          <form className="operator-uat-evidence" onSubmit={(event) => { event.preventDefault(); void changeControl("uat-defect-register-ref", operatorUatDefectRegisterDraft.trim(), "MVP1 defect register reference"); }}>
            <label>
              Defect register / triage queue reference
              <input
                aria-label="MVP1 defect register reference"
                onChange={(event) => setOperatorUatDefectRegisterDraft(event.target.value)}
                placeholder="artifact://whistle/mvp1/defect-register/uat-run-001"
                value={operatorUatDefectRegisterDraft}
              />
              <small className="evidence-ref-hint">{launchEvidenceReferenceHints["uat-defect-register-ref"]}</small>
            </label>
            <button disabled={savingConfigId === "uat-defect-register-ref" || !operatorUatDefectRegisterDraft.trim()} type="submit">
              {savingConfigId === "uat-defect-register-ref" ? "Saving..." : "Save register"}
            </button>
          </form>
          <div className="operator-defect-summary">
            <span>Launch hold defects</span>
            <strong>{defectHoldCount}</strong>
            <small>Blocker and critical counts must be zero before operator UAT can pass.</small>
          </div>
        </div>
        <div className="operator-defect-grid">
          {operatorUatDefectItems.map((item) => {
            const control = controlById(item.controlId);
            const value = Number(control?.value ?? 0);
            const draft = operatorUatDefectDrafts[item.controlId] ?? String(value);
            const tone = item.tone === "danger" && value === 0 ? "good" : item.tone;
            return (
              <article className={tone} key={item.id}>
                <div>
                  <span>{item.label}</span>
                  <strong>{value}</strong>
                </div>
                <small>{item.launchRule}</small>
                <form onSubmit={(event) => { event.preventDefault(); void saveOperatorDefectCount(item.controlId); }}>
                  <input
                    aria-label={`${item.label} count`}
                    inputMode="numeric"
                    min={0}
                    max={365}
                    onChange={(event) => setOperatorUatDefectDrafts((current) => ({ ...current, [item.controlId]: event.target.value }))}
                    type="number"
                    value={draft}
                  />
                  <button disabled={savingConfigId === item.controlId} type="submit">
                    {savingConfigId === item.controlId ? "Saving..." : "Save"}
                  </button>
                </form>
              </article>
            );
          })}
        </div>
        <div className="operator-uat-grid">
          {operatorUatItems.map((item) => {
            const control = controlById(item.controlId);
            const isReady = control?.value === true;
            return (
              <article className={isReady ? "good" : "warn"} key={item.id}>
                <div className="operator-uat-head">
                  <div>
                    <span>{item.owner}</span>
                    <strong>{item.title}</strong>
                  </div>
                  <StatusChip label={isReady ? "signed" : "pending"} tone={isReady ? "good" : "warn"} />
                </div>
                <p>{item.evidence}</p>
                <div className="operator-uat-flows">
                  {item.flows.map((flow) => (
                    <span key={flow}>{flow}</span>
                  ))}
                </div>
                <button
                  className="text-button"
                  disabled={savingConfigId === item.controlId}
                  onClick={() => void changeControl(item.controlId, !isReady, item.title)}
                  type="button"
                >
                  {savingConfigId === item.controlId ? "Saving..." : isReady ? "Unset sign-off" : "Mark ready for approval"}
                </button>
              </article>
            );
          })}
        </div>
        <div className="operator-triage-policy">
          <div className="panel-header compact">
            <div>
              <span>Defect triage</span>
              <h3>MVP1 launch decision rules</h3>
            </div>
            <StatusChip label="scope guard" tone="neutral" />
          </div>
          <div className="operator-triage-grid">
            {operatorUatTriageLanes.map((lane) => (
              <article className={lane.severity.toLowerCase()} key={lane.severity}>
                <div>
                  <strong>{lane.severity}</strong>
                  <span>{lane.decision}</span>
                </div>
                <p>{lane.action}</p>
                <div>
                  {lane.examples.map((example) => (
                    <span key={example}>{example}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
        {uatReadinessCheck && (
          <div className={`operator-uat-status ${uatReadinessCheck.status}`}>
            <strong>{uatReadinessCheck.summary}</strong>
            {uatReadinessCheck.details.slice(0, 4).map((detail) => (
              <span key={detail}>{detail}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  function deploymentOpsChecks(item: DeploymentOpsItem) {
    return deploymentPreflight?.checks.filter((check) => item.checks.includes(check.id)) ?? [];
  }

  function deploymentOpsTone(item: DeploymentOpsItem): "good" | "warn" | "danger" | "neutral" {
    const signedOff = controlById(item.controlId)?.value === true;
    const checks = deploymentOpsChecks(item);
    if (checks.some((check) => check.status === "blocker")) return "danger";
    if (!signedOff || checks.some((check) => check.status === "warning")) return "warn";
    if (!checks.length) return "neutral";
    return "good";
  }

  async function saveDeploymentOpsEvidence(item: DeploymentOpsItem) {
    if (!item.evidenceControlId) return;
    const value = (deploymentOpsEvidenceDrafts[item.evidenceControlId] ?? "").trim();
    if (!value) return;
    await changeControl(item.evidenceControlId, value, `${item.title} evidence reference`);
  }

  function renderDeploymentOpsSignoff() {
    const opsReadinessCheck = launchReadiness?.checks.find((check) => check.id === "deployment-incident");
    const readyCount = deploymentOpsItems.filter((item) => controlById(item.controlId)?.value === true).length;
    return (
      <div className="deployment-ops-panel">
        <div className="panel-header compact">
          <div>
            <span>Deployment readiness</span>
            <h2>Deployment and incident sign-off</h2>
          </div>
          <StatusChip label={opsReadinessCheck?.status ?? `${readyCount}/${deploymentOpsItems.length} signed`} tone={opsReadinessCheck ? launchCheckTone(opsReadinessCheck.status) : "warn"} />
        </div>
        <div className="control-note">
          <ShieldAlert size={16} />
          <span>
            Split the final launch gate into evidence-backed approvals for restore drill, SIEM/WORM export, telemetry watch, browser origins,
            and incident hold rules. These controls stay separate from provider secret references and runtime preflight.
          </span>
        </div>
        <div className="deployment-question-panel">
          <div className="panel-header compact">
            <div>
              <span>Deployment decisions</span>
              <h3>Exact questions to answer before staging</h3>
            </div>
            <StatusChip label={`${deploymentQuestionItems.length} required`} tone="warn" />
          </div>
          <div className="deployment-question-grid">
            {deploymentQuestionItems.map((item) => (
              <article key={item.id}>
                <div className="deployment-question-head">
                  <span>{item.owner}</span>
                  <strong>{item.title}</strong>
                </div>
                <p>{item.question}</p>
                <code>{item.answerFormat}</code>
                <small>{item.why}</small>
              </article>
            ))}
          </div>
          <div className="control-note">
            <ShieldCheck size={16} />
            <span>
              Government and Admin consoles need an approved identity model before launch. MVP1 UAT uses mobile/password with Admin-controlled
              OTP; production can keep that policy only if approved, or move to OIDC/MFA if government SSO policy requires it.
            </span>
          </div>
        </div>
        <div className="deployment-ops-grid">
          {deploymentOpsItems.map((item) => {
            const control = controlById(item.controlId);
            const isReady = control?.value === true;
            const checks = deploymentOpsChecks(item);
            const priorityChecks = checks.filter((check) => check.status !== "pass");
            const evidenceDraft = item.evidenceControlId
              ? deploymentOpsEvidenceDrafts[item.evidenceControlId] ?? String(controlById(item.evidenceControlId)?.value ?? "")
              : "";
            return (
              <article className={deploymentOpsTone(item)} key={item.id}>
                <div className="deployment-ops-head">
                  <div>
                    <span>{item.owner}</span>
                    <strong>{item.title}</strong>
                  </div>
                  <StatusChip label={isReady ? "signed" : "pending"} tone={isReady ? "good" : "warn"} />
                </div>
                <p>{item.proof}</p>
                {item.evidenceControlId && (
                  <form className="deployment-ops-evidence" onSubmit={(event) => { event.preventDefault(); void saveDeploymentOpsEvidence(item); }}>
                    <label>
                      Evidence reference
                      <input
                        aria-label={`${item.title} evidence reference`}
                        placeholder={item.evidenceControlId ? launchEvidenceReferenceHints[item.evidenceControlId] : undefined}
                        onChange={(event) =>
                          setDeploymentOpsEvidenceDrafts((current) => ({ ...current, [item.evidenceControlId ?? ""]: event.target.value }))
                        }
                        value={evidenceDraft}
                      />
                      {item.evidenceControlId && <small className="evidence-ref-hint">{launchEvidenceReferenceHints[item.evidenceControlId]}</small>}
                    </label>
                    <button disabled={savingConfigId === item.evidenceControlId || !evidenceDraft.trim()} type="submit">
                      {savingConfigId === item.evidenceControlId ? "Saving..." : "Save evidence"}
                    </button>
                  </form>
                )}
                <button
                  className="text-button"
                  disabled={savingConfigId === item.controlId}
                  onClick={() => void changeControl(item.controlId, !isReady, item.title)}
                  type="button"
                >
                  {savingConfigId === item.controlId ? "Saving..." : isReady ? "Unset sign-off" : "Mark ready for approval"}
                </button>
                <div className="deployment-ops-checks">
                  {(priorityChecks.length ? priorityChecks : checks.slice(0, 2)).map((check) => (
                    <div key={check.id}>
                      <StatusChip label={check.status} tone={preflightStatusTone(check.status)} />
                      <span>{check.label}</span>
                      <small>{check.remediation}</small>
                    </div>
                  ))}
                  {!checks.length && <span>Refresh deployment preflight to bind runtime checks.</span>}
                </div>
              </article>
            );
          })}
        </div>
        {opsReadinessCheck && (
          <div className={`deployment-ops-status ${opsReadinessCheck.status}`}>
            <strong>{opsReadinessCheck.summary}</strong>
            {opsReadinessCheck.details.slice(0, 4).map((detail) => (
              <span key={detail}>{detail}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderGovernanceQueue() {
    const pendingRequests = changeRequests.filter((request) => request.status === "pending");
    const approvedRequests = changeRequests.filter((request) => request.status === "approved");
    const rejectedRequests = changeRequests.filter((request) => request.status === "rejected");
    const recentRequests = changeRequests.slice(0, 6);

    return (
      <div className="governance-panel">
        <div className="panel-header compact">
          <div>
            <span>Governance approvals</span>
            <h2>Critical config queue</h2>
          </div>
          <button className="text-button" disabled={governanceLoading} onClick={() => void refreshGovernance(true)} type="button">
            {governanceLoading ? "Refreshing..." : "Refresh approvals"}
          </button>
        </div>
        {governanceError && (
          <div className="control-note danger-note">
            <AlertTriangle size={16} />
            <span>{governanceError}</span>
          </div>
        )}
        <div className="governance-summary">
          <div>
            <span>Pending</span>
            <strong>{pendingRequests.length}</strong>
          </div>
          <div>
            <span>Approved</span>
            <strong>{approvedRequests.length}</strong>
          </div>
          <div>
            <span>Rejected</span>
            <strong>{rejectedRequests.length}</strong>
          </div>
        </div>
        <div className="governance-list">
          {recentRequests.map((request) => (
            <div className="governance-row" key={request.id}>
              <div>
                <strong>{request.summary}</strong>
                <span>
                  {targetLabel(request.target)} | Requested by {request.requestedBy} | {formatDateTime(request.requestedAt) ?? request.requestedAt}
                </span>
                <small>{request.reason}</small>
              </div>
              <StatusChip label={request.status} tone={governanceTone(request.status)} />
              {request.status === "pending" ? (
                <div className="governance-actions">
                  <button
                    className="text-button"
                    disabled={savingGovernanceId === `approve:${request.id}`}
                    onClick={() => void approveGovernanceRequest(request.id)}
                    type="button"
                  >
                    {savingGovernanceId === `approve:${request.id}` ? "Approving..." : "Approve"}
                  </button>
                  <button
                    className="text-button danger-action"
                    disabled={savingGovernanceId === `reject:${request.id}`}
                    onClick={() => void rejectGovernanceRequest(request.id)}
                    type="button"
                  >
                    {savingGovernanceId === `reject:${request.id}` ? "Rejecting..." : "Reject"}
                  </button>
                </div>
              ) : (
                <span className="decision-note">
                  {request.decidedBy ? `${request.decidedBy} | ${formatDateTime(request.decidedAt) ?? "Decision saved"}` : "Decision saved"}
                </span>
              )}
            </div>
          ))}
          {!recentRequests.length && (
            <div className="governance-empty">
              <ShieldCheck size={17} />
              <span>No critical config requests yet. Critical edits will queue here for second-admin approval.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderAuditExportCard() {
    return (
      <section className="admin-panel export-card">
        <PanelHeader eyebrow="Export" title="Governance audit package" />
        <div className="control-note">
          <ClipboardList size={16} />
          <span>Export is metadata-only for sensitive records and includes ticket audit plus config approval history.</span>
        </div>
        <button
          className="text-button export-button"
          disabled={savingGovernanceId === "audit-export"}
          onClick={() => void generateAuditExport()}
          type="button"
        >
          {savingGovernanceId === "audit-export" ? "Generating..." : "Generate audit export"}
        </button>
        {auditExport && (
          <div className="export-facts">
            <InfoBox label="Generated" value={formatDateTime(auditExport.generatedAt) ?? auditExport.generatedAt} />
            <InfoBox label="Audit events" value={String(auditExport.counts.auditEvents)} />
            <InfoBox label="Config requests" value={String(auditExport.counts.configChangeRequests)} />
            <InfoBox label="Sensitive handling" value={auditExport.controls.redaction} />
            <InfoBox label="Storage" value={auditExport.controls.productionStorage} />
            <InfoBox label="Delivery" value={auditExportDelivery ? `${auditExportDelivery.status} via ${auditExportDelivery.provider}` : "Not generated"} />
          </div>
        )}
      </section>
    );
  }

  function renderMvpScope() {
    const report = mvpScope ?? fallbackMvpScopeReport;
    const activePhase = report.phases.find((phase) => phase.id === report.activeBuild) ?? report.phases[0];
    const activeWorkstreams = report.activeBuildWorkstreams.filter((workstream) => workstream.phaseId === report.activeBuild);
    return (
      <section className="admin-panel mvp-scope-panel">
        <div className="panel-header compact">
          <div>
            <span>MVP Roadmap</span>
            <h2>Build order and readiness map</h2>
          </div>
          <button className="text-button" disabled={mvpScopeLoading} onClick={() => void refreshMvpScope(true)} type="button">
            {mvpScopeLoading ? "Refreshing..." : "Refresh scope"}
          </button>
        </div>
        <div className="control-note">
          <ClipboardList size={16} />
          <span>
            {mvpScopeError
              ? `Using local scope fallback: ${mvpScopeError}`
              : `Loaded from ${mvpScopeMode}. Active build is ${report.activeBuild}; scope is generated from Admin config and access state.`}
          </span>
        </div>
        <div className="mvp-hero">
          <div>
            <span>Active build</span>
            <strong>{activePhase.id}</strong>
            <p>{activePhase.title}</p>
          </div>
          <div>
            <span>Implementation mapped</span>
            <strong>{report.overallImplementationPercent}%</strong>
            <p>Weighted across MVP1-MVP4, with MVP1 carrying the current launch weight.</p>
          </div>
          <div>
            <span>Launch readiness</span>
            <strong>{report.overallLaunchReadinessPercent}%</strong>
            <p>Operational readiness, not just code completion.</p>
          </div>
        </div>
        <div className="mvp-focus-header">
          <div>
            <span>MVP1 execution lanes</span>
            <h3>Parallel work without expanding scope</h3>
          </div>
          <StatusChip label={`${activeWorkstreams.length} lanes`} tone="neutral" />
        </div>
        <div className="mvp-workstreams">
          {activeWorkstreams.map((workstream) => (
            <article className={workstream.status} key={workstream.id}>
              <div className="mvp-workstream-head">
                <div>
                  <span>{workstream.owner.replaceAll("_", " ")}</span>
                  <strong>{workstream.title}</strong>
                </div>
                <StatusChip label={mvpWorkstreamStatusLabel(workstream)} tone={mvpStatusTone(workstream.status)} />
              </div>
              <p>{workstream.summary}</p>
              <div className="mvp-workstream-meta">
                <StatusChip label={workstream.parallelizable ? "parallel now" : "sequential"} tone={workstream.parallelizable ? "good" : "warn"} />
                <StatusChip label={`${workstream.blockers.length} blocker${workstream.blockers.length === 1 ? "" : "s"}`} tone={workstream.blockers.length ? "danger" : "good"} />
              </div>
              <div className="mvp-workstream-actions">
                <strong>Next</strong>
                {workstream.nextActions.slice(0, 3).map((action) => (
                  <span key={action}>{action}</span>
                ))}
              </div>
              <small>{workstream.blockers[0] ?? workstream.evidence[0] ?? "No blocker recorded."}</small>
            </article>
          ))}
        </div>
        <Mvp1LaunchHandoffPanel
          error={mvp1LaunchHandoffError}
          loading={mvp1LaunchHandoffLoading}
          mode={mvp1LaunchHandoffMode}
          onRefresh={() => void refreshMvp1LaunchHandoff(true)}
          report={mvp1LaunchHandoff ?? fallbackMvp1LaunchHandoffReport}
        />
        <DeploymentPreflightPanel
          error={deploymentPreflightError}
          loading={deploymentPreflightLoading}
          onRefresh={() => void refreshDeploymentPreflight(true)}
          report={deploymentPreflight}
        />
        <div className="mvp-order">
          {report.currentBuildOrder.map((phaseId, index) => (
            <span className={phaseId === report.activeBuild ? "active" : ""} key={phaseId}>
              {index + 1}. {phaseId}
            </span>
          ))}
        </div>
        <div className="mvp-principles">
          {report.principles.map((principle) => (
            <div key={principle}>
              <ShieldCheck size={15} />
              <span>{principle}</span>
            </div>
          ))}
        </div>
        <div className="mvp-phase-list">
          {report.phases.map((phase) => (
            <article className={phase.id === report.activeBuild ? "active" : ""} key={phase.id}>
              <div className="mvp-phase-head">
                <div>
                  <span>{phase.id}</span>
                  <h3>{phase.title}</h3>
                  <p>{phase.purpose}</p>
                </div>
                <StatusChip label={phase.status.replaceAll("_", " ")} tone={mvpStatusTone(phase.status)} />
              </div>
              <div className="mvp-bars">
                <ProgressMeter label="Implementation" value={phase.implementationPercent} />
                <ProgressMeter label="Readiness" value={phase.launchReadinessPercent} />
              </div>
              <div className="mvp-surfaces">
                <InfoBox label="Included" value={phase.includedSurfaces.join(", ")} />
                <InfoBox label="Deferred" value={phase.deferredSurfaces.join(", ")} />
              </div>
              <div className="mvp-items">
                {phase.items.map((item) => (
                  <div key={item.id}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.evidence[0] ?? "Evidence pending"}</span>
                      <small>{item.gaps[0] ?? "No immediate gap recorded."}</small>
                    </div>
                    <StatusChip label={item.status.replaceAll("_", " ")} tone={mvpStatusTone(item.status)} />
                  </div>
                ))}
              </div>
              <div className="mvp-next">
                <strong>Next actions</strong>
                {phase.nextActions.slice(0, 3).map((action) => (
                  <span key={action}>{action}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  function renderUsers() {
    return (
      <section className="admin-panel">
        <PanelHeader eyebrow="Users" title="Government user directory" />
        <form className="inline-form" onSubmit={inviteUser}>
          <input
            aria-label="New user name"
            onChange={(event) => setUserDraft(event.target.value)}
            placeholder="Invite user name"
            value={userDraft}
          />
          <button disabled={savingAccessId === "user"} type="submit">
            <Plus size={15} />
            {savingAccessId === "user" ? "Saving..." : "Invite user"}
          </button>
        </form>
        <div className="control-note">
          <KeyRound size={16} />
          <span>
            {accessLoading
              ? "Loading governed user directory from the access API..."
              : accessError
                ? `Using local access fallback: ${accessError}`
                : `Loaded from ${accessMode}. New users save through the Admin access API.`}
          </span>
          <button className="text-button" onClick={() => void refreshAccess({ audit: true })} type="button">Refresh access</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>MFA</th>
                <th>Teams</th>
                <th>Last seen</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const userTeams = memberships.filter((membership) => membership.userId === user.id).map((membership) => teamName(membership.teamId));
                return (
                  <tr className={selectedUser.id === user.id ? "selected" : ""} key={user.id} onClick={() => setSelectedUserId(user.id)}>
                    <td>
                      <strong>{user.name}</strong>
                      <span>{user.title}</span>
                    </td>
                    <td>
                      <StatusChip label={user.status} tone={statusTone(user.status)} />
                    </td>
                    <td>{user.mfa}</td>
                    <td>{userTeams.length ? userTeams.join(", ") : "No team"}</td>
                    <td>{user.lastSeen}</td>
                    <td>
                      <button className="text-button" disabled={savingAccessId === `user:${user.id}`} onClick={() => void toggleUserStatus(user.id)} type="button">
                        {savingAccessId === `user:${user.id}` ? "Saving..." : user.status === "Deactivated" ? "Reactivate" : "Deactivate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderTeams() {
    return (
      <>
        <section className="admin-panel">
          <PanelHeader eyebrow="Teams" title="Access is granted through teams first" />
          <form className="control-grid" onSubmit={createTeam}>
            <label>
              Team name
              <input onChange={(event) => setTeamDraft(event.target.value)} placeholder="Create team" value={teamDraft} />
            </label>
            <label>
              Team type
              <select value={newTeamKind} onChange={(event) => setNewTeamKind(event.target.value as TeamKind)}>
                <option>CM Cell</option>
                <option>Minister Team</option>
                <option>Department Officer</option>
                <option>MLA Team</option>
                <option>Local Owner</option>
                <option>Verification</option>
                <option>Rejection Review</option>
                <option>Admin</option>
                <option>Worker</option>
              </select>
            </label>
            <label>
              Default scope
              <select value={accessScope} onChange={(event) => setAccessScope(event.target.value)}>
                {scopeCatalog.map((scope) => (
                  <option key={scope}>{scope}</option>
                ))}
              </select>
            </label>
            <button disabled={savingAccessId === "team"} type="submit">{savingAccessId === "team" ? "Saving..." : "Create team"}</button>
          </form>
        </section>
        <section className="card-grid">
          {teams.map((team) => (
            <button className={`team-card ${selectedTeam.id === team.id ? "selected" : ""}`} key={team.id} onClick={() => setSelectedTeamId(team.id)} type="button">
              <strong>{team.name}</strong>
              <span>
                {team.kind} | {team.defaultScope}
              </span>
              <small>Owner: {userName(team.ownerUserId)}</small>
              <StatusChip label={team.status} tone={statusTone(team.status)} />
            </button>
          ))}
        </section>
        <section className="admin-panel">
          <PanelHeader eyebrow="Team Governance" title={`Selected team: ${selectedTeam.name}`} />
          <div className="action-strip">
            <button disabled={savingAccessId === `team:${selectedTeam.id}`} onClick={() => void toggleTeamStatus(selectedTeam.id)} type="button">
              {savingAccessId === `team:${selectedTeam.id}` ? "Saving..." : selectedTeam.status === "Inactive" ? "Reactivate team" : "Deactivate team"}
            </button>
            <span className="inline-note">
              {selectedTeam.kind} | {selectedTeam.defaultScope} | Owner: {userName(selectedTeam.ownerUserId)}
            </span>
          </div>
        </section>
        <section className="admin-panel">
          <PanelHeader eyebrow="Membership" title={`Assign ${selectedUser.name} to ${selectedTeam.name}`} />
          <form className="control-grid compact" onSubmit={addMembership}>
            <label>
              Role in team
              <select value={membershipRole} onChange={(event) => setMembershipRole(event.target.value)}>
                <option>Viewer</option>
                <option>Coordinator</option>
                <option>Approver</option>
                <option>Field supervisor</option>
                <option>Acting admin</option>
              </select>
            </label>
            <button disabled={savingAccessId === "membership"} type="submit">{savingAccessId === "membership" ? "Saving..." : "Add membership"}</button>
          </form>
          <div className="membership-list">
            {selectedMemberships.map((membership) => {
              const expired = isExpiredDate(membership.expiresAt);
              return (
                <div key={`${membership.teamId}:${membership.id ?? membership.role}`}>
                  <div>
                    <strong>{teamName(membership.teamId)}</strong>
                    <span>
                      {membership.role} | {expired ? "Revoked" : membership.expiresAt ? `Expires ${formatDateTime(membership.expiresAt)}` : "No expiry"}
                    </span>
                  </div>
                  <StatusChip label={expired ? "Revoked" : "Active"} tone={expired ? "danger" : "good"} />
                  <button
                    className="text-button"
                    disabled={!membership.id || savingAccessId === `membership:${membership.id}`}
                    onClick={() => void toggleMembershipExpiry(membership.id)}
                    type="button"
                  >
                    {savingAccessId === `membership:${membership.id}` ? "Saving..." : expired ? "Restore" : "Revoke"}
                  </button>
                </div>
              );
            })}
            {!selectedMemberships.length && (
              <div>
                <div>
                  <strong>No memberships yet</strong>
                  <span>Add this user to a team to grant governed access.</span>
                </div>
              </div>
            )}
          </div>
        </section>
      </>
    );
  }

  function renderAccess() {
    return (
      <section className="admin-panel">
        <PanelHeader eyebrow="Access" title="Role and scope grants" />
        <div className="control-note">
          <ShieldCheck size={16} />
          <span>
            {accessLoading
              ? "Syncing grants from the access API..."
              : accessError
                ? `Local fallback active: ${accessError}`
                : `Live access model: ${accessMode}. Grant visibility changes save to the access API and update effective access immediately.`}
          </span>
          <button className="text-button" onClick={() => void refreshAccess({ audit: true })} type="button">Refresh access</button>
        </div>
        <div className="action-strip">
          <button disabled={savingAccessId === "grant-user"} onClick={() => void grantCmAccess()} type="button">
            {savingAccessId === "grant-user" ? "Saving..." : "Grant selected user CM access"}
          </button>
          <button disabled={savingAccessId === "grant-team"} onClick={() => void addTeamAccess()} type="button">
            {savingAccessId === "grant-team" ? "Saving..." : "Grant selected team scoped access"}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Role</th>
                <th>Scope</th>
                <th>Protected</th>
                <th>Reporter</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id}>
                  <td>
                    <strong>{targetName(grant)}</strong>
                    <span>{grant.targetType}</span>
                  </td>
                  <td>{grant.role}</td>
                  <td>
                    <strong>{grant.scope}</strong>
                    <span>{grant.scopeType}</span>
                  </td>
                  <td>
                    <SwitchButton
                      active={grant.protectedQueue}
                      disabled={savingAccessId === `grant:${grant.id}:protectedQueue`}
                      label={grant.protectedQueue ? "Visible" : "Hidden"}
                      onClick={() => void toggleGrantFlag(grant.id, "protectedQueue")}
                    />
                  </td>
                  <td>
                    <SwitchButton
                      active={grant.reporterIdentity}
                      danger
                      disabled={savingAccessId === `grant:${grant.id}:reporterIdentity`}
                      label={grant.reporterIdentity ? "Allowed" : "Masked"}
                      onClick={() => void toggleGrantFlag(grant.id, "reporterIdentity")}
                    />
                  </td>
                  <td>{grant.expiresAt ?? "No expiry"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderPermissions() {
    return (
      <section className="admin-panel">
        <PanelHeader eyebrow="Permissions" title="Sensitive data and action profiles" />
        <div className="permission-list">
          {permissions.map((profile) => (
            <article key={profile.id}>
              <div>
                <strong>{profile.role}</strong>
                <span>{profile.allowedActions.join(", ")}</span>
              </div>
              <SwitchButton active={profile.protectedQueue} label="Protected queue" onClick={() => togglePermission(profile.id, "protectedQueue")} />
              <SwitchButton active={profile.reporterIdentity} danger label="Reporter identity" onClick={() => togglePermission(profile.id, "reporterIdentity")} />
              <button className="text-button" onClick={() => cycleEvidence(profile.id)} type="button">
                Evidence: {profile.evidenceAccess}
              </button>
              <SwitchButton active={profile.canApproveConfig} label="Approve config" onClick={() => togglePermission(profile.id, "canApproveConfig")} />
            </article>
          ))}
        </div>
      </section>
    );
  }

  function renderLaunchControls() {
    return (
      <section className="admin-panel">
        <PanelHeader eyebrow="Launch Controls" title="What is blocking MVP1 launch" />
        <div className="control-note">
          <Bell size={16} />
          <span>
            {configLoading
              ? "Loading governed configuration from the ticket spine API..."
              : configError
                ? `Using local fallback: ${configError}`
                : `Loaded from ${configMode}. Changes save through the Admin config API.`}
          </span>
          <button className="text-button" onClick={() => void refreshConfig()} type="button">Refresh config</button>
        </div>
        {renderGovernanceQueue()}
        {renderPlatformPostgresReadiness()}
        {renderExternalProviderConfiguration()}
        {renderDeploymentOpsSignoff()}
        {renderOperatorUatSignoff()}
        <label className="template-editor">
          Notification template draft
          <textarea value={notificationDraft} onChange={(event) => setNotificationDraft(event.target.value)} />
        </label>

        <div className="config-subsection">
          <div className="panel-header compact">
            <div>
              <span>App controls</span>
              <h2>Privacy, language, notifications, and launch flags</h2>
            </div>
          </div>
        <div className="control-list">
          {controls.map((control) => (
            <div key={control.id}>
              <div>
                <strong>{control.name}</strong>
                <span>{control.group}</span>
              </div>
              <StatusChip label={control.critical ? "Critical" : "Standard"} tone={control.critical ? "danger" : "neutral"} />
              <button className="text-button" disabled={savingConfigId === control.id} onClick={() => void changeControl(control.id)} type="button">
                {savingConfigId === control.id ? "Saving..." : displayValue(control.value)}
              </button>
            </div>
          ))}
        </div>
        </div>
      </section>
    );
  }

  function renderSlaCategories() {
    return (
      <section className="admin-panel">
        <PanelHeader eyebrow="SLA/Categories" title="Category launch matrix and escalation clocks" />
        <div className="control-note">
          <SlidersHorizontal size={16} />
          <span>
            {configLoading
              ? "Loading governed category and SLA configuration..."
              : configError
                ? `Using local fallback: ${configError}`
                : `Loaded from ${configMode}. Category readiness, sensitivity, and SLA changes save through the Admin config API.`}
          </span>
          <button className="text-button" onClick={() => void refreshConfig()} type="button">Refresh config</button>
        </div>

        <div className="config-subsection">
          <div className="panel-header compact">
            <div>
              <span>SLA policies</span>
              <h2>State-level escalation clocks</h2>
            </div>
          </div>
          <div className="policy-list">
            {slaPolicies.map((policy) => (
              <div key={policy.stage}>
                <div>
                  <strong>{policy.label}</strong>
                  <span>Escalates to {policy.escalationTarget}</span>
                </div>
                <StatusChip label={policy.enabled ? "Enabled" : "Paused"} tone={policy.enabled ? "good" : "warn"} />
                <button className="text-button" disabled={savingConfigId === policy.stage} onClick={() => void adjustSla(policy.stage, -1)} type="button">
                  -1 day
                </button>
                <strong>{policy.durationDays} days</strong>
                <button className="text-button" disabled={savingConfigId === policy.stage} onClick={() => void adjustSla(policy.stage, 1)} type="button">
                  +1 day
                </button>
                <button className="text-button" disabled={savingConfigId === `${policy.stage}:enabled`} onClick={() => void toggleSla(policy.stage)} type="button">
                  {policy.enabled ? "Pause" : "Enable"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="config-subsection">
          <div className="panel-header compact">
            <div>
              <span>Categories</span>
              <h2>Citizen issue types and sensitivity</h2>
            </div>
          </div>
          <div className="category-list">
            {categories.map((category) => (
              <div key={category.id}>
                <div>
                  <strong>{category.labelEn}</strong>
                  <span>{category.labelTa}</span>
                </div>
                <StatusChip label={category.enabled ? "Enabled" : "Disabled"} tone={category.enabled ? "good" : "warn"} />
                <button className="text-button" disabled={savingConfigId === `${category.id}:sensitivity`} onClick={() => void cycleCategorySensitivity(category.id)} type="button">
                  {category.sensitivity.replaceAll("_", " ")}
                </button>
                <button className="text-button" disabled={savingConfigId === category.id} onClick={() => void toggleCategory(category.id)} type="button">
                  {category.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="config-subsection">
          <div className="panel-header compact">
            <div>
              <span>Launch readiness</span>
              <h2>Category owner, SOP, training, and escalation matrix</h2>
            </div>
          </div>
          <div className="readiness-list">
            {categories.map((category) => {
              const item =
                readiness.find((entry) => entry.categoryId === category.id) ??
                ({
                  categoryId: category.id,
                  primaryOwner: "Owner not configured",
                  slaSummary: "SLA not configured",
                  escalationPath: "Escalation path not configured",
                  roleAccess: [],
                  publicVisibility: "Not configured",
                  privacyLevel: category.sensitivity,
                  sopStatus: "required",
                  trainingStatus: "required",
                  launchState: "blocked",
                  notes: "Readiness row is missing from Admin configuration.",
                } satisfies CategoryReadiness);
              return (
                <article key={category.id}>
                  <div className="readiness-main">
                    <strong>{category.labelEn}</strong>
                    <span>{item.primaryOwner}</span>
                    <small>{item.escalationPath}</small>
                  </div>
                  <div className="readiness-meta">
                    <span>{item.slaSummary}</span>
                    <span>{item.roleAccess.join(", ") || "Role access missing"}</span>
                    <span>{item.publicVisibility}</span>
                  </div>
                  <button
                    className="text-button"
                    disabled={savingConfigId === `${category.id}:launchState`}
                    onClick={() => void cycleReadinessField(category.id, "launchState")}
                    type="button"
                  >
                    <StatusChip label={readinessLabel(item.launchState)} tone={readinessTone(item.launchState)} />
                  </button>
                  <button
                    className="text-button"
                    disabled={savingConfigId === `${category.id}:sopStatus`}
                    onClick={() => void cycleReadinessField(category.id, "sopStatus")}
                    type="button"
                  >
                    SOP: {readinessLabel(item.sopStatus)}
                  </button>
                  <button
                    className="text-button"
                    disabled={savingConfigId === `${category.id}:trainingStatus`}
                    onClick={() => void cycleReadinessField(category.id, "trainingStatus")}
                    type="button"
                  >
                    Training: {readinessLabel(item.trainingStatus)}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  function renderUat() {
    const signedOffItems = operatorUatItems.filter((item) => controlById(item.controlId)?.value === true);
    const blockerDefects = Number(controlById("uat-open-blocker-defects")?.value ?? 0);
    const criticalDefects = Number(controlById("uat-open-critical-defects")?.value ?? 0);
    const rehearsalEvidence = String(controlById("uat-launch-rehearsal-evidence-ref")?.value ?? "pending");
    const defectRegister = String(controlById("uat-defect-register-ref")?.value ?? "pending");
    return (
      <div className="uat-layout">
        <section className="admin-panel">
          <PanelHeader eyebrow="MVP1 UAT" title="Local role-testing launcher" />
          <div className="uat-hero">
            <div>
              <span>Sign-offs</span>
              <strong>
                {signedOffItems.length}/{operatorUatItems.length}
              </strong>
              <p>Second-Admin governed controls decide whether operator UAT can clear the MVP1 launch gate.</p>
            </div>
            <div>
              <span>Open launch holds</span>
              <strong>{blockerDefects + criticalDefects}</strong>
              <p>Blocker and critical defects must be zero before UAT sign-off is credible.</p>
            </div>
            <div>
              <span>Seed scenarios</span>
              <strong>{uatSeedScenarios.length}</strong>
              <p>Fixtures cover citizen intake, verification, local ownership, ministry escalation, CM review, and protected handling.</p>
            </div>
          </div>

          <div className="uat-subsection">
            <div className="panel-header compact">
              <div>
                <span>Run order</span>
                <h2>Local UAT commands</h2>
              </div>
            </div>
            <div className="uat-command-grid">
              {uatCommands.map((item, index) => (
                <article key={item.label}>
                  <span>{index + 1}</span>
                  <strong>{item.label}</strong>
                  <code>{item.command}</code>
                </article>
              ))}
            </div>
          </div>

          <div className="uat-subsection">
            <div className="panel-header compact">
              <div>
                <span>Role accounts</span>
                <h2>Open the seeded role surfaces</h2>
              </div>
            </div>
            <div className="uat-role-grid">
              {uatRoleAccounts.map((account) => (
                <article key={account.actor}>
                  <div>
                    <strong>{account.label}</strong>
                    <StatusChip label={account.role} tone={account.role === "Admin" ? "danger" : "neutral"} />
                  </div>
                  <span>{account.surface}</span>
                  <code>{account.actor}</code>
                  <small>{account.storageKey}</small>
                  <a className="text-button" href={account.path} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </article>
              ))}
            </div>
          </div>

          <div className="uat-subsection">
            <div className="panel-header compact">
              <div>
                <span>Seeded scenarios</span>
                <h2>What each fixture proves</h2>
              </div>
            </div>
            <div className="uat-scenario-list">
              {uatSeedScenarios.map((scenario) => (
                <article key={scenario.key}>
                  <div>
                    <strong>{scenario.title}</strong>
                    <span>{scenario.key}</span>
                  </div>
                  <StatusChip label={scenario.status} tone={scenario.status.includes("Protected") || scenario.status.includes("Rejected") ? "warn" : "neutral"} />
                  <div>
                    <span>{scenario.queue}</span>
                    <small>{scenario.surface}</small>
                  </div>
                  <p>{scenario.assertion}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <aside className="admin-panel uat-side">
          <PanelHeader eyebrow="Evidence" title="UAT launch-gate state" />
          <div className="uat-evidence-boxes">
            <InfoBox label="Rehearsal ref" value={rehearsalEvidence} />
            <InfoBox label="Defect register" value={defectRegister} />
            <InfoBox label="Blocker defects" value={String(blockerDefects)} />
            <InfoBox label="Critical defects" value={String(criticalDefects)} />
          </div>
          <div className="uat-signoff-list">
            {operatorUatItems.map((item) => {
              const signedOff = controlById(item.controlId)?.value === true;
              return (
                <div key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.owner}</span>
                  </div>
                  <StatusChip label={signedOff ? "signed" : "pending"} tone={signedOff ? "good" : "warn"} />
                </div>
              );
            })}
          </div>
          <div className="uat-guardrail">
            <ShieldAlert size={16} />
            <span>Local UAT uses smoke OIDC tokens and local Postgres only. Use a fresh run id for each role-action rehearsal; provider, evidence storage, SIEM/WORM, restore-drill, and production origin decisions remain launch gates.</span>
          </div>
          <button className="text-button" onClick={() => selectSection("launch")} type="button">
            Open sign-off controls
          </button>
        </aside>
      </div>
    );
  }

  function renderAudit() {
    return (
      <div className="audit-grid">
        <section className="admin-panel">
          <PanelHeader eyebrow="Audit" title="In-session admin change trail" />
          <AuditList events={auditEvents} />
        </section>
        <div className="audit-side-stack">
          <section className="admin-panel launch-readiness-panel">
            <PanelHeader eyebrow="Launch Gate" title="V1 go/no-go readiness" />
            <LaunchReadinessPanel
              error={launchReadinessError}
              loading={launchReadinessLoading}
              mode={launchReadinessMode}
              onRefresh={() => void refreshLaunchReadiness(true)}
              report={launchReadiness}
            />
          </section>
          <section className="admin-panel">
            <PanelHeader eyebrow="Health" title="Setup risks" />
            <RiskList risks={riskItems} />
          </section>
          {renderAuditExportCard()}
        </div>
      </div>
    );
  }

  function renderAccessWorkspace() {
    return (
      <div className="operator-tab-stack">
        {renderUsers()}
        {renderTeams()}
        {renderAccess()}
        {renderPermissions()}
      </div>
    );
  }

  function renderLaunchWorkspace() {
    return (
      <div className="operator-tab-stack">
        {renderMvpScope()}
        {renderLaunchControls()}
        {renderUat()}
      </div>
    );
  }

  function renderActiveSection() {
    if (activeSection === "access") return renderAccessWorkspace();
    if (activeSection === "launch") return renderLaunchWorkspace();
    if (activeSection === "sla") return renderSlaCategories();
    return renderAudit();
  }

  const activeNavItem = navItems.find((item) => item.id === activeSection) ?? navItems[0];

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <img alt="Whistle logo" src={ASSETS.logo} />
          <div>
            <strong>Whistle</strong>
            <span>Admin Console</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={activeSection === item.id ? "active" : ""} key={item.id} onClick={() => selectSection(item.id)} type="button">
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="admin-sidebar-note">
          <ShieldAlert size={17} />
          <span>Independent console. No operational ticket workspace lives here.</span>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="system-label">System administration</span>
            <h1>{activeNavItem.title}</h1>
          </div>
          <div className="topbar-actions">
            <div className="search-shell">
              <Search size={16} />
              <input aria-label="Search admin console" placeholder={activeNavItem.search} />
            </div>
            <img alt="Neutral civic service mark" src={ASSETS.emblem} />
          </div>
        </header>

        <section className="admin-summary">
          <MetricCard icon={UsersRound} label="Users" value={String(users.length)} />
          <MetricCard icon={UserCog} label="Teams" value={String(teams.length)} />
          <MetricCard icon={KeyRound} label="Access grants" value={String(grants.length)} />
          <MetricCard icon={AlertTriangle} label="Open risks" tone="danger" value={String(riskItems.length)} />
        </section>

        <div className="admin-layout">
          <div className="admin-content">{renderActiveSection()}</div>
          <aside className="inspector">
            <PanelHeader eyebrow="Inspector" title={selectedUser.name} />
            <div className="user-inspector">
              <strong>{selectedUser.title}</strong>
              <span>{selectedUser.email}</span>
              <span>{selectedUser.phone}</span>
            </div>
            <div className="inspector-grid">
              <InfoBox label="Teams" value={selectedTeams.length ? selectedTeams.map((team) => team.name).join(", ") : "No team"} />
              <InfoBox
                label="Membership expiry"
                value={
                  selectedMemberships.length
                    ? selectedMemberships
                        .map((membership) => `${teamName(membership.teamId)}: ${membership.expiresAt ? formatDateTime(membership.expiresAt) : "No expiry"}`)
                        .join(", ")
                    : "No membership"
                }
              />
              <InfoBox label="Scopes" value={effectiveScopes.length ? effectiveScopes.join(", ") : "No access"} />
              <InfoBox label="Protected queue" value={canSeeProtected ? "Visible" : "Hidden"} />
              <InfoBox label="Reporter identity" value={canSeeReporter ? "Allowed" : "Masked"} />
            </div>
            <div className="action-tags">
              {effectiveActions.slice(0, 10).map((action) => (
                <span key={action}>{action}</span>
              ))}
              {!effectiveActions.length && <span>No actions assigned</span>}
            </div>
            <div className="inspector-divider" />
            <PanelHeader eyebrow="Selected team" title={selectedTeam.name} />
            <div className="user-inspector">
              <strong>{selectedTeam.kind}</strong>
              <span>{selectedTeam.defaultScope}</span>
              <span>Owner: {userName(selectedTeam.ownerUserId)}</span>
            </div>
          </aside>
        </div>
      </main>

      <div className="prototype-banner">
        <Sparkles size={16} />
        <span>
          MVP mode: user/team/access creation uses the Admin access API when reachable; app controls, categories, and SLA settings use the Admin config API. Local fallback remains for offline prototype review.
        </span>
      </div>
    </div>
  );
}

function PanelHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="panel-header">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, tone = "neutral" }: { icon: typeof UsersRound; label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <div className={`metric-card ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "good" | "warn" | "danger" | "neutral" }) {
  return <span className={`status-chip ${tone}`}>{label}</span>;
}

function SwitchButton({
  active,
  danger = false,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`switch-button ${active ? "on" : ""} ${danger && active ? "danger" : ""}`} disabled={disabled} onClick={onClick} type="button">
      {active ? <ToggleLeft size={14} /> : <EyeOff size={14} />}
      {label}
    </button>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProgressMeter({ label, value }: { label: string; value: number }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-meter">
      <div>
        <span>{label}</span>
        <strong>{bounded}%</strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}

function launchVerdictLabel(verdict: LaunchReadinessReport["verdict"]) {
  if (verdict === "go") return "Go";
  if (verdict === "conditional_go") return "Conditional";
  return "No Go";
}

function launchVerdictTone(verdict: LaunchReadinessReport["verdict"]): "good" | "warn" | "danger" {
  if (verdict === "go") return "good";
  if (verdict === "conditional_go") return "warn";
  return "danger";
}

function launchCheckTone(status: LaunchReadinessReport["checks"][number]["status"]): "good" | "warn" | "danger" {
  if (status === "pass") return "good";
  if (status === "warning") return "warn";
  return "danger";
}

function preflightStatusTone(status: DeploymentPreflightReport["checks"][number]["status"]): "good" | "warn" | "danger" {
  if (status === "pass") return "good";
  if (status === "warning") return "warn";
  return "danger";
}

const preflightHandoffSteps = [
  {
    title: "1. Start from template",
    detail: "Copy the MVP1 staging contract into the approved secret manager; never deploy the example file directly.",
    command: "ops/env/whistle-mvp1-staging.env.example",
  },
  {
    title: "2. Render real values",
    detail: "Replace every provider endpoint, token, KMS id, rate-limit salt, and restore-drill timestamp from controlled secrets.",
    command: "/secure/rendered/whistle-staging.env",
  },
  {
    title: "3. Assert before deploy",
    detail: "The assert command fails on any blocker, warning, localhost, example, smoke-test, or placeholder value.",
    command: "npm run deployment:preflight:assert -- --env-file /secure/rendered/whistle-staging.env",
  },
  {
    title: "4. Share redacted packet",
    detail: "Give security, provider, and UAT teams a readiness packet without exposing database passwords or API keys.",
    command: "npm run deployment:packet -- --env-file /secure/rendered/whistle-staging.env --out artifacts/whistle-mvp1-readiness-packet.md",
  },
] as const;

function Mvp1LaunchHandoffPanel({
  error,
  loading,
  mode,
  onRefresh,
  report,
}: {
  error: string | null;
  loading: boolean;
  mode: string;
  onRefresh: () => void;
  report: Mvp1LaunchHandoffReport;
}) {
  const blockedCount = report.lanes.filter((lane) => lane.status === "blocked").length;
  const evidenceCount = report.lanes.filter((lane) => lane.status === "needs_evidence").length;
  return (
    <div className={`mvp1-handoff-panel ${blockedCount ? "blocked" : "ready"}`}>
      <div className="mvp1-handoff-head">
        <div>
          <span>MVP1 launch handoff</span>
          <strong>Data-backed lanes for provider, UAT, and ops teams</strong>
          <p>
            Loaded from {mode}. Active build {report.activeBuild}; launch verdict {report.launchVerdict.replaceAll("_", " ")} at {report.launchScore}%.
          </p>
        </div>
        <button className="text-button" disabled={loading} onClick={onRefresh} type="button">
          {loading ? "Refreshing..." : "Refresh handoff"}
        </button>
      </div>
      {error && <p className="readiness-error">Using fallback handoff: {error}</p>}
      <div className="mvp1-handoff-facts">
        <InfoBox label="Implementation" value={`${report.implementationPercent}%`} />
        <InfoBox label="Launch readiness" value={`${report.launchReadinessPercent}%`} />
        <InfoBox label="Blocked lanes" value={String(blockedCount)} />
        <InfoBox label="Need evidence" value={String(evidenceCount)} />
      </div>
      <div className="mvp1-handoff-lanes">
        {report.lanes.map((lane) => {
          const pendingControls = lane.adminControls.filter((control) => !control.ready).slice(0, 2);
          const failingChecks = lane.runtimeChecks.filter((check) => check.status !== "pass").slice(0, 2);
          const leadSignals = [...lane.blockers, ...pendingControls.map((control) => `${control.name}: ${control.value}`), ...failingChecks.map((check) => check.label)].slice(0, 3);
          return (
            <article className={lane.status} key={lane.id}>
              <div className="mvp1-handoff-lane-head">
                <div>
                  <span>{lane.owner.replaceAll("_", " ")}</span>
                  <strong>{lane.title}</strong>
                </div>
                <StatusChip label={mvp1HandoffStatusLabel(lane.status)} tone={mvp1HandoffStatusTone(lane.status)} />
              </div>
              <p>{lane.purpose}</p>
              <div className="mvp1-handoff-meta">
                <StatusChip label={`${lane.adminControls.length} controls`} tone={pendingControls.length ? "warn" : "good"} />
                <StatusChip label={`${lane.runtimeChecks.length} checks`} tone={failingChecks.length ? "danger" : "good"} />
                <StatusChip label={`${lane.requiredEnv.length} env keys`} tone={lane.requiredEnv.length ? "neutral" : "good"} />
              </div>
              <div className="mvp1-handoff-list">
                <strong>Next owner action</strong>
                {(leadSignals.length ? leadSignals : lane.nextActions).slice(0, 3).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <code>{lane.commands[0] ?? "npm run mvp:check"}</code>
            </article>
          );
        })}
      </div>
      <div className="mvp1-handoff-rules">
        <div>
          <strong>Hold conditions</strong>
          {report.holdConditions.slice(0, 4).map((condition) => (
            <span key={condition}>{condition}</span>
          ))}
        </div>
        <div>
          <strong>Safe handling rules</strong>
          {report.safeHandlingRules.slice(0, 4).map((rule) => (
            <span key={rule}>{rule}</span>
          ))}
        </div>
        <div>
          <strong>Commands</strong>
          {report.commands.slice(0, 4).map((command) => (
            <code key={command}>{command}</code>
          ))}
        </div>
      </div>
    </div>
  );
}

function DeploymentPreflightPanel({
  error,
  loading,
  onRefresh,
  report,
}: {
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  report: DeploymentPreflightReport | null;
}) {
  if (!report) {
    return (
      <div className="deployment-preflight empty">
        <ShieldAlert size={18} />
        <div>
          <strong>{loading ? "Checking deployment preflight..." : "Deployment preflight unavailable"}</strong>
          <span>{error ?? "The Admin API will check security, persistence, evidence, notifications, and high-volume gates."}</span>
        </div>
        <button className="text-button" disabled={loading} onClick={onRefresh} type="button">
          {loading ? "Refreshing..." : "Refresh preflight"}
        </button>
      </div>
    );
  }

  const priorityChecks = report.checks.filter((check) => check.status !== "pass").slice(0, 5);
  return (
    <div className={`deployment-preflight ${report.productionReady ? "ready" : "blocked"}`}>
      <div className="deployment-preflight-head">
        <div>
          <span>Production preflight</span>
          <strong>{report.productionReady ? "Production safe" : "Not production safe yet"}</strong>
          <p>
            {report.profile} profile | {report.productionTarget ? "deployment target" : "local check"}
          </p>
        </div>
        <button className="text-button" disabled={loading} onClick={onRefresh} type="button">
          {loading ? "Refreshing..." : "Refresh preflight"}
        </button>
      </div>
      <div className="deployment-preflight-facts">
        <InfoBox label="Blockers" value={String(report.summary.blockers)} />
        <InfoBox label="Warnings" value={String(report.summary.warnings)} />
        <InfoBox label="Passed" value={String(report.summary.passes)} />
      </div>
      <div className="deployment-handoff" aria-label="MVP1 production-security handoff">
        <div className="deployment-handoff-head">
          <KeyRound size={16} />
          <div>
            <strong>MVP1 production-security handoff</strong>
            <span>Use this sequence for the provider and platform teams working in parallel.</span>
          </div>
        </div>
        <div className="deployment-handoff-steps">
          {preflightHandoffSteps.map((step) => (
            <div key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
              <code>{step.command}</code>
            </div>
          ))}
        </div>
      </div>
      {error && <p className="readiness-error">{error}</p>}
      <div className="deployment-preflight-checks">
        {(priorityChecks.length ? priorityChecks : report.checks.slice(0, 3)).map((check) => (
          <div key={check.id}>
            <div>
              <StatusChip label={check.area.replaceAll("_", " ")} tone="neutral" />
              <StatusChip label={check.status} tone={preflightStatusTone(check.status)} />
            </div>
            <strong>{check.label}</strong>
            <span>{check.message}</span>
            <small>{check.remediation}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function LaunchReadinessPanel({
  error,
  loading,
  mode,
  onRefresh,
  report,
}: {
  error: string | null;
  loading: boolean;
  mode: string;
  onRefresh: () => void;
  report: LaunchReadinessReport | null;
}) {
  if (!report) {
    return (
      <div className="empty-health">
        <AlertTriangle size={18} />
        <strong>{loading ? "Checking launch gate..." : "Launch readiness unavailable"}</strong>
        <span>{error ?? "The Admin API will compute public-launch blockers, warnings, and score."}</span>
        <button className="text-button" disabled={loading} onClick={onRefresh} type="button">
          {loading ? "Refreshing..." : "Refresh readiness"}
        </button>
      </div>
    );
  }

  const priorityChecks = report.checks.filter((check) => check.status !== "pass").slice(0, 4);
  return (
    <div className="launch-readiness">
      <div className={`launch-score ${launchVerdictTone(report.verdict)}`}>
        <div>
          <span>{mode}</span>
          <strong>{report.score}%</strong>
        </div>
        <StatusChip label={launchVerdictLabel(report.verdict)} tone={launchVerdictTone(report.verdict)} />
      </div>
      <div className="launch-facts">
        <InfoBox label="Blockers" value={String(report.blockers)} />
        <InfoBox label="Warnings" value={String(report.warnings)} />
        <InfoBox label="Public-ready" value={`${report.counts.publicReadyCategories}/${report.counts.enabledCategories}`} />
      </div>
      {error && <p className="readiness-error">{error}</p>}
      <div className="launch-checks">
        {(priorityChecks.length ? priorityChecks : report.checks.slice(0, 3)).map((check) => (
          <div key={check.id}>
            <StatusChip label={check.phase} tone="neutral" />
            <span>{check.label}</span>
            <StatusChip label={check.status} tone={launchCheckTone(check.status)} />
            <p>{check.summary}</p>
          </div>
        ))}
      </div>
      <button className="text-button" disabled={loading} onClick={onRefresh} type="button">
        {loading ? "Refreshing..." : "Refresh readiness"}
      </button>
    </div>
  );
}

function AuditList({ events }: { events: AdminAuditEvent[] }) {
  return (
    <div className="audit-list">
      {events.map((event) => (
        <div className={event.tone} key={event.id}>
          <CircleDot size={14} />
          <div>
            <strong>{event.action}</strong>
            <span>
              {event.time} | {event.actor}
            </span>
            <p>{event.summary}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RiskList({ risks }: { risks: string[] }) {
  if (!risks.length) {
    return (
      <div className="empty-health">
        <CheckCircle2 size={18} />
        <strong>No setup risks detected</strong>
        <span>Users, access, and app controls are coherent in this prototype state.</span>
      </div>
    );
  }

  return (
    <div className="risk-list">
      {risks.map((risk) => (
        <div key={risk}>
          <AlertTriangle size={15} />
          <span>{risk}</span>
        </div>
      ))}
    </div>
  );
}

function buildRiskItems({
  teams,
  grants,
  memberships,
  permissions,
  controls,
  categories,
  readiness,
}: {
  teams: Team[];
  grants: AccessGrant[];
  memberships: TeamMembership[];
  permissions: PermissionProfile[];
  controls: AppControl[];
  categories: CategoryConfig[];
  readiness: CategoryReadiness[];
}) {
  const risks: string[] = [];
  const missingOwners = teams.filter((team) => !team.ownerUserId);
  const duplicateAdmin = grants.filter((grant) => grant.role === "Admin");
  const expired = [...memberships.map((item) => item.expiresAt), ...grants.map((item) => item.expiresAt)].filter((value) =>
    isExpiredDate(value),
  );
  const exposedProtected = grants.filter(
    (grant) => grant.protectedQueue && grant.reporterIdentity && !["CM Cell", "Rejection Review"].includes(grant.role),
  );
  const riskyProfiles = permissions.filter(
    (profile) => profile.protectedQueue && profile.reporterIdentity && !["CM Cell", "Rejection Review"].includes(profile.role),
  );
  const incompleteCritical = controls.filter((control) => control.critical && control.value === false);
  const readinessByCategory = new Map(readiness.map((item) => [item.categoryId, item]));
  const enabledNotReady = categories.filter((category) => {
    if (!category.enabled) return false;
    const item = readinessByCategory.get(category.id);
    return !item || item.launchState !== "ready" || item.sopStatus !== "approved" || item.trainingStatus !== "approved";
  });
  const missingReadiness = categories.filter((category) => !readinessByCategory.has(category.id));

  if (missingOwners.length) risks.push(`${missingOwners.length} team owner missing`);
  if (duplicateAdmin.length > 1) risks.push("Duplicate admin grants detected");
  if (expired.length) risks.push(`${expired.length} expired access records still present`);
  if (exposedProtected.length || riskyProfiles.length) risks.push("Protected reporter identity is exposed outside CM/review roles");
  if (incompleteCritical.length) risks.push(`${incompleteCritical.length} critical app controls disabled`);
  if (missingReadiness.length) risks.push(`${missingReadiness.length} category readiness row(s) missing`);
  if (enabledNotReady.length) risks.push(`${enabledNotReady.length} enabled category/categories are not launch-ready`);

  return risks;
}
