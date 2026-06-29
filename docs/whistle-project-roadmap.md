# Whistle Project Roadmap: The Government Readiness Model

Date: 2026-05-31

Status: Strategic roadmap for program planning, stakeholder alignment, and phased execution.

## Executive Summary

Whistle should not be launched as only a mobile app. It should be launched as a government operating model with software attached.

The first public version must prove that the state can receive complaints, verify them, route them to accountable owners, track SLAs, escalate delays, protect sensitive identity, review rejections, and explain dashboard counts. Public transparency and agentic workflows are powerful, but they should begin only after the core operating system is stable.

Recommended launch principle:

> V1 proves operational accountability. V2 adds intelligence and public transparency. V3 deepens field execution. V4 scales advanced governance.

The companion technical recommendation is captured in `docs/whistle-technical-architecture-proposal.md`. Its core conclusion is that Whistle should be built first as a secure ticket spine and verifiable accountability ledger, using a V1 modular-monolith architecture before adding public analytics, agentic services, or deeper field-operation complexity.

## Open Source And Asset Governance

Whistle's original code and original documentation are released under the MIT License. This supports reuse by Tamil Nadu, other Indian states, civic technologists, public institutions, and other countries that may want to adapt the accountability model for public benefit.

The MIT License applies only to original Whistle software and documentation. It does not grant rights over third-party images, public figures' likenesses, state emblems, government emblems, seals, department marks, official logos, or any other protected identity material used in prototypes.

V0 readiness must therefore include an asset and identity review:

- Confirm which prototype images, portraits, emblems, and logos can be used publicly.
- Replace or remove any asset that is not approved for public or production use.
- Keep citizen and public transparency APIs from returning logo, emblem, or portrait URLs until the matching Admin approvals are complete.
- Preserve a clear notice that prototype imagery and the project's civic intent do not imply government endorsement, political authorization, affiliation, or official approval.
- Keep the public-interest and open-source intent visible while respecting copyright, trademark, publicity, and official-use rules.

## Version Roadmap

### V0: Readiness And Pilot Setup

Purpose: make the government machinery real before public launch.

Deliverables:

- Launch-readiness matrix by complaint category.
- Admin-configured master setup for ministries, departments, constituencies, MLA teams, CM Cell users, verification users, SLA rules, role scopes, and category toggles.
- Corruption/protected category decision: enabled, disabled, or protected-only based on SOP readiness.
- Internal pilot with mock users or limited real users.
- Training plan for Verification, MLA, minister teams, CM Cell, and Admin.

Exit criteria:

- Every enabled category has an owner, SLA, escalation path, and trained queue.
- CM Cell can see statewide load and escalations.
- Admin can explain every dashboard count, role scope, SLA rule, and category toggle.
- Sensitive categories have approved SOPs or remain disabled/controlled.
- Internal pilot users can submit, verify, route, escalate, and track tickets end to end.

### V1: Core Accountability Launch

Purpose: launch the minimum complete Whistle operating model.

Launch surfaces:

- Citizen mobile PWA.
- Verification Console.
- MLA Dashboard.
- Minister Dashboard.
- CM Cell Dashboard.
- Admin Console.

Core scope:

- Citizen complaint submission, phone verification model, ticket tracking, status timeline, SLA visibility, privacy messaging, and clarification requests.
- Verification intake for completeness, category, location, duplicates, evidence, protected/sensitive flags, request-info, rejection, and routing.
- MLA constituency queue with due-soon issues, escalation risk, and tickets escalated out but still visible.
- Minister assigned-ministry-only dashboard with district performance, SLA risk, field bottlenecks, and CM escalation risk.
- CM Cell statewide command view with ministry/district KPIs, escalations, rejection-review visibility, and protected queue visibility where enabled.
- Admin management for users, teams, role scopes, ministry/constituency mappings, SLA configuration, privacy/category toggles, notification templates, audit, and setup health.

V1 exclusions:

- No public Transparency Portal.
- No autonomous agentic decision-making.
- No broad corruption launch unless SOPs and protected handling are ready.
- No Department Officer or Councillor/Local Field Workbench as separate full products.
- No native Android/iOS in V1; native apps are planned for V2 after PWA workflow validation.

Exit criteria:

- Citizens can submit and track tickets through the core lifecycle.
- Verification can route, request information, reject, and mark protected cases.
- MLA, minister, and CM Cell views show only appropriate role-scoped data.
- SLA breaches move upward according to configured rules.
- Admin can configure users, teams, role access, SLA defaults, category toggles, and privacy settings.
- Rejected tickets enter CM-maintained review.
- Protected identity is masked for unauthorized roles.

### V2: Intelligence And Public Transparency

Purpose: improve trust, prioritization, public accountability, and citizen reach after V1 workflow stabilizes.

Add:

- Native Android and iOS apps built from the validated V1 citizen workflow.
- Public Transparency Portal with aggregate-only data.
- Public metrics by category, district, ministry, SLA performance, resolution rate, and trend.
- Public dashboard on/off controls and threshold rules in Admin.
- Recommend-only agentic layer for intake classification, missing-info detection, duplicate/cluster suggestions, routing recommendations, rejection guardrails, SLA risk summaries, and CM/ministry daily briefs.
- Better notification templates for SMS, WhatsApp, and in-app updates.

Agentic rule:

- Agents do not own lifecycle state.
- The ticket system owns states, queues, SLAs, RBAC, audit, and notifications.
- Agents produce recommendations, reasons, confidence, risk flags, and draft messages.
- Humans approve routing, rejection, protected handling, and escalations until measured performance supports narrower automation.

Exit criteria:

- Public transparency data matches internal aggregate counts.
- Public reporting cannot expose personal identity, phone number, raw evidence, or sensitive corruption details.
- Native apps preserve the same ticket lifecycle, privacy rules, evidence controls, and API contracts as the PWA.
- Agent outputs are schema-valid, explainable, logged, and reviewable.
- Agent recommendations cannot directly mutate ticket state.
- Admin can disable public visibility or categories if policy requires it.

### V3: Field Execution And Department Operations

Purpose: move from oversight to real closure workflows.

Add:

- Department Officer / Field Office Workbench.
- Councillor / Local Field Workbench.
- Field visit scheduling.
- Before/after evidence capture.
- Owner assignment and workload balancing.
- Transfer-with-reason workflow.
- Closure readiness checklist.
- Citizen reopen/dispute flow.
- Stronger analytics by owner, district, department, field team, recurring category, and closure quality.
- Integrations with existing government grievance, department, or field-service systems where required.

Exit criteria:

- Local and department teams can manage daily work from queues, not only view dashboards.
- Field visits and evidence are attached to ticket history.
- Closure decisions are auditable and explainable to citizens.
- Reopen/dispute rates are tracked.
- Integrations do not break Whistle's source-of-truth SLA and audit model.

### V4: Advanced Governance And Scale

Purpose: mature Whistle into a statewide accountability platform.

Add:

- Advanced protected corruption/vigilance workflow if legally and operationally approved.
- Aadhaar or government ID category-specific verification only where policy requires it.
- Cross-system integrations.
- Data warehouse and long-term analytics.
- Monitoring, audit exports, and compliance reporting.
- AI-assisted policy simulation for SLA changes, category rollout impact, and staffing bottlenecks.
- Kiosks, helpdesks, and call-center assisted filing.

Exit criteria:

- Sensitive workflows have approved legal, operational, and audit controls.
- Data warehouse counts reconcile with operational systems.
- Identity verification rules are category-specific and policy-approved.
- Multi-channel intake still preserves one ticket lifecycle, one SLA model, and one audit trail.

## V1 Product Scope

| Surface | V1 purpose | V1 must include |
| --- | --- | --- |
| Citizen PWA | Complaint submission and status tracking | Raise complaint, category, details, location, evidence, phone verification model, ticket list, ticket detail, add-more-info, privacy/SLA status. |
| Verification Console | Intake quality and routing | Completeness check, category/location correction, duplicate candidates, evidence review, request-info, reject, route, protected flag. |
| MLA Dashboard | Constituency oversight | Local queue, due-soon risk, escalation risk, escalated-out visibility, constituency trends. |
| Minister Dashboard | Assigned ministry accountability | Assigned-ministry-only data, district performance, SLA risk, bottlenecks, CM escalation risk. |
| CM Cell Dashboard | Statewide command | Ministry/district KPIs, escalations, rejection review, protected visibility where enabled, decision queues. |
| Admin Console | Governance and setup | Users, teams, access, permissions, SLA defaults, category toggles, privacy policy, notifications, audit/setup health. |

## Launch-Readiness Matrix

Before public launch, every enabled category should be reviewed against this matrix.

| Category | Enabled in V1 | Primary owner | SLA | Escalation path | Role access | Public visibility | Privacy level | SOP status | Training status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Roads | Yes | Local/MLA, then relevant ministry | 2d verification, 7d local, 10d ministry | Local/MLA -> Ministry -> CM Cell | Verification, MLA, Minister, CM Cell | V2 aggregate only | Identity masked | Required | Required |
| Water | Yes | Local/MLA, then MAWS | 2d verification, 7d local, 10d ministry | Local/MLA -> Ministry -> CM Cell | Verification, MLA, Minister, CM Cell | V2 aggregate only | Identity masked | Required | Required |
| Power | Yes | Local/MLA, then energy department/ministry | 2d verification, 7d local, 10d ministry | Local/MLA -> Ministry -> CM Cell | Verification, MLA, Minister, CM Cell | V2 aggregate only | Identity masked | Required | Required |
| Sanitation | Yes | Local/MLA, then relevant ministry | 2d verification, 7d local, 10d ministry | Local/MLA -> Ministry -> CM Cell | Verification, MLA, Minister, CM Cell | V2 aggregate only | Identity masked | Required | Required |
| Public Safety | Conditional | Verification-approved owner | State-configured | Verification -> Approved authority -> CM Cell | Restricted by policy | V2 aggregate only with thresholds | Higher sensitivity | Required before enablement | Required |
| Corruption | Configurable | Protected/CM Cell-approved workflow | State-configured | Protected screening -> CM Cell/protected authority | Restricted | No raw public visibility | Protected | Mandatory before enablement | Mandatory |
| Other | Conditional | Verification determines owner | State-configured | Verification -> Assigned owner -> Escalation path | Role-scoped | V2 aggregate only | Identity masked | Required | Required |

The matrix should be maintained by Admin and reviewed before each category expansion.

## Role And Team Setup

Teams are the main access primitive. Individual users may belong to multiple teams with different roles, scopes, and expiry.

Required V1 setup:

- CM Cell team: statewide command, escalation oversight, rejection-review visibility, protected visibility where enabled.
- Verification team: intake queue, category/location/evidence review, request-info, reject, route, protected flag.
- Minister teams: scoped to assigned ministries only. No all-ministry access for a minister unless specifically granted by CM Cell/Admin policy.
- MLA teams: scoped to constituency. MLA-appointed staff or councillors remain constrained to constituency/local scope.
- Admin team: system configuration only. Admin must not become an operational ticket review surface.

Admin should track:

- Duplicate or excessive grants.
- Expired acting access.
- Teams without owners.
- Ministries or constituencies without assigned teams.
- Protected identity exposure.
- SLA stages missing owner, duration, or breach action.

## SLA And Escalation Model

Whistle's SLA model should be simple at launch and become more configurable after data is available.

V1 defaults:

| Stage | Default | Primary owner | Breach action |
| --- | ---: | --- | --- |
| Verification | 2 days | Verification Team | Supervisor/CM visibility or escalation per policy |
| Local / MLA | 7 days | Councillor/local owner with MLA visibility | Escalate to ministry |
| Ministry | 10 days | Department/ministry | Escalate to CM Cell |
| CM Cell | State-configured | CM Cell | Command intervention |
| Rejection Review | State-configured | CM-maintained team | Quality audit escalation |
| Protected Screening | State-configured | Protected/CM Cell-approved team | Restricted escalation |

Rules:

- Every active ticket has exactly one primary queue.
- Escalated tickets retain secondary visibility for prior owners.
- SLA tracking includes current-stage age and total ticket age.
- Awaiting-citizen time must be explicitly configured as paused, counted separately, or counted continuously.
- Category/geography/ministry SLA overrides should wait until stage defaults are working reliably.

## Rollout And Training Plan

### Internal Readiness

- Configure ministries, departments, constituencies, teams, roles, categories, SLAs, and privacy defaults.
- Run tabletop exercises for each ticket path.
- Validate counts and dashboard explanations with Admin and CM Cell.
- Train Verification first, because every ticket quality issue begins there.

### Controlled Pilot

- Launch with limited categories and selected geographies or ministries.
- Use real workflow discipline, even if public volume is controlled.
- Review verification accuracy, routing quality, SLA breaches, rejection reasons, and escalation paths daily.

### Public V1 Launch

- Launch PWA with enabled categories only.
- Communicate what citizens can expect: reference ID, status, SLA visibility, escalation, privacy, and response requests.
- Avoid promising instant resolution.
- Avoid making corruption the launch centerpiece unless protected SOPs are ready.

### V2 Expansion

- Add public aggregate transparency after internal and operational counts reconcile.
- Add recommend-only agents after verification and routing data is stable.
- Add notification channels and public dashboard controls.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Public launch before government readiness | Require V0 readiness matrix and pilot exit criteria before V1. |
| Corruption reports create safety or legal risk | Make corruption configurable and protected. Enable only with SOPs, role controls, and audit. |
| Generic dashboards dilute role clarity | Preserve command center, execution board, control room, workbench, triage bench, audit bench, and Admin console distinctions. |
| Rejection becomes a suppression point | Route all rejections into CM-maintained review and track reversal patterns. |
| SLA pressure creates superficial closure | Add resolution notes, evidence, reopen/dispute in V3, and closure-quality analytics. |
| Public transparency leaks sensitive details | Use aggregate-only reporting, privacy thresholds, Admin controls, and no raw evidence or identity. |
| Agents overstep governance | Keep agents recommend-only in V2 and prevent direct lifecycle mutation. |
| Admin becomes operationally overloaded | Keep Admin separate from ticket queues, heatmaps, protected review, and CM escalation workspaces. |

## Acceptance Criteria By Phase

### V0

- Readiness matrix exists for every category considered for launch.
- Admin setup exists for users, teams, roles, ministries, constituencies, SLAs, categories, and privacy controls.
- Training materials and SOPs exist for every enabled queue.
- Internal pilot proves end-to-end ticket movement.

### V1

- V1 includes only the core launch surfaces: Citizen PWA, Verification Console, MLA Dashboard, Minister Dashboard, CM Cell Dashboard, and Admin Console.
- Transparency Portal and agentic layer are not part of V1.
- Corruption is configurable/protected and not treated as the public launch centerpiece.
- Role-scoped dashboards do not leak unrelated ministry, constituency, or protected identity data.
- Every V1 ticket has a stage, owner, SLA status, primary queue, and audit trail.

### V2

- Transparency Portal is aggregate-only and reconciles with internal counts.
- Agentic recommendations are logged, reviewable, and unable to directly mutate lifecycle state.
- Admin can control public visibility and category exposure.

### V3

- Department and local field teams can execute work, not only view it.
- Field evidence, transfer reasons, closure readiness, and reopen/dispute are part of the workflow.
- Closure quality can be measured.

### V4

- Advanced governance, identity, and integrations are policy-approved and auditable.
- Data warehouse and audit exports reconcile with operational source-of-truth records.
- Multi-channel filing preserves one ticket lifecycle and one SLA model.

## Final PM Recommendation

Use the following sequencing:

1. V0: readiness, setup, SOPs, training, pilot.
2. V1: core accountability launch with PWA, Verification, MLA, Minister, CM Cell, and Admin.
3. V2: native Android/iOS apps, transparency, and recommend-only intelligence.
4. V3: field execution and department operations.
5. V4: advanced governance and statewide scale.

This sequencing keeps Whistle credible. It launches the accountability promise only after the government operating model is prepared, then expands into transparency, intelligence, and scale once the system can explain and defend its own data.
