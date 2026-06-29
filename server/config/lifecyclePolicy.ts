import type { AdminConfigSnapshot, CategoryConfig, CategoryReadiness } from "./types.js";
import { defaultLifecyclePolicy, type LifecyclePolicy } from "../ticket-spine/lifecycle.js";
import type { CategoryId, SlaStage } from "../ticket-spine/types.js";

export type CitizenCategoryIntakeStatus = "open" | "protected_pilot" | "pilot_only" | "blocked" | "disabled";

export type CitizenCategoryAvailability = {
  id: CategoryId;
  labelEn: string;
  labelTa: string;
  sensitivity: CategoryConfig["sensitivity"];
  enabled: boolean;
  intakeStatus: CitizenCategoryIntakeStatus;
  message: string;
};

export function lifecyclePolicyFromConfig(config: AdminConfigSnapshot): LifecyclePolicy {
  const slaDays = { ...defaultLifecyclePolicy.slaDays };
  const slaEnabled = { ...defaultLifecyclePolicy.slaEnabled };
  for (const policy of config.slaPolicies) {
    slaDays[policy.stage] = policy.durationDays;
    slaEnabled[policy.stage] = policy.enabled;
  }

  const corruptionBypassesLocalRouting = config.appControls.find((control) => control.id === "protected-bypass")?.value !== false;
  const protectedCategoryIds = new Set<CategoryId>(
    config.categories.filter((category) => category.sensitivity === "protected").map((category) => category.id),
  );

  return {
    slaDays,
    slaEnabled,
    protectedCategoryIds,
    corruptionBypassesLocalRouting,
  };
}

export function findCategoryConfig(config: AdminConfigSnapshot, categoryId: CategoryId): CategoryConfig | null {
  return config.categories.find((category) => category.id === categoryId) ?? null;
}

export function findCategoryReadiness(config: AdminConfigSnapshot, categoryId: CategoryId): CategoryReadiness | null {
  return config.readiness.find((readiness) => readiness.categoryId === categoryId) ?? null;
}

export function isPublicIntakePaused(config: AdminConfigSnapshot) {
  return config.appControls.find((control) => control.id === "ops-maintenance")?.value === true;
}

export function citizenCategoryAvailability(config: AdminConfigSnapshot, category: CategoryConfig): CitizenCategoryAvailability {
  if (isPublicIntakePaused(config)) {
    return {
      id: category.id,
      labelEn: category.labelEn,
      labelTa: category.labelTa,
      sensitivity: category.sensitivity,
      enabled: category.enabled,
      intakeStatus: "disabled",
      message: "Public complaint intake is temporarily paused for maintenance. Existing complaints can still be tracked.",
    };
  }

  if (!category.enabled) {
    return {
      id: category.id,
      labelEn: category.labelEn,
      labelTa: category.labelTa,
      sensitivity: category.sensitivity,
      enabled: category.enabled,
      intakeStatus: "disabled",
      message: `${category.labelEn} complaints are not taking public submissions right now.`,
    };
  }

  const readiness = findCategoryReadiness(config, category.id);
  if (!readiness) {
    return {
      id: category.id,
      labelEn: category.labelEn,
      labelTa: category.labelTa,
      sensitivity: category.sensitivity,
      enabled: category.enabled,
      intakeStatus: "blocked",
      message: `${category.labelEn} complaints are not open because launch readiness has not been configured.`,
    };
  }

  if (readiness.launchState === "ready" && readiness.sopStatus === "approved" && readiness.trainingStatus === "approved") {
    return {
      id: category.id,
      labelEn: category.labelEn,
      labelTa: category.labelTa,
      sensitivity: category.sensitivity,
      enabled: category.enabled,
      intakeStatus: "open",
      message: `${category.labelEn} complaints are open for public intake.`,
    };
  }

  if (readiness.launchState === "pilot_only" && category.sensitivity === "protected") {
    return {
      id: category.id,
      labelEn: category.labelEn,
      labelTa: category.labelTa,
      sensitivity: category.sensitivity,
      enabled: category.enabled,
      intakeStatus: "protected_pilot",
      message: `${category.labelEn} complaints are accepted only into protected screening. Identity remains hidden from local levels.`,
    };
  }

  const pilotOnly = readiness.launchState === "pilot_only";
  return {
    id: category.id,
    labelEn: category.labelEn,
    labelTa: category.labelTa,
    sensitivity: category.sensitivity,
    enabled: category.enabled,
    intakeStatus: pilotOnly ? "pilot_only" : "blocked",
    message: pilotOnly
      ? `${category.labelEn} complaints are pilot-only until Admin marks SOP and training ready for public launch.`
      : `${category.labelEn} complaints are blocked until Admin completes owner, SLA, SOP, and training readiness.`,
  };
}

export function citizenCategoryReadinessRejection(config: AdminConfigSnapshot, category: CategoryConfig) {
  if (isPublicIntakePaused(config)) {
    return {
      error: "public_intake_paused",
      message: "Public complaint intake is temporarily paused for maintenance. Please try again shortly.",
    };
  }

  const readiness = findCategoryReadiness(config, category.id);
  if (!readiness) {
    return {
      error: "category_readiness_missing",
      message: `${category.labelEn} complaints are not open for citizen intake because launch readiness has not been configured.`,
    };
  }

  if (readiness.launchState === "ready" && readiness.sopStatus === "approved" && readiness.trainingStatus === "approved") {
    return null;
  }

  if (readiness.launchState === "pilot_only" && category.sensitivity === "protected") {
    return null;
  }

  return {
    error: readiness.launchState === "blocked" ? "category_not_launch_ready" : "category_pilot_only",
    message:
      readiness.launchState === "blocked"
        ? `${category.labelEn} complaints are blocked until Admin completes owner, SLA, SOP, and training readiness.`
        : `${category.labelEn} complaints are pilot-only until Admin marks SOP and training ready for public launch.`,
    readiness: {
      launchState: readiness.launchState,
      sopStatus: readiness.sopStatus,
      trainingStatus: readiness.trainingStatus,
    },
  };
}
