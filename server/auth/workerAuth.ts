import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

export type WorkerAuthMode = "prototype-open" | "shared-token" | "shared-token-missing";

type EnvLike = Record<string, string | undefined>;

type AuthDecision = {
  allowed: boolean;
  reason?: string;
};

function normalise(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isTruthy(value: string | undefined) {
  return ["1", "true", "yes", "required", "enabled"].includes(normalise(value));
}

function deploymentRequiresWorkerAuth(env: EnvLike) {
  const value = normalise(env.WHISTLE_DEPLOYMENT_PROFILE ?? env.WHISTLE_ENV ?? env.NODE_ENV);
  return value === "production" || value === "prod" || value === "staging" || value === "stage" || value === "pilot" || value === "uat" || value === "test" || value === "testing" || value === "qa";
}

function configuredSecret(env: EnvLike) {
  return env.WHISTLE_WORKER_SHARED_SECRET?.trim() || env.WHISTLE_WORKER_TOKEN?.trim() || "";
}

function headerValue(request: FastifyRequest, name: string) {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function presentedToken(request: FastifyRequest) {
  const directToken = headerValue(request, "x-whistle-worker-token")?.trim();
  if (directToken) return directToken;
  const authorization = headerValue(request, "authorization")?.trim();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function tokenMatches(presented: string, secret: string) {
  if (!presented || !secret) return false;
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(secret).digest();
  return timingSafeEqual(left, right);
}

function allow(): AuthDecision {
  return { allowed: true };
}

function deny(reason: string): AuthDecision {
  return { allowed: false, reason };
}

export function workerAuthMode(env: EnvLike = process.env): WorkerAuthMode {
  if (configuredSecret(env)) return "shared-token";
  if (isTruthy(env.WHISTLE_WORKER_AUTH_REQUIRED) || deploymentRequiresWorkerAuth(env)) return "shared-token-missing";
  return "prototype-open";
}

export async function workerAuthHealthCheck(env: EnvLike = process.env) {
  const mode = workerAuthMode(env);
  if (mode === "shared-token-missing") {
    throw new Error("Worker job authentication is required, but WHISTLE_WORKER_SHARED_SECRET is not configured.");
  }
}

export function authorizeWorkerRequest(request: FastifyRequest, env: EnvLike = process.env): AuthDecision {
  const mode = workerAuthMode(env);
  if (mode === "prototype-open") return allow();
  if (mode === "shared-token-missing") {
    return deny("Worker job authentication is required, but WHISTLE_WORKER_SHARED_SECRET is not configured.");
  }
  return tokenMatches(presentedToken(request), configuredSecret(env))
    ? allow()
    : deny("Worker job authentication failed. Provide a valid x-whistle-worker-token or Bearer token.");
}
