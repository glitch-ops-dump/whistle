# Whistle Project Management Whitepaper Source Note

Date: 2026-06-29

Status: Source note for a future project management and execution whitepaper. This is not the final whitepaper copy.

## Purpose Of This Note

This note collects project-management, launch-readiness, government onboarding, training, deployment, testing, and go-live inputs for Whistle.

The final whitepaper should explain what a state government, MLA office, ministerial department, or implementation partner must do before Whistle is launched publicly.

## Working Structure

The current preferred structure is three phases:

1. Phase 1: preparation, hiring, governance setup, approvals, infrastructure planning, and operating-model design.
2. Phase 2: deployment setup, sanity testing, controlled pilot, training, dry run, UAT, defect review, and operational sign-off.
3. Phase 3: public go-live, Chief Minister or sponsor launch, public communication, scale watch, campaign support, and early-life operations.

This structure can change after more inputs are collected.

## Inputs Captured

### Launch Principle

- Whistle should not be launched to the public until the government operating structure, IT ownership, infrastructure, applications, data mappings, testing, training, and support processes are ready.
- The public launch should happen only after infrastructure setup, application loading, sanity checks, official dry run, and government or IT-provider testing are complete.
- The project should be completely prepared before a public sponsor, Chief Minister, minister, MLA, or other political/public leader announces it at scale.
- Public excitement, advertising, and social-media promotion can be planned before go-live, but the operational team must be in place first.
- A small controlled pilot is recommended before public launch. The pilot should limit scope enough to keep operational risk low while still testing the real workflow.
- A department-limited pilot may be more practical than a geographically limited pilot if regional boundaries are hard to control.
- A government-employee-only pilot can be used before public launch to test citizen submission, assisted filing, verification, routing, escalation, dashboards, and support without exposing the system to full public volume.

### Phase 1: Preparation, Team Setup, And Formal Approval

- The government must identify the project management team and IT team responsible for execution.
- The project management and IT teams must have clear accountability.
- Confidentiality clauses, data-handling responsibilities, access rules, and role boundaries must be signed and recorded before sensitive access is granted.
- The government and implementation team must review the state structure, district structure, department/ministry structure, constituency structure, MLA mappings, and operating hierarchy.
- Constituency-to-MLA mappings, ministry and department mappings, escalation ownership, and government hierarchy assumptions must be reviewed with the government and formally approved.
- The management layer should define who has access to what, who can configure what, who can approve launch gates, and who owns each operational lane.
- Final launch sign-off should come from the head of the operation. For a state-run launch this may be the Chief Minister or authorized CM Cell/state launch owner. For a constituency launch this may be the MLA. For a department launch this may be the minister or department head.
- The setup must support multiple implementation scales:
  - Statewide launch.
  - Single MLA constituency launch.
  - Minister-led department launch.
  - Department or ministry launch involving selected MLAs or districts.
- The configurable layer should support these structures rather than requiring one fixed statewide-only operating model.

### Staffing And Operating Roles

- A strong execution team must be created before public launch.
- The state or sponsor must decide who will review, verify, route, and close tickets.
- Verification team staffing must be ready before citizen volume begins.
- Call center or assisted-filing staffing must be hired and trained where the launch model requires citizen support.
- Ministers, IAS officers if involved, department authorities, MLA offices, CM Cell teams, verification teams, Admin users, and other participating authorities need proper training.
- The team must know how to handle citizen tickets, protected complaints, rejected tickets, escalations, SLA pressure, public dashboard questions, and support issues.
- Initial staffing should be based on the expected intake volume and the level of AI assistance available.
- The implementation team should evaluate 2 to 3 AI-assisted triage, classification, translation, summarization, or routing solutions before finalizing staffing assumptions.
- The first launch period should prefer being slightly overstaffed rather than understaffed. Understaffing during high-visibility launch can damage trust and the project's reputation.
- Party cadres, citizen volunteers, or sponsor-appointed volunteers may help promote adoption and help citizens raise complaints, but official ticket ownership, verification, routing, closure, and protected-data handling must remain with approved government or authorized operations teams.

### Phase 2: Deployment, Testing, Training, And Dry Run

- The infrastructure must be set up before launch.
- Applications must be deployed and loaded into the correct environment.
- Sanity checks must be completed before official dry run.
- Proper testing must be done by the government, IT provider, or whoever takes over implementation.
- The dry run should involve the relevant officials, not only the technical team.
- Officials should practice the end-to-end lifecycle before go-live so they understand how tickets move, where accountability sits, and what citizens will see.
- The dry run should test intake, verification, routing, SLA tracking, escalation, rejection review, role dashboards, public or internal reporting, notifications, and support handling.
- Training and learning should be part of Phase 2, alongside UAT and operational rehearsal.
- The controlled pilot should test both official-side operations and citizen-like filing. If public-region control is difficult, the pilot can be restricted by department, complaint category, internal government employees, or approved pilot participants.
- Pilot exit should require reviewed defects, accepted staffing assumptions, tested dashboards, rehearsed support handling, and sponsor approval to proceed.

### Public Dashboard And Transparency Choice

- If the government is ready for clean transparency, the public dashboard should be made visible with aggregate numbers.
- Public visibility can include ministry-level numbers, MLA-level numbers, constituency-level numbers, and other aggregate performance views.
- If the government is not ready for public transparency, the dashboard can remain internal.
- Public transparency must be a governance choice and should not force exposure of sensitive citizen data.
- Recommended position for the final whitepaper: public transparency should be recommended, but state-configurable.
- A state can start with internal-only transparency and then enable public aggregate views once counts, privacy thresholds, and communication readiness are approved.

### Phase 3: Go-Live, Public Launch, And Campaign

- Once setup, testing, training, and dry run are complete, the public launch can happen.
- In the Tamil Nadu example, an authorized Chief Minister's office or public-service launch owner could introduce Whistle once the system, approvals, and operating model are ready.
- After public launch, the floodgates open, so server capacity, support staffing, and operational monitoring must already be prepared.
- Promotion through social media and public campaigns should explain how citizens raise tickets and how tickets get resolved.
- A focused 10-to-30-day campaign after launch could help create momentum.
- The Chief Minister or public sponsor can urge party cadres, citizen volunteers, and the public to install or use the app.
- Party cadres and citizen volunteers can also help citizens raise complaints, especially where digital literacy or app access is limited, but their role should be clearly separated from official decision-making and sensitive-data access.
- Campaign messaging should create confidence without overpromising instant resolution.

### Scale, Reliability, And HADR

- Given likely launch hype and complaint volume, the server system must be scalable enough to support public traffic.
- High availability and disaster recovery must be planned before go-live.
- Data should be backed up regularly.
- Backups should include cross-cloud or separate-cloud options where the government's policy requires it.
- Offline backups should be considered.
- The final HADR strategy should depend on each state government's own disaster recovery, data retention, cloud, and security policies.
- Draft baseline to refine against government standards: automated daily backups, weekly offline or physically separated backups where policy permits, encrypted backup storage, periodic restore testing, and a documented disaster recovery owner.
- A restore drill should be completed during the preparation stage before public launch.
- After launch, restore and disaster-recovery drills should repeat on a standard government cadence, such as every 3 to 6 months, unless the state requires a stricter schedule.
- The final whitepaper should avoid inventing non-standard RTO/RPO numbers without policy input. It should recommend that the state set RTO/RPO targets based on expected citizen volume, legal retention duties, and service criticality.

## Existing Whistle Documents To Align With Later

- `docs/whistle-project-roadmap.md`
- `docs/whistle-production-runbook.md`
- `docs/whistle-production-deployment-cost-plan.md`
- `docs/whistle-test-deployment-plan.md`
- `docs/mvp1-local-uat-guide.md`
- `docs/mvp1-deployment-decisions.md`

## Open Questions

- What exact official roles should be included in mandatory training: ministers, IAS officers, district collectors, department secretaries, MLA office teams, councillors, call center staff, verification team, CM Cell, Admin, and IT operations?
- What minimum staffing ratio should be recommended for verification, call center, and support after expected ticket volume and AI-assistance options are assessed?
- Which 2 to 3 AI-assisted triage, classification, translation, summarization, or routing solutions should be evaluated before staffing is finalized?
- What exact public-transparency thresholds should apply before ministry-level, MLA-level, or constituency-level numbers are visible?
- What should be the minimum HADR standard for each implementation tier: statewide, minister-led, MLA-led, or department-led?
- Which launch approvals are mandatory in addition to sponsor sign-off: project management lead, IT lead, security lead, CM Cell, department owners, legal/privacy owner, public communication owner, and finance/procurement owner?
- What defect severity rules should block launch after dry run or UAT?
- What communication rules should be used during the first 10 to 30 days so public campaigns set realistic citizen expectations?

## Draft Recommendations Already Agreed

- Recommend a small controlled pilot before public launch.
- Prefer department, complaint-category, government-employee, or approved-participant pilots when geography is hard to control.
- Recommend public transparency, but keep it state-configurable.
- Require final launch sign-off by the head of the operation: Chief Minister/state launch owner for statewide launch, MLA for constituency launch, minister or department head for department launch.
- Allow party cadres, citizen volunteers, or sponsor-appointed volunteers to promote the app and help citizens raise complaints, while keeping official decisions and sensitive-data access with authorized teams.
- Assess expected volume and 2 to 3 AI-assistance options before finalizing staffing.
- Prefer slight overstaffing during the first launch period to protect service quality and reputation.
- Use daily backups and periodic offline or physically separated backups as the draft baseline, subject to state policy.
- Complete one restore drill during preparation and repeat drills every 3 to 6 months after launch unless state policy is stricter.

## Possible Areas To Add Later

- Legal, privacy, and data-protection approvals.
- Procurement and vendor-management controls.
- Government identity provider, MFA, and official account lifecycle.
- Security audit, penetration testing, vulnerability remediation, and launch hold criteria.
- Incident command structure and launch war room.
- Citizen support SOPs, call center scripts, and escalation scripts.
- Data retention, evidence storage, malware scanning, and protected-complaint handling.
- Accessibility, Tamil/English language quality, assisted filing, and low-connectivity support.
- Post-launch daily review rhythm for first 10, 30, and 90 days.
- Public communications plan for outages, delays, false expectations, and high-volume spikes.
- Independent audit or oversight model for rejected tickets and sensitive complaints.
