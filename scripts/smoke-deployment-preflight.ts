process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
delete process.env.DATABASE_URL;
delete process.env.NODE_ENV;
delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
delete process.env.WHISTLE_ENV;
delete process.env.WHISTLE_EXPOSE_MOCK_OTP;
delete process.env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE;
delete process.env.WHISTLE_EVIDENCE_S3_ENDPOINT;
delete process.env.WHISTLE_EVIDENCE_S3_BUCKET;
delete process.env.WHISTLE_EVIDENCE_S3_REGION;
delete process.env.WHISTLE_NOTIFICATION_PROVIDER_MODE;
delete process.env.WHISTLE_RATE_LIMIT_BACKEND;
delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_URL;
delete process.env.WHISTLE_RATE_LIMIT_GATEWAY_API_KEY;
delete process.env.WHISTLE_RATE_LIMIT_KEY_SALT;
delete process.env.WHISTLE_ALLOWED_ORIGINS;
delete process.env.WHISTLE_CORS_ALLOWED_ORIGINS;
delete process.env.WHISTLE_SECURITY_HEADERS_ENABLED;
delete process.env.WHISTLE_HSTS_ENABLED;
delete process.env.WHISTLE_EVIDENCE_KMS_KEY_ID;
delete process.env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED;
delete process.env.WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED;
delete process.env.WHISTLE_DEPLOYMENT_RUNBOOK_VERSION;
delete process.env.WHISTLE_BACKUP_RESTORE_DRILL_APPROVED;
delete process.env.WHISTLE_BACKUP_RESTORE_DRILL_AT;
delete process.env.WHISTLE_BACKUP_RESTORE_DRILL_MAX_AGE_DAYS;
delete process.env.WHISTLE_SIEM_LOG_DRAIN_CONFIGURED;
delete process.env.WHISTLE_AUDIT_WORM_EXPORT_CONFIGURED;
delete process.env.WHISTLE_SECURITY_EXPORT_MODE;
delete process.env.WHISTLE_SECURITY_EXPORT_WEBHOOK_URL;
delete process.env.WHISTLE_SECURITY_EXPORT_API_KEY;
delete process.env.WHISTLE_AUDIT_EXPORT_WEBHOOK_URL;
delete process.env.WHISTLE_AUDIT_EXPORT_API_KEY;
delete process.env.WHISTLE_TELEMETRY_EXPORT_MODE;
delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT;
delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_HEADERS;
delete process.env.WHISTLE_OTEL_EXPORTER_OTLP_BEARER_TOKEN;
delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
delete process.env.WHISTLE_WORKER_AUTH_REQUIRED;
delete process.env.WHISTLE_WORKER_SHARED_SECRET;
delete process.env.WHISTLE_WORKER_TOKEN;
delete process.env.WHISTLE_OTP_PROVIDER_MODE;
delete process.env.WHISTLE_OTP_PROVIDER_WEBHOOK_URL;
delete process.env.WHISTLE_OTP_PROVIDER_API_KEY;
delete process.env.WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL;
delete process.env.WHISTLE_NOTIFICATION_PROVIDER_API_KEY;

const { buildWhistleApi } = await import("../server/app.js");
const { assertProductionDeploymentPreflight, createDeploymentPreflightReport, deploymentPreflightRuntimeFromEnv } = await import("../server/config/deploymentPreflight.js");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

type DeploymentPreflightResponse = {
  report: {
    profile: "local" | "test" | "staging" | "production";
    productionTarget: boolean;
    productionReady: boolean;
    summary: {
      blockers: number;
      warnings: number;
      passes: number;
    };
    checks: Array<{
      id: string;
      status: "pass" | "warning" | "blocker";
      observed: string;
      remediation: string;
    }>;
    nextActions: string[];
  };
};

function checkById(report: DeploymentPreflightResponse["report"], id: string) {
  const item = report.checks.find((check) => check.id === id);
  assert(item, `Expected deployment preflight check ${id}.`);
  return item;
}

function completeProductionLikeEnv(profile: "staging" | "production", backupRestoreDrillAt: string) {
  return {
    WHISTLE_DEPLOYMENT_PROFILE: profile,
    DATABASE_URL: "postgres://whistle_app:fixture-db-pass-not-real-20260629@postgres.whistle.invalid:5432/whistle",
    WHISTLE_PROTOTYPE_OFFICIAL_AUTH: "false",
    WHISTLE_OFFICIAL_OIDC_ISSUER: "https://id.whistle.invalid/realms/whistle",
    WHISTLE_OFFICIAL_OIDC_AUDIENCE: "whistle-government-console",
    WHISTLE_OFFICIAL_OIDC_JWKS_URL: "https://id.whistle.invalid/realms/whistle/protocol/openid-connect/certs",
    WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED: "true",
    WHISTLE_WORKER_AUTH_REQUIRED: "true",
    WHISTLE_WORKER_SHARED_SECRET: "fixture-worker-shared-secret-not-real-20260629",
    WHISTLE_OTP_PROVIDER_MODE: "webhook",
    WHISTLE_OTP_PROVIDER_WEBHOOK_URL: "https://sms.whistle.invalid/otp",
    WHISTLE_OTP_PROVIDER_API_KEY: "fixture-otp-provider-key-not-real-20260629",
    WHISTLE_EXPOSE_MOCK_OTP: "false",
    WHISTLE_EVIDENCE_OBJECT_STORE_MODE: "s3-compatible",
    WHISTLE_EVIDENCE_S3_ENDPOINT: "https://object-store.whistle.invalid",
    WHISTLE_EVIDENCE_S3_BUCKET: "whistle-evidence",
    WHISTLE_EVIDENCE_S3_REGION: "ap-south-1",
    WHISTLE_EVIDENCE_KMS_KEY_ID: "fixture-kms-whistle-evidence-not-real",
    WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED: "true",
    WHISTLE_EVIDENCE_DATA_RESIDENCY: "India",
    WHISTLE_NOTIFICATION_PROVIDER_MODE: "webhook",
    WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL: "https://notify.whistle.invalid/messages",
    WHISTLE_NOTIFICATION_PROVIDER_API_KEY: "fixture-notification-provider-key-not-real-20260629",
    WHISTLE_RATE_LIMIT_BACKEND: "gateway",
    WHISTLE_RATE_LIMIT_GATEWAY_URL: "https://rate-limit.whistle.invalid/check",
    WHISTLE_RATE_LIMIT_GATEWAY_API_KEY: "fixture-rate-limit-gateway-key-not-real-20260629",
    WHISTLE_RATE_LIMIT_KEY_SALT: "fixture-rate-limit-salt-not-real-20260629",
    WHISTLE_ALLOWED_ORIGINS: "https://whistle.invalid,https://console.whistle.invalid",
    WHISTLE_SECURITY_HEADERS_ENABLED: "true",
    WHISTLE_SECURITY_EXPORT_MODE: "webhook",
    WHISTLE_SECURITY_EXPORT_WEBHOOK_URL: "https://siem.whistle.invalid/security-export",
    WHISTLE_SECURITY_EXPORT_API_KEY: "fixture-security-export-key-not-real-20260629",
    WHISTLE_TELEMETRY_EXPORT_MODE: "otlp-http",
    WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.whistle.invalid/v1/traces",
    WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED: "true",
    WHISTLE_DEPLOYMENT_RUNBOOK_VERSION: "mvp1-ops-2026-06-01",
    WHISTLE_BACKUP_RESTORE_DRILL_APPROVED: "true",
    WHISTLE_BACKUP_RESTORE_DRILL_AT: backupRestoreDrillAt,
  } satisfies Record<string, string | undefined>;
}

function assertProductionLikePreflightBlockedOnlyByEvidenceAdapter(profile: "staging" | "production", backupRestoreDrillAt: string) {
  const env = completeProductionLikeEnv(profile, backupRestoreDrillAt);
  const report = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(env), env);
  assert(report.profile === profile, `Expected ${profile} profile, got ${report.profile}.`);
  assert(report.productionTarget, `${profile} should be treated as a production-like deployment target.`);
  assert(!report.productionReady, `${profile} should stay blocked while the S3-compatible evidence adapter is unimplemented.`);
  assert(report.summary.blockers === 1, `${profile} should have only the evidence adapter deployment blocker, got ${report.summary.blockers}.`);
  assert(report.summary.warnings === 0, `${profile} should have no deployment warnings, got ${report.summary.warnings}.`);
  const blocker = report.checks.find((check) => check.status === "blocker");
  assert(blocker?.id === "evidence_object_storage", `${profile} blocker should be evidence_object_storage, got ${blocker?.id ?? "missing"}.`);
  assert(blocker.observed === "s3-compatible-object-store-unimplemented", `${profile} should observe the fail-closed unimplemented S3 adapter.`);
  assert(report.nextActions.some((action) => action.includes("real S3-compatible object-store adapter")), `${profile} next actions should require a real object-store adapter.`);
  let threw = false;
  try {
    assertProductionDeploymentPreflight(env);
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes("evidence_object_storage"), `${profile} startup preflight error should name the evidence blocker.`);
  }
  assert(threw, `${profile} startup preflight should throw while the evidence adapter is unimplemented.`);
}

const app = buildWhistleApi();
await app.ready();

try {
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/deployment-preflight",
    headers: {
      "x-whistle-role": "admin",
      "x-whistle-actor": "admin:prototype",
    },
  });
  assert(response.statusCode === 200, `Deployment preflight returned ${response.statusCode}; expected 200. Body: ${response.body}`);
  const report = response.json<DeploymentPreflightResponse>().report;
  assert(report.profile === "local", `Expected local profile, got ${report.profile}.`);
  assert(!report.productionTarget, "Default smoke preflight should not be marked as a production target.");
  assert(!report.productionReady, "Local mock mode should not be production ready.");
  assert(report.summary.blockers >= 9, `Expected multiple production blockers, got ${report.summary.blockers}.`);
  assert(checkById(report, "database_persistence").status === "blocker", "In-memory repositories should block production preflight.");
  assert(checkById(report, "official_identity_provider").status === "blocker", "Prototype official auth should block production preflight.");
  assert(checkById(report, "official_oidc_signing_source").status === "pass", "Local development may use prototype headers or HS256 OIDC smoke secrets.");
  assert(checkById(report, "government_password_account_auth").status === "pass", "Local development may use seeded government password accounts.");
  assert(checkById(report, "worker_job_authentication").status === "blocker", "Prototype-open worker auth should block production preflight.");
  assert(checkById(report, "citizen_otp_provider").status === "blocker", "Mock OTP provider should block production preflight.");
  assert(checkById(report, "mock_otp_exposure").status === "blocker", "Exposed mock OTP should block deployment preflight.");
  assert(checkById(report, "evidence_object_storage").status === "blocker", "Local evidence object store should block production preflight.");
  assert(checkById(report, "distributed_rate_limits").status === "blocker", "In-memory rate limits should block production preflight.");
  assert(checkById(report, "rate_limit_bucket_salt").status === "pass", "Local development may use the default public rate-limit bucket salt.");
  assert(checkById(report, "cors_origin_allowlist").status === "pass", "Local development may allow all browser origins.");
  assert(checkById(report, "api_security_headers").status === "pass", "API security headers should be enabled by default.");
  assert(report.nextActions.length > 0, "Deployment preflight should list next actions for blockers.");

  const ready = await app.inject({ method: "GET", url: "/api/ready" });
  assert(ready.statusCode === 200, `Readiness returned ${ready.statusCode}; expected local service readiness to remain 200. Body: ${ready.body}`);

  const forbidden = await app.inject({
    method: "GET",
    url: "/api/admin/deployment-preflight",
    headers: {
      "x-whistle-role": "minister",
      "x-whistle-actor": "minister:prototype",
    },
  });
  assert(forbidden.statusCode === 403, `Minister preflight returned ${forbidden.statusCode}; expected 403. Body: ${forbidden.body}`);

  const productionEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_EXPOSE_MOCK_OTP: "false",
  } satisfies Record<string, string | undefined>;
  const productionReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(productionEnv), productionEnv);
  assert(productionReport.profile === "production", "Production env should resolve to production profile.");
  assert(productionReport.productionTarget, "Production profile should be a production target.");
  assert(!productionReport.productionReady, "Production profile with prototype seams should not be production ready.");
  assert(
    productionReport.checks.some((check) => check.id === "mock_otp_exposure" && check.status === "pass"),
    "WHISTLE_EXPOSE_MOCK_OTP=false should satisfy the mock OTP exposure check even while provider replacement remains blocked.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "citizen_otp_provider" && check.status === "blocker" && check.observed === "otp-provider-disabled"),
    "Production profile without an approved OTP provider should disable mock OTP delivery.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "official_identity_provider" && check.status === "blocker" && check.observed === "prototype-disabled"),
    "Production profile without OIDC should fail closed instead of reporting prototype official headers.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "worker_job_authentication" && check.status === "blocker" && check.observed === "shared-token-missing"),
    "Production profile should require configured worker service authentication.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "evidence_object_storage" && check.status === "blocker" && check.observed === "evidence-object-store-disabled"),
    "Production profile without approved evidence storage should disable the local mock evidence object store.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "notification_delivery_provider" && check.status === "blocker" && check.observed === "notification-provider-disabled"),
    "Production profile without approved notification wiring should disable mock notification delivery.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "siem_audit_export" && check.status === "blocker" && check.observed === "security-export-disabled"),
    "Production profile without approved SIEM/WORM wiring should disable local security export.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "otel_metrics_export" && check.status === "warning" && check.observed === "telemetry-export-disabled"),
    "Production profile without approved OpenTelemetry wiring should disable local telemetry export while keeping telemetry as a preflight warning.",
  );
  assert(
    productionReport.checks.some(
      (check) => check.id === "distributed_rate_limits" && check.status === "blocker" && check.observed === "enabled=true; backend=public-rate-limit-disabled",
    ),
    "Production profile without a shared public rate-limit backend should disable local in-memory rate limiting.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "official_oidc_signing_source" && check.status === "blocker" && check.observed === "issuer-missing"),
    "Production profile should require HTTPS OIDC issuer/audience/JWKS configuration.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "government_password_account_auth" && check.status === "pass" && check.observed === "disabled-production-profile"),
    "Production profile should report government mobile/password account auth as disabled.",
  );

  const productionEnvFallback = {
    WHISTLE_DEPLOYMENT_PROFILE: "",
    WHISTLE_ENV: "production",
    WHISTLE_EXPOSE_MOCK_OTP: "false",
  } satisfies Record<string, string | undefined>;
  const productionEnvFallbackReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(productionEnvFallback), productionEnvFallback);
  assert(productionEnvFallbackReport.profile === "production", "Blank WHISTLE_DEPLOYMENT_PROFILE should not mask WHISTLE_ENV=production.");
  assert(
    productionEnvFallbackReport.checks.some((check) => check.id === "official_identity_provider" && check.status === "blocker" && check.observed === "prototype-disabled"),
    "WHISTLE_ENV=production should still disable prototype official auth when WHISTLE_DEPLOYMENT_PROFILE is blank.",
  );
  assert(
    productionEnvFallbackReport.checks.some((check) => check.id === "government_password_account_auth" && check.status === "pass" && check.observed === "disabled-production-profile"),
    "WHISTLE_ENV=production should still disable government mobile/password account auth when WHISTLE_DEPLOYMENT_PROFILE is blank.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "cors_origin_allowlist" && check.status === "blocker" && check.observed === "allow-all-local"),
    "Production profile should require an explicit browser origin allowlist.",
  );
  assert(
    productionReport.checks.some((check) => check.id === "rate_limit_bucket_salt" && check.status === "blocker" && check.observed === "missing"),
    "Production profile should require a deployment-specific public rate-limit bucket salt.",
  );

  const stagingEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "staging",
    WHISTLE_EXPOSE_MOCK_OTP: "false",
  } satisfies Record<string, string | undefined>;
  const stagingReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(stagingEnv), stagingEnv);
  assert(stagingReport.profile === "staging", "Staging env should resolve to staging profile.");
  assert(stagingReport.productionTarget, "Staging profile should be a production target for preflight enforcement.");
  assert(!stagingReport.productionReady, "Staging profile with prototype seams should not be deployment ready.");
  let stagingThrew = false;
  try {
    assertProductionDeploymentPreflight(stagingEnv);
  } catch (error) {
    stagingThrew = true;
    assert(error instanceof Error && error.message.includes("staging deployment preflight failed"), "Staging preflight error should name the staging profile.");
    assert(error instanceof Error && error.message.includes("database_persistence"), "Staging preflight error should name blocker ids.");
  }
  assert(stagingThrew, "Staging startup preflight should throw when blockers remain.");

  const testEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "test",
    DATABASE_URL: "postgres://whistle_test:secureTestDbPass@postgres-test.whistle.invalid:5432/whistle_test",
    WHISTLE_PROTOTYPE_OFFICIAL_AUTH: "false",
    WHISTLE_WORKER_SHARED_SECRET: "mvp1WorkerTokenTest64Chars9f72b18a",
    WHISTLE_EXPOSE_MOCK_OTP: "false",
    WHISTLE_RATE_LIMIT_BACKEND: "postgres",
    WHISTLE_RATE_LIMIT_KEY_SALT: "test-public-rate-limit-salt-2026",
    WHISTLE_ALLOWED_ORIGINS: "https://citizen-test.whistle.invalid,https://console-test.whistle.invalid",
    WHISTLE_SECURITY_HEADERS_ENABLED: "true",
  } satisfies Record<string, string | undefined>;
  const testReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(testEnv), testEnv);
  assert(testReport.profile === "test", `Expected test profile, got ${testReport.profile}.`);
  assert(!testReport.productionTarget, "Test profile should not be treated as a staging/production launch target.");
  assert(!testReport.productionReady, "Test profile should still show launch-only blockers such as restore-drill evidence.");
  assert(
    testReport.checks.some((check) => check.id === "official_identity_provider" && check.status === "pass" && check.observed === "prototype-disabled"),
    "Test profile should allow government password-account auth when OIDC is intentionally disabled.",
  );
  assert(
    testReport.checks.some((check) => check.id === "citizen_otp_provider" && check.status === "pass" && check.observed === "mock-sms-hidden"),
    "Test profile should allow hidden mock OTP values for remote UAT.",
  );
  assert(
    testReport.checks.some((check) => check.id === "evidence_object_storage" && check.status === "pass" && check.observed === "local-mock-object-store"),
    "Test profile should allow local evidence object storage for controlled test uploads.",
  );
  assert(
    testReport.checks.some((check) => check.id === "notification_delivery_provider" && check.status === "pass" && check.observed === "mvp-mock-notification-provider"),
    "Test profile should allow mock notification delivery for flow rehearsal.",
  );
  assert(
    testReport.checks.some((check) => check.id === "distributed_rate_limits" && check.status === "pass" && check.observed === "enabled=true; backend=postgres-rate-limit"),
    "Test profile should require a shared Postgres public rate-limit backend.",
  );
  assert(
    testReport.checks.some((check) => check.id === "cors_origin_allowlist" && check.status === "pass"),
    "Test profile should require an explicit browser origin allowlist.",
  );
  assert(
    testReport.checks.some((check) => check.id === "deployment_secret_material" && check.status === "pass"),
    "Test profile should require rendered non-placeholder deployment secret material.",
  );
  assertProductionDeploymentPreflight(testEnv);

  const oidcProductionEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_OFFICIAL_OIDC_ISSUER: "https://id.tn.example.gov/realms/whistle",
    WHISTLE_OFFICIAL_OIDC_AUDIENCE: "whistle-government-console",
    WHISTLE_OFFICIAL_OIDC_HS256_SECRET: "deployment-preflight-smoke-secret",
  } satisfies Record<string, string | undefined>;
  const oidcProductionReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(oidcProductionEnv), oidcProductionEnv);
  assert(
    oidcProductionReport.checks.some((check) => check.id === "official_identity_provider" && check.status === "pass" && check.observed === "oidc-jwt"),
    "OIDC issuer/audience/signing configuration should satisfy the official identity provider preflight check.",
  );
  assert(
    oidcProductionReport.checks.some((check) => check.id === "official_oidc_signing_source" && check.status === "blocker" && check.observed === "hs256-secret"),
    "HS256 OIDC smoke secrets should not satisfy the production OIDC signing-source check.",
  );

  const oidcJwksProductionEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_OFFICIAL_OIDC_ISSUER: "https://id.tn.example.gov/realms/whistle",
    WHISTLE_OFFICIAL_OIDC_AUDIENCE: "whistle-government-console",
    WHISTLE_OFFICIAL_OIDC_JWKS_URL: "https://id.tn.example.gov/realms/whistle/protocol/openid-connect/certs",
  } satisfies Record<string, string | undefined>;
  const oidcJwksProductionReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(oidcJwksProductionEnv), oidcJwksProductionEnv);
  assert(
    oidcJwksProductionReport.checks.some((check) => check.id === "official_identity_provider" && check.status === "pass" && check.observed === "oidc-jwt"),
    "OIDC issuer/audience/JWKS configuration should satisfy the official identity provider preflight check.",
  );
  assert(
    oidcJwksProductionReport.checks.some((check) => check.id === "official_oidc_signing_source" && check.status === "pass" && check.observed === "jwks-https"),
    "HTTPS OIDC JWKS should satisfy the production OIDC signing-source check.",
  );

  const oidcJwksWithHsSecretEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_OFFICIAL_OIDC_ISSUER: "https://id.tn.example.gov/realms/whistle",
    WHISTLE_OFFICIAL_OIDC_AUDIENCE: "whistle-government-console",
    WHISTLE_OFFICIAL_OIDC_JWKS_URL: "https://id.tn.example.gov/realms/whistle/protocol/openid-connect/certs",
    WHISTLE_OFFICIAL_OIDC_HS256_SECRET: "deployment-preflight-smoke-secret",
  } satisfies Record<string, string | undefined>;
  const oidcJwksWithHsSecretReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(oidcJwksWithHsSecretEnv), oidcJwksWithHsSecretEnv);
  assert(
    oidcJwksWithHsSecretReport.checks.some(
      (check) => check.id === "official_oidc_signing_source" && check.status === "blocker" && check.observed === "jwks-https-with-hs256-secret",
    ),
    "Production OIDC should block HS256 smoke secrets even when HTTPS JWKS is also configured.",
  );

  const nonHttpsJwksEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_OFFICIAL_OIDC_ISSUER: "https://id.tn.example.gov/realms/whistle",
    WHISTLE_OFFICIAL_OIDC_AUDIENCE: "whistle-government-console",
    WHISTLE_OFFICIAL_OIDC_JWKS_URL: "http://id.tn.example.gov/realms/whistle/protocol/openid-connect/certs",
  } satisfies Record<string, string | undefined>;
  const nonHttpsJwksReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(nonHttpsJwksEnv), nonHttpsJwksEnv);
  assert(
    nonHttpsJwksReport.checks.some((check) => check.id === "official_oidc_signing_source" && check.status === "blocker" && check.observed === "jwks-non-https"),
    "Non-HTTPS OIDC JWKS should block production preflight.",
  );

  const otpProviderEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_OTP_PROVIDER_MODE: "webhook",
    WHISTLE_OTP_PROVIDER_WEBHOOK_URL: "https://sms-gateway.example.gov/otp",
    WHISTLE_OTP_PROVIDER_API_KEY: "deployment-preflight-otp-key",
  } satisfies Record<string, string | undefined>;
  const otpProviderReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(otpProviderEnv), otpProviderEnv);
  assert(
    otpProviderReport.checks.some((check) => check.id === "citizen_otp_provider" && check.status === "pass" && check.observed === "sms-webhook-provider"),
    "Configured webhook OTP provider should satisfy the citizen OTP provider preflight check.",
  );
  assert(
    otpProviderReport.checks.some((check) => check.id === "mock_otp_exposure" && check.status === "pass"),
    "Webhook OTP provider should also satisfy the mock OTP exposure check.",
  );

  const evidenceProviderEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_EVIDENCE_OBJECT_STORE_MODE: "s3-compatible",
    WHISTLE_EVIDENCE_S3_ENDPOINT: "https://object-store.tn.example.gov",
    WHISTLE_EVIDENCE_S3_BUCKET: "whistle-evidence",
    WHISTLE_EVIDENCE_S3_REGION: "ap-south-1",
    WHISTLE_EVIDENCE_KMS_KEY_ID: "kms-whistle-evidence",
    WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED: "true",
  } satisfies Record<string, string | undefined>;
  const evidenceProviderReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(evidenceProviderEnv), evidenceProviderEnv);
  assert(
    evidenceProviderReport.checks.some((check) => check.id === "evidence_object_storage" && check.status === "blocker" && check.observed === "s3-compatible-object-store-unimplemented"),
    "Configured S3-compatible evidence store declarations should still fail closed until a real adapter exists.",
  );
  assert(
    evidenceProviderReport.checks.some((check) => check.id === "evidence_scanning_kms" && check.status === "pass"),
    "Configured KMS and malware-scanner declarations should satisfy the evidence scanning/KMS preflight check.",
  );

  const notificationProviderEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_NOTIFICATION_PROVIDER_MODE: "webhook",
    WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL: "https://notification-gateway.example.gov/messages",
    WHISTLE_NOTIFICATION_PROVIDER_API_KEY: "deployment-preflight-notification-key",
  } satisfies Record<string, string | undefined>;
  const notificationProviderReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(notificationProviderEnv), notificationProviderEnv);
  assert(
    notificationProviderReport.checks.some(
      (check) => check.id === "notification_delivery_provider" && check.status === "pass" && check.observed === "notification-webhook-provider",
    ),
    "Configured webhook notification provider should satisfy the notification delivery preflight check.",
  );

  const distributedRateLimitEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_RATE_LIMIT_BACKEND: "gateway",
    WHISTLE_RATE_LIMIT_GATEWAY_URL: "https://edge-rate-limit.example.gov/check",
    WHISTLE_RATE_LIMIT_GATEWAY_API_KEY: "deployment-preflight-rate-limit-key",
  } satisfies Record<string, string | undefined>;
  const distributedRateLimitReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(distributedRateLimitEnv), distributedRateLimitEnv);
  assert(
    distributedRateLimitReport.checks.some(
      (check) => check.id === "distributed_rate_limits" && check.status === "pass" && check.observed === "enabled=true; backend=distributed-http-rate-limit",
    ),
    "Configured distributed public rate-limit gateway should satisfy the deployment preflight check.",
  );

  const customRateLimitSaltEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_RATE_LIMIT_KEY_SALT: "tn-whistle-public-rate-limit-2026",
  } satisfies Record<string, string | undefined>;
  const customRateLimitSaltReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(customRateLimitSaltEnv), customRateLimitSaltEnv);
  assert(
    customRateLimitSaltReport.checks.some((check) => check.id === "rate_limit_bucket_salt" && check.status === "pass" && check.observed === "custom"),
    "Deployment-specific public rate-limit bucket salt should satisfy the deployment preflight check.",
  );

  const defaultRateLimitSaltEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_RATE_LIMIT_KEY_SALT: "whistle-public-rate-limit",
  } satisfies Record<string, string | undefined>;
  const defaultRateLimitSaltReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(defaultRateLimitSaltEnv), defaultRateLimitSaltEnv);
  assert(
    defaultRateLimitSaltReport.checks.some((check) => check.id === "rate_limit_bucket_salt" && check.status === "blocker" && check.observed === "default"),
    "Default public rate-limit bucket salt should block production preflight.",
  );

  const postgresRateLimitEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_RATE_LIMIT_BACKEND: "postgres",
  } satisfies Record<string, string | undefined>;
  const postgresRateLimitReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(postgresRateLimitEnv), postgresRateLimitEnv);
  assert(
    postgresRateLimitReport.checks.some(
      (check) => check.id === "distributed_rate_limits" && check.status === "pass" && check.observed === "enabled=true; backend=postgres-rate-limit",
    ),
    "Configured Postgres public rate limiter should satisfy the deployment preflight check.",
  );

  const browserOriginEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_ALLOWED_ORIGINS: "https://whistle.invalid,https://console.whistle.invalid",
  } satisfies Record<string, string | undefined>;
  const browserOriginReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(browserOriginEnv), browserOriginEnv);
  assert(
    browserOriginReport.checks.some(
      (check) =>
        check.id === "cors_origin_allowlist" &&
        check.status === "pass" &&
        check.observed === "https://whistle.invalid, https://console.whistle.invalid",
    ),
    "Configured browser origin allowlist should satisfy the production CORS preflight check.",
  );

  const disabledSecurityHeadersEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_SECURITY_HEADERS_ENABLED: "false",
  } satisfies Record<string, string | undefined>;
  const disabledSecurityHeadersReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(disabledSecurityHeadersEnv), disabledSecurityHeadersEnv);
  assert(
    disabledSecurityHeadersReport.checks.some((check) => check.id === "api_security_headers" && check.status === "blocker" && check.observed === "disabled"),
    "Disabling API security headers should block production preflight.",
  );

  const securityExportEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_SECURITY_EXPORT_MODE: "webhook",
    WHISTLE_SECURITY_EXPORT_WEBHOOK_URL: "https://siem.example.gov/whistle/security-export",
    WHISTLE_SECURITY_EXPORT_API_KEY: "deployment-preflight-security-export-key",
  } satisfies Record<string, string | undefined>;
  const securityExportReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(securityExportEnv), securityExportEnv);
  assert(
    securityExportReport.checks.some((check) => check.id === "siem_audit_export" && check.status === "pass" && check.observed === "siem-worm-webhook-export"),
    "Configured SIEM/WORM webhook should satisfy the security log and audit export preflight check.",
  );

  const freshRestoreDrillAt = new Date().toISOString();
  const runbookEvidenceEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED: "true",
    WHISTLE_DEPLOYMENT_RUNBOOK_VERSION: "mvp1-ops-2026-06-01",
    WHISTLE_BACKUP_RESTORE_DRILL_APPROVED: "true",
    WHISTLE_BACKUP_RESTORE_DRILL_AT: freshRestoreDrillAt,
  } satisfies Record<string, string | undefined>;
  const runbookEvidenceReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(runbookEvidenceEnv), runbookEvidenceEnv);
  assert(
    runbookEvidenceReport.checks.some(
      (check) =>
        check.id === "deployment_backup_runbook" &&
        check.status === "pass" &&
        check.observed.includes("version=mvp1-ops-2026-06-01") &&
        check.observed.includes(`backupDrillAt=${freshRestoreDrillAt}`) &&
        check.observed.includes("freshness=current"),
    ),
    "Runbook version and fresh restore-drill timestamp evidence should satisfy the deployment/backup preflight check.",
  );

  const staleRunbookEvidenceEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED: "true",
    WHISTLE_DEPLOYMENT_RUNBOOK_VERSION: "mvp1-ops-2026-06-01",
    WHISTLE_BACKUP_RESTORE_DRILL_APPROVED: "true",
    WHISTLE_BACKUP_RESTORE_DRILL_AT: "2000-01-01T00:00:00.000Z",
  } satisfies Record<string, string | undefined>;
  const staleRunbookEvidenceReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(staleRunbookEvidenceEnv), staleRunbookEvidenceEnv);
  assert(
    staleRunbookEvidenceReport.checks.some(
      (check) => check.id === "deployment_backup_runbook" && check.status === "blocker" && check.observed.includes("freshness=stale"),
    ),
    "Stale restore-drill evidence should block deployment preflight.",
  );

  const telemetryEnv = {
    WHISTLE_DEPLOYMENT_PROFILE: "production",
    WHISTLE_TELEMETRY_EXPORT_MODE: "otlp-http",
    WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel-collector.example.gov/v1/traces",
  } satisfies Record<string, string | undefined>;
  const telemetryReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(telemetryEnv), telemetryEnv);
  assert(
    telemetryReport.checks.some((check) => check.id === "otel_metrics_export" && check.status === "pass" && check.observed === "otlp-http-telemetry-export"),
    "Configured OpenTelemetry HTTP exporter should satisfy the telemetry preflight check.",
  );

  const templatePlaceholderEnv = {
    ...completeProductionLikeEnv("staging", freshRestoreDrillAt),
    DATABASE_URL: "postgres://whistle:whistle@localhost:54329/whistle",
    WHISTLE_OTP_PROVIDER_API_KEY: "REPLACE_WITH_SECRET_MANAGER_OTP_KEY",
    WHISTLE_EVIDENCE_S3_ENDPOINT: "https://object-store.example.gov",
  } satisfies Record<string, string | undefined>;
  const templatePlaceholderReport = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(templatePlaceholderEnv), templatePlaceholderEnv);
  assert(
    templatePlaceholderReport.checks.some(
      (check) =>
        check.id === "deployment_secret_material" &&
        check.status === "blocker" &&
        check.observed.includes("DATABASE_URL") &&
        check.observed.includes("WHISTLE_OTP_PROVIDER_API_KEY") &&
        check.observed.includes("WHISTLE_EVIDENCE_S3_ENDPOINT"),
    ),
    "Staging/production preflight should block obvious env-template placeholder values by key name without exposing the values.",
  );

	  assertProductionLikePreflightBlockedOnlyByEvidenceAdapter("staging", freshRestoreDrillAt);
	  assertProductionLikePreflightBlockedOnlyByEvidenceAdapter("production", freshRestoreDrillAt);

  let threw = false;
  try {
    assertProductionDeploymentPreflight(productionEnv);
  } catch (error) {
    threw = true;
    assert(error instanceof Error && error.message.includes("production deployment preflight failed"), "Production preflight error should name the production profile.");
    assert(error instanceof Error && error.message.includes("database_persistence"), "Production preflight error should name blocker ids.");
  }
  assert(threw, "Production startup preflight should throw when blockers remain.");

	  pass("complete staging and production env contracts remain blocked only on the missing real evidence adapter");
  pass("deployment preflight distinguishes local readiness from production security and scale blockers");
} finally {
  await app.close();
}
