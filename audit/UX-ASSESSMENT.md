# Whistle UX Assessment — All UI Surfaces

**Date:** 2026-06-11
**Method:** Live render of every surface via Vite dev server + in-memory API with seeded demo accounts/tickets. Captured at 390×844 (mobile) and 1440×900 (desktop), unauthenticated and authenticated states, plus the citizen raise/track/insights flow. Automated WCAG 2.1 A/AA scan (axe-core 4.x) on every desktop view, plus manual contrast/keyboard/reflow review. Every finding below was verified against the rendered page and/or source before inclusion.

**Environment caveats:**
- Headless Linux had no Tamil fonts installed, so Tamil strings rendered as tofu boxes in captures. This is an environment artifact, **not** a product bug — but see C-7: the app bundles no Tamil webfont, so the same failure can occur on real devices.
- In-memory store, demo seed tickets (`WHISTLE_SEED_DEMO`), prototype auth. Empty/error states for a dead backend were observed incidentally (citizen page renders its login fine with API down; consoles silently retry).

**Scoring:** persona fit out of 10. "Quick win" = ≤1 day, no architecture change.

---

## Cross-cutting findings (affect 3+ surfaces)

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| C-1 | **High** | **Login prefill is wrong for 5 of 7 consoles.** `AuthGate.tsx:423` falls back to `+91 90000 21001` (the CM Cell account) on every console when the demo-accounts list is empty (the default — `/api/auth/config` returns `governmentAccounts: []` unless UAT token bootstrap env is set). On Verification, Local Owner, MLA, Ministry and Admin the prefilled credentials authenticate but then fail the role check. A first-time evaluator's very first action fails. | Verified live: dept-officer login on `local.html` → error. Code: `AuthGate.tsx:422-428`, `*-main.tsx` `allowedRoles` |
| C-2 | **High** | **Role-mismatch error is a dead end.** "This account cannot open the requested Whistle console" never says which role *is* required or where to go instead. Combined with C-1 this is the single worst first-run experience in the product. | `local.html` screenshot, AuthGate error path |
| C-3 | Medium | **Circular credential hint.** Every console login says "Use the seeded UAT mobile number and password from Admin" — but Admin itself is behind the same login. The actual seeded phones/password exist only in `server/account/repository.ts`. | All console login screens |
| C-4 | Medium | **Internal jargon leaks to end users.** Citizen surfaces say "Connected to Whistle ticket spine", "Sync from spine", "ticket-spine records"; login screens say "Admin can mandate it from App Controls". A first-time citizen has no model for "spine". | citizen home banner, My Complaints panel |
| C-5 | Medium | **Small-text contrast pattern fails AA across all role consoles.** axe flagged `<small>`/chip text on tinted card backgrounds on Verification (1), Local (1), Ministry (1), MLA (1), Citizen (2) and **Admin (57 nodes)**. Same design tokens (`role-console-pattern.css` muted grays on warm tints) — one token fix clears most of it. | axe `color-contrast`, serious |
| C-6 | Medium | **No visible keyboard focus indicator on most controls.** Inputs swap `outline: none` for a border-color change only (yellow-on-white, low contrast); no global `:focus-visible` style for buttons/cards/tabs. WCAG 2.4.7 fail for keyboard users. | `styles.css:800-833` |
| C-7 | Low | **No bundled Tamil webfont and `<html lang>` never updates.** Font stack is system-only; on devices without a Tamil face, the TA mode renders tofu. `lang` stays `"en"` even in Tamil mode (WCAG 3.1.1), which also degrades screen-reader pronunciation. | `styles.css:24`, `App.tsx` (no `documentElement.lang` write), `citizen.html:2` |
| C-8 | Low | **Real public-figure portraits** (hero portrait, "CM visibility" photo) appear on citizen + dashboard surfaces. NOTICE.md already flags the rights issue; from a UX-trust angle it also reads as political endorsement inside a neutral grievance tool. | citizen home, dashboard overview |
| C-9 | Info | **Console IA overlap.** `console.html` is a byte-level duplicate entry of `verification.html` (same title, same login). Gov Dashboard's role switcher overlaps CM Cell console and Ministry console content. Evaluators will ask "which one is the real one?" | titles in capture results; vite.config inputs |

---

## Per-screen assessment

### 1. Citizen PWA (`citizen.html`) — score 7.5/10
**Persona:** Meena, 38, shop owner in Madurai, mid-range Android, Tamil-first, files her first complaint about a broken water line. Stressed, skeptical that government will respond, afraid of retaliation for corruption reports.

**What works well (keep):**
- Hero does one job: "Raise a complaint. Hold them accountable" with two big CTAs (Raise / Track). Zero ambiguity about purpose.
- Trust strip (Identity protected · OTP verified · SLA tracked · Govt accountable) answers the persona's fear directly, above the fold.
- Category cards use plain-language descriptors ("No water, pipeline leaks, sewage overflow") — excellent for mixed literacy.
- Corruption card visually segregated with "Identity fully protected · Routes to vigilance · Local levels cannot see identity" — best-in-class anxiety reduction.
- Department picker offers "Not sure? We'll help route it correctly during verification" — removes the most common abandonment point in Indian grievance portals.
- Full Tamil string table exists for the whole journey; Indian digit grouping (1,28,485) used in Insights.

**Findings:**
| Sev | Finding |
|-----|---------|
| High | **Fake iOS status bar ("9:41") renders in the real app** (`App.tsx:1885` StatusBar). On a real Android phone the user sees two status bars, one fake. Mockup chrome shipped to production UI. |
| High | **Phone-frame shell at 431–1440px.** `.phone-shell` is fixed 390px with rounded bezel and drop shadow; only ≤430px goes full-bleed. Tablet and small-laptop citizens get an app-in-a-picture-frame with dead space. (WCAG 1.4.10 reflow risk too.) |
| Med | **"My Complaints" has two competing sources of truth.** Seeded "Saved app copy" tickets render alongside a "Load by phone → Send OTP → Sync from spine" panel. The persona cannot tell which list is real or why she must verify a phone she just logged in with. |
| Med | "PROTECTED PILOT" / "PILOT ONLY" badges — "pilot" is programme-management vocabulary; the Tamil-first persona reads it as a button. Use "சோதனை நிலை / Trial" or hide pre-launch states. |
| Low | Login subtitle "OTP appears only when Admin configuration requires it" — citizen does not need to know about Admin configuration (C-4). |
| Low | axe: `aria-prohibited-attr` on `div.govt-seal[aria-label]` (serious); two AA contrast fails on disabled "Public Safety" card text. |

**10% improvements:** remove StatusBar component behind an env flag; rename "Sync from spine" → "Get latest updates"; merge saved/live ticket lists with a single freshness chip; full-width layout up to 768px.

---

### 2. Verification Console (`verification.html`) — score 8/10
**Persona:** intake officer processing 100+ tickets/day. Needs queue-first layout, single-keystroke decisions, protected-intake guardrails she cannot get wrong.

**What works:** "Intake decision bench" framing is excellent; queue at left, full decision context (SLA ladder, evidence, citizen-identity guardrail, role-scoped controls) in one column; explicit "Approve / Request info / Protect / Reject" actions with a decision-note field; protected tickets clearly flagged with identity masking explained inline. The mandate banner ("Every complaint starts here…") gives new officers an instant mental model.

**Findings:**
| Sev | Finding |
|-----|---------|
| High | C-1/C-2: the login prefill (CM Cell account) fails on this console — the front door is broken for evaluators. |
| Med | Queue shows only 2 seeded items; there is no visible bulk/keyboard affordance (j/k, approve hotkey). At 100+/day the persona lives on the keyboard; nothing in the DOM suggests shortcuts exist. |
| Med | `protected-chip` fails AA contrast (axe, serious) — on the *one* element that must never be missed. |
| Low | Header status chip "submitted" (top right) has no label — submitted *what*? |
| Low | Mobile layout stacks to a single long column; usable, but the queue disappears below the KPI cards — queue should be first on mobile. |

**10% improvements:** fix prefill; add keyboard shortcuts + visible hint row; darken protected chip.

---

### 3. Local Owner Workbench (`local.html`) — score 7.5/10
**Persona:** ward councillor, field-heavy day, opens this between site visits on a phone. Needs "what must I do today" not analytics.

**What works:** This is the most persona-correct screen in the product. "Ward 48: close issues before escalation" + "Daily operation plan — what the ward team must do now" (visit 6 primary tickets, add support notes, attach field proof) is exactly a councillor's mental model. KPI row (open in ward, primary local, due in SLA, escalated out, average age) is scannable. "Protected complaints stay invisible to this console" notice is good role hygiene.

**Findings:**
| Sev | Finding |
|-----|---------|
| High | C-1: prefilled credentials are for CM Cell → login fails. Worse here: the natural assumption is that the *department officer* account opens "Local Owner", but only `councillor` is allowed (`local-main.tsx:12`). The error names neither fact. |
| Med | "Highest priority visible tickets" panel returned "No Ward 48 tickets are currently visible…" while KPIs showed 4 open — two widgets disagree at first glance (the KPI counts statewide seed data, the list filters Ward 48). Confusing empty state. |
| Low | `<small>` contrast fail (axe); two console errors logged during load (unhandled fetch rejections) — noise that hides real failures. |

**10% improvements:** role-aware login error; reconcile KPI scope with list scope (label "statewide" vs "Ward 48"); contrast token.

---

### 4. Government Dashboard (`dashboard.html`) — score 6.5/10
**Persona:** CM Cell analyst / senior official, 30-second glance between meetings, occasionally drills into a district.

**What works:** Ministry accountability ranking with SLA-breach deltas, district heatmap with drill-down, escalation queue with SLA ladder — the information architecture for oversight is all here. Role switcher (CM Cell / minister / councillor) is a clever single-surface design. "Prototype mode: ticket actions are intentionally view-only" tooltip sets expectations honestly.

**Findings:**
| Sev | Finding |
|-----|---------|
| High | **Mobile is broken:** account bar truncates to "nitha Raman", the "CM" pill is clipped at the right edge, KPI grid overflows. The persona *will* open this from a car. (WCAG 1.4.10.) |
| Med | **Massive single-scroll page** (~4,800px desktop): ranking, escalation column, heatmap, district table all compete. The 30-second persona needs the top 5 breaches and nothing else above the fold; today the first viewport spends ~35% of its height on header + role pickers + access-control chips. |
| Med | Duplicates CM Cell console content (C-9): two surfaces answer "what does the CM Cell see?", and they disagree on layout and numbers' framing. Pick one as canonical. |
| Low | Heatmap relies on red-shade alone for severity (color-only encoding, WCAG 1.4.1); add count labels (the district table partially compensates). |
| Low | Real-person portrait in "CM visibility" card (C-8). |

**10% improvements:** fix header flex-wrap on mobile; move ministry ranking + top escalations into the first viewport; label heatmap cells.

---

### 5. CM Cell Command Center (`cm-cell.html`) — score 7/10
**Persona:** CM Cell desk officer deciding which escalations get state-level intervention today.

**What works:** "CM Cell intervention view — distill pressure, ministry accountability, protected complaints, escalation decisions" is a crisp mandate. "What needs CM Cell attention?" with a low-escalation brief, WH-ID, owner and recommended action is decision-shaped, not report-shaped. KPI strip (SLA breaches, protected intake, due today, decisions pending) is right.

**Findings:**
| Sev | Finding |
|-----|---------|
| Med | Significant content overlap with dashboard.html CM Cell role (C-9) — same persona, two different tools, no cross-link. |
| Med | "Prototype mode: controls are clickable for navigation only" — fine for UAT, but the disabled actions look identical to enabled ones (no visual disabled state); officers will click and silently fail. |
| Low | Top tab labels ("State heatmap", "Ministry", "Tickets") duplicate left-rail items with slightly different names — pick one nav metaphor. |

**10% improvements:** cross-link or merge with dashboard; visible disabled styling on view-only controls.

---

### 6. Ministry Operations Console (`ministry.html`) — score 7/10
**Persona:** ministry control-room staffer (MAWS) clearing district bottlenecks before CM escalation.

**What works:** "MAWS: clear district bottlenecks before CM escalation" — the title *is* the job description. Mandate/metrics/action/ticket/SLA/update card pattern is consistent with other consoles (good cross-console learnability). Escalated-on-CM-Cell chip with days-pending creates the right urgency.

**Findings:**
| Sev | Finding |
|-----|---------|
| Med | KPI "0 due in 48h / 1 SLA breached / 2.8d average" sits beside a panel saying "no primary owner" tickets exist — like local.html, scope mismatch between widgets is not labeled. |
| Low | `<small>` contrast fail (axe); 2 console errors on load. |
| Low | Minister account (22010) lands here, but the surface reads like staff tooling; if a minister is truly a target user, the brief needs a one-card summary mode. |

**10% improvements:** label widget scopes; contrast token; "minister view" toggle or drop the minister from this console's audience.

---

### 7. MLA Local Closure Dashboard (`mla.html`) — score 7.5/10
**Persona:** MLA's office manager keeping constituency issues from escalating; politically sensitive to "escalated out of our hands" counts.

**What works:** "Close local issues before escalation" + "Constituency pressure" framing matches the political incentive perfectly — this is smart behavioral design. Escalated-out and citizens-waiting numbers create accountability without exposing identities. Operating-flow card explains how the MLA team should work the queue.

**Findings:**
| Sev | Finding |
|-----|---------|
| Med | axe **serious**: main content panel is a scrollable region not keyboard-focusable (`.mla-content-panel`) — keyboard users cannot scroll the primary content. |
| Low | `<small>` contrast fail; C-1 prefill fails for MLA login. |
| Low | KPI "4.8d average age" lacks a target/comparison — is that good? Add the SLA target beside it. |

**10% improvements:** `tabindex="0"` + role on the scroll panel; SLA target annotation.

---

### 8. Admin Console (`admin.html`) — score 5.5/10
**Persona:** platform operator configuring launch gates, OTP mandates, categories, SLA policies; also the person every other console's login hint points to.

**Findings:**
| Sev | Finding |
|-----|---------|
| High | **57 AA contrast failures** (axe) — status chips and meta text on tinted cards are the console's primary information carriers. |
| High | **One enormous scroll page** (~15,000px+ full-page capture). Left-rail items (Access, Launch Controls, SLA/Categories, Audit) exist, but everything renders in a single document; finding the OTP mandate toggle is archaeology. Operators under incident pressure cannot work this way. |
| Med | Dense progress/status vocabulary ("MVP1 launch gates", "9 green / 8 amber") mixes deployment-readiness reporting with operational controls. Split "readiness report" from "controls". |
| Low | The seeded credentials that every other console references live here, but they're not actually displayed anywhere findable pre-login (C-3). |

**10% improvements:** route left-rail to separate views (or at least anchored sections with sticky nav); chip contrast tokens; a "UAT accounts" card on the Access view.

---

### 9. Public Transparency (`transparency.html`) — score 8/10
**Persona:** journalist / RTI activist checking whether the government is hiding numbers; secondary: curious citizen.

**What works:** "Public issue trends without exposing citizens" headline + "aggregate-only release" explanation is exactly the right transparency posture and is explained in plain language (suppression below thresholds, delayed protected-aggregates). Trends vs Open Issues tabs are simple. This surface earns trust.

**Findings:**
| Sev | Finding |
|-----|---------|
| High (a11y) | axe **critical**: `role="tablist"` contains no `tab` children — the Trends/Open-Issues toggle is invisible to assistive tech. |
| Med | Empty state ("0 publishable complaints") dominates the whole page with zeros. With suppression thresholds this will be the *common* state for small districts — design a "numbers below publishable threshold" explainer state instead of rows of zeros. |
| Low | "V2 aggregate transparency" / "MVP spine" internal versioning chips visible to the public (C-4). |

**10% improvements:** proper `role="tab"` semantics; threshold-explainer empty state; strip internal version labels.

---

### 10. Workflow / Civic Journey Map (`workflow.html`) — score 8/10
**Persona:** stakeholder/citizen wanting to understand "what happens to my complaint".

**What works:** "From citizen voice to accountable closure" with per-handoff ownership, time bands (2 days / 7 days / 10 days) and four worked examples (sewage, pothole, corruption, dispute) — genuinely good explanatory design. The "corruption doesn't travel like potholes" section is the clearest protected-flow explanation in the product.

**Findings:**
| Sev | Finding |
|-----|---------|
| Med | Extremely long single page with no in-page nav/anchor menu; the four route walkthroughs look identical at a scroll-by — add a sticky stage index. |
| Low | Desktop body text in journey cards is small (≈12px) relative to the reading-heavy purpose. |

---

### 11. Launcher (`index.html`) — score 7/10 (internal audience)
**Persona:** UAT tester / stakeholder opening the demo.

**What works:** Card-per-surface with story ordering ("Follow the V1 story in order: workflow, citizen, verification, MLA, ministry, CM Cell, then Admin") — good guided tour. Numbered badges reinforce sequence.

**Findings:**
| Sev | Finding |
|-----|---------|
| Med | The launcher tells testers to start, but doesn't hand them the credentials they'll need two clicks later (C-3). Add the seeded phone/password per card. |
| Low | "V2 Local server / V2 Transparency / Legacy stats dashboard" footer links are unlabeled gray text — look disabled. |
| Low | `console.html` duplicate of verification (C-9) reachable but not on the launcher — dead surface, remove or redirect. |

---

## WCAG 2.1 AA summary (desktop, axe-core + manual)

| Surface | Critical | Serious | Key manual additions |
|---------|----------|---------|----------------------|
| Citizen | – | 3 (aria-prohibited-attr, contrast ×2) | Fake status bar announced as decoration (ok, aria-hidden); focus indicators (C-6); `lang` static (C-7) |
| Verification | – | 1 (protected-chip contrast) | – |
| Local | – | 1 (contrast) | – |
| Dashboard | – | – | Mobile reflow fail (1.4.10); heatmap color-only (1.4.1) |
| CM Cell | – | – | Disabled-state affordance |
| Ministry | – | 1 (contrast) | – |
| MLA | – | 2 (contrast, scrollable-region-focusable) | – |
| Admin | – | 1 rule / **57 nodes** (contrast) | Page length vs keyboard traversal |
| Transparency | **1 (aria-required-children)** | – | – |
| Workflow | – | – | Small body text |
| All | | | No skip links; `:focus-visible` absent globally (2.4.7) |

Login screens (all surfaces) passed axe with 0 violations — labels are real `<label>`s, inputs are 48px min-height, touch targets are adequate. Good baseline hygiene.

---

## Prioritized fix list

**P0 — broken first-run (do before any demo):**
1. Per-console login prefill using the matching seeded account (`AuthGate.tsx:422-428`) — or show a role-correct account picker when UAT bootstrap is on.
2. Role-mismatch error: name the required role and link to the right console.
3. Transparency tablist semantics (critical axe).

**P1 — quick wins, ≤1 day each:**
4. Contrast tokens for `<small>`/chips across role consoles + admin (clears ~64 axe nodes with ~3 CSS variables).
5. Global `:focus-visible` outline.
6. Remove fake StatusBar outside mockup builds; full-bleed citizen layout up to 768px.
7. Citizen copy pass: "spine"→plain language, "PILOT" badges, "Admin configuration" mentions.
8. Dashboard mobile header wrap + CM pill placement.
9. MLA scroll panel keyboard focus; launcher credentials card.
10. `document.documentElement.lang = language` on toggle; bundle a subset Noto Sans Tamil woff2.

**P2 — structural (plan, don't rush):**
11. Resolve dashboard ↔ CM Cell ↔ ministry overlap into one canonical surface per persona (C-9); retire `console.html`.
12. Admin console: split into routed views; separate readiness reporting from operational controls.
13. Citizen "My Complaints": single merged ticket list with one verification step and a freshness indicator.
14. Empty-state design system: every console widget states its scope (statewide vs ward) and explains zeros.

---

## What's already strong (don't break)

The role-console pattern (mandate banner → KPI strip → "what needs attention" → ticket detail with SLA ladder) is consistent, learnable, and persona-correct across six consoles — rare in gov tooling. Protected-corruption messaging is handled with more care than most production grievance systems. The citizen raise flow (category → department → details) with "not sure?" routing assistance is genuinely low-friction. The workflow explainer and transparency posture both build trust deliberately. The 10% improvements above are mostly polish on an architecture that is already right.

---

*Screenshots backing every finding (mobile/desktop × unauth/auth × all 12 entry points + citizen flow) and raw axe JSON: [`audit/ux-assessment-2026-06-11/`](./ux-assessment-2026-06-11/). Findings C-1…C-9 and all per-screen items were individually re-verified against rendered pages and source locations cited inline.*
