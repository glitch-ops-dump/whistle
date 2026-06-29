import type { FastifyReply } from "fastify";
import type { DeploymentProfile } from "../config/deploymentPreflight.js";

type EnvLike = Record<string, string | undefined>;

export type CorsOriginPolicy = {
  mode: "allow-all-local" | "allow-list";
  origins: string[];
};

function splitOrigins(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsOriginPolicyFromEnv(env: EnvLike = process.env): CorsOriginPolicy {
  const origins = splitOrigins(env.WHISTLE_ALLOWED_ORIGINS ?? env.WHISTLE_CORS_ALLOWED_ORIGINS);
  if (origins.length) return { mode: "allow-list", origins };
  return { mode: "allow-all-local", origins: [] };
}

export function securityHeadersEnabledFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_SECURITY_HEADERS_ENABLED !== "false";
}

function deploymentProfileFromEnv(env: EnvLike = process.env): DeploymentProfile {
  const value = (env.WHISTLE_DEPLOYMENT_PROFILE ?? env.WHISTLE_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  if (value === "production" || value === "prod") return "production";
  if (value === "staging" || value === "stage" || value === "pilot" || value === "uat") return "staging";
  if (value === "test" || value === "testing" || value === "qa") return "test";
  return "local";
}

export function hstsEnabledForProfile(profile: DeploymentProfile, env: EnvLike = process.env) {
  return profile !== "local" && env.WHISTLE_HSTS_ENABLED !== "false";
}

export function applyApiSecurityHeaders(reply: FastifyReply, env: EnvLike = process.env) {
  if (!securityHeadersEnabledFromEnv(env)) return;
  const profile = deploymentProfileFromEnv(env);
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("cross-origin-resource-policy", "same-origin");
  reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  reply.header("cache-control", "no-store");
  if (hstsEnabledForProfile(profile, env)) {
    reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}
