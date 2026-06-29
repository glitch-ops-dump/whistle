# Whistle Product Design And UX Review

Date: June 4, 2026

## Audit Scope

This review covers the current Whistle multi-page prototype as a product experience, not only as individual screens. The audit used the Product Design audit workflow, local screenshots, and rendered route checks across:

- Citizen mobile PWA.
- Verification Console.
- Local Owner Workbench.
- MLA Dashboard.
- Ministry Operations Console.
- CM Cell Command Center.
- Government Operations Dashboard.
- Admin Console.
- Public Transparency.
- Workflow Infographic.

Evidence was captured in `output/playwright/ux-review/`. The app built successfully with `npm run build`. The local UAT API was also tested, but the UAT seed path was blocked because Postgres on port `54329` was not running. For visual review, the memory-backed dev API was used to render authenticated surfaces.

## Executive Verdict

Whistle is directionally strong. The prototype now feels much closer to a citizen accountability operating system than a complaint app. The strongest surfaces are the Workflow Infographic, Verification Console, Ministry Console, and Citizen ticket-detail experience. These explain the core idea: a citizen raises an issue, the system gives it an owner, the SLA clock is visible, and escalation preserves accountability.

The product is not yet ready for a senior government or funder demo without a focused UX polish pass. The main risk is not lack of features. The risk is presentation clarity: the global auth bar overlaps important content, the Admin Console is too dense, some screens use conflicting demo data, and the route map still mixes role-specific V1 surfaces with older or V2-oriented surfaces.

Recommended design direction: do not redesign from scratch. Keep the current visual identity, but tighten the shell, route hierarchy, mobile header, console pattern, data realism, and Admin information architecture.

## Evidence Set

Screenshots accepted for this review:

- `output/playwright/ux-review/01-citizen-mobile-home.png`
- `output/playwright/ux-review/02-citizen-mobile-category.png`
- `output/playwright/ux-review/03-citizen-mobile-tickets.png`
- `output/playwright/ux-review/04-citizen-mobile-ticket-detail.png`
- `output/playwright/ux-review/05-verification-desktop.png`
- `output/playwright/ux-review/06-local-owner-desktop.png`
- `output/playwright/ux-review/07-mla-desktop.png`
- `output/playwright/ux-review/08-ministry-desktop.png`
- `output/playwright/ux-review/09-cm-cell-desktop.png`
- `output/playwright/ux-review/10-government-dashboard-desktop.png`
- `output/playwright/ux-review/11-admin-desktop.png`
- `output/playwright/ux-review/12-transparency-desktop.png`
- `output/playwright/ux-review/13-workflow-desktop.png`

## Council Read

Product management: the V1 story is now visible, but the demo should use a smaller route set. Lead with Citizen, Verification, MLA, Ministry, CM Cell, and Admin. Keep Transparency explicitly V2. Use the Workflow Infographic as the explainer before opening the consoles.

UX design: the role-specific dashboards are much clearer than the older generic dashboard. The next pass should standardize the console pattern: mandate, KPIs, next action, ticket list, selected ticket, decision controls.

Service design: the most credible pattern is the handoff model. Every screen should answer who owns the ticket now, who still has secondary visibility, what the SLA says, and what the citizen sees.

Trust and security: protected reports are handled thoughtfully, but they need a distinct visual and operational lane. They should never feel like just another category card or dashboard count. Official portraits, marks, and emblems should stay behind an approved-asset flag for public demos.

Accessibility and performance: the app is visually rich, but the Admin Console and some desktop consoles have very small dense text. Keyboard focus, zoom reflow, screen-reader structure, and reduced-motion behavior still need formal testing.

## Surface Scores

| Surface | Score | Review |
| --- | ---: | --- |
| Citizen mobile PWA | 7.2 / 10 | Strong phone-first base, clear ticket tracking, useful bottom nav. Needs a less crowded auth/header area and clearer first-screen task priority. |
| Citizen ticket detail | 8.0 / 10 | The "Waiting with you", SLA pause, citizen action, and Add More Info pattern is one of the strongest product moments. |
| Verification Console | 8.1 / 10 | Feels like a real intake bench. Human-approved decision controls and recommend-only intelligence are well framed. |
| Local Owner Workbench | 6.8 / 10 | Clear mandate, but the captured state is mostly empty. Needs a demo-ready populated queue or a better empty-state action. |
| MLA Dashboard | 7.4 / 10 | Good role focus around preventing escalation. Needs more visible ticket/action detail in the first viewport. |
| Ministry Console | 8.0 / 10 | Clear portfolio scope, district bottlenecks, and high-risk ticket queue. Header overlap and role switch placement need cleanup. |
| CM Cell Command Center | 7.6 / 10 | Strong command-center framing, but demo data conflicts weaken credibility. |
| Government Operations Dashboard | 6.7 / 10 | Powerful but now feels like a legacy mega-dashboard. Keep it only if it has a clear demo role. |
| Admin Console | 6.4 / 10 | Functionally ambitious and strategically useful, but too dense for daily operations. Needs progressive disclosure. |
| Public Transparency | 7.6 / 10 | Privacy-first and appropriately V2. Needs clearer explanation when all public counts are zero due to thresholds. |
| Workflow Infographic | 9.0 / 10 | Best strategic communication artifact. Should become the opening visual in demos and decks. |

## Highest Priority Findings

### P0: Fix The Global Auth Header

The signed-in user bar overlays page content on multiple routes. On mobile, it consumes the top of the citizen viewport and crowds the hero. On desktop, it competes with ministry role controls and top-right dashboard actions.

Recommendation: make the auth/session shell part of the layout, not an overlay. On mobile, collapse Settings and Sign out into a compact account menu. On desktop, reserve a consistent top utility row above each product surface.

### P0: Stabilize The Demo Route Map

The prototype has both role-specific consoles and broader legacy/demo routes. This creates a product-story risk: stakeholders may not know which screen represents V1.

Recommended V1 demo route order:

1. `workflow.html` as the story.
2. `citizen.html` for raising and tracking.
3. `verification.html` for intake.
4. `mla.html`, `ministry.html`, and `cm-cell.html` for escalation layers.
5. `admin.html` for launch controls.

Keep `transparency.html` clearly labeled as V2. Treat `dashboard.html` as optional or legacy unless it is deliberately positioned as the state-wide analytics cockpit.

### P1: Make Citizen Mobile More Task-First

The citizen app has the right pieces, but the first viewport is crowded. The user sees account controls, hero content, disclaimer, system status, four trust chips, categories, and bottom nav at once.

Recommendations:

- Make "Raise complaint" and "Track ticket" the two dominant entry actions.
- Move the legal/UAT disclaimer into a compact trust/status strip.
- Keep corruption visible only if Admin marks it protected-pilot ready; otherwise move it behind an explanation screen.
- Fix the category page top clipping under the account bar.
- Ensure long Tamil labels and ticket filter chips never clip on 390px mobile width.

### P1: Turn Admin Into An Operator Console, Not A Whitepaper Wall

The Admin Console contains valuable launch-readiness thinking, but the captured page is 7,569px tall and visually dense. It mixes daily administration, readiness packet status, backlog maturity, and program roadmap content in one scrolling surface.

Recommendations:

- Split Admin into four primary tabs: Access, Launch Controls, SLA And Categories, Audit.
- Move roadmap/readiness narrative into a separate launch packet or collapsible readiness view.
- Put "what is blocking launch" at the top, with owner, due date, and next action.
- Keep secrets/provider references as controlled references, never raw values.

### P1: Harmonize Console Patterns

The role consoles are improving, but each one still has a slightly different structure. This makes Whistle feel like a set of separate prototypes instead of one operating system.

Recommended standard console pattern:

- Role mandate.
- 4-6 KPIs.
- "What must happen today."
- Scoped ticket list.
- Selected ticket workspace.
- SLA ladder.
- Citizen-visible update.
- Audit/protection note.

### P1: Clean Demo Data Conflicts

Some screens show inconsistent state. Example: the CM Cell screen says 0 SLA breaches while another card says "Red status" and references 188 overdue responses. Transparency shows a live MVP spine but 0 publishable complaints while internal dashboards show active and protected work.

Recommendations:

- Create one demo scenario pack shared across all role surfaces.
- Keep counts consistent across Citizen, Verification, MLA, Ministry, CM Cell, Admin, and Transparency.
- When public counts are zero because of threshold rules, say that plainly: "Internal tickets exist, but none meet public release thresholds yet."

### P2: Suppress Expected Dev 404s

The authenticated console pages repeatedly call `/api/local-uat/official-token`, which returns 404 in the memory-backed dev API. The UI still works through prototype role headers, but the console logs look broken.

Recommendation: check runtime config before calling the local-UAT token endpoint, or treat the fallback as a non-error development path.

## Surface Notes

### Citizen PWA

Strengths:

- The bottom navigation is familiar and mobile-native.
- The category cards are easy to scan.
- Ticket detail explains current owner, SLA pause, citizen action, and escalation path well.
- The Add More Info flow is a strong trust-building pattern.

Risks:

- The account bar is too dominant on mobile.
- The home screen gives many signals before the citizen has completed the core task.
- The protected corruption category is visually prominent and may overstate V1 readiness if SOPs are not approved.
- Horizontal ticket filters can clip on smaller screens.

### Verification Console

Strengths:

- The screen clearly says this is an intake decision bench.
- The split between queue and selected ticket is effective.
- "Recommend-only intelligence" is correctly framed as advisory.
- Decision buttons are human-owned and auditable.

Risks:

- The decision panel is long; consider a sticky footer for "Save decision."
- The left ticket list has large unused space in the captured state.
- Protected evidence handling is promising, but it should be visually more distinct from normal metadata.

### MLA, Local, Ministry, And CM Cell

Strengths:

- The role-specific surfaces are much better than a generic dashboard.
- MLA and Ministry screens have clear operating goals.
- Ministry has the strongest visible ticket queue.
- CM Cell has a credible state-command framing.

Risks:

- Local Owner captured as mostly empty, which weakens demo value.
- MLA first viewport does not show enough concrete tickets.
- Ministry and CM Cell top headers compete with the auth bar.
- CM Cell data needs one coherent state story.

### Admin Console

Strengths:

- It captures the right launch-readiness categories.
- It reflects the project roadmap and security gates.
- It makes clear that Whistle is configurable, not a hard-coded complaint app.

Risks:

- The surface is too long and too dense for operators.
- Some roadmap material belongs in docs, not daily admin.
- The tiny card text will be hard to use in a real control room or review meeting.

### Public Transparency

Strengths:

- It correctly avoids exposing citizens.
- The V2 label is appropriate.
- The privacy guardrail panel is clear and reassuring.

Risks:

- "Live MVP spine" plus all-zero public metrics can confuse stakeholders.
- The page should explain threshold suppression more directly.
- It should not appear in the default V1 launch demo except as "coming in V2."

### Workflow Infographic

Strengths:

- This is the clearest single artifact for the product vision.
- It shows multiple issue routes, not just one linear flow.
- It explains protected reports without making corruption the whole product.
- It makes V1 and V2 sequencing visible.

Risks:

- It is long as a webpage, but excellent as a scrollable explainer or deck source.
- It should be exported into presentation format for stakeholder meetings.

## Accessibility Risks

This was a screenshot-based audit, not a full WCAG certification.

Likely issues to test:

- Keyboard focus order through the auth bar, bottom nav, ticket list, and long Admin page.
- 200% zoom reflow on Admin, Verification, and the dashboard drawer.
- Screen-reader labels for icon-only controls and card-like buttons.
- Mobile reflow for Tamil strings, long category names, and ticket filters.
- Touch target spacing in dense desktop cards and Admin controls.
- Color contrast for yellow/cream panels with muted brown text.

Recommended target: WCAG 2.2 AA for public/citizen surfaces and at least AA-aligned internal government consoles.

## Recommended Design Sprint

### Sprint 1: Demo Readiness Polish

Duration: 3-5 days.

- Fix global auth/header overlap.
- Lock the V1 route map.
- Make Citizen first screen task-first.
- Clean demo data consistency.
- Add a "public threshold explanation" to Transparency.
- Suppress expected local-UAT token 404s in dev mode.

### Sprint 2: Console Systemization

Duration: 1 week.

- Standardize console layouts across Verification, MLA, Ministry, CM Cell, and Local Owner.
- Add sticky decision/action footers where needed.
- Make protected-report lanes visibly distinct.
- Create a common empty-state pattern for queues with no scoped tickets.

### Sprint 3: Admin IA And Accessibility

Duration: 1 week.

- Split Admin into operator tabs.
- Move roadmap text into launch packet views.
- Run keyboard, focus, zoom, and screen-reader checks.
- Add Tamil long-label QA across citizen mobile.

## Acceptance Criteria For Design Readiness

- No auth/session controls overlap primary page content at 390px mobile or 1440px desktop.
- Citizen can understand how to raise, track, respond, and reopen without reading explanatory copy.
- Each government role sees one clear next action within the first viewport.
- Protected complaints have a distinct visual and access model.
- Admin can answer: who has access, which categories are enabled, which SLAs apply, and what blocks launch.
- Transparency is explicitly V2 and aggregate-only.
- Demo counts are consistent across all surfaces.
- Screenshot review shows no clipped text, broken images, or unexplained all-zero states.

## Bottom Line

Whistle has the right product spine and the right strategic posture. The next design work should be disciplined polish, not reinvention. Fix the shell, simplify the demo route map, make mobile more task-first, tame Admin density, and keep protected workflows visually separate. Then the product will feel like a credible operating system for accountable governance rather than a collection of impressive screens.
