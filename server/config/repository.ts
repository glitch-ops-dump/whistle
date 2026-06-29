import { DevConfigRepository } from "./devConfigRepository.js";
import { PostgresConfigRepository } from "./postgresConfigRepository.js";
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

export type ConfigRepository = {
  readonly mode: string;
  healthCheck(): Promise<void>;
  getConfig(): Promise<AdminConfigSnapshot>;
  updateCategory(id: CategoryId, patch: Partial<Pick<CategoryConfig, "enabled" | "sensitivity">>): Promise<CategoryConfig | null>;
  updateCategoryReadiness(id: CategoryId, patch: CategoryReadinessPatch): Promise<CategoryReadiness | null>;
  updateSlaPolicy(stage: SlaStage, patch: Partial<Pick<SlaPolicy, "durationDays" | "enabled">>): Promise<SlaPolicy | null>;
  updateAppControl(id: string, value: ConfigValue): Promise<AppControlConfig | null>;
  listConfigChangeRequests(): Promise<ConfigChangeRequest[]>;
  createConfigChangeRequest(command: CreateConfigChangeRequestCommand, requestedBy: string): Promise<ConfigChangeRequest>;
  approveConfigChangeRequest(id: string, command: DecideConfigChangeRequestCommand): Promise<ConfigChangeRequest | null>;
  rejectConfigChangeRequest(id: string, command: DecideConfigChangeRequestCommand): Promise<ConfigChangeRequest | null>;
  close(): Promise<void>;
};

export function createConfigRepository(): ConfigRepository {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return new PostgresConfigRepository(databaseUrl);
  return new DevConfigRepository();
}
