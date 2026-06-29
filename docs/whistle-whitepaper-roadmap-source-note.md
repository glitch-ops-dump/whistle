# Whistle Whitepaper And Roadmap Source Note

## Purpose Of This Note

This note summarizes the Whistle product discussion for use in the final product whitepaper and project roadmap. It captures decisions, product direction, government operating model assumptions, prototype work completed, open questions, and wording that should be preserved.

This is a source note, not final whitepaper prose.

## Core Decisions Made

- Whistle is a citizen complaint and whistleblower platform for Tamil Nadu.
- Citizen-facing access should support PWA, Android, and iOS.
- Government-side products should not be treated as one generic dashboard for every role.
- Admin must be an independent console, not a role or tab inside the government operations dashboard.
- The government dashboard must not expose `State Administrator` or `Admin` navigation.
- Teams are the main access primitive for government access control.
- Individual users may belong to multiple teams with different roles, scopes, and expiry.
- Admin changes in the prototype are simulated only and recorded in an in-session audit log.
- Admin must manage users, teams, access, permissions, app-wide controls, audit, setup health, and SLA policy.
- Admin must not include operational ticket queues, heatmaps, ministry performance, rejection workbench, protected complaint review, or CM escalation workspace.
- SLA configuration must be available in Admin at each lifecycle level.
- SLA configuration should be a dedicated Admin tab, not buried inside App Controls.
- Current SLA configuration depth should be stage defaults, not a full category/geography override matrix.

## Product Vision Points

- Whistle should give citizens a clear way to raise civic and corruption-related complaints and track what happens next.
- Citizens should see ticket status, queue level, SLA deadline, escalation history, and privacy/protection messaging.
- Government users should be able to verify, route, monitor, escalate, audit, and resolve complaints.
- The system should make accountability visible across SLA stage, ministry, department, district, city, constituency, ward, and owner.
- The platform must preserve citizen trust through identity masking, protected corruption handling, and clear notification language.
- The product should distinguish command, oversight, and execution workflows instead of forcing every role into one dashboard pattern.

## Government Operating Model Decisions

- Every active ticket should have one primary queue.
- Escalated tickets should preserve secondary visibility for prior owners.
- Local/MLA tickets escalate to ministry when local SLA breaches or department authority is needed.
- Ministry tickets escalate to CM Cell when ministry SLA breaches or state-level intervention is needed.
- Rejected tickets must enter a CM-maintained rejection review process.
- Protected corruption complaints should bypass normal local visibility until screened by CM Cell or authorized vigilance-level users.
- Reporter identity should be masked for unauthorized roles.
- Evidence access should be separable from ticket metadata access.
- Every production action should be authenticated, audited, and state-changing only through proper workflow controls.

## Access And Team Model

- CM Cell access may include multiple users and teams.
- CM Cell access may include statewide oversight, protected queue access, rejection review, directive authority, and command-level intervention.
- Minister access includes one minister plus minister office/team members.
- Minister teams are scoped to one or more ministries or departments with different permissions.
- MLA access is scoped to constituency.
- MLA offices may appoint staff or councillors to their team to allocate local work.
- MLA-appointed users must remain constrained to constituency/local scope.
- Local/councillor access is scoped to ward, panchayat, municipality, corporation zone, or local body.
- Department officer teams may be assigned by ministry, department, district, field office, or ticket category.
- Temporary direct grants are allowed only for exceptional/acting access and should appear in audit/setup health.

## Surfaces And Apps Discussed

### Citizen Surfaces

- Citizen PWA.
- Android app.
- iOS app.
- Citizen responsibilities: submit complaints, add evidence, track status/SLA, respond to information requests, understand privacy/protection state.

### Admin Surface

- Independent Admin Console.
- Manages users, teams, access, permissions, SLA policy, app-wide controls, audit, and setup health.
- Current prototype URL: `admin.html`.
- Standalone export: `exports/standalone/whistle-admin-console.html`.

### Government Operations Surfaces

- CM Cell Dashboard: statewide command center.
- Ministry/Minister Dashboard: portfolio accountability and ministry execution oversight.
- MLA Dashboard: constituency control room.
- Councillor/Local Field Workbench: daily local execution, visits, evidence, closure.
- Department Officer Workbench: assignments, field reports, action notes, resolution/escalation.
- Verification/Intake Console: category/location/evidence validation, duplicate detection, info requests, routing/rejection.
- Rejection Review Console: CM-maintained review of rejected complaints.
- Protected/Vigilance Workbench: controlled handling for corruption or sensitive complaints.
- Public Transparency Portal: aggregate statistics only, no personal details or raw sensitive evidence.
- Communications/Notification controls: citizen and government templates, channels, languages, sensitive-content warnings.

## Dashboard vs Workbench Principle

Preserve this distinction in the whitepaper:

- CM Cell is a command center.
- Ministry is an execution/accountability board.
- MLA is a constituency control room.
- Councillor/local owner is a field workbench.
- Department officer is an execution workbench.
- Verification is an intake triage bench.
- Rejection review is an audit bench.
- Admin is a system control console.

The system should not describe every government role as just another dashboard.

## SLA Decisions

- Admin must configure SLAs at each lifecycle level.
- Current selected approach: stage-level defaults.
- Current selected navigation: dedicated Admin `SLA` tab.
- SLA stages to configure:
  - Verification.
  - Local / MLA.
  - Ministry.
  - CM Cell.
  - Rejection Review.
  - Protected Screening.
- SLA rows should include duration, warning threshold, pause rule, breach action, and primary owner.
- SLA edits should update audit history and setup health.
- App Controls should retain non-SLA controls such as privacy, protected complaint policy, notifications, languages/channels, feature flags, maintenance mode, and public aggregate visibility.
- Existing documented defaults include Verification at 2 days, Local/MLA at 7 days, Ministry at 10 days, with CM Cell and Rejection Review currently state-configured.

## Roadmap / Phase Ideas

### Phase 1: Prototype Consolidation

- Preserve separate Admin Console.
- Add dedicated SLA tab to Admin.
- Keep Admin mock-only.
- Keep government dashboard free of Admin role/navigation.
- Strengthen role-specific prototype language around command center vs workbench surfaces.

### Phase 2: Role-Specific Government Surfaces

- Separate CM Cell, Ministry, MLA, Councillor/Local, Department Officer, Verification, Rejection Review, and Protected/Vigilance experiences.
- Prioritize role-specific workflows over shared generic dashboard components.
- Ensure each surface shows only scoped queues, actions, and data visibility.

### Phase 3: Policy And Access Model Hardening

- Define production RBAC/team model.
- Define temporary access grants and expiry.
- Define protected complaint access rules.
- Define SLA policy model and audit requirements.
- Define notification safety rules.

### Phase 4: Production Workflow Foundation

- Add real authentication and MFA for government users.
- Add backend persistence.
- Add audit log persistence.
- Add SLA escalation jobs.
- Add notification delivery integrations.
- Add evidence storage and access controls.

### Phase 5: Public Trust And Reporting

- Add public aggregate transparency views.
- Add analytics by ministry, district, category, SLA status, and escalation level.
- Ensure public reporting never exposes citizen identity or sensitive evidence.

## Risks, Constraints, And Unresolved Questions

### Prototype Constraints

- Current prototype is mock-only.
- No real authentication.
- No backend persistence.
- No real MFA.
- No SMS/WhatsApp delivery.
- No Aadhaar/Govt ID integration.
- No production GIS, department, or case-management integration.
- Prototype admin changes are local/in-session only.

### Product Risks

- A generic dashboard pattern can dilute role clarity.
- MLA and councillor workflows can become too similar unless local field execution is separated from constituency oversight.
- Verification and rejection review need workbench-first design to avoid becoming generic risk dashboards.
- Protected corruption handling needs strict identity and evidence controls.
- Admin could become overloaded if operational ticket review leaks into it.
- Public transparency must not expose personal data or sensitive evidence.

### Open Questions

- Exact SLA duration for CM Cell.
- Exact SLA duration for Rejection Review.
- Exact SLA duration for Protected Screening.
- Whether awaiting-citizen time pauses SLA, counts separately, or continues counting.
- Whether category-level SLA overrides should be added after stage defaults.
- Whether geography/ministry-specific SLA overrides are needed later.
- Final production policy for Aadhaar/Govt ID, if adopted at all.
- Final identity visibility rules for MLAs, ministers, CM Cell, verification, and rejection review.
- Final rules for MLA-appointed councillor/staff access.

## Files, Prototypes, And Docs Created Or Changed

### Created

- `admin.html`
- `src/admin-main.tsx`
- `src/AdminConsole.tsx`
- `src/admin-console.css`
- `scripts/export-admin.mjs`
- `exports/standalone/whistle-admin-console.html`

### Changed

- `src/GovDashboard.tsx`
  - Removed `State Administrator` role and Admin dashboard navigation.
  - Kept government dashboard focused on operations/ticket oversight.
- `src/gov-dashboard.css`
  - Removed embedded admin styling and admin-mode leftovers.
- `vite.config.ts`
  - Added Admin as a standalone Vite build input.
- `package.json`
  - Added `export:admin`.
- `docs/whistle-state-dashboard-requirements.md`
  - Updated requirements to define Admin as an independent console.
  - Added Admin de-scope from operational dashboards.
  - Preserved acceptance criteria that `dashboard.html` must not expose Admin or State Administrator.

### Existing Relevant Docs

- `docs/whistle-product-spec.md`
- `docs/whistle-state-dashboard-requirements.md`
- `docs/whistle-dashboard-ux-review.md`

### Existing Relevant Prototypes

- Citizen app prototype.
- Government dashboard prototype.
- CM Cell mockup.
- Ministry mockup.
- Independent Admin Console prototype.

## Validation Already Performed

- `npm run build` passed after independent Admin implementation.
- `npm run export:admin` produced `exports/standalone/whistle-admin-console.html`.
- `npm run export:dashboard` regenerated `exports/standalone/whistle-dashboard.html`.
- Browser verification confirmed `dashboard.html` no longer exposes Admin or State Administrator.
- Browser verification confirmed `admin.html` opens the independent Admin Console.
- Manual prototype flow verified: invite user, create team, assign membership, grant CM access, toggle protected identity policy, change SLA default, edit notification template, and see audit/risk updates.

## Wording To Preserve In Final Whitepaper

Preserve these ideas clearly:

- Admin is an independent control console, not an operational dashboard.
- Teams are the main access primitive.
- A user can belong to multiple teams with different scopes and roles.
- Escalated tickets preserve secondary visibility for prior owners.
- Rejected tickets always flow into CM-maintained review.
- Protected corruption complaints bypass local visibility until screened.
- Public or aggregate views must never show citizen identity or raw sensitive evidence.
- Not every government role is a dashboard; some are command centers and some are workbenches.
- CM Cell is the statewide command center.
- Ministry is the execution/accountability board.
- MLA is the constituency control room.
- Councillor/local owner is the field workbench.
- Verification is the intake triage bench.
- Rejection review is the audit bench.
- Admin configures users, teams, access, permissions, SLAs, app-wide controls, audit, and setup health.
- SLA is tracked at every ownership level and across total ticket age.
- Prototype behavior is simulated and must not be described as production persistence.

## Recommendations Clearly Marked

The following were discussed as product direction but should be marked as recommendations unless formally accepted into scope:

- Add a Public Transparency Portal for aggregate complaint and SLA statistics.
- Add a dedicated Protected/Vigilance Workbench.
- Add a dedicated Department Officer Workbench separate from ministry oversight.
- Add category/geography/ministry-specific SLA override rules after stage defaults are stable.
- Treat communications/notification configuration as a strong Admin module, even if it remains under App Controls.
