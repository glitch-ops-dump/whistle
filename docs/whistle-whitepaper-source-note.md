# Whistle Whitepaper And Roadmap Source Note

Date: 2026-05-31

Status: Source note for final product whitepaper and project roadmap. This is not the final whitepaper copy.

## 1. Core Decisions Made

- Product name: `Whistle`.
- Meaning of name: refers to a whistleblower and to citizens "blowing the whistle" on civic issues.
- Primary citizen purpose: allow any citizen to raise complaints about corruption, bad roads, water issues, power issues, sanitation, public safety, and other civic problems.
- The product uses a Tamil Nadu-oriented design premise. Chief Minister, ministry, MLA, local body, and verification roles are configurable prototype roles, not factual claims or endorsements.
- The citizen-facing app must support Tamil and English.
- The visual theme should use yellow and red.
- Some campaign-service material is acceptable, but the product must still feel like a serious government service.
- Citizen reports are private by default.
- Public visibility must be limited to aggregated metrics and summaries, not citizen identities, phone numbers, evidence, or sensitive raw ticket details.
- The first prototype emphasis shifted to the citizen mobile app, then separate government dashboard mockups were explored.
- The citizen endpoint must feel like a mobile app, not a responsive website.
- The standalone HTML exports are important because the prototypes need to work by opening a file directly.
- Government dashboards must be role-specific. A single generic dashboard shape for all roles diluted the purpose.
- The Tamil Nadu district heatmap is a strong and valuable idea for CM Cell and ministry-level views.
- Ministers with 2 or 3 portfolios must only see information related to their assigned ministries. There must be no "all ministries" view for a minister role.

## 2. Product Vision Points

- Whistle should become a trusted civic accountability platform for Tamil Nadu citizens.
- Citizens should be able to submit issues quickly with enough evidence and location context for government teams to act.
- Citizens should continuously see where their ticket is: verification, local/MLA level, ministry level, CM Cell, rejected review, awaiting citizen, resolved, or closed.
- The app should reduce citizen uncertainty by showing SLA clocks, queue ownership, escalation path, and notification history.
- The platform should make government accountability measurable through queue age, SLA breaches, escalation rates, district performance, ministry performance, and rejection review quality.
- Corruption complaints require a protected handling path with stronger confidentiality language and stricter identity visibility controls.
- Government users should see what they need for their level of responsibility, not an undifferentiated statewide dashboard.
- The final product should communicate that execution and accountability are the point: raise issue, route correctly, track SLA, escalate when needed, close with evidence.

## 3. Government Operating Model Decisions

### Ticket Intake And Verification

- All new tickets first enter a Ticket Verification Team queue.
- Verification should check completeness, category, location, duplicate status, and evidence quality.
- Verification SLA target discussed: 2 days.
- If data is incomplete or incorrect, the ticket is sent back to the citizen for additional data and can be resubmitted.
- Incorrect or low-quality tickets can be rejected, but rejected tickets must be reviewed by a separate team maintained directly by the CM Cell.
- Rejection review is a guardrail against improper filtering or suppression.

### Routing And SLA Ladder

- After verification, normal civic tickets route to local/councillor or MLA-level ownership.
- Local/MLA-level SLA target discussed: 1 week.
- If not addressed within local/MLA SLA, the ticket escalates to the relevant ministry.
- Ministry-level SLA target discussed: 10 days.
- If not addressed within ministry SLA, the ticket escalates to CM Cell.
- Escalated tickets retain secondary visibility in the previous queue.
- Example: after escalation from MLA/local to ministry, the ministry becomes the primary queue and MLA/local remains a secondary queue.
- Example: after escalation from ministry to CM Cell, CM Cell becomes the primary queue and ministry remains a secondary queue.

### Role Goals

- CM Cell primary goal: overview of all ministries, district/ministry KPIs, and handling escalations.
- Ministry primary goal: ensure efficient action across all districts under that ministry.
- MLA/Councillor primary goal: close local issues without escalation.
- Ticket Verification Team primary goal: clear intake within SLA and route correctly.
- Rejection Review Team primary goal: independently review rejected tickets and reverse improper rejections.
- Admin/system operator goal: manage users, teams, roles, SLA policy, privacy policy, notification templates, and configuration.

### Visibility And Privacy

- Citizen personal details should be protected by default.
- State-level configuration should decide whether ministers can see personal data.
- Protected corruption tickets should bypass councillor/local visibility until screened by CM Cell or vigilance-level users.
- Public insights must never expose identity, phone number, raw evidence, or corruption-sensitive details.
- Future policy option: Aadhaar or government ID can be mandated for selected categories, but this is not part of v1 prototype behavior.

## 4. Surfaces And Apps Discussed

### Citizen Mobile App

- Purpose: raise complaints and track ticket progress.
- Required feel: fixed mobile app experience, native-like navigation, screen-by-screen flow, bottom tabs, compact content, and intuitive complaint submission.
- Core screens discussed or prototyped:
  - Home
  - Raise complaint
  - Category selection
  - Department/routing step
  - Details
  - Location
  - Evidence upload mock
  - OTP mock
  - Review
  - Confirmation
  - My Tickets
  - Ticket Detail
  - Add More Info
  - Insights
- Citizen complaint categories discussed:
  - Corruption
  - Roads
  - Water
  - Power
  - Sanitation
  - Safety/Public Safety
  - Health
  - Education
  - Revenue
  - Ration/PDS
  - Other
- Insights decision:
  - Insights should have two tabs: Trends and Open issues.
  - Trends should support month and all-time views.
  - Open issues should show department/city-wise counts.
  - Open issue counts should be inflated enough to look realistic for statewide civic operations.

### State-Side Government Dashboard

- Purpose: desktop web dashboard for managing tickets, KPIs, SLA breaches, escalation, protected corruption reports, and ministry accountability.
- English-first UI for prototype.
- Red/yellow campaign-forward visual identity, with official operations-console restraint.
- A neutral civic service mark should be used in the public open-source shell unless official marks are separately authorized for a deployment.
- It must remain separate from the citizen mobile app.
- Role switching was used in the general dashboard prototype, but later UX review concluded role-specific mockups are clearer.

### CM Cell Mockup

- Purpose: independent CM Cell command center mockup.
- Menu sections requested:
  - Overview
  - State heatmap
  - Ministry
  - Tickets
- Tickets page should default filter to CM Cell.
- Layout decision: left-side menu improves available space.
- Each page should fit within a single screen where possible, using scroll only where necessary.
- CM Cell should focus on statewide overview, all ministries, escalations, district heatmap, ministry performance, and CM Cell ticket queue.

### Ministry-Level Mockup

- Purpose: independent ministry execution dashboard.
- Minister name added for mockup: `Thiru. K. Arulmozhi Selvan`.
- Assigned portfolios in mockup:
  - Municipal Administration & Water Supply
  - Rural Development & Panchayat Raj
  - Food and Civil Supplies
- Minister dashboard must show only assigned portfolios, not all ministries.
- All KPIs, heatmaps, ticket queues, field actions, and operating plan content must change based on selected assigned ministry.
- Ministry dashboard sections:
  - Overview
  - Districts
  - SLA queue
  - Field action
- Ministry dashboard core question: which districts and owners under this ministry are failing SLA and need intervention before CM Cell escalation?

### Admin Console

- Discussed in requirements as a separate governance/configuration surface.
- Purpose: user/team access, role grants, SLA configuration, privacy policy, protected category rules, notification templates, and audit/setup health.

## 5. Roadmap Or Phase Ideas

These are drawn from the discussion and current prototype progression.

### Phase 1: Clickable Citizen Prototype

- Build a mobile-first citizen app prototype.
- Include bilingual Tamil/English UI for core flows.
- Use mock OTP, mock evidence upload, mock ticket data, and mock notification indicators.
- Include ticket status, SLA ladder, queue ownership, add-more-info flow, protected corruption messaging, and public aggregated insights.
- Produce standalone HTML that can be opened directly.

### Phase 2: State Dashboard Foundations

- Build desktop government dashboard prototype.
- Use mock statewide data across Tamil Nadu districts, ministries, departments, roles, queues, and SLA states.
- Include role switching for demo purposes.
- Validate heatmap, queue, ticket detail, protected corruption masking, and KPI drilldown concepts.

### Phase 3: Role-Specific Government Mockups

- Split generic dashboard into role-specific operating consoles.
- Start with CM Cell command center.
- Build ministry-level execution board.
- Later build MLA/Councillor local closure views, Ticket Verification workbench, and Rejection Review audit bench.
- Preserve different screen purposes by role instead of only changing labels.

### Phase 4: Productization Planning

- Convert prototypes into a production architecture plan.
- Define backend ticket model, audit model, queue assignment model, SLA engine, privacy rules, notification system, authentication, role-based access control, and data retention policy.
- Decide identity policy: phone OTP only, government ID, Aadhaar for mandated categories, or configurable hybrid.
- Define evidence handling, corruption protection workflow, and appeal/reopen policy.

### Phase 5: Pilot And Governance

- Pilot with limited categories and geographies.
- Validate verification quality, SLA configurations, rejection review, escalation behavior, and citizen trust.
- Tune role dashboards based on actual government operating cadence.

## 6. Risks, Constraints, And Unresolved Questions

### Risks

- Political identity can overwhelm the service purpose if campaign material is too prominent.
- Role dashboards can become confusing if every role uses the same layout.
- Public insights can accidentally expose sensitive details if drilldowns are too granular.
- Rejection can become a suppression point without strong independent review.
- Protected corruption reports create higher safety, privacy, legal, and operational risk.
- SLA metrics can create pressure to close tickets superficially unless resolution evidence and citizen dispute flows exist.
- Bad routing can create SLA failure even when field teams are responsive.
- A minister with multiple ministries must not see unrelated ministry data.

### Constraints

- Current prototypes use mock data only.
- No production authentication, OTP, SMS, WhatsApp, Aadhaar, database, backend API, or government integration exists in v1.
- Official portrait and government emblem usage must be legally and factually cleared before production.
- The Chief Minister role remains a configurable prototype role. Any named office-holder or public-figure reference must be verified and approved before production use.
- Tamil Nadu district boundary data is cached locally for prototype heatmap use.
- Direct source entry files such as `ministry.html` need Vite to run; standalone exported HTML files are the safer sharing format.

### Unresolved Questions

- Which categories require identity verification beyond phone OTP?
- Whether Aadhaar or another government ID should be mandatory for any category.
- Whether ministers can see citizen personal data, and under what state policy.
- Whether citizens can appeal rejection directly or only submit a new complaint.
- Whether citizens can dispute or reopen resolved tickets.
- Exact SLA durations by category, severity, geography, and department.
- Exact corruption/vigilance workflow and who can see protected reporter identity.
- Production role hierarchy and whether MLA/councillor users have direct action powers or only visibility/escalation powers.
- Whether campaign imagery should remain in production or only in prototype/pilot communication.

## 7. Files, Prototypes, And Docs Created Or Changed

Artifacts present in the workspace and relevant to this discussion:

- `docs/whistle-product-spec.md`
  - Product specification covering citizen app, government operating model, ticket lifecycle, SLA model, privacy, and prototype scope.
- `docs/whistle-state-dashboard-requirements.md`
  - State-side dashboard requirements covering roles, queues, dashboards, and admin console.
- `docs/whistle-dashboard-ux-review.md`
  - Independent UX review explaining why one generic dashboard diluted role clarity and recommending role-specific homes.
- `exports/standalone/whistle-workable.html`
  - Standalone citizen mobile app prototype.
- `src/App.tsx`
  - React citizen app source.
- `src/styles.css`
  - Citizen app styling.
- `dashboard.html`
  - Vite entry for state dashboard prototype.
- `src/GovDashboard.tsx`
  - General government dashboard source.
- `src/gov-dashboard.css`
  - General dashboard styling.
- `exports/standalone/whistle-dashboard.html`
  - Standalone state dashboard export.
- `cm-cell.html`
  - Vite entry for CM Cell mockup.
- `src/CmCellMockup.tsx`
  - CM Cell mockup source.
- `src/cm-cell-mockup.css`
  - CM Cell mockup styling.
- `exports/standalone/whistle-cm-cell-mockup.html`
  - Standalone CM Cell mockup export.
- `ministry.html`
  - Vite entry for ministry mockup, with direct-file redirect to standalone export.
- `src/MinistryMockup.tsx`
  - Ministry-level mockup source, including portfolio-scoped minister access.
- `src/ministry-mockup.css`
  - Ministry mockup styling.
- `src/ministry-main.tsx`
  - Ministry mockup React entrypoint.
- `scripts/export-dashboard.mjs`
  - Standalone exporter for dashboard.
- `scripts/export-cm-cell.mjs`
  - Standalone exporter for CM Cell mockup.
- `scripts/export-ministry.mjs`
  - Standalone exporter for ministry mockup.
- `exports/standalone/whistle-ministry-console.html`
  - Standalone ministry console export.
- `public/assets/brand/whistle-fake-logo.svg`
  - Neutral Whistle prototype logo asset.
- `public/assets/brand/whistle-civic-mark.svg`
  - Neutral civic service mark used instead of official emblems.
- `public/assets/brand/whistle-service-portrait.svg`
  - Neutral service portrait illustration used instead of public-figure imagery.
- `public/assets/data/tamil-nadu-districts.geojson`
  - Whistle-owned schematic sample grid used by dashboard heatmaps. It is not official boundary or GIS data.
- `screenshots/`
  - Visual QA screenshots captured during prototype iteration.

Additional workspace artifacts present:

- `admin.html`
- `src/AdminConsole.tsx`
- `src/admin-console.css`
- `src/admin-main.tsx`
- `scripts/export-admin.mjs`
- `exports/standalone/whistle-admin-console.html`

These align with the admin/configuration surface described in the state-side requirements.

## 8. Wording To Preserve In Final Whitepaper

Use or preserve the substance of these points:

- "Whistle is a citizen complaint and whistleblower platform for Tamil Nadu."
- "Citizens can raise issues about corruption, roads, water, power, sanitation, public safety, and other civic problems."
- "Citizen reports are private by default."
- "Public insights expose aggregated civic metrics, not reporter identities or sensitive evidence."
- "Every ticket has a visible SLA ladder from verification to local/MLA ownership, ministry escalation, and CM Cell escalation."
- "Rejected tickets are independently reviewed by a CM-maintained rejection review team."
- "Corruption reports follow a protected track with stronger confidentiality and masked identity."
- "Escalated tickets remain visible in secondary queues so previous owners retain accountability."
- "CM Cell is responsible for statewide oversight, ministry accountability, and escalation handling."
- "Ministries are responsible for efficient action across all districts under their assigned portfolio."
- "MLAs and councillors are responsible for closing local issues before escalation."
- "A minister with multiple portfolios sees only assigned ministries, never an all-ministry view."
- "The prototype uses mock data only and does not include production authentication, backend routing, SMS, WhatsApp, Aadhaar, or database integrations."
- "The Chief Minister role is a configurable prototype role and must not be presented as an endorsement or factual public-figure claim unless independently confirmed and approved."

## 9. Recommendations Marked As Recommendations

The following are recommendations, not final decisions:

- In the final whitepaper, separate political/campaign energy from the service guarantee. The service guarantee should lead.
- Use the district heatmap prominently for CM Cell and ministry views, but avoid making it the default for MLA, councillor, verification, or rejection review roles.
- Treat role-specific dashboards as separate products sharing one ticket model, not as one dashboard with labels swapped.
- Add a formal "trust and privacy" section to the whitepaper, covering identity masking, protected corruption handling, public insight limits, and auditability.
- Add an implementation architecture section only after backend, identity, notification, and evidence-storage decisions are made.
