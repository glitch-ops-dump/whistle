# Whistle — Full-Codebase Security Review

**Date:** 2026-06-08
**Scope:** Deep audit of `server/` (auth, access-control, data layer, evidence, audit chain, OTP, HTTP hardening) plus the role dashboards (`src/MinistryOperationsConsole`, `MlaDashboard`, `CmCellMockup`, `VerificationConsole`, `AdminConsole`) and the public transparency surface (`server/ticket-spine/publicInsights.ts`).
**Method:** Four parallel review passes, then **every load-bearing finding re-verified by hand against the actual source** before inclusion. Findings that turned out to be speculative or auto-mitigated were downgraded or dropped — see "Corrected / Rejected" at the end. Read-only review; no code changed.

---

## How to read severity here

This codebase has a deliberate **deployment-profile gate**. In `server/auth/officialAuth.ts` (`deploymentRequiresOfficialAuth`, lines 45-48) and `server/citizen-verification/otpDelivery.ts` (`deploymentRequiresOtpProvider`, lines 34-37), any environment whose `NODE_ENV` / `WHISTLE_ENV` / `WHISTLE_DEPLOYMENT_PROFILE` is `production`, `prod`, `staging`, `stage`, `pilot`, or `uat` automatically:

- **disables** prototype header-based official auth (forces real OIDC/MFA or denies), and
- **disables** the mock OTP provider (forces a real SMS webhook or fails the health check).

This means several issues the automated passes flagged as "Critical unauthenticated bypass" **cannot occur in a real deployment** — they only exist on a developer machine running with `NODE_ENV=development` and no OIDC. Those are reported as **Low / defense-in-depth**, not Critical. This distinction is the single most important thing in this report.

---

## Summary table

| # | Severity | Real in prod? | Area | File:Line | Issue |
|---|----------|---------------|------|-----------|-------|
| H1 | **High** | **Yes** | OTP | `citizen-verification/repository.ts:65,147,164,252,292` | OTP code is the hardcoded constant `"123456"` — even the Postgres/webhook path delivers it; no real code is ever generated |
| H2 | **High** | Yes (config) | CORS | `app.ts` cors block + `WHISTLE_ALLOWED_ORIGINS` default | When origins unset, CORS falls back to allow-all-local **with `credentials: true`**; ensure prod always sets explicit origins |
| M1 | Medium | Yes | Access control | `server/app.ts` ticket-detail read path / `auth/policy.ts:147-153` | Protected-ticket role gate is enforced server-side, but verify non-protected citizen **phone/PII masking for `councillor`** is enforced on the detail endpoint, not just hidden in the client |
| M2 | Medium | Yes | Rate limit | `security/rateLimit.ts` (`clientKey` uses `request.ip`) | Rate-limit key trusts `request.ip`; if Fastify `trustProxy` is enabled without a fixed hop count, `X-Forwarded-For` can be spoofed to evade OTP/start limits |
| M3 | Medium | Yes | Public surface | `ticket-spine/publicInsights.ts:131` | Public payload includes a statewide `protectedCount` aggregate; reconsider exposing any protected-complaint number publicly |
| L1 | Low | Dev only | Auth | `auth/policy.ts:136` | `prototype-default` source short-circuits grant checks — reachable only when OIDC is unset AND profile is not prod/staging/pilot/uat |
| L2 | Low | Dev only | Auth | `auth/policy.ts:156-167`, `app.ts` dashboard/evidence routes | Role taken from query/header in prototype mode; neutralised by OIDC + profile gate in any real deployment |
| L3 | Low | Yes | OTP | `citizen-verification/repository.ts:96` | `challengeId()` uses `Math.random()` — not the secret, but should be `crypto.randomUUID()` for consistency |
| L4 | Low | Yes | OTP exposure | `otpDelivery.ts:74` (`WHISTLE_EXPOSE_MOCK_OTP` default true) | Mock provider returns the code in the API response by default; off in prod, but default-on is risky if profile is misconfigured |
| L5 | Low | Yes | Audit | `audit/hashChain.ts` | Hash chain is unkeyed SHA-256 — tamper-evident against partial edits, but a full-table rewrite can recompute a valid chain; consider an HMAC/signed checkpoint anchor |
| L6 | Low | Yes | Public surface | `publicInsights.ts:101-102,132-133` | Withheld small-cell row/ticket counts are published; minor inference channel about sparse districts |

**No SQL injection found.** Every Postgres query in `ticket-spine/postgresRepository.ts`, `access/postgresRepository.ts`, `config/postgresConfigRepository.ts`, and `citizen-verification/repository.ts` is parameterized (`$1, $2, …`). No dynamic string-built SQL, no user-controlled `ORDER BY`/column names. Migrations (`db/migrate.ts`) execute a static `schema.sql`; no secrets, no dynamic SQL.

---

## High severity

### H1 — OTP verification code is a hardcoded constant (`"123456"`)

**File:** `server/citizen-verification/repository.ts:65` (`const mockOtp = "123456";`), used at lines 147, 164 (Dev repo) and 252, 292 (Postgres repo).

**Verified:** There is no random-OTP generation anywhere in the codebase. Both the in-memory **and** the Postgres repository hash and "send" the same fixed string. When a real webhook SMS provider is configured (`WebhookSmsOtpDeliveryProvider`), the value passed to it at line 292 is still `mockOtp` — so a production deployment with a real SMS contract would text **"123456" to every citizen**, and anyone can verify any phone by entering `123456`.

**Impact:** Citizen phone verification — the gate in front of complaint submission, including the protected/whistleblower channel — is effectively bypassable. This is a real code defect, independent of deployment profile.

**Fix:** Generate a cryptographically random 6-digit code per challenge (e.g. `crypto.randomInt(0, 1_000_000).toString().padStart(6, "0")`), hash it as today, and pass the generated code (never the constant) to the delivery provider. Keep `maxAttempts` low (consider 3) and add per-challenge verify-attempt rate limiting.

### H2 — CORS allow-all-local fallback with credentials

**File:** `server/app.ts` CORS registration; governed by `WHISTLE_ALLOWED_ORIGINS` / `corsOriginPolicy`.

**Verified:** When `WHISTLE_ALLOWED_ORIGINS` is unset, the origin policy mode is `allow-all-local`, which calls back `true` for any origin, while `credentials: true` is set and the app issues `HttpOnly; SameSite=Lax` session cookies. `SameSite=Lax` blunts classic CSRF on cross-site POSTs, but allow-all-origin + credentials is the wrong default for any internet-reachable instance.

**Impact:** If a non-local instance is ever started without `WHISTLE_ALLOWED_ORIGINS`, a malicious site could make credentialed cross-origin reads against an authenticated officer session.

**Fix:** Make explicit `WHISTLE_ALLOWED_ORIGINS` **required** when the deployment profile is prod/staging/pilot/uat (fail fast on boot, matching the pattern already used for OIDC and OTP). Consider `SameSite=Strict` for the session cookie if the UI doesn't depend on cross-site top-level navigation.

---

## Medium severity

### M1 — Confirm citizen-PII masking on the ticket-detail endpoint (not just the list)

**Verified safe:** The dashboard **list** path (`ticketSummary`, `dashboard.ts:137-158`) never emits citizen phone/address/identity — only a boolean `citizenIdentityVisible` and aggregate counts — and protected tickets are dropped server-side for unauthorized roles (`hasRoleVisibility`, line 95; `authorizeTicketRead`, `policy.ts:147-153`). So the "client-side trust" concern does **not** apply to the dashboard list.

**Open item:** The single-ticket detail endpoint (`GET /api/tickets/:id`) is where full PII lives. Protected-ticket gating is enforced there server-side, but the `citizenIdentityVisible` rule for a **non-protected** ticket viewed by a `councillor` (line 153: `filter.role !== "councillor"`) must be enforced when the detail response is built — i.e. the server should withhold/mask the phone for councillor, not rely on the client honoring the flag. Verify and, if needed, mask server-side.

**Fix:** Ensure the detail serializer applies the same `citizenIdentityVisible` rule server-side and returns `citizenPhoneMasked` (never the raw phone) to any role for which the flag is false.

### M2 — Rate-limit key trusts client IP

**File:** `server/security/rateLimit.ts` — `clientKey()` returns `` `${request.ip}:${subject}` ``.

**Verified:** Keying on `request.ip` is fine **only** if Fastify `trustProxy` is configured to a known, fixed proxy topology. If `trustProxy` is enabled broadly (or later turned on for a load balancer) without pinning the hop count, `X-Forwarded-For` becomes attacker-controlled and the OTP-start limit (and other limits) can be evaded by rotating spoofed IPs.

**Fix:** Pin `trustProxy` to the exact number of trusted proxies (or specific CIDRs) for the real deployment, and for identity-bound actions (OTP start/verify) also rate-limit by phone hash / subject, not IP alone.

### M3 — Public transparency payload exposes a protected-complaint count

**File:** `server/ticket-spine/publicInsights.ts:131` — `protectedCount: tickets.filter(t => t.protected).length`.

**Verified:** Protected complaint *content* is correctly excluded from the public surface (`canPublishTicket`, lines 43-47; titles/descriptions/phone/identity are never emitted; small-cell suppression and a publication delay are applied). The only protected-data exposure is this single statewide integer, which the inline comment frames as an intentional V2-prototype policy.

**Impact:** Publishing even an aggregate count of protected/corruption complaints lets the public track day-over-day deltas and infer reporting activity. Low data volume, but it's the most externally exposed surface, so it warrants a deliberate decision.

**Fix:** Remove `protectedCount` from the public payload (keep it internal-only), or gate the whole `privacy` block behind an authenticated government-transparency role. Same reasoning applies to L6 (withheld small-cell counts).

---

## Low severity / hardening

- **L1 / L2 — Prototype auth paths (`policy.ts:136`, `:156-167`).** The `prototype-default` short-circuit and query/header-derived role are real, but `officialAuthMode()` returns `prototype-disabled` for any prod/staging/pilot/uat profile, and OIDC-JWT mode derives the role from a verified, MFA-asserted token (`officialAuth.ts:104-141`). So these are exploitable **only** in local dev with no OIDC. Recommend a startup assertion that refuses to boot in any non-local profile unless OIDC is configured (the building blocks already exist via `officialAuthHealthCheck`).
- **L3 — `challengeId()` uses `Math.random()` (`repository.ts:96`).** The challenge ID is not a secret (the OTP is), so this is not directly exploitable, but switch to `crypto.randomUUID()` for consistency and to avoid future misuse.
- **L4 — Mock OTP returned in API by default (`otpDelivery.ts:74`, `WHISTLE_EXPOSE_MOCK_OTP` defaults true).** Off in prod profiles, but a default-on secret-in-response is risky if the profile env is ever misconfigured. Default it to **off**.
- **L5 — Audit chain is unkeyed (`hashChain.ts`).** SHA-256 chaining is correct and tamper-evident against partial edits, but an attacker with full write access to the audit store can recompute a consistent chain. Consider an HMAC keyed with a secret held outside the DB, or periodic signed checkpoints / external anchoring.
- **L6 — Withheld small-cell counts published (`publicInsights.ts:101-102,132-133`).** Minor inference channel about sparse districts; fold into the M3 decision.

---

## What was checked and found solid

- **Password hashing:** `scryptSync` with a random per-credential salt and timing-safe comparison (`server/account/*`, `auth/governmentPasswordAuth.ts`).
- **Session tokens:** `crypto.randomBytes(32)`; worker-token comparison is timing-safe.
- **OIDC verification:** real `jose` JWT verification with issuer/audience checks and a required MFA-assurance claim (`officialAuth.ts`).
- **SQL:** fully parameterized across all repositories; no injection surface. Static migrations.
- **Access scoping:** protected-ticket visibility and role/scope filtering are enforced **server-side** in `dashboard.ts` / `policy.ts`; dev and Postgres access repositories enforce the same effective-access filtering (active user, non-expired membership/grants) — no dev-vs-prod parity gap found.
- **HTTP hardening:** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, restrictive CSP, HSTS for non-local, 50 MB body limit.
- **Audit chain:** genuine SHA-256 hash chain with canonical field ordering and a working verifier.

---

## Corrected / rejected automated findings (recorded for transparency)

These were raised by the parallel passes and **downgraded or rejected after manual verification**:

1. *"Critical: unauthenticated attacker can claim any role via `?role=`."* — **Rejected as Critical.** Neutralised in every real deployment by the profile gate + OIDC-JWT role derivation. Retained as L1/L2 (dev-only hardening).
2. *"Critical: audit hash chain integrity depends on weak RNG IDs."* — **Rejected.** Tamper-evidence comes from SHA-256 chaining of content + previous hash, not from ID randomness. Retained only the unkeyed-chain limitation as L5.
3. *"Critical: public surface leaks protected complaints."* — **Downgraded to M3.** Protected *content* is excluded server-side; only a single aggregate count is exposed.
4. *"Critical: client-side trust hides councillor identity."* — **Downgraded to M1.** The dashboard list never sends PII server-side; the only residual is confirming detail-endpoint masking.
5. *"Critical: protected tickets readable via `getTicket()` with no authz."* — **Rejected as standalone Critical.** `authorizeTicketRead` enforces protected-role gating in the route layer before the repository result is returned. Folded into M1 as a verify item.

---

*Prepared as a read-only review of the full Whistle codebase. Before remediation commits, run `tsc --noEmit` and the test suite per project policy. No delete/migration queries were run.*
