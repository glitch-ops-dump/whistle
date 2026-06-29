# Whistle Agentic Pipeline Discussion Summary

## Context

Whistle is a bilingual Tamil/English citizen complaint and whistleblower platform for Tamil Nadu. The workflow spans citizen intake, ticket verification, routing, SLA tracking, local/MLA ownership, ministry escalation, CM Cell oversight, protected corruption handling, rejection review, dashboards, and admin/RBAC controls.

## Recommendation

Use LangGraph for the agentic reasoning layer, but do not make it the source of truth for ticket lifecycle state.

The core Whistle backend should remain deterministic:
- Tickets
- States
- Queues
- SLAs
- RBAC
- Audit logs
- Notifications
- Human approvals

LangGraph should sit beside that backend and produce typed recommendations, summaries, risk flags, draft messages, and approval packets.

## Why LangGraph Fits

LangGraph is a good fit for long-running, stateful, human-in-the-loop agent workflows. It supports persistence, checkpointing, replay, durable execution, and human review points, which match Whistle's need for auditable government workflows.

## Agent Opportunities

Agents can support:
- Citizen intake guidance
- Tamil/English normalization
- Complaint category suggestion
- Evidence quality checks
- Location completeness checks
- Protected corruption and retaliation-risk detection
- Duplicate and cluster detection
- Verification triage
- Routing recommendations
- Rejection guardrails
- Citizen clarification drafts
- SLA breach monitoring
- Local/MLA prioritization
- Ministry queue analysis
- CM Cell command briefs
- Directive drafting
- Rejection review scoring
- Protected-case summarization
- RBAC/admin risk review
- Public aggregate insight generation
- QA and synthetic scenario testing

## First Slice

Start with the Intake + Verification graph because every ticket passes through it and it sets the quality of routing, privacy handling, SLA assignment, and rejection review.

The graph should:
- Normalize complaint text
- Suggest category and department
- Assess location confidence
- Check completeness
- Evaluate evidence usefulness
- Detect protected corruption signals
- Search for duplicate candidates
- Recommend route, request-info, protected-review, or reject-candidate
- Produce a reviewer packet for human approval

## Operating Principle

Agents should be recommend-only for the backend MVP. They may produce confidence scores, reasons, evidence references, privacy flags, and draft citizen messages, but humans approve routing, rejection, protected handling, and escalation decisions.

## Proposed Backend Shape

- Python FastAPI backend
- Postgres source of truth
- LangGraph worker with Postgres checkpointing
- Append-only ticket and agent audit events
- React/Vite prototype continues as the frontend surface

## Key Interfaces

The first backend should expose:
- `POST /api/tickets`
- `GET /api/tickets/{id}`
- `GET /api/verification/queue`
- `POST /api/verification/{ticket_id}/agent-runs`
- `POST /api/verification/{ticket_id}/decision`

## Testing Priorities

- Complete civic complaint routes correctly
- Missing location/evidence triggers request-info
- Corruption complaint triggers protected-review
- Duplicate complaints are linked, not deleted
- Rejection remains human-approved and enters mandatory rejection review
- Agent output cannot directly mutate ticket state
- Citizen-facing status never leaks internal reviewer notes or protected identity data
