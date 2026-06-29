import { SignJWT } from "jose";
import type { GovRole } from "../ticket-spine/types.js";

type EnvLike = Record<string, string | undefined>;

const localUatIssuer = "https://id.local.whistle.test/realms/whistle";

function envValue(env: EnvLike, key: string) {
  return env[key]?.trim() || "";
}

function normalise(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function localUatOfficialTokenBootstrapEnabled(env: EnvLike = process.env) {
  const profile = normalise(env.WHISTLE_DEPLOYMENT_PROFILE ?? env.WHISTLE_ENV ?? env.NODE_ENV);
  const issuer = envValue(env, "WHISTLE_OFFICIAL_OIDC_ISSUER");
  const audience = envValue(env, "WHISTLE_OFFICIAL_OIDC_AUDIENCE");
  const secret = envValue(env, "WHISTLE_OFFICIAL_OIDC_HS256_SECRET");
  const localProfile = profile === "local" || profile === "development" || profile === "dev" || profile === "test";
  const smokeSecret = secret.includes("local") && secret.includes("smoke") && secret.includes("do-not-use");
  return localProfile && issuer === localUatIssuer && Boolean(audience) && smokeSecret;
}

export async function createLocalUatOfficialToken(input: {
  actor: string;
  role: GovRole;
  env?: EnvLike;
  expiresIn?: string;
  mfa?: boolean;
}) {
  const env = input.env ?? process.env;
  const issuer = envValue(env, "WHISTLE_OFFICIAL_OIDC_ISSUER");
  const audience = envValue(env, "WHISTLE_OFFICIAL_OIDC_AUDIENCE");
  const secret = envValue(env, "WHISTLE_OFFICIAL_OIDC_HS256_SECRET");
  if (!localUatOfficialTokenBootstrapEnabled(env)) {
    throw new Error("Local UAT official-token bootstrap is not enabled for this runtime.");
  }
  return new SignJWT({
    whistle_role: input.role,
    amr: input.mfa === false ? ["pwd"] : ["pwd", "mfa"],
    whistle_local_uat: true,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.actor)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(input.expiresIn ?? "2h")
    .sign(new TextEncoder().encode(secret));
}
