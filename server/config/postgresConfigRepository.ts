import pg from "pg";
import { defaultAppControls, defaultCategoryReadiness, defaultSlaPolicies } from "./defaults.js";
import { configChangeSummary, makeConfigChangeRequest, targetFromParts, targetKey } from "./governance.js";
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

type CategoryRow = {
  id: CategoryId;
  label_en: string;
  label_ta: string;
  sensitivity: CategoryConfig["sensitivity"];
  enabled: boolean;
};

type SlaPolicyRow = {
  stage: SlaStage;
  label: string;
  duration_days: number;
  escalation_target: string;
  enabled: boolean;
};

type CategoryReadinessRow = {
  category_id: CategoryId;
  primary_owner: string;
  sla_summary: string;
  escalation_path: string;
  role_access: string[];
  public_visibility: string;
  privacy_level: CategoryReadiness["privacyLevel"];
  sop_status: CategoryReadiness["sopStatus"];
  training_status: CategoryReadiness["trainingStatus"];
  launch_state: CategoryReadiness["launchState"];
  notes: string;
};

type AppControlRow = {
  id: string;
  control_group: AppControlConfig["group"];
  name: string;
  value_json: ConfigValue;
  value_type: AppControlConfig["valueType"];
  critical: boolean;
};

type ConfigChangeRequestRow = {
  id: string;
  target_kind: ConfigChangeRequest["target"]["kind"];
  target_id: string;
  payload: unknown;
  summary: string;
  reason: string;
  status: ConfigChangeRequest["status"];
  requested_by: string;
  requested_at: Date;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: Date | null;
  applied_at: Date | null;
};

const neutralAssetControlIds = new Set(["asset-logo-approved", "asset-portrait-approved", "asset-tn-emblem-approved", "asset-public-disclaimer-approved"]);

const placeholderSyncAppControlIds = new Set([
  "platform-postgres-migration-evidence-ref",
  "platform-postgres-mvp-check-evidence-ref",
  "uat-launch-rehearsal-evidence-ref",
  "uat-defect-register-ref",
  "ops-restore-drill-evidence-ref",
  "ops-siem-worm-evidence-ref",
  "ops-telemetry-launch-watch-evidence-ref",
  "ops-origin-allowlist-evidence-ref",
  "ops-incident-hold-policy-evidence-ref",
]);

export class PostgresConfigRepository {
  readonly mode = "mvp-postgres";

  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async healthCheck() {
    await this.pool.query("select 1 from categories limit 1");
  }

  async getConfig(): Promise<AdminConfigSnapshot> {
    await this.ensureDefaults();
    const [categories, readiness, slaPolicies, appControls] = await Promise.all([
      this.pool.query<CategoryRow>("select id, label_en, label_ta, sensitivity, enabled from categories order by id"),
      this.pool.query<CategoryReadinessRow>(
        `
          select category_id, primary_owner, sla_summary, escalation_path, role_access,
                 public_visibility, privacy_level, sop_status, training_status, launch_state, notes
          from category_readiness
          order by category_id
        `,
      ),
      this.pool.query<SlaPolicyRow>("select stage, label, duration_days, escalation_target, enabled from sla_policies order by sort_order"),
      this.pool.query<AppControlRow>("select id, control_group, name, value_json, value_type, critical from app_controls order by sort_order"),
    ]);
    return {
      categories: categories.rows.map(rowToCategory),
      readiness: readiness.rows.map(rowToReadiness),
      slaPolicies: slaPolicies.rows.map(rowToSlaPolicy),
      appControls: appControls.rows.map(rowToAppControl),
    };
  }

  async updateCategory(id: CategoryId, patch: Partial<Pick<CategoryConfig, "enabled" | "sensitivity">>) {
    await this.ensureDefaults();
    const result = await this.pool.query<CategoryRow>(
      `
        update categories
        set enabled = coalesce($2, enabled),
            sensitivity = coalesce($3, sensitivity)
        where id = $1
        returning id, label_en, label_ta, sensitivity, enabled
      `,
      [id, patch.enabled ?? null, patch.sensitivity ?? null],
    );
    return result.rows[0] ? rowToCategory(result.rows[0]) : null;
  }

  async updateCategoryReadiness(id: CategoryId, patch: CategoryReadinessPatch) {
    await this.ensureDefaults();
    const result = await this.pool.query<CategoryReadinessRow>(
      `
        update category_readiness
        set primary_owner = coalesce($2, primary_owner),
            sla_summary = coalesce($3, sla_summary),
            escalation_path = coalesce($4, escalation_path),
            role_access = coalesce($5, role_access),
            public_visibility = coalesce($6, public_visibility),
            privacy_level = coalesce($7, privacy_level),
            sop_status = coalesce($8, sop_status),
            training_status = coalesce($9, training_status),
            launch_state = coalesce($10, launch_state),
            notes = coalesce($11, notes),
            updated_at = now()
        where category_id = $1
        returning category_id, primary_owner, sla_summary, escalation_path, role_access,
                  public_visibility, privacy_level, sop_status, training_status, launch_state, notes
      `,
      [
        id,
        patch.primaryOwner ?? null,
        patch.slaSummary ?? null,
        patch.escalationPath ?? null,
        patch.roleAccess ?? null,
        patch.publicVisibility ?? null,
        patch.privacyLevel ?? null,
        patch.sopStatus ?? null,
        patch.trainingStatus ?? null,
        patch.launchState ?? null,
        patch.notes ?? null,
      ],
    );
    return result.rows[0] ? rowToReadiness(result.rows[0]) : null;
  }

  async updateSlaPolicy(stage: SlaStage, patch: Partial<Pick<SlaPolicy, "durationDays" | "enabled">>) {
    await this.ensureDefaults();
    const result = await this.pool.query<SlaPolicyRow>(
      `
        update sla_policies
        set duration_days = coalesce($2, duration_days),
            enabled = coalesce($3, enabled),
            updated_at = now()
        where stage = $1
        returning stage, label, duration_days, escalation_target, enabled
      `,
      [stage, patch.durationDays ?? null, patch.enabled ?? null],
    );
    return result.rows[0] ? rowToSlaPolicy(result.rows[0]) : null;
  }

  async updateAppControl(id: string, value: ConfigValue) {
    await this.ensureDefaults();
    const result = await this.pool.query<AppControlRow>(
      `
        update app_controls
        set value_json = $2::jsonb,
            updated_at = now()
        where id = $1
        returning id, control_group, name, value_json, value_type, critical
      `,
      [id, JSON.stringify(value)],
    );
    return result.rows[0] ? rowToAppControl(result.rows[0]) : null;
  }

  async listConfigChangeRequests() {
    await this.ensureGovernanceTables();
    const result = await this.pool.query<ConfigChangeRequestRow>(
      `
        select id, target_kind, target_id, payload, summary, reason, status,
               requested_by, requested_at, decided_by, decision_reason, decided_at, applied_at
        from config_change_requests
        order by requested_at desc
      `,
    );
    return result.rows.map(rowToConfigChangeRequest);
  }

  async createConfigChangeRequest(command: CreateConfigChangeRequestCommand, requestedBy: string) {
    await this.ensureGovernanceTables();
    const request = makeConfigChangeRequest(command.target, command.reason, requestedBy);
    await this.pool.query(
      `
        insert into config_change_requests (
          id, target_kind, target_id, payload, summary, reason, status, requested_by, requested_at
        )
        values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
      `,
      [
        request.id,
        request.target.kind,
        targetKey(request.target).split(":").slice(1).join(":"),
        JSON.stringify(payloadForTarget(request.target)),
        request.summary,
        request.reason,
        request.status,
        request.requestedBy,
        request.requestedAt,
      ],
    );
    return request;
  }

  async approveConfigChangeRequest(id: string, command: DecideConfigChangeRequestCommand) {
    await this.ensureGovernanceTables();
    return this.inTransaction(async (client) => {
      const existing = await client.query<ConfigChangeRequestRow>(
        `
          select id, target_kind, target_id, payload, summary, reason, status,
                 requested_by, requested_at, decided_by, decision_reason, decided_at, applied_at
          from config_change_requests
          where id = $1
          for update
        `,
        [id],
      );
      const row = existing.rows[0];
      if (!row || row.status !== "pending") return null;
      const request = rowToConfigChangeRequest(row);
      const applied = await this.applyTargetWithClient(client, request.target);
      if (!applied) return null;
      const decidedAt = new Date().toISOString();
      const updated = await client.query<ConfigChangeRequestRow>(
        `
          update config_change_requests
          set status = 'approved',
              decided_by = $2,
              decision_reason = $3,
              decided_at = $4,
              applied_at = $4
          where id = $1
          returning id, target_kind, target_id, payload, summary, reason, status,
                    requested_by, requested_at, decided_by, decision_reason, decided_at, applied_at
        `,
        [id, command.actor, command.reason, decidedAt],
      );
      return updated.rows[0] ? rowToConfigChangeRequest(updated.rows[0]) : null;
    });
  }

  async rejectConfigChangeRequest(id: string, command: DecideConfigChangeRequestCommand) {
    await this.ensureGovernanceTables();
    const decidedAt = new Date().toISOString();
    const result = await this.pool.query<ConfigChangeRequestRow>(
      `
        update config_change_requests
        set status = 'rejected',
            decided_by = $2,
            decision_reason = $3,
            decided_at = $4
        where id = $1 and status = 'pending'
        returning id, target_kind, target_id, payload, summary, reason, status,
                  requested_by, requested_at, decided_by, decision_reason, decided_at, applied_at
      `,
      [id, command.actor, command.reason, decidedAt],
    );
    return result.rows[0] ? rowToConfigChangeRequest(result.rows[0]) : null;
  }

  async close() {
    await this.pool.end();
  }

  private async inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureDefaults() {
    await this.ensureGovernanceTables();
    for (const [index, policy] of defaultSlaPolicies.entries()) {
      await this.pool.query(
        `
          insert into sla_policies (stage, label, duration_days, escalation_target, enabled, sort_order)
          values ($1, $2, $3, $4, $5, $6)
          on conflict (stage) do nothing
        `,
        [policy.stage, policy.label, policy.durationDays, policy.escalationTarget, policy.enabled, index + 1],
      );
    }
    for (const [index, readiness] of defaultCategoryReadiness.entries()) {
      await this.pool.query(
        `
          insert into category_readiness (
            category_id, primary_owner, sla_summary, escalation_path, role_access,
            public_visibility, privacy_level, sop_status, training_status, launch_state, notes, sort_order
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          on conflict (category_id) do nothing
        `,
        [
          readiness.categoryId,
          readiness.primaryOwner,
          readiness.slaSummary,
          readiness.escalationPath,
          readiness.roleAccess,
          readiness.publicVisibility,
          readiness.privacyLevel,
          readiness.sopStatus,
          readiness.trainingStatus,
          readiness.launchState,
          readiness.notes,
          index + 1,
        ],
      );
    }
    for (const [index, control] of defaultAppControls.entries()) {
      await this.pool.query(
        `
          insert into app_controls (id, control_group, name, value_json, value_type, critical, sort_order)
          values ($1, $2, $3, $4::jsonb, $5, $6, $7)
          on conflict (id) do ${appControlDefaultConflictClause(control.id)}
        `,
        [control.id, control.group, control.name, JSON.stringify(control.value), control.valueType, control.critical, index + 1],
      );
    }
  }

  private async ensureGovernanceTables() {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext('whistle_config_governance_tables'))");
      await client.query(`
        create table if not exists category_readiness (
          category_id text primary key references categories(id),
          primary_owner text not null,
          sla_summary text not null,
          escalation_path text not null,
          role_access text[] not null default '{}',
          public_visibility text not null,
          privacy_level text not null check (privacy_level in ('public_aggregate', 'identity_masked', 'protected')),
          sop_status text not null check (sop_status in ('approved', 'scheduled', 'required')),
          training_status text not null check (training_status in ('approved', 'scheduled', 'required')),
          launch_state text not null check (launch_state in ('ready', 'pilot_only', 'blocked')),
          notes text not null default '',
          sort_order integer not null default 100,
          updated_at timestamptz not null default now()
        )
      `);
      await client.query(`
        create table if not exists config_change_requests (
          id text primary key,
          target_kind text not null check (target_kind in ('category', 'sla_policy', 'category_readiness', 'app_control')),
          target_id text not null,
          payload jsonb not null,
          summary text not null,
          reason text not null,
          status text not null check (status in ('pending', 'approved', 'rejected')),
          requested_by text not null,
          requested_at timestamptz not null default now(),
          decided_by text,
          decision_reason text,
          decided_at timestamptz,
          applied_at timestamptz
        )
      `);
      await client.query("alter table config_change_requests drop constraint if exists config_change_requests_target_kind_check");
      await client.query(
        "alter table config_change_requests add constraint config_change_requests_target_kind_check check (target_kind in ('category', 'sla_policy', 'category_readiness', 'app_control'))",
      );
      await client.query("create index if not exists config_change_requests_status_created_idx on config_change_requests (status, requested_at desc)");
      await client.query("create index if not exists category_readiness_state_idx on category_readiness (launch_state, sop_status, training_status)");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyTargetWithClient(client: pg.PoolClient, target: ConfigChangeRequest["target"]) {
    if (target.kind === "category") {
      const result = await client.query<CategoryRow>(
        `
          update categories
          set enabled = coalesce($2, enabled),
              sensitivity = coalesce($3, sensitivity)
          where id = $1
          returning id, label_en, label_ta, sensitivity, enabled
        `,
        [target.id, target.patch.enabled ?? null, target.patch.sensitivity ?? null],
      );
      return result.rows[0] ? rowToCategory(result.rows[0]) : null;
    }
    if (target.kind === "sla_policy") {
      const result = await client.query<SlaPolicyRow>(
        `
          update sla_policies
          set duration_days = coalesce($2, duration_days),
              enabled = coalesce($3, enabled),
              updated_at = now()
          where stage = $1
          returning stage, label, duration_days, escalation_target, enabled
        `,
        [target.stage, target.patch.durationDays ?? null, target.patch.enabled ?? null],
      );
      return result.rows[0] ? rowToSlaPolicy(result.rows[0]) : null;
    }
    if (target.kind === "category_readiness") {
      const result = await client.query<CategoryReadinessRow>(
        `
          update category_readiness
          set primary_owner = coalesce($2, primary_owner),
              sla_summary = coalesce($3, sla_summary),
              escalation_path = coalesce($4, escalation_path),
              role_access = coalesce($5, role_access),
              public_visibility = coalesce($6, public_visibility),
              privacy_level = coalesce($7, privacy_level),
              sop_status = coalesce($8, sop_status),
              training_status = coalesce($9, training_status),
              launch_state = coalesce($10, launch_state),
              notes = coalesce($11, notes),
              updated_at = now()
          where category_id = $1
          returning category_id, primary_owner, sla_summary, escalation_path, role_access,
                    public_visibility, privacy_level, sop_status, training_status, launch_state, notes
        `,
        [
          target.categoryId,
          target.patch.primaryOwner ?? null,
          target.patch.slaSummary ?? null,
          target.patch.escalationPath ?? null,
          target.patch.roleAccess ?? null,
          target.patch.publicVisibility ?? null,
          target.patch.privacyLevel ?? null,
          target.patch.sopStatus ?? null,
          target.patch.trainingStatus ?? null,
          target.patch.launchState ?? null,
          target.patch.notes ?? null,
        ],
      );
      return result.rows[0] ? rowToReadiness(result.rows[0]) : null;
    }
    const result = await client.query<AppControlRow>(
      `
        update app_controls
        set value_json = $2::jsonb,
            updated_at = now()
        where id = $1
        returning id, control_group, name, value_json, value_type, critical
      `,
      [target.id, JSON.stringify(target.value)],
    );
    return result.rows[0] ? rowToAppControl(result.rows[0]) : null;
  }
}

function appControlDefaultConflictClause(controlId: string) {
  const metadataUpdate =
    "control_group = excluded.control_group, name = excluded.name, value_type = excluded.value_type, critical = excluded.critical, sort_order = excluded.sort_order";
  if (neutralAssetControlIds.has(controlId)) {
    return `update set ${metadataUpdate}, value_json = excluded.value_json, updated_at = now()`;
  }
  if (placeholderSyncAppControlIds.has(controlId)) {
    return `
      update set ${metadataUpdate},
        value_json = case
          when coalesce(app_controls.value_json #>> '{}', '') = '' then excluded.value_json
          when lower(coalesce(app_controls.value_json #>> '{}', '')) like 'pending%' then excluded.value_json
          when lower(coalesce(app_controls.value_json #>> '{}', '')) like 'not-enabled%' then excluded.value_json
          else app_controls.value_json
        end,
        updated_at = case
          when coalesce(app_controls.value_json #>> '{}', '') = '' then now()
          when lower(coalesce(app_controls.value_json #>> '{}', '')) like 'pending%' then now()
          when lower(coalesce(app_controls.value_json #>> '{}', '')) like 'not-enabled%' then now()
          else app_controls.updated_at
        end
    `;
  }
  return "nothing";
}

function rowToCategory(row: CategoryRow): CategoryConfig {
  return {
    id: row.id,
    labelEn: row.label_en,
    labelTa: row.label_ta,
    sensitivity: row.sensitivity,
    enabled: row.enabled,
  };
}

function rowToSlaPolicy(row: SlaPolicyRow): SlaPolicy {
  return {
    stage: row.stage,
    label: row.label,
    durationDays: row.duration_days,
    escalationTarget: row.escalation_target,
    enabled: row.enabled,
  };
}

function rowToReadiness(row: CategoryReadinessRow): CategoryReadiness {
  return {
    categoryId: row.category_id,
    primaryOwner: row.primary_owner,
    slaSummary: row.sla_summary,
    escalationPath: row.escalation_path,
    roleAccess: row.role_access,
    publicVisibility: row.public_visibility,
    privacyLevel: row.privacy_level,
    sopStatus: row.sop_status,
    trainingStatus: row.training_status,
    launchState: row.launch_state,
    notes: row.notes,
  };
}

function rowToAppControl(row: AppControlRow): AppControlConfig {
  return {
    id: row.id,
    group: row.control_group,
    name: row.name,
    value: row.value_json,
    valueType: row.value_type,
    critical: row.critical,
  };
}

function payloadForTarget(target: ConfigChangeRequest["target"]) {
  if (target.kind === "category") return target.patch;
  if (target.kind === "sla_policy") return target.patch;
  if (target.kind === "category_readiness") return target.patch;
  return target.value;
}

function rowToConfigChangeRequest(row: ConfigChangeRequestRow): ConfigChangeRequest {
  const target = targetFromParts(row.target_kind, row.target_id, row.payload);
  return {
    id: row.id,
    target,
    summary: row.summary || configChangeSummary(target),
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at.toISOString(),
    decidedBy: row.decided_by ?? undefined,
    decisionReason: row.decision_reason ?? undefined,
    decidedAt: row.decided_at?.toISOString() ?? undefined,
    appliedAt: row.applied_at?.toISOString() ?? undefined,
  };
}
