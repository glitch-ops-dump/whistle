import { officialAuthMode } from "../auth/officialAuth.js";
import { governmentPasswordAuthModeFromEnv } from "../auth/governmentPasswordAuth.js";
import { otpDeliveryModeFromRuntimeEnv } from "../citizen-verification/otpDelivery.js";
import { evidenceObjectStoreModeFromRuntimeEnv } from "../evidence/objectStore.js";
import { notificationDeliveryModeFromRuntimeEnv } from "../notifications/provider.js";
import { securityExportModeFromRuntimeEnv } from "../observability/securityExport.js";
import { telemetryExportModeFromRuntimeEnv } from "../observability/telemetryExport.js";
import { corsOriginPolicyFromEnv, securityHeadersEnabledFromEnv } from "../security/httpHardening.js";
import { DEFAULT_RATE_LIMIT_KEY_SALT, publicRateLimitBackendModeFromRuntimeEnv } from "../security/rateLimit.js";
import { workerAuthMode } from "../auth/workerAuth.js";

export type DeploymentProfile = "local" | "test" | "staging" | "production";
export type DeploymentPreflightStatus = "pass" | "warning" | "blocker";
export type DeploymentPreflightArea =
  | "data"
  | "identity"
  | "citizen_verification"
  | "evidence"
  | "notifications"
  | "network"
  | "performance"
  | "operations"
  | "observability";

export type DeploymentPreflightRuntime = {
  ticketSpineMode: string;
  configMode: string;
  accessMode: string;
  phoneVerificationMode: string;
  officialAuthMode: string;
  governmentPasswordAuthMode: string;
  workerAuthMode: string;
  otpDeliveryMode: string;
  otpExposesOtpToApi: boolean;
  evidenceObjectStoreMode: string;
  notificationDeliveryMode: string;
  securityExportMode: string;
  telemetryExportMode: string;
  publicRateLimitEnabled: boolean;
  publicRateLimitBackend: string;
  corsOriginMode: string;
  securityHeadersEnabled: boolean;
  databaseUrlConfigured: boolean;
};

export type DeploymentPreflightCheck = {
  id: string;
  area: DeploymentPreflightArea;
  label: string;
  status: DeploymentPreflightStatus;
  message: string;
  observed: string;
  remediation: string;
};

export type DeploymentPreflightReport = {
  service: "whistle-ticket-spine";
  generatedAt: string;
  profile: DeploymentProfile;
  productionTarget: boolean;
  productionReady: boolean;
  summary: {
    blockers: number;
    warnings: number;
    passes: number;
  };
  checks: DeploymentPreflightCheck[];
  nextActions: string[];
};

type EnvLike = Record<string, string | undefined>;

function normalise(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isTruthy(value: string | undefined) {
  return ["1", "true", "yes", "ready", "enabled"].includes(normalise(value));
}

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function isIsoDateTime(value: string | undefined) {
  if (!value?.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && value.includes("T");
}

function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function rateLimitKeySaltState(env: EnvLike) {
  const salt = env.WHISTLE_RATE_LIMIT_KEY_SALT?.trim();
  if (!salt) return "missing";
  if (salt === DEFAULT_RATE_LIMIT_KEY_SALT) return "default";
  if (salt.length < 16) return "too-short";
  return "custom";
}

function httpsUrlState(value: string | undefined, missingLabel: string) {
  if (!value?.trim()) return missingLabel;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? "https" : "non-https";
  } catch {
    return "invalid";
  }
}

function officialOidcSigningSourceState(env: EnvLike) {
  const issuerState = httpsUrlState(env.WHISTLE_OFFICIAL_OIDC_ISSUER, "issuer-missing");
  const jwksState = httpsUrlState(env.WHISTLE_OFFICIAL_OIDC_JWKS_URL, "jwks-missing");
  const hasAudience = hasValue(env.WHISTLE_OFFICIAL_OIDC_AUDIENCE);
  const hasHs256Secret = hasValue(env.WHISTLE_OFFICIAL_OIDC_HS256_SECRET);
  if (issuerState !== "https") return issuerState === "issuer-missing" ? "issuer-missing" : `issuer-${issuerState}`;
  if (!hasAudience) return "audience-missing";
  if (jwksState === "https" && hasHs256Secret) return "jwks-https-with-hs256-secret";
  if (jwksState === "https") return "jwks-https";
  if (jwksState !== "jwks-missing") return `jwks-${jwksState}`;
  if (hasHs256Secret) return "hs256-secret";
  return "jwks-missing";
}

const deploymentSecretMaterialKeys = [
  "DATABASE_URL",
  "WHISTLE_OFFICIAL_OIDC_ISSUER",
  "WHISTLE_OFFICIAL_OIDC_JWKS_URL",
  "WHISTLE_OFFICIAL_OIDC_HS256_SECRET",
  "WHISTLE_WORKER_SHARED_SECRET",
  "WHISTLE_WORKER_TOKEN",
  "WHISTLE_OTP_PROVIDER_WEBHOOK_URL",
  "WHISTLE_OTP_PROVIDER_API_KEY",
  "WHISTLE_EVIDENCE_S3_ENDPOINT",
  "WHISTLE_EVIDENCE_S3_BUCKET",
  "WHISTLE_EVIDENCE_STORE_DIR",
  "WHISTLE_EVIDENCE_KMS_KEY_ID",
  "WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL",
  "WHISTLE_NOTIFICATION_PROVIDER_API_KEY",
  "WHISTLE_RATE_LIMIT_GATEWAY_URL",
  "WHISTLE_RATE_LIMIT_GATEWAY_API_KEY",
  "WHISTLE_RATE_LIMIT_KEY_SALT",
  "WHISTLE_ALLOWED_ORIGINS",
  "WHISTLE_CORS_ALLOWED_ORIGINS",
  "WHISTLE_SECURITY_EXPORT_WEBHOOK_URL",
  "WHISTLE_SECURITY_EXPORT_API_KEY",
  "WHISTLE_AUDIT_EXPORT_WEBHOOK_URL",
  "WHISTLE_AUDIT_EXPORT_API_KEY",
  "WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
] as const;

function hasTemplatePlaceholderValue(value: string | undefined) {
  const normalized = normalise(value);
  if (!normalized) return false;
  return (
    normalized.includes("replace_with") ||
    normalized.includes("replace-with") ||
    normalized.includes("secret-manager") ||
    normalized.includes("placeholder") ||
    normalized.includes("changeme") ||
    normalized.includes("change_me") ||
    normalized.includes("dummy") ||
    normalized.includes("todo") ||
    normalized.includes("tbd") ||
    normalized.includes("example.com") ||
    normalized.includes("example.org") ||
    normalized.includes("example.net") ||
    normalized.includes("example.gov") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("0.0.0.0") ||
    normalized.includes("deployment-preflight-smoke") ||
    normalized.includes("smoke-secret") ||
    normalized.includes("smoke-key") ||
    normalized === "secret" ||
    normalized === "token" ||
    normalized === "password"
  );
}

function deploymentSecretMaterialPlaceholders(env: EnvLike) {
  return deploymentSecretMaterialKeys.filter((key) => hasTemplatePlaceholderValue(env[key]));
}

function backupRestoreDrillFreshness(env: EnvLike, now = Date.now()) {
  const raw = env.WHISTLE_BACKUP_RESTORE_DRILL_AT;
  if (!raw?.trim()) return "missing";
  if (!isIsoDateTime(raw)) return "invalid";
  const timestamp = Date.parse(raw);
  if (timestamp > now + 5 * 60 * 1000) return "future";
  const maxAgeDays = numberFromEnv(env.WHISTLE_BACKUP_RESTORE_DRILL_MAX_AGE_DAYS, 30);
  const ageMs = now - timestamp;
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000 ? "current" : "stale";
}

function deploymentValue(env: EnvLike) {
  return normalise(env.WHISTLE_DEPLOYMENT_PROFILE) || normalise(env.WHISTLE_ENV) || normalise(env.NODE_ENV);
}

export function resolveDeploymentProfile(env: EnvLike = process.env): DeploymentProfile {
  const value = deploymentValue(env);
  if (value === "production" || value === "prod") return "production";
  if (value === "staging" || value === "stage" || value === "pilot" || value === "uat") return "staging";
  if (value === "test" || value === "testing" || value === "qa") return "test";
  return "local";
}

function isLocalOrTestProfile(profile: DeploymentProfile) {
  return profile === "local" || profile === "test";
}

function testProfileAllowsHiddenMockOtp(profile: DeploymentProfile, mode: string) {
  return profile === "test" && mode === "mock-sms-hidden";
}

function testProfileAllowsLocalEvidenceStore(profile: DeploymentProfile, mode: string) {
  return profile === "test" && mode === "local-mock-object-store";
}

function testProfileAllowsMockNotifications(profile: DeploymentProfile, mode: string) {
  return profile === "test" && mode === "mvp-mock-notification-provider";
}

function testProfileAllowsLocalSecurityExport(profile: DeploymentProfile, mode: string) {
  return profile === "test" && mode === "mvp-local-security-export";
}

function testProfileAllowsLocalTelemetry(profile: DeploymentProfile, mode: string) {
  return profile === "test" && mode === "mvp-local-telemetry";
}

function check(input: {
  id: string;
  area: DeploymentPreflightArea;
  label: string;
  ok: boolean;
  passMessage: string;
  failMessage: string;
  observed: string;
  remediation: string;
  failStatus?: Exclude<DeploymentPreflightStatus, "pass">;
}): DeploymentPreflightCheck {
  return {
    id: input.id,
    area: input.area,
    label: input.label,
    status: input.ok ? "pass" : input.failStatus ?? "blocker",
    message: input.ok ? input.passMessage : input.failMessage,
    observed: input.observed,
    remediation: input.remediation,
  };
}

function modeList(runtime: DeploymentPreflightRuntime) {
  return [
    runtime.ticketSpineMode,
    runtime.configMode,
    runtime.accessMode,
    runtime.phoneVerificationMode,
  ];
}

function hasProductionMode(mode: string) {
  const value = normalise(mode);
  return !value.includes("mock") && !value.includes("prototype") && !value.includes("disabled") && !value.includes("local") && !value.includes("dev") && !value.includes("unimplemented");
}

function isDistributedRateLimitBackend(value: string) {
  return ["distributed-http-rate-limit", "postgres-rate-limit", "redis", "redis-http", "upstash", "edge", "gateway", "cloudflare", "managed", "postgres"].includes(normalise(value));
}

export function deploymentPreflightRuntimeFromEnv(env: EnvLike = process.env): DeploymentPreflightRuntime {
  const databaseUrlConfigured = Boolean(env.DATABASE_URL?.trim());
  const otpDeliveryMode = otpDeliveryModeFromRuntimeEnv(env);
  const otpExposesOtpToApi = otpDeliveryMode === "mock-sms-exposed";
  const corsOriginPolicy = corsOriginPolicyFromEnv(env);
  return {
    ticketSpineMode: databaseUrlConfigured ? "mvp-postgres" : "mvp-dev-memory",
    configMode: databaseUrlConfigured ? "mvp-postgres" : "mvp-dev-memory",
    accessMode: databaseUrlConfigured ? "mvp-access-postgres" : "mvp-access-dev-memory",
    phoneVerificationMode: databaseUrlConfigured ? "mvp-postgres" : "mvp-dev-memory",
    officialAuthMode: officialAuthMode(env),
    governmentPasswordAuthMode: governmentPasswordAuthModeFromEnv(env),
    workerAuthMode: workerAuthMode(env),
    otpDeliveryMode,
    otpExposesOtpToApi,
    evidenceObjectStoreMode: evidenceObjectStoreModeFromRuntimeEnv(env),
    notificationDeliveryMode: notificationDeliveryModeFromRuntimeEnv(env),
    securityExportMode: securityExportModeFromRuntimeEnv(env),
    telemetryExportMode: telemetryExportModeFromRuntimeEnv(env),
    publicRateLimitEnabled: env.WHISTLE_RATE_LIMIT_ENABLED !== "false",
    publicRateLimitBackend: publicRateLimitBackendModeFromRuntimeEnv(env),
    corsOriginMode: corsOriginPolicy.mode === "allow-list" ? `allow-list:${corsOriginPolicy.origins.length}` : corsOriginPolicy.mode,
    securityHeadersEnabled: securityHeadersEnabledFromEnv(env),
    databaseUrlConfigured,
  };
}

export function createDeploymentPreflightReport(runtime: DeploymentPreflightRuntime, env: EnvLike = process.env): DeploymentPreflightReport {
  const profile = resolveDeploymentProfile(env);
  const persistenceModes = modeList(runtime);
  const postgresBacked = runtime.databaseUrlConfigured && persistenceModes.every((mode) => normalise(mode).includes("postgres"));
  const corsOriginPolicy = corsOriginPolicyFromEnv(env);
  const secretMaterialPlaceholders = deploymentSecretMaterialPlaceholders(env);
  const testAccountAuthEnabled = profile === "test" && runtime.governmentPasswordAuthMode === "local-passwords-enabled";
  const officialIdentityOk = hasProductionMode(runtime.officialAuthMode) || testAccountAuthEnabled;
  const oidcSigningOk = isLocalOrTestProfile(profile) || officialOidcSigningSourceState(env) === "jwks-https";
  const otpProviderOk = hasProductionMode(runtime.otpDeliveryMode) || testProfileAllowsHiddenMockOtp(profile, runtime.otpDeliveryMode);
  const evidenceObjectStoreOk = hasProductionMode(runtime.evidenceObjectStoreMode) || testProfileAllowsLocalEvidenceStore(profile, runtime.evidenceObjectStoreMode);
  const evidenceScanningOk =
    (testProfileAllowsLocalEvidenceStore(profile, runtime.evidenceObjectStoreMode) && !env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE?.trim()) ||
    (Boolean(env.WHISTLE_EVIDENCE_KMS_KEY_ID?.trim()) && isTruthy(env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED));
  const notificationProviderOk =
    hasProductionMode(runtime.notificationDeliveryMode) || testProfileAllowsMockNotifications(profile, runtime.notificationDeliveryMode);
  const securityExportOk = hasProductionMode(runtime.securityExportMode) || testProfileAllowsLocalSecurityExport(profile, runtime.securityExportMode);
  const telemetryExportOk = hasProductionMode(runtime.telemetryExportMode) || testProfileAllowsLocalTelemetry(profile, runtime.telemetryExportMode);
  const checks: DeploymentPreflightCheck[] = [
    check({
      id: "database_persistence",
      area: "data",
      label: "Postgres-backed ticket spine",
      ok: postgresBacked,
      passMessage: "Ticket, config, access, and phone-verification state are using Postgres-backed repositories.",
      failMessage: "One or more core repositories are still using in-memory/local state. High-volume production needs durable Postgres state before launch.",
      observed: `DATABASE_URL=${runtime.databaseUrlConfigured ? "set" : "missing"}; modes=${persistenceModes.join(", ")}`,
      remediation: "Set DATABASE_URL, run migrations, and confirm ticket/config/access/phone-verification repositories all report Postgres modes.",
    }),
    check({
      id: "official_identity_provider",
      area: "identity",
      label: "Official identity provider",
      ok: officialIdentityOk,
      passMessage:
        testAccountAuthEnabled
          ? "TEST may use seeded government password accounts while OIDC/MFA remains a staging/production launch gate."
          : "Government access is backed by a production identity provider.",
      failMessage: "Government access is still prototype-header based or disabled. Production needs approved OIDC/MFA before any official console is exposed.",
      observed: runtime.officialAuthMode,
      remediation: "Replace x-whistle-role prototype headers with approved OIDC/MFA claims and scoped government sessions.",
    }),
    check({
      id: "official_oidc_signing_source",
      area: "identity",
      label: "Official OIDC signing source",
      ok: oidcSigningOk,
      passMessage:
        isLocalOrTestProfile(profile)
          ? "Local and TEST runs may omit OIDC or use smoke-only signing; staging/production require HTTPS issuer and JWKS key rotation."
          : "Official OIDC uses HTTPS issuer metadata and JWKS key rotation.",
      failMessage: "Official OIDC is missing HTTPS issuer/audience/JWKS configuration. Shared HS256 secrets are local-smoke only and must not secure government consoles.",
      observed: officialOidcSigningSourceState(env),
      remediation:
        "Set WHISTLE_OFFICIAL_OIDC_ISSUER, WHISTLE_OFFICIAL_OIDC_AUDIENCE, and WHISTLE_OFFICIAL_OIDC_JWKS_URL to the approved HTTPS identity-provider metadata before staging/production; leave WHISTLE_OFFICIAL_OIDC_HS256_SECRET unset outside local smoke tests.",
    }),
    check({
      id: "government_password_account_auth",
      area: "identity",
      label: "Government password accounts TEST/local only",
      ok: isLocalOrTestProfile(profile) || normalise(runtime.governmentPasswordAuthMode).includes("disabled"),
      passMessage:
        isLocalOrTestProfile(profile)
          ? "Local and TEST deployments may use seeded government password accounts for UAT and smoke coverage."
          : "Government mobile/password account auth is disabled for this production-like profile.",
      failMessage: "Government mobile/password account auth is enabled outside a TEST/local profile. Government consoles must use approved OIDC/MFA before staging or production.",
      observed: runtime.governmentPasswordAuthMode,
      remediation: "Set WHISTLE_DEPLOYMENT_PROFILE=test for remote TEST or local for local UAT. For staging/production, keep government password accounts disabled and use approved OIDC/MFA.",
    }),
    check({
      id: "worker_job_authentication",
      area: "identity",
      label: "Worker job authentication",
      ok: runtime.workerAuthMode === "shared-token",
      passMessage: "Worker job endpoints require a shared worker token.",
      failMessage: "Worker job endpoints are still prototype-open or missing a configured worker secret. SLA, evidence, and notification jobs need service authentication before launch.",
      observed: runtime.workerAuthMode,
      remediation: "Set WHISTLE_WORKER_SHARED_SECRET and send x-whistle-worker-token or an Authorization bearer token from the approved worker runtime.",
    }),
    check({
      id: "citizen_otp_provider",
      area: "citizen_verification",
      label: "Citizen OTP/SMS provider",
      ok: otpProviderOk,
      passMessage:
        testProfileAllowsHiddenMockOtp(profile, runtime.otpDeliveryMode)
          ? "TEST may use hidden mock OTP values for controlled rehearsal while production SMS/OTP remains a launch gate."
          : "Citizen OTP delivery is backed by an approved provider.",
      failMessage: "Citizen phone verification still uses the mock SMS provider. This is useful for prototypes, not public launch.",
      observed: runtime.otpDeliveryMode,
      remediation: "Wire an approved OTP/SMS provider with delivery receipts, retry policy, and abuse monitoring.",
    }),
    check({
      id: "mock_otp_exposure",
      area: "citizen_verification",
      label: "Mock OTP hidden from API",
      ok: !runtime.otpExposesOtpToApi,
      passMessage: "OTP responses do not expose the mock code.",
      failMessage: "OTP responses expose the mock code. This must be disabled before any non-local testing.",
      observed: runtime.otpExposesOtpToApi ? "WHISTLE_EXPOSE_MOCK_OTP is not false" : "WHISTLE_EXPOSE_MOCK_OTP=false",
      remediation: "Set WHISTLE_EXPOSE_MOCK_OTP=false and replace the mock provider before production.",
    }),
    check({
      id: "evidence_object_storage",
      area: "evidence",
      label: "Evidence object storage",
      ok: evidenceObjectStoreOk,
      passMessage:
        testProfileAllowsLocalEvidenceStore(profile, runtime.evidenceObjectStoreMode)
          ? "TEST may use the local evidence object store on persistent test storage; production still requires an approved object-store adapter."
          : "Evidence storage uses an approved production object-store adapter.",
      failMessage: "Evidence storage is local, disabled, or only declaratively configured. Citizen evidence needs a real approved object-store adapter before production.",
      observed: runtime.evidenceObjectStoreMode,
      remediation: "Wire a real S3-compatible object-store adapter with remote object verification, short-lived signed URLs, private buckets, retention policy, KMS, scanner verdicts, and data residency approval.",
    }),
    check({
      id: "evidence_scanning_kms",
      area: "evidence",
      label: "Evidence scanning and KMS",
      ok: evidenceScanningOk,
      passMessage:
        testProfileAllowsLocalEvidenceStore(profile, runtime.evidenceObjectStoreMode) && !env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE?.trim()
          ? "TEST local evidence storage uses the MVP scanner path; KMS/scanner provider declarations remain staging/production gates."
          : "Evidence encryption key and malware-scanning controls are declared.",
      failMessage: "Evidence KMS or malware-scanning controls are not declared. Protected complaints cannot launch without this.",
      observed: `kms=${env.WHISTLE_EVIDENCE_KMS_KEY_ID ? "set" : "missing"}; scanner=${env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED ?? "missing"}`,
      remediation: "Configure WHISTLE_EVIDENCE_KMS_KEY_ID and WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED=true after security approval.",
    }),
    check({
      id: "notification_delivery_provider",
      area: "notifications",
      label: "SMS/WhatsApp notification provider",
      ok: notificationProviderOk,
      passMessage:
        testProfileAllowsMockNotifications(profile, runtime.notificationDeliveryMode)
          ? "TEST may use the mock notification provider for flow rehearsal while production delivery contracts remain a launch gate."
          : "Citizen notification delivery is backed by an approved provider.",
      failMessage: "Citizen notifications still use a mock or disabled provider. Status updates must have delivery semantics before launch.",
      observed: runtime.notificationDeliveryMode,
      remediation: "Wire approved SMS/WhatsApp providers, templates, delivery receipts, and failure handling.",
    }),
    check({
      id: "distributed_rate_limits",
      area: "performance",
      label: "Distributed rate limiting",
      ok: runtime.publicRateLimitEnabled && isDistributedRateLimitBackend(runtime.publicRateLimitBackend),
      passMessage: "Public citizen endpoints have distributed rate-limit backing.",
      failMessage: "Rate limiting is disabled or in-memory only. High-volume public launch needs shared rate limits across instances.",
      observed: `enabled=${runtime.publicRateLimitEnabled}; backend=${runtime.publicRateLimitBackend}`,
      remediation: "Configure WHISTLE_RATE_LIMIT_BACKEND to a shared backend such as postgres, Redis, or an edge gateway and keep public rate limits enabled.",
    }),
    check({
      id: "rate_limit_bucket_salt",
      area: "performance",
      label: "Rate-limit bucket salt",
      ok: profile === "local" || rateLimitKeySaltState(env) === "custom",
      passMessage:
        profile === "local"
          ? "Local development may use the default public rate-limit bucket salt; TEST/staging/production require a deployment-specific secret salt."
          : "Public rate-limit bucket keys use a deployment-specific secret salt before hashing.",
      failMessage: "Public rate-limit bucket hashing is using a missing, default, or weak salt. High-volume public launch needs non-reversible bucket keys.",
      observed: rateLimitKeySaltState(env),
      remediation: "Set WHISTLE_RATE_LIMIT_KEY_SALT to a secret deployment-specific value with at least 16 characters before TEST/staging/production traffic.",
    }),
    check({
      id: "cors_origin_allowlist",
      area: "network",
      label: "Browser origin allowlist",
      ok: profile === "local" || corsOriginPolicy.mode === "allow-list",
      passMessage:
        corsOriginPolicy.mode === "allow-list"
          ? "Browser API access is restricted to an explicit origin allowlist."
          : "Local development may allow all browser origins; TEST, staging, and production require an allowlist.",
      failMessage: "Browser API access is not restricted by origin. TEST/staging/production must declare approved citizen and console origins.",
      observed: corsOriginPolicy.mode === "allow-list" ? corsOriginPolicy.origins.join(", ") : "allow-all-local",
      remediation: "Set WHISTLE_ALLOWED_ORIGINS to the comma-separated approved citizen PWA and government console origins.",
    }),
    check({
      id: "api_security_headers",
      area: "network",
      label: "API security headers",
      ok: runtime.securityHeadersEnabled,
      passMessage: "API responses emit baseline no-sniff, framing, referrer, CSP, and cache-control security headers.",
      failMessage: "API security headers are disabled. This should not be disabled outside local debugging.",
      observed: runtime.securityHeadersEnabled ? "enabled" : "disabled",
      remediation: "Remove WHISTLE_SECURITY_HEADERS_ENABLED=false and verify API responses include the baseline security headers.",
    }),
    check({
      id: "deployment_secret_material",
      area: "operations",
      label: "Real deployment secret material",
      ok: profile === "local" || secretMaterialPlaceholders.length === 0,
      passMessage:
        profile === "local"
          ? "Local development may use example or smoke-test values; TEST/staging/production must replace every template value with secret-manager-backed values."
          : "Deployment env does not contain obvious template, smoke-test, localhost, or example values for provider endpoints/secrets.",
      failMessage: "Deployment env still contains obvious template, smoke-test, localhost, or example values. This can make a copied env template look ready when no real provider is wired.",
      observed: secretMaterialPlaceholders.length ? `placeholder-like values in ${secretMaterialPlaceholders.join(", ")}` : "no obvious placeholders",
      remediation: "Render TEST/staging/production env from the approved secret manager and replace template/example/smoke values before running deployment preflight in assert mode.",
    }),
    check({
      id: "deployment_backup_runbook",
      area: "operations",
      label: "Deployment, backup, and restore runbook",
      ok:
        isTruthy(env.WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED) &&
        hasValue(env.WHISTLE_DEPLOYMENT_RUNBOOK_VERSION) &&
        isTruthy(env.WHISTLE_BACKUP_RESTORE_DRILL_APPROVED) &&
        backupRestoreDrillFreshness(env) === "current",
      passMessage: "Deployment runbook version and backup/restore drill evidence are approved.",
      failMessage: "Deployment runbook approval, runbook version, backup/restore drill approval, or a fresh restore-drill timestamp is missing.",
      observed: `runbook=${env.WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED ?? "missing"}; version=${env.WHISTLE_DEPLOYMENT_RUNBOOK_VERSION ?? "missing"}; backupDrill=${env.WHISTLE_BACKUP_RESTORE_DRILL_APPROVED ?? "missing"}; backupDrillAt=${env.WHISTLE_BACKUP_RESTORE_DRILL_AT ?? "missing"}; freshness=${backupRestoreDrillFreshness(env)}; maxAgeDays=${numberFromEnv(env.WHISTLE_BACKUP_RESTORE_DRILL_MAX_AGE_DAYS, 30)}`,
      remediation: "Approve the deployment runbook, set WHISTLE_DEPLOYMENT_RUNBOOK_VERSION, run a restore drill against the production-like database, and set WHISTLE_BACKUP_RESTORE_DRILL_AT to a fresh ISO drill timestamp.",
    }),
    check({
      id: "siem_audit_export",
      area: "observability",
      label: "SIEM and audit export",
      ok: securityExportOk,
      passMessage:
        testProfileAllowsLocalSecurityExport(profile, runtime.securityExportMode)
          ? "TEST may keep local security export while SIEM/WORM retention remains a staging/production launch gate."
          : "Security logs and audit exports are configured for external retention.",
      failMessage: "SIEM log drain or WORM-style audit export is not configured.",
      observed: runtime.securityExportMode,
      remediation: "Configure WHISTLE_SECURITY_EXPORT_MODE=webhook with WHISTLE_SECURITY_EXPORT_WEBHOOK_URL and WHISTLE_SECURITY_EXPORT_API_KEY for external security log drains and immutable audit export/retention.",
    }),
    check({
      id: "otel_metrics_export",
      area: "observability",
      label: "OpenTelemetry metrics export",
      ok: telemetryExportOk,
      passMessage:
        testProfileAllowsLocalTelemetry(profile, runtime.telemetryExportMode)
          ? "TEST may rely on local metrics/readiness while external telemetry remains a staging/production launch gate."
          : "OpenTelemetry export provider is configured.",
      failMessage: "The API has in-process metrics, but no external telemetry exporter is configured.",
      observed: runtime.telemetryExportMode,
      remediation: "Set WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT or WHISTLE_TELEMETRY_EXPORT_MODE=otlp-http with the approved platform endpoint for latency and saturation monitoring.",
      failStatus: "warning",
    }),
  ];

  const blockers = checks.filter((item) => item.status === "blocker").length;
  const warnings = checks.filter((item) => item.status === "warning").length;
  const passes = checks.filter((item) => item.status === "pass").length;
  return {
    service: "whistle-ticket-spine",
    generatedAt: new Date().toISOString(),
    profile,
    productionTarget: profile === "production" || profile === "staging",
    productionReady: blockers === 0,
    summary: { blockers, warnings, passes },
    checks,
    nextActions: checks
      .filter((item) => item.status === "blocker")
      .slice(0, 6)
      .map((item) => item.remediation),
  };
}

export function assertProductionDeploymentPreflight(env: EnvLike = process.env) {
  const report = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(env), env);
  if (report.productionTarget && !report.productionReady) {
    const blockerIds = report.checks
      .filter((item) => item.status === "blocker")
      .map((item) => item.id)
      .join(", ");
    throw new Error(`Whistle ${report.profile} deployment preflight failed: ${blockerIds}`);
  }
  return report;
}
