import { officialAuthHeaders } from "./officialAuthClient";

export type AdminCategoryConfig = {
  id: string;
  labelEn: string;
  labelTa: string;
  sensitivity: "public_aggregate" | "identity_masked" | "protected";
  enabled: boolean;
};

export type AdminSlaPolicy = {
  stage: string;
  label: string;
  durationDays: number;
  escalationTarget: string;
  enabled: boolean;
};

export type CategoryReadinessStatus = "approved" | "scheduled" | "required";
export type CategoryLaunchState = "ready" | "pilot_only" | "blocked";

export type AdminCategoryReadiness = {
  categoryId: string;
  primaryOwner: string;
  slaSummary: string;
  escalationPath: string;
  roleAccess: string[];
  publicVisibility: string;
  privacyLevel: AdminCategoryConfig["sensitivity"];
  sopStatus: CategoryReadinessStatus;
  trainingStatus: CategoryReadinessStatus;
  launchState: CategoryLaunchState;
  notes: string;
};

export type AdminAppControl = {
  id: string;
  group: "Privacy" | "Protected" | "Notifications" | "Language" | "Feature Flags" | "Operations" | "Infrastructure";
  name: string;
  value: string | boolean | number;
  valueType: "boolean" | "number" | "string";
  critical: boolean;
};

export type AdminConfigPayload = {
  mode: string;
  config: {
    categories: AdminCategoryConfig[];
    readiness: AdminCategoryReadiness[];
    slaPolicies: AdminSlaPolicy[];
    appControls: AdminAppControl[];
  };
};

export type ConfigChangeTarget =
  | {
      kind: "category";
      id: string;
      patch: Partial<Pick<AdminCategoryConfig, "enabled" | "sensitivity">>;
    }
  | {
      kind: "sla_policy";
      stage: string;
      patch: Partial<Pick<AdminSlaPolicy, "durationDays" | "enabled">>;
    }
  | {
      kind: "category_readiness";
      categoryId: string;
      patch: Partial<Omit<AdminCategoryReadiness, "categoryId">>;
    }
  | {
      kind: "app_control";
      id: string;
      value: string | boolean | number;
    };

export type ConfigChangeRequest = {
  id: string;
  target: ConfigChangeTarget;
  summary: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decisionReason?: string;
  decidedAt?: string;
  appliedAt?: string;
};

export type AuditExportPackage = {
  id: string;
  generatedAt: string;
  requestedBy: string;
  ticketId?: string;
  format: "json";
  source: "whistle-ticket-spine";
  counts: {
    auditEvents: number;
    configChangeRequests: number;
    sensitiveAuditEvents: number;
  };
  controls: {
    redaction: "metadata_only_for_sensitive_records";
    includesConfigApprovals: true;
    includesTicketAudit: true;
    productionStorage: "not_enabled_mvp" | "external_worm_siem";
  };
};

export type AuditExportDelivery = {
  status: "exported" | "failed" | "skipped";
  provider: string;
  reason: string;
  providerExportId?: string;
  lastError?: string;
};

export type LaunchReadinessCheck = {
  id: string;
  phase: "V0" | "V1" | "V2" | "V3" | "V4";
  label: string;
  status: "pass" | "warning" | "blocker";
  summary: string;
  details: string[];
};

export type LaunchReadinessReport = {
  generatedAt: string;
  verdict: "go" | "conditional_go" | "no_go";
  score: number;
  blockers: number;
  warnings: number;
  checks: LaunchReadinessCheck[];
  counts: {
    enabledCategories: number;
    publicReadyCategories: number;
    pilotOnlyCategories: number;
    activeTeams: number;
    activeUsers: number;
    pendingCriticalApprovals: number;
  };
};

export type MvpPhaseId = "MVP1" | "MVP2" | "MVP3" | "MVP4";
export type MvpPhaseStatus = "done" | "partial" | "blocked" | "not_started";

export type MvpScopeItem = {
  id: string;
  label: string;
  status: MvpPhaseStatus;
  evidence: string[];
  gaps: string[];
};

export type MvpPhaseScope = {
  id: MvpPhaseId;
  title: string;
  purpose: string;
  status: MvpPhaseStatus;
  implementationPercent: number;
  launchReadinessPercent: number;
  includedSurfaces: string[];
  deferredSurfaces: string[];
  exitCriteria: string[];
  items: MvpScopeItem[];
  nextActions: string[];
};

export type MvpLaunchWorkstreamOwner = "engineering" | "government_ops" | "security_legal" | "external_provider" | "uat_ops";

export type MvpLaunchWorkstream = {
  id: string;
  phaseId: MvpPhaseId;
  title: string;
  owner: MvpLaunchWorkstreamOwner;
  status: MvpPhaseStatus;
  parallelizable: boolean;
  summary: string;
  nextActions: string[];
  blockers: string[];
  evidence: string[];
};

export type MvpScopeReport = {
  generatedAt: string;
  source: "admin_config_and_access_snapshot";
  activeBuild: MvpPhaseId;
  currentBuildOrder: MvpPhaseId[];
  overallImplementationPercent: number;
  overallLaunchReadinessPercent: number;
  activeBuildWorkstreams: MvpLaunchWorkstream[];
  principles: string[];
  phases: MvpPhaseScope[];
};

export type Mvp1LaunchHandoffLaneStatus = "blocked" | "needs_evidence" | "ready_for_review" | "signed_off";

export type Mvp1LaunchHandoffLane = {
  id: string;
  owner: MvpLaunchWorkstreamOwner | "platform" | "identity" | "observability";
  title: string;
  purpose: string;
  status: Mvp1LaunchHandoffLaneStatus;
  adminControls: Array<{
    id: string;
    name: string;
    value: string;
    critical: boolean;
    ready: boolean;
  }>;
  runtimeChecks: Array<{
    id: string;
    label: string;
    status: "pass" | "warning" | "blocker";
    observed: string;
    remediation: string;
  }>;
  requiredEnv: string[];
  commands: string[];
  blockers: string[];
  nextActions: string[];
  evidenceNeeded: string[];
};

export type Mvp1LaunchHandoffReport = {
  kind: "whistle-mvp1-launch-handoff";
  generatedAt: string;
  source: "admin_config_access_and_deployment_preflight";
  activeBuild: MvpPhaseId;
  implementationPercent: number;
  launchReadinessPercent: number;
  launchVerdict: "go" | "conditional_go" | "no_go";
  launchScore: number;
  lanes: Mvp1LaunchHandoffLane[];
  commands: string[];
  holdConditions: string[];
  safeHandlingRules: string[];
};

export type DeploymentPreflightCheck = {
  id: string;
  area: "data" | "identity" | "citizen_verification" | "evidence" | "notifications" | "network" | "performance" | "operations" | "observability";
  label: string;
  status: "pass" | "warning" | "blocker";
  message: string;
  observed: string;
  remediation: string;
};

export type DeploymentPreflightReport = {
  service: "whistle-ticket-spine";
  generatedAt: string;
  profile: "local" | "test" | "staging" | "production";
  productionTarget: boolean;
  productionReady: boolean;
  summary: {
    blockers: number;
    warnings: number;
    passes: number;
  };
  checks: DeploymentPreflightCheck[];
  nextActions: string[];
};

export class AdminApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string, message?: string) {
    super(message ?? `Admin config API failed (${status})`);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

const apiBase = import.meta.env.VITE_WHISTLE_API_BASE ?? "http://localhost:3001";

const adminAuth = { role: "admin", actor: "admin:prototype" };
const adminReviewerAuth = { role: "admin", actor: "admin:reviewer" };

const adminHeaders = () => officialAuthHeaders(adminAuth);
const adminReviewerHeaders = () => officialAuthHeaders(adminReviewerAuth);
const adminJsonHeaders = () => officialAuthHeaders(adminAuth, { json: true });
const adminReviewerJsonHeaders = () => officialAuthHeaders(adminReviewerAuth, { json: true });

void adminReviewerHeaders;

async function parseResponse<T>(response: Response) {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new AdminApiError(response.status, body.error, body.message);
  }
  return (await response.json()) as T;
}

export function isCriticalApprovalRequired(error: unknown) {
  return error instanceof AdminApiError && error.status === 409 && error.code === "critical_config_requires_approval";
}

export async function fetchAdminConfig() {
  return parseResponse<AdminConfigPayload>(await fetch(`${apiBase}/api/admin/config`, { credentials: "include", headers: adminHeaders() }));
}

export async function fetchLaunchReadiness() {
  return parseResponse<{ mode: string; report: LaunchReadinessReport }>(
    await fetch(`${apiBase}/api/admin/launch-readiness`, { credentials: "include", headers: adminHeaders() }),
  );
}

export async function fetchMvpScope() {
  return parseResponse<{ mode: string; scope: MvpScopeReport }>(
    await fetch(`${apiBase}/api/admin/mvp-scope`, { credentials: "include", headers: adminHeaders() }),
  );
}

export async function fetchMvp1LaunchHandoff() {
  return parseResponse<{ mode: string; handoff: Mvp1LaunchHandoffReport }>(
    await fetch(`${apiBase}/api/admin/mvp1-launch-handoff`, { credentials: "include", headers: adminHeaders() }),
  );
}

export async function fetchDeploymentPreflight() {
  return parseResponse<{ report: DeploymentPreflightReport }>(
    await fetch(`${apiBase}/api/admin/deployment-preflight`, { credentials: "include", headers: adminHeaders() }),
  );
}

export async function patchAdminCategory(categoryId: string, patch: Partial<Pick<AdminCategoryConfig, "enabled" | "sensitivity">>) {
  return parseResponse<{ category: AdminCategoryConfig }>(
    await fetch(`${apiBase}/api/admin/config/categories/${categoryId}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(patch),
    }),
  );
}

export async function patchAdminCategoryReadiness(categoryId: string, patch: Partial<Omit<AdminCategoryReadiness, "categoryId">>) {
  return parseResponse<{ readiness: AdminCategoryReadiness }>(
    await fetch(`${apiBase}/api/admin/config/category-readiness/${categoryId}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(patch),
    }),
  );
}

export async function patchAdminSlaPolicy(stage: string, patch: Partial<Pick<AdminSlaPolicy, "durationDays" | "enabled">>) {
  return parseResponse<{ policy: AdminSlaPolicy }>(
    await fetch(`${apiBase}/api/admin/config/sla-policies/${stage}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(patch),
    }),
  );
}

export async function patchAdminAppControl(controlId: string, value: string | boolean | number) {
  return parseResponse<{ control: AdminAppControl }>(
    await fetch(`${apiBase}/api/admin/config/app-controls/${controlId}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify({ value }),
    }),
  );
}

export async function fetchConfigChangeRequests() {
  return parseResponse<{ changeRequests: ConfigChangeRequest[] }>(
    await fetch(`${apiBase}/api/admin/governance/config-change-requests`, { credentials: "include", headers: adminHeaders() }),
  );
}

export async function createConfigChangeRequest(target: ConfigChangeTarget, reason: string) {
  return parseResponse<{ changeRequest: ConfigChangeRequest }>(
    await fetch(`${apiBase}/api/admin/governance/config-change-requests`, {
      method: "POST",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify({ target, reason }),
    }),
  );
}

export async function approveConfigChangeRequest(requestId: string, reason: string) {
  return parseResponse<{ changeRequest: ConfigChangeRequest; config: AdminConfigPayload["config"] }>(
    await fetch(`${apiBase}/api/admin/governance/config-change-requests/${encodeURIComponent(requestId)}/approve`, {
      method: "POST",
      credentials: "include",
      headers: adminReviewerJsonHeaders(),
      body: JSON.stringify({ reason }),
    }),
  );
}

export async function rejectConfigChangeRequest(requestId: string, reason: string) {
  return parseResponse<{ changeRequest: ConfigChangeRequest }>(
    await fetch(`${apiBase}/api/admin/governance/config-change-requests/${encodeURIComponent(requestId)}/reject`, {
      method: "POST",
      credentials: "include",
      headers: adminReviewerJsonHeaders(),
      body: JSON.stringify({ reason }),
    }),
  );
}

export async function fetchGovernanceAuditExport() {
  return parseResponse<{
    exportPackage: AuditExportPackage;
    exportDelivery: AuditExportDelivery;
    configChangeRequests: ConfigChangeRequest[];
  }>(await fetch(`${apiBase}/api/admin/governance/audit-export`, { credentials: "include", headers: adminHeaders() }));
}
