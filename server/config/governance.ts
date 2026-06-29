import type {
  AdminConfigSnapshot,
  AppControlConfig,
  CategoryConfig,
  CategoryReadiness,
  CategoryReadinessPatch,
  ConfigChangeRequest,
  ConfigChangeTarget,
  ConfigValue,
  SlaPolicy,
} from "./types.js";
import type { CategoryId, SlaStage } from "../ticket-spine/types.js";

export function configChangeId() {
  return `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function configChangeSummary(target: ConfigChangeTarget) {
  if (target.kind === "category") {
    const changes = Object.entries(target.patch).map(([key, value]) => `${key}=${String(value)}`).join(", ");
    return `Category ${target.id}: ${changes}`;
  }
  if (target.kind === "sla_policy") {
    const changes = Object.entries(target.patch).map(([key, value]) => `${key}=${String(value)}`).join(", ");
    return `SLA ${target.stage}: ${changes}`;
  }
  if (target.kind === "category_readiness") {
    const changes = Object.entries(target.patch)
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("/") : String(value)}`)
      .join(", ");
    return `Readiness ${target.categoryId}: ${changes}`;
  }
  return `App control ${target.id}: value=${String(target.value)}`;
}

export function targetKey(target: ConfigChangeTarget) {
  if (target.kind === "category") return `category:${target.id}`;
  if (target.kind === "sla_policy") return `sla_policy:${target.stage}`;
  if (target.kind === "category_readiness") return `category_readiness:${target.categoryId}`;
  return `app_control:${target.id}`;
}

export function isCriticalConfigChange(config: AdminConfigSnapshot, target: ConfigChangeTarget) {
  if (target.kind === "app_control") {
    return Boolean(config.appControls.find((control) => control.id === target.id)?.critical);
  }

  if (target.kind === "category") {
    const current = config.categories.find((category) => category.id === target.id);
    return target.id === "corruption" || current?.sensitivity === "protected" || target.patch.sensitivity === "protected";
  }

  if (target.kind === "sla_policy") {
    return target.patch.enabled === false || target.patch.durationDays !== undefined;
  }

  if (target.kind === "category_readiness") {
    const current = config.readiness.find((readiness) => readiness.categoryId === target.categoryId);
    const targetCategory = config.categories.find((category) => category.id === target.categoryId);
    return (
      target.patch.launchState === "ready" ||
      target.patch.privacyLevel === "protected" ||
      current?.privacyLevel === "protected" ||
      targetCategory?.sensitivity === "protected"
    );
  }

  return false;
}

export function applyConfigTargetToSnapshot(config: AdminConfigSnapshot, target: ConfigChangeTarget) {
  if (target.kind === "category") {
    const category = config.categories.find((item) => item.id === target.id);
    if (!category) return null;
    Object.assign(category, target.patch);
    return { ...category } satisfies CategoryConfig;
  }

  if (target.kind === "sla_policy") {
    const policy = config.slaPolicies.find((item) => item.stage === target.stage);
    if (!policy) return null;
    Object.assign(policy, target.patch);
    return { ...policy } satisfies SlaPolicy;
  }

  if (target.kind === "category_readiness") {
    const readiness = config.readiness.find((item) => item.categoryId === target.categoryId);
    if (!readiness) return null;
    Object.assign(readiness, target.patch);
    if (target.patch.roleAccess) readiness.roleAccess = [...target.patch.roleAccess];
    return { ...readiness, roleAccess: [...readiness.roleAccess] } satisfies CategoryReadiness;
  }

  const control = config.appControls.find((item) => item.id === target.id);
  if (!control) return null;
  control.value = target.value;
  return { ...control } satisfies AppControlConfig;
}

export function categoryPatchFromJson(value: unknown): Partial<Pick<CategoryConfig, "enabled" | "sensitivity">> {
  const patch = value as Partial<Pick<CategoryConfig, "enabled" | "sensitivity">>;
  return {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
    sensitivity: patch.sensitivity,
  };
}

export function slaPatchFromJson(value: unknown): Partial<Pick<SlaPolicy, "durationDays" | "enabled">> {
  const patch = value as Partial<Pick<SlaPolicy, "durationDays" | "enabled">>;
  return {
    durationDays: typeof patch.durationDays === "number" ? patch.durationDays : undefined,
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
  };
}

export function readinessPatchFromJson(value: unknown): CategoryReadinessPatch {
  const patch = value as CategoryReadinessPatch;
  return {
    primaryOwner: typeof patch.primaryOwner === "string" ? patch.primaryOwner : undefined,
    slaSummary: typeof patch.slaSummary === "string" ? patch.slaSummary : undefined,
    escalationPath: typeof patch.escalationPath === "string" ? patch.escalationPath : undefined,
    roleAccess: Array.isArray(patch.roleAccess) ? patch.roleAccess.filter((item): item is string => typeof item === "string") : undefined,
    publicVisibility: typeof patch.publicVisibility === "string" ? patch.publicVisibility : undefined,
    privacyLevel: patch.privacyLevel,
    sopStatus: patch.sopStatus,
    trainingStatus: patch.trainingStatus,
    launchState: patch.launchState,
    notes: typeof patch.notes === "string" ? patch.notes : undefined,
  };
}

export function targetFromParts(kind: ConfigChangeTarget["kind"], targetId: string, payload: unknown): ConfigChangeTarget {
  if (kind === "category") return { kind, id: targetId as CategoryId, patch: categoryPatchFromJson(payload) };
  if (kind === "sla_policy") return { kind, stage: targetId as SlaStage, patch: slaPatchFromJson(payload) };
  if (kind === "category_readiness") return { kind, categoryId: targetId as CategoryId, patch: readinessPatchFromJson(payload) };
  return { kind, id: targetId, value: payload as ConfigValue };
}

export function makeConfigChangeRequest(target: ConfigChangeTarget, reason: string, requestedBy: string): ConfigChangeRequest {
  const requestedAt = new Date().toISOString();
  return {
    id: configChangeId(),
    target,
    summary: configChangeSummary(target),
    reason,
    status: "pending",
    requestedBy,
    requestedAt,
  };
}
