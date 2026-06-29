import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { ZodError } from "zod";
import {
  authContextFromRequest as baseAuthContextFromRequest,
  authorizeGrantAccess,
  authorizeDashboardRead,
  authorizeEvidenceAccess,
  authorizeTicketRead,
  authorizeVerificationDecision,
  forbiddenPayload,
  requireRoles,
  type AccessScopeRequirement,
  type AuthContext,
} from "./auth/policy.js";
import { officialAuthHealthCheck, officialAuthMode } from "./auth/officialAuth.js";
import { governmentPasswordAuthDisabledMessage, governmentPasswordAuthEnabled, governmentPasswordAuthModeFromEnv } from "./auth/governmentPasswordAuth.js";
import { createLocalUatOfficialToken, localUatOfficialTokenBootstrapEnabled } from "./auth/localUatToken.js";
import { authorizeWorkerRequest, workerAuthHealthCheck, workerAuthMode } from "./auth/workerAuth.js";
import { createAccountRepository, governmentUatDemoAccounts, type AccountRole, type WhistleSession } from "./account/repository.js";
import { changePasswordSchema, citizenRegisterSchema, loginSchema, logoutSchema, resetPasswordSchema } from "./account/schemas.js";
import { publicAssetPolicyFromConfig } from "./config/assetPolicy.js";
import { createAccessRepository } from "./access/repository.js";
import {
  createAccessGrantSchema,
  createAccessTeamSchema,
  createAccessUserSchema,
  createTeamMembershipSchema,
  effectiveAccessQuerySchema,
  updateAccessGrantSchema,
  updateAccessTeamSchema,
  updateAccessUserSchema,
  updateTeamMembershipSchema,
} from "./access/schemas.js";
import { citizenCategoryAvailability, citizenCategoryReadinessRejection, findCategoryConfig, lifecyclePolicyFromConfig } from "./config/lifecyclePolicy.js";
import { createDeploymentPreflightReport } from "./config/deploymentPreflight.js";
import { createMvp1LaunchHandoffReport } from "./config/launchHandoff.js";
import { createLaunchReadinessReport } from "./config/launchReadiness.js";
import { createMvpScopeReport } from "./config/mvpScope.js";
import { createConfigRepository } from "./config/repository.js";
import {
  auditExportQuerySchema,
  createConfigChangeRequestSchema,
  decideConfigChangeRequestSchema,
  patchAppControlSchema,
  patchCategoryReadinessSchema,
  patchCategorySchema,
  patchSlaPolicySchema,
} from "./config/schemas.js";
import { isCriticalConfigChange } from "./config/governance.js";
import type { AdminConfigSnapshot, AuditExportPackage, ConfigChangeTarget } from "./config/types.js";
import { createOtpDeliveryProvider } from "./citizen-verification/otpDelivery.js";
import { createPhoneVerificationRepository, phoneOtpStartSchema, phoneOtpVerifySchema } from "./citizen-verification/repository.js";
import { createEvidenceObjectStore } from "./evidence/objectStore.js";
import { createNotificationDeliveryProvider } from "./notifications/provider.js";
import { enterCorrelationContext, resolveCorrelationId } from "./observability/correlation.js";
import { InMemoryHttpMetrics } from "./observability/metrics.js";
import { safeErrorMessage, structuredRequestBase, type RequestLogSink, type StructuredRequestLog } from "./observability/requestLog.js";
import { createSecurityExportProvider, type SecurityExportStorageMode } from "./observability/securityExport.js";
import { createTelemetryExportProvider } from "./observability/telemetryExport.js";
import { openApiDocument } from "./openapi.js";
import { applyApiSecurityHeaders, corsOriginPolicyFromEnv } from "./security/httpHardening.js";
import { createPublicRateLimiter, publicRateLimitPolicyFromEnv, publicRateLimitRuleForRequest, sendRateLimitHeaders } from "./security/rateLimit.js";
import { isIntakeAgentEnabled } from "./ticket-spine/agentic.js";
import { createIntakeAgentRunViaGateway } from "./ticket-spine/agentGateway.js";
import { createDashboardBriefRun } from "./ticket-spine/dashboardBrief.js";
import { activeMinistryAssignment } from "./ticket-spine/dashboard.js";
import { citizenUpdateConflict, closureChecklistReady, evidenceUploadCompletionConflict, hashCitizenPhone, protectedAccessAudit } from "./ticket-spine/lifecycle.js";
import { createPublicInsights, isPublicInsightsEnabled } from "./ticket-spine/publicInsights.js";
import {
  cursorForAuditEvent,
  cursorForCitizenTicket,
  cursorForNotification,
  cursorForVerificationTicket,
  decodeTicketCursor,
  type TicketCursorKind,
} from "./ticket-spine/pagination.js";
import { createTicketRepository } from "./ticket-spine/repository.js";
import {
  citizenDisputeSchema,
  citizenTicketsQuerySchema,
  citizenUpdateSchema,
  createTicketSchema,
  dashboardFilterSchema,
  evidenceAccessQuerySchema,
  evidenceScanJobSchema,
  evidenceUploadCompletionSchema,
  fieldExecutionSchema,
  evidenceUploadSchema,
  localUatOfficialTokenSchema,
  notificationJobSchema,
  operationalLogQuerySchema,
  rejectionReviewDecisionSchema,
  slaJobSchema,
  verificationDecisionSchema,
  verificationQueueQuerySchema,
} from "./ticket-spine/schemas.js";
import type {
  CategoryId,
  DashboardFilter,
  EvidenceAccessQuery,
  EvidenceUploadCompletionCommand,
  FieldExecutionCommand,
  IdempotencyRecord,
  RejectionReviewDecisionCommand,
  SlaStage,
  TicketRecord,
  VerificationDecisionCommand,
} from "./ticket-spine/types.js";

function zodErrorPayload(error: ZodError) {
  return {
    error: "validation_error",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function redactTicketForApi(ticket: TicketRecord) {
  const { citizenPhoneHash: _citizenPhoneHash, ...safeTicket } = ticket;
  return safeTicket;
}

function redactTicketsForApi(tickets: TicketRecord[]) {
  return tickets.map(redactTicketForApi);
}

function requestHeader(request: FastifyRequest, name: string) {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

const accountSessionCookieName = "whistle_account_session";

function deploymentProfileValue() {
  return (process.env.WHISTLE_DEPLOYMENT_PROFILE || process.env.WHISTLE_ENV || process.env.NODE_ENV || "local").trim().toLowerCase();
}

function secureSessionCookieEnabled() {
  return !["", "local", "development", "dev"].includes(deploymentProfileValue());
}

function parseCookies(request: FastifyRequest) {
  const header = requestHeader(request, "cookie");
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function accountSessionCookieFromRequest(request: FastifyRequest) {
  return parseCookies(request).get(accountSessionCookieName)?.trim();
}

function accountSessionCookieAttributes(maxAgeSeconds: number) {
  return [
    `${accountSessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    secureSessionCookieEnabled() ? "Secure" : null,
  ].filter((item): item is string => Boolean(item));
}

function setAccountSessionCookie(reply: FastifyReply, session: WhistleSession) {
  const maxAgeSeconds = Math.max(1, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
  const attributes = accountSessionCookieAttributes(maxAgeSeconds);
  reply.header("set-cookie", `${attributes[0]}${encodeURIComponent(session.sessionToken)}; ${attributes.slice(1).join("; ")}`);
}

function clearAccountSessionCookie(reply: FastifyReply) {
  const attributes = accountSessionCookieAttributes(0);
  reply.header("set-cookie", `${attributes[0]}; ${attributes.slice(1).join("; ")}`);
}

function idempotencyKeyFromRequest(request: FastifyRequest) {
  const raw = requestHeader(request, "idempotency-key")?.trim();
  if (!raw) return { ok: true as const, key: null };
  if (raw.length < 8 || raw.length > 180) {
    return {
      ok: false as const,
      payload: {
        error: "invalid_idempotency_key",
        message: "Idempotency-Key must be between 8 and 180 characters.",
      },
    };
  }
  return { ok: true as const, key: raw };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function idempotencyRequestHash(action: string, payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify({ action, payload: canonicalValue(payload) }))
    .digest("hex");
}

function safeReadinessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 180);
}

const binaryEvidenceContentTypes = [
  "application/octet-stream",
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
];

type BuildWhistleApiOptions = {
  requestLogSink?: RequestLogSink;
};

function invalidCursorPayload(kind: TicketCursorKind) {
  return {
    error: "invalid_cursor",
    message: `The supplied cursor is not valid for ${kind} pagination.`,
  };
}

function pageTicketRows<T>(rows: T[], limit: number, offset: number, cursor: string | undefined, cursorForRow?: (row: T) => string) {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursorSource = items.at(-1);
  return {
    items,
    page: {
      limit,
      offset,
      cursor: cursor ?? null,
      returned: items.length,
      hasMore,
      nextOffset: !cursor && hasMore ? offset + limit : null,
      nextCursor: hasMore && nextCursorSource && cursorForRow ? cursorForRow(nextCursorSource) : null,
    },
  };
}

export function buildWhistleApi(options: BuildWhistleApiOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  app.addContentTypeParser(binaryEvidenceContentTypes, { parseAs: "buffer", bodyLimit: 50 * 1024 * 1024 }, (_request, body, done) => {
    done(null, body);
  });
  const repository = createTicketRepository();
  const configRepository = createConfigRepository();
  const accessRepository = createAccessRepository();
  const accountRepository = createAccountRepository();
  const otpDeliveryProvider = createOtpDeliveryProvider();
  const phoneVerificationRepository = createPhoneVerificationRepository(otpDeliveryProvider);
  const evidenceObjectStore = createEvidenceObjectStore();
  const notificationDeliveryProvider = createNotificationDeliveryProvider();
  const securityExportProvider = createSecurityExportProvider();
  const telemetryExportProvider = createTelemetryExportProvider();
  const publicRateLimiter = createPublicRateLimiter();
  const publicRateLimitPolicy = publicRateLimitPolicyFromEnv();
  const corsOriginPolicy = corsOriginPolicyFromEnv();
  const httpMetrics = new InMemoryHttpMetrics();
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  const requestCorrelationIds = new WeakMap<FastifyRequest, string>();

  function emitRequestLog(entry: StructuredRequestLog) {
    if (entry.event === "http_request_error") app.log.error(entry, entry.event);
    else app.log.info(entry, entry.event);
    options.requestLogSink?.(entry);
    void telemetryExportProvider.exportRequestSpan(entry).catch((error) => {
      app.log.warn({ error: safeReadinessError(error), correlationId: entry.correlationId }, "telemetry_export_span_failed");
    });
    void securityExportProvider.exportRequestLog(entry).catch((error) => {
      app.log.warn({ error: safeReadinessError(error), correlationId: entry.correlationId }, "security_export_log_failed");
    });
  }

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || corsOriginPolicy.mode === "allow-all-local") {
        callback(null, true);
        return;
      }
      callback(null, corsOriginPolicy.origins.includes(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
  });

  app.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, Date.now());
    const correlationId = resolveCorrelationId(requestHeader(request, "x-whistle-correlation-id") ?? requestHeader(request, "x-request-id"), `req-${request.id}`);
    requestCorrelationIds.set(request, correlationId);
    enterCorrelationContext(correlationId);
    reply.header("x-whistle-correlation-id", correlationId);
    applyApiSecurityHeaders(reply);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const startedAt = requestStartedAt.get(request) ?? Date.now();
    reply.header("x-whistle-duration-ms", String(Math.max(0, Date.now() - startedAt)));
    return payload;
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request) ?? Date.now();
    const correlationId = requestCorrelationIds.get(request) ?? `req-${request.id}`;
    const durationMs = Math.max(0, Date.now() - startedAt);
    const entry: StructuredRequestLog = {
      event: "http_request_completed",
      ...structuredRequestBase(request, correlationId, startedAt),
      statusCode: reply.statusCode,
      durationMs,
    };
    httpMetrics.observe(entry);
    emitRequestLog(entry);
  });

  app.addHook("onError", async (request, _reply, error) => {
    const startedAt = requestStartedAt.get(request) ?? Date.now();
    const correlationId = requestCorrelationIds.get(request) ?? `req-${request.id}`;
    emitRequestLog({
      event: "http_request_error",
      ...structuredRequestBase(request, correlationId, startedAt),
      errorName: error.name,
      errorMessage: safeErrorMessage(error),
    });
  });

  app.addHook("onClose", async () => {
    await repository.close();
    await configRepository.close();
    await accessRepository.close();
    await accountRepository.close();
    await phoneVerificationRepository.close();
    await publicRateLimiter.close?.();
  });

  app.addHook("preHandler", async (request, reply) => {
    const rule = publicRateLimitRuleForRequest(request, publicRateLimitPolicy);
    if (!rule) return;
    let decision;
    try {
      decision = await publicRateLimiter.check(rule);
    } catch (error) {
      return reply.code(503).send({
        error: "rate_limit_unavailable",
        message: "Public citizen rate limiting is unavailable. Please try again shortly.",
        rule: rule.id,
        detail: safeReadinessError(error),
      });
    }
    sendRateLimitHeaders(reply, decision);
    if (!decision.allowed) {
      return reply.code(429).send({
        error: "rate_limit_exceeded",
        message: "Too many public citizen requests. Please wait before trying again.",
        rule: rule.id,
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
  });

  async function enforceGrant(auth: AuthContext, action: string, scope?: AccessScopeRequirement) {
    return authorizeGrantAccess(auth, await accessRepository.getEffectiveAccess(auth.actor), action, scope);
  }

  async function enforceGrantOrReply(reply: FastifyReply, auth: AuthContext, action: string, scope?: AccessScopeRequirement) {
    const grantDecision = await enforceGrant(auth, action, scope);
    if (!grantDecision.allowed) {
      reply.code(403).send(forbiddenPayload(auth, grantDecision.reason ?? "Forbidden"));
      return false;
    }
    return true;
  }

  function enforceWorkerAuthOrReply(request: FastifyRequest, reply: FastifyReply, auth: AuthContext) {
    if (auth.role !== "worker") return true;
    const workerDecision = authorizeWorkerRequest(request);
    if (!workerDecision.allowed) {
      reply.code(403).send(forbiddenPayload(auth, workerDecision.reason ?? "Worker job authentication failed."));
      return false;
    }
    return true;
  }

  function dashboardScope(filter: DashboardFilter): AccessScopeRequirement | undefined {
    if (filter.role === "cm_cell") return { kind: "state", value: "Tamil Nadu" };
    if (filter.role === "verification") return { kind: "queue", value: "verification" };
    if (filter.role === "minister" || filter.role === "department_officer") return filter.ministry ? { kind: "ministry", value: filter.ministry } : { kind: "ministry" };
    if (filter.role === "mla") return filter.constituency ? { kind: "constituency", value: filter.constituency } : { kind: "constituency" };
    if (filter.role === "councillor") return filter.ward ? { kind: "ward", value: filter.ward } : { kind: "ward" };
    return undefined;
  }

  function dashboardExplainScope(auth: AuthContext, filter: DashboardFilter): AccessScopeRequirement | undefined {
    if (auth.role === "admin") return { kind: "system", value: "whistle" };
    return dashboardScope(filter);
  }

  function isCitizenPhoneOtpRequired(config: AdminConfigSnapshot) {
    return config.appControls.find((control) => control.id === "citizen-phone-otp-required")?.value !== false;
  }

  function isOfficialUserOtpRequired(config: AdminConfigSnapshot) {
    return config.appControls.find((control) => control.id === "official-user-otp-required")?.value === true;
  }

  function sessionTokenFromRequest(request: FastifyRequest) {
    return accountSessionCookieFromRequest(request) || requestHeader(request, "x-whistle-session-token")?.trim();
  }

  function governmentPasswordAuthDisabledPayload() {
    const mode = governmentPasswordAuthModeFromEnv();
    return {
      error: "government_password_auth_disabled",
      message: governmentPasswordAuthDisabledMessage(mode),
      mode,
    };
  }

  async function resolveAuthContext(request: FastifyRequest, defaultRole: AuthContext["role"]): Promise<AuthContext> {
    const token = sessionTokenFromRequest(request);
    if (token) {
      const session = await accountRepository.getSession(token);
      if (session?.surface === "citizen") {
        return {
          role: "citizen",
          actor: session.actor,
          source: "account-session",
        };
      }
      if (session?.surface === "government") {
        if (!governmentPasswordAuthEnabled()) {
          return {
            role: defaultRole,
            actor: session.actor,
            source: "account-session",
            officialAuthFailure: governmentPasswordAuthDisabledMessage(),
          };
        }
        const actorHeader = requestHeader(request, "x-whistle-actor")?.trim();
        const roleHeader = requestHeader(request, "x-whistle-role")?.trim();
        const requestedRole = (roleHeader || session.role || defaultRole) as AccountRole;
        if (actorHeader && actorHeader !== session.actor) {
          return {
            role: defaultRole,
            actor: actorHeader,
            source: "account-session",
            officialAuthFailure: "Session actor does not match the requested government console actor.",
          };
        }
        if (!session.roles.includes(requestedRole) || requestedRole === "citizen") {
          return {
            role: defaultRole,
            actor: session.actor,
            source: "account-session",
            officialAuthFailure: `This account session does not grant ${String(requestedRole)} access.`,
          };
        }
        return {
          role: requestedRole as AuthContext["role"],
          actor: session.actor,
          source: "account-session",
        };
      }
    }
    return baseAuthContextFromRequest(request, defaultRole);
  }

  async function authOtpRequired(surface: "citizen" | "government") {
    const config = await configRepository.getConfig();
    return surface === "citizen" ? isCitizenPhoneOtpRequired(config) : isOfficialUserOtpRequired(config);
  }

  function safeSession(session: Awaited<ReturnType<typeof accountRepository.getSession>>) {
    if (!session) return null;
    const { sessionToken: _sessionToken, phoneVerificationToken: _phoneVerificationToken, ...publicSession } = session;
    return {
      ...publicSession,
      sessionCookie: true,
      officialBearerStorageKey: undefined,
    };
  }

  function verificationDecisionConflict(ticket: TicketRecord, command: VerificationDecisionCommand) {
    if (!["verification", "protected_review"].includes(ticket.primaryQueue.kind)) {
      return {
        error: "ticket_not_in_intake",
        message: `${ticket.id} is already owned by ${ticket.primaryQueue.ownerLabel}; verification decisions are closed for this stage.`,
      };
    }
    if (ticket.status !== "submitted") {
      return {
        error: "ticket_not_decisionable",
        message: `${ticket.id} is ${ticket.status}; wait for the citizen or current owner before making another verification decision.`,
      };
    }
    if ((ticket.protected || ticket.primaryQueue.kind === "protected_review") && command.action === "route_local") {
      return {
        error: "protected_local_route_blocked",
        message: "Protected complaints cannot be routed to local/MLA visibility from the ordinary verification action.",
      };
    }
    return null;
  }

  function agentRunConflict(ticket: TicketRecord) {
    if (!["verification", "protected_review"].includes(ticket.primaryQueue.kind)) {
      return {
        error: "ticket_not_in_intake",
        message: `${ticket.id} is owned by ${ticket.primaryQueue.ownerLabel}; intake recommendations are only available in verification/protected intake.`,
      };
    }
    return null;
  }

  function rejectionReviewConflict(ticket: TicketRecord, command: RejectionReviewDecisionCommand) {
    if (ticket.primaryQueue.kind !== "rejection_review" || ticket.status !== "rejected") {
      return {
        error: "ticket_not_in_rejection_review",
        message: `${ticket.id} is currently with ${ticket.primaryQueue.ownerLabel}; rejection-review decisions are available only for rejected tickets in CM-maintained review.`,
      };
    }
    if (ticket.protected && command.action === "overturn_and_route") {
      return {
        error: "protected_rejection_route_blocked",
        message: "Protected complaints cannot be restored to local visibility through the ordinary rejection-review route action.",
      };
    }
    return null;
  }

  function fieldActionScope(auth: AuthContext, ticket: TicketRecord): AccessScopeRequirement | null | undefined {
    if (auth.role === "cm_cell") return { kind: "state", value: "Tamil Nadu" };
    if (auth.role === "minister" || auth.role === "department_officer") {
      const ministryQueue = activeMinistryAssignment(ticket);
      return ministryQueue ? { kind: "ministry", value: ministryQueue.scope.value } : null;
    }
    if (auth.role === "mla") {
      const queue = [ticket.primaryQueue, ...ticket.secondaryQueues].find((item) => item.kind === "mla" || item.kind === "local");
      return queue ? { kind: "constituency", value: queue.scope.value } : null;
    }
    if (auth.role === "councillor") {
      const queue = [ticket.primaryQueue, ...ticket.secondaryQueues].find((item) => item.kind === "local");
      return queue ? { kind: "ward", value: queue.scope.value } : null;
    }
    return undefined;
  }

  function operationalTicketScope(auth: AuthContext, ticket: TicketRecord): AccessScopeRequirement | null | undefined {
    if (auth.role === "admin") return { kind: "system", value: "whistle" };
    if (auth.role === "verification") return { kind: "queue", value: "verification" };
    return fieldActionScope(auth, ticket);
  }

  function hasVerificationReadScope(ticket: TicketRecord) {
    return [ticket.primaryQueue, ...ticket.secondaryQueues].some((queue) => ["verification", "protected_review", "rejection_review"].includes(queue.kind));
  }

  function scopedTicketReadRequirement(auth: AuthContext, ticket: TicketRecord): AccessScopeRequirement | null | undefined {
    if (auth.role === "verification" && !hasVerificationReadScope(ticket)) return null;
    return operationalTicketScope(auth, ticket);
  }

  async function enforceScopedTicketReadOrReply(reply: FastifyReply, auth: AuthContext, ticket: TicketRecord, action = "ticket.read") {
    const scope = scopedTicketReadRequirement(auth, ticket);
    if (scope === null) {
      const reason =
        auth.role === "verification"
          ? "Verification can read only tickets visible through verification/review queues or retained secondary verification visibility."
          : `${auth.role} can read only tickets with an active assignment matching that role scope.`;
      reply.code(403).send(
        forbiddenPayload(
          auth,
          reason,
        ),
      );
      return false;
    }
    return enforceGrantOrReply(reply, auth, action, scope);
  }

  function protectedAccessReasonFromRequest(request: FastifyRequest, queryReason?: string) {
    return (requestHeader(request, "x-whistle-access-reason") ?? queryReason ?? "").trim();
  }

  function protectedAccessReasonOrReply(request: FastifyRequest, reply: FastifyReply, ticket: TicketRecord, queryReason?: string) {
    if (!ticket.protected) return "";
    const reason = protectedAccessReasonFromRequest(request, queryReason);
    if (reason.length < 8 || reason.length > 240) {
      reply.code(400).send({
        error: "protected_access_reason_required",
        message: "Protected complaint access requires x-whistle-access-reason between 8 and 240 characters.",
      });
      return null;
    }
    return reason;
  }

  async function recordProtectedAccess(ticket: TicketRecord, auth: AuthContext, action: string, reason: string) {
    if (!ticket.protected || auth.role === "citizen") return;
    await repository.recordAuditEvents([
      protectedAccessAudit(ticket, action, "access", ticket.id, auth.actor, auth.role, reason),
    ]);
  }

  async function enforceCitizenTicketOwnership(request: FastifyRequest, reply: FastifyReply, auth: AuthContext, ticket: TicketRecord) {
    if (auth.role !== "citizen") return true;
    if (auth.source === "account-session") {
      const token = sessionTokenFromRequest(request);
      const session = token ? await accountRepository.getSession(token) : null;
      if (!session || session.surface !== "citizen") {
        reply.code(401).send({
          error: "citizen_ticket_verification_required",
          message: "Sign in again before opening or changing this complaint.",
        });
        return false;
      }
      if (hashCitizenPhone(session.phone) !== ticket.citizenPhoneHash) {
        reply.code(403).send({
          error: "citizen_ticket_owner_mismatch",
          message: "The signed-in citizen account is not linked to this ticket.",
        });
        return false;
      }
      return true;
    }
    const phone = requestHeader(request, "x-whistle-citizen-phone")?.trim();
    const verificationToken = requestHeader(request, "x-whistle-citizen-token")?.trim();
    if (!phone || !verificationToken) {
      reply.code(401).send({
        error: "citizen_ticket_verification_required",
        message: "Verify the ticket phone number before opening or changing this complaint.",
      });
      return false;
    }
    const validation = await phoneVerificationRepository.validateToken(verificationToken, phone);
    if (!validation.ok) {
      reply.code(validation.status).send({
        error: validation.error,
        message: validation.message,
      });
      return false;
    }
    if (hashCitizenPhone(phone) !== ticket.citizenPhoneHash) {
      reply.code(403).send({
        error: "citizen_ticket_owner_mismatch",
        message: "The verified phone number is not linked to this ticket.",
      });
      return false;
    }
    return true;
  }

  function fieldActionConflict(auth: AuthContext, ticket: TicketRecord, command: FieldExecutionCommand) {
    if (["submitted", "needs_info", "rejected"].includes(ticket.status) || ["citizen", "verification", "protected_review", "rejection_review"].includes(ticket.primaryQueue.kind)) {
      return {
        error: "ticket_not_field_actionable",
        message: `${ticket.id} is currently with ${ticket.primaryQueue.ownerLabel}; field execution starts after routing to an accountable owner.`,
      };
    }
    const visibleQueues = [ticket.primaryQueue, ...ticket.secondaryQueues];
    const roleCanAct =
      auth.role === "cm_cell" ||
      (["minister", "department_officer"].includes(auth.role) && Boolean(activeMinistryAssignment(ticket))) ||
      (auth.role === "mla" && visibleQueues.some((queue) => ["local", "mla"].includes(queue.kind))) ||
      (auth.role === "councillor" && visibleQueues.some((queue) => queue.kind === "local"));
    if (!roleCanAct) {
      return {
        error: "ticket_not_in_role_execution_queue",
        message: `${auth.role} can act only when the ticket is in that role's primary or secondary execution queue.`,
      };
    }
    if (["resolved", "closed"].includes(ticket.status)) {
      return {
        error: "ticket_already_resolved",
        message: `${ticket.id} is already ${ticket.status}; citizens can reopen/dispute instead of field owners editing closure.`,
      };
    }
    if (command.action === "resolve" && !closureChecklistReady(command.checklist)) {
      return {
        error: "closure_checklist_incomplete",
        message: "Resolution requires field visit, evidence, citizen impact check, and safety-risk closure confirmations.",
      };
    }
    return null;
  }

  function citizenDisputeConflict(ticket: TicketRecord) {
    if (ticket.status !== "resolved") {
      return {
        error: "ticket_not_resolved",
        message: "Citizens can reopen/dispute only after a government owner marks the ticket resolved.",
      };
    }
    return null;
  }

  async function criticalConfigConflict(target: ConfigChangeTarget) {
    const config = await configRepository.getConfig();
    if (!isCriticalConfigChange(config, target)) return null;
    return {
      error: "critical_config_requires_approval",
      message: "This critical Admin configuration change must be proposed and approved by a second Admin before it is applied.",
      target,
      proposalPath: "/api/admin/governance/config-change-requests",
    };
  }

  function auditExportPackage(
    requestedBy: string,
    auditEventsCount: number,
    configChangeRequestsCount: number,
    sensitiveAuditEvents: number,
    productionStorage: SecurityExportStorageMode,
    ticketId?: string,
  ): AuditExportPackage {
    return {
      id: `audit_export_${Date.now().toString(36)}`,
      generatedAt: new Date().toISOString(),
      requestedBy,
      ticketId,
      format: "json",
      source: "whistle-ticket-spine",
      counts: {
        auditEvents: auditEventsCount,
        configChangeRequests: configChangeRequestsCount,
        sensitiveAuditEvents,
      },
      controls: {
        redaction: "metadata_only_for_sensitive_records",
        includesConfigApprovals: true,
        includesTicketAudit: true,
        productionStorage,
      },
    };
  }

  async function resolveExistingTicketIdempotency(
    existingRecord: IdempotencyRecord,
    action: IdempotencyRecord["action"],
    requestHash: string,
    reuseMessage: string,
  ) {
    if (existingRecord.action !== action || existingRecord.requestHash !== requestHash) {
      return {
        ok: false as const,
        status: 409,
        payload: {
          error: "idempotency_key_reused",
          message: reuseMessage,
        },
      };
    }
    if (!existingRecord.responseTicketId) {
      return {
        ok: false as const,
        status: 409,
        payload: {
          error: "idempotency_request_in_progress",
          message: "This Idempotency-Key is already reserved for an in-progress request. Retry with the same payload after the first request finishes.",
        },
      };
    }
    const ticket = await repository.getTicket(existingRecord.responseTicketId);
    if (!ticket) {
      return {
        ok: false as const,
        status: 409,
        payload: { error: "idempotency_target_missing" },
      };
    }
    return { ok: true as const, key: existingRecord.key, requestHash, ticket };
  }

  async function checkTicketIdempotency(
    request: FastifyRequest,
    action: IdempotencyRecord["action"],
    scope: string,
    payload: unknown,
    reuseMessage: string,
  ) {
    const idempotency = idempotencyKeyFromRequest(request);
    if (!idempotency.ok) return { ok: false as const, status: 400, payload: idempotency.payload };
    const requestHash = idempotencyRequestHash(action, payload);
    if (!idempotency.key) return { ok: true as const, key: null, requestHash, ticket: null };

    const existingRecord = await repository.getIdempotencyRecord(scope, idempotency.key);
    if (!existingRecord) return { ok: true as const, key: idempotency.key, requestHash, ticket: null };
    return resolveExistingTicketIdempotency(existingRecord, action, requestHash, reuseMessage);
  }

  async function reserveTicketIdempotency(scope: string, key: string | null, requestHash: string, action: IdempotencyRecord["action"], reuseMessage: string) {
    if (!key) return;
    const reservation = await repository.reserveIdempotencyRecord({
      scope,
      key,
      requestHash,
      action,
      createdAt: new Date().toISOString(),
    });
    if (reservation.inserted) return null;
    return resolveExistingTicketIdempotency(reservation.record, action, requestHash, reuseMessage);
  }

  async function saveTicketIdempotency(scope: string, key: string | null, requestHash: string, action: IdempotencyRecord["action"], ticket: TicketRecord) {
    if (!key) return;
    await repository.finalizeIdempotencyRecord({
      scope,
      key,
      requestHash,
      action,
      responseTicketId: ticket.id,
      createdAt: new Date().toISOString(),
    });
  }

  async function readinessProbe(name: string, mode: string, check: () => Promise<void>) {
    const startedAt = Date.now();
    try {
      await check();
      return {
        name,
        mode,
        ok: true,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        name,
        mode,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: safeReadinessError(error),
      };
    }
  }

  async function readinessReport() {
    const dependencies = await Promise.all([
      readinessProbe("ticket_spine", repository.mode, () => repository.healthCheck()),
      readinessProbe("official_auth", officialAuthMode(), async () => {
        if (officialAuthMode() === "prototype-disabled" && governmentPasswordAuthEnabled()) return;
        await officialAuthHealthCheck();
      }),
      readinessProbe("worker_auth", workerAuthMode(), () => workerAuthHealthCheck()),
      readinessProbe("admin_config", configRepository.mode, () => configRepository.healthCheck()),
      readinessProbe("access_control", accessRepository.mode, () => accessRepository.healthCheck()),
      readinessProbe("account_auth", accountRepository.mode, () => accountRepository.healthCheck()),
      readinessProbe("citizen_phone_verification", phoneVerificationRepository.mode, () => phoneVerificationRepository.healthCheck()),
      readinessProbe("citizen_otp_delivery", otpDeliveryProvider.mode, () => otpDeliveryProvider.healthCheck()),
      readinessProbe("evidence_object_store", evidenceObjectStore.mode, () => evidenceObjectStore.healthCheck()),
      readinessProbe("notification_delivery", notificationDeliveryProvider.mode, () => notificationDeliveryProvider.healthCheck()),
      readinessProbe("security_export", securityExportProvider.mode, () => securityExportProvider.healthCheck()),
      readinessProbe("telemetry_export", telemetryExportProvider.mode, () => telemetryExportProvider.healthCheck()),
      readinessProbe("public_rate_limit", publicRateLimiter.mode, () => publicRateLimiter.healthCheck()),
    ]);
    return {
      ok: dependencies.every((dependency) => dependency.ok),
      service: "whistle-ticket-spine",
      time: new Date().toISOString(),
      dependencies,
    };
  }

  function deploymentPreflightReport() {
    return createDeploymentPreflightReport({
      ticketSpineMode: repository.mode,
      configMode: configRepository.mode,
      accessMode: accessRepository.mode,
      phoneVerificationMode: phoneVerificationRepository.mode,
      officialAuthMode: officialAuthMode(),
      workerAuthMode: workerAuthMode(),
      otpDeliveryMode: otpDeliveryProvider.mode,
      otpExposesOtpToApi: otpDeliveryProvider.exposesOtpToApi,
      evidenceObjectStoreMode: evidenceObjectStore.mode,
      notificationDeliveryMode: notificationDeliveryProvider.mode,
      securityExportMode: securityExportProvider.mode,
      telemetryExportMode: telemetryExportProvider.mode,
      publicRateLimitEnabled: publicRateLimitPolicy.enabled,
      publicRateLimitBackend: publicRateLimiter.mode,
      corsOriginMode: corsOriginPolicy.mode === "allow-list" ? `allow-list:${corsOriginPolicy.origins.length}` : corsOriginPolicy.mode,
      securityHeadersEnabled: process.env.WHISTLE_SECURITY_HEADERS_ENABLED !== "false",
      databaseUrlConfigured: Boolean(process.env.DATABASE_URL?.trim()),
      governmentPasswordAuthMode: governmentPasswordAuthModeFromEnv(),
    });
  }

  app.get("/api/health", async () => ({
    ok: true,
    service: "whistle-ticket-spine",
    mode: repository.mode,
    time: new Date().toISOString(),
  }));

  app.post("/api/local-uat/official-token", async (request, reply) => {
    if (!localUatOfficialTokenBootstrapEnabled()) {
      return reply.code(404).send({ error: "not_found" });
    }
    const parsed = localUatOfficialTokenSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const token = await createLocalUatOfficialToken(parsed.data);
    return {
      kind: "whistle-local-uat-official-token",
      actor: parsed.data.actor,
      role: parsed.data.role,
      storageKey: `whistle.officialBearerToken.${parsed.data.actor}`,
      expiresIn: "2h",
      token,
    };
  });

  app.get("/api/auth/config", async () => {
    const config = await configRepository.getConfig();
    return {
      controls: {
        citizenOtpRequired: isCitizenPhoneOtpRequired(config),
        governmentOtpRequired: isOfficialUserOtpRequired(config),
      },
      demo: {
        governmentAccounts: governmentPasswordAuthEnabled() && localUatOfficialTokenBootstrapEnabled() ? governmentUatDemoAccounts() : [],
      },
    };
  });

  app.post("/api/auth/otp/start", async (request, reply) => {
    const parsed = phoneOtpStartSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    try {
      const challenge = await phoneVerificationRepository.startChallenge(parsed.data.phone, parsed.data.language);
      return reply.code(201).send({ challenge });
    } catch (error) {
      return reply.code(503).send({
        error: "auth_otp_delivery_unavailable",
        message: safeReadinessError(error),
      });
    }
  });

  app.post("/api/auth/otp/verify", async (request, reply) => {
    const parsed = phoneOtpVerifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const verification = await phoneVerificationRepository.verifyChallenge(parsed.data.challengeId, parsed.data.otp);
    if ("ok" in verification && !verification.ok) {
      return reply.code(verification.status).send({
        error: verification.error,
        message: verification.message,
      });
    }
    return { verification };
  });

  app.post("/api/auth/citizen/register", async (request, reply) => {
    const parsed = citizenRegisterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (await authOtpRequired("citizen")) {
      if (!parsed.data.phoneVerificationToken) {
        return reply.code(401).send({
          error: "phone_verification_required",
          message: "Verify the mobile number before creating a citizen account.",
        });
      }
      const verification = await phoneVerificationRepository.validateToken(parsed.data.phoneVerificationToken, parsed.data.phone);
      if (!verification.ok) {
        return reply.code(verification.status).send({ error: verification.error, message: verification.message });
      }
    }
    const account = await accountRepository.createCitizenAccount(parsed.data);
    const session = await accountRepository.createSession({
      account,
      role: "citizen",
      phoneVerificationToken: parsed.data.phoneVerificationToken,
    });
    setAccountSessionCookie(reply, session);
    return reply.code(201).send({ session: safeSession(session) });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (parsed.data.surface === "government" && !governmentPasswordAuthEnabled()) {
      return reply.code(403).send(governmentPasswordAuthDisabledPayload());
    }
    const account = await accountRepository.verifyPassword(parsed.data.phone, parsed.data.password, parsed.data.surface);
    if (!account) {
      return reply.code(401).send({
        error: "invalid_login",
        message: "Mobile number or password is incorrect.",
      });
    }
    const role: AccountRole = parsed.data.surface === "citizen" ? "citizen" : parsed.data.role ?? account.roles[0];
    if (!account.roles.includes(role)) {
      return reply.code(403).send({
        error: "role_not_allowed",
        message: "This account cannot open the requested Whistle console.",
      });
    }
    if (await authOtpRequired(parsed.data.surface)) {
      if (!parsed.data.phoneVerificationToken) {
        return reply.code(401).send({
          error: "otp_required",
          message: "OTP validation is required by Admin configuration.",
          otpRequired: true,
        });
      }
      const verification = await phoneVerificationRepository.validateToken(parsed.data.phoneVerificationToken, parsed.data.phone);
      if (!verification.ok) {
        return reply.code(verification.status).send({ error: verification.error, message: verification.message });
      }
    }
    const session = await accountRepository.createSession({
      account,
      role,
      phoneVerificationToken: parsed.data.phoneVerificationToken,
    });
    setAccountSessionCookie(reply, session);
    return { session: safeSession(session) };
  });

  app.get("/api/auth/me", async (request, reply) => {
    const token = sessionTokenFromRequest(request);
    if (!token) return reply.code(401).send({ error: "session_required", message: "Sign in to continue." });
    const session = await accountRepository.getSession(token);
    if (!session) return reply.code(401).send({ error: "session_expired", message: "Session expired. Sign in again." });
    if (session.surface === "government" && !governmentPasswordAuthEnabled()) return reply.code(403).send(governmentPasswordAuthDisabledPayload());
    return { session: safeSession(session) };
  });

  app.post("/api/auth/password/change", async (request, reply) => {
    const token = sessionTokenFromRequest(request);
    if (!token) return reply.code(401).send({ error: "session_required", message: "Sign in to continue." });
    const session = await accountRepository.getSession(token);
    if (!session) return reply.code(401).send({ error: "session_expired", message: "Session expired. Sign in again." });
    if (session.surface === "government" && !governmentPasswordAuthEnabled()) return reply.code(403).send(governmentPasswordAuthDisabledPayload());
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const result = await accountRepository.changePassword(token, parsed.data.currentPassword, parsed.data.newPassword);
    if (!result.ok) return reply.code(result.status).send({ error: result.error, message: result.message });
    return { ok: true };
  });

  app.post("/api/auth/password/reset", async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (parsed.data.surface === "government" && !governmentPasswordAuthEnabled()) {
      return reply.code(403).send(governmentPasswordAuthDisabledPayload());
    }
    const verification = await phoneVerificationRepository.validateToken(parsed.data.phoneVerificationToken, parsed.data.phone);
    if (!verification.ok) {
      return reply.code(verification.status).send({
        error: verification.error,
        message: verification.message,
      });
    }
    const result = await accountRepository.resetPassword({
      surface: parsed.data.surface,
      phone: parsed.data.phone,
      newPassword: parsed.data.newPassword,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error, message: result.message });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const parsed = logoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const token = parsed.data.sessionToken ?? sessionTokenFromRequest(request);
    if (token) await accountRepository.deleteSession(token);
    clearAccountSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/ready", async (_request, reply) => {
    const report = await readinessReport();
    return reply.code(report.ok ? 200 : 503).send(report);
  });

  app.get("/api/metrics", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin", "cm_cell"], "observability.metrics.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const scope: AccessScopeRequirement = auth.role === "cm_cell" ? { kind: "state", value: "Tamil Nadu" } : { kind: "system", value: "whistle" };
    if (!(await enforceGrantOrReply(reply, auth, "observability.metrics.read", scope))) return;
    const snapshot = httpMetrics.snapshot();
    void telemetryExportProvider.exportMetricsSnapshot(snapshot).catch((error) => {
      app.log.warn({ error: safeReadinessError(error), actor: auth.actor }, "telemetry_export_metrics_failed");
    });
    return {
      metrics: snapshot,
    };
  });

  app.get("/api/admin/config", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.read", { kind: "system", value: "whistle" }))) return;
    return {
      mode: configRepository.mode,
      config: await configRepository.getConfig(),
    };
  });

  app.get("/api/admin/launch-readiness", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.read", { kind: "system", value: "whistle" }))) return;
    const [config, access, changeRequests] = await Promise.all([
      configRepository.getConfig(),
      accessRepository.getSnapshot(),
      configRepository.listConfigChangeRequests(),
    ]);
    return {
      mode: configRepository.mode,
      report: createLaunchReadinessReport(config, access, changeRequests, deploymentPreflightReport()),
    };
  });

  app.get("/api/admin/deployment-preflight", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.read", { kind: "system", value: "whistle" }))) return;
    return {
      report: deploymentPreflightReport(),
    };
  });

  app.get("/api/admin/mvp-scope", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.read", { kind: "system", value: "whistle" }))) return;
    const [config, access, changeRequests] = await Promise.all([
      configRepository.getConfig(),
      accessRepository.getSnapshot(),
      configRepository.listConfigChangeRequests(),
    ]);
    return {
      mode: configRepository.mode,
      scope: createMvpScopeReport(config, access, changeRequests, deploymentPreflightReport()),
    };
  });

  app.get("/api/admin/mvp1-launch-handoff", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.read", { kind: "system", value: "whistle" }))) return;
    const [config, access, changeRequests] = await Promise.all([
      configRepository.getConfig(),
      accessRepository.getSnapshot(),
      configRepository.listConfigChangeRequests(),
    ]);
    return {
      mode: configRepository.mode,
      handoff: createMvp1LaunchHandoffReport(config, access, changeRequests, deploymentPreflightReport()),
    };
  });

  app.get("/api/admin/governance/config-change-requests", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.read", { kind: "system", value: "whistle" }))) return;
    return {
      changeRequests: await configRepository.listConfigChangeRequests(),
    };
  });

  app.post("/api/admin/governance/config-change-requests", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.write");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.write", { kind: "system", value: "whistle" }))) return;
    const parsed = createConfigChangeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    return reply.code(201).send({
      changeRequest: await configRepository.createConfigChangeRequest(parsed.data, auth.actor),
    });
  });

  app.post<{ Params: { requestId: string } }>("/api/admin/governance/config-change-requests/:requestId/approve", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.approve");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.approve", { kind: "system", value: "whistle" }))) return;
    const parsed = decideConfigChangeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const existing = (await configRepository.listConfigChangeRequests()).find((item) => item.id === request.params.requestId);
    if (!existing) return reply.code(404).send({ error: "config_change_request_not_found" });
    if (existing.status !== "pending") return reply.code(409).send({ error: "config_change_not_pending", message: "Only pending config change requests can be approved." });
    if (existing.requestedBy === auth.actor) {
      return reply.code(409).send({
        error: "second_admin_required",
        message: "Critical configuration changes require a different Admin approver from the requester.",
      });
    }
    const changeRequest = await configRepository.approveConfigChangeRequest(request.params.requestId, { actor: auth.actor, reason: parsed.data.reason });
    if (!changeRequest) return reply.code(404).send({ error: "config_change_request_not_found_or_target_missing" });
    return { changeRequest, config: await configRepository.getConfig() };
  });

  app.post<{ Params: { requestId: string } }>("/api/admin/governance/config-change-requests/:requestId/reject", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.approve");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.approve", { kind: "system", value: "whistle" }))) return;
    const parsed = decideConfigChangeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const existing = (await configRepository.listConfigChangeRequests()).find((item) => item.id === request.params.requestId);
    if (!existing) return reply.code(404).send({ error: "config_change_request_not_found" });
    if (existing.status !== "pending") return reply.code(409).send({ error: "config_change_not_pending", message: "Only pending config change requests can be rejected." });
    if (existing.requestedBy === auth.actor) {
      return reply.code(409).send({
        error: "second_admin_required",
        message: "Critical configuration changes require a different Admin reviewer from the requester.",
      });
    }
    const changeRequest = await configRepository.rejectConfigChangeRequest(request.params.requestId, { actor: auth.actor, reason: parsed.data.reason });
    if (!changeRequest) return reply.code(404).send({ error: "config_change_request_not_found" });
    return { changeRequest };
  });

  app.get("/api/admin/governance/audit-export", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin", "cm_cell"], "audit.export");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const scope = auth.role === "cm_cell" ? { kind: "state" as const, value: "Tamil Nadu" } : { kind: "system" as const, value: "whistle" };
    if (!(await enforceGrantOrReply(reply, auth, "audit.export", scope))) return;
    const parsed = auditExportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const auditEvents = await repository.listAudit(parsed.data.ticketId);
    const configChangeRequests = await configRepository.listConfigChangeRequests();
    const exportPackage = auditExportPackage(
      auth.actor,
      auditEvents.length,
      configChangeRequests.length,
      auditEvents.filter((event) => event.sensitive).length,
      securityExportProvider.productionStorage,
      parsed.data.ticketId,
    );
    const exportDelivery = await securityExportProvider.exportAuditPackage({
      exportPackage,
      auditEvents,
      configChangeRequests,
    });
    if (exportDelivery.status === "failed") {
      return reply.code(503).send({
        error: "security_export_failed",
        message: "Governance audit export could not be written to the configured security export provider.",
        exportDelivery,
      });
    }
    return {
      exportPackage,
      exportDelivery,
      auditEvents,
      configChangeRequests,
    };
  });

  app.patch<{ Params: { categoryId: CategoryId } }>("/api/admin/config/categories/:categoryId", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.write");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.write", { kind: "system", value: "whistle" }))) return;
    const parsed = patchCategorySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const conflict = await criticalConfigConflict({ kind: "category", id: request.params.categoryId, patch: parsed.data });
    if (conflict) return reply.code(409).send(conflict);
    const category = await configRepository.updateCategory(request.params.categoryId, parsed.data);
    if (!category) return reply.code(404).send({ error: "category_not_found" });
    return { category };
  });

  app.patch<{ Params: { categoryId: CategoryId } }>("/api/admin/config/category-readiness/:categoryId", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.write");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.write", { kind: "system", value: "whistle" }))) return;
    const parsed = patchCategoryReadinessSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const conflict = await criticalConfigConflict({ kind: "category_readiness", categoryId: request.params.categoryId, patch: parsed.data });
    if (conflict) return reply.code(409).send(conflict);
    const readiness = await configRepository.updateCategoryReadiness(request.params.categoryId, parsed.data);
    if (!readiness) return reply.code(404).send({ error: "category_readiness_not_found" });
    return { readiness };
  });

  app.patch<{ Params: { stage: SlaStage } }>("/api/admin/config/sla-policies/:stage", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.write");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.write", { kind: "system", value: "whistle" }))) return;
    const parsed = patchSlaPolicySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const conflict = await criticalConfigConflict({ kind: "sla_policy", stage: request.params.stage, patch: parsed.data });
    if (conflict) return reply.code(409).send(conflict);
    const policy = await configRepository.updateSlaPolicy(request.params.stage, parsed.data);
    if (!policy) return reply.code(404).send({ error: "sla_policy_not_found" });
    return { policy };
  });

  app.patch<{ Params: { controlId: string } }>("/api/admin/config/app-controls/:controlId", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "admin.config.write");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "admin.config.write", { kind: "system", value: "whistle" }))) return;
    const parsed = patchAppControlSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const conflict = await criticalConfigConflict({ kind: "app_control", id: request.params.controlId, value: parsed.data.value });
    if (conflict) return reply.code(409).send(conflict);
    const control = await configRepository.updateAppControl(request.params.controlId, parsed.data.value);
    if (!control) return reply.code(404).send({ error: "app_control_not_found" });
    return { control };
  });

  app.get("/api/admin/access", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    return {
      mode: accessRepository.mode,
      access: await accessRepository.getSnapshot(),
    };
  });

  app.get("/api/admin/access/effective", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = effectiveAccessQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    return {
      effectiveAccess: await accessRepository.getEffectiveAccess(parsed.data.actor),
    };
  });

  app.post("/api/admin/access/users", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = createAccessUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    return reply.code(201).send({ user: await accessRepository.createUser(parsed.data, auth.actor) });
  });

  app.patch<{ Params: { userId: string } }>("/api/admin/access/users/:userId", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = updateAccessUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const user = await accessRepository.updateUser(request.params.userId, parsed.data, auth.actor);
    if (!user) return reply.code(404).send({ error: "access_user_not_found" });
    return { user };
  });

  app.post("/api/admin/access/teams", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = createAccessTeamSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    return reply.code(201).send({ team: await accessRepository.createTeam(parsed.data, auth.actor) });
  });

  app.patch<{ Params: { teamId: string } }>("/api/admin/access/teams/:teamId", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = updateAccessTeamSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const team = await accessRepository.updateTeam(request.params.teamId, parsed.data, auth.actor);
    if (!team) return reply.code(404).send({ error: "access_team_not_found" });
    return { team };
  });

  app.post("/api/admin/access/memberships", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = createTeamMembershipSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    return reply.code(201).send({ membership: await accessRepository.createMembership(parsed.data, auth.actor) });
  });

  app.patch<{ Params: { membershipId: string } }>("/api/admin/access/memberships/:membershipId", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = updateTeamMembershipSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const membership = await accessRepository.updateMembership(request.params.membershipId, parsed.data, auth.actor);
    if (!membership) return reply.code(404).send({ error: "team_membership_not_found" });
    return { membership };
  });

  app.post("/api/admin/access/grants", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = createAccessGrantSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    return reply.code(201).send({ grant: await accessRepository.createGrant(parsed.data, auth.actor) });
  });

  app.patch<{ Params: { grantId: string } }>("/api/admin/access/grants/:grantId", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin"], "access.manage");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "access.manage", { kind: "system", value: "whistle" }))) return;
    const parsed = updateAccessGrantSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const grant = await accessRepository.updateGrant(request.params.grantId, parsed.data, auth.actor);
    if (!grant) return reply.code(404).send({ error: "access_grant_not_found" });
    return { grant };
  });

  app.get("/openapi.json", async () => openApiDocument);

  app.get("/api/public/insights", async (request, reply) => {
    const config = await configRepository.getConfig();
    if (!isPublicInsightsEnabled(config)) {
      return reply.code(403).send({
        error: "public_insights_disabled",
        message: "Public aggregate insights are disabled by Admin configuration.",
      });
    }
    return {
      insights: createPublicInsights(await repository.listTickets(), config),
    };
  });

  app.get("/api/citizen/config", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen"], "citizen.config.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const config = await configRepository.getConfig();
    return {
      assetPolicy: publicAssetPolicyFromConfig(config),
      categories: config.categories.map((category) => citizenCategoryAvailability(config, category)),
      controls: {
        phoneOtpRequired: isCitizenPhoneOtpRequired(config),
      },
    };
  });

  app.post("/api/citizen/otp/start", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen"], "citizen.phone_otp.start");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const parsed = phoneOtpStartSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    try {
      const challenge = await phoneVerificationRepository.startChallenge(parsed.data.phone, parsed.data.language);
      return reply.code(201).send({ challenge });
    } catch (error) {
      return reply.code(503).send({
        error: "citizen_otp_delivery_unavailable",
        message: safeReadinessError(error),
      });
    }
  });

  app.post("/api/citizen/otp/verify", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen"], "citizen.phone_otp.verify");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const parsed = phoneOtpVerifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const verification = await phoneVerificationRepository.verifyChallenge(parsed.data.challengeId, parsed.data.otp);
    if ("ok" in verification && !verification.ok) {
      return reply.code(verification.status).send({
        error: verification.error,
        message: verification.message,
      });
    }
    return { verification };
  });

  app.post("/api/tickets", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen", "verification", "admin"], "ticket.create");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "ticket.create"))) return;
    const parsed = createTicketSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const idempotencyScope = `ticket.create:${auth.actor}`;
    const idempotency = await checkTicketIdempotency(
      request,
      "ticket.create",
      idempotencyScope,
      parsed.data,
      "This Idempotency-Key was already used with a different ticket-create request.",
    );
    if (!idempotency.ok) return reply.code(idempotency.status).send(idempotency.payload);
    if (idempotency.ticket) return reply.code(200).send({ ticket: redactTicketForApi(idempotency.ticket), rejected: null, idempotent: true });
    const config = await configRepository.getConfig();
    const category = findCategoryConfig(config, parsed.data.category);
    if (!category) return reply.code(404).send({ error: "category_not_found" });
    if (!category.enabled) {
      return {
        ticket: null,
        rejected: {
          error: "category_disabled",
          message: `${category.labelEn} complaints are disabled by Admin configuration.`,
        },
      };
    }
    if (auth.role === "citizen") {
      const readinessRejection = citizenCategoryReadinessRejection(config, category);
      if (readinessRejection) {
        return {
          ticket: null,
          rejected: readinessRejection,
        };
      }
    }
    if (auth.role === "citizen" && isCitizenPhoneOtpRequired(config)) {
      if (!parsed.data.phoneVerificationToken) {
        return reply.code(401).send({
          error: "phone_verification_required",
          message: "Verify the citizen phone number before submitting this complaint.",
        });
      }
      const verification = await phoneVerificationRepository.validateToken(parsed.data.phoneVerificationToken, parsed.data.phone);
      if (!verification.ok) {
        return reply.code(verification.status).send({
          error: verification.error,
          message: verification.message,
        });
      }
    }
    const reservation = await reserveTicketIdempotency(
      idempotencyScope,
      idempotency.key,
      idempotency.requestHash,
      "ticket.create",
      "This Idempotency-Key was already used with a different ticket-create request.",
    );
    if (reservation) {
      if (!reservation.ok) return reply.code(reservation.status).send(reservation.payload);
      if (reservation.ticket) return reply.code(200).send({ ticket: redactTicketForApi(reservation.ticket), rejected: null, idempotent: true });
    }
    const ticket = await repository.createTicket(parsed.data, lifecyclePolicyFromConfig(config));
    if (idempotency.key) {
      await saveTicketIdempotency(idempotencyScope, idempotency.key, idempotency.requestHash, "ticket.create", ticket);
    }
    return reply.code(201).send({
      ticket: redactTicketForApi(ticket),
      rejected: null,
    });
  });

  app.get("/api/citizen/tickets", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen"], "citizen.tickets.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "ticket.read"))) return;
    const parsed = citizenTicketsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const config = await configRepository.getConfig();
    if (isCitizenPhoneOtpRequired(config)) {
      const headerPhone = requestHeader(request, "x-whistle-citizen-phone")?.trim();
      const verificationToken = requestHeader(request, "x-whistle-citizen-token")?.trim();
      if (!headerPhone || !verificationToken) {
        return reply.code(401).send({
          error: "citizen_ticket_verification_required",
          message: "Verify this phone number before loading My Tickets.",
        });
      }
      if (hashCitizenPhone(headerPhone) !== hashCitizenPhone(parsed.data.phone)) {
        return reply.code(403).send({
          error: "citizen_ticket_owner_mismatch",
          message: "The verified phone number does not match this My Tickets lookup.",
        });
      }
      const verification = await phoneVerificationRepository.validateToken(verificationToken, parsed.data.phone);
      if (!verification.ok) {
        return reply.code(verification.status).send({
          error: verification.error,
          message: verification.message,
        });
      }
    }
    if (parsed.data.cursor && !decodeTicketCursor(parsed.data.cursor, "citizen-updated-desc")) {
      return reply.code(400).send(invalidCursorPayload("citizen-updated-desc"));
    }
    const page = pageTicketRows(
      await repository.listCitizenTickets(hashCitizenPhone(parsed.data.phone), {
        limit: parsed.data.limit + 1,
        offset: parsed.data.offset,
        cursor: parsed.data.cursor,
      }),
      parsed.data.limit,
      parsed.data.offset,
      parsed.data.cursor,
      cursorForCitizenTicket,
    );
    return {
      tickets: redactTicketsForApi(page.items),
      page: page.page,
    };
  });

  app.get<{ Params: { ticketId: string } }>("/api/tickets/:ticketId", async (request, reply) => {
    const ticket = await repository.getTicket(request.params.ticketId);
    if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
    const auth = await resolveAuthContext(request, "citizen");
    const decision = authorizeTicketRead(auth, ticket);
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceCitizenTicketOwnership(request, reply, auth, ticket))) return;
    if (!(await enforceScopedTicketReadOrReply(reply, auth, ticket))) return;
    if (ticket.protected && auth.role !== "citizen") {
      const reason = protectedAccessReasonOrReply(request, reply, ticket);
      if (reason === null) return;
      await recordProtectedAccess(ticket, auth, "protected.ticket.read", reason);
    }
    return { ticket: redactTicketForApi(ticket) };
  });

  app.get<{ Params: { ticketId: string } }>("/api/tickets/:ticketId/notifications", async (request, reply) => {
    const ticket = await repository.getTicket(request.params.ticketId);
    if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
    const auth = await resolveAuthContext(request, "citizen");
    const decision = authorizeTicketRead(auth, ticket);
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceCitizenTicketOwnership(request, reply, auth, ticket))) return;
    if (!(await enforceScopedTicketReadOrReply(reply, auth, ticket))) return;
    if (ticket.protected && auth.role !== "citizen") {
      const reason = protectedAccessReasonOrReply(request, reply, ticket);
      if (reason === null) return;
      await recordProtectedAccess(ticket, auth, "protected.notifications.read", reason);
    }
    return {
      notifications: await repository.listNotifications(request.params.ticketId),
    };
  });

  app.post<{ Params: { ticketId: string } }>("/api/tickets/:ticketId/citizen-update", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen"], "ticket.citizen_update");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const parsed = citizenUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const existing = await repository.getTicket(request.params.ticketId);
    if (!existing) return reply.code(404).send({ error: "ticket_not_found" });
    const readDecision = authorizeTicketRead(auth, existing);
    if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
    if (!(await enforceCitizenTicketOwnership(request, reply, auth, existing))) return;
    if (!(await enforceGrantOrReply(reply, auth, "ticket.read"))) return;
    if (!(await enforceGrantOrReply(reply, auth, "ticket.citizen_update"))) return;
    const idempotencyScope = `citizen.update:${request.params.ticketId}:${auth.actor}`;
    const idempotency = await checkTicketIdempotency(
      request,
      "citizen.update",
      idempotencyScope,
      parsed.data,
      "This Idempotency-Key was already used with a different citizen update request.",
    );
    if (!idempotency.ok) return reply.code(idempotency.status).send(idempotency.payload);
    if (idempotency.ticket) return reply.code(200).send({ ticket: redactTicketForApi(idempotency.ticket), idempotent: true });
    const conflict = citizenUpdateConflict(existing);
    if (conflict) return reply.code(409).send(conflict);
    const reservation = await reserveTicketIdempotency(
      idempotencyScope,
      idempotency.key,
      idempotency.requestHash,
      "citizen.update",
      "This Idempotency-Key was already used with a different citizen update request.",
    );
    if (reservation) {
      if (!reservation.ok) return reply.code(reservation.status).send(reservation.payload);
      if (reservation.ticket) return reply.code(200).send({ ticket: redactTicketForApi(reservation.ticket), idempotent: true });
    }
    const config = await configRepository.getConfig();
    const ticket = await repository.submitCitizenUpdate(request.params.ticketId, parsed.data, lifecyclePolicyFromConfig(config));
    if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
    await saveTicketIdempotency(idempotencyScope, idempotency.key, idempotency.requestHash, "citizen.update", ticket);
    return { ticket: redactTicketForApi(ticket) };
  });

  app.post<{ Params: { ticketId: string } }>("/api/tickets/:ticketId/reopen-dispute", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen"], "ticket.reopen_dispute");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const parsed = citizenDisputeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const command = { ...parsed.data, actor: auth.actor };
    const existing = await repository.getTicket(request.params.ticketId);
    if (!existing) return reply.code(404).send({ error: "ticket_not_found" });
    const readDecision = authorizeTicketRead(auth, existing);
    if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
    if (!(await enforceCitizenTicketOwnership(request, reply, auth, existing))) return;
    if (!(await enforceGrantOrReply(reply, auth, "ticket.read"))) return;
    const idempotencyScope = `citizen.dispute_reopen:${request.params.ticketId}:${auth.actor}`;
    const idempotency = await checkTicketIdempotency(
      request,
      "citizen.dispute_reopen",
      idempotencyScope,
      command,
      "This Idempotency-Key was already used with a different reopen/dispute request.",
    );
    if (!idempotency.ok) return reply.code(idempotency.status).send(idempotency.payload);
    if (idempotency.ticket) {
      const replayReadDecision = authorizeTicketRead(auth, idempotency.ticket);
      if (!replayReadDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, replayReadDecision.reason ?? "Forbidden"));
      return reply.code(200).send({ ticket: redactTicketForApi(idempotency.ticket), idempotent: true });
    }
    const conflict = citizenDisputeConflict(existing);
    if (conflict) return reply.code(409).send(conflict);
    const reservation = await reserveTicketIdempotency(
      idempotencyScope,
      idempotency.key,
      idempotency.requestHash,
      "citizen.dispute_reopen",
      "This Idempotency-Key was already used with a different reopen/dispute request.",
    );
    if (reservation) {
      if (!reservation.ok) return reply.code(reservation.status).send(reservation.payload);
      if (reservation.ticket) {
        const replayReadDecision = authorizeTicketRead(auth, reservation.ticket);
        if (!replayReadDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, replayReadDecision.reason ?? "Forbidden"));
        return reply.code(200).send({ ticket: redactTicketForApi(reservation.ticket), idempotent: true });
      }
    }
    const config = await configRepository.getConfig();
    const ticket = await repository.submitCitizenDispute(
      request.params.ticketId,
      command,
      lifecyclePolicyFromConfig(config),
    );
    if (ticket) await saveTicketIdempotency(idempotencyScope, idempotency.key, idempotency.requestHash, "citizen.dispute_reopen", ticket);
    return ticket ? { ticket: redactTicketForApi(ticket) } : reply.code(404).send({ error: "ticket_not_found" });
  });

  app.post<{ Params: { ticketId: string } }>("/api/tickets/:ticketId/field-actions", async (request, reply) => {
    const auth = await resolveAuthContext(request, "department_officer");
    const roleDecision = requireRoles(auth, ["department_officer", "minister", "mla", "councillor", "cm_cell"], "field.action.write");
    if (!roleDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, roleDecision.reason ?? "Forbidden"));
    const parsed = fieldExecutionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const existing = await repository.getTicket(request.params.ticketId);
    if (!existing) return reply.code(404).send({ error: "ticket_not_found" });
    const readDecision = authorizeTicketRead(auth, existing);
    if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
    const scope = fieldActionScope(auth, existing);
    if (scope === null) return reply.code(403).send(forbiddenPayload(auth, `${auth.role} can act only on tickets with an active assignment matching that role scope.`));
    if (!(await enforceGrantOrReply(reply, auth, "ticket.read", scope))) return;
    if (!(await enforceGrantOrReply(reply, auth, "field.action.write", scope))) return;
    const command = { ...parsed.data, actor: auth.actor } as FieldExecutionCommand;
    const conflict = fieldActionConflict(auth, existing, command);
    if (conflict) return reply.code(409).send(conflict);
    const config = await configRepository.getConfig();
    const ticket = await repository.applyFieldExecution(request.params.ticketId, command, lifecyclePolicyFromConfig(config));
    return ticket ? { ticket: redactTicketForApi(ticket) } : reply.code(404).send({ error: "ticket_not_found" });
  });

  app.post<{ Params: { ticketId: string } }>("/api/tickets/:ticketId/evidence/upload-session", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen", "verification", "cm_cell", "minister", "department_officer", "mla", "councillor"], "evidence.upload_session");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const parsed = evidenceUploadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const existing = await repository.getTicket(request.params.ticketId);
    if (!existing) return reply.code(404).send({ error: "ticket_not_found" });
    const readDecision = authorizeTicketRead(auth, existing);
    if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
    if (!(await enforceCitizenTicketOwnership(request, reply, auth, existing))) return;
    const scope = scopedTicketReadRequirement(auth, existing);
    if (!(await enforceScopedTicketReadOrReply(reply, auth, existing))) return;
    if (!(await enforceGrantOrReply(reply, auth, "evidence.upload_session", scope ?? undefined))) return;
    const session = await repository.createEvidenceUploadSession(request.params.ticketId, { ...parsed.data, actor: auth.actor });
    return reply.code(201).send({ session });
  });

  app.post<{ Params: { ticketId: string; evidenceId: string } }>("/api/tickets/:ticketId/evidence/:evidenceId/complete-upload", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen", "verification", "cm_cell", "minister", "department_officer", "mla", "councillor"], "evidence.upload_complete");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const parsed = evidenceUploadCompletionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const existing = await repository.getTicket(request.params.ticketId);
    if (!existing) return reply.code(404).send({ error: "ticket_not_found" });
    const readDecision = authorizeTicketRead(auth, existing);
    if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
    if (!(await enforceCitizenTicketOwnership(request, reply, auth, existing))) return;
    const scope = scopedTicketReadRequirement(auth, existing);
    if (!(await enforceScopedTicketReadOrReply(reply, auth, existing))) return;
    if (!(await enforceGrantOrReply(reply, auth, "evidence.upload_complete", scope ?? undefined))) return;

    const command = { ...parsed.data, actor: auth.actor } satisfies EvidenceUploadCompletionCommand;
    const evidence = existing.evidence.find((item) => item.id === request.params.evidenceId);
    if (!evidence) return reply.code(404).send({ error: "evidence_not_found" });
    const conflict = evidenceUploadCompletionConflict(existing, request.params.evidenceId, command);
    if (conflict) return reply.code(409).send({ error: "evidence_upload_conflict", message: conflict });
    try {
      await evidenceObjectStore.recordCompletedUpload({
        ticket: existing,
        evidence,
        checksum: command.checksum,
        actor: auth.actor,
      });
    } catch (error) {
      return reply.code(503).send({
        error: "evidence_object_store_unavailable",
        message: safeReadinessError(error),
      });
    }
    const ticket = await repository.completeEvidenceUpload(request.params.ticketId, request.params.evidenceId, command);
    if (!ticket) return reply.code(409).send({ error: "evidence_upload_conflict", message: "Evidence upload could not be completed." });
    return {
      ticket: redactTicketForApi(ticket),
      evidence: ticket.evidence.find((item) => item.id === request.params.evidenceId),
    };
  });

  app.put<{ Params: { ticketId: string; evidenceId: string } }>("/api/tickets/:ticketId/evidence/:evidenceId/upload-binary", async (request, reply) => {
    const auth = await resolveAuthContext(request, "citizen");
    const decision = requireRoles(auth, ["citizen", "verification", "cm_cell", "minister", "department_officer", "mla", "councillor"], "evidence.upload_complete");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const existing = await repository.getTicket(request.params.ticketId);
    if (!existing) return reply.code(404).send({ error: "ticket_not_found" });
    const readDecision = authorizeTicketRead(auth, existing);
    if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
    if (!(await enforceCitizenTicketOwnership(request, reply, auth, existing))) return;
    const scope = scopedTicketReadRequirement(auth, existing);
    if (!(await enforceScopedTicketReadOrReply(reply, auth, existing))) return;
    if (!(await enforceGrantOrReply(reply, auth, "evidence.upload_complete", scope ?? undefined))) return;

    const evidence = existing.evidence.find((item) => item.id === request.params.evidenceId);
    if (!evidence) return reply.code(404).send({ error: "evidence_not_found" });
    const body = request.body;
    const bytes = Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body) : null;
    if (!bytes?.byteLength) {
      return reply.code(400).send({
        error: "evidence_binary_missing",
        message: "Evidence upload did not include file bytes.",
      });
    }
    const contentType = (requestHeader(request, "content-type") ?? evidence.mimeType).split(";")[0]?.trim().toLowerCase() || evidence.mimeType;
    const binarySha256 = createHash("sha256").update(bytes).digest("hex");
    const suppliedSha256 = requestHeader(request, "x-whistle-content-sha256")?.trim().toLowerCase();
    if (suppliedSha256 && suppliedSha256 !== binarySha256) {
      return reply.code(400).send({
        error: "evidence_checksum_mismatch",
        message: "Evidence checksum did not match the uploaded file bytes.",
      });
    }
    const command = {
      actor: auth.actor,
      mimeType: contentType,
      sizeBytes: bytes.byteLength,
      checksum: `sha256:${binarySha256}`,
    } satisfies EvidenceUploadCompletionCommand;
    const conflict = evidenceUploadCompletionConflict(existing, request.params.evidenceId, command);
    if (conflict) return reply.code(409).send({ error: "evidence_upload_conflict", message: conflict });
    try {
      await evidenceObjectStore.recordBinaryUpload({
        ticket: existing,
        evidence,
        checksum: command.checksum,
        actor: auth.actor,
        bytes,
      });
    } catch (error) {
      return reply.code(503).send({
        error: "evidence_object_store_unavailable",
        message: safeReadinessError(error),
      });
    }

    const ticket = await repository.completeEvidenceUpload(request.params.ticketId, request.params.evidenceId, command);
    if (!ticket) return reply.code(409).send({ error: "evidence_upload_conflict", message: "Evidence upload could not be completed." });
    const scan = await repository.runEvidenceScanJob({ actor: "evidence:local-binary-uploader", limit: 25 }, evidenceObjectStore);
    const scannedTicket = await repository.getTicket(request.params.ticketId);
    const responseTicket = scannedTicket ?? ticket;
    return {
      ticket: redactTicketForApi(responseTicket),
      evidence: responseTicket.evidence.find((item) => item.id === request.params.evidenceId),
      scan,
    };
  });

  app.get<{ Params: { ticketId: string } }>("/api/tickets/:ticketId/evidence", async (request, reply) => {
    const parsed = evidenceAccessQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const auth = await resolveAuthContext(request, parsed.data.role);
    const decision = authorizeEvidenceAccess(auth, parsed.data.role);
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const ticket = await repository.getTicket(request.params.ticketId);
    if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
    const readDecision = authorizeTicketRead(auth, ticket);
    if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
    if (!(await enforceCitizenTicketOwnership(request, reply, auth, ticket))) return;
    const scope = scopedTicketReadRequirement(auth, ticket);
    if (!(await enforceScopedTicketReadOrReply(reply, auth, ticket))) return;
    if (!(await enforceGrantOrReply(reply, auth, "evidence.read", scope ?? undefined))) return;
    const accessReason = ticket.protected && auth.role !== "citizen" ? protectedAccessReasonOrReply(request, reply, ticket, parsed.data.accessReason) : "";
    if (accessReason === null) return;
    const accessQuery = {
      ...parsed.data,
      role: auth.role as EvidenceAccessQuery["role"],
      actor: auth.actor,
      accessReason: accessReason || parsed.data.accessReason,
    } satisfies EvidenceAccessQuery;
    const evidence = await repository.listEvidenceAccess(request.params.ticketId, accessQuery);
    return { evidence };
  });

  app.get("/api/verification/queue", async (request, reply) => {
    const auth = await resolveAuthContext(request, "verification");
    const decision = requireRoles(auth, ["verification", "cm_cell"], "verification.queue");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "verification.queue", { kind: "queue", value: "verification" }))) return;
    const parsed = verificationQueueQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (parsed.data.cursor && !decodeTicketCursor(parsed.data.cursor, "verification-created-asc")) {
      return reply.code(400).send(invalidCursorPayload("verification-created-asc"));
    }
    const page = pageTicketRows(
      await repository.listVerificationQueue({
        limit: parsed.data.limit + 1,
        offset: parsed.data.offset,
        q: parsed.data.q,
        cursor: parsed.data.cursor,
      }),
      parsed.data.limit,
      parsed.data.offset,
      parsed.data.cursor,
      cursorForVerificationTicket,
    );
    return {
      tickets: redactTicketsForApi(page.items),
      page: page.page,
    };
  });

  app.get<{ Params: { ticketId: string } }>("/api/verification/:ticketId/agent-runs", async (request, reply) => {
    const auth = await resolveAuthContext(request, "verification");
    const decision = requireRoles(auth, ["verification", "cm_cell"], "agent.recommendation.run");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "agent.recommendation.run", { kind: "queue", value: "verification" }))) return;
    if (!isIntakeAgentEnabled(await configRepository.getConfig())) {
      return reply.code(403).send({ error: "agent_intake_disabled", message: "Recommend-only intake agent is disabled by Admin configuration." });
    }
    const ticket = await repository.getTicket(request.params.ticketId);
    if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
    const conflict = agentRunConflict(ticket);
    if (conflict) return reply.code(409).send(conflict);
    return {
      runs: await repository.listAgentRuns(request.params.ticketId),
    };
  });

  app.post<{ Params: { ticketId: string } }>("/api/verification/:ticketId/agent-runs", async (request, reply) => {
    const auth = await resolveAuthContext(request, "verification");
    const decision = requireRoles(auth, ["verification", "cm_cell"], "agent.recommendation.run");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "agent.recommendation.run", { kind: "queue", value: "verification" }))) return;
    if (!isIntakeAgentEnabled(await configRepository.getConfig())) {
      return reply.code(403).send({ error: "agent_intake_disabled", message: "Recommend-only intake agent is disabled by Admin configuration." });
    }
    const ticket = await repository.getTicket(request.params.ticketId);
    if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
    const conflict = agentRunConflict(ticket);
    if (conflict) return reply.code(409).send(conflict);
    const run = await createIntakeAgentRunViaGateway(ticket, await repository.listTickets(), auth.actor);
    return reply.code(201).send({
      run: await repository.recordAgentRun(run),
    });
  });

  app.get("/api/dashboard", async (request, reply) => {
    const parsed = dashboardFilterSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (parsed.data.ticketCursor && !decodeTicketCursor(parsed.data.ticketCursor, "dashboard-sla-updated-desc")) {
      return reply.code(400).send(invalidCursorPayload("dashboard-sla-updated-desc"));
    }
    const auth = await resolveAuthContext(request, parsed.data.role);
    const decision = authorizeDashboardRead(auth, parsed.data);
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "dashboard.read", dashboardScope(parsed.data)))) return;
    return {
      dashboard: await repository.getRoleDashboard(parsed.data),
    };
  });

  app.get("/api/dashboard/explain", async (request, reply) => {
    const parsed = dashboardFilterSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (parsed.data.ticketCursor && !decodeTicketCursor(parsed.data.ticketCursor, "dashboard-sla-updated-desc")) {
      return reply.code(400).send(invalidCursorPayload("dashboard-sla-updated-desc"));
    }
    const auth = await resolveAuthContext(request, parsed.data.role);
    const roleDecision = requireRoles(auth, ["admin", "cm_cell", "minister", "department_officer", "mla", "councillor", "verification"], "dashboard.explain");
    if (!roleDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, roleDecision.reason ?? "Forbidden"));
    if (auth.role !== "admin") {
      const dashboardDecision = authorizeDashboardRead(auth, parsed.data);
      if (!dashboardDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, dashboardDecision.reason ?? "Forbidden"));
    }
    if (!(await enforceGrantOrReply(reply, auth, "dashboard.explain", dashboardExplainScope(auth, parsed.data)))) return;
    return {
      explanation: await repository.getDashboardExplanation(parsed.data),
    };
  });

  app.post("/api/dashboard/briefs", async (request, reply) => {
    const parsed = dashboardFilterSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (!["cm_cell", "minister"].includes(parsed.data.role)) {
      return reply.code(400).send({ error: "unsupported_brief_role", message: "Dashboard briefs are available for CM Cell and Minister roles in V2." });
    }
    const auth = await resolveAuthContext(request, parsed.data.role);
    const decision = requireRoles(auth, ["cm_cell", "minister"], "agent.recommendation.run");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const dashboardDecision = authorizeDashboardRead(auth, parsed.data);
    if (!dashboardDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, dashboardDecision.reason ?? "Forbidden"));
    const scope = dashboardScope(parsed.data);
    if (!(await enforceGrantOrReply(reply, auth, "dashboard.read", scope))) return;
    if (!(await enforceGrantOrReply(reply, auth, "agent.recommendation.run", scope))) return;

    const dashboard = await repository.getRoleDashboard(parsed.data);
    const run = createDashboardBriefRun(dashboard, auth.actor);
    return reply.code(201).send({
      run: await repository.recordDashboardBriefRun(run),
    });
  });

  app.post("/api/jobs/sla-escalations/run", async (request, reply) => {
    const auth = await resolveAuthContext(request, "worker");
    const decision = requireRoles(auth, ["worker", "admin"], "jobs.sla_escalations.run");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!enforceWorkerAuthOrReply(request, reply, auth)) return;
    if (!(await enforceGrantOrReply(reply, auth, "jobs.sla_escalations.run", { kind: "system", value: "jobs" }))) return;
    const parsed = slaJobSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const config = await configRepository.getConfig();
    return {
      result: await repository.runSlaEscalationJob(parsed.data, lifecyclePolicyFromConfig(config)),
    };
  });

  app.post("/api/jobs/evidence-scans/run", async (request, reply) => {
    const auth = await resolveAuthContext(request, "worker");
    const decision = requireRoles(auth, ["worker", "admin"], "jobs.evidence_scans.run");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!enforceWorkerAuthOrReply(request, reply, auth)) return;
    if (!(await enforceGrantOrReply(reply, auth, "jobs.evidence_scans.run", { kind: "system", value: "jobs" }))) return;
    const parsed = evidenceScanJobSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    try {
      return {
        result: await repository.runEvidenceScanJob(parsed.data, evidenceObjectStore),
      };
    } catch (error) {
      return reply.code(503).send({
        error: "evidence_object_store_unavailable",
        message: safeReadinessError(error),
      });
    }
  });

  app.post("/api/jobs/notifications/run", async (request, reply) => {
    const auth = await resolveAuthContext(request, "worker");
    const decision = requireRoles(auth, ["worker", "admin"], "jobs.notifications.run");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!enforceWorkerAuthOrReply(request, reply, auth)) return;
    if (!(await enforceGrantOrReply(reply, auth, "jobs.notifications.run", { kind: "system", value: "jobs" }))) return;
    const parsed = notificationJobSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    return {
      result: await repository.runNotificationJob(parsed.data, notificationDeliveryProvider),
    };
  });

  app.post<{ Params: { ticketId: string } }>("/api/verification/:ticketId/decision", async (request, reply) => {
    const parsed = verificationDecisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const auth = await resolveAuthContext(request, "verification");
    const command = {
      ...parsed.data,
      actor: auth.actor,
      actorRole: "verification",
      accessDecision: "allowed:verification.decision:queue:verification",
    } satisfies VerificationDecisionCommand;
    const decision = authorizeVerificationDecision(auth, command);
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "verification.decision", { kind: "queue", value: "verification" }))) return;
    const idempotencyScope = `verification.decision:${request.params.ticketId}:${auth.actor}`;
    const idempotency = await checkTicketIdempotency(
      request,
      "verification.decision",
      idempotencyScope,
      command,
      "This Idempotency-Key was already used with a different verification decision request.",
    );
    if (!idempotency.ok) return reply.code(idempotency.status).send(idempotency.payload);
    if (idempotency.ticket) return reply.code(200).send({ ticket: redactTicketForApi(idempotency.ticket), idempotent: true });
    const existing = await repository.getTicket(request.params.ticketId);
    if (!existing) return reply.code(404).send({ error: "ticket_not_found" });
    const conflict = verificationDecisionConflict(existing, command);
    if (conflict) return reply.code(409).send(conflict);
    const reservation = await reserveTicketIdempotency(
      idempotencyScope,
      idempotency.key,
      idempotency.requestHash,
      "verification.decision",
      "This Idempotency-Key was already used with a different verification decision request.",
    );
    if (reservation) {
      if (!reservation.ok) return reply.code(reservation.status).send(reservation.payload);
      if (reservation.ticket) return reply.code(200).send({ ticket: redactTicketForApi(reservation.ticket), idempotent: true });
    }
    const config = await configRepository.getConfig();
    const ticket = await repository.decide(request.params.ticketId, command, lifecyclePolicyFromConfig(config));
    if (ticket && idempotency.key) {
      await saveTicketIdempotency(idempotencyScope, idempotency.key, idempotency.requestHash, "verification.decision", ticket);
    }
    return ticket ? { ticket: redactTicketForApi(ticket) } : reply.code(404).send({ error: "ticket_not_found" });
  });

  app.post<{ Params: { ticketId: string } }>("/api/rejection-review/:ticketId/decision", async (request, reply) => {
    const parsed = rejectionReviewDecisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    const auth = await resolveAuthContext(request, "cm_cell");
    const roleDecision = requireRoles(auth, ["cm_cell"], "rejection.review.write");
    if (!roleDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, roleDecision.reason ?? "Forbidden"));
    if (!(await enforceGrantOrReply(reply, auth, "rejection.review.write", { kind: "state", value: "Tamil Nadu" }))) return;
    const existing = await repository.getTicket(request.params.ticketId);
    if (!existing) return reply.code(404).send({ error: "ticket_not_found" });
    const readDecision = authorizeTicketRead(auth, existing);
    if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
    const conflict = rejectionReviewConflict(existing, parsed.data);
    if (conflict) return reply.code(409).send(conflict);
    const command = { ...parsed.data, actor: auth.actor } as RejectionReviewDecisionCommand;
    const config = await configRepository.getConfig();
    const ticket = await repository.reviewRejection(request.params.ticketId, command, lifecyclePolicyFromConfig(config));
    return ticket ? { ticket: redactTicketForApi(ticket) } : reply.code(404).send({ error: "ticket_not_found" });
  });

  app.get("/api/audit", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin", "cm_cell", "verification"], "audit.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const parsed = operationalLogQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (parsed.data.ticketId) {
      const ticket = await repository.getTicket(parsed.data.ticketId);
      if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
      const readDecision = authorizeTicketRead(auth, ticket);
      if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
      if (!(await enforceScopedTicketReadOrReply(reply, auth, ticket, "audit.read"))) return;
      if (ticket.protected && auth.role !== "citizen") {
        const reason = protectedAccessReasonOrReply(request, reply, ticket);
        if (reason === null) return;
        await recordProtectedAccess(ticket, auth, "protected.audit.read", reason);
      }
    } else {
      if (auth.role === "verification") {
        return reply.code(403).send(forbiddenPayload(auth, "Verification audit reads require a ticketId scoped to the active verification queues."));
      }
      const scope = auth.role === "cm_cell" ? { kind: "state" as const, value: "Tamil Nadu" } : { kind: "system" as const, value: "whistle" };
      if (!(await enforceGrantOrReply(reply, auth, "audit.read", scope))) return;
    }
    if (parsed.data.cursor && !decodeTicketCursor(parsed.data.cursor, "audit-chain-desc")) {
      return reply.code(400).send(invalidCursorPayload("audit-chain-desc"));
    }
    const page = pageTicketRows(
      await repository.listAudit(parsed.data.ticketId, {
        limit: parsed.data.limit + 1,
        offset: parsed.data.offset,
        cursor: parsed.data.cursor,
      }),
      parsed.data.limit,
      parsed.data.offset,
      parsed.data.cursor,
      cursorForAuditEvent,
    );
    return {
      auditEvents: page.items,
      page: page.page,
    };
  });

  app.get("/api/notifications/outbox", async (request, reply) => {
    const auth = await resolveAuthContext(request, "admin");
    const decision = requireRoles(auth, ["admin", "cm_cell", "verification"], "notifications.outbox.read");
    if (!decision.allowed) return reply.code(403).send(forbiddenPayload(auth, decision.reason ?? "Forbidden"));
    const parsed = operationalLogQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(zodErrorPayload(parsed.error));
    if (parsed.data.ticketId) {
      const ticket = await repository.getTicket(parsed.data.ticketId);
      if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
      const readDecision = authorizeTicketRead(auth, ticket);
      if (!readDecision.allowed) return reply.code(403).send(forbiddenPayload(auth, readDecision.reason ?? "Forbidden"));
      if (!(await enforceScopedTicketReadOrReply(reply, auth, ticket, "notifications.outbox.read"))) return;
      if (ticket.protected && auth.role !== "citizen") {
        const reason = protectedAccessReasonOrReply(request, reply, ticket);
        if (reason === null) return;
        await recordProtectedAccess(ticket, auth, "protected.notifications_outbox.read", reason);
      }
    } else {
      if (auth.role === "verification") {
        return reply.code(403).send(forbiddenPayload(auth, "Verification notification-outbox reads require a ticketId scoped to the active verification queues."));
      }
      const scope = auth.role === "cm_cell" ? { kind: "state" as const, value: "Tamil Nadu" } : { kind: "system" as const, value: "whistle" };
      if (!(await enforceGrantOrReply(reply, auth, "notifications.outbox.read", scope))) return;
    }
    if (parsed.data.cursor && !decodeTicketCursor(parsed.data.cursor, "notification-created-desc")) {
      return reply.code(400).send(invalidCursorPayload("notification-created-desc"));
    }
    const page = pageTicketRows(
      await repository.listNotifications(parsed.data.ticketId, {
        limit: parsed.data.limit + 1,
        offset: parsed.data.offset,
        cursor: parsed.data.cursor,
      }),
      parsed.data.limit,
      parsed.data.offset,
      parsed.data.cursor,
      cursorForNotification,
    );
    return {
      notifications: page.items,
      page: page.page,
    };
  });

  return app;
}
