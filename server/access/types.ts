import type { GovRole } from "../ticket-spine/types.js";

export type AccessRole = GovRole | "worker";

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
