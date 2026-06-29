# Whistle MVP1 Local UAT Guide

Status: local operator-testing guide  
Scope: MVP1 only

This guide sets up local UAT data for role-by-role testing without treating local smoke providers as production readiness.

## What It Covers

- Admin Console controls and launch handoff review.
- Verification intake with route, request-info, reject, and protected-screening paths.
- CM Cell escalation queue and protected/rejection-review oversight.
- MAWS ministry queue for one seeded ministry.
- Velachery MLA local queue.
- Ward 48 councillor/local-owner queue.
- Resolved ticket detail and closure checklist history.

## Setup

```bash
npm run db:up
DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run db:migrate
npm run mvp1:uat-preflight
npm run mvp1:uat-seed -- --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.md
npm run mvp1:uat-seed -- --json --quiet --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.json
npm run mvp1:uat-run -- --run-id <run-id> --seed-file artifacts/whistle-mvp1-local-uat-seed.json --out artifacts/whistle-mvp1-local-uat-run.md
npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md
npm run mvp1:uat-signoff -- --run-id <run-id> --out artifacts/whistle-mvp1-uat-signoff.md
npm run api:dev:mvp1-uat
npm run dev -- --host 127.0.0.1
```

Open the generated seed artifact and paste the emitted `localStorage.setItem(...)` block into the browser console. Then open the role surfaces listed in the artifact.

For automated seed verification without printing browser bearer tokens to stdout, add `--quiet` while still writing the artifact: `npm run mvp1:uat-seed -- --quiet --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.md`.

For a repeatable role-action rehearsal, create the JSON seed with the same `<run-id>`, then run `npm run mvp1:uat-run -- --run-id <run-id> --seed-file artifacts/whistle-mvp1-local-uat-seed.json --out artifacts/whistle-mvp1-local-uat-run.md`. It verifies scoped dashboards, performs field reports as department/MLA/councillor users, exercises CM Cell rejection review, and writes a token-free evidence artifact.

Use a fresh `<run-id>` each time you want to rerun `mvp1:uat-run`. The role runner performs real local-UAT actions, so a reused seed is rejected before any new actions run.

Generate the defect register template with `npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md`. Replace or remove every template row before attaching it as `artifact://whistle/mvp1/defect-register/<run-id>` in Admin.

Generate the operator sign-off checklist with `npm run mvp1:uat-signoff -- --run-id <run-id> --out artifacts/whistle-mvp1-uat-signoff.md`. Use it to record scenario pass/fail/not-run status, evidence references, sign-off owners, and the exact Admin controls to update after UAT.

The Admin Console includes the role-testing launcher inside the `Launch Controls` tab at `/admin.html#launch`. Use it after the seed step: it lists the command order, the seeded role surfaces, the fixture scenarios, and the matching UAT sign-off controls.

## Seeded Scenarios

| Scenario | Purpose |
| --- | --- |
| `cm-escalated` | Ticket escalated from local to ministry to CM Cell, with secondary visibility retained. |
| `ministry-queue` | MAWS ministry-owned ticket after local SLA escalation. |
| `mla-local` | Velachery local issue that should be closed before escalation. |
| `councillor-ward-48` | Ward-level local issue for the councillor/local-owner view. |
| `resolved` | Closure checklist and resolved-ticket status review. |
| `awaiting-citizen` | Verification requested additional citizen information; SLA is paused. |
| `protected-corruption` | Protected corruption screening, hidden from local/MLA/ministry roles. |
| `rejection-review` | Verification rejection moved to CM-maintained review. |
| `verification-new` | Fresh intake ticket for manual verification decisions. |

## Notes

- Local UAT uses mobile/password account sessions, local official tokens where needed, and local Postgres only.
- Citizen mock OTP values remain hidden in local UAT by design.
- Provider choices, evidence object storage, SMS/WhatsApp delivery, SIEM/WORM export, and restore drill proof remain production launch gates.
