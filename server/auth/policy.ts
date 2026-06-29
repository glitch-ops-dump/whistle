import type { FastifyRequest } from "fastify";
import type { AccessScopeKind, EffectiveAccess, EffectiveAccessGrant } from "../access/types.js";
import type { DashboardFilter, EvidenceAccessRole, GovRole, TicketRecord, VerificationDecisionCommand } from "../ticket-spine/types.js";
import { officialAuthDisabledReason, officialAuthMode, prototypeOfficialAuthEnabled, verifyOfficialAuthRequest } from "./officialAuth.js";

export type AuthRole = GovRole | "citizen" | "worker";

export type AuthContext = {
  role: AuthRole;
  actor: string;
  source: "header" | "prototype-default" | "oidc" | "account-session";
  invalidRole?: string;
  officialAuthDisabled?: boolean;
  officialAuthFailure?: string;
};

type AuthDecision = {
  allowed: boolean;
  reason?: string;
};

export type AccessScopeRequirement = {
  kind: AccessScopeKind;
  value?: string;
};

const authRoles: readonly AuthRole[] = ["citizen", "worker", "cm_cell", "minister", "department_officer", "mla", "councillor", "verification", "admin"];

function headerValue(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function isAuthRole(value: string): value is AuthRole {
  return authRoles.includes(value as AuthRole);
}

function allow() {
  return { allowed: true } satisfies AuthDecision;
}

function deny(reason: string) {
  return { allowed: false, reason } satisfies AuthDecision;
}

function requestedOfficialRole(request: FastifyRequest, defaultRole: AuthRole) {
  const roleHeader = headerValue(request, "x-whistle-role")?.trim();
  if (roleHeader && !isAuthRole(roleHeader)) return { invalidRole: roleHeader };
  const role: AuthRole = roleHeader && isAuthRole(roleHeader) ? roleHeader : defaultRole;
  return { role };
}

export async function authContextFromRequest(request: FastifyRequest, defaultRole: AuthRole): Promise<AuthContext> {
  const roleHeader = headerValue(request, "x-whistle-role")?.trim();
  const actorHeader = headerValue(request, "x-whistle-actor")?.trim();
  if (roleHeader && !isAuthRole(roleHeader)) {
    return {
      role: defaultRole,
      actor: actorHeader || `${defaultRole}:prototype`,
      source: "header",
      invalidRole: roleHeader,
    };
  }

  const requested = requestedOfficialRole(request, defaultRole);
  const requestedRole = "role" in requested ? requested.role : defaultRole;
  if (officialAuthMode() === "oidc-jwt" && requestedRole !== "citizen" && requestedRole !== "worker") {
    const officialAuth = await verifyOfficialAuthRequest(request);
    if (!officialAuth.ok) {
      return {
        role: defaultRole,
        actor: actorHeader || `${defaultRole}:oidc`,
        source: "oidc",
        officialAuthFailure: officialAuth.reason,
      };
    }
    if (!isAuthRole(officialAuth.role) || officialAuth.role === "citizen" || officialAuth.role === "worker") {
      return {
        role: defaultRole,
        actor: officialAuth.actor,
        source: "oidc",
        invalidRole: officialAuth.role,
      };
    }
    return {
      role: officialAuth.role,
      actor: officialAuth.actor,
      source: "oidc",
    };
  }

  const role: AuthRole = roleHeader && isAuthRole(roleHeader) ? roleHeader : defaultRole;
  return {
    role,
    actor: actorHeader || `${role}:prototype`,
    source: roleHeader ? "header" : "prototype-default",
    officialAuthDisabled: role !== "citizen" && role !== "worker" && !prototypeOfficialAuthEnabled(),
  };
}

export function forbiddenPayload(auth: AuthContext, reason: string) {
  return {
    error: "forbidden",
    reason,
    role: auth.invalidRole ?? auth.role,
    actor: auth.actor,
  };
}

export function requireRoles(auth: AuthContext, roles: readonly AuthRole[], action: string): AuthDecision {
  if (auth.invalidRole) return deny(`Unknown Whistle role '${auth.invalidRole}'.`);
  if (auth.officialAuthFailure) return deny(auth.officialAuthFailure);
  if (auth.officialAuthDisabled) return deny(officialAuthDisabledReason);
  if (!roles.includes(auth.role)) return deny(`${auth.role} cannot perform ${action}.`);
  return allow();
}

function normalise(value: string) {
  return value.trim().toLowerCase();
}

function scopeMatches(grant: EffectiveAccessGrant, scope?: AccessScopeRequirement) {
  if (!scope) return true;
  if (grant.scopeKind === "state" && normalise(grant.scopeValue) === "tamil nadu") return true;
  if (grant.scopeKind === "system" && scope.kind === "system") return true;
  if (grant.scopeKind !== scope.kind) return false;
  if (!scope.value) return true;
  return normalise(grant.scopeValue) === normalise(scope.value);
}

export function authorizeGrantAccess(auth: AuthContext, effectiveAccess: EffectiveAccess, action: string, scope?: AccessScopeRequirement): AuthDecision {
  if (auth.invalidRole) return deny(`Unknown Whistle role '${auth.invalidRole}'.`);
  if (auth.officialAuthFailure) return deny(auth.officialAuthFailure);
  if (auth.officialAuthDisabled) return deny(officialAuthDisabledReason);
  if (auth.source === "prototype-default" || auth.role === "citizen") return allow();
  if (!effectiveAccess.user) return deny(`${auth.actor} has no active Whistle access user.`);

  const grant = effectiveAccess.grants.find((item) => item.role === auth.role && item.actions.includes(action) && scopeMatches(item, scope));
  if (!grant) {
    const scopeText = scope ? ` for ${scope.kind}:${scope.value ?? "*"}` : "";
    return deny(`${auth.actor} does not have ${auth.role} grant for ${action}${scopeText}.`);
  }
  return allow();
}

export function authorizeTicketRead(auth: AuthContext, ticket: TicketRecord): AuthDecision {
  const baseDecision = requireRoles(auth, ["citizen", "verification", "cm_cell", "minister", "department_officer", "mla", "councillor", "admin"], "ticket.read");
  if (!baseDecision.allowed) return baseDecision;
  if (ticket.protected && !["citizen", "verification", "cm_cell", "admin"].includes(auth.role)) {
    return deny("Protected tickets are hidden from local, MLA, department officer, and minister roles until authorized screening.");
  }
  return allow();
}

export function authorizeDashboardRead(auth: AuthContext, filter: DashboardFilter): AuthDecision {
  const baseDecision = requireRoles(auth, ["cm_cell", "minister", "department_officer", "mla", "councillor", "verification"], "dashboard.read");
  if (!baseDecision.allowed) return baseDecision;
  if (auth.role !== filter.role) return deny(`${auth.role} cannot request a ${filter.role} dashboard.`);
  return allow();
}

export function authorizeEvidenceAccess(auth: AuthContext, queryRole: EvidenceAccessRole): AuthDecision {
  const baseDecision = requireRoles(auth, ["citizen", "verification", "cm_cell", "minister", "department_officer", "mla", "councillor", "admin"], "evidence.read");
  if (!baseDecision.allowed) return baseDecision;
  if (auth.role !== queryRole) return deny(`${auth.role} cannot request evidence as ${queryRole}.`);
  return allow();
}

export function authorizeVerificationDecision(auth: AuthContext, command: VerificationDecisionCommand): AuthDecision {
  const baseDecision = requireRoles(auth, ["verification"], "verification.decision");
  if (!baseDecision.allowed) return baseDecision;
  if (command.action === "route_protected" || command.action === "reject" || command.action === "request_info" || command.action === "route_local") return allow();
  return deny("Unsupported verification decision.");
}
