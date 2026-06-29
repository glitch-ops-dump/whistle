import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import pg from "pg";

export type RateLimitRuleId =
  | "auth.otp_start"
  | "auth.otp_verify"
  | "auth.login"
  | "auth.password_reset"
  | "citizen.otp_start"
  | "citizen.otp_verify"
  | "citizen.ticket_create"
  | "citizen.ticket_lookup"
  | "citizen.ticket_mutation";

type EnvLike = Record<string, string | undefined>;

export const DEFAULT_RATE_LIMIT_KEY_SALT = "whistle-public-rate-limit";

export type RateLimitRule = {
  id: RateLimitRuleId;
  max: number;
  windowMs: number;
  key: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type PublicRateLimiter = {
  readonly mode: string;
  healthCheck(): Promise<void>;
  check(rule: RateLimitRule, now?: number): Promise<RateLimitDecision>;
  close?(): Promise<void>;
};

export type PublicRateLimitPolicy = {
  enabled: boolean;
  otpStart: { max: number; windowMs: number };
  otpVerify: { max: number; windowMs: number };
  accountOtpStart: { max: number; windowMs: number };
  accountOtpVerify: { max: number; windowMs: number };
  accountLogin: { max: number; windowMs: number };
  accountPasswordReset: { max: number; windowMs: number };
  ticketCreate: { max: number; windowMs: number };
  ticketLookup: { max: number; windowMs: number };
  ticketMutation: { max: number; windowMs: number };
};

export class InMemoryRateLimiter implements PublicRateLimiter {
  readonly mode = "in-memory-rate-limit";
  private readonly buckets = new Map<string, Bucket>();

  async healthCheck() {
    return;
  }

  async check(rule: RateLimitRule, now = Date.now()): Promise<RateLimitDecision> {
    const bucketKey = `${rule.id}:${rule.key}`;
    const existing = this.buckets.get(bucketKey);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };
    bucket.count += 1;
    this.buckets.set(bucketKey, bucket);

    const remaining = Math.max(0, rule.max - bucket.count);
    return {
      allowed: bucket.count <= rule.max,
      limit: rule.max,
      remaining,
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
}

export class DisabledPublicRateLimiter implements PublicRateLimiter {
  readonly mode = "public-rate-limit-disabled";

  async healthCheck() {
    throw new Error("Public rate limiting is disabled; configure a shared backend before staging or production launch.");
  }

  async check(): Promise<RateLimitDecision> {
    throw new Error("Public rate limiting is disabled; configure a shared backend before staging or production launch.");
  }
}

function intFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function windowFromEnv(name: string, fallbackSeconds: number) {
  return intFromEnv(name, fallbackSeconds) * 1000;
}

function backendFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_RATE_LIMIT_BACKEND?.trim().toLowerCase() ?? "";
}

function deploymentRequiresPublicRateLimit(env: EnvLike = process.env) {
  const value = (env.WHISTLE_DEPLOYMENT_PROFILE ?? env.WHISTLE_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  return ["production", "prod", "staging", "stage", "pilot", "uat", "test", "testing", "qa"].includes(value);
}

function gatewayUrlFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_RATE_LIMIT_GATEWAY_URL?.trim() ?? "";
}

function gatewayApiKeyFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY?.trim() ?? "";
}

function keySaltFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_RATE_LIMIT_KEY_SALT?.trim() ?? DEFAULT_RATE_LIMIT_KEY_SALT;
}

export function publicRateLimitPolicyFromEnv(): PublicRateLimitPolicy {
  return {
    enabled: process.env.WHISTLE_RATE_LIMIT_ENABLED !== "false",
    otpStart: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_OTP_START_MAX", 12),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_OTP_START_WINDOW_SECONDS", 15 * 60),
    },
    otpVerify: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_OTP_VERIFY_MAX", 20),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_OTP_VERIFY_WINDOW_SECONDS", 15 * 60),
    },
    accountOtpStart: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_AUTH_OTP_START_MAX", 8),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_AUTH_OTP_START_WINDOW_SECONDS", 15 * 60),
    },
    accountOtpVerify: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_MAX", 12),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_AUTH_OTP_VERIFY_WINDOW_SECONDS", 15 * 60),
    },
    accountLogin: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_AUTH_LOGIN_MAX", 6),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS", 15 * 60),
    },
    accountPasswordReset: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_MAX", 4),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_AUTH_PASSWORD_RESET_WINDOW_SECONDS", 60 * 60),
    },
    ticketCreate: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_TICKET_CREATE_MAX", 20),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_TICKET_CREATE_WINDOW_SECONDS", 60 * 60),
    },
    ticketLookup: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_TICKET_LOOKUP_MAX", 120),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_TICKET_LOOKUP_WINDOW_SECONDS", 15 * 60),
    },
    ticketMutation: {
      max: intFromEnv("WHISTLE_RATE_LIMIT_TICKET_MUTATION_MAX", 60),
      windowMs: windowFromEnv("WHISTLE_RATE_LIMIT_TICKET_MUTATION_WINDOW_SECONDS", 15 * 60),
    },
  };
}

function isGatewayBackend(value: string) {
  return ["gateway", "managed", "managed-http", "edge", "cloudflare", "redis-http", "upstash"].includes(value);
}

function isPostgresBackend(value: string) {
  return value === "postgres" || value === "postgresql" || value === "pg";
}

function hashBucketKey(rule: RateLimitRule, salt: string) {
  return createHash("sha256").update(`${salt}:${rule.id}:${rule.key}`).digest("hex");
}

function isRateLimitDecision(value: unknown, fallback: Pick<RateLimitDecision, "limit" | "resetAt">): RateLimitDecision | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<RateLimitDecision>;
  if (typeof payload.allowed !== "boolean") return null;
  const limit = Number.isFinite(payload.limit) && Number(payload.limit) > 0 ? Number(payload.limit) : fallback.limit;
  const remaining = Number.isFinite(payload.remaining) ? Math.max(0, Number(payload.remaining)) : payload.allowed ? Math.max(0, limit - 1) : 0;
  const resetAt = Number.isFinite(payload.resetAt) && Number(payload.resetAt) > 0 ? Number(payload.resetAt) : fallback.resetAt;
  const retryAfterSeconds =
    Number.isFinite(payload.retryAfterSeconds) && Number(payload.retryAfterSeconds) > 0
      ? Number(payload.retryAfterSeconds)
      : Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return { allowed: payload.allowed, limit, remaining, resetAt, retryAfterSeconds };
}

export class DistributedHttpRateLimiter implements PublicRateLimiter {
  readonly mode = "distributed-http-rate-limit";

  constructor(
    private readonly gatewayUrl = gatewayUrlFromEnv(),
    private readonly apiKey = gatewayApiKeyFromEnv(),
    private readonly keySalt = keySaltFromEnv(),
  ) {}

  async healthCheck() {
    if (!this.gatewayUrl) throw new Error("WHISTLE_RATE_LIMIT_GATEWAY_URL is required for distributed public rate limiting.");
    if (!this.apiKey) throw new Error("WHISTLE_RATE_LIMIT_GATEWAY_API_KEY is required for distributed public rate limiting.");
    const response = await this.callGateway({ kind: "health" });
    if (!response.ok) throw new Error(`Distributed rate-limit gateway returned ${response.status}.`);
  }

  async check(rule: RateLimitRule, now = Date.now()): Promise<RateLimitDecision> {
    if (!this.gatewayUrl) throw new Error("WHISTLE_RATE_LIMIT_GATEWAY_URL is required for distributed public rate limiting.");
    if (!this.apiKey) throw new Error("WHISTLE_RATE_LIMIT_GATEWAY_API_KEY is required for distributed public rate limiting.");
    const resetAtFallback = now + rule.windowMs;
    const response = await this.callGateway({
      kind: "check",
      ruleId: rule.id,
      bucketKey: hashBucketKey(rule, this.keySalt),
      limit: rule.max,
      windowMs: rule.windowMs,
      now,
    });
    if (!response.ok) throw new Error(`Distributed rate-limit gateway returned ${response.status}.`);
    const payload = await response.json().catch(() => null);
    const decision = isRateLimitDecision(payload, { limit: rule.max, resetAt: resetAtFallback });
    if (!decision) throw new Error("Distributed rate-limit gateway returned an invalid decision payload.");
    return decision;
  }

  private callGateway(payload: Record<string, unknown>) {
    return fetch(this.gatewayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  }
}

export class PostgresRateLimiter implements PublicRateLimiter {
  readonly mode = "postgres-rate-limit";
  private readonly pool: pg.Pool;
  private lastCleanupAt = 0;

  constructor(
    databaseUrl = process.env.DATABASE_URL,
    private readonly keySalt = keySaltFromEnv(),
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async healthCheck() {
    await this.pool.query("select 1 from public_rate_limit_buckets limit 1");
  }

  async check(rule: RateLimitRule, now = Date.now()): Promise<RateLimitDecision> {
    await this.cleanupExpiredBuckets(now);
    const resetAt = now + rule.windowMs;
    const bucketKey = hashBucketKey(rule, this.keySalt);
    const result = await this.pool.query<{ count: number; reset_at_ms: string }>(
      `
        insert into public_rate_limit_buckets (rule_id, bucket_key, request_count, reset_at, updated_at)
        values ($1, $2, 1, to_timestamp($3 / 1000.0), now())
        on conflict (rule_id, bucket_key) do update
        set
          request_count = case
            when public_rate_limit_buckets.reset_at <= to_timestamp($4 / 1000.0) then 1
            else public_rate_limit_buckets.request_count + 1
          end,
          reset_at = case
            when public_rate_limit_buckets.reset_at <= to_timestamp($4 / 1000.0) then excluded.reset_at
            else public_rate_limit_buckets.reset_at
          end,
          updated_at = now()
        returning request_count as count, (extract(epoch from reset_at) * 1000)::text as reset_at_ms
      `,
      [rule.id, bucketKey, resetAt, now],
    );
    const row = result.rows[0];
    const count = row?.count ?? rule.max + 1;
    const resetAtMs = Number(row?.reset_at_ms ?? resetAt);
    return {
      allowed: count <= rule.max,
      limit: rule.max,
      remaining: Math.max(0, rule.max - count),
      resetAt: resetAtMs,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  }

  async close() {
    await this.pool.end();
  }

  private async cleanupExpiredBuckets(now: number) {
    if (now - this.lastCleanupAt < 60_000) return;
    this.lastCleanupAt = now;
    await this.pool.query("delete from public_rate_limit_buckets where reset_at < now() - interval '5 minutes'");
  }
}

export function publicRateLimitBackendModeFromRuntimeEnv(env: EnvLike = process.env) {
  const backend = backendFromEnv(env);
  if (isGatewayBackend(backend)) return "distributed-http-rate-limit";
  if (isPostgresBackend(backend)) return "postgres-rate-limit";
  if (deploymentRequiresPublicRateLimit(env)) return "public-rate-limit-disabled";
  return "in-memory-rate-limit";
}

export function createPublicRateLimiter(): PublicRateLimiter {
  const backend = backendFromEnv();
  if (isGatewayBackend(backend)) return new DistributedHttpRateLimiter();
  if (isPostgresBackend(backend)) return new PostgresRateLimiter();
  if (deploymentRequiresPublicRateLimit()) return new DisabledPublicRateLimiter();
  return new InMemoryRateLimiter();
}

function normalise(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function bodyPhone(request: FastifyRequest) {
  if (!request.body || typeof request.body !== "object") return "";
  return normalise((request.body as { phone?: unknown }).phone);
}

function bodySurface(request: FastifyRequest) {
  if (!request.body || typeof request.body !== "object") return "";
  return normalise((request.body as { surface?: unknown }).surface);
}

function queryPhone(request: FastifyRequest) {
  if (!request.query || typeof request.query !== "object") return "";
  return normalise((request.query as { phone?: unknown }).phone);
}

function bodyChallengeId(request: FastifyRequest) {
  if (!request.body || typeof request.body !== "object") return "";
  return normalise((request.body as { challengeId?: unknown }).challengeId);
}

function citizenProofPhone(request: FastifyRequest) {
  const value = request.headers["x-whistle-citizen-phone"];
  return normalise(Array.isArray(value) ? value[0] : value);
}

function clientKey(request: FastifyRequest, subject: string) {
  return `${request.ip}:${subject || "anonymous"}`;
}

function accountSubject(request: FastifyRequest) {
  return `${bodySurface(request) || "account"}:${bodyPhone(request)}`;
}

export function publicRateLimitRuleForRequest(request: FastifyRequest, policy: PublicRateLimitPolicy): RateLimitRule | null {
  if (!policy.enabled) return null;

  const path = request.url.split("?")[0];
  if (request.method === "POST" && path === "/api/auth/otp/start") {
    return { id: "auth.otp_start", ...policy.accountOtpStart, key: clientKey(request, accountSubject(request)) };
  }
  if (request.method === "POST" && path === "/api/auth/otp/verify") {
    return { id: "auth.otp_verify", ...policy.accountOtpVerify, key: clientKey(request, bodyChallengeId(request)) };
  }
  if (request.method === "POST" && path === "/api/auth/login") {
    return { id: "auth.login", ...policy.accountLogin, key: clientKey(request, accountSubject(request)) };
  }
  if (request.method === "POST" && path === "/api/auth/password/reset") {
    return { id: "auth.password_reset", ...policy.accountPasswordReset, key: clientKey(request, accountSubject(request)) };
  }
  if (request.method === "POST" && path === "/api/citizen/otp/start") {
    return { id: "citizen.otp_start", ...policy.otpStart, key: clientKey(request, bodyPhone(request)) };
  }
  if (request.method === "POST" && path === "/api/citizen/otp/verify") {
    return { id: "citizen.otp_verify", ...policy.otpVerify, key: clientKey(request, bodyChallengeId(request)) };
  }
  if (request.method === "POST" && path === "/api/tickets") {
    return { id: "citizen.ticket_create", ...policy.ticketCreate, key: clientKey(request, bodyPhone(request)) };
  }
  if (request.method === "GET" && path === "/api/citizen/tickets") {
    return { id: "citizen.ticket_lookup", ...policy.ticketLookup, key: clientKey(request, queryPhone(request)) };
  }
  if (request.method === "POST" && /^\/api\/tickets\/[^/]+\/(citizen-update|reopen-dispute|evidence\/upload-session|evidence\/[^/]+\/complete-upload)$/.test(path)) {
    return { id: "citizen.ticket_mutation", ...policy.ticketMutation, key: clientKey(request, citizenProofPhone(request) || path) };
  }
  return null;
}

export function sendRateLimitHeaders(reply: FastifyReply, decision: RateLimitDecision) {
  reply.header("ratelimit-limit", String(decision.limit));
  reply.header("ratelimit-remaining", String(decision.remaining));
  reply.header("ratelimit-reset", String(Math.ceil(decision.resetAt / 1000)));
  if (!decision.allowed) reply.header("retry-after", String(decision.retryAfterSeconds));
}
