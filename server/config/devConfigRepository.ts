import { defaultAdminConfig } from "./defaults.js";
import { applyConfigTargetToSnapshot, makeConfigChangeRequest } from "./governance.js";
import type {
  AdminConfigSnapshot,
  AppControlConfig,
  CategoryConfig,
  CategoryReadiness,
  CategoryReadinessPatch,
  ConfigChangeRequest,
  ConfigValue,
  CreateConfigChangeRequestCommand,
  DecideConfigChangeRequestCommand,
  SlaPolicy,
} from "./types.js";
import type { CategoryId, SlaStage } from "../ticket-spine/types.js";

export class DevConfigRepository {
  readonly mode = "mvp-dev-memory";

  private readonly config: AdminConfigSnapshot = defaultAdminConfig();
  private readonly changeRequests: ConfigChangeRequest[] = [];

  async healthCheck() {
    return;
  }

  async getConfig() {
    return snapshot(this.config);
  }

  async updateCategory(id: CategoryId, patch: Partial<Pick<CategoryConfig, "enabled" | "sensitivity">>) {
    const category = this.config.categories.find((item) => item.id === id);
    if (!category) return null;
    Object.assign(category, patch);
    return { ...category };
  }

  async updateCategoryReadiness(id: CategoryId, patch: CategoryReadinessPatch) {
    const readiness = this.config.readiness.find((item) => item.categoryId === id);
    if (!readiness) return null;
    Object.assign(readiness, patch);
    if (patch.roleAccess) readiness.roleAccess = [...patch.roleAccess];
    return cloneReadiness(readiness);
  }

  async updateSlaPolicy(stage: SlaStage, patch: Partial<Pick<SlaPolicy, "durationDays" | "enabled">>) {
    const policy = this.config.slaPolicies.find((item) => item.stage === stage);
    if (!policy) return null;
    Object.assign(policy, patch);
    return { ...policy };
  }

  async updateAppControl(id: string, value: ConfigValue) {
    const control = this.config.appControls.find((item) => item.id === id);
    if (!control) return null;
    control.value = value;
    return { ...control };
  }

  async listConfigChangeRequests() {
    return this.changeRequests.map((request) => cloneRequest(request)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async createConfigChangeRequest(command: CreateConfigChangeRequestCommand, requestedBy: string) {
    const request = makeConfigChangeRequest(command.target, command.reason, requestedBy);
    this.changeRequests.unshift(request);
    return cloneRequest(request);
  }

  async approveConfigChangeRequest(id: string, command: DecideConfigChangeRequestCommand) {
    const request = this.changeRequests.find((item) => item.id === id);
    if (!request || request.status !== "pending") return null;
    const applied = applyConfigTargetToSnapshot(this.config, request.target);
    if (!applied) return null;
    const decidedAt = new Date().toISOString();
    Object.assign(request, {
      status: "approved" as const,
      decidedBy: command.actor,
      decisionReason: command.reason,
      decidedAt,
      appliedAt: decidedAt,
    });
    return cloneRequest(request);
  }

  async rejectConfigChangeRequest(id: string, command: DecideConfigChangeRequestCommand) {
    const request = this.changeRequests.find((item) => item.id === id);
    if (!request || request.status !== "pending") return null;
    Object.assign(request, {
      status: "rejected" as const,
      decidedBy: command.actor,
      decisionReason: command.reason,
      decidedAt: new Date().toISOString(),
    });
    return cloneRequest(request);
  }

  async close() {
    return;
  }
}

function cloneRequest(request: ConfigChangeRequest): ConfigChangeRequest {
  return {
    ...request,
    target: JSON.parse(JSON.stringify(request.target)) as ConfigChangeRequest["target"],
  };
}

function snapshot(config: AdminConfigSnapshot): AdminConfigSnapshot {
  return {
    categories: config.categories.map((item) => ({ ...item })),
    readiness: config.readiness.map((item) => cloneReadiness(item)),
    slaPolicies: config.slaPolicies.map((item) => ({ ...item })),
    appControls: config.appControls.map((item) => ({ ...item })),
  };
}

function cloneReadiness(readiness: CategoryReadiness): CategoryReadiness {
  return {
    ...readiness,
    roleAccess: [...readiness.roleAccess],
  };
}
