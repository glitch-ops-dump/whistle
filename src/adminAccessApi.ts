import { officialAuthHeaders } from "./officialAuthClient";

export type AccessRole = "admin" | "cm_cell" | "minister" | "department_officer" | "mla" | "councillor" | "verification" | "worker";

export type AccessScopeKind = "state" | "district" | "constituency" | "ward" | "ministry" | "protected" | "queue" | "system";

export type AccessUser = {
  id: string;
  actorKey: string;
  displayName: string;
  status: "active" | "inactive";
  mfaState: "not_required_mvp" | "pending" | "enabled";
  createdAt: string;
};

export type AccessTeam = {
  id: string;
  name: string;
  role: AccessRole;
  status: "active" | "inactive";
  ownerActorKey: string;
  defaultScopeKind: AccessScopeKind;
  defaultScopeValue: string;
  createdAt: string;
};

export type TeamMembership = {
  id: string;
  userId: string;
  teamId: string;
  roleLabel: string;
  expiresAt?: string;
  createdAt: string;
};

export type AccessGrant = {
  id: string;
  targetType: "user" | "team";
  targetId: string;
  role: AccessRole;
  scopeKind: AccessScopeKind;
  scopeValue: string;
  protectedAccess: boolean;
  reporterIdentity: boolean;
  actions: string[];
  expiresAt?: string;
  createdAt: string;
};

export type AccessReviewEvent = {
  id: string;
  actor: string;
  action: string;
  summary: string;
  createdAt: string;
};

export type EffectiveAccessGrant = AccessGrant & {
  source: "direct" | "team";
  sourceLabel: string;
};

export type EffectiveAccess = {
  actor: string;
  user: AccessUser | null;
  teams: AccessTeam[];
  grants: EffectiveAccessGrant[];
  roles: AccessRole[];
  protectedAccess: boolean;
  reporterIdentity: boolean;
  actions: string[];
};

export type AccessSnapshot = {
  users: AccessUser[];
  teams: AccessTeam[];
  memberships: TeamMembership[];
  grants: AccessGrant[];
  reviewEvents: AccessReviewEvent[];
};

export type AdminAccessPayload = {
  mode: string;
  access: AccessSnapshot;
};

export type CreateAccessUserCommand = {
  actorKey: string;
  displayName: string;
  status?: AccessUser["status"];
  mfaState?: AccessUser["mfaState"];
};

export type CreateAccessTeamCommand = {
  name: string;
  role: AccessRole;
  ownerActorKey: string;
  defaultScopeKind: AccessScopeKind;
  defaultScopeValue: string;
};

export type CreateTeamMembershipCommand = {
  userId: string;
  teamId: string;
  roleLabel: string;
  expiresAt?: string;
};

export type CreateAccessGrantCommand = {
  targetType: AccessGrant["targetType"];
  targetId: string;
  role: AccessRole;
  scopeKind: AccessScopeKind;
  scopeValue: string;
  protectedAccess?: boolean;
  reporterIdentity?: boolean;
  actions?: string[];
  expiresAt?: string;
};

export type UpdateAccessUserCommand = {
  status?: AccessUser["status"];
  mfaState?: AccessUser["mfaState"];
};

export type UpdateAccessGrantCommand = {
  protectedAccess?: boolean;
  reporterIdentity?: boolean;
  expiresAt?: string | null;
};

export type UpdateAccessTeamCommand = {
  status?: AccessTeam["status"];
  ownerActorKey?: string;
  defaultScopeKind?: AccessScopeKind;
  defaultScopeValue?: string;
};

export type UpdateTeamMembershipCommand = {
  roleLabel?: string;
  expiresAt?: string | null;
};

const apiBase = import.meta.env.VITE_WHISTLE_API_BASE ?? "http://localhost:3001";

const adminAuth = { role: "admin", actor: "admin:prototype" };

const adminHeaders = () => officialAuthHeaders(adminAuth);
const adminJsonHeaders = () => officialAuthHeaders(adminAuth, { json: true });

async function parseResponse<T>(response: Response) {
  if (!response.ok) throw new Error(`Admin access API failed (${response.status})`);
  return (await response.json()) as T;
}

export async function fetchAdminAccess(signal?: AbortSignal) {
  return parseResponse<AdminAccessPayload>(await fetch(`${apiBase}/api/admin/access`, { credentials: "include", signal, headers: adminHeaders() }));
}

export async function fetchEffectiveAccess(actor: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ actor });
  return parseResponse<{ effectiveAccess: EffectiveAccess }>(
    await fetch(`${apiBase}/api/admin/access/effective?${params.toString()}`, { credentials: "include", signal, headers: adminHeaders() }),
  );
}

export async function createAccessUser(command: CreateAccessUserCommand) {
  return parseResponse<{ user: AccessUser }>(
    await fetch(`${apiBase}/api/admin/access/users`, {
      method: "POST",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(command),
    }),
  );
}

export async function createAccessTeam(command: CreateAccessTeamCommand) {
  return parseResponse<{ team: AccessTeam }>(
    await fetch(`${apiBase}/api/admin/access/teams`, {
      method: "POST",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(command),
    }),
  );
}

export async function updateAccessTeam(teamId: string, command: UpdateAccessTeamCommand) {
  return parseResponse<{ team: AccessTeam }>(
    await fetch(`${apiBase}/api/admin/access/teams/${encodeURIComponent(teamId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(command),
    }),
  );
}

export async function createTeamMembership(command: CreateTeamMembershipCommand) {
  return parseResponse<{ membership: TeamMembership }>(
    await fetch(`${apiBase}/api/admin/access/memberships`, {
      method: "POST",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(command),
    }),
  );
}

export async function updateTeamMembership(membershipId: string, command: UpdateTeamMembershipCommand) {
  return parseResponse<{ membership: TeamMembership }>(
    await fetch(`${apiBase}/api/admin/access/memberships/${encodeURIComponent(membershipId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(command),
    }),
  );
}

export async function createAccessGrant(command: CreateAccessGrantCommand) {
  return parseResponse<{ grant: AccessGrant }>(
    await fetch(`${apiBase}/api/admin/access/grants`, {
      method: "POST",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(command),
    }),
  );
}

export async function updateAccessUser(userId: string, command: UpdateAccessUserCommand) {
  return parseResponse<{ user: AccessUser }>(
    await fetch(`${apiBase}/api/admin/access/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(command),
    }),
  );
}

export async function updateAccessGrant(grantId: string, command: UpdateAccessGrantCommand) {
  return parseResponse<{ grant: AccessGrant }>(
    await fetch(`${apiBase}/api/admin/access/grants/${encodeURIComponent(grantId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminJsonHeaders(),
      body: JSON.stringify(command),
    }),
  );
}
