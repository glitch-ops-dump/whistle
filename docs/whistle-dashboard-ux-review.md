# Whistle Government Dashboard UX Review

Date: May 18, 2026  
Scope: Independent review of the current `exports/standalone/whistle-dashboard.html` government-side prototype.  
Status: No app/source changes made as part of this review.

## Executive Assessment

The current dashboard has several strong building blocks, especially the Tamil Nadu district heatmap, SLA concepts, protected-ticket handling, and the idea of role switching. But the core message is getting diluted because each role still feels like it is using a variation of the same dashboard instead of a purpose-built operating console.

The heatmap works because it communicates a clear operating question: "where is the pressure?" Most other modules do not yet create the same clarity. They show metrics, queues, and panels, but they do not strongly answer the role's main question.

Current clarity score:

| Area | Assessment | Score |
| --- | --- | --- |
| District heatmap | Strong, memorable, clearly useful for CM/ministry views | 8.5 / 10 |
| Role-specific purpose | Present in copy, weak in screen structure | 4 / 10 |
| CM Cell command clarity | Improving, but not yet a true command center | 5.5 / 10 |
| Minister usefulness | Has a ministry focus, but still feels generic | 5 / 10 |
| MLA/Councillor usefulness | Too similar to each other and too dashboard-like | 4 / 10 |
| Verification/Rejection review | Operationally underdefined | 3.5 / 10 |
| Action orientation | Buttons exist, but the page does not tell users what to do next | 4 / 10 |
| Information hierarchy | Many panels compete at equal importance | 5 / 10 |

## What The Current Prototype Does Well

1. The heatmap is the strongest idea.
It gives geography a shape, makes district-level accountability visible, and supports both CM Cell and ministry-level decision making.

2. The SLA language is directionally right.
The app is no longer just "ticket counts"; it has breach, due today, due in 48 hours, escalation, and queue ownership.

3. The protected corruption model is valuable.
Masking, protected queues, and role-based visibility are important and should remain part of the concept.

4. The role switcher is useful for demoing.
It lets stakeholders understand that the same system can expose different levels of government access.

5. Ticket detail has good ingredients.
SLA ladder, primary/secondary queues, escalation history, privacy state, and evidence placeholders are all relevant.

## Why The Purpose Feels Diluted

1. Same page shape across roles
CM Cell, Minister, Officer, MLA, Councillor, Verification, and Rejection Review all sit inside the same header/sidebar/KPI/panel/detail structure. Labels change, but the page does not feel like a different job.

2. KPIs are renamed, not rethought
Some KPI labels change by role, but most cards still behave like generic dashboard counters. A role-specific dashboard should make the next decision obvious.

3. The right-side ticket detail is always present
This makes every role feel like a case worker, even when CM Cell and ministers primarily need command-level oversight. For CM Cell, the first screen should feel like a command room, not a ticket-detail workspace.

4. The role goal is copy, not layout
Each role now has a written goal, but the layout does not fully embody that goal. The screen should visually transform around the role's job.

5. The heatmap is overused
The statewide heatmap is excellent for CM Cell and useful for ministers. It is less relevant as a primary module for MLA, Councillor, Verification, and Rejection Review. For those roles it can make the page feel too state-level and less actionable.

6. Verification and Rejection Review are not distinct enough
Both currently fall back to generic highest-risk tickets, heatmap, and SLA ranking. These roles need workbench-style queues, not a generic oversight page.

7. Campaign/identity treatment competes with operations
The branding is strong, but on a government operations dashboard the header and portrait take a lot of attention. The citizen app can be more campaign-forward; the dashboard should feel more like an official command system.

## Council Review By Role

### CM Cell Director

Primary job:
See all ministries, identify where governance is failing, decide escalations, issue directives, and hold departments accountable.

Current fit:
Partially successful. Ministry ranking and district heatmap are the right direction. But the experience still feels like a general dashboard plus ticket detail.

What is missing:
- "What needs CM decision today?" as the main module.
- Direct separation between monitoring, intervention, rejection audit, and protected corruption.
- Ministry accountability as an operating scoreboard, not just a list.
- Drilldown paths like Ministry -> District -> SLA stage -> owner -> ticket.
- A clear "directive pending / directive issued / response overdue" loop.

Recommended CM Cell home:
State Command Center.
Top: 4 command KPIs only: SLA breached, CM escalated, ministries in red, districts in red.  
Center: large Tamil Nadu heatmap.  
Right: escalations needing CM decision.  
Bottom: ministry accountability table and protected/rejection audit alerts.

### Department Minister

Primary job:
Ensure one ministry acts efficiently across all districts and prevent cases from escalating to CM Cell.

Current fit:
Moderate. The prototype picks Municipal Administration & Water Supply, which helps. But the page still resembles CM Cell and Officer views.

What is missing:
- Strong ministry-only identity.
- District performance by department owner and field capacity.
- "Which districts are failing my ministry?" as the main question.
- Escalations that already reached CM Cell but still count against the ministry.
- Field-team bottlenecks, officer load, and ageing by district.

Recommended Minister home:
Ministry Execution Board.
Top: ministry open, district breaches, due today, escalated to CM Cell.  
Center: district leaderboard for that ministry.  
Right: bottleneck owners and at-risk districts.  
Bottom: CM escalations retained as secondary accountability.

### Department Officer / Ministry Queue

Primary job:
Run the operational queue, assign work, request missing information, and close cases within SLA.

Current fit:
Weak to moderate. It shares too much with the minister view and does not feel like a workbench.

What is missing:
- Today's action queue.
- Filters by evidence missing, field visit needed, awaiting citizen, owner overdue.
- Batch-style operational controls.
- Clear priority ordering by SLA and blockers.

Recommended Officer home:
Ministry Action Queue.
Top: due today, breached, waiting for field update, awaiting citizen.  
Center: task inbox table.  
Right: selected ticket detail.  
Secondary: district heatmap as a filter, not the main message.

### MLA

Primary job:
Close constituency issues before they escalate to a ministry, while monitoring what has already left local control.

Current fit:
Moderate. The current MLA view has the right words: constituency queue, escalation risk, local ownership. But it still looks structurally similar to other roles and still shows a statewide heatmap.

What is missing:
- Constituency-first geography, not statewide geography.
- "Will this leave my control?" as the central question.
- Ward/local owner blockers.
- Issues escalated out but still politically visible to the MLA.
- Local promise/closure tracking.

Recommended MLA home:
Constituency Control Room.
Top: local issues, due today, about to escalate, escalated out.  
Center: ward/owner risk board.  
Right: top 10 cases likely to escalate.  
Bottom: recurring civic categories and department blockers.

### Councillor / Local Owner

Primary job:
Resolve ward-level civic issues quickly, coordinate field visits, and prevent escalation.

Current fit:
Weak. It is too similar to MLA. Councillor users need a much more practical daily work surface.

What is missing:
- Today's field visits.
- Citizen call-backs needed.
- Photo/evidence capture state.
- Ward-level route/list, not statewide heatmap.
- Simple issue closure workflow.

Recommended Councillor home:
Ward Field Workbench.
Top: due today, field visits, citizen info needed, escalates soon.  
Center: today's ward issue list.  
Right: selected issue with visit/evidence checklist.  
Remove statewide heatmap from default view.

### Ticket Verification Team

Primary job:
Clear intake within two days by validating information, requesting more data, routing correctly, and flagging protected corruption.

Current fit:
Weak. It currently falls back to generic risk tickets and SLA ranking.

What is missing:
- Intake triage lanes: complete, missing info, wrong category, protected candidate, duplicate, reject candidate.
- Queue age within the 2-day SLA.
- Routing confidence and ambiguity.
- Rejection quality guardrails.

Recommended Verification home:
Intake Triage Bench.
Top: unreviewed, SLA breached intake, awaiting citizen, protected candidates.  
Center: triage queue grouped by missing requirement.  
Right: case verification checklist.

### CM-Maintained Rejection Review Team

Primary job:
Catch improper rejections and restore valid citizen complaints.

Current fit:
Weak. It looks too much like the generic dashboard and not enough like an audit function.

What is missing:
- Rejection reason patterns.
- Reversal rate by verifier, department, district, and category.
- Suspicious rejection clusters.
- Citizen-resubmitted tickets.
- Audit decision workflow.

Recommended Rejection Review home:
Independent Audit Bench.
Top: pending review, overdue review, likely wrongful rejection, reversed this week.  
Center: rejection queue with reason and risk score.  
Right: before/after ticket evidence and verifier note.

## Recommended Information Architecture Shift

The next version should not use one shared dashboard layout for all roles. It should use role homes.

| Role | Primary Screen | Heatmap Role | Main Question |
| --- | --- | --- | --- |
| CM Cell | State Command Center | Central | Where is governance failing and what needs intervention? |
| Minister | Ministry Execution Board | Filtered and prominent | Which districts/owners under my ministry are failing SLA? |
| Department Officer | Action Queue | Secondary filter | What must my team clear today? |
| MLA | Constituency Control Room | Constituency/ward view only | What will escalate if I do not intervene? |
| Councillor | Ward Field Workbench | Not primary | What must be visited or closed today? |
| Verification | Intake Triage Bench | Not primary | Which tickets can be validated/routed within 2 days? |
| Rejection Review | Audit Bench | Not primary | Which rejections look improper? |

## Suggested V2 Direction

1. Keep the current version as reference.
It has useful data modeling and several reusable modules.

2. Create a new dashboard version with different role homes.
Do not only swap labels and panels. Each role should get a different default screen.

3. Make CM Cell the hero experience.
The strongest demo story is: district heatmap + ministry accountability + escalation decisions.

4. Make local roles less "state dashboard".
MLA and Councillor should feel closer to local closure tools than statewide analytics consoles.

5. Make Verification and Rejection Review workbench-first.
These are operational/audit roles, not geographic command roles.

## Candidate V2 Screen Concepts

### CM Cell: State Command Center

Primary story:
"Across Tamil Nadu, which ministry or district is failing SLA, and what escalations need CM intervention?"

Modules:
- Red alert strip: breached, CM escalated, due today, protected corruption.
- Large district heatmap.
- Ministry accountability ranking.
- CM decision queue.
- Rejection/protected alerts.
- Drilldown drawer for district/ministry details.

### Minister: Ministry Execution Board

Primary story:
"For my ministry, which districts and officers are failing execution?"

Modules:
- Ministry-only KPI strip.
- District breach leaderboard.
- Officer/team capacity.
- At-risk queue.
- CM-escalated cases where ministry is secondary owner.
- District comparison table.

### MLA: Constituency Control Room

Primary story:
"Which local issues in my constituency will escalate if I do not intervene now?"

Modules:
- Constituency SLA strip.
- Ward/local owner risk list.
- Escalation-prevention queue.
- Issues escalated to ministry but still visible to MLA.
- Recurring issue categories.

### Councillor: Ward Field Workbench

Primary story:
"What work must my ward team complete today?"

Modules:
- Today, overdue, needs visit, needs citizen info.
- Field visit list.
- Evidence checklist.
- Citizen contact status.
- Simple closure readiness.

### Verification: Intake Triage Bench

Primary story:
"Which submitted tickets are complete enough to route, and which need more data?"

Modules:
- Unreviewed, missing info, protected candidates, rejects under guardrail.
- Ticket completeness checklist.
- Routing confidence.
- 2-day SLA clock.

### Rejection Review: Audit Bench

Primary story:
"Which rejected complaints may have been wrongly rejected?"

Modules:
- Pending rejection review.
- Overdue audits.
- Reversal candidates.
- Rejection reason clusters.
- Verifier/department reversal rates.

## High-Level Recommendation

The next prototype should be rebuilt around three levels of government mental model:

1. Command roles: CM Cell and Minister
They need accountability, heatmaps, comparisons, and escalations.

2. Execution roles: Department Officer and Councillor
They need daily work queues, field status, evidence, and closure readiness.

3. Oversight/local political roles: MLA and Rejection Review
They need visibility into risk, improper handling, escalation, and owner accountability.

Right now the current version compresses all three mental models into one dashboard pattern. That is the main reason the purpose feels diluted.
