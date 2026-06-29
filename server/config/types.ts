import type { CategoryId, SlaStage } from "../ticket-spine/types.js";

export type CategorySensitivity = "public_aggregate" | "identity_masked" | "protected";
export type ReadinessStatus = "approved" | "scheduled" | "required";
export type CategoryLaunchState = "ready" | "pilot_only" | "blocked";
export type ConfigValue = string | boolean | number;

export type CategoryConfig = {
  id: CategoryId;
  labelEn: string;
  labelTa: string;
  sensitivity: CategorySensitivity;
  enabled: boolean;
};

export type SlaPolicy = {
  stage: SlaStage;
  label: string;
  durationDays: number;
  escalationTarget: string;
  enabled: boolean;
};

export type CategoryReadiness = {
  categoryId: CategoryId;
  primaryOwner: string;
  slaSummary: string;
  escalationPath: string;
  roleAccess: string[];
  publicVisibility: string;
  privacyLevel: CategorySensitivity;
  sopStatus: ReadinessStatus;
  trainingStatus: ReadinessStatus;
  launchState: CategoryLaunchState;
  notes: string;
};

export type CategoryReadinessPatch = Partial<Omit<CategoryReadiness, "categoryId">>;

export type AppControlConfig = {
  id: string;
  group: "Privacy" | "Protected" | "Notifications" | "Language" | "Feature Flags" | "Operations" | "Infrastructure";
  name: string;
  value: ConfigValue;
  valueType: "boolean" | "number" | "string";
  critical: boolean;
};

export type AdminConfigSnapshot = {
  categories: CategoryConfig[];
  readiness: CategoryReadiness[];
  slaPolicies: SlaPolicy[];
  appControls: AppControlConfig[];
};

export type ConfigChangeTarget =
  | {
      kind: "category";
      id: CategoryId;
      patch: Partial<Pick<CategoryConfig, "enabled" | "sensitivity">>;
    }
  | {
      kind: "sla_policy";
      stage: SlaStage;
      patch: Partial<Pick<SlaPolicy, "durationDays" | "enabled">>;
    }
  | {
      kind: "category_readiness";
      categoryId: CategoryId;
      patch: CategoryReadinessPatch;
    }
  | {
      kind: "app_control";
      id: string;
      value: ConfigValue;
    };

export type ConfigChangeStatus = "pending" | "approved" | "rejected";

export type ConfigChangeRequest = {
  id: string;
  target: ConfigChangeTarget;
  summary: string;
  reason: string;
  status: ConfigChangeStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decisionReason?: string;
  decidedAt?: string;
  appliedAt?: string;
};

export type CreateConfigChangeRequestCommand = {
  target: ConfigChangeTarget;
  reason: string;
};

export type DecideConfigChangeRequestCommand = {
  actor: string;
  reason: string;
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

export type LaunchReadinessStatus = "pass" | "warning" | "blocker";
export type LaunchReadinessVerdict = "go" | "conditional_go" | "no_go";

export type LaunchReadinessCheck = {
  id: string;
  phase: "V0" | "V1" | "V2" | "V3" | "V4";
  label: string;
  status: LaunchReadinessStatus;
  summary: string;
  details: string[];
};

export type LaunchReadinessReport = {
  generatedAt: string;
  verdict: LaunchReadinessVerdict;
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
  launchVerdict: LaunchReadinessVerdict;
  launchScore: number;
  lanes: Mvp1LaunchHandoffLane[];
  commands: string[];
  holdConditions: string[];
  safeHandlingRules: string[];
};
