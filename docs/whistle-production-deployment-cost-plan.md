# Whistle Production Deployment Cost Plan

Status: Planning estimate  
Last pricing check: 2026-06-01  
Owner: Whistle Admin / Platform Operations  
Related runbook: `docs/whistle-production-runbook.md`

## Purpose

This note extends the Whistle deployment plan with paid-tier production cost assumptions, HA/DR planning ranges, staging and production browser origins, Postgres ownership, backup/restore drill timing, and launch hold rules.

This is a planning source note, not a vendor contract or final procurement approval. Actual production costs must be confirmed against current vendor invoices, traffic, evidence volume, SMS/WhatsApp usage, and government compliance requirements.

## Pricing Sources

- [Vercel pricing](https://vercel.com/pricing)
- [Render pricing](https://render.com/pricing)
- [Render free tier limitations](https://render.com/docs/free)
- [Neon pricing](https://neon.com/pricing)
- [Railway free trial](https://docs.railway.com/pricing/free-trial)

## Deployment Decisions

| Decision Area | Selected Direction |
| --- | --- |
| Frontend hosting | Vercel for static citizen and government surfaces. |
| API and workers | Separate paid Node API/worker host. |
| Browser origins | Separate citizen and government-console origins for staging and production. |
| Database | Managed Postgres owned by Platform. |
| Backup/restore | Production-like restore drill at T-3 before launch. |
| Launch hold release | Operations plus CM Cell approval required to release a launch hold. |
| Production tiers | Paid tiers only. Free/trial tiers are evaluation-only. |

## Target Runtime Shape

The recommended MVP1 production shape is:

- Vercel serves the citizen PWA/static surfaces and government console static bundles.
- A paid Node runtime hosts the Fastify API.
- A paid worker runtime runs SLA, notification, evidence-scan, audit/export, and batch jobs.
- Managed Postgres is the durable source of truth for tickets, access, configuration, queues, SLA state, notifications, audit, and rate-limit state where applicable.
- A Redis-compatible key-value/cache layer supports shared rate limits and runtime coordination.
- Evidence files use private S3-compatible object storage with KMS and malware-scanner controls.
- Security/audit export flows to an external SIEM/WORM destination.
- OpenTelemetry/logging flows to an approved hosted observability target.

## Free And Trial Tier Position

Free and trial tiers are useful for experiments, local demos, and early engineering validation, but they must not be used for production.

| Provider | Use In Whistle |
| --- | --- |
| Vercel Hobby | Prototype/static preview only. Production should use Pro or Enterprise. |
| Render Free | Evaluation only. Render documents free instances as unsuitable for production and free Postgres as time-limited. |
| Neon Free | Postgres evaluation only. It remains a valid alternative if the team later chooses Neon explicitly. |
| Railway Free Trial | Evaluation only. The trial is credit/time limited and not a production basis. |

## Staging And Production Origins

| Environment | Surface | Browser Origin |
| --- | --- | --- |
| Staging | Citizen | `https://citizen-staging.whistle.example` |
| Staging | Government console | `https://console-staging.whistle.example` |
| Production | Citizen | `https://citizen.whistle.example` |
| Production | Government console | `https://console.whistle.example` |

`WHISTLE_ALLOWED_ORIGINS` must contain only the approved citizen and government-console origins for the target environment. Do not include localhost, smoke, example, temporary preview, or broad wildcard origins in staging or production.

## Recommended Paid MVP1 Production Baseline

Use this as the first real production budget for MVP1 or a controlled pilot. It uses paid tiers only and keeps HA for the database.

| Component | Recommended Paid Tier | Monthly Estimate |
| --- | --- | ---: |
| Vercel frontend hosting | Pro, 3 seats at $20/seat | $60 |
| Vercel analytics/observability add-ons | Speed Insights plus Web Analytics allowance | $10-$30 |
| API/worker workspace | Render Pro workspace | $25 |
| Fastify API runtime | Render Standard web service, 2 instances for HA | $50 |
| Background worker runtime | Render Standard background worker | $25 |
| Cron/scheduled jobs | Render cron/workflow allowance | $5-$25 |
| Managed Postgres | Render Postgres Pro-8gb with HA/PITR | $100 |
| Postgres storage growth | 50 GB at $0.30/GB | $15 |
| Redis/key-value/rate-limit cache | Render Key Value Standard | $32 |
| Evidence object storage/KMS/scanning | S3-compatible storage plus scanner allowance | $50-$150 |
| SIEM/WORM audit export | Entry-level external retention/log drain | $100-$300 |
| OpenTelemetry/metrics | Basic hosted telemetry/export target | $50-$150 |
| SMS/WhatsApp/OTP/notifications | Usage-based provider allowance | $50-$250 |
| Backup/restore artifacts | Object storage plus retained packets | $20-$75 |
| Domain/DNS/TLS | DNS/custom domains, usually low or covered | $0-$25 |

Projected baseline:

- Low estimate: about `$592/month`.
- Practical planning range: `$650-$1,200/month`.
- Excludes heavy SMS usage, enterprise support, legal/compliance tools, and high-volume evidence storage.

## HA/DR-Ready Production Budget

Use this range when launch needs stronger redundancy, larger database headroom, longer retention, and more observability.

| Component | Upgrade Assumption | Monthly Estimate |
| --- | --- | ---: |
| Vercel frontend | Pro with 5 team seats and paid analytics | $120-$180 |
| API runtime | 2-3 paid Node instances | $75-$175 |
| Worker runtime | Dedicated worker plus fallback/manual runner | $25-$85 |
| Managed Postgres | Pro-16gb or equivalent HA/PITR tier | $200+ |
| Storage/PITR growth | 100-250 GB retained data/evidence metadata | $30-$100 |
| Redis/key-value/rate-limit cache | Standard/Pro cache tier | $32-$135 |
| Evidence storage/KMS/scanning | Higher evidence volume and scanner use | $150-$500 |
| SIEM/WORM audit export | Longer retention and audit review | $250-$750 |
| Telemetry/APM | Hosted logs, traces, alerts, dashboards | $150-$500 |
| OTP/SMS/WhatsApp | Pilot-to-public traffic allowance | $150-$750 |
| Backup/restore/DR storage | Restore packets, snapshots, cross-region copies | $75-$250 |

Projected HA/DR range:

- `$1,257-$3,625/month`.
- Use `$2,000/month` as the internal planning anchor until real traffic, evidence volume, and provider contracts are known.

## Enterprise / Government-Grade Track

Use this track if the launch requires contractual SLA, SSO/SCIM, compliance paperwork, private networking, dedicated support, formal uptime guarantees, or government procurement constraints.

| Area | Likely Tier |
| --- | --- |
| Vercel | Enterprise, custom quote. |
| API host | Render Enterprise or AWS/GCP/Azure managed containers. |
| Database | Managed Postgres with HA, PITR, cross-region DR, compliance support, and operational support contract. |
| Security | SIEM/WORM, KMS, malware scanning, WAF, audit retention, and formal incident evidence retention. |
| Identity | Approved OIDC/MFA/SSO provider. |
| Support | Contractual support and incident response SLA. |

Projected enterprise range:

- Minimum planning placeholder: `$3,000-$8,000+/month`.
- Final number requires vendor quotes.

## Postgres Environment Confirmation

Platform owns Postgres environment readiness.

Required confirmation before staging or production promotion:

- `DATABASE_URL` points to the target managed Postgres environment, not local Docker or smoke fixtures.
- `WHISTLE_DEPLOYMENT_PROFILE` is `staging` or `production` as appropriate.
- Migrations have run on the target environment.
- The Postgres-backed MVP check has been run and stored as controlled launch evidence.
- The restore drill evidence reference is attached to the Platform/Postgres lane.
- Raw `DATABASE_URL`, credentials, SQL dumps, and provider console URLs are never pasted into Admin or committed to source.

## Required Environment Gates

These deployment keys must be present and production-appropriate in rendered staging/production environments:

- `WHISTLE_DEPLOYMENT_PROFILE`
- `DATABASE_URL`
- `WHISTLE_ALLOWED_ORIGINS`
- `WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED`
- `WHISTLE_DEPLOYMENT_RUNBOOK_VERSION`
- `WHISTLE_BACKUP_RESTORE_DRILL_APPROVED`
- `WHISTLE_BACKUP_RESTORE_DRILL_AT`

Provider, security, and telemetry env keys are covered by the production runbook and readiness packet. They include official OIDC/MFA, worker auth, citizen OTP provider, evidence object storage, KMS/scanner declaration, notification provider, distributed rate limits, SIEM/WORM export, and OpenTelemetry export.

## Backup / Restore Drill Rule

The restore drill is a launch gate, not a post-launch cleanup item.

| Item | Decision |
| --- | --- |
| Owner | Platform/Postgres. |
| Drill timing | T-3 before launch. |
| Evidence format | Controlled artifact reference, for example `artifact://whistle/mvp1/restore-drill/<run-id>`. |
| Runtime env key | `WHISTLE_BACKUP_RESTORE_DRILL_AT` stores the latest ISO drill timestamp. |
| Freshness rule | Default maximum age is 30 days unless explicitly approved. |

The drill must prove that tickets, queues, status history, SLA clocks, notifications, evidence metadata, config, access, idempotency, agent runs, dashboard briefs, and audit ledger rows restore together.

## Launch Hold Rules

Launch must pause if any of the following are true:

- Any deployment preflight blocker remains.
- Rendered env contains template, local, smoke, example, placeholder, or `localhost` values.
- `DATABASE_URL` is missing, non-production, or not confirmed by Platform.
- Postgres migration evidence or Postgres MVP check evidence is missing.
- Restore drill evidence is missing, invalid, stale, or not approved.
- Protected identity or evidence visibility leaks to an unauthorized role.
- SLA worker, audit ledger, routing, or escalation behavior is broken.
- OIDC/MFA provider is not production-ready for government consoles.
- Citizen OTP provider is not production-ready or mock OTP exposure remains enabled.
- Evidence object storage, KMS, malware scanning, or data residency controls are not production-ready.
- SIEM/WORM audit export is missing or not externally retained.
- OpenTelemetry/metrics export is missing for launch watch.
- Notification provider is missing or template approval is incomplete.
- Public rate limiting is local/in-memory instead of shared and production-backed.
- Any official marks, emblems, public-figure likenesses, or protected assets are unapproved for public production use.
- Any Blocker defect remains open in MVP1 UAT.

Releasing a launch hold requires both Operations and CM Cell approval. Security, Platform/Postgres, Identity, Evidence, Observability, and UAT owners must still clear their own evidence lanes; Ops plus CM Cell approval does not override a failed preflight.

## Cost Caveats

- SMS, WhatsApp, OTP, and citizen notification costs are usage-based and can dominate the monthly bill during public campaigns.
- Evidence storage grows with citizen uploads, retention duration, scan artifacts, and backup/DR copies.
- HA/DR increases costs through extra instances, database headroom, backup retention, observability, private networking, and support.
- Enterprise pricing is custom and may require annual commitments.
- Vercel Pro is sufficient for initial paid production only if contractual SLA, SCIM/SSO, compliance paperwork, and formal support are not required.
- Render pricing is used here to keep the estimate on one coherent stack for API, workers, Postgres, cron, and key-value cache. Neon remains a valid Postgres alternative if chosen explicitly later.
- Production cost should be recalculated after real traffic, complaint volume, evidence size, notification volume, and retention policy are known.

## Acceptance Checklist

- Paid production baseline is documented.
- HA/DR-ready budget is documented.
- Enterprise/custom budget caveat is documented.
- Staging and production origins are documented.
- Platform/Postgres ownership is documented.
- T-3 restore drill rule is documented.
- Launch hold rules are documented.
- Free/trial tiers are explicitly evaluation-only.
- Pricing source links are included.
