# Whistle — Sandbox / Test Environment Deployment Plan ($0 Free-Tier)

**Prepared by:** Architecture + Deployment Management
**Date:** 2026-06-08
**Goal:** Stand up a continuously-deployed sandbox/test environment for Whistle at **$0**, simplest-possible ops, with GitHub Actions CI/CD and a free S3-style bucket provisioned for evidence.

---

## 0. The one thing you must know first (verified in code)

Whistle has a **deployment-profile gate**. In `officialAuth.ts`, `otpDelivery.ts`, and `evidence/objectStore.ts`, any profile named `production / prod / staging / stage / pilot / uat` **forces real infrastructure or refuses to run**:

| Subsystem | In a gated profile (`staging`/`uat`/…) | Status of the "real" path today |
|---|---|---|
| Official auth | Prototype headers disabled → **requires real OIDC + MFA** | OIDC verifier is implemented (`jose`) ✅ |
| Citizen OTP | Mock OTP disabled → **requires real SMS webhook** | Webhook provider implemented ✅ |
| Evidence store | Local store disabled → **requires S3 object store** | **S3 adapter is a stub that throws** ❌ (`S3CompatibleEvidenceObjectStore`, `objectStore.ts:267-300`) |

**Consequence:** You cannot label the sandbox `uat`/`staging` and expect it to boot — the evidence store would throw on startup because no real S3 adapter exists yet. Two of the three "real" paths work; the evidence S3 adapter is unwritten.

**Decision for a $0 sandbox:** run it as a **`sandbox` profile (not in the gated list)** so the working mock paths are used (prototype auth, mock OTP, local evidence store). Provision the free S3 bucket now so it's ready, and treat "write the real S3 adapter + flip to `uat` profile" as the graduation step (§7). This is the only honest way to get to $0 today without writing new code.

---

## 1. Architecture (target topology)

```
                    ┌─────────────────────────────────────────────┐
   Browser ───────► │  Static frontend (Vite build → dist/)        │
                    │  Cloudflare Pages  (free, global CDN)         │
                    └──────────────────────┬──────────────────────┘
                                           │  HTTPS  (VITE_API_BASE_URL)
                                           ▼
                    ┌─────────────────────────────────────────────┐
                    │  Fastify API  (server/main.ts, Node 20)      │
                    │  Render Web Service  (free tier)             │
                    │  profile = "sandbox"                         │
                    └───────┬───────────────────┬─────────────────┘
                            │                   │
                   DATABASE_URL          WHISTLE_EVIDENCE_* (bucket ready,
                            │             adapter pending — see §7)
                            ▼                   ▼
        ┌───────────────────────────┐   ┌──────────────────────────┐
        │ Postgres (Neon free tier) │   │ Cloudflare R2 bucket      │
        │ schema via db:migrate     │   │ (free 10GB, S3-compatible)│
        └───────────────────────────┘   └──────────────────────────┘

   CI/CD: GitHub Actions on push to `sandbox` branch →
          tsc --noEmit + smoke tests + db:migrate → trigger Render + Pages deploy
```

---

## 2. Free-tier service choices (and why)

| Layer | Service | Free tier | Why this one |
|---|---|---|---|
| **API host** | **Render** Web Service | 750 hrs/mo, sleeps after 15 min idle | Native Node, runs a long-lived Fastify process (Vercel/Netlify functions can't host a persistent Fastify server cleanly). Reads `PORT`, gives HTTPS + a stable URL free. |
| **Database** | **Neon** Postgres | 0.5 GB, autosuspend | Serverless Postgres, branchable, generous free tier; `DATABASE_URL` drops straight into the code's Postgres repos. Alt: Supabase (also free Postgres + Storage). |
| **Frontend** | **Cloudflare Pages** | unlimited static, global CDN | Free static hosting for `dist/`; trivial Vite deploys. Alt: Netlify / GitHub Pages. |
| **Evidence bucket** | **Cloudflare R2** | 10 GB storage, no egress fees | S3-compatible, provisioned now for the future adapter. Alt: Supabase Storage, Backblaze B2. |
| **CI/CD** | **GitHub Actions** | 2,000 min/mo private (unlimited public) | Matches your build-before-ship rules; runs `tsc --noEmit` + smoke tests + migrate, then triggers deploys. |
| **Secrets** | GitHub Actions Secrets + Render/Neon env | free | No secret ever committed; injected at deploy/runtime. |

**Cost guardrail:** every service above stays $0 as long as the sandbox is low-traffic. The only "gotchas" are Render cold starts (≈30 s after idle) and Neon autosuspend (first query wakes it) — acceptable for a test env.

> Single-box alternative (if you'd rather self-host): one `docker compose` on a free-tier VM (Oracle Cloud Always-Free ARM, or Fly.io free allowance) running Postgres + API + a static server. The repo's existing `docker-compose.yml` already defines Postgres. More control, more host ops — not recommended for "simplest".

---

## 3. Environment variables (exact, from code)

Set these on the **Render API service**. Profile is deliberately **`sandbox`** (not gated):

```bash
# --- Profile / runtime ---
WHISTLE_DEPLOYMENT_PROFILE=sandbox      # NOT prod/staging/pilot/uat → mock paths stay enabled
NODE_ENV=production                      # for Node perf; profile var above controls the gates
LOG_LEVEL=info
PORT=3001                                # Render injects PORT; ensure main.ts reads process.env.PORT

# --- Database (from Neon dashboard) ---
DATABASE_URL=postgres://USER:PASS@HOST/db?sslmode=require

# --- CORS: lock to the Pages domain (fixes H2 from the security review) ---
WHISTLE_ALLOWED_ORIGINS=https://whistle-sandbox.pages.dev

# --- Citizen OTP (sandbox = mock, code "123456"; hide it from API responses) ---
WHISTLE_OTP_PROVIDER_MODE=               # empty → mock provider in sandbox profile
WHISTLE_EXPOSE_MOCK_OTP=false            # do NOT return the OTP in API responses

# --- Official auth: prototype headers OK in sandbox; switch to OIDC at graduation ---
# (leave WHISTLE_OFFICIAL_OIDC_* unset for sandbox)

# --- Evidence: bucket provisioned, adapter pending → keep local mock for now ---
WHISTLE_EVIDENCE_OBJECT_STORE_MODE=      # empty → LocalEvidenceObjectStore in sandbox profile
WHISTLE_EVIDENCE_STORE_DIR=/var/data/evidence-objects   # Render disk path (ephemeral on free tier)
# R2 values below are staged for the future adapter (§7), harmless while mode is local:
# WHISTLE_EVIDENCE_S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com
# WHISTLE_EVIDENCE_S3_BUCKET=whistle-sandbox-evidence
# WHISTLE_EVIDENCE_S3_REGION=auto
```

Frontend (**Cloudflare Pages** build env):

```bash
VITE_API_BASE_URL=https://whistle-sandbox.onrender.com
```

> Note on evidence on free Render: the local store writes to disk, which is **ephemeral** (wiped on redeploy). Fine for a sandbox where evidence is throwaway. Durable evidence = the R2 adapter in §7.

---

## 4. Step-by-step bring-up (first time, ~30–45 min)

1. **Neon** — create project → copy `DATABASE_URL` (with `sslmode=require`).
2. **Cloudflare R2** — create bucket `whistle-sandbox-evidence`; generate an S3 API token. Store the keys as GitHub secrets (used later by the adapter, not today).
3. **Render** — New Web Service from the GitHub repo:
   - Build command: `npm ci && npm run build`
   - Start command: `node --import tsx server/main.ts`
   - Add all env vars from §3.
4. **Migrate the DB** — run once (locally or via a Render one-off job):
   `DATABASE_URL=... npm run db:migrate`
5. **Cloudflare Pages** — connect repo, framework "Vite", build `npm ci && npm run build`, output dir `dist`, set `VITE_API_BASE_URL` to the Render URL.
6. **Smoke check** — hit the API health route and load the Pages URL; submit a test complaint, verify with OTP `123456`.

---

## 5. CI/CD — GitHub Actions (free)

Create `.github/workflows/sandbox.yml`. It enforces your build-before-ship rule, runs the cheap smoke suite, migrates, then lets Render/Pages auto-deploy on the same push.

```yaml
name: sandbox-deploy
on:
  push:
    branches: [sandbox]
jobs:
  verify-and-migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint            # tsc --noEmit (never skipped, per project policy)
      - run: npm run api:check       # tsc -p tsconfig.api.json --noEmit
      - run: npm run smoke:lifecycle && npm run smoke:access && npm run smoke:official-auth
      - run: npm run db:migrate
        env:
          DATABASE_URL: ${{ secrets.SANDBOX_DATABASE_URL }}
      # Render + Cloudflare Pages auto-deploy from the same push (connect repo in their dashboards).
      # Optional explicit trigger:
      # - run: curl -fsSL "${{ secrets.RENDER_DEPLOY_HOOK }}"
```

Secrets to add in GitHub repo settings: `SANDBOX_DATABASE_URL`, optionally `RENDER_DEPLOY_HOOK`, and the R2 keys for §7.

> The full `npm run mvp:check` runs 50+ smoke scripts — too heavy for every push. Run the trimmed set above on push; run `mvp:check` nightly or manually before graduation.

---

## 6. Security posture for the sandbox (ties to the security review)

The sandbox intentionally runs mock paths, so call out the residual risk plainly:

- **OTP is `123456`** (H1 in the review) — acceptable in an isolated sandbox with throwaway data; **must not** carry to any real profile. Set `WHISTLE_EXPOSE_MOCK_OTP=false` so the code isn't echoed in responses.
- **Prototype official auth is on** — anyone can act as any role via headers. Keep the sandbox URL unlisted / behind Cloudflare Access if you want a basic gate; never load real citizen data.
- **CORS** — pin `WHISTLE_ALLOWED_ORIGINS` to the Pages domain (don't leave it allow-all-local). This directly closes review finding H2.
- **No real PII** — seed only synthetic data (`npm run mvp1:uat-seed`). Treat the whole environment as public-ish.

---

## 7. Graduation path: sandbox → real `uat`/`staging`

When you want a profile that mirrors production, three things must be true (all enforced by the gates):

1. **Write the S3 evidence adapter.** Replace the `S3CompatibleEvidenceObjectStore` stub (`objectStore.ts:267-300`) with a real implementation against the R2 bucket already provisioned (S3 SDK or `fetch` + SigV4). This is the **only code change** required to unblock a gated profile. Until then, `WHISTLE_DEPLOYMENT_PROFILE=uat` will throw on boot.
2. **Configure OIDC + MFA** — set `WHISTLE_OFFICIAL_OIDC_ISSUER/AUDIENCE/JWKS_URL` (or HS256 secret) and a role claim. Use a free IdP tier (Auth0/Keycloak) for test.
3. **Configure a real OTP webhook** — set `WHISTLE_OTP_PROVIDER_MODE=webhook` + `WHISTLE_OTP_PROVIDER_WEBHOOK_URL` + `WHISTLE_OTP_PROVIDER_API_KEY`, **and fix H1** (generate a random OTP instead of the `"123456"` constant) before any profile sends real SMS.

Then flip `WHISTLE_DEPLOYMENT_PROFILE=uat`, run `npm run deployment:preflight:assert`, and the app's own preflight will confirm the gates are satisfied.

---

## 8. Teardown / cost control

- Everything is free-tier; nothing auto-bills. To pause: suspend the Render service and Neon project (both resume on demand).
- Delete the R2 bucket contents if storage approaches the 10 GB free cap.
- No `DELETE` queries against Postgres are part of this plan; schema reset = re-run `db:migrate` against a fresh Neon branch.

---

## Appendix — verified facts this plan relies on

- Build: `npm run build` = `tsc --noEmit && vite build` → static `dist/`.
- API entry: `node --import tsx server/main.ts`; Postgres selected automatically when `DATABASE_URL` is set (`createPhoneVerificationRepository` and the ticket/access repos).
- Migration: `npm run db:migrate` runs `server/db/migrate.ts` (executes static `schema.sql`).
- Deps: Fastify, `@fastify/cors`, `pg`, `jose`, `zod`, React/Vite. Node 20 recommended (no `engines` pin in `package.json`).
- Profile gate values: `production, prod, staging, stage, pilot, uat` (identical list in all three gate functions).
- S3 evidence adapter: **stub only** today — confirmed at `server/evidence/objectStore.ts:267-300`.
