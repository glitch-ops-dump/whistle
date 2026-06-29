# Whistle Production Runbook

Status: MVP1 operational draft  
Runbook version: `mvp1-ops-2026-06-01`  
Owner: Whistle Admin / Platform Operations  

This runbook is the operational companion to the secure ticket spine. It does not approve public launch by itself. Admin launch controls still require provider contracts, neutral-or-approved asset decisions, category SOPs, trained operators, and a production-like backup/restore drill.

## 1. Launch Principle

Whistle launches only as a controlled operating system, not only as a citizen app. Before public traffic is enabled, the team must prove that citizen intake, verification, routing, SLA escalation, audit export, notifications, evidence handling, dashboards, and Admin controls are working from the same ticket spine.

Protected categories must stay pilot-only or disabled until the protected-track SOP, legal/vigilance owner, break-glass policy, and identity-masking rules are approved.

## 2. Required Preflight

Run these checks before any staging or production promotion:

```bash
npm run mvp:check
DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run mvp:check:postgres
```

For staging or production profile startup, the deployment environment must satisfy `/api/admin/deployment-preflight` and `assertProductionDeploymentPreflight`. The deployment must not proceed while any blocker remains.

Required production evidence:

- `DATABASE_URL` points to the production Postgres cluster.
- `WHISTLE_DEPLOYMENT_PROFILE=production`.
- `WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED=true`.
- `WHISTLE_DEPLOYMENT_RUNBOOK_VERSION=mvp1-ops-2026-06-01` or a newer approved version.
- `WHISTLE_BACKUP_RESTORE_DRILL_APPROVED=true`.
- `WHISTLE_BACKUP_RESTORE_DRILL_AT` contains the ISO timestamp of the latest production-like restore drill; it should be no older than 30 days unless `WHISTLE_BACKUP_RESTORE_DRILL_MAX_AGE_DAYS` is explicitly approved.

For local MVP1 UAT only, use the local harness instead of staging/production envs:

```bash
npm run db:migrate
npm run mvp1:uat-preflight
npm run mvp1:uat-token -- --actor admin:prototype --role admin
npm run mvp1:uat-seed -- --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.md
npm run mvp1:uat-seed -- --json --quiet --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.json
npm run mvp1:uat-run -- --run-id <run-id> --seed-file artifacts/whistle-mvp1-local-uat-seed.json --out artifacts/whistle-mvp1-local-uat-run.md
npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md
npm run api:dev:mvp1-uat
```

The local UAT harness loads `ops/env/whistle-mvp1-local-uat.env.example`. It exercises Postgres-backed repositories, mobile/password account sessions, local official-token government access, worker-token authentication, hidden mock OTP responses, and Postgres-backed public rate limits. Use `npm run mvp1:uat-token` to mint a single browser-local bearer token when needed, use `npm run mvp1:uat-seed` to create the role-test ticket pack and emit browser-local bearer tokens through `localStorage.setItem(...)` snippets for Admin, Verification, CM Cell, Minister, Department Officer, MLA, and Councillor accounts, use `npm run mvp1:uat-run` with the matching JSON seed file to execute token-free automated role assertions, and use `npm run mvp1:defect-register` to create a redacted defect-register template for sign-off. Open the government consoles under `npm run api:dev:mvp1-uat`. The local harness deliberately keeps OTP/SMS provider contracts, evidence object storage/KMS/scanning, notification providers, SIEM/WORM export, and restore-drill evidence as launch gates.

The Admin console records external provider configuration references under App Controls. It is for provider mode, endpoint/reference, owner evidence, readiness flags, and required env-key tracking only. Raw API keys, passwords, OTP values, private keys, object-store credentials, rate-limit salts, and restore-drill timestamps must stay in the approved secret manager and rendered deployment env, then be proven through deployment preflight and a redacted readiness packet.

Provider configuration references in Admin must be controlled internal references, not raw vendor URLs or pasted credentials. Examples include `secret-manager://whistle/mvp1/official-oidc-mfa/<ref-id>`, `secret-manager://whistle/mvp1/citizen-otp-provider/<ref-id>`, `secret-manager://whistle/mvp1/evidence-storage-kms-scanner/<ref-id>`, `provider-contract://whistle/mvp1/notification-provider/<contract-id>`, `secret-manager://whistle/mvp1/rate-limit-provider/<ref-id>`, and `ops://whistle/mvp1/observability-siem-telemetry/<ref-id>`. Provider readiness flags do not clear MVP1 launch readiness unless the matching controlled reference is also present.

The Admin console also exposes the MVP1 launch handoff for provider, UAT, and ops teams. That report groups Platform/Postgres, Identity, Citizen verification, Evidence/security, Observability/incident, and Operator UAT lanes with the matching Admin controls, runtime checks, required env keys, smoke commands, evidence needed, blockers, and launch hold conditions. It is a redacted coordination surface; it must not contain raw secrets or override deployment preflight.

The same handoff can be exported as a redacted artifact with `npm run mvp1:handoff-packet -- --env-file /secure/rendered/whistle-staging.env --out artifacts/whistle-mvp1-launch-handoff.md`. Use this for cross-team launch review when provider, UAT, platform, security, observability, and operations owners need a shared checklist that matches Admin state and deployment preflight.

Launch evidence references in Admin must use controlled internal references, not raw URLs or local file paths. Platform/Postgres evidence should include migration output like `artifact://whistle/mvp1/postgres-migration/<run-id>` and Postgres MVP check evidence like `artifact://whistle/mvp1/postgres-mvp-check/<run-id>`. MVP1 UAT evidence should look like `artifact://whistle/mvp1/rehearsal-packet/<run-id>`, restore drill evidence like `artifact://whistle/mvp1/restore-drill/<run-id>`, and SIEM/WORM evidence like `artifact://whistle/mvp1/siem-worm-export/<run-id>`. Raw URLs, local file paths, data URLs, database URLs, or informal notes are not valid launch evidence references. Admin sign-off checkboxes do not clear readiness unless the matching reference passes this format gate.

Citizen identity policy is also controlled in Admin. MVP1 defaults to phone OTP only. If the state later mandates Aadhaar/Government ID for selected categories, Admin must record the policy mode, required categories, and approved provider/policy reference; that change is governed and cannot be treated as production-ready from a generic provider toggle alone.

The Admin console also records MVP1 operator UAT and SOP sign-off under App Controls. Before public launch, the launch owner must attach a rehearsal evidence reference, attach a defect register reference such as `artifact://whistle/mvp1/defect-register/<run-id>`, record open Blocker/Critical/Major/Minor defect counts, and obtain second-Admin approval for citizen lifecycle rehearsal, verification SOP/training, role-dashboard rehearsal, protected-track SOP, and MVP1 defect-triage acceptance. Operator UAT cannot pass with any open Blocker or Critical defect. These controls prove operator readiness only; they do not override provider, security, backup, or deployment preflight blockers.

Deployment and incident readiness is also split into separate Admin sign-offs. Restore drill evidence, SIEM/WORM export evidence, telemetry launch watch, browser origin allowlist, and incident hold conditions must each be backed by controlled references and approved through critical App Controls. Expected evidence examples are `artifact://whistle/mvp1/telemetry-launch-watch/<run-id>`, `artifact://whistle/mvp1/origin-allowlist/<run-id>`, and `artifact://whistle/mvp1/incident-hold-policy/<run-id>`. These approvals record operational acceptance; rendered deployment envs must still pass `/api/admin/deployment-preflight`.

The exact deployment questions to answer before staging are kept in `docs/mvp1-deployment-decisions.md`: staging/prod origins, target hosting/runtime, Postgres environment, restore-drill owner/date, and incident hold rules. Provider choices that are not yet approved can remain pending while these deployment facts are collected.

## 3. Provider Configuration

Government access:

- `WHISTLE_PROTOTYPE_OFFICIAL_AUTH=false`.
- `WHISTLE_OFFICIAL_OIDC_ISSUER`, `WHISTLE_OFFICIAL_OIDC_AUDIENCE`, and `WHISTLE_OFFICIAL_OIDC_JWKS_URL` point to the approved HTTPS identity-provider metadata.
- `WHISTLE_OFFICIAL_OIDC_HS256_SECRET` is for local smoke tests only and must not be used for staging or production government consoles.
- MFA assurance is required for official console access.
- Production and staging profiles disable prototype government headers at runtime even if the startup preflight path is bypassed.

Worker jobs:

- `WHISTLE_WORKER_SHARED_SECRET` is configured.
- Worker callers use `x-whistle-worker-token` or a bearer token.

Citizen OTP:

- `WHISTLE_OTP_PROVIDER_MODE=webhook`.
- `WHISTLE_OTP_PROVIDER_WEBHOOK_URL` and `WHISTLE_OTP_PROVIDER_API_KEY` are configured.
- Mock OTP exposure is disabled.
- Production and staging profiles disable mock OTP delivery at runtime when no approved provider is configured.

Evidence:

- `WHISTLE_EVIDENCE_OBJECT_STORE_MODE=s3-compatible`.
- Endpoint, bucket, region, KMS key, and malware-scanner declarations are configured.
- Evidence buckets are private and signed URLs are short-lived.
- Production and staging profiles disable local/mock evidence object storage at runtime when no approved S3-compatible store is configured.

Notifications:

- `WHISTLE_NOTIFICATION_PROVIDER_MODE=webhook`.
- Notification webhook URL/API key are configured.
- Templates are approved for Tamil and English.
- Production and staging profiles disable mock notification delivery at runtime when no approved provider is configured.

Public rate limits:

- `WHISTLE_RATE_LIMIT_BACKEND=gateway`.
- Gateway URL/API key are configured.
- `WHISTLE_RATE_LIMIT_KEY_SALT` is a secret deployment-specific value with at least 16 characters.
- Gateway payloads must use hashed bucket keys, not raw phones.
- Production and staging profiles disable local/in-memory public rate limiting at runtime when no shared backend is configured.

Browser/API edge:

- `WHISTLE_ALLOWED_ORIGINS` lists only the approved citizen PWA and government console origins.
- API security headers remain enabled. Do not set `WHISTLE_SECURITY_HEADERS_ENABLED=false` outside local debugging.
- Production/staging HSTS remains enabled unless the approved TLS terminator owns HSTS centrally.

Security export:

- `WHISTLE_SECURITY_EXPORT_MODE=webhook`.
- SIEM/WORM webhook URL/API key are configured.
- Production and staging profiles disable local security/audit export at runtime when no approved SIEM/WORM provider is configured.
- Security export payloads must be redacted and include audit hash-chain metadata.

Telemetry:

- `WHISTLE_TELEMETRY_EXPORT_MODE=otlp-http` or `WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT` is configured.
- `WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT` or the approved platform equivalent is configured.
- Production and staging profiles disable local telemetry export at runtime when no approved OpenTelemetry endpoint is configured.
- Sanitized request spans and metrics snapshots export without query strings, phone numbers, ticket descriptions, evidence, or citizen identity.
- API SLO smoke results are recorded before promotion.

## 4. MVP1 Production-Security Handoff

This is the concrete handoff for the teams working in parallel on MVP1 launch readiness. Do not store the example values below in source control or `.env` files; use the approved deployment secret manager and replace every placeholder with the real provider endpoint, key, or secret.

Platform/Postgres owner:

- Set `DATABASE_URL` to the staging or production Postgres cluster.
- Run migrations before startup and verify the `public_rate_limit_buckets` table exists if Postgres is used for rate limits.
- Attach controlled Admin evidence references for Postgres migration output and the Postgres-backed MVP check; do not paste raw `DATABASE_URL`, migration logs with credentials, or CI URLs into Admin.
- Link the Platform/Postgres lane to the same restore-drill packet used by deployment sign-off.

Identity owner:

- Set `WHISTLE_PROTOTYPE_OFFICIAL_AUTH=false`.
- Set `WHISTLE_OFFICIAL_OIDC_ISSUER`, `WHISTLE_OFFICIAL_OIDC_AUDIENCE`, and `WHISTLE_OFFICIAL_OIDC_JWKS_URL` to the approved HTTPS OIDC/MFA provider.
- Keep `WHISTLE_OFFICIAL_OIDC_HS256_SECRET` unset in staging and production.

Worker owner:

- Set `WHISTLE_WORKER_AUTH_REQUIRED=true`.
- Set `WHISTLE_WORKER_SHARED_SECRET` from the secret manager and configure every worker caller to send it.

Citizen verification and notification owners:

- Set `WHISTLE_OTP_PROVIDER_MODE=webhook`, `WHISTLE_OTP_PROVIDER_WEBHOOK_URL`, `WHISTLE_OTP_PROVIDER_API_KEY`, and `WHISTLE_EXPOSE_MOCK_OTP=false`.
- Set `WHISTLE_NOTIFICATION_PROVIDER_MODE=webhook`, `WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL`, and `WHISTLE_NOTIFICATION_PROVIDER_API_KEY`.
- Keep Admin `Citizen government ID policy mode` on `phone-otp-only` for MVP1 unless a state-approved category policy, legal review, and provider reference are attached.

Evidence/security owner:

- Set `WHISTLE_EVIDENCE_OBJECT_STORE_MODE=s3-compatible`, `WHISTLE_EVIDENCE_S3_ENDPOINT`, `WHISTLE_EVIDENCE_S3_BUCKET`, `WHISTLE_EVIDENCE_S3_REGION`, `WHISTLE_EVIDENCE_KMS_KEY_ID`, `WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED=true`, and `WHISTLE_EVIDENCE_DATA_RESIDENCY=India`.
- Set `WHISTLE_SECURITY_EXPORT_MODE=webhook`, `WHISTLE_SECURITY_EXPORT_WEBHOOK_URL`, and `WHISTLE_SECURITY_EXPORT_API_KEY`.

Network/performance owner:

- Set `WHISTLE_RATE_LIMIT_BACKEND=gateway`, `WHISTLE_RATE_LIMIT_GATEWAY_URL`, `WHISTLE_RATE_LIMIT_GATEWAY_API_KEY`, and `WHISTLE_RATE_LIMIT_KEY_SALT`.
- Set `WHISTLE_ALLOWED_ORIGINS` to the citizen PWA and government console origins only.
- Keep `WHISTLE_SECURITY_HEADERS_ENABLED=true`.

Observability/operations owner:

- Set `WHISTLE_TELEMETRY_EXPORT_MODE=otlp-http` and `WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT`.
- Set `WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED=true`, `WHISTLE_DEPLOYMENT_RUNBOOK_VERSION=mvp1-ops-2026-06-01`, `WHISTLE_BACKUP_RESTORE_DRILL_APPROVED=true`, and `WHISTLE_BACKUP_RESTORE_DRILL_AT` to the latest fresh restore-drill timestamp.

Validation command:

```bash
npm run mvp1:uat-preflight
npm run smoke:deployment-preflight
npm run deployment:preflight -- --env-file ops/env/whistle-mvp1-staging.env.example
npm run deployment:preflight:assert -- --env-file /secure/rendered/whistle-staging.env
npm run deployment:packet -- --env-file /secure/rendered/whistle-staging.env --out artifacts/whistle-mvp1-readiness-packet.md
npm run mvp1:handoff-packet -- --env-file /secure/rendered/whistle-staging.env --out artifacts/whistle-mvp1-launch-handoff.md
npm run mvp1:rehearsal-packet -- --out artifacts/whistle-mvp1-launch-rehearsal.md
npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md
```

The smoke includes an all-green staging and production env contract fixture. The staging env template at `ops/env/whistle-mvp1-staging.env.example` is intentionally blocked by the placeholder-value guard until every `REPLACE_WITH_*`, localhost, smoke-test, and example value is replaced by real secret-manager-backed values. Real staging and production may proceed only when the same contract is satisfied by real secret-manager-backed values and `assertProductionDeploymentPreflight` reports zero blockers.

The readiness packet is the redacted evidence artifact for security, provider, and UAT review. It records preflight status, owner-lane key status, commands, and launch hold conditions without printing database passwords, API keys, shared worker tokens, rate-limit salts, or restore-drill timestamps.

The MVP1 launch rehearsal packet maps citizen, verification, MLA, minister, CM Cell, Admin, and worker/security rehearsal scenarios to the exact smoke commands that prove each flow. It is a role-specific UAT checklist and evidence index, not a replacement for live operator sign-off, provider contracts, or the production security preflight. The packet must stay redacted: no raw ticket IDs, phone numbers, citizen identity, evidence files, signed URLs, API keys, shared secrets, salts, or restore-drill timestamps.

The rehearsal packet also defines the MVP1 defect triage policy. Generate the matching defect register with `npm run mvp1:defect-register` and attach the reviewed artifact as `artifact://whistle/mvp1/defect-register/<run-id>` in Admin. Blocker defects are launch holds and cannot be deferred. Critical defects require a fix or explicit launch-owner acceptance. Major defects must be triaged before launch and may defer only when MVP1 safety and clarity are unaffected. Minor defects can defer with a phase tag and owner. This keeps UAT defects inside MVP1 without turning UAT into a hidden MVP2-MVP4 feature expansion.

## 5. Deployment Steps

1. Freeze configuration changes except emergency fixes.
2. Run database migration on the target environment.
3. Run deployment preflight and confirm no blockers.
4. Run `npm run deployment:preflight:assert -- --env-file /secure/rendered/whistle-staging.env` or the equivalent CI step against the rendered secret-manager env.
5. Run a canary instance with public intake disabled through `ops-maintenance`.
6. Verify `/api/health`, `/api/ready`, `/api/admin/deployment-preflight`, and `/api/metrics`.
7. Run worker jobs in bounded batches and confirm `hasMore` behavior with `npm run worker:run`. Production worker callers must set `WHISTLE_API_BASE_URL`, `WHISTLE_WORKER_SHARED_SECRET` or `WHISTLE_WORKER_TOKEN`, `WHISTLE_WORKER_BATCH_LIMIT`, and `WHISTLE_WORKER_MAX_PASSES`.
8. Enable citizen intake only for approved ready categories.
9. Watch API latency, queue depth, SLA due-soon counts, notification failures, evidence scan failures, and security export failures.

## 6. Rollback Steps

1. Disable public citizen intake through the Admin `ops-maintenance` control, or category controls if the incident is category-specific.
2. Stop worker schedulers if they are causing repeated failures.
3. Roll back the application container to the last known good image.
4. Do not roll back the database unless the incident commander approves a restore plan.
5. Export audit events and configuration changes for the incident window.
6. Communicate citizen-safe status updates for affected open tickets.

## 7. Backup And Restore Drill

The production-like restore drill must prove:

- All operational tables are backed up.
- Tickets, queues, status history, SLA clocks, notifications, evidence metadata, config, access, idempotency, agent runs, dashboard briefs, and audit ledger rows restore together.
- Audit hash-chain fields and correlation IDs survive restore.
- A seeded routed ticket remains readable after restore.

The current automated drill is:

```bash
DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run smoke:postgres-backup-restore
```

Record the drill timestamp in `WHISTLE_BACKUP_RESTORE_DRILL_AT`. Deployment preflight treats stale restore-drill evidence as a launch blocker, with a default maximum age of 30 days.

## 8. SIEM And Audit Export

Security logs and governance audit exports must flow to the approved SIEM/WORM destination before public launch.

Verification steps:

- `/api/ready` reports `security_export` as `siem-worm-webhook-export`.
- `/api/admin/governance/audit-export` returns `productionStorage=external_worm_siem`.
- The provider delivery result is `exported`.
- Webhook payloads do not include raw phone numbers, raw complaint descriptions, raw evidence, or unredacted protected details.
- Audit export payloads include `previousHash`, `eventHash`, and `chainSequence`.

## 9. Incident Response

Treat these as launch-stopping incidents:

- Protected identity or evidence leakage.
- OIDC/MFA bypass or shared account compromise.
- Public rate-limit gateway unavailable during high traffic.
- Evidence storage or malware scanning unavailable.
- Notification provider repeatedly failing citizen status updates.
- Security export unavailable in production.
- SLA worker stuck or repeatedly escalating incorrectly.

Immediate actions:

1. Put public intake into `ops-maintenance` or category-level pause.
2. Preserve logs, audit exports, and database snapshots.
3. Notify CM Cell/Admin incident owners.
4. Run scoped dashboard explanations for affected counts.
5. Do not delete or rewrite audit events.

## 10. Post-Deployment Watch

For the first 24 hours, review these every 30 minutes:

- Open tickets by stage.
- Tickets due today and due in 48 hours.
- SLA breaches by ministry and district.
- Verification backlog age.
- Notification delivery failures.
- Evidence scan failures.
- Security export failures.
- API p95 latency and error rates.
- Rate-limit rejects by rule.

## 11. Launch Hold Conditions

Hold public launch if any of these remain true:

- Any deployment preflight blocker exists.
- Any Admin launch-readiness blocker exists.
- The rendered env still contains template, smoke-test, localhost, or example values.
- Protected-category SOP or legal/vigilance owner is not approved.
- Backup/restore drill has not been run against a production-like database.
- SIEM/WORM export is not configured.
- Public surfaces reference unapproved official marks, protected emblems, or public-figure likenesses instead of the neutral MVP1 placeholder assets.

The citizen and public transparency APIs use neutral Whistle-owned placeholder assets by default. Treat any future switch to official marks, government emblems, portraits, or public-figure likenesses as a launch-hold change until legal/public-use approval is recorded.
