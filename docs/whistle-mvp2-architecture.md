# Whistle MVP2 — Architecture, Tech Stack & Roadmap

**Status:** Draft v1 for review · **Date:** 2026-06-14 · **Owner:** Prz (Architect)
**Companion:** [whistle-mvp2-spec.md](./whistle-mvp2-spec.md) (PO/BA requirements) · builds on [whistle-technical-architecture-proposal.md](./whistle-technical-architecture-proposal.md) and [agentic-pipeline-summary.md](./agentic-pipeline-summary.md).
**Decisions locked this pass:** (1) the recommend-only agent runs as a **separate Python + LangGraph service**; (2) LLM hosting = **research-and-recommend → two-lane (self-host Sarvam for protected, managed in-region for bulk)**, detailed in §4.

---

## 1. Scope & principles

MVP2 adds four capabilities (public transparency, recommend-only agentic intake, CM/ministry briefs, notification governance) **on top of** the MVP1 ticket spine — without changing who owns state. Carried principles (from the V1 architecture council, non-negotiable):

1. The ticket lifecycle is **deterministic and authoritative**. The TypeScript modular monolith (ticket spine + Postgres) remains the **system of record**.
2. **Agents, dashboards, and public surfaces read governed projections; they never own or mutate lifecycle state.**
3. Every meaningful action writes an **append-only audit** event.
4. **Public transparency is aggregate-only, delayed, privacy-thresholded.**
5. **Protected complaints are compartmentalized** and audited separately; their data takes the strictest residency lane.
6. Authorization at **both app and DB (RLS)** layers; explicit deny by default.
7. **Split a service out only when scale/ownership/security demands it.** MVP2 splits out exactly one new runtime — the agent service — because it needs a different language (Python), different compute (GPU/LLM), and a hard security boundary.

---

## 2. Target architecture (MVP2)

```
                         ┌──────────────────────────────────────────────────────┐
   Citizen PWA           │            TypeScript Modular Monolith (Fastify)       │
   Gov consoles  ─────▶  │                  = SYSTEM OF RECORD                    │
   Public portal         │  Ticket spine · lifecycle · SLA · RBAC/RLS · audit ·   │
                         │  notifications job · public-insights projection        │
                         └───┬───────────────┬──────────────────┬────────────────┘
                             │ read-only      │ persist run       │ deliver
                             │ projection     │ (recordAgentRun,   │
                             │ (governed)     │  RLS + audit)      │
                             ▼                ▼                    ▼
                 ┌───────────────────────┐   (writes stay     ┌───────────────────────┐
                 │  AGENT SERVICE         │    in the spine)   │  NOTIFICATION PROVIDERS │
                 │  Python + FastAPI      │                    │  via NotificationDelivery│
                 │  + LangGraph workers   │                    │  Provider seam:          │
                 │  (recommend-only,      │                    │   • SMS: NIC gateway /   │
                 │   NO ticket DB write)  │                    │     MSG91 (DLT)          │
                 │                        │                    │   • WhatsApp: TNeGA WABA /│
                 │  ┌──────────────────┐  │                    │     Gupshup BSP          │
                 │  │ LLM Gateway       │  │                    │   • in_app (internal)    │
                 │  │ (provider-agnostic)│ │                    └───────────────────────┘
                 │  │  ├ self-host lane  │ │
                 │  │  │  (Sarvam-M,vLLM)│ │   ← PROTECTED / corruption inputs
                 │  │  └ managed lane    │ │   ← bulk / non-sensitive intake
                 │  │    (Sarvam API /   │ │
                 │  │     Vertex Gemini) │ │
                 │  └──────────────────┘  │
                 │  Postgres checkpointer  │
                 │  pgvector (dup search)  │
                 │  prompt registry · evals│
                 └───────────────────────┘
```

**Key boundary:** the agent service is **pure compute**. It reads governed, scoped projections (over an internal read API or a read-replica), runs a LangGraph graph, and **returns** an `IntakeAgentRecommendation`. The **TypeScript spine persists** that result through its existing `recordAgentRun()` path (writes only to `agent_recommendation_runs` + audit, under RLS). The agent service holds **no write credential to the tickets schema**. This makes the recommend-only invariant *structural*, not merely tested — the component that could "go rogue" physically cannot mutate a ticket.

---

## 3. The agent service (the core of MVP2)

### 3.1 Why a separate Python + LangGraph service
The V1 council deferred autonomous/agentic work to a V2 **Python FastAPI + LangGraph** service precisely so agent compute, model dependencies, and prompt/PII handling sit behind a hard boundary, isolated from lifecycle mutation. LangGraph fits long-running, stateful, **human-in-the-loop** workflows with persistence, checkpointing, and replay — matching an auditable government workflow.
**Trade-off (acknowledged):** this adds a second language and runtime to operate vs. extending the TS stub. We accept it because (a) the strongest Tamil models and the LLM tooling are Python-native, (b) GPU/serving is a different ops domain, and (c) the boundary is the security feature. The TS deterministic rules remain as the **in-process fallback** so the platform degrades gracefully if the agent service is down.

### 3.2 The recommend-only contract (how non-mutation is guaranteed)
- **Input:** the spine calls the agent service with a *scoped, minimized* ticket projection (no more PII than the task needs). For protected tickets, the call is routed to the self-host lane (§4).
- **Compute:** LangGraph graph runs; output is validated against the `IntakeAgentRecommendation` JSON schema (Pydantic on the Python side mirroring `ticket-spine/types.ts`).
- **Output → persistence:** the agent service returns the recommendation; the **spine** writes it via `recordAgentRun()` → `agent_recommendation_runs` (RLS) + audit `agent.recommendation.created`. The agent service never touches `tickets`, `ticket_events`, SLA, or notifications.
- **Result:** the existing three-layer guarantee (separate-table write, audit-only, smoke asserts ticket unchanged) is preserved *by construction* after the model swap. The model-swap smoke test must re-assert all of it.

> For long/async runs, an alternative is the agent service writing to its own runs table under a narrowly-scoped role. **For MVP2 keep writes in the spine** — simpler, one audited write path, no second RLS surface.

### 3.3 LangGraph intake graph topology
The first (and MVP2-only) graph is **Intake + Verification** — every ticket passes through it. Nodes map 1:1 to the existing `IntakeAgentRecommendation` fields so the contract is unchanged:

```
normalize_text (Tamil/English)
   → classify_category ───────────► suggestedCategory / suggestedDepartment
   → assess_location ─────────────► locationAssessment {confidence, missing}
   → check_completeness ──────────► missingFields
   → assess_evidence ─────────────► evidenceAssessment
   → detect_protected_signal ─────► protectedSignal {flagged, reasons}   (safety-critical)
   → search_duplicates (pgvector) ► duplicateCandidates[]
   → decide_primary_action ───────► primaryAction ∈ {route_local | request_info
                                      | route_protected | reject_candidate}, confidence
   → draft_citizen_message ───────► draftCitizenMessage
   → build_reviewer_packet ───────► reviewerSummary, reasons[], rejectionGuardrails[]
   → validate_schema ─────────────► (reject malformed → deterministic fallback)
```

- **Human-in-the-loop:** the graph **stops at the reviewer packet**. The human decision happens in the verification console (the existing `POST /api/verification/:ticketId/decision`), not inside the graph. The graph never resumes into a mutation.
- **Checkpointing:** LangGraph **Postgres checkpointer** for durability/replay/audit of each node's state (separate schema/DB from the spine).
- **Determinism where it matters:** `detect_protected_signal` keeps a deterministic keyword pre-filter *in addition to* the model, so a model miss can't silently drop a corruption signal (union of model + rules for protected recall).

### 3.4 LLM gateway abstraction (mirror the notification seam)
Introduce an `LLMGateway` interface modeled on the existing `NotificationDeliveryProvider` pattern (`mode`, `healthCheck()`, `generate(structuredRequest)`), so models are swappable without touching graph logic:

- **Implementations:** `SelfHostLLM` (vLLM serving Sarvam-M), `ManagedLLM` (Sarvam API / Vertex Gemini). Selection is **per-call by sensitivity**: `protected → self-host lane`; `non-sensitive bulk → managed lane`.
- **Structured output:** request a JSON-schema-constrained response; validate with Pydantic; on invalid/again-invalid → **deterministic fallback** (never partial-write).
- **PII minimization:** a redaction step strips/limits PII before any managed-lane call; protected inputs never leave the self-host lane.
- **Resilience:** `healthCheck()` gates the lane; provider outage → deterministic fallback + "degraded" flag surfaced to verification.
- **Observability:** token count, latency, cost, model+prompt version emitted to **OpenTelemetry** per run (the spine already has OTel).

### 3.5 Prompt governance & evaluation
- **Prompt registry** (versioned, DB-backed): prompt text is *not* hardcoded; changes require approval and bump `promptVersion` (today `intake-verification-v2.0`); rollback supported.
- **Eval harness:** a labeled Tamil/English golden set of historical/synthetic tickets; CI scores each model+prompt version on category precision, action correctness, duplicate quality, and **protected-signal recall** (weighted highest). A model may not be enabled in production below the acceptance bar (§ spec 5.4/9).
- **Feedback loop:** reviewer Accept/Edit/Reject is recorded (new `agent_feedback` table) → live precision / override-rate / protected-recall dashboards; drift watch per model version.

### 3.6 Data-model additions (Postgres)
Existing: `agent_recommendation_runs` (RLS, write-only via spine). Add:

| Table | Purpose |
|---|---|
| `agent_prompt_versions` | prompt text + version + approval + active flag |
| `agent_feedback` | reviewer decision vs. recommendation, per run (for metrics) |
| `agent_eval_runs` | golden-set scores per model+prompt version (gates prod enable) |
| `agent_model_config` | which gateway/lane/model per use case; enable flags |
| LangGraph checkpoint tables | graph state/checkpoints (separate schema/DB) |
| `pgvector` index | embeddings for duplicate-candidate search (after privacy review) |

Feature flags: add `feature-agent-intake` (+ optional per-category) — closes the current no-flag gap.

---

## 4. LLM hosting recommendation

### 4.1 The legal frame (DPDP Act 2023) — what's actually required
DPDP uses a **negative-list (blacklist)** model for cross-border transfer (§16): personal data may go anywhere **except** countries the government specifically restricts — and **no restriction list has been notified** as of June 2026 (DPDP Rules notified 13–14 Nov 2025). There is **no general data-localization mandate**; the only hard in-country bar is Rule 13(4) for **Significant Data Fiduciaries** on enumerated data classes. **Conclusion:** sending grievance text to an **in-region** (India) cloud LLM is legally permitted today. Self-hosting is driven by (a) sovereignty optics for a state whistleblower system, (b) the risk this platform is later designated an SDF and localized, and (c) retaliation-safety for protected identities — **not** a current statutory ban.

### 4.2 Recommended posture — two lanes
- **PRIMARY (protected / whistleblower path): self-host Sarvam-M 24B (Apache-2.0)** on IndiaAI/MeitY-empanelled GPU infra (vLLM). Best Tamil at this size; clean OSI license (no foreign-vendor acceptable-use policy over a corruption workload); data physically never leaves government-controlled India infra — the cleanest DPDP + SDF + retaliation posture. Institutionally aligned with TN's own **Sovereign AI Park (TN govt + IIT-Madras "Digital Sangam")** and Sarvam's IndiaAI selection.
- **FALLBACK / bulk (non-sensitive intake): Sarvam managed API** (in-region, SOC2/ISO27001, DPDP-compliant, no-train-by-default) **or Vertex AI Gemini 2.5 Flash-Lite in `asia-south1`** (in-region ML processing, no-training §17, ZDR via abuse-monitoring exception + caching disabled). Lowest ops burden during spikes toward the 50k/day target.
- Route **only de-identified / non-protected** text through the managed lane; keep protected inference on the self-hosted instance. The recommend-only design means there's no GPU-availability risk to state mutation — worst case is a degraded recommendation, never a stuck ticket.

### 4.3 Comparison (condensed)

| Option | Tamil | Residency / retention | Rough cost | Ops |
|---|---|---|---|---|
| **Self-host Sarvam-M 24B** (Apache-2.0) | Highest | Full sovereignty; nothing leaves infra | IndiaAI GPU ~₹67–150/hr; 1×48–80 GB card ≈ ₹50k–110k/mo; ~₹0 marginal | High |
| **Sarvam managed API** | Highest | India-hosted, DPDP-compliant, no-train default; VPC/on-prem option | ~₹4 in / ₹16 out per 1M tok | Low |
| **Vertex Gemini 2.5 Flash-Lite (asia-south1)** | Good | In-region ML processing; no-train §17; ZDR via exception | PAYG per-token | Low |
| **Bedrock Qwen3 (ap-south-1)** | Good | In-region + `data_retention_mode:none` = true ZDR (**not** Claude-global, which routes out of India) | PAYG | Low–Med |
| **Azure OpenAI (Central India)** | Good | No-train default; **ZDR gated (EA/MCA, approval)**; newest models not reliably India-pinned | PAYG | Med |

All three hyperscalers are **MeitY-empanelled** for government workloads from their India regions, so any is procurement-eligible.

### 4.4 Credentials (for the managed lane — exact items)
- **Sarvam API:** endpoint `https://api.sarvam.ai` (OpenAI-compatible `/v1/chat/completions`); auth header `api-subscription-key: <KEY>` (dashboard-issued). For VPC/on-prem/air-gapped govt deploy, engage Sarvam enterprise (deployed artifact + license, not the public key).
- **Vertex Gemini (region-pinned — do NOT use the `global` endpoint):** `https://asia-south1-aiplatform.googleapis.com/v1/projects/<PROJECT_ID>/locations/asia-south1/publishers/google/models/gemini-2.5-flash-lite:generateContent`; auth `Authorization: Bearer <token>` from a **GCP service account**; IAM role **`roles/aiplatform.user`** (scope `https://www.googleapis.com/auth/cloud-platform`); for ZDR request the abuse-monitoring exception + disable caching (`cacheConfig`, needs `roles/aiplatform.admin`). Collect from user: **Project ID**, Vertex API enabled, billing on, **service-account JSON key**, region fixed to `asia-south1`.
- **Bedrock Qwen3 (if AWS preferred):** runtime `https://bedrock-runtime.ap-south-1.amazonaws.com`; auth AWS SigV4 (assumed IAM role preferred) or Bedrock API key; IAM `bedrock:InvokeModel` on the Qwen ARN; enforce ZDR org-wide via an SCP denying any `DataRetentionMode` other than `none`.

### 4.5 Risks
DPDP Rules are young — SDF designation could later force localization (self-host future-proofs the protected lane); Vertex India is "in-region ML processing," not a contractual at-rest residency SLA (get it in the DPA); Bedrock Claude-in-India defaults to **global** routing — use Qwen3 in-region + ZDR for protected; self-host ops is the real cost for a small team (budget an MLOps owner or managed-vLLM); **validate Tamil on real grievance text** before locking the model.

---

## 5. External messaging providers

### 5.1 Context find — TN already has a government WhatsApp channel
Tamil Nadu launched **"Namma Arasu"** (8 Jan 2026, TNeGA + Meta, bilingual, +91 7845 252525, 51 services incl. grievance filing/tracking). TNeGA already holds a **verified government WABA** and cleared Meta Business verification + template approval for citizen services. **Recommendation: onboard Whistle's utility templates under TNeGA's existing WABA** rather than spin up a parallel one — skips fresh verification and rides an established Meta government relationship.

### 5.2 SMS (TRAI DLT)
- **Primary: NIC SMS Gateway** (`sms.gov.in` / `smsgw.sms.gov.in`) — the sanctioned government channel, TCCCPR-compliant, MeitY/NIC-operated, the same plumbing other TN departments use. **Fallback: MSG91** (cleanest API/webhooks) or **Tanla/Karix** (vendor-managed DLT + TRAI reporting).
- **DLT onboarding (~2 weeks):** Principal Entity registration (KYC, ≤7 days) → transactional **header** (e.g. `TNGRVN`, ≤2 days) → **content-template** registration (each topic × Tamil + English) → real-time scrubbing means an unregistered template is blocked.
- **Reg-35 exemption:** state-government citizen-centric messaging is exempt from the ≤5-paise **terminating** charge (apply at `smsheader.trai.gov.in/exemption` after KYC + header). Confirm with TRAI that **whistleblower** copy qualifies — it's a committee judgment call.
- **Cost:** ~₹0.12–0.25 / SMS (aggregator), volume-dependent; **Tamil (Unicode) caps at 70 chars/segment** vs 160 for English → budget bilingual Tamil SMS at ~2–3× segments. One-time DLT setup ~₹5–6k PE + header.

### 5.3 WhatsApp (Meta WhatsApp Business Platform, 2026)
- **Path:** reuse **TNeGA WABA** (preferred); else **Gupshup BSP** (India-dominant, Tamil, also an SMS vendor → one throat to choke) or **Cloud API direct** (lowest per-msg cost, you own verification/ops). On-prem API is deprecated — everyone is on Cloud API.
- **Templates:** nearly every Whistle event is **Utility** (ticket submitted/verified/info-requested/routed/escalated/resolved/SLA/reopened). **Utility inside an open 24-hr customer-service window is free.** Authentication category only for OTP; **never Marketing.** Since 9 Apr 2025 Meta **auto-recategorizes** marketing-looking "utility" templates and bills the higher rate — keep copy strictly transactional. Tamil + English are **separate language versions** of the same template.
- **Pricing (2026, per-message since Jul 2025; INR billing since Jan 2026):** Utility ≈ **₹0.145/msg** (free in CSW), Authentication ≈ ₹0.145 (some sources ₹0.13), Marketing ≈ ₹1.09 (avoid). BSP markup ~₹0.10–0.30/msg and/or ~₹1,500/mo platform fee. Tamil costs the same as English on WhatsApp (per-message, not per-segment).
- **Opt-in:** Meta requires explicit opt-in before any template; capture WhatsApp consent as a distinct unbundled checkbox at ticket creation.
- **Protected tickets:** **hard-excluded from WhatsApp** (already enforced) — even a utility template leaks to Meta that a number received a message from the grievance entity. Protected → in-app + minimal SMS only.

### 5.4 Compliance
DPDP consent unbundled per channel + easy opt-out; the Section 17 state exemption does **not** cascade — every vendor (NIC/aggregator/BSP) needs a **Section 8(5) processor agreement** with purpose limitation, security, deletion, breach notice, and **content+PII-in-India** residency. Sending without opt-in breaches Meta policy + DPDP + TCCCPR simultaneously.

### 5.5 Messaging credentials (exact items)
- **NIC SMS Gateway:** base `https://smsgw.sms.gov.in` (per-department account); auth NIC-issued **username + password / API key**; NIC-assigned DLT **header**; NIC **template IDs** mapped to DLT templates. *Exact API path/auth/rate limits are issued at onboarding — request the NIC integration guide.*
- **MSG91 (fallback):** `https://control.msg91.com/api/v5/flow/` (or v2 `/api/v2/sendsms`); auth `authkey` header; params `sender` (DLT header), `DLT_TE_ID` (template), `route=4` (transactional), `country=91`; delivery webhook in panel.
- **Gupshup (WhatsApp BSP):** `https://api.gupshup.io/wa/api/v1/msg` (+ `/sm/api/v1/template/msg`); auth `apikey` header; identity `app_name`, `userid`, `source` (business number); template IDs approved via console → Meta; callback URL for inbound + delivery.
- **WhatsApp Cloud API (direct):** `https://graph.facebook.com/<vXX>/<PHONE_NUMBER_ID>/messages`; auth **System-User permanent token** (Bearer); need **WABA ID** + **Phone Number ID**; webhook answering `hub.challenge` with a Verify Token, subscribed to `messages` + status events.

---

## 6. Public transparency architecture

- **Aggregate projection:** the public endpoint reads a **governed aggregate projection** (materialized view / read-model), never raw PII tables. Keep the existing delay + small-cell + protected-exclusion logic; **promote `PUBLIC_CELL_THRESHOLD` to a governed control** and add a category-exposure list.
- **Reconciliation (exit-criterion #1):** a scheduled worker recomputes public aggregates from the internal source and asserts they tie within tolerance; on drift it raises an alert and can **auto-pause** (`feature-public=false`). This is the main net-new infra for this item.
- **Scale path:** Postgres materialized views in MVP2; defer a ClickHouse/warehouse to a later phase only if public query volume demands it (per V1 council — avoid a premature data platform).
- **Methodology + freshness:** a static bilingual methodology page + "data as of" timestamp rendered from the projection's generation time.

---

## 7. Briefs architecture

- **Scheduling:** a worker cron (Postgres-outbox job, consistent with the spine's existing worker model) generates daily/weekly briefs per role+scope, caches the latest run, and hands a digest to the **notification service** for in-app (optionally email) delivery. Keeps the existing scope enforcement (minister → own ministry).
- **Recommend-only preserved:** the brief writes only its run record + audit; an "acted-on" recommended action routes through the **ticket spine** decision endpoint (audited there), never the brief.
- **Usefulness metrics:** capture brief opens + link a recommended action to the subsequent real decision → a usefulness signal per role.
- **Optional LLM narrative:** the summary/headline can be model-generated via the **same LLM gateway** (managed lane — briefs are aggregate, non-protected), but **KPIs stay deterministic** (never model-computed). Same structured-output + fallback rules as §3.4.

---

## 8. Security, compliance & trust zones

- **Agentic zone:** reads governed projections only; no mutation; prompt + output audited; protected inputs confined to the self-host lane; the service has no ticket-write credential.
- **Public transparency zone:** no raw tables; privacy thresholds; delayed; auto-pause on drift.
- **Data residency two-lane:** protected → in-India self-host; bulk → in-region managed with ZDR/no-train. Get residency/no-train commitments in the DPA.
- **RLS everywhere:** new reads (projections) and writes (`agent_*` tables, brief runs, notification status) carry RLS; a cross-scope access test per new route (audit test: role A cannot see role B's data).
- **Secrets:** LLM keys, provider keys, WABA tokens in KMS/Vault; never in env files committed to the repo; rotation policy.
- **DPDP:** consent ledger, processor agreements, residency, deletion rights; consent-manager provisions phase in by 13 Nov 2026 — build consent capture migration-ready.

---

## 9. MVP2 build sequencing (roadmap)

**Gate 0 — MVP1 GREEN (hard prerequisite).** No MVP2 surface ships to citizens/officials until MVP1 launch gates pass. MVP2 build happens behind feature flags in parallel.

| Phase | Work | Exit gate |
|---|---|---|
| **2.a — Agent foundations** | Stand up the Python/FastAPI + LangGraph service skeleton; `LLMGateway` interface + deterministic fallback wired; Postgres checkpointer; prompt registry; eval harness + golden set; `feature-agent-intake` flag; data-model additions | Agent service runs the intake graph end-to-end on the **deterministic** path through the new service, returns a schema-valid `IntakeAgentRecommendation`, spine persists via `recordAgentRun`, all non-mutation smokes green |
| **2.b — Agentic intake → model** *(the meat)* | Self-host Sarvam-M lane (protected) + managed lane (bulk); PII redaction; structured-output validation; pgvector dedup; human-review surface in verification console; feedback loop + metrics | Model clears the golden-set bar (esp. protected recall); human-in-the-loop accept/edit/reject live; degraded-mode fallback proven; zero ability to mutate state |
| **2.c — Notification productionization** | DLT registration + template registry (topic×lang→template ID); NIC SMS (+ MSG91 fallback); WhatsApp via TNeGA WABA / Gupshup; consent/opt-out ledger; delivery receipts + idempotent retry; Tamil QA | Real provider live + falls closed when unconfigured; protected WhatsApp hard-block tested; opt-out enforced pre-send; receipts update status |
| **2.d — Public transparency hardening** | Reconciliation job + alert/auto-pause; configurable threshold control; category-exposure control; bilingual methodology + disclaimer sign-off | Public counts reconcile within tolerance; Admin can pause visibility + category exposure |
| **2.e — Briefs scheduling + metrics** | Worker cron + cached briefs; digest via notification service; usefulness metrics; period deltas; optional LLM narrative | Scheduled briefs delivered without manual trigger; usefulness measured; scope isolation intact |

**Long poles:** 2.b (agent service + model + eval) and 2.c (DLT + provider + consent onboarding, ~2–3 weeks of external lead time). Start DLT registration and the TNeGA WABA conversation early — they're calendar-bound, not code-bound. 2.d and 2.e can run in parallel with 2.b once 2.a lands.

---

## 10. Credential & config summary (exact URL · token type · scope)

| System | Endpoint / URL | Auth / token | Scope / IDs to collect |
|---|---|---|---|
| Sarvam API (bulk lane) | `https://api.sarvam.ai/v1/chat/completions` | `api-subscription-key` header | dashboard key; ₹1,000 free credits |
| Vertex Gemini (bulk lane) | `https://asia-south1-aiplatform.googleapis.com/v1/projects/<PROJECT_ID>/locations/asia-south1/publishers/google/models/gemini-2.5-flash-lite:generateContent` | OAuth Bearer (service account) | IAM `roles/aiplatform.user`; Project ID; SA JSON key; region `asia-south1`; ZDR exception |
| Bedrock Qwen3 (alt bulk) | `https://bedrock-runtime.ap-south-1.amazonaws.com` | AWS SigV4 / Bedrock API key | `bedrock:InvokeModel` on Qwen ARN; SCP enforcing `DataRetentionMode=none` |
| Self-host Sarvam-M (protected) | internal vLLM endpoint (in-India GPU) | internal mTLS / network policy | IndiaAI/MeitY GPU; Apache-2.0 weights |
| NIC SMS Gateway (SMS primary) | `https://smsgw.sms.gov.in` | NIC username+password / API key | DLT header (`TNGRVN`); NIC template IDs; *request integration guide* |
| MSG91 (SMS fallback) | `https://control.msg91.com/api/v5/flow/` | `authkey` header | `sender` header, `DLT_TE_ID`, `route=4`, `country=91` |
| Gupshup (WhatsApp BSP) | `https://api.gupshup.io/wa/api/v1/msg` | `apikey` header | `app_name`, `userid`, `source` number; template IDs; callback URL |
| WhatsApp Cloud API (direct) | `https://graph.facebook.com/<vXX>/<PHONE_NUMBER_ID>/messages` | System-User permanent token (Bearer) | WABA ID; Phone Number ID; webhook Verify Token |
| Notification webhook seam (existing) | `WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL` | `WHISTLE_NOTIFICATION_PROVIDER_API_KEY` (Bearer) | already in code; points at the chosen provider adapter |

*All secrets in KMS/Vault, not committed. Provider/processor (DPDP §8(5)) agreements required before production.*

---

## 11. Risks & open decisions

1. **Data-residency sign-off** (PO + legal) — confirm the two-lane posture; get no-train/ZDR/residency into vendor DPAs.
2. **TNeGA WABA reuse** — confirm multi-app/number policy with TNeGA before assuming it.
3. **Reg-35 exemption** for whistleblower SMS — confirm with TRAI.
4. **Agent acceptance bar** — set the precision/protected-recall thresholds that gate prod enablement (PO + verification lead).
5. **Self-host ops capacity** — staff an MLOps owner or use managed-vLLM; don't under-resource serving/patching/security.
6. **Tamil model validation** — benchmark Sarvam-M vs alternatives on real Tamil grievance text before locking.
7. **Checkpoint DB isolation** — LangGraph checkpoints in a separate schema/DB from the spine; no shared write credential.

---

## 12. References (key sources, 2025–2026)

- DPDP Act 2023 §16 negative-list + Rules 2025 (notified 13–14 Nov 2025); SDF localization Rule 13(4).
- Sarvam-M (Apache-2.0) + Sarvam API pricing/residency; UIDAI on-prem precedent; TN + IIT-M "Digital Sangam" Sovereign AI Park; IndiaAI GPU subsidy (~₹67–150/hr); MeitY empanelment (AWS/Azure/Google India regions).
- Vertex AI India in-region ML processing + ZDR + Training Restriction §17; Bedrock data-retention modes (`none`) + Qwen3 in ap-south-1; Azure OpenAI ZDR gating.
- TN "Namma Arasu" WhatsApp launch (TNeGA + Meta, Jan 2026); TRAI TCCCPR/DLT (PE/header/template) + Reg-35 govt exemption; NIC SMS Gateway (sms.gov.in).
- Meta WhatsApp Business Platform: per-message pricing (Jul 2025), INR billing (Jan 2026), utility ≈ ₹0.145 / marketing ≈ ₹1.09, template categories + auto-recategorization (Apr 2025), opt-in policy.

*(Full annotated source URLs are in the research backing this doc — request the research appendix if you want them inlined.)*

---

*Companion: [whistle-mvp2-spec.md](./whistle-mvp2-spec.md) — PO/BA requirements, user stories, acceptance criteria, exit gates.*
