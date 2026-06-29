type EnvLike = Record<string, string | undefined>;

export type GovernmentPasswordAuthMode =
  | "local-passwords-enabled"
  | "disabled-production-profile"
  | "disabled-persistent-runtime"
  | "disabled-unrecognised-profile";

const localProfiles = new Set(["local", "development", "dev", "test"]);
const productionLikeProfiles = new Set(["production", "prod", "staging", "stage", "pilot", "uat"]);

function normalise(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function deploymentProfile(env: EnvLike) {
  return normalise(env.WHISTLE_DEPLOYMENT_PROFILE) || normalise(env.WHISTLE_ENV) || normalise(env.NODE_ENV);
}

export function governmentPasswordAuthModeFromEnv(env: EnvLike = process.env): GovernmentPasswordAuthMode {
  const profile = deploymentProfile(env);
  if (productionLikeProfiles.has(profile)) return "disabled-production-profile";
  if (localProfiles.has(profile)) return "local-passwords-enabled";
  if (!profile && !env.DATABASE_URL?.trim()) return "local-passwords-enabled";
  if (!profile && env.DATABASE_URL?.trim()) return "disabled-persistent-runtime";
  return "disabled-unrecognised-profile";
}

export function governmentPasswordAuthEnabled(env: EnvLike = process.env) {
  return governmentPasswordAuthModeFromEnv(env) === "local-passwords-enabled";
}

export function governmentPasswordAuthDisabledMessage(mode = governmentPasswordAuthModeFromEnv()) {
  if (mode === "disabled-persistent-runtime") {
    return "Government mobile/password login is restricted to explicit TEST, local UAT, or local development profiles; persistent staging/production runtimes must use approved OIDC/MFA.";
  }
  if (mode === "disabled-unrecognised-profile") {
    return "Government mobile/password login is restricted to TEST/local UAT; this deployment profile is not allowlisted.";
  }
  return "Government mobile/password login is restricted to TEST/local UAT; staging and production must use approved OIDC/MFA.";
}
