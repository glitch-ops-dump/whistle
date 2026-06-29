import { defaultAccessGrants, defaultAccessReviewEvents, defaultAccessTeams, defaultAccessUsers, defaultTeamMemberships } from "./defaults.js";
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

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isExpired(expiresAt?: string) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
}

export class DevAccessRepository {
  readonly mode = "mvp-access-dev-memory";

  private readonly users = new Map(defaultAccessUsers.map((user) => [user.id, { ...user }]));
  private readonly teams = new Map(defaultAccessTeams.map((team) => [team.id, { ...team }]));
  private readonly memberships = new Map(defaultTeamMemberships.map((membership) => [membership.id, { ...membership }]));
  private readonly grants = new Map(defaultAccessGrants.map((grant) => [grant.id, { ...grant, actions: [...grant.actions] }]));
  private readonly reviewEvents: AccessReviewEvent[] = defaultAccessReviewEvents.map((event) => ({ ...event }));

  async healthCheck() {
    return;
  }

  async getSnapshot(): Promise<AccessSnapshot> {
    return {
      users: [...this.users.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
      teams: [...this.teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
      memberships: [...this.memberships.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      grants: [...this.grants.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      reviewEvents: [...this.reviewEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  async createUser(command: CreateAccessUserCommand, actor = "admin:prototype") {
    const user: AccessUser = {
      id: id("usr"),
      actorKey: command.actorKey,
      displayName: command.displayName,
      status: command.status ?? "active",
      mfaState: command.mfaState ?? "not_required_mvp",
      createdAt: nowIso(),
    };
    this.users.set(user.id, user);
    this.addEvent(actor, "access.user.create", `${user.displayName} invited as ${user.actorKey}.`);
    return user;
  }

  async createTeam(command: CreateAccessTeamCommand, actor = "admin:prototype") {
    const team: AccessTeam = {
      id: id("team"),
      name: command.name,
      role: command.role,
      status: "active",
      ownerActorKey: command.ownerActorKey,
      defaultScopeKind: command.defaultScopeKind,
      defaultScopeValue: command.defaultScopeValue,
      createdAt: nowIso(),
    };
    this.teams.set(team.id, team);
    this.addEvent(actor, "access.team.create", `${team.name} created for ${team.defaultScopeKind}:${team.defaultScopeValue}.`);
    return team;
  }

  async createMembership(command: CreateTeamMembershipCommand, actor = "admin:prototype") {
    const existing = [...this.memberships.values()].find(
      (membership) => membership.userId === command.userId && membership.teamId === command.teamId,
    );
    if (existing) {
      const restored = isExpired(existing.expiresAt) && command.expiresAt === undefined;
      const membership: TeamMembership = {
        ...existing,
        roleLabel: command.roleLabel,
        expiresAt: command.expiresAt,
      };
      this.memberships.set(membership.id, membership);
      this.addEvent(
        actor,
        restored ? "access.membership.restore" : "access.membership.update",
        `${membership.userId} membership in ${membership.teamId} ${restored ? "restored" : "updated"} as ${membership.roleLabel}.`,
      );
      return membership;
    }
    const membership: TeamMembership = {
      id: id("mship"),
      userId: command.userId,
      teamId: command.teamId,
      roleLabel: command.roleLabel,
      expiresAt: command.expiresAt,
      createdAt: nowIso(),
    };
    this.memberships.set(membership.id, membership);
    this.addEvent(actor, "access.membership.create", `${membership.userId} added to ${membership.teamId}.`);
    return membership;
  }

  async createGrant(command: CreateAccessGrantCommand, actor = "admin:prototype") {
    const grant: AccessGrant = {
      id: id("grant"),
      targetType: command.targetType,
      targetId: command.targetId,
      role: command.role,
      scopeKind: command.scopeKind,
      scopeValue: command.scopeValue,
      protectedAccess: command.protectedAccess ?? false,
      reporterIdentity: command.reporterIdentity ?? false,
      actions: command.actions ?? [],
      expiresAt: command.expiresAt,
      createdAt: nowIso(),
    };
    this.grants.set(grant.id, grant);
    this.addEvent(actor, "access.grant.create", `${grant.role} granted to ${grant.targetType}:${grant.targetId} for ${grant.scopeKind}:${grant.scopeValue}.`);
    return grant;
  }

  async updateUser(userId: string, command: UpdateAccessUserCommand, actor = "admin:prototype") {
    const current = this.users.get(userId);
    if (!current) return null;
    const user: AccessUser = {
      ...current,
      status: command.status ?? current.status,
      mfaState: command.mfaState ?? current.mfaState,
    };
    this.users.set(user.id, user);
    this.addEvent(actor, "access.user.update", `${user.displayName} set to ${user.status}; MFA ${user.mfaState}.`);
    return user;
  }

  async updateTeam(teamId: string, command: UpdateAccessTeamCommand, actor = "admin:prototype") {
    const current = this.teams.get(teamId);
    if (!current) return null;
    const team: AccessTeam = {
      ...current,
      status: command.status ?? current.status,
      ownerActorKey: command.ownerActorKey ?? current.ownerActorKey,
      defaultScopeKind: command.defaultScopeKind ?? current.defaultScopeKind,
      defaultScopeValue: command.defaultScopeValue ?? current.defaultScopeValue,
    };
    this.teams.set(team.id, team);
    this.addEvent(
      actor,
      "access.team.update",
      `${team.name} set to ${team.status} for ${team.defaultScopeKind}:${team.defaultScopeValue}; owner=${team.ownerActorKey}.`,
    );
    return team;
  }

  async updateMembership(membershipId: string, command: UpdateTeamMembershipCommand, actor = "admin:prototype") {
    const current = this.memberships.get(membershipId);
    if (!current) return null;
    const membership: TeamMembership = {
      ...current,
      roleLabel: command.roleLabel ?? current.roleLabel,
      expiresAt: Object.hasOwn(command, "expiresAt") ? (command.expiresAt ?? undefined) : current.expiresAt,
    };
    this.memberships.set(membership.id, membership);
    this.addEvent(
      actor,
      "access.membership.update",
      `${membership.userId} membership in ${membership.teamId} set to role=${membership.roleLabel}; expires=${membership.expiresAt ?? "none"}.`,
    );
    return membership;
  }

  async updateGrant(grantId: string, command: UpdateAccessGrantCommand, actor = "admin:prototype") {
    const current = this.grants.get(grantId);
    if (!current) return null;
    const grant: AccessGrant = {
      ...current,
      protectedAccess: command.protectedAccess ?? current.protectedAccess,
      reporterIdentity: command.reporterIdentity ?? current.reporterIdentity,
      expiresAt: Object.hasOwn(command, "expiresAt") ? (command.expiresAt ?? undefined) : current.expiresAt,
    };
    this.grants.set(grant.id, grant);
    this.addEvent(
      actor,
      "access.grant.update",
      `${grant.role} grant ${grant.id} visibility updated; protected=${grant.protectedAccess}; reporter=${grant.reporterIdentity}; expires=${grant.expiresAt ?? "none"}.`,
    );
    return grant;
  }

  async getEffectiveAccess(actorKey: string): Promise<EffectiveAccess> {
    const user = [...this.users.values()].find((item) => item.actorKey === actorKey && item.status === "active") ?? null;
    if (!user) return emptyEffectiveAccess(actorKey);

    const memberships = [...this.memberships.values()].filter((membership) => membership.userId === user.id && !isExpired(membership.expiresAt));
    const teams = memberships
      .map((membership) => this.teams.get(membership.teamId))
      .filter((team): team is AccessTeam => Boolean(team && team.status === "active"));
    const teamIds = new Set(teams.map((team) => team.id));
    const grants: EffectiveAccessGrant[] = [...this.grants.values()]
      .filter((grant) => !isExpired(grant.expiresAt))
      .filter((grant) => (grant.targetType === "user" && grant.targetId === user.id) || (grant.targetType === "team" && teamIds.has(grant.targetId)))
      .map((grant) => ({
        ...grant,
        actions: [...grant.actions],
        source: grant.targetType === "user" ? "direct" : "team",
        sourceLabel: grant.targetType === "user" ? user.displayName : this.teams.get(grant.targetId)?.name ?? grant.targetId,
      }));

    return {
      actor: actorKey,
      user,
      teams,
      grants,
      roles: [...new Set(grants.map((grant) => grant.role))],
      protectedAccess: grants.some((grant) => grant.protectedAccess),
      reporterIdentity: grants.some((grant) => grant.reporterIdentity),
      actions: [...new Set(grants.flatMap((grant) => grant.actions))],
    };
  }

  async close() {
    return;
  }

  private addEvent(actor: string, action: string, summary: string) {
    this.reviewEvents.unshift({
      id: id("access_review"),
      actor,
      action,
      summary,
      createdAt: nowIso(),
    });
  }
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
