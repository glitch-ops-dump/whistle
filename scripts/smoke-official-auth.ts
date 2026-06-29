import { SignJWT } from "jose";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  prototypeOfficialAuth: process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH,
  deploymentProfile: process.env.WHISTLE_DEPLOYMENT_PROFILE,
  env: process.env.WHISTLE_ENV,
  nodeEnv: process.env.NODE_ENV,
  seedDemo: process.env.WHISTLE_SEED_DEMO,
  issuer: process.env.WHISTLE_OFFICIAL_OIDC_ISSUER,
  audience: process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE,
  secret: process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET,
  jwks: process.env.WHISTLE_OFFICIAL_OIDC_JWKS_URL,
  mfaRequired: process.env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED,
  rateLimitEnabled: process.env.WHISTLE_RATE_LIMIT_ENABLED,
};

process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.WHISTLE_SEED_DEMO = "false";
delete process.env.DATABASE_URL;
delete process.env.WHISTLE_OFFICIAL_OIDC_ISSUER;
delete process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE;
delete process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET;
delete process.env.WHISTLE_OFFICIAL_OIDC_JWKS_URL;
delete process.env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED;
delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
delete process.env.WHISTLE_ENV;
delete process.env.NODE_ENV;

const { buildWhistleApi } = await import("../server/app.js");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

async function withApp<T>(run: (app: ReturnType<typeof buildWhistleApi>) => Promise<T>) {
  const app = buildWhistleApi();
  await app.ready();
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

async function signOfficialToken(input: { actor: string; role: string; mfa: boolean }) {
  const secret = new TextEncoder().encode("official-auth-smoke-secret");
  const payload = input.mfa
    ? { whistle_role: input.role, amr: ["pwd", "mfa"] }
    : { whistle_role: input.role, amr: ["pwd"] };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.actor)
    .setIssuer("https://id.tn.example.gov/realms/whistle")
    .setAudience("whistle-government-console")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

try {
  process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH = "false";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Readiness returned ${readiness.statusCode}; expected 503 when official auth is disabled. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "official_auth" && dependency.mode === "prototype-disabled" && !dependency.ok),
      "Readiness should fail the official_auth dependency when prototype official auth is disabled.",
    );

    const adminConfig = await app.inject({
      method: "GET",
      url: "/api/admin/config",
      headers: {
        "x-whistle-role": "admin",
        "x-whistle-actor": "admin:prototype",
      },
    });
    assert(adminConfig.statusCode === 403, `Admin config returned ${adminConfig.statusCode}; expected 403. Body: ${adminConfig.body}`);
    assert(
      adminConfig.json<{ reason?: string }>().reason?.includes("prototype official headers are disabled"),
      "Government API rejection should explain that prototype official headers are disabled.",
    );

    const citizenConfig = await app.inject({ method: "GET", url: "/api/citizen/config" });
    assert(citizenConfig.statusCode === 200, `Citizen config returned ${citizenConfig.statusCode}; expected 200. Body: ${citizenConfig.body}`);
  });
  pass("prototype official-auth kill switch blocks government APIs while preserving citizen public intake");

  delete process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH;
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "production";
  process.env.WHISTLE_RATE_LIMIT_ENABLED = "false";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 503, `Production-profile readiness returned ${readiness.statusCode}; expected 503 without OIDC. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "official_auth" && dependency.mode === "prototype-disabled" && !dependency.ok),
      "Production profile should fail the official_auth dependency when OIDC is missing.",
    );

    const adminConfig = await app.inject({
      method: "GET",
      url: "/api/admin/config",
      headers: {
        "x-whistle-role": "admin",
        "x-whistle-actor": "admin:prototype",
      },
    });
    assert(adminConfig.statusCode === 403, `Production-profile admin config returned ${adminConfig.statusCode}; expected 403. Body: ${adminConfig.body}`);
    assert(
      adminConfig.json<{ reason?: string }>().reason?.includes("prototype official headers are disabled"),
      "Production profile should reject prototype official headers before grant checks.",
    );

    const governmentLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        surface: "government",
        phone: "+91 90000 25005",
        password: "Whistle@123",
        role: "admin",
      },
    });
    assert(governmentLogin.statusCode === 403, `Production-profile government login returned ${governmentLogin.statusCode}; expected 403. Body: ${governmentLogin.body}`);
    assert(
      governmentLogin.json<{ error?: string }>().error === "government_password_auth_disabled",
      "Production profile should reject seeded government mobile/password login before credential verification.",
    );

    const citizenConfig = await app.inject({ method: "GET", url: "/api/citizen/config" });
    assert(citizenConfig.statusCode === 200, `Production-profile citizen config returned ${citizenConfig.statusCode}; expected 200. Body: ${citizenConfig.body}`);
  });
  pass("production profile disables prototype government headers even when the startup preflight path is bypassed");
  if (originalEnv.rateLimitEnabled === undefined) delete process.env.WHISTLE_RATE_LIMIT_ENABLED;
  else process.env.WHISTLE_RATE_LIMIT_ENABLED = originalEnv.rateLimitEnabled;

  process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH = "false";
  delete process.env.WHISTLE_DEPLOYMENT_PROFILE;

  process.env.WHISTLE_OFFICIAL_OIDC_ISSUER = "https://id.tn.example.gov/realms/whistle";
  process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE = "whistle-government-console";
  process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET = "official-auth-smoke-secret";

  await withApp(async (app) => {
    const readiness = await app.inject({ method: "GET", url: "/api/ready" });
    assert(readiness.statusCode === 200, `OIDC readiness returned ${readiness.statusCode}; expected 200. Body: ${readiness.body}`);
    assert(
      readiness
        .json<{ dependencies: Array<{ name: string; mode: string; ok: boolean; error?: string }> }>()
        .dependencies.some((dependency) => dependency.name === "official_auth" && dependency.mode === "oidc-jwt" && dependency.ok),
      "Readiness should report official_auth as oidc-jwt when OIDC issuer/audience/signing config is present.",
    );

    const missingBearer = await app.inject({
      method: "GET",
      url: "/api/admin/config",
      headers: {
        "x-whistle-role": "admin",
        "x-whistle-actor": "admin:prototype",
      },
    });
    assert(missingBearer.statusCode === 403, `Missing OIDC bearer returned ${missingBearer.statusCode}; expected 403. Body: ${missingBearer.body}`);

    const noMfaToken = await signOfficialToken({ actor: "admin:prototype", role: "admin", mfa: false });
    const noMfa = await app.inject({
      method: "GET",
      url: "/api/admin/config",
      headers: {
        authorization: `Bearer ${noMfaToken}`,
      },
    });
    assert(noMfa.statusCode === 403, `No-MFA OIDC token returned ${noMfa.statusCode}; expected 403. Body: ${noMfa.body}`);
    assert(noMfa.json<{ reason?: string }>().reason?.includes("MFA"), "No-MFA OIDC rejection should mention MFA assurance.");

    const token = await signOfficialToken({ actor: "admin:prototype", role: "admin", mfa: true });
    const adminConfig = await app.inject({
      method: "GET",
      url: "/api/admin/config",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert(adminConfig.statusCode === 200, `OIDC admin config returned ${adminConfig.statusCode}; expected 200. Body: ${adminConfig.body}`);
    assert(adminConfig.json<{ mode: string }>().mode === "mvp-dev-memory", "OIDC-authenticated admin should reach the configured Admin repository.");

    const ministerToken = await signOfficialToken({ actor: "minister:prototype", role: "minister", mfa: true });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/config",
      headers: {
        authorization: `Bearer ${ministerToken}`,
      },
    });
    assert(forbidden.statusCode === 403, `OIDC minister admin config returned ${forbidden.statusCode}; expected 403. Body: ${forbidden.body}`);
  });
  pass("OIDC official auth verifies issuer, audience, MFA, role, actor, and access grants");
} finally {
  if (originalEnv.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalEnv.logLevel;
  if (originalEnv.prototypeOfficialAuth === undefined) delete process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH;
  else process.env.WHISTLE_PROTOTYPE_OFFICIAL_AUTH = originalEnv.prototypeOfficialAuth;
  if (originalEnv.deploymentProfile === undefined) delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
  else process.env.WHISTLE_DEPLOYMENT_PROFILE = originalEnv.deploymentProfile;
  if (originalEnv.env === undefined) delete process.env.WHISTLE_ENV;
  else process.env.WHISTLE_ENV = originalEnv.env;
  if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.seedDemo === undefined) delete process.env.WHISTLE_SEED_DEMO;
  else process.env.WHISTLE_SEED_DEMO = originalEnv.seedDemo;
  if (originalEnv.issuer === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_ISSUER;
  else process.env.WHISTLE_OFFICIAL_OIDC_ISSUER = originalEnv.issuer;
  if (originalEnv.audience === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE;
  else process.env.WHISTLE_OFFICIAL_OIDC_AUDIENCE = originalEnv.audience;
  if (originalEnv.secret === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET;
  else process.env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET = originalEnv.secret;
  if (originalEnv.jwks === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_JWKS_URL;
  else process.env.WHISTLE_OFFICIAL_OIDC_JWKS_URL = originalEnv.jwks;
  if (originalEnv.mfaRequired === undefined) delete process.env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED;
  else process.env.WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED = originalEnv.mfaRequired;
  if (originalEnv.rateLimitEnabled === undefined) delete process.env.WHISTLE_RATE_LIMIT_ENABLED;
  else process.env.WHISTLE_RATE_LIMIT_ENABLED = originalEnv.rateLimitEnabled;
}
