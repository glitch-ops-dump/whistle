# Whistle UX Review - 2026-06-04

## Audit Scope

Reviewed the Whistle local prototype in `/Users/pz/Documents/Codex/Whistle` using:

- Static/demo Vite server at `http://localhost:5173/`.
- Live local-UAT app at `http://localhost:5185/`.
- Live local-UAT API at `http://localhost:3001/`.

Captured evidence from:

- Live launcher, auth-gated routes, and authenticated local-UAT role consoles.
- Standalone exported prototype pages under `exports/standalone/`, such as `whistle-workable.html`, `whistle-dashboard.html`, and role-console exports.
- Mobile captures at 390 x 844 for launcher, citizen app, public transparency, and the complaint-start flow.

Environment note: the first pass hit "Auth service is unavailable" because Postgres was not running. After Docker/Postgres came up, migrations, local-UAT preflight, seed, and role assertions passed. The first-run failure remains product evidence because a reviewer can hit it before knowing which setup step is missing.

Live UAT evidence:

- `npm run db:up` started `whistle-postgres`.
- `DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run db:migrate` completed successfully.
- `npm run mvp1:uat-preflight -- --json` reported 10 passes, 1 warning, and 6 launch blockers.
- `npm run mvp1:uat-seed -- --json --quiet --run-id codex-ux-20260604-rerun --out artifacts/whistle-mvp1-local-uat-seed-codex-ux-20260604-rerun.json` validated 9 tickets for 8 role accounts.
- `npm run mvp1:uat-run -- --run-id codex-ux-20260604-rerun --seed-file artifacts/whistle-mvp1-local-uat-seed-codex-ux-20260604-rerun.json --out artifacts/whistle-mvp1-local-uat-run-codex-ux-20260604-rerun.md` passed role-scoped assertions for CM Cell, ministry, MLA, councillor, verification, and protected-read guardrails.

## Step Health

1. Launcher - mostly healthy. Clear product split between citizen and government, but the role map is too shallow and secondary surfaces are easy to miss.
2. Auth-gated verification route - healthy after Docker/Postgres and seed. Before that, the screen reports "Auth service is unavailable" but does not tell a reviewer how to recover.
3. Citizen home - strong mobile-first direction. Clear CTA, bottom navigation, privacy promise, bilingual toggle, and category shortcuts.
4. Citizen category selection - healthy. Category grouping and protected-intake explanation are clear.
5. Citizen department selection - healthy. Low-choice department list reduces cognitive load.
6. Citizen complaint details - mostly healthy. Form structure is good, but the disabled continue state and bottom nav compete for space.
7. Verification console - functional with live UAT data, but the first screen is noisy. Older local seed runs fill the queue with 50 items, 49 protected items, and many breached records, so the current review scenario is hard to find.
8. Government dashboard - powerful but dense. Role scope, metrics, and ticket detail are visible, but the default view mixes huge prototype totals with live UAT posture.
9. Admin console - useful for internal readiness. It clearly separates controls from ticket work, but the first screen is more roadmap-heavy than action-oriented.
10. Local owner workbench - role clarity is good and live data loads. However, "213 open", "0 primary local", and "212 SLA breached" create a confusing next-action story.
11. CM Cell console - strong. The executive readout and "Next decision" framing explain the state-command use case well.
12. Ministry console - functional with live scoped data. It needs better run isolation and priority grouping because repeated local seeds make the queue feel like a backlog dump.
13. MLA export - healthy. It has fallback data, a clear local accountability frame, and readable metrics.
14. Public transparency - healthy with live aggregate data. The aggregate-only privacy story lands well, though "protected statewide count" could be explained more plainly.
15. Workflow infographic - strong narrative. It explains the accountability operating model better than the launcher does.

## Strengths

- The product has a coherent civic accountability model: citizen intake, verification, role-owned queues, escalation, protected reporting, public aggregate transparency, and closure proof.
- The citizen app is the strongest UX surface. It feels mobile-first, action-oriented, and trust-aware.
- Role consoles use consistent patterns: left navigation, KPI strips, role identity, search, queues, detail panels, and policy notes.
- Protected-report handling is repeatedly visible, which is important for trust and compliance.
- The public transparency surface does a good job separating accountability from exposure of citizen data.

## Highest Priority UX Risks

### 1. First-run review is too easy to block

The launcher points to current auth-gated pages, but if the local API or Postgres is not ready, a reviewer quickly hits "Auth service is unavailable." The screen does not explain that Docker/Postgres is required, which command to run, or whether a static demo path exists. Once Docker is running, the local-UAT path is strong, but the recovery path is discoverable only from docs/commands.

Recommendation: add a first-run mode selector on the launcher:

- Try demo with saved prototype data.
- Run live local UAT.
- View setup status.

The live path should show specific recovery guidance when Postgres or API health fails.

### 2. Live UAT data needs run isolation

After seeding, the role consoles work, but older local test records remain in the same queues. Verification opens to 50 awaiting-review items and 49 protected items; ministry and local consoles also show hundreds of historical items. This makes the product look operationally overwhelmed even when the current seed only created 9 review tickets.

Recommendation: add a UAT run filter or "current seed pack" view:

- Show the active run ID and generated time.
- Offer "Show current UAT tickets" and "Show all local data".
- Add a reset/clear-local-data affordance in Admin or setup docs for reviewers.
- Flag stale local fixture records separately from active operator work.

### 3. Fallback and error states are inconsistent

Some standalone pages have useful fallback data, while verification, local owner, and ministry collapse into zero metrics plus API errors. This makes "no work exists" and "data failed to load" visually indistinguishable.

Recommendation: standardize fallback behavior:

- If data is unavailable, keep metrics as "Unavailable", not zero.
- Offer "Load sample UAT data" for prototype review.
- Put the technical error behind a details affordance.

### 4. Launcher information architecture undersells the product

The launcher presents only two primary cards, with other role surfaces as small pills. On mobile, the citizen CTA can be pushed below the viewport. The workflow/export pages actually explain the product better than the starting page.

Recommendation: restructure the launcher around user intent:

- Citizen: raise or track a complaint.
- Verification: review intake.
- Field/local: close local issues.
- Ministry/CM Cell: manage escalation.
- Admin: configure launch controls.
- Public: view aggregate transparency.

### 5. Citizen app status banners crowd the core action

The citizen home currently shows asset disclaimer, ticket-spine unavailable, launch-controls unavailable, and trust badges before the category grid. These are useful in UAT but visually compete with "Raise Complaint".

Recommendation: compress UAT/system status into one compact environment banner and keep the complaint task visually dominant.

### 6. Government consoles need a stronger "what do I do now?" layer

The dashboard, ministry, local, and verification pages are information-rich, but the operator's next action is not always obvious. CM Cell does this best with a clear executive readout and next-decision prompt. Some disabled actions still look like primary controls.

Recommendation: add a top "Next actions" module per role:

- Verification: review oldest protected/standard intake.
- Local owner: visit/update tickets due today.
- Ministry: clear breached district bottleneck.
- CM Cell: decide highest-risk escalation.
- Admin: close launch blockers.

## Accessibility Risks

- Tab-like controls should expose selected state with `aria-selected` where applicable.
- Several search affordances appear visually as inputs but may not expose a strong label in all surfaces.
- Red/green/yellow status differences need non-color labels everywhere; most do, but this should be checked systematically.
- The citizen details screen has bottom-nav overlap risk: the validation warning and continue action can sit too low in the viewport.
- Progress dots in the citizen form are visual but unlabeled; add current step text for screen readers.
- A keyboard-only pass is still needed for dashboard sidebars, tab controls, disabled actions, and modal/settings flows.

## Recommended Next Slice

Build one "review-ready happy path" before broad redesign:

1. Update launcher to offer Demo mode and Live local UAT mode.
2. Route Demo mode to standalone/fallback surfaces with sample data.
3. Add current-run filtering for live UAT so seeded tickets are reviewable without historical local fixtures.
4. Make local/ministry/verification offline states show "Data unavailable" plus a sample-data option, not zeroed dashboards.
5. Tighten citizen mobile form bottom spacing with a sticky continue area above the bottom nav.
6. Add a per-role "Next action" block to the top of each government console, following the CM Cell pattern.

## Evidence

Screenshots are saved in `audit/ux-review-2026-06-04/screenshots/`.

Key files:

- `01-launcher.png`
- `12-verification-after-login.png`
- `14-citizen-export.png`
- `15-verification-export.png`
- `16-dashboard-export.png`
- `17-admin-export.png`
- `18-local-export.png`
- `19-cm-cell-export.png`
- `20-ministry-export.png`
- `21-mla-export.png`
- `22-public-transparency-export.png`
- `23-workflow-export.png`
- `24-launcher-mobile.png`
- `25-citizen-mobile-export.png`
- `26-public-mobile-export.png`
- `27-citizen-flow-category.png`
- `28-citizen-flow-department.png`
- `29-citizen-flow-details.png`
- `30-live-verification-authed.png`
- `31-live-dashboard-cm-cell.png`
- `32-live-ministry-authed.png`
- `33-live-local-owner-authed.png`
- `34-live-cm-cell-authed.png`
- `35-live-admin-authed.png`
- `36-live-citizen-app.png`
- `37-live-transparency.png`

Generated local-UAT artifacts:

- `artifacts/whistle-mvp1-local-uat-seed-codex-ux-20260604-rerun.json`
- `artifacts/whistle-mvp1-local-uat-run-codex-ux-20260604-rerun.md`
