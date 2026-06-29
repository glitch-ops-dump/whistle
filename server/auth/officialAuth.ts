import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type OfficialAuthMode = "prototype-headers" | "prototype-disabled" | "oidc-jwt";

type EnvLike = Record<string, string | undefined>;

type OidcConfig = {
  issuer: string;
  audience: string;
  actorClaim: string;
  roleClaim: string;
  requireMfa: boolean;
  hs256Secret?: string;
  jwksUrl?: string;
};

export type OfficialAuthResult =
  | {
      ok: true;
      actor: string;
      role: string;
      subject: string;
      mfa: true;
    }
  | {
      ok: false;
      reason: string;
    };

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function envValue(env: EnvLike, key: string) {
  return env[key]?.trim() || "";
}

function normalise(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isFalse(value: string | undefined) {
  return ["0", "false", "no", "disabled"].includes(normalise(value));
}

function deploymentRequiresOfficialAuth(env: EnvLike) {
  const value = normalise(env.WHISTLE_DEPLOYMENT_PROFILE) || normalise(env.WHISTLE_ENV) || normalise(env.NODE_ENV);
  return ["production", "prod", "staging", "stage", "pilot", "uat"].includes(value);
}

function configuredOidc(env: EnvLike = process.env): OidcConfig | null {
  const issuer = envValue(env, "WHISTLE_OFFICIAL_OIDC_ISSUER");
  const audience = envValue(env, "WHISTLE_OFFICIAL_OIDC_AUDIENCE");
  const hs256Secret = envValue(env, "WHISTLE_OFFICIAL_OIDC_HS256_SECRET");
  const jwksUrl = envValue(env, "WHISTLE_OFFICIAL_OIDC_JWKS_URL");
  if (!issuer || !audience || (!hs256Secret && !jwksUrl)) return null;
  return {
    issuer,
    audience,
    hs256Secret: hs256Secret || undefined,
    jwksUrl: jwksUrl || undefined,
    actorClaim: envValue(env, "WHISTLE_OFFICIAL_OIDC_ACTOR_CLAIM") || "sub",
    roleClaim: envValue(env, "WHISTLE_OFFICIAL_OIDC_ROLE_CLAIM") || "whistle_role",
    requireMfa: !isFalse(env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED),
  };
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  const authorization = Array.isArray(value) ? value[0] : value;
  const match = authorization?.trim().match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function getClaim(payload: JWTPayload, name: string) {
  const value = payload[name as keyof JWTPayload];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function hasMfa(payload: JWTPayload) {
  if (payload.whistle_mfa === true) return true;
  if (typeof payload.acr === "string" && /mfa|multi|level[ _-]?2|aal[ _-]?2/i.test(payload.acr)) return true;
  const amr = payload.amr;
  if (Array.isArray(amr)) {
    return amr.some((item) => typeof item === "string" && /mfa|otp|totp|webauthn|fido|hwk/i.test(item));
  }
  return false;
}

function remoteJwks(config: OidcConfig) {
  if (!config.jwksUrl) throw new Error("OIDC JWKS URL is not configured.");
  const cached = jwksCache.get(config.jwksUrl);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  jwksCache.set(config.jwksUrl, jwks);
  return jwks;
}

export function prototypeOfficialAuthEnabled(env: EnvLike = process.env) {
  return officialAuthMode(env) !== "prototype-disabled";
}

export function officialAuthMode(env: EnvLike = process.env): OfficialAuthMode {
  if (configuredOidc(env)) return "oidc-jwt";
  return env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH === "false" || deploymentRequiresOfficialAuth(env) ? "prototype-disabled" : "prototype-headers";
}

export async function verifyOfficialAuthRequest(request: FastifyRequest, env: EnvLike = process.env): Promise<OfficialAuthResult> {
  const config = configuredOidc(env);
  if (!config) return { ok: false, reason: officialAuthDisabledReason };
  const token = bearerToken(request);
  if (!token) return { ok: false, reason: "Official OIDC bearer token is required." };

  try {
    const verifyOptions = {
      issuer: config.issuer,
      audience: config.audience,
    };
    const { payload } = config.jwksUrl
      ? await jwtVerify(token, remoteJwks(config), verifyOptions)
      : await jwtVerify(token, new TextEncoder().encode(config.hs256Secret), verifyOptions);
    if (config.requireMfa && !hasMfa(payload)) {
      return { ok: false, reason: "Official OIDC token is missing an MFA assurance claim." };
    }
    const actor = getClaim(payload, config.actorClaim);
    const role = getClaim(payload, config.roleClaim);
    if (!actor) return { ok: false, reason: `Official OIDC token is missing actor claim '${config.actorClaim}'.` };
    if (!role) return { ok: false, reason: `Official OIDC token is missing role claim '${config.roleClaim}'.` };
    return {
      ok: true,
      actor,
      role,
      subject: payload.sub ?? actor,
      mfa: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Official OIDC token verification failed: ${message}` };
  }
}

export async function officialAuthHealthCheck(env: EnvLike = process.env) {
  const mode = officialAuthMode(env);
  if (mode === "prototype-disabled") {
    throw new Error("Prototype official header authentication is disabled and no approved government identity provider is configured.");
  }
}

export const officialAuthDisabledReason =
  "Government API access requires a valid Whistle account session or an approved OIDC/MFA provider; prototype official headers are disabled.";
