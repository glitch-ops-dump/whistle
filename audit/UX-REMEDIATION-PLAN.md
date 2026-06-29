# Whistle UX Remediation — Phased Delivery Plan

**Date:** 2026-06-11 · **Owner:** PO (Prz) · **Inputs:** [`audit/UX-ASSESSMENT.md`](./UX-ASSESSMENT.md) + tech-lead impact assessment (verified against working tree)
**Anchor:** MVP1 UAT / launch readiness · **Capacity:** solo + Claude sessions — every phase is sized as small, independently shippable batches with a hard verification gate.

---

## Corrections from tech-lead review (assessment deltas)

The impact review changed three things the UX audit got wrong or under-specified — they shaped this plan:

1. **Admin console is already hash-routed** into 4 workspaces (`AdminConsole.tsx:170-186`). The "split into routed views" item shrinks from a rebuild to: promote existing sub-route aliases, separate readiness-reporting from controls, and extract the 4,819-line component into per-section modules. Effort L→smaller L, risk down.
2. **Dashboard mobile is not a header-wrap fix.** Root cause is forced `body { min-width: 900px/760px }` (`gov-dashboard.css:1574-1614`). And the truncated account bar is the **shared** `.auth-user-bar` (`auth.css`) — fixing it lands on all 8 consoles and needs cross-console QA.
3. **Copy changes are coupled to the export smoke tests.** `smoke-standalone-exports.ts` asserts literal strings ("Whistle is running in local UAT mode", "Raise Complaint", …) in committed standalone HTML. Any copy batch must update smokes + regenerate exports in the same commit, or `mvp:check` rots.

Standing rule for all phases: `npm run build` gates frontend-only batches; anything touching `server/` adds `npm run api:check` + relevant `smoke:*`; before any demo, full `npm run mvp:check`.

---

## Phase 0 — Stop the bleeding (before anyone else touches the product)

**Goal:** an evaluator following the launcher story completes first login on every console without hitting a dead end. This is the audit's "broken first-run" cluster — highest value per hour in the whole plan.

| # | Item | Effort | Risk | Files |
|---|------|--------|------|-------|
| 0.1 | Per-console login prefill via client-side `role → seeded phone` map (fallback when `config.demo.governmentAccounts` is empty). Cross-reference comment to `server/account/repository.ts` to mitigate drift. | S | Low | `AuthGate.tsx` |
| 0.2 | Role-mismatch error names required role + links to the correct console (`role → console URL` map; trigger on `role_not_allowed`). | S | Low | `AuthGate.tsx`, `authApi.ts` |
| 0.3 | Transparency tabs: real `role="tab"` / `aria-selected` / `tabpanel` semantics (fixes the one **critical** axe violation). | S | Low | `PublicTransparency.tsx` |
| 0.4 | Retire `console.html` (verified byte-identical duplicate of `verification.html`). Delete entry + vite input; keep `main.tsx` path match for old bookmarks. | S | Zero | `vite.config.ts`, `main.tsx` |

**Decision needed (D1):** also expose seeded demo accounts via `/api/auth/config`? Tech lead recommends **no** — the double gate exists so seeded passwords are never published on an unauthenticated endpoint in real password-auth deployments. Plan assumes the client-side map only. *(PO position: agree — security posture beats convenience; the map gives the same UX.)*

**Gate:** `npm run build`; manual login walk on all 7 consoles + citizen; `export:transparency` regen.
**Exit:** launcher story is completable end-to-end by a stranger. ~1 session.

---

## Phase 1 — UAT-credible consoles (accessibility + evaluator trust)

**Goal:** UAT testers and any official shown a screen see no obviously broken styling, and keyboard/AT users aren't locked out. Clears ~64 of 67 axe violations.

| # | Item | Effort | Risk | Notes |
|---|------|--------|------|-------|
| 1.1 | Contrast tokens: darken `--admin-muted` (57 nodes), `--role-muted` + per-console overrides, `--cm-muted`, `--mla-muted`, citizen grays. **Gotcha:** `--role-muted` doubles as `.role-sla-dot` background on 4 consoles — split into `--role-muted-text` first. | S–M | Low–Med | Own commit; visual sweep after |
| 1.2 | Global `:focus-visible` ring via new `focus.css` imported by every entry (no shared stylesheet exists today). | S–M | Low | Own commit |
| 1.3 | MLA scroll panel: `tabIndex={0}` + `role="region"` + label (ring comes from 1.2 — sequence after). | S | Low | `MlaDashboard.tsx` |
| 1.4 | Dashboard mobile: remove forced `min-width`s (move onto inner tables/heatmap), wrap header grid, fix shared `.auth-user-bar` truncation. QA at least one other console (shared file). | S–M | Med | Defer cosmetic polish if D2 (Phase 3) may demote dashboard.html |
| 1.5 | Launcher credentials card: fetch `/api/auth/config`, hide gracefully when empty (no hardcoded passwords in always-built HTML). | S | Low | Separate commit from 1.4 |

**Gate:** `npm run build`; manual axe re-run on all desktop surfaces (target: 0 critical / 0 serious); mobile screenshot of dashboard + one other console.
**Exit:** axe-clean consoles, keyboard navigable, dashboard usable at 390px. ~1–2 sessions.

---

## Phase 2 — Citizen experience (the surface that decides adoption)

**Goal:** the citizen app looks like a product, not a prototype, for the personas who will actually carry MVP1: Tamil-first, mid-range Android, first-time complainants.

| # | Item | Effort | Risk | Notes |
|---|------|--------|------|-------|
| 2.1 | Copy pass: kill "spine"/"PILOT"/"Admin configuration" leakage. **Scope widened by TL review:** several spine strings are hardcoded outside the en/ta tables (`App.tsx:957…2884`) — pull them into the table or they survive the pass. AuthGate subtitle strings are shared → rewrites every console login subtitle (desirable; widens review). | M | Low (en) / Med (ta) | **Decision D3 below** |
| 2.2 | Tamil translations for all changed strings. No machine-stub placeholders committed. | M | Med | Translation step, possibly external |
| 2.3 | StatusBar: gate on existing `window.__WHISTLE_API_DISABLED__` export flag (keep for mockup exports, remove for live app). | S | Low | Bundles with 2.4 |
| 2.4 | Full-bleed citizen layout ≤768px. **Two** phone-shell rule sets must change in lockstep (`styles.css:61-72, 2293-2337`). 431–768px has never rendered — needs a visual QA pass. | M | Med | |
| 2.5 | `document.documentElement.lang` switch on toggle + subset Noto Sans Tamil woff2 (`@font-face`). Add font to `export-citizen.mjs` inline-asset map (base64) or document system-fallback for standalone exports. | M | Low | |

**Decision needed (D3):** citizen-visible copy renames will break export smoke assertions — approve updating `smoke-standalone-exports.ts` strings in the same commits. *(PO position: yes, same-commit rule, per "3-layer" discipline.)*

**Gate:** `npm run build && npm run export:citizen && npm run smoke:exports`; re-walk register→raise→track→insights on 390px and 768px; Tamil-mode visual check on a device/browser **with and without** a system Tamil font.
**Exit:** no internal jargon citizen-side, no fake chrome, Tamil renders everywhere. ~2 sessions + translation turnaround.

---

## Phase 3 — Launch hardening + the IA decision

**Goal:** lock launch surfaces, regenerate all snapshots, and make the one structural decision that everything later depends on.

**Decision needed (D2) — console IA consolidation.** Dashboard.html's role switcher duplicates CM Cell and Ministry console content; launcher already calls dashboard "Legacy". Options:
- **(a) Demote:** mark dashboard.html as legacy/internal, point all launch comms at the per-role consoles. Effort S. *(PO recommendation for MVP1 — zero regression risk, resolves evaluator confusion, defers the big merge.)*
- **(b) Merge:** consolidate into per-role consoles properly. Effort L, risk med-high, touches 2,815-line `GovDashboard.tsx`, exports, smokes, launcher. Post-MVP1 only.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 3.1 | Execute D2(a) (launcher labels, story order, comms) — or schedule D2(b) post-launch | S | |
| 3.2 | Empty-state/scope-label pattern: shared `<ScopedEmptyState>` + scope chips in `roleConsolePattern.tsx` (lands on 4 consoles); fix Local KPI statewide-vs-Ward-48 mismatch; Transparency "below publishable threshold" explainer state | M | After D2 — don't pattern-ify widgets slated for retirement |
| 3.3 | Ministry/Local widget scope labels (same pattern instances) | S | Rides 3.2 |
| 3.4 | Regenerate **all** exports + full `npm run mvp:check` + fresh axe sweep; archive results next to this plan | S | The only gate exercising server smokes + build + exports together |

**Exit:** launch surface set is final, snapshots current, `mvp:check` green. ~1–2 sessions.

---

## Phase 4 — Post-MVP1 structural (explicitly deferred, decision-gated)

| # | Item | Effort | Gate to start |
|---|------|--------|---------------|
| 4.1 | Admin: promote sub-route aliases to first-class routes; split readiness-report from controls; extract per-section modules from the 4,819-line component. (Do **after** 1.1 so axe re-verification is pre-split.) | L | Post-launch calm; no admin feature work in flight |
| 4.2 | Citizen merged ticket list. TL found the lever: login session already carries `phoneVerificationToken` when OTP-at-login is mandated — reuse it for the spine fetch and the duplicate OTP disappears *in that mode*; when OTP isn't mandated the second verification is structurally required by the API. Scope the promise as "no duplicate OTP when OTP is on" unless we change the server contract. Regression surface: protected tickets + offline merge. | M–L | After Phase 2 copy work settles (same strings/screens — don't interleave) |
| 4.3 | D2(b) full console consolidation, if chosen | L | Product decision + post-launch |

---

## Sequencing & dependency map

```
Phase 0 (0.1→0.2 same file; 0.3, 0.4 parallel)
  └─ Phase 1 (1.1 → 1.2 → 1.3; 1.4, 1.5 parallel)
       └─ Phase 2 (2.1+2.2 → 2.3+2.4 → 2.5)
            └─ Phase 3 (D2 → 3.1 → 3.2/3.3 → 3.4 full regen)   ← MVP1 launch line
                 └─ Phase 4 (4.1; 4.2; 4.3 decision-gated)
```

**Open decisions for PO sign-off:** D1 (demo accounts in config — recommend no), D2 (dashboard demote vs merge — recommend demote for MVP1), D3 (smoke-string updates ride copy commits — recommend yes).

**Total to launch line:** ~5–7 solo+Claude sessions plus Tamil translation turnaround. Phases 0–1 alone clear every High finding and all axe critical/serious issues — if the timeline compresses, ship Phase 0+1 and gate launch comms on Phase 2.
