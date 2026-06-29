# Whistle MVP2 — Product Spec (PO / BA)

**Status:** Draft v1 for review · **Date:** 2026-06-14 · **Owner:** Prz (PO/BA)
**Companion:** [whistle-mvp2-architecture.md](./whistle-mvp2-architecture.md) (tech stack, agentic flow, providers)
**Source of truth for current state:** `server/config/mvpScope.ts` + the code (identifiers in §10 verified against source on 2026-06-14).

---

## 0. How to read this

This is the **what** and **why** for MVP2's four items. The **how** (Python+LangGraph agent service, LLM hosting, SMS/WhatsApp providers) lives in the companion architecture doc. Where this spec and `mvpScope.ts` disagree, treat this spec as the proposal and update `mvpScope.ts` in the same PR that ships the change (3-layer rule: scope config + code + tests move together).

MVP2 is **four items**, not one feature. They share guardrails (§2) but ship and gate independently.

---

## 1. MVP2 in one paragraph

From `mvpScope.ts`: **"Transparency and recommend-only intelligence."** Add public aggregate trust surfaces and AI-*assisted* recommendations **after** the MVP1 workflow is stable. Agents recommend; humans decide; the ticket spine stays the only authority over state. **Hard gate:** the code principle is explicit — *"Do not add MVP2–MVP4 features until MVP1 launch gates are green."* MVP2 build can be staged in parallel behind flags, but no MVP2 surface goes to citizens/officials in production until MVP1 is GO.

**MVP2 phase exit criteria (from `mvpScope.ts`, unchanged):**
1. Public aggregate counts reconcile with internal counts.
2. Agents are logged, reviewable, schema-valid, and unable to mutate lifecycle state.
3. Admin can pause public visibility and category exposure.

---

## 2. Non-negotiable guardrails (carried from MVP1 into every MVP2 item)

1. **The ticket spine is the only authority over lifecycle state.** Status, queue, SLA clocks, notifications, and audit change only through the spine's decision endpoints.
2. **Recommend-only.** Every agent run and every brief carries a `nonMutationGuarantee` and writes only to its own table (`agent_recommendation_runs` / brief run) plus the audit ledger. It can never change a ticket. Enforced three ways today (separate-table write, audit-only, smoke tests assert the ticket is byte-for-byte unchanged) — this property must survive the swap to a real model.
3. **Protected (corruption) compartmentalization.** Protected tickets are excluded from public aggregates (statewide count only), **hard-excluded from WhatsApp**, and rendered with masked copy. No protected identity or detail leaks to any read surface.
4. **Role/scope isolation at the DB layer (RLS).** A minister sees only their ministry; CM Cell sees state; verification sees the queue. Never trust a client-sent role/ministry/scope. Cross-scope access is a security bug.
5. **Public is aggregate-only, delayed, and privacy-thresholded.** No raw rows, no PII fields, ever.
6. **DPDP Act 2023.** Consent is free, specific, informed, **unbundled per purpose and per channel**, and revocable with equally easy opt-out. Vendor (BSP/aggregator/LLM) contracts carry Section 8(5) processor clauses; the Section 17 state-instrumentality exemption does **not** cascade to vendors.
7. **Definition of Done (six gates), per item:** builds + lints clean (`tsc --noEmit` + lint, no skip); ≥1 test fails if the feature breaks; flow walked end-to-end in a running build; grep shows zero stale refs; committed; pushed. Auth, the recommend-only write path, role-scoping, and any real payment/identity trigger must be **real**, not mocked, before "done."

---

## 3. Current state (verified 2026-06-14)

| Item | Endpoint(s) | Today | Key flags / seams | Status |
|---|---|---|---|---|
| 1. Public transparency | `GET /api/public/insights` (no auth) | Real aggregation: publication delay, small-cell suppression, protected exclusion, asset policy, PII-field exclusion | `feature-public` (default `true`), `public-publish-delay-hours` (default `24`), `PUBLIC_CELL_THRESHOLD = 2` **(hardcoded)** | partial |
| 2. Agentic intake | `POST`/`GET /api/verification/:ticketId/agent-runs` (roles: verification, cm_cell; action `agent.recommendation.run`) | **Deterministic rule stub** (`modelVersion="deterministic-prototype-rules"`, `promptVersion="intake-verification-v2.0"`); non-mutation enforced 3 ways; written to `agent_recommendation_runs` (RLS) | **No feature flag gates it** (gap); seam to swap a model = `recommendationFor()` in `agentic.ts` | partial |
| 3. CM/ministry briefs | `POST /api/dashboard/briefs` (roles: cm_cell, minister) | Deterministic, scope-locked (minister → own ministry only, else 403), non-mutating; on-demand only | `dashboard-sla-brief-v2.0`; audit `agent.dashboard_brief.created` | partial |
| 4. Notification governance | `NotificationDeliveryProvider` seam; provider job runner | Modes: `mock` / `webhook` / `disabled`; channels `in_app`/`sms`/`whatsapp`; templates hardcoded in `lifecycle.ts` (`en`/`ta` × topic); protected → no WhatsApp + masked copy | `notify-sms`, `notify-template`, `infra-notification-provider-config-ref` (critical), `infra-notification-provider-ready` (critical); env `WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL`, `..._API_KEY` | partial |

---

## 4. Item 1 — Public Transparency Portal & Privacy Thresholds

### 4.1 Value
A public, aggregate-only trust surface: how many civic issues are open/resolved by district, ministry, and category — delayed and privacy-thresholded so **no individual complaint or complainant is identifiable**. Builds public legitimacy for the platform without ever exposing a citizen.

### 4.2 Roles
Public (unauthenticated) reader; Admin (pause/configure); Data steward (reconciliation owner); Comms approver (public copy sign-off).

### 4.3 Current implementation (verified)
`GET /api/public/insights` returns `trends` (month + all-time: total/open/resolved/slaBreached/dueIn48h/escalatedToCmCell), `openIssues` (byDistrict/byMinistry/byCategory), and a `privacy` block (threshold, publicationDelayHours, withheld counts, `excludedFields`, protectedPolicy). Logic: tickets younger than `public-publish-delay-hours` (default 24) are withheld and counted in `withheldRecentTickets`; rows with `< PUBLIC_CELL_THRESHOLD` (=2) tickets are suppressed into `withheldSmallCellRows`; protected-category tickets appear only as a statewide `protectedCount`; PII fields (`ticketId, title, description, phone, address, landmark, evidence, timeline, reporterIdentity`) are never serialized; `feature-public=false` → `403 public_insights_disabled`.

### 4.4 What MVP2 adds (scope of "done")
1. **Reconciliation job & sign-off** — a scheduled job recomputes public aggregates from the internal source and asserts they tie within tolerance; on drift beyond tolerance it raises an alert and can auto-pause the portal. **This is exit-criterion #1 and is currently the biggest gap.**
2. **Configurable small-cell threshold** — promote the hardcoded `=2` to a governed control (e.g. `public-cell-threshold`, default 2, **critical**) so privacy posture is tunable without a redeploy.
3. **Category exposure control** — Admin selects which categories appear publicly (exit-criterion #3). Protected categories are never selectable.
4. **Public methodology page (bilingual)** — plain Tamil/English explanation of the delay + suppression so the numbers are trusted and not misread; carries the approved disclaimer.
5. **Comms copy sign-off workflow** — public-facing copy + disclaimer pass a named approver before publish (governed like other critical config).
6. **Bilingual + accessible surface** — Tamil/English, WCAG 2.1 AA.
7. **Freshness indicator** — visible "data as of <timestamp>" and the active delay window.

### 4.5 User stories & acceptance criteria
- **US-1.1** As a citizen, I see district/ministry/category open-issue counts so I can gauge civic responsiveness.
  - **AC:** Given a district with `< threshold` tickets, the row is withheld and added to `withheldSmallCellRows`/`withheldSmallCellTickets`. Given fresh tickets inside the delay window, they are excluded and counted in `withheldRecentTickets`.
- **US-1.2** As a whistleblower, I am never identifiable from the public portal.
  - **AC:** Given a protected-category ticket, it appears only in statewide `protectedCount` and never in `byDistrict`/`byMinistry`/`byCategory`. Given any response, none of the `excludedFields` (PII) is present in the serialized payload (smoke-asserted).
- **US-1.3** As an Admin, I can pause the portal instantly.
  - **AC:** Given `feature-public=false`, the endpoint returns `403 public_insights_disabled`. Given a category removed from the exposure list, its rows disappear from the next render.
- **US-1.4** As a data steward, I'm alerted if public ≠ internal.
  - **AC:** Given the nightly reconciliation, when public totals diverge from internal counts beyond tolerance, an alert is raised (and optionally the portal auto-pauses) with the diverging dimension named.

### 4.6 NFR / compliance
Read-only, cacheable, no auth; never reads raw production tables for anything PII-bearing (aggregate projection only); methodology + disclaimer legally reviewed; bilingual; accessible.

### 4.7 Exit criteria (this item)
Public aggregate counts reconcile with internal counts (tolerance defined + alerting live); Admin can pause visibility and category exposure; methodology + disclaimer approved.

---

## 5. Item 2 — Recommend-Only Agentic Intake

### 5.1 Value
Speed and consistency at verification: for every ticket entering the verification/protected-intake queue, an agent proposes a **category, department, route/request-info/protected/reject action, missing-field list, duplicate candidates, a protected-corruption signal, and a draft citizen message** — with reasons and a confidence. The officer triages faster; **the human still decides.** This is the "intelligence" half of MVP2 and the part vibe-coding cannot be trusted with.

### 5.2 Roles
Verification officer (consumes + decides); CM Cell (oversight); Verification lead (quality metrics); Admin (enable/disable, per category).

### 5.3 Current implementation (verified)
`POST`/`GET /api/verification/:ticketId/agent-runs`, restricted to roles `verification` and `cm_cell` with action `agent.recommendation.run`; the ticket must be in `verification`/`protected_review` (else `409 ticket_not_in_intake`). Today the recommendation is **deterministic rules** (word-match category, location/evidence completeness, corruption-signal keywords, duplicate scoring, confidence heuristic). Output is the `IntakeAgentRecommendation` (fields in §10), stored write-only in `agent_recommendation_runs` (RLS on), audited as `agent.recommendation.created`. **Non-mutation is enforced three ways** and smoke tests assert the ticket's status/queue/SLA/timelines/notifications are unchanged after a run. **There is no feature flag gating agent runs today** — a gap to close.

### 5.4 What MVP2 adds (scope of "done")
1. **Real model behind the same contract** — swap `recommendationFor()` for an LLM call via the agent service (architecture doc), returning the **identical** `IntakeAgentRecommendation` schema. **Keep the deterministic rules as a fallback** for provider outage/low-confidence.
2. **Feature gating** — add `feature-agent-intake` (and optional per-category enablement) so agents can be turned off globally or per sensitive category. (Closes the current no-flag gap.)
3. **Human-review surface** — the verification console shows the recommendation; the officer can **Accept** (pre-fills the existing `VerificationDecisionCommand` for `POST /api/verification/:ticketId/decision`), **Edit**, or **Reject**. A human confirmation is always required; the reviewer's action is recorded.
4. **Confidence tiers** — defined thresholds; low-confidence recommendations are flagged "needs careful review"; nothing ever auto-acts.
5. **Feedback loop & metrics** — record reviewer accept/override per run → compute **precision, override rate, per-action accuracy**, and especially **protected-signal recall** (safety-critical).
6. **Golden-set evaluation + acceptance bar** — a labeled Tamil/English ticket set; the model may not be enabled in production until it clears the bar (e.g. category precision ≥ target, **protected recall ≥ a high target** because a missed whistleblower signal is a serious harm).
7. **Prompt governance** — prompts live in a versioned registry; changes require approval and bump `promptVersion`; rollback supported.
8. **Bilingual handling + PII minimization** — Tamil + English input normalization; redact/minimize PII before any model call.

### 5.5 User stories & acceptance criteria
- **US-2.1** As a verification officer, I get a recommended action with reasons and a draft message so I triage faster — but I decide.
  - **AC:** Given any agent run, the ticket's status/queue/SLA/notifications/audit are unchanged afterward (3-layer guarantee, smoke-asserted). Accepting a recommendation pre-fills the decision command but still requires a human confirm; the acceptance is recorded.
- **US-2.2** As a whistleblower, my protected complaint's signals are detected but never auto-acted or leaked.
  - **AC:** Given corruption signals, `primaryAction="route_protected"` and `protectedSignal.flagged=true`; the recommendation text never appears in any citizen-facing copy; protected runs respect RLS.
- **US-2.3** As a verification lead, I can see agent quality.
  - **AC:** Given a window of runs, precision / override rate / protected recall are reported per action and per category.
- **US-2.4** As an Admin, I can disable agents (globally or per category).
  - **AC:** Given `feature-agent-intake=false`, agent-run requests are refused/return a disabled response; deterministic fallback still allows manual verification.
- **US-2.5** Resilience & governance.
  - **AC:** Given the model provider is unavailable, the system falls back to deterministic rules and flags "degraded" (no hard failure). Given a prompt change, it cannot reach production without approval + version bump. Given a `minister` role, `agent-runs` returns `403` (only verification/cm_cell).

### 5.6 NFR / compliance
Recommend-only invariant preserved post-model; per-run cost/latency budget + metering; structured-output validation (reject malformed model output, never partial-write a ticket); protected-path inputs handled under the stricter data-residency posture (architecture doc); audit every run with prompt+model version and input hash.

### 5.7 Exit criteria (this item)
Agents are logged, reviewable, schema-valid, and unable to mutate state (exit-criterion #2); model clears the golden-set bar; human-review surface live; prompt governance + fallback in place.

---

## 6. Item 3 — Recommend-Only CM / Ministry SLA Briefs

### 6.1 Value
A scoped, recommend-only operational brief: a headline, risk level, KPIs, three focus areas, recommended (read-only) actions, and a ≤5-ticket watchlist — for CM Cell (statewide) and ministers (their ministry only). Turns dashboards into a daily "what to escalate" without changing anything.

### 6.2 Roles
CM Cell officer (statewide brief); Minister (own-ministry brief); Program lead (usefulness).

### 6.3 Current implementation (verified)
`POST /api/dashboard/briefs`, roles `cm_cell` and `minister`, action `agent.recommendation.run`. Scope is enforced: a minister can only brief their assigned ministry (active ministry queue assignment), else `403`; CM Cell is statewide. Generation is **deterministic aggregation** over the governed dashboard projection; the brief carries `recommendedActions[].readOnly=true` and a `nonMutationGuarantee`; audited as `agent.dashboard_brief.created`. **On-demand only** today.

### 6.4 What MVP2 adds (scope of "done")
1. **Scheduling + digest** — a worker generates daily/weekly briefs on a cadence, caches the latest, and delivers an in-app (optionally email) digest. (Closes the "no scheduling" gap.)
2. **Acknowledge / assign** — a recommended action can be acknowledged or turned into a real assignment — but the **assignment goes through the ticket spine decision path** (audited), never the brief. The brief stays recommend-only.
3. **Usefulness metrics** — track brief opens and whether a recommended action was acted on (link brief → subsequent real decision); capture a "was this useful" signal. (Closes the "unmeasured usefulness" gap.)
4. **Period-over-period deltas** — KPIs vs the previous brief.
5. **Optional LLM narrative** — a natural-language summary under the same recommend-only contract; **KPIs remain deterministic** (never model-computed).
6. **Bilingual** output.

### 6.5 User stories & acceptance criteria
- **US-3.1** As a CM Cell officer, I get a daily statewide SLA brief with a watchlist so I focus the right escalations.
  - **AC:** Given the scheduled job, a fresh brief is cached and a digest delivered with no manual trigger; the watchlist is ≤5 and prioritized by breach → cm_cell → dueIn48h → protected.
- **US-3.2** As a minister, I get my ministry's brief and only mine.
  - **AC:** Given minister for ministry A requesting ministry B, return `403`. KPIs/watchlist are computed only over A's scoped tickets.
- **US-3.3** Non-mutation + real action path.
  - **AC:** Given any brief generation, no ticket is mutated (smoke-asserted). Given a recommended action is "acted on," the mutation routes through the ticket spine decision endpoint and is audited there, not in the brief.
- **US-3.4** As a program lead, I can see if briefs are used.
  - **AC:** Brief opens and action-follow-through are reported.

### 6.6 Exit criteria (this item)
Scheduling live; usefulness measured; acknowledge/assign defined and routed through the spine; scope isolation preserved.

---

## 7. Item 4 — Notification Template Governance (SMS / WhatsApp / In-App)

### 7.1 Value
Citizens get timely status updates in their language on a channel they consented to; protected complainants are shielded; the state stays DLT/DPDP/Meta compliant; ops can see delivery and cost. Turns the working notification *seam* into a governed, production messaging capability.

### 7.2 Roles
Citizen (recipient + consent owner); Admin (template + channel governance, approvals); Ops (delivery + cost); Tamil reviewer (language QA).

### 7.3 Current implementation (verified)
A `NotificationDeliveryProvider` seam with `mock` / `webhook` / `disabled` modes. Channels `in_app`, `sms`, `whatsapp`. Templates are **hardcoded** in `lifecycle.ts` (`notificationCopy`, `en`/`ta` × 14 topics × inApp/external). **Protected tickets are hard-excluded from WhatsApp** and get masked external copy ("…Open Whistle for details."). The webhook payload carries `recipientMasked` (no raw phone), `safeMessage`, and a `sensitive` flag. Controls: `notify-sms` (bool), `notify-template` (string), `infra-notification-provider-config-ref` (critical), `infra-notification-provider-ready` (critical). Env: `WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL`, `..._API_KEY`. Production without a configured provider falls **closed** (disabled mode marks sends failed).

### 7.4 What MVP2 adds (scope of "done")
1. **Wire real providers** — SMS via **NIC SMS Gateway** (primary, government) with **MSG91/Tanla** fallback; WhatsApp by **reusing TNeGA's existing "Namma Arasu" government WABA** (preferred) or a **Gupshup BSP**. (Selection, costs, credentials → architecture doc.)
2. **India DLT compliance + template registry** — register principal entity, sender header, and content templates; build a registry mapping internal `topic × language → DLT template ID → (WhatsApp) Meta template name`. An external SMS with no registered DLT template ID must not send (it would be scrubbed).
3. **Consent / opt-out ledger (DPDP)** — per-channel, **unbundled** consent captured at ticket creation; easy withdrawal; a suppression list enforced **before** every send.
4. **Delivery receipts + retry** — a provider callback updates `NotificationIntent` status (queued→sent→delivered/failed); failures retry idempotently (the `attempts` field exists but is unused today).
5. **Tamil language QA** — native-speaker review/approval of Tamil templates before they reach citizens; no machine-only translations.
6. **Governance reconciliation** — reconcile the governed `notify-template` control with the hardcoded `notificationCopy` (today the hardcoded copy wins); decide the single source of truth and move template edits behind approval.
7. **Per-channel rate limits + cost metering.**

### 7.5 User stories & acceptance criteria
- **US-4.1** As a citizen, I get updates in my language on a channel I consented to.
  - **AC:** Given a citizen opted out of SMS, no SMS is sent (suppression enforced pre-send). Given a Tamil recipient, the Tamil template is used and was native-speaker-approved.
- **US-4.2** As a protected complainant, I never receive WhatsApp.
  - **AC:** Given a protected ticket, no WhatsApp notification is ever queued (smoke-asserted) and external copy carries no case detail.
- **US-4.3** As ops, I can trust delivery + see cost.
  - **AC:** Given a delivery-receipt webhook, the notification status updates; failures retry idempotently; per-channel cost is metered.
- **US-4.4** DLT compliance.
  - **AC:** Given an external SMS, it maps to a registered DLT content template ID for that topic+language, else it is not sent and the gap is flagged.

### 7.6 NFR / privacy nuance (important)
The internal abstraction uses `recipientMasked` for logs/audit, but a **real SMS/WhatsApp provider must receive the actual phone number to deliver**. Requirement: the raw number is sent **only** to the approved, contracted provider over TLS, under a DPDP Section 8(5) processor agreement, **never logged, never to any third party**; all internal logs/audit continue to use the masked value. Message content to insecure channels stays minimal for protected tickets (already enforced).

### 7.7 Exit criteria (this item)
Real provider live and falling closed when unconfigured; DLT templates registered + mapped; consent/opt-out enforced; delivery receipts + retry; Tamil QA approved; protected WhatsApp hard-block tested.

---

## 8. Cross-cutting requirements

- **DPDP 2023:** unbundled per-channel consent + easy opt-out; processor agreements with every external vendor (LLM, SMS, WhatsApp); data-residency posture per the architecture doc; consent-manager provisions phase in by 13 Nov 2026 — design consent capture to be migratable.
- **Bilingual Tamil/English** across every citizen- and public-facing surface; Tamil QA for anything sent to citizens.
- **Accessibility** WCAG 2.1 AA on the public portal and any new console surface.
- **Auditability:** every agent run, brief, public-config change, template change, and notification carries an append-only audit event.
- **RLS scoping** preserved on all new reads/writes; a cross-scope access test per new route.
- **Definition of Done** (§2.7) per item; `mvpScope.ts` updated in the same PR.

---

## 9. Open decisions (need a PO/legal call)

1. **LLM hosting & data-residency posture** — architecture doc recommends a two-lane design (self-host for protected, managed in-region for bulk). Needs PO + legal sign-off (DPDP / sovereignty). *Decision owner: PO + legal.*
2. **Reuse TNeGA "Namma Arasu" WABA?** — strongly recommended; needs TNeGA confirmation of multi-app/number policy. *Owner: PO ↔ TNeGA.*
3. **Reg-35 SMS 5-paisa exemption for whistleblower copy** — citizen status updates likely qualify; whistleblower-specific content is a TRAI committee judgment call. *Owner: PO ↔ TRAI.*
4. **Public category exposure list** — which categories appear on the public portal (protected never). *Owner: PO + comms.*
5. **Agent acceptance bar before production** — the precision/protected-recall thresholds that gate enabling the model. *Owner: PO + verification lead.*
6. **Brief cadence** — daily vs weekly per role; digest channel. *Owner: PO ↔ CM Cell/ministries.*

---

## 10. Identifier reference (verified against source 2026-06-14)

| Thing | Identifier | Location |
|---|---|---|
| Public insights endpoint | `GET /api/public/insights` → `403 public_insights_disabled` | `app.ts`, `publicInsights.ts` |
| Public feature flag | `feature-public` (default `true`) | `config/defaults.ts:191` |
| Publication delay | `public-publish-delay-hours` (default `24`) | `config/defaults.ts:192` |
| Small-cell threshold | `PUBLIC_CELL_THRESHOLD = 2` (hardcoded → promote to control) | `publicInsights.ts:7` |
| Agent run endpoints | `POST`/`GET /api/verification/:ticketId/agent-runs` | `app.ts` |
| Agent action | `agent.recommendation.run` (verification, cm_cell, minister grants) | `access/defaults.ts` |
| Agent prompt/model version | `intake-verification-v2.0` / `deterministic-prototype-rules` | `agentic.ts:12-13` |
| Agent model seam | `recommendationFor()` | `agentic.ts` |
| Agent run table | `agent_recommendation_runs` (RLS enabled) | `db/schema.sql:434,703` |
| Brief endpoint | `POST /api/dashboard/briefs` | `app.ts`, `openapi.ts:308` |
| Brief prompt version | `dashboard-sla-brief-v2.0`; audit `agent.dashboard_brief.created` | `dashboardBrief.ts:13` |
| Notification seam | `NotificationDeliveryProvider` (`mock`/`webhook`/`disabled`) | `notifications/provider.ts:13` |
| Notification env | `WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL`, `..._API_KEY` | `notifications/provider.ts:65` |
| Notification controls | `notify-sms`, `notify-template`, `infra-notification-provider-config-ref` (critical), `infra-notification-provider-ready` (critical) | `config/defaults.ts` |

---

*Companion: [whistle-mvp2-architecture.md](./whistle-mvp2-architecture.md) — agent service topology, LLM hosting, SMS/WhatsApp providers, MVP2 build sequencing.*
