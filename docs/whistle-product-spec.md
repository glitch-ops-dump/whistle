# Whistle Product Specification

## 1. Product Summary

Whistle is a bilingual Tamil/English citizen complaint and whistleblower platform for Tamil Nadu. The citizen-facing app lets people raise issues about corruption, roads, water, power, sanitation, public safety, and other civic problems. The government-side apps manage ticket verification, SLA tracking, escalation, departmental accountability, and CM-level visibility.

For the first clickable prototype, build only the citizen Whistle app. The prototype must still reflect the full government operating model through visible ticket stages, escalation labels, SLA timers, privacy messaging, and status updates.

## 2. Product Surfaces

### 2.1 Citizen Whistle App

Primary users:
- Any resident/citizen raising a civic issue or corruption complaint.
- Users who may be cautious about identity exposure.
- Users who need status clarity after submitting a complaint.

Core citizen capabilities:
- Switch between Tamil and English.
- Raise a new complaint.
- Choose complaint category.
- Add description, location, photos, videos, and reference links or numbers.
- Verify by mobile OTP in the prototype.
- See whether stronger identity verification may be required by state policy for selected categories.
- Track ticket status, queue level, SLA deadline, escalation history, and requested clarifications.
- Respond when the ticket verification team asks for additional information.
- See rejection outcome and whether rejection was reviewed by CM-maintained quality team.
- Receive mocked SMS/WhatsApp/in-app updates.
- Keep personal identity protected based on state-level privacy configuration.

Prototype scope:
- Include home, complaint creation, ticket detail, ticket list, resubmission/clarification, and public aggregate insights.
- Use mock data and mock OTP.
- Do not build real government login, real SMS/WhatsApp, Aadhaar OTP, backend APIs, or production dashboards in the first prototype.

### 2.2 Government Operating Apps

These are requirements for the full platform, not the first prototype surface.

Government user groups:
- Ticket Verification Team.
- Rejection Review Team maintained by CM Cell.
- Councillors/local body owners.
- MLAs.
- Department/ministry officers.
- Department ministers.
- CM Cell.
- System/state administrators.

Core government capabilities:
- Review new tickets for completeness, category, location, duplication, and evidence quality.
- Request additional information from the citizen.
- Reject tickets with documented reason.
- Send all rejected tickets to a separate CM-maintained review queue.
- Route verified tickets to local councillor/MLA-level ownership.
- Track SLA at every queue and ownership level.
- Escalate overdue tickets to ministry, then CM Cell.
- Keep escalated tickets visible in both primary and secondary queues.
- Configure whether personal details are visible to ministries, CM Cell, or other roles.
- Drill down by ministry, department, district, city, constituency, ward, category, SLA status, and escalation level.

## 3. Ticket Lifecycle

Every ticket must have a visible lifecycle that is understandable to citizens and operationally useful to government users.

### 3.1 State 1: Submitted by Citizen

Trigger:
- Citizen submits complaint from Whistle app.

Citizen sees:
- Reference ID.
- Submitted timestamp.
- Current queue: Ticket Verification.
- Verification SLA deadline.
- Privacy status.
- Notification preferences.

Government owner:
- Ticket Verification Team.

Default SLA:
- Verification must be completed within 2 days.

Possible next actions:
- Accept for routing.
- Ask citizen for additional data.
- Reject with reason.
- Escalate if verification SLA is breached.

### 3.2 State 2: Needs Additional Information

Trigger:
- Verification team decides complaint has missing or incorrect data.

Citizen sees:
- Clear reason for required update.
- Missing fields or requested evidence.
- Resubmit button.
- Updated SLA behavior.

Rules:
- Ticket is paused or marked awaiting citizen response.
- Original history remains visible.
- After citizen resubmits, ticket returns to Ticket Verification.

Examples:
- Missing address.
- Wrong department/category.
- Unclear photo.
- Insufficient corruption evidence.
- Duplicate or ambiguous location.

### 3.3 State 3: Rejected

Trigger:
- Verification team rejects a ticket.

Citizen sees:
- Rejection reason.
- Whether the rejection has been sent for independent review.
- Option to submit a new complaint or appeal if supported later.

Government rule:
- Every rejected ticket enters a separate Rejection Review Queue maintained directly by CM Cell.

Purpose:
- Prevent local filtering abuse.
- Identify patterns where valid complaints are being rejected.
- Audit verification team quality.

### 3.4 State 4: Verified and Routed Locally

Trigger:
- Verification team approves ticket.

Primary queue:
- Local councillor/local body owner for ward-level issues.
- MLA-level queue for constituency-level visibility and escalation tracking.

Citizen sees:
- Current stage: Local / MLA level.
- Responsible level, not necessarily personal names.
- 7-day SLA deadline.
- Current status: Assigned, In Progress, Resolved, or Escalated.

Default SLA:
- Local/MLA level has 7 days to address.

Possible next actions:
- Resolve.
- Mark in progress.
- Transfer to another department with reason.
- Escalate to ministry if SLA is breached or issue requires department authority.

### 3.5 State 5: Escalated to Ministry

Trigger:
- Local/MLA SLA is breached.
- Local level marks issue as needing department/ministry intervention.

Primary queue:
- Respective ministry/department.

Secondary queue:
- MLA/local level retains secondary visibility because the issue originated in their jurisdiction.

Citizen sees:
- Current stage: Ministry level.
- Previous level still visible as escalation history.
- Ministry SLA deadline.
- Reason for escalation.

Default SLA:
- Ministry level has 10 days to address.

Rule:
- Ticket must be tagged as primary in ministry queue and secondary in previous local/MLA queue.

### 3.6 State 6: Escalated to CM Cell

Trigger:
- Ministry SLA is breached.
- Ministry escalates due to policy, budget, interdepartmental dependency, corruption sensitivity, or unresolved dispute.

Primary queue:
- CM Cell.

Secondary queue:
- Ministry retains secondary visibility.

Citizen sees:
- Current stage: CM Cell.
- Ministry remains in escalation history.
- Highest-level SLA clock and final accountability marker.

Rule:
- CM Cell can inspect cross-department blockers, repeated SLA breaches, rejection quality, and regional performance.

### 3.7 State 7: Resolved and Closed

Trigger:
- Owning government level marks ticket resolved.

Citizen sees:
- Resolution note.
- Before/after evidence if available.
- Date resolved.
- Option to confirm resolution or reopen/dispute in a later version.

Government sees:
- SLA performance.
- Time spent at each level.
- Reopen/dispute indicators when introduced.

## 4. SLA and Queue Model

### 4.1 SLA Levels

Default SLA configuration:

| Stage | Primary Owner | Default SLA | Breach Action |
| --- | --- | ---: | --- |
| Ticket Verification | Verification Team | 2 days | Escalate to verification supervisor / CM visibility |
| Local / MLA Level | Councillor/local owner + MLA visibility | 7 days | Escalate to ministry |
| Ministry Level | Department/ministry | 10 days | Escalate to CM Cell |
| CM Cell | CM Cell | State-configured | Highest-level monitoring |
| Rejection Review | CM-maintained review team | State-configured | Audit verification quality |

SLA must track:
- Total ticket age.
- Time spent at current level.
- Time spent at every previous level.
- SLA remaining.
- SLA breached by level.
- Number of escalations.
- Primary queue.
- Secondary queues.

### 4.2 Primary and Secondary Queue Rules

Every active ticket has exactly one primary queue.

Tickets may have multiple secondary queues.

Examples:
- A ticket escalated from MLA to ministry has:
  - Primary queue: Ministry.
  - Secondary queue: MLA/local level.
- A ticket escalated from ministry to CM Cell has:
  - Primary queue: CM Cell.
  - Secondary queue: Ministry.
- A rejected ticket has:
  - Primary state: Rejected.
  - Review queue: CM-maintained rejection review.

Citizen-facing wording should avoid bureaucratic complexity while preserving clarity:
- "Your complaint is now with the Ministry."
- "Your MLA/local office can still see the issue because it was escalated from their queue."
- "This ticket crossed the local SLA and moved up automatically."

### 4.3 SLA Severity Labels

Use these labels in citizen and government views:
- On Track.
- Due Soon.
- SLA Breached.
- Escalated.
- Resolved.
- Awaiting Citizen.

Citizen app should show:
- Current level.
- Deadline date.
- Time remaining or overdue.
- What caused escalation.
- Who has primary responsibility now.

Government dashboards should show:
- Breached count.
- Due soon count.
- Average time at current level.
- Oldest pending tickets.
- Repeated breach patterns by department, district, city, constituency, and category.

## 5. Privacy and Identity Protection

### 5.1 Citizen Identity Policy

Citizen personal data includes:
- Name if collected.
- Phone number.
- Exact address if it reveals identity.
- Identity documents.
- Raw evidence metadata.

Default citizen privacy:
- Public dashboards never show personal data.
- Citizen identity is hidden from public views.
- Local levels should see only the information required to resolve the issue.

State-level configuration must control:
- Whether councillors can see personal data.
- Whether MLAs can see personal data.
- Whether ministry users can see personal data.
- Whether CM Cell can see personal data.
- Whether corruption reports always mask identity below CM Cell/vigilance level.
- Whether Aadhaar/Govt ID OTP is mandatory for selected categories.

Prototype behavior:
- Show privacy messaging and masked identity.
- Use mock phone OTP only.
- Show future configuration references without implementing real identity verification.

### 5.2 Corruption Complaint Protection

Corruption tickets require stronger guardrails:
- Default to protected visibility.
- Avoid routing raw reporter identity to local owners.
- Allow CM Cell/vigilance screening before local or departmental exposure.
- Clearly explain to citizens who can see the complaint.
- Support attachments and references.
- Keep audit trail for every view/access event in full platform.

## 6. Citizen App Interfaces

### 6.0 Visual Design Direction

Whistle should use a yellow and red visual identity for the citizen app. The palette should feel energetic, civic, urgent, and lightly campaign-like while still remaining readable and service-oriented.

Design rules:
- Use yellow as the optimistic/highlight color for primary surfaces, progress, and civic action.
- Use red as the urgency/accountability color for alerts, SLA breaches, escalation, and important calls to action.
- Use white, near-black, and warm neutral backgrounds to keep the app readable and government-service appropriate.
- Avoid using yellow/red in a way that makes every screen feel like a warning state.
- Ensure all Tamil and English text has strong contrast on yellow/red backgrounds.
- Neutral service illustration treatment and logo accents should harmonize with the yellow/red theme.

### 6.1 Home

Purpose:
- Explain Whistle quickly.
- Establish trust and privacy.
- Start complaint flow.
- Switch language.

Key UI:
- Whistle logo.
- Neutral service illustration placeholder for prototype.
- Tamil/English toggle.
- "Raise Complaint" primary action.
- Quick category cards.
- Trust strip: phone verified, identity protected, SLA tracked.
- Public aggregate insight entry.

### 6.2 Complaint Category

Categories:
- Corruption.
- Roads.
- Water.
- Power.
- Sanitation.
- Public Safety.
- Other.

Category behavior:
- Category affects routing, evidence prompts, privacy messaging, and SLA path.
- Corruption category defaults to protected mode.

### 6.3 Complaint Details

Fields:
- Title.
- Description.
- Category-specific prompts.
- Photos.
- Videos.
- Reference links.
- Reference numbers.
- Optional supporting document.

Validation:
- Title required.
- Description required.
- Location required for most civic issues.
- At least one contact method required.
- Evidence recommended but not always mandatory.

### 6.4 Location

Inputs:
- Use current GPS location.
- Manual address.
- District.
- City/town/village.
- Constituency.
- Ward/panchayat if known.
- Landmark.

Rules:
- User can edit GPS-derived location.
- Exact reporter address should not automatically become public.
- Routing can be based on service location, not residence.

### 6.5 Verification

Prototype:
- Mock mobile OTP verification.

Future:
- Optional Aadhaar/Govt ID OTP based on state-level policy.
- Category-specific stronger verification.
- Anonymous/protected reporting policy if approved.

Citizen messaging:
- Explain why verification is needed.
- Explain what identity is visible to whom.
- Explain if stronger verification is required for the selected category.

### 6.6 Review and Submit

Show:
- Category.
- Description.
- Evidence count.
- Location.
- Privacy status.
- Verification status.
- Expected first SLA: Ticket Verification, 2 days.

Submit output:
- Reference ID.
- Ticket stage.
- Verification deadline.
- Notification confirmation.

### 6.7 My Tickets

List view:
- Reference ID.
- Category.
- Current stage.
- Current primary queue.
- SLA badge.
- Last update.
- Escalation marker.

Filters:
- All.
- Awaiting my response.
- In verification.
- Local/MLA.
- Ministry.
- CM Cell.
- Resolved.

### 6.8 Ticket Detail

Must show:
- Current status.
- Current stage.
- Primary queue.
- Secondary queue if applicable.
- SLA deadline.
- Time remaining/overdue.
- Timeline of events.
- Attachments submitted.
- Requested additional info.
- Rejection/review outcome when applicable.
- Notification log.

Citizen timeline example:
1. Submitted by you.
2. Phone verified.
3. Ticket Verification Team reviewing.
4. Additional information requested.
5. You resubmitted details.
6. Verified and routed to local/MLA level.
7. Local SLA breached.
8. Escalated to Ministry.
9. Ministry SLA breached.
10. Escalated to CM Cell.
11. Resolved.

### 6.9 Add More Information

Purpose:
- Let citizen fix incomplete/incorrect submissions.

UI:
- Reason from verification team.
- Requested fields.
- Add evidence.
- Edit location/details.
- Resubmit.

Rules:
- Preserve original submission history.
- Show resubmission count.
- Return ticket to verification queue.

### 6.10 Public Aggregate Insights

Citizen app may include a public dashboard with only aggregate data.

Allowed:
- Counts by category.
- Counts by district/city/constituency.
- SLA breach counts.
- Resolution rate.
- Ministry-level summary.

Not allowed:
- Names.
- Phone numbers.
- Raw evidence.
- Exact private identity data.
- Sensitive corruption details.

## 7. Government App Interfaces and Dashboards

These interfaces are not part of the first clickable prototype, but the data model and citizen-facing states must support them.

### 7.1 Ticket Verification Dashboard

Purpose:
- Clear new tickets within 2-day SLA.

Views:
- New submissions.
- Due today.
- SLA breached.
- Awaiting citizen data.
- Rejected tickets.
- Category/location correction queue.

Actions:
- Accept and route.
- Request more information.
- Reject with reason.
- Mark duplicate.
- Change category.
- Correct routing location.

Metrics:
- Verification SLA compliance.
- Rejection rate.
- Resubmission rate.
- Tickets pending over 2 days.

### 7.2 CM-Maintained Rejection Review Dashboard

Purpose:
- Independently review rejected tickets.

Views:
- Rejected by category.
- Rejected by verification officer/team.
- Rejected by district/city.
- Repeated rejection patterns.

Actions:
- Confirm rejection.
- Reverse rejection and route ticket.
- Flag verification quality issue.
- Update rejection policy guidance.

Metrics:
- Valid rejections.
- Reversed rejections.
- Rejection patterns by region/category.

### 7.3 Councillor / Local Owner Dashboard

Purpose:
- Resolve ward/local body tickets within 7 days.

Views:
- Primary queue.
- Due soon.
- SLA breached.
- Escalated but still visible as secondary.
- Category map.

Actions:
- Accept assignment.
- Update status.
- Add work note.
- Add before/after photo.
- Transfer with reason.
- Mark resolved.

Restrictions:
- Protected corruption identity hidden unless policy allows.
- Cannot suppress escalation history.

### 7.4 MLA Dashboard

Purpose:
- Constituency-level monitoring and accountability.

Views:
- Constituency ticket load.
- Local SLA breaches.
- Tickets escalated to ministry but still visible to MLA.
- Department-wise bottlenecks in constituency.

Actions:
- Review escalations.
- Add public representative note.
- Push local owner for update.
- Monitor ministry escalations.

### 7.5 Ministry / Department Dashboard

Purpose:
- Own escalated or department-level tickets within 10 days.

Views:
- Primary ministry queue.
- Secondary tickets escalated onward to CM Cell.
- SLA breached.
- District/city/constituency breakdown.
- Category breakdown.
- Oldest unresolved tickets.

Actions:
- Assign department officer.
- Update action plan.
- Request field report.
- Resolve.
- Escalate to CM Cell.

Privacy:
- Whether ministry can see citizen personal data must be state-configured.

### 7.6 Department Minister Dashboard

Purpose:
- Political and administrative oversight for one ministry.

Views:
- Statewide department load.
- SLA breaches by district/city.
- Constituency ranking.
- Escalations to CM Cell.
- Repeated local body blockers.

Actions:
- Drill down to ticket queue.
- Review breach clusters.
- Issue department-level directive.
- Monitor field closure.

### 7.7 CM Cell Dashboard

Purpose:
- Highest-level cross-government accountability.

Views:
- All tickets by ministry.
- All SLA breaches by level.
- CM Cell primary queue.
- Tickets escalated from ministries.
- Rejection review outcomes.
- Protected corruption queue.
- District/city/constituency drilldowns.
- Ministry-to-city and city-to-ministry permutation analysis.

Required drilldowns:
- Ministry -> department -> district -> city -> constituency -> ticket.
- District/city -> department/ministry -> category -> ticket.
- SLA status -> level -> owner -> ticket.
- Category -> geography -> queue level -> ticket.

Metrics:
- Tickets beyond SLA at each level.
- Tickets nearing SLA breach.
- Average time per level.
- Escalation rate by ministry.
- Rejection reversal rate.
- Oldest unresolved cases.
- Protected corruption case count.

## 8. Data Model Requirements

### 8.1 Ticket

Required fields:
- Ticket ID.
- Category.
- Title.
- Description.
- Created timestamp.
- Created language.
- Reporter ID.
- Reporter privacy mode.
- Verification method.
- Current status.
- Current stage.
- Primary queue.
- Secondary queues.
- Current SLA due date.
- SLA breach flags.
- Location.
- Department/ministry.
- Constituency.
- Ward/panchayat.
- Attachments.
- References.
- Timeline events.
- Rejection review status.

### 8.2 Timeline Event

Required fields:
- Event ID.
- Ticket ID.
- Event type.
- Actor type.
- Actor role.
- Timestamp.
- Visible to citizen flag.
- Message.
- Previous queue.
- New queue.
- SLA impact.

### 8.3 Queue Assignment

Required fields:
- Ticket ID.
- Queue type.
- Owner level.
- Owner ID.
- Primary/secondary flag.
- Assigned timestamp.
- SLA deadline.
- Exit timestamp.
- Exit reason.

### 8.4 State Configuration

Required fields:
- SLA by stage.
- SLA by category override.
- Identity visibility by role.
- Aadhaar/Govt ID required categories.
- Corruption protection policy.
- Public dashboard aggregation rules.
- Rejection review rules.
- Notification templates.

## 9. Notifications

Citizen notification channels:
- In-app.
- SMS mock in prototype.
- WhatsApp mock in prototype.

Citizen notification triggers:
- Ticket submitted.
- Verification completed.
- Additional information requested.
- Ticket rejected.
- Rejection review completed.
- Routed to local/MLA level.
- SLA breached and escalated.
- Routed to ministry.
- Routed to CM Cell.
- Resolved.
- Closed.

Notification content should include:
- Ticket ID.
- Current stage.
- Action needed if any.
- SLA date when relevant.
- No sensitive evidence details in SMS/WhatsApp.

## 10. Prototype Requirements

Build only the citizen Whistle app for the clickable prototype.

Prototype screens:
- Home.
- Language switch.
- Raise complaint.
- Category selection.
- Details/evidence/reference capture.
- Location capture.
- Mock phone verification.
- Review and submit.
- Submission confirmation.
- My Tickets list.
- Ticket detail with lifecycle, SLA, primary/secondary queue labels.
- Additional information request and resubmit flow.
- Rejected ticket with CM review label.
- Public aggregate insights.

Prototype must demonstrate:
- A normal civic issue moving from verification to local/MLA level.
- A ticket needing more information and being resubmitted.
- A rejected ticket entering CM-maintained review.
- A local SLA breach escalating to ministry while remaining visible as secondary to MLA.
- A ministry SLA breach escalating to CM Cell while remaining visible as secondary to ministry.
- A corruption complaint with protected identity messaging.
- Yellow/red-led visual design with accessible contrast and restrained government-service styling.

Do not implement in prototype:
- Real backend.
- Real government dashboards.
- Real authentication.
- Real Aadhaar OTP.
- Real SMS/WhatsApp provider.
- Production role-based access.

## 11. Acceptance Criteria

Citizen prototype acceptance:
- User can switch Tamil/English for core UI.
- User can create a complaint with category, description, location, evidence mock, references, and phone OTP mock.
- User can see ticket stage, primary queue, secondary queue, SLA deadline, and escalation reason.
- User can respond to an additional information request.
- User can see rejected ticket review by CM-maintained queue.
- User can see protected identity messaging for corruption complaints.
- Public insights show only aggregate counts.
- No public view exposes phone number, name, raw evidence, or sensitive corruption details.

Full platform requirement acceptance:
- Every active ticket has one primary queue.
- Escalated tickets retain relevant secondary queues.
- SLA is tracked per level and across total ticket age.
- Verification SLA breach is visible to higher oversight.
- Local/MLA breach escalates to ministry.
- Ministry breach escalates to CM Cell.
- Rejections are independently reviewed by CM-maintained team.
- CM Cell can drill down by ministry, department, district, city, constituency, category, SLA state, and escalation level.
- Identity visibility is controlled by state-level configuration.
