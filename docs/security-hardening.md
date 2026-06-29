# Whistle Security Hardening Plan

Source scan: Codex Security repository scan `68449aedab54_20260604T160519Z`, generated 2026-06-04. Final reports are in `/tmp/codex-security-scans/Whistle/68449aedab54_20260604T160519Z/report.md` and `/tmp/codex-security-scans/Whistle/68449aedab54_20260604T160519Z/report.html`.

This file consolidates the repository-wide security findings into one launch hardening gate. The status column is intentionally conservative: "not started" means no fix has been implemented and verified in this hardening pass, even if surrounding roadmap/runbook docs already mention the control.

## Phase 0 - Critical Auth Containment

Status: implemented in working tree; locally verified 2026-06-04.

Goal: remove the production/staging path where source-visible prototype government accounts can become admin sessions.

| Finding | Severity | Status | Phase 0 acceptance |
| --- | --- | --- | --- |
| CS-WHISTLE-001: Production-profile government auth accepts seeded prototype admin credentials | Critical | fixed in working tree | Government mobile/password login is local/dev/test only; production-like runtimes do not seed prototype government password accounts; existing seeded prototype account sessions are expired/deleted; production-profile smoke proves `+91 90000 25005` / `Whistle@123` is rejected before credential verification; preflight reports the government password auth mode. |

Implementation checklist:

- Add one shared runtime gate for government mobile/password account auth.
- Keep demo government password accounts available only for explicit local UAT or local development.
- Stop seeding prototype government password accounts in persistent or production-like runtimes.
- Inactivate seeded prototype government accounts and delete their sessions when the account repository initializes outside the local gate.
- Block government password login, government password reset/change, government session introspection, and government account-session authorization outside the local gate.
- Add focused regression coverage in official-auth and deployment-preflight smoke tests.
- Rotate or invalidate any seeded government password accounts that may already exist in shared databases.

## Phase 1 - High-Risk Data And Workflow Fixes

Status: implemented in working tree; locally verified 2026-06-04.

Goal: close issues that can misrepresent evidence controls, leak protected evidence metadata, or let citizens rewrite routed workflow state.

| Finding | Severity | Status | Acceptance |
| --- | --- | --- | --- |
| CS-WHISTLE-002: S3-compatible evidence storage is a local mock with production-ready labels | High | fixed in working tree | Declarative S3-compatible mode now reports `s3-compatible-object-store-unimplemented`, readiness/upload completion fail closed, and production preflight remains blocked until a real adapter performs remote object verification, private bucket policy, KMS, scanner verdict, and residency checks. |
| CS-WHISTLE-003: Hidden protected evidence responses disclose storage metadata and checksums | High | fixed in working tree | Evidence access responses are access-level-specific DTOs; hidden evidence includes only evidence id, access level, and denial reason; metadata-only evidence omits storage keys, checksums, controls, and internal object identifiers. |
| CS-WHISTLE-004: Citizen update can reset routed tickets back to verification | High | fixed in working tree | Citizen updates are accepted only while the ticket is in `needs_info`, queued to `citizen`, and SLA-paused; routed/resolved/closed/rejected states return `citizen_update_not_allowed` and cannot reset queue/SLA state. |

Implementation notes:

- `server/evidence/objectStore.ts` keeps local mock storage only for local development and makes S3-compatible mode unavailable until a real adapter is wired.
- `server/ticket-spine/lifecycle.ts` creates redacted evidence DTOs for hidden and metadata-only access levels.
- `server/app.ts`, `server/ticket-spine/devRepository.ts`, and `server/ticket-spine/postgresRepository.ts` enforce citizen-update lifecycle guards before state mutation.

Validation evidence:

- `npm run api:check`
- `npm run smoke:evidence-object-store`
- `npm run smoke:lifecycle`
- `npm run smoke:deployment-preflight`
- `npm run smoke:deployment-preflight-cli`
- `npm run smoke:verification-console`
- `npm run smoke:production-runbook`
- `npm run smoke:security-hardening`
- `npm run build`
- `git diff --check`

## Phase 2 - Abuse And Token Hardening

Status: implemented in working tree; locally verified 2026-06-04.

Goal: reduce brute-force, SMS abuse, replay, and token-theft blast radius.

| Finding | Severity | Status | Acceptance |
| --- | --- | --- | --- |
| CS-WHISTLE-005: Account auth OTP, login, and reset routes bypass public rate limits | Medium | fixed in working tree | Account OTP start/verify, login, and password-reset routes now have route-specific public rate-limit rules keyed by IP plus phone/challenge/surface, with hashed keys for distributed gateways. |
| CS-WHISTLE-006: Frontend persists privileged and citizen bearer tokens in localStorage | Medium | fixed in working tree | Account session tokens move to an HttpOnly session cookie; auth/session DTOs redact session, phone-verification, and local-UAT official bearer tokens; frontend auth clients persist only sanitized metadata and send `credentials: "include"`. |
| CS-WHISTLE-007: Ticket idempotency records are saved after mutations | Medium | fixed in working tree | Ticket create, citizen update, citizen dispute/reopen, and verification decision flows reserve idempotency keys before mutation and finalize records with the response ticket after persistence. |

Implementation notes:

- `server/security/rateLimit.ts` adds account-auth rate-limit rules for OTP, login, and reset abuse controls.
- `server/app.ts` sets and clears the `whistle_account_session` HttpOnly cookie, redacts token-bearing auth DTO fields, and reserves idempotency keys before ticket mutations.
- `server/ticket-spine/repository.ts`, `server/ticket-spine/devRepository.ts`, `server/ticket-spine/postgresRepository.ts`, and `server/db/schema.sql` support reserved idempotency records with nullable response tickets.
- `src/authApi.ts`, `src/officialAuthClient.ts`, and official-console API clients use cookie credentials and avoid localStorage bearer/session-token persistence.

Validation evidence:

- `npm run api:check`
- `npm run smoke:rate-limits`
- `npm run smoke:account-auth`
- `npm run smoke:lifecycle`
- `npm run smoke:security-hardening`
- `npm run smoke:official-auth`
- `npm run smoke:verification-console`
- `npm run smoke:deployment-preflight`
- `npm run build`
- `git diff --check`

## Phase 3 - Audit And Authorization Precision

Status: implemented in working tree; locally verified 2026-06-04.

Goal: make protected access, verifier accountability, and scoped owner access unambiguous in audit and authorization.

| Finding | Severity | Status | Acceptance |
| --- | --- | --- | --- |
| CS-WHISTLE-008: Protected evidence access audit trusts a query actor | Medium | fixed in working tree | Audit actor and role always come from authenticated context, not query parameters or caller-provided actor values. |
| CS-WHISTLE-009: Verification decisions are not bound to the authenticated verifier in audit data | Medium | fixed in working tree | Verification decision records include authenticated actor, role, and access decision context; caller-provided reviewer fields cannot spoof the verifier. |
| CS-WHISTLE-010: Dashboard and field-action ministry authorization use derived classification instead of active assignment scope | Medium | fixed in working tree | Ministry and department access decisions use active queue/assignment scope, not only derived ticket classification. |
| CS-WHISTLE-011: Dashboard explain leaks exact global protected-ticket counts | Medium | fixed in working tree | Protected dashboard explain responses use scoped counts, thresholds, or redacted aggregates so non-admin roles cannot infer global protected-ticket volume. |

Implementation notes:

- `server/app.ts` overwrites evidence-access and verification-decision actor fields from authenticated context before repository calls, idempotency hashing, audit, or watermarking.
- `server/ticket-spine/lifecycle.ts` stamps verification audit events with authenticated verifier role plus access-decision context, and uses grant-facing ministry scope values for SLA-created ministry assignments.
- `server/ticket-spine/dashboard.ts` and `server/ticket-spine/postgresRepository.ts` scope ministry dashboards to active ministry queue assignments instead of category-derived ministry mapping.
- `server/ticket-spine/dashboard.ts` redacts exact hidden protected-ticket counts for roles without protected-ticket visibility.

Validation evidence:

- `npm run api:check`
- `npm run smoke:lifecycle`
- `npm run smoke:dashboard-explain`
- `npm run smoke:field-execution`
- `npm run smoke:access`
- `npm run smoke:dashboard-briefs`
- `npm run smoke:security-hardening`
- `npm run smoke:verification-console`
- `DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle_phase3_1780594870 npm run smoke:postgres` against a fresh temporary local database
- `npm run build`
- `git diff --check`

## Phase 4 - Deployment Tooling And Secret Hygiene

Status: implemented in working tree; locally verified 2026-06-05.

Goal: make launch evidence parsing and operator feedback fail closed without leaking secret text.

| Finding | Severity | Status | Acceptance |
| --- | --- | --- | --- |
| CS-WHISTLE-012: Readiness packet silently ignores malformed production profile lines | Medium | fixed in working tree | Env parsing fails closed for malformed non-comment lines in production/staging readiness inputs. |
| CS-WHISTLE-013: Env parser includes malformed secret lines in error messages | Low | fixed in working tree | Parser errors include key names and line numbers only; raw secret-like values are redacted. |

Implementation notes:

- `scripts/env-file.ts` now rejects malformed non-comment env lines and invalid keys instead of silently skipping them.
- Env parser errors report file path, line number, and a recoverable key name only; raw malformed lines and secret-like values are not echoed.
- `scripts/deployment-readiness-packet.ts`, `scripts/deployment-preflight-report.ts`, `scripts/mvp1-readiness-status.ts`, and `scripts/mvp1-launch-handoff-packet.ts` use the shared fail-closed parser.

Validation evidence:

- `npm run smoke:deployment-readiness-packet`
- `npm run smoke:deployment-preflight-cli`
- `npm run smoke:deployment-preflight`
- `npm run smoke:mvp1-status`
- `npm run smoke:mvp1-handoff-packet`
- `npm run api:check`
- `npm run build`
- `git diff --check`

Additional launch gates to keep tied to this file:

- DPDP/privacy review for protected reporter data, phone identifiers, audit retention, and public transparency aggregates.
- India data-residency and KMS evidence storage approval before protected evidence launch.
- OIDC/MFA provider approval and role-claim mapping review for every government console role.
- Policy-as-code review for protected corruption reports before any third-party model or automation sees complaint content.
- External penetration test after Phase 1 and Phase 2 fixes land.
