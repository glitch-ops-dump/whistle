# Whistle State-Side Dashboard Requirements

## 1. Purpose

The Whistle state-side dashboard is the government operations console for monitoring citizen complaints, SLA performance, escalations, protected corruption reports, rejection quality, and ministry accountability across Tamil Nadu.

The dashboard must help government users answer five questions quickly:

- What is breaking SLA right now?
- Which ministry, department, district, city, constituency, or ward owns the delay?
- Which tickets need immediate intervention?
- Which rejected tickets may have been wrongly filtered out?
- Which protected corruption reports need controlled, high-trust handling?

This document covers the full state-side requirements. The current prototype is a clickable, mock-data version and is not a production authentication, workflow, notification, or case-management system.

## 2. Product Surfaces

### 2.1 State Dashboard Web App

Primary surface:
- Desktop web dashboard for government users.
- English-first UI for the prototype.
- Campaign-forward red/yellow visual identity with official government-service restraint.
- Neutral civic service mark and Whistle identity in the public open-source shell.

Prototype URLs:
- Development route: `dashboard.html`
- Standalone export: `exports/standalone/whistle-dashboard.html`

### 2.2 Relationship to Citizen App

The citizen mobile app and state dashboard are separate surfaces connected by the same ticket model.

Citizen app responsibilities:
- Raise complaints.
- Add evidence and references.
- Track status, SLA, and queue level.
- Respond to additional information requests.
- See privacy and protection messaging.

State dashboard responsibilities:
- Verify, route, monitor, escalate, audit, and resolve complaints.
- Provide role-scoped visibility.
- Protect citizen identity according to state policy.
- Monitor SLA health across every government level.

## 3. User Roles

### 3.1 CM Cell

Scope:
- Statewide oversight across all departments, districts, categories, and escalation levels.

Can see:
- All civic tickets.
- CM Cell primary queue.
- Protected corruption queue.
- Rejection review outcomes.
- Cross-department escalation history.
- Reporter identity only where state policy permits.

Core jobs:
- Monitor statewide SLA breaches.
- Intervene in escalated tickets.
- Issue directives.
- Review ministry and district performance.
- Track protected corruption complaints.
- Track rejection reversals and verification quality.

### 3.2 Department Minister

Scope:
- Statewide oversight for assigned ministry or department portfolio.

Can see:
- Department/ministry queues.
- Tickets escalated from local/MLA level.
- Tickets escalated onward to CM Cell as secondary visibility.
- SLA breach clusters by district, city, constituency, and category.

Restrictions:
- Protected corruption identity hidden unless explicitly enabled by state policy.
- Cannot suppress escalation history.

Core jobs:
- Monitor department-level SLA performance.
- Identify district-level blockers.
- Issue department-level directives.
- Track repeated local body failures.

### 3.3 Department Officer / Ministry Queue

Scope:
- Operational queue for a ministry, board, department, or assigned officer group.

Can see:
- Tickets assigned to that department.
- Due-soon and breached items.
- Field-owner updates.
- Secondary visibility when tickets move upward.

Core jobs:
- Assign field officers.
- Request field reports.
- Add action notes.
- Resolve or recommend closure.
- Escalate when dependency or SLA risk requires it.

### 3.4 MLA

Scope:
- Constituency-level visibility.

Can see:
- Civic tickets in constituency.
- Local SLA breaches.
- Tickets escalated to ministry but still visible as secondary queue.
- Department-wise bottlenecks within constituency.

Restrictions:
- Protected corruption reports are hidden or masked below approved level.
- Citizen identity masked unless state policy permits.

Core jobs:
- Monitor constituency service delivery.
- Push local owners for action.
- Track escalations to ministry.
- See recurring department failures in the constituency.

### 3.5 Councillor / Local Owner

Scope:
- Ward, panchayat, municipality, corporation zone, or local body area.

Can see:
- Non-protected local civic tickets.
- Primary local queue.
- Tickets escalated upward where local owner keeps secondary visibility.

Restrictions:
- Protected corruption complaints hidden until screened by CM Cell/vigilance-level users.
- Citizen identity masked by default.

Core jobs:
- Accept local assignment.
- Update status.
- Add field visit notes.
- Add before/after evidence.
- Resolve within local SLA.
- Transfer with reason where routing is incorrect.

### 3.6 Ticket Verification Team

Scope:
- New submissions and resubmissions.

Can see:
- Submitted tickets.
- Awaiting citizen response tickets.
- Category/location correction queue.
- Duplicates and incomplete submissions.
- Protected reports during initial screening.

Core jobs:
- Complete verification within 2 days.
- Validate completeness, category, location, evidence, and duplicate status.
- Request additional citizen information.
- Route verified tickets to the correct level.
- Reject with structured reason.
- Mark protected corruption reports and route to protected queue.

### 3.7 CM-Maintained Rejection Review Team

Scope:
- Independent review of rejected tickets.

Can see:
- All rejected tickets.
- Rejection reason.
- Verification officer/team.
- Citizen evidence summary.
- Rejection patterns by geography, category, and verifier.

Core jobs:
- Confirm valid rejection.
- Reverse incorrect rejection and route ticket.
- Flag verification quality issues.
- Identify repeated local filtering abuse.
- Recommend verification policy updates.

### 3.8 Admin Console Operator

Scope:
- Independent system configuration and governance console, separate from the government operations dashboard.

Can see:
- Users, teams, access grants, permission profiles, app-wide SLA/privacy/protection policy, notification templates, feature flags, and admin audit/setup health.
- Ministries, departments, constituencies, wards, and local bodies only as access-scope/catalog values.

Core jobs:
- Invite/deactivate users.
- Create teams and assign memberships.
- Grant CM Cell, minister team, MLA team, local owner, verification, rejection review, and admin access.
- Configure SLA durations.
- Configure role permissions and sensitive-data visibility.
- Configure Aadhaar/Govt ID required categories if adopted later.
- Configure corruption protection rules.
- Configure global app controls and notification templates.
- Review admin audit history and setup risks.

## 4. Core Ticket Lifecycle

### 4.1 Submitted

Primary queue:
- Ticket Verification Team.

Default SLA:
- 2 days.

Dashboard requirements:
- Show verification age.
- Highlight due-today and breached verification tickets.
- Show completeness checklist.
- Show citizen-supplied category, location, evidence, and references.

### 4.2 Awaiting Citizen Information

Primary queue:
- Citizen action needed, monitored by Ticket Verification Team.

Dashboard requirements:
- Show missing information fields.
- Show when request was sent.
- Show whether SLA is paused, running, or state-configured.
- Return ticket to verification when citizen resubmits.

### 4.3 Rejected

Primary state:
- Rejected by verification team.

Mandatory review:
- Every rejected ticket enters CM-maintained Rejection Review.

Dashboard requirements:
- Rejection reason must be structured.
- Rejection officer/team must be visible to review users.
- Rejection quality metrics must be tracked.
- Reversed rejections must be reported as a KPI.

### 4.4 Verified and Routed Locally

Primary queue:
- Councillor/local owner or relevant local department.

Secondary visibility:
- MLA or constituency dashboard where applicable.

Default SLA:
- 7 days.

Dashboard requirements:
- Show local owner.
- Show MLA/constituency context.
- Show local SLA timer.
- Highlight tickets due in 48 hours.
- Escalate to ministry when SLA breaches.

### 4.5 Escalated to Ministry

Primary queue:
- Department/ministry.

Secondary queue:
- MLA/local owner retains visibility.

Default SLA:
- 10 days.

Dashboard requirements:
- Show origin queue and breach reason.
- Show primary/secondary queue labels.
- Show department owner and ministry owner.
- Preserve local-level timeline and accountability.
- Escalate to CM Cell when ministry SLA breaches.

### 4.6 Escalated to CM Cell

Primary queue:
- CM Cell.

Secondary queue:
- Ministry retains visibility.

Dashboard requirements:
- Show ministry breach history.
- Show cross-department blockers.
- Show all prior owner notes.
- Show directive and escalation controls.
- Track CM-level aging separately from total ticket age.

### 4.7 Resolved and Closed

Primary queue:
- Closed/resolved archive.

Dashboard requirements:
- Show resolution note.
- Show before/after evidence if available.
- Show total age and time spent at each level.
- Show reopen/dispute status if introduced later.

## 5. SLA and Queue Rules

### 5.1 SLA Stages

| Stage | Default SLA | Primary Owner | Breach Outcome |
| --- | ---: | --- | --- |
| Verification | 2 days | Ticket Verification Team | Supervisor / CM visibility |
| Local / MLA | 7 days | Councillor/local owner with MLA visibility | Escalate to ministry |
| Ministry | 10 days | Department/ministry | Escalate to CM Cell |
| CM Cell | State configured | CM Cell | Command intervention |
| Rejection Review | State configured | CM-maintained team | Quality audit escalation |

### 5.2 Primary Queue Rule

Every active ticket must have exactly one primary queue.

Examples:
- New ticket: primary queue is Ticket Verification.
- Local ticket: primary queue is Councillor / Local Owner.
- Ministry-escalated ticket: primary queue is Ministry.
- CM-escalated ticket: primary queue is CM Cell.

### 5.3 Secondary Queue Rule

Tickets may have multiple secondary queues.

Examples:
- Local ticket escalated to ministry:
  - Primary: Ministry.
  - Secondary: MLA and local owner.
- Ministry ticket escalated to CM Cell:
  - Primary: CM Cell.
  - Secondary: Ministry.

Secondary queues must be read-visible but not allowed to hide, delete, or suppress escalation history.

### 5.4 SLA Labels

Required dashboard labels:
- On track.
- Due today.
- Due in 48h.
- Breached.
- Awaiting citizen.
- Escalated.
- Resolved.

Required metrics:
- Current-stage age.
- Total ticket age.
- Time spent per level.
- SLA remaining.
- Breach duration.
- Escalation count.
- Primary queue.
- Secondary queue list.

## 6. Dashboard Information Architecture

### 6.1 Global Shell

Header:
- Whistle logo.
- Neutral civic service mark unless official emblem use is authorized for the deployment.
- Role switcher.
- Date range filter.
- Current role badge.

Navigation:
- Overview.
- Heatmap.
- Tickets.
- Ministries.
- Rejections.
- Protected Queue.

Persistent ticket workspace:
- Ticket details may appear as a right-side case workspace on desktop.
- Queue rows and KPI cards should open or update the workspace.

### 6.2 CM Cell Overview

Must show three first-class modules above the fold:
- SLA breach command center.
- Tamil Nadu district heatmap.
- Ministry / department performance.

KPI cards:
- Open tickets.
- SLA breached.
- Due today.
- Due in 48h.
- Escalated to CM Cell.
- Average age.
- Rejection reversals.
- Protected corruption count.

KPI behavior:
- KPI card click opens the filtered ticket queue.
- KPI filters must remain visible after drilldown.
- Dashboard must clearly show active role and active geography filter.

### 6.3 Heatmap

Requirements:
- Show all 38 Tamil Nadu districts.
- Use actual district boundaries in production.
- Prototype may use locally cached district GeoJSON.
- Support metric switching:
  - Open ticket count.
  - SLA breach count.
  - Escalation rate.
  - Average age.

District click behavior:
- Select district.
- Update district detail panel.
- Filter queue to district.
- Preserve role visibility rules.

District detail panel:
- Open tickets.
- SLA breached.
- Due in 48h.
- Top department.
- Escalation count.
- Protected count if role can see it.

### 6.4 Tickets Queue

Required filters:
- Primary queue.
- Secondary visibility.
- SLA breached.
- Due soon.
- Protected.
- Rejected review.
- Resolved.
- Category.
- Department/ministry.
- District.
- City.
- Constituency.
- Ward.
- Owner.
- Search by ticket ID.

Queue row fields:
- Ticket ID.
- Title.
- Category.
- Department/ministry.
- District/city/constituency/ward.
- Primary queue.
- Secondary queues.
- SLA label.
- Privacy label.
- Priority.

Queue row behavior:
- Click opens ticket detail.
- View must not expose protected identities to unauthorized roles.
- View must show if the role has secondary visibility only.

### 6.5 Ticket Detail Workspace

Required sections:
- Ticket summary.
- Category and priority.
- Reporter visibility.
- Location and geography hierarchy.
- Department/ministry ownership.
- Primary queue.
- Secondary queues.
- SLA ladder.
- Escalation history.
- Timeline.
- Evidence placeholders.
- Rejection review status if applicable.
- Privacy policy state.
- Role permissions.
- Audit trail.

Role-specific action controls:
- CM Cell: assign, issue directive, escalate, reverse rejection, request audit.
- Minister: assign officer, request field report, escalate to CM Cell, resolve.
- Officer: request info, update field status, recommend closure, escalate.
- MLA: comment, request local action, monitor escalation.
- Councillor/local owner: accept, comment, request citizen info, mark field visit, resolve.
- Verification: route, request info, reject with reason, mark protected.
- Rejection review: reverse rejection, confirm rejection, send to CM Cell, close audit.

Prototype rule:
- Actions are visible but disabled/view-only.

Production rule:
- Actions must mutate ticket state through authenticated, audited APIs.

### 6.6 Ministries View

Required metrics by department/ministry:
- Open tickets.
- SLA breached.
- Due soon.
- CM escalated.
- Protected count where permitted.
- Average age.
- Resolution rate.
- Trend versus prior period.

Required drilldowns:
- Ministry -> department -> district -> ticket.
- Ministry -> SLA breach -> owner -> ticket.
- Ministry -> category -> geography -> ticket.

### 6.7 Rejections View

Required metrics:
- Rejected tickets.
- Reversed rejections.
- Confirmed rejections.
- Rejection rate by verifier/team.
- Rejection rate by category.
- Rejection rate by district/city.
- Repeated duplicate/incomplete reasons.

Required capabilities:
- Review rejection reason.
- Compare citizen evidence summary.
- Reverse rejection and route.
- Flag verification quality issue.
- Identify suspicious rejection clusters.

### 6.8 Protected Queue

Purpose:
- Handle corruption and sensitive complaints without exposing citizen identity to unauthorized local actors.

Requirements:
- Protected corruption tickets bypass councillor/local department visibility until screened.
- Reporter identity masked below allowed roles.
- Evidence previews masked where necessary.
- Access must be audited.
- Role must see why data is hidden.
- CM Cell/vigilance users can review protected queue.

## 7. Drilldown Requirements

The dashboard must support these drilldown paths:

- State -> ministry -> department -> district -> city -> constituency -> ward -> ticket.
- State -> district -> city -> constituency -> ward -> department -> ticket.
- State -> SLA status -> SLA stage -> owner -> ticket.
- State -> protected queue -> screening state -> ticket.
- State -> rejection queue -> rejection reason -> verifier/team -> ticket.
- State -> category -> geography -> queue level -> ticket.

Each drilldown must preserve:
- Date range.
- Role permissions.
- Active filters.
- Privacy masking.
- Primary/secondary queue distinction.

## 8. KPI Requirements

### 8.1 Statewide KPIs

Required:
- Total open tickets.
- New tickets today.
- Verified today.
- Awaiting citizen information.
- SLA breached.
- Due today.
- Due in 48h.
- Local-level breaches.
- Ministry-level breaches.
- CM Cell escalations.
- Average ticket age.
- Average current-stage age.
- Rejection reversals.
- Protected corruption count.
- Resolution rate.
- Reopen/dispute count when introduced.

### 8.2 Role-Specific KPIs

Each role must see KPIs scoped to its jurisdiction.

Examples:
- Councillor: ward open, due today, breached, resolved this week.
- MLA: constituency open, local breaches, ministry escalations, department blockers.
- Minister: department statewide load, district breach ranking, CM escalations.
- CM Cell: statewide breach command, protected queue, rejection quality, ministry ranking.
- Verification: intake backlog, 2-day breaches, info requests, rejection rate.
- Rejection Review: pending review, reversed rejections, confirmed rejections, verifier flags.

## 9. Privacy and Identity Requirements

### 9.1 Default Privacy

Citizen personal details must be protected by default.

Public or aggregate surfaces must never show:
- Citizen name.
- Phone number.
- Address unrelated to complaint location.
- Raw evidence.
- Sensitive corruption details.

### 9.2 Role-Based Visibility

Identity visibility must be configurable by state policy.

Minimum defaults:
- Councillor/local owner: identity masked.
- MLA: identity masked.
- Department officer: identity masked unless needed and configured.
- Department minister: identity masked unless configured.
- Verification team: identity visible for intake operations.
- Rejection review: identity visible if needed for audit.
- CM Cell/protected users: identity visible where policy permits.

### 9.3 Protected Corruption Flow

Protected reports must:
- Avoid local visibility until screened.
- Mask identity in all unauthorized dashboard views.
- Show protected badge.
- Record every access.
- Separate evidence access from ticket metadata access.

## 10. Configuration Requirements

Admin console operators must be able to configure:
- SLA duration by stage.
- SLA duration by category.
- SLA pause rules for awaiting citizen information.
- Escalation rules.
- Role visibility rules.
- Protected category rules.
- Rejection review rules.
- Department/category routing.
- District/city/constituency/ward master data.
- Notification templates.
- Public aggregation rules.
- Identity verification policy.

Future identity options:
- Phone OTP default.
- Aadhaar/Govt ID requirement for selected categories if state policy mandates it later.

### 10.1 Independent Admin Console Prototype

The clickable prototype must include an independent Admin Console at `admin.html`, exported as `exports/standalone/whistle-admin-console.html`. It must use a distinct control-console layout and must not appear as a role or navigation item inside `dashboard.html`. The console is mock-only and must not implement real authentication, database persistence, MFA, Aadhaar integration, SMS, or backend access-control APIs.

Admin information architecture:
- Users: invite/deactivate users, show MFA/status, select a user, and view team memberships plus access expiry.
- Teams: create teams, assign users to teams, set role within team, and show owner/status.
- Access: manage effective access by role and scope for CM Cell, minister team, MLA team, local owner, verification, rejection review, and admin.
- Permissions: configure allowed actions and sensitive data visibility per role/team, including protected queue and reporter identity.
- App Controls: configure global SLA defaults, privacy/identity policy, protected complaint rules, notification templates, language/channel settings, feature flags, maintenance mode, and public aggregate visibility.
- Audit & Health: show in-session admin audit trail and setup risks.

Explicit de-scope:
- No ticket queue, heatmap, ministry performance, CM escalation workspace, rejection workbench, or protected complaint review inside Admin.
- Ministries, constituencies, wards, departments, and local bodies appear only as access-scope/catalog values, not as operational dashboards.

Admin access model:
- Teams are the primary access primitive.
- Users may belong to multiple teams with different roles and expiry dates.
- Individual direct grants are allowed only for temporary or exceptional cases and must appear in audit/setup health.
- Effective access preview must show the selected user's ministries, constituencies/local scopes, queues, protected data visibility, reporter identity visibility, and allowed actions.

Required admin scenarios:
- CM Cell access supports multiple users and teams, including protected queue, rejection review, directive authority, and statewide oversight.
- Minister access supports one minister plus minister team members, each scoped to one or more ministries/departments with different permissions.
- MLA access is scoped to constituency and supports MLA staff/team members plus secondary visibility after escalation.
- Local/councillor access is scoped to ward, panchayat, municipality, corporation zone, or local body.
- Department officer teams can be assigned by ministry, department, district, field office, or ticket category scope values.
- Admin changes append to an in-session audit log with actor, action, timestamp, and before/after summary when applicable.
- Setup health flags duplicate admin grants, expired access, exposed protected identity, missing team owner, incomplete app-wide policy, and unsafe direct grants.

## 11. Alerts and Notifications

Dashboard alerts:
- SLA breached.
- Due today.
- Due in 48h.
- High protected queue age.
- Rejection spike.
- Department breach spike.
- District breach spike.
- Repeated local owner delay.
- Ticket stuck at same level too long.

Citizen notifications triggered by dashboard state:
- Verified and routed.
- Additional information requested.
- Rejected.
- Rejection reversed.
- Escalated to ministry.
- Escalated to CM Cell.
- Resolved.
- Closed.

Notification constraints:
- SMS/WhatsApp must not include sensitive evidence.
- Corruption-sensitive details must be avoided in external notifications.
- Citizen should always see current stage and next expected action.

## 12. Audit and Governance

Every dashboard action must be audited.

Audit fields:
- Ticket ID.
- Actor ID.
- Actor role.
- Department/ministry.
- Timestamp.
- Previous state.
- New state.
- Previous queue.
- New queue.
- SLA impact.
- Reason code.
- Free-text note if supplied.
- Evidence access event where applicable.

Audit views:
- Ticket-level audit trail.
- User-level action history.
- Department action history.
- Rejection audit history.
- Protected queue access log.

## 13. Data Model Requirements

### 13.1 GovTicket

Required fields:
- Ticket ID.
- Title.
- Description.
- Category.
- Status.
- Priority.
- Created timestamp.
- Reporter ID.
- Reporter visibility mode.
- Verification method.
- Department.
- Ministry.
- District.
- City.
- Constituency.
- Ward/panchayat.
- Current owner.
- Primary queue.
- Secondary queues.
- SLA state.
- Current SLA deadline.
- Total age.
- Current-stage age.
- Escalation count.
- Protected flag.
- Evidence references.
- Timeline events.
- Rejection review state.

### 13.2 QueueAssignment

Required fields:
- Ticket ID.
- Queue ID.
- Queue type.
- Owner role.
- Owner organization.
- Primary or secondary.
- Assigned timestamp.
- SLA deadline.
- Exit timestamp.
- Exit reason.

### 13.3 SlaStage

Required fields:
- Stage name.
- Owner role.
- SLA limit.
- Start timestamp.
- Due timestamp.
- Exit timestamp.
- State.
- Breach duration.

### 13.4 GeoMetric

Required fields:
- District.
- City.
- Constituency.
- Ward/panchayat.
- Open count.
- Breach count.
- Due today count.
- Due in 48h count.
- Escalation count.
- Average age.
- Top department.
- Protected count where authorized.

### 13.5 DepartmentMetric

Required fields:
- Department.
- Ministry.
- Open count.
- Breach count.
- Due soon count.
- CM escalated count.
- Average age.
- Resolution rate.
- Rejection count where relevant.
- Trend.

## 14. Prototype Scope

The clickable dashboard prototype must:
- Use mock data only.
- Include all key roles in role switcher.
- Show CM Cell as default landing.
- Show KPI cards, SLA command module, heatmap, ministry ranking, ticket queue, and ticket detail.
- Use all 38 Tamil Nadu districts in heatmap metrics.
- Show protected corruption ticket masking by role.
- Show view-only action controls.
- Export as standalone `exports/standalone/whistle-dashboard.html`.

The prototype must not:
- Implement real authentication.
- Persist ticket mutations.
- Send SMS/WhatsApp.
- Integrate with Aadhaar.
- Connect to production GIS, department, or case-management systems.

## 15. Production Non-Functional Requirements

Security:
- Role-based access control.
- Multi-factor authentication for government users.
- Strong audit trail.
- Separate evidence access controls.
- Protected queue access review.

Performance:
- Dashboard initial load under agreed SLA for statewide data.
- Queue filtering should feel instant for common filters.
- Large exports should run asynchronously.

Reliability:
- SLA escalation jobs must be resilient and replayable.
- Audit events must not be lost.
- Notification failures must be retried and visible.

Accessibility:
- Keyboard navigation.
- Sufficient contrast for red/yellow theme.
- Non-color status indicators.
- Screen-reader labels for critical controls.

Data governance:
- Master data for districts, constituencies, wards, departments, and officers must be versioned.
- Analytics must distinguish live operational counts from historical snapshots.

## 16. Acceptance Criteria

State dashboard acceptance:
- CM Cell can see statewide KPIs, SLA breaches, heatmap, ministry performance, protected queue, rejection review, and ticket detail.
- Each role sees only its scoped tickets and allowed actions.
- Protected corruption identity is masked for unauthorized roles.
- `dashboard.html` does not expose Admin navigation or a State Administrator role.
- KPI click opens a filtered queue.
- Heatmap district click filters queue and shows district metrics.
- Queue row click opens ticket detail.
- Ticket detail shows SLA ladder, primary/secondary queues, escalation history, privacy state, timeline, and evidence placeholders.
- Actions are role-specific.
- Prototype actions are disabled/view-only.
- Production actions are authenticated, audited, and state-changing.
- Rejected tickets always flow into CM-maintained review.

Admin console acceptance:
- `admin.html` opens a separate control console with Users, Teams, Access, Permissions, App Controls, and Audit navigation only.
- Admin can invite a user, create a team, assign membership, grant CM access, toggle protected identity policy, change an SLA default, edit a notification template, and see audit/setup health update in-session.
- Admin effective-access preview reflects multi-team membership and direct grants for the selected user.
- Admin prototype changes are local-only and clearly marked as simulated.
- SLA is tracked per level and across total ticket age.
- Escalated tickets preserve secondary visibility for prior owners.
- Public/aggregate views never expose citizen identity or raw sensitive evidence.

## 17. Open Questions

- What exact SLA should apply at CM Cell and rejection review stages?
- Should awaiting-citizen time pause SLA, count separately, or continue counting?
- Which roles can see citizen phone number in production?
- Which categories, if any, require Aadhaar/Govt ID verification later?
- What is the official routing hierarchy for rural panchayat issues versus urban ward issues?
- Should ticket closure require citizen confirmation?
- Should public dashboards expose district-level corruption aggregates, or only broader protected counts?
- Which government system will be the source of truth for departments, officers, constituencies, and ward boundaries?
