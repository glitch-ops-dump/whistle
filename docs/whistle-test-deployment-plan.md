# Whistle TEST Deployment Plan

## Purpose

This plan is for a remote TEST environment only. It is not a production launch, not a public staging launch, and not approval to process real citizen data.

The TEST environment exists so functional and agentic testing can exercise the real app shape with persistent Postgres, restricted browser origins, worker authentication, shared rate limits, government account sessions, and the deployed frontend/API boundary.

## TEST Deployment Decisions

- TEST uses `WHISTLE_DEPLOYMENT_PROFILE=test`.
- TEST must use a managed or hosted Postgres database, not in-memory state.
- TEST may use seeded mobile/password government accounts for Admin, Verification, CM Cell, Minister, MLA, Councillor, and Department Officer flows.
- TEST should keep `WHISTLE_PROTOTYPE_OFFICIAL_AUTH=false` so government testing uses account sessions instead of prototype role headers.
- TEST must configure a worker shared secret.
- TEST must hide mock OTP values from API responses with `WHISTLE_EXPOSE_MOCK_OTP=false`.
- TEST may use mock OTP delivery, mock notifications, local security export, and local telemetry.
- TEST may use local evidence storage only if the configured directory is backed by persistent test disk.
- TEST must configure explicit browser origins.
- TEST must use a shared public rate-limit backend, preferably Postgres for MVP1.
- Staging and production remain stricter: real OIDC/MFA, OTP provider, notification provider, evidence object storage, SIEM/WORM export, telemetry, backup/restore evidence, and launch gates remain required.

## Suggested TEST Origins

Use final URLs from the hosting provider or DNS owner. These are suggested names only.

| Surface | Suggested TEST Origin |
| --- | --- |
| Citizen PWA | `https://citizen-test.whistle.example` |
| Government consoles | `https://console-test.whistle.example` |
| API | `https://api-test.whistle.example` |

Frontend builds must set:

```env
VITE_WHISTLE_API_BASE=https://api-test.whistle.example
```

API/worker env must set:

```env
WHISTLE_ALLOWED_ORIGINS=https://citizen-test.whistle.example,https://console-test.whistle.example
```

## What Must Be Configured

| Area | Needed |
| --- | --- |
| Frontend host | Vercel/project or equivalent static host for `citizen.html`, `admin.html`, `verification.html`, `cm-cell.html`, `ministry.html`, `mla.html`, and other prototype pages. |
| API host | Paid or test runtime that can run the Node/Fastify API continuously over HTTPS. |
| Worker runtime | Scheduled/manual worker runner with `x-whistle-worker-token` or bearer token set from the TEST worker secret. |
| Postgres | TEST `DATABASE_URL`, migrations applied, and test owner confirmed. |
| Domains/DNS | Citizen, console, and API TEST hostnames with HTTPS. |
| Browser origins | `WHISTLE_ALLOWED_ORIGINS` containing only the actual TEST citizen and console origins. |
| Secrets | TEST database URL, worker shared secret, and rate-limit hash salt stored outside git. |
| Evidence test storage | Persistent test disk path for `WHISTLE_EVIDENCE_STORE_DIR`, or evidence binary upload testing stays limited. |
| Test accounts | Seeded government/citizen accounts and role scopes for Admin, Verification, CM Cell, Minister, MLA, Councillor, and Department Officer tests. |
| Seed pack | Which jurisdiction/sample pack to load, such as Tamil Nadu sample or India/base sample. |

## Environment Template

Use:

```sh
ops/env/whistle-mvp1-test.env.example
```

Do not deploy the file as-is. Render a real TEST env from the secret manager or host dashboard.

Required TEST keys:

```env
WHISTLE_DEPLOYMENT_PROFILE=test
DATABASE_URL=<test postgres url>
WHISTLE_SEED_DEMO=false
WHISTLE_PROTOTYPE_OFFICIAL_AUTH=false
WHISTLE_WORKER_AUTH_REQUIRED=true
WHISTLE_WORKER_SHARED_SECRET=<test worker secret>
WHISTLE_EXPOSE_MOCK_OTP=false
WHISTLE_EVIDENCE_STORE_DIR=<persistent test evidence path>
WHISTLE_RATE_LIMIT_BACKEND=postgres
WHISTLE_RATE_LIMIT_KEY_SALT=<test hash salt>
WHISTLE_ALLOWED_ORIGINS=<citizen test origin>,<console test origin>
WHISTLE_SECURITY_HEADERS_ENABLED=true
```

## Deploy And Verify

1. Configure the API/worker TEST env from `ops/env/whistle-mvp1-test.env.example`.
2. Apply Postgres migrations:

```sh
npm run db:migrate
```

3. Build the frontend with `VITE_WHISTLE_API_BASE` pointing to the TEST API:

```sh
npm run build
```

4. Run the TEST preflight against the rendered env:

```sh
npm run deployment:preflight -- --env-file /secure/rendered/whistle-test.env
```

5. Confirm the report says:

- `Profile: test`.
- `Production target: no`.
- Postgres-backed repositories pass.
- Worker authentication passes.
- Mock OTP exposure passes.
- Browser origin allowlist passes.
- Distributed/Postgres rate limits pass.

6. Seed TEST data and role accounts using the agreed seed pack.
7. Run functional UAT through the deployed URLs.
8. Run agentic/browser tests against the deployed citizen and government console origins.
9. Record defects separately from production launch blockers.

## TEST Readiness Is Not Production Readiness

TEST can be considered ready for UAT when:

- API `/api/ready` is `200`.
- Frontend pages load from TEST domains and call the TEST API.
- Government account login works for each test role.
- Citizen complaint submission, OTP flow, ticket lookup, verification, routing, SLA worker, notification worker, and role console reads can be exercised.
- Admin configuration changes write to Postgres-backed audit/config state.
- Worker jobs require the configured worker token.
- Rate limits use Postgres-backed buckets.

Production remains blocked until production/staging preflight, provider contracts, evidence storage, SIEM/WORM export, telemetry, backup/restore drill evidence, incident hold rules, and launch approvals are satisfied.

## Inputs Needed From The Team

- Final TEST citizen URL.
- Final TEST console URL.
- Final TEST API URL.
- Frontend hosting account/project access.
- API/worker hosting account/project access.
- TEST Postgres provider and database URL, supplied through the host secret manager rather than chat.
- Persistent test disk path or decision to skip real evidence binary persistence in TEST.
- TEST worker secret and rate-limit salt, supplied through the host secret manager.
- Initial test account list and roles.
- Seed pack choice: Tamil Nadu sample, India/base sample, or custom.
- Whether deployment should be done by CLI from this workspace or by connecting the repo to the hosting provider.
