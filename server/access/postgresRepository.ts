import pg from "pg";
import type {
  AccessGrant,
  AccessReviewEvent,
  AccessSnapshot,
  AccessTeam,
  AccessUser,
  CreateAccessGrantCommand,
  CreateAccessTeamCommand,
  CreateAccessUserCommand,
  CreateTeamMembershipCommand,
  EffectiveAccess,
  EffectiveAccessGrant,
  TeamMembership,
  UpdateAccessGrantCommand,
  UpdateAccessTeamCommand,
  UpdateAccessUserCommand,
  UpdateTeamMembershipCommand,
} from "./types.js";

type UserRow = {
  id: string;
  actor_key: string;
  display_name: string;
  status: AccessUser["status"];
  mfa_state: AccessUser["mfaState"];
  created_at: Date;
};

type TeamRow = {
  id: string;
  name: string;
  role: AccessTeam["role"];
  status: AccessTeam["status"];
  owner_actor_key: string;
  default_scope_kind: AccessTeam["defaultScopeKind"];
  default_scope_value: string;
  created_at: Date;
};

type MembershipRow = {
  id: string;
  user_id: string;
  team_id: string;
  role_label: string;
  expires_at: Date | null;
  created_at: Date;
};

type GrantRow = {
  id: string;
  target_type: AccessGrant["targetType"];
  target_id: string;
  role: AccessGrant["role"];
  scope_kind: AccessGrant["scopeKind"];
  scope_value: string;
  protected_access: boolean;
  reporter_identity: boolean;
  actions: string[];
  expires_at: Date | null;
  created_at: Date;
};

type ReviewRow = {
  id: string;
  actor_key: string;
  action: string;
  summary: string;
  created_at: Date;
};

export class PostgresAccessRepository {
  readonly mode = "mvp-access-postgres";

  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async healthCheck() {
    await this.pool.query("select 1 from access_users limit 1");
  }

  async getSnapshot(): Promise<AccessSnapshot> {
    const [users, teams, memberships, grants, reviewEvents] = await Promise.all([
      this.pool.query<UserRow>("select id, actor_key, display_name, status, mfa_state, created_at from access_users order by display_name asc"),
      this.pool.query<TeamRow>("select id, name, role, status, owner_actor_key, default_scope_kind, default_scope_value, created_at from access_teams order by name asc"),
      this.pool.query<MembershipRow>("select id, user_id, team_id, role_label, expires_at, created_at from team_memberships order by created_at desc"),
      this.pool.query<GrantRow>("select id, target_type, target_id, role, scope_kind, scope_value, protected_access, reporter_identity, actions, expires_at, created_at from role_grants order by created_at desc"),
      this.pool.query<ReviewRow>("select id, actor_key, action, summary, created_at from access_review_events order by created_at desc"),
    ]);
    return {
      users: users.rows.map(rowToUser),
      teams: teams.rows.map(rowToTeam),
      memberships: memberships.rows.map(rowToMembership),
      grants: grants.rows.map(rowToGrant),
      reviewEvents: reviewEvents.rows.map(rowToReviewEvent),
    };
  }

  async createUser(command: CreateAccessUserCommand, actor = "admin:prototype") {
    const result = await this.pool.query<UserRow>(
      `
        insert into access_users (actor_key, display_name, status, mfa_state)
        values ($1, $2, $3, $4)
        returning id, actor_key, display_name, status, mfa_state, created_at
      `,
      [command.actorKey, command.displayName, command.status ?? "active", command.mfaState ?? "not_required_mvp"],
    );
    const user = rowToUser(result.rows[0]);
    await this.addEvent(actor, "access.user.create", `${user.displayName} invited as ${user.actorKey}.`);
    return user;
  }

  async createTeam(command: CreateAccessTeamCommand, actor = "admin:prototype") {
    const result = await this.pool.query<TeamRow>(
      `
        insert into access_teams (name, role, owner_actor_key, default_scope_kind, default_scope_value)
        values ($1, $2, $3, $4, $5)
        returning id, name, role, status, owner_actor_key, default_scope_kind, default_scope_value, created_at
      `,
      [command.name, command.role, command.ownerActorKey, command.defaultScopeKind, command.defaultScopeValue],
    );
    const team = rowToTeam(result.rows[0]);
    await this.addEvent(actor, "access.team.create", `${team.name} created for ${team.defaultScopeKind}:${team.defaultScopeValue}.`);
    return team;
  }

  async createMembership(command: CreateTeamMembershipCommand, actor = "admin:prototype") {
    const result = await this.pool.query<MembershipRow>(
      `
        insert into team_memberships (user_id, team_id, role_label, expires_at)
        values ($1, $2, $3, $4)
        on conflict (user_id, team_id)
        do update set role_label = excluded.role_label,
                      expires_at = excluded.expires_at
        returning id, user_id, team_id, role_label, expires_at, created_at
      `,
      [command.userId, command.teamId, command.roleLabel, command.expiresAt ?? null],
    );
    const membership = rowToMembership(result.rows[0]);
    await this.addEvent(actor, "access.membership.upsert", `${membership.userId} assigned to ${membership.teamId} as ${membership.roleLabel}.`);
    return membership;
  }

  async createGrant(command: CreateAccessGrantCommand, actor = "admin:prototype") {
    const result = await this.pool.query<GrantRow>(
      `
        insert into role_grants (
          target_type, target_id, role, scope_kind, scope_value,
          protected_access, reporter_identity, actions, expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning id, target_type, target_id, role, scope_kind, scope_value,
                  protected_access, reporter_identity, actions, expires_at, created_at
      `,
      [
        command.targetType,
        command.targetId,
        command.role,
        command.scopeKind,
        command.scopeValue,
        command.protectedAccess ?? false,
        command.reporterIdentity ?? false,
        command.actions ?? [],
        command.expiresAt ?? null,
      ],
    );
    const grant = rowToGrant(result.rows[0]);
    await this.addEvent(actor, "access.grant.create", `${grant.role} granted to ${grant.targetType}:${grant.targetId} for ${grant.scopeKind}:${grant.scopeValue}.`);
    return grant;
  }

  async updateUser(userId: string, command: UpdateAccessUserCommand, actor = "admin:prototype") {
    const result = await this.pool.query<UserRow>(
      `
        update access_users
        set status = coalesce($2, status),
            mfa_state = coalesce($3, mfa_state)
        where id = $1
        returning id, actor_key, display_name, status, mfa_state, created_at
      `,
      [userId, command.status ?? null, command.mfaState ?? null],
    );
    const row = result.rows[0];
    if (!row) return null;
    const user = rowToUser(row);
    await this.addEvent(actor, "access.user.update", `${user.displayName} set to ${user.status}; MFA ${user.mfaState}.`);
    return user;
  }

  async updateTeam(teamId: string, command: UpdateAccessTeamCommand, actor = "admin:prototype") {
    const result = await this.pool.query<TeamRow>(
      `
        update access_teams
        set status = coalesce($2, status),
            owner_actor_key = coalesce($3, owner_actor_key),
            default_scope_kind = coalesce($4, default_scope_kind),
            default_scope_value = coalesce($5, default_scope_value)
        where id = $1
        returning id, name, role, status, owner_actor_key, default_scope_kind, default_scope_value, created_at
      `,
      [
        teamId,
        command.status ?? null,
        command.ownerActorKey ?? null,
        command.defaultScopeKind ?? null,
        command.defaultScopeValue ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    const team = rowToTeam(row);
    await this.addEvent(
      actor,
      "access.team.update",
      `${team.name} set to ${team.status} for ${team.defaultScopeKind}:${team.defaultScopeValue}; owner=${team.ownerActorKey}.`,
    );
    return team;
  }

  async updateMembership(membershipId: string, command: UpdateTeamMembershipCommand, actor = "admin:prototype") {
    const result = await this.pool.query<MembershipRow>(
      `
        update team_memberships
        set role_label = coalesce($2, role_label),
            expires_at = case when $3::boolean then $4::timestamptz else expires_at end
        where id = $1
        returning id, user_id, team_id, role_label, expires_at, created_at
      `,
      [membershipId, command.roleLabel ?? null, Object.hasOwn(command, "expiresAt"), command.expiresAt ?? null],
    );
    const row = result.rows[0];
    if (!row) return null;
    const membership = rowToMembership(row);
    await this.addEvent(
      actor,
      "access.membership.update",
      `${membership.userId} membership in ${membership.teamId} set to role=${membership.roleLabel}; expires=${membership.expiresAt ?? "none"}.`,
    );
    return membership;
  }

  async updateGrant(grantId: string, command: UpdateAccessGrantCommand, actor = "admin:prototype") {
    const result = await this.pool.query<GrantRow>(
      `
        update role_grants
        set protected_access = coalesce($2, protected_access),
            reporter_identity = coalesce($3, reporter_identity),
            expires_at = case when $4::boolean then $5::timestamptz else expires_at end
        where id = $1
        returning id, target_type, target_id, role, scope_kind, scope_value,
                  protected_access, reporter_identity, actions, expires_at, created_at
      `,
      [
        grantId,
        command.protectedAccess ?? null,
        command.reporterIdentity ?? null,
        Object.hasOwn(command, "expiresAt"),
        command.expiresAt ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    const grant = rowToGrant(row);
    await this.addEvent(
      actor,
      "access.grant.update",
      `${grant.role} grant ${grant.id} visibility updated; protected=${grant.protectedAccess}; reporter=${grant.reporterIdentity}; expires=${grant.expiresAt ?? "none"}.`,
    );
    return grant;
  }

  async getEffectiveAccess(actorKey: string): Promise<EffectiveAccess> {
    const userResult = await this.pool.query<UserRow>(
      "select id, actor_key, display_name, status, mfa_state, created_at from access_users where actor_key = $1 and status = 'active'",
      [actorKey],
    );
    const user = userResult.rows[0] ? rowToUser(userResult.rows[0]) : null;
    if (!user) return emptyEffectiveAccess(actorKey);

    const [teamResult, grantResult] = await Promise.all([
      this.pool.query<TeamRow>(
        `
          select t.id, t.name, t.role, t.status, t.owner_actor_key, t.default_scope_kind, t.default_scope_value, t.created_at
          from access_teams t
          join team_memberships m on m.team_id = t.id
          where m.user_id = $1
            and t.status = 'active'
            and (m.expires_at is null or m.expires_at > now())
          order by t.name asc
        `,
        [user.id],
      ),
      this.pool.query<GrantRow & { source: "direct" | "team"; source_label: string }>(
        `
          select g.id, g.target_type, g.target_id, g.role, g.scope_kind, g.scope_value,
                 g.protected_access, g.reporter_identity, g.actions, g.expires_at, g.created_at,
                 case when g.target_type = 'user' then 'direct' else 'team' end as source,
                 coalesce(t.name, u.display_name, g.target_id) as source_label
          from role_grants g
          left join access_teams t on g.target_type = 'team' and t.id = g.target_id
          left join access_users u on g.target_type = 'user' and u.id = g.target_id
          where (
            (g.target_type = 'user' and g.target_id = $1)
            or (
              g.target_type = 'team'
              and g.target_id in (
                select team_id from team_memberships
                where user_id = $1 and (expires_at is null or expires_at > now())
               )
             )
          )
          and (g.expires_at is null or g.expires_at > now())
          order by g.created_at desc
        `,
        [user.id],
      ),
    ]);

    const grants = grantResult.rows.map((row) => ({
      ...rowToGrant(row),
      source: row.source,
      sourceLabel: row.source_label,
    }));

    return {
      actor: actorKey,
      user,
      teams: teamResult.rows.map(rowToTeam),
      grants,
      roles: [...new Set(grants.map((grant) => grant.role))],
      protectedAccess: grants.some((grant) => grant.protectedAccess),
      reporterIdentity: grants.some((grant) => grant.reporterIdentity),
      actions: [...new Set(grants.flatMap((grant) => grant.actions))],
    };
  }

  async close() {
    await this.pool.end();
  }

  private async addEvent(actor: string, action: string, summary: string) {
    await this.pool.query("insert into access_review_events (actor_key, action, summary) values ($1, $2, $3)", [actor, action, summary]);
  }
}

function rowToUser(row: UserRow): AccessUser {
  return {
    id: row.id,
    actorKey: row.actor_key,
    displayName: row.display_name,
    status: row.status,
    mfaState: row.mfa_state,
    createdAt: row.created_at.toISOString(),
  };
}

function rowToTeam(row: TeamRow): AccessTeam {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    ownerActorKey: row.owner_actor_key,
    defaultScopeKind: row.default_scope_kind,
    defaultScopeValue: row.default_scope_value,
    createdAt: row.created_at.toISOString(),
  };
}

function rowToMembership(row: MembershipRow): TeamMembership {
  return {
    id: row.id,
    userId: row.user_id,
    teamId: row.team_id,
    roleLabel: row.role_label,
    expiresAt: row.expires_at?.toISOString() ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function rowToGrant(row: GrantRow): AccessGrant {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    role: row.role,
    scopeKind: row.scope_kind,
    scopeValue: row.scope_value,
    protectedAccess: row.protected_access,
    reporterIdentity: row.reporter_identity,
    actions: row.actions,
    expiresAt: row.expires_at?.toISOString() ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function rowToReviewEvent(row: ReviewRow): AccessReviewEvent {
  return {
    id: row.id,
    actor: row.actor_key,
    action: row.action,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
  };
}

function emptyEffectiveAccess(actor: string): EffectiveAccess {
  return {
    actor,
    user: null,
    teams: [],
    grants: [],
    roles: [],
    protectedAccess: false,
    reporterIdentity: false,
    actions: [],
  };
}
