# Whistle Technical Architecture Proposal

Date: 2026-05-31

Status: Architecture, security, and performance council recommendation for program planning.

## Executive Summary

Whistle should be designed first as a verifiable civic accountability ledger, with citizen and government apps around it.

The stack should be boring, inspectable, secure by default, and capable of growing into a multi-jurisdiction civic operating system. V1 should not start with microservices, autonomous agents, or a public transparency data platform. V1 should prove the secure ticket spine: identity, role scopes, ticket lifecycle, SLA engine, evidence handling, immutable audit, notification jobs, and role-scoped dashboards.

Recommended V1 architecture:

- React + TypeScript PWA and console clients.
- TypeScript modular-monolith API using Fastify or NestJS with OpenAPI contracts.
- PostgreSQL as the system of record.
- PostgreSQL Row-Level Security and application-level policy checks for defense in depth.
- S3-compatible object storage for evidence, with signed URLs, malware scanning, metadata stripping, retention policy, and KMS-backed encryption.
- OIDC identity provider with MFA for officials, preferably Keycloak or an equivalent government-approved provider.
- Postgres-backed outbox and worker queues for SLA jobs, notifications, audit exports, and evidence processing.
- Redis only for ephemeral cache/rate-limit/queue acceleration, never as the source of truth.
- OpenTelemetry instrumentation for traces, metrics, and logs.
- WAF, rate limiting, secrets management, audit pipeline, SIEM integration, backup, and disaster recovery from day one.

V2 can add native Android and iOS apps, a public transparency portal, analytics warehouse, and recommend-only agentic layer. V3 can add field/department workbenches and deeper integrations. V4 can introduce advanced governance, kiosks, call-center assisted filing, and multi-jurisdiction packaging.

## Council Verdict

The council converged on one architectural principle:

> Build the secure ticket spine first; everything else is a client of it.

### Advisor Perspectives

**Contrarian** argued that the real failure mode is not stack weakness but operational security drift across many semi-trusted offices. Evidence leakage, admin misconfiguration, uncontrolled exports, screenshots, shared accounts, and premature protected-category launch are higher-risk than raw scaling.

**First Principles** reframed Whistle as a lifecycle authority for civic accountability. The system must prove who filed what, who saw it, who changed it, why it moved, whether SLA clocks were honored, and whether protected reports stayed shielded.

**Expansionist** saw Whistle as a reusable civic operating system, with Tamil Nadu as the reference implementation. The upside is multi-jurisdiction configuration packs, privacy-preserving analytics, and civic intelligence, but only after the V1 governance workflow is proven.

**Outsider** warned against overbuilding. A working public-service machine with clear ownership, evidence safety, and understandable dashboard counts is more important than microservices, event meshes, or platform ambition in year one.

**Executor** pushed for the first implementation milestone: lock data classification, RBAC scopes, ticket lifecycle, audit events, and evidence handling; then build one vertical path across citizen submission, verification, scoped dashboards, CM escalation, Admin config, and audit.

### Peer Review Highlights

The strongest response was the first-principles framing: Whistle must be a verifiable accountability ledger, not merely a dashboard suite.

The biggest blind spot in the ambitious platform view is that it can underplay insider misuse, admin drift, evidence leakage, and training realities. The blind review also flagged a missing citizen angle: architecture must support multilingual access, low-connectivity use, assisted filing, appeal/reopen rights, and citizen trust, not only official-side controls.

The central tension is ambition versus containment. Whistle should be designed to become a multi-jurisdiction civic OS, but V1 should be deliberately contained until security operations, governance, and workflow discipline are proven.

## Architecture Principles

1. The ticket lifecycle is deterministic and authoritative.
2. Agents, analytics, and dashboards read from governed projections; they do not own lifecycle state.
3. Every active ticket has one primary queue and may have secondary visibility.
4. Every meaningful action writes to an append-only audit ledger.
5. Evidence is never stored in the relational database.
6. Protected complaints are compartmentalized and audited separately.
7. Authorization is enforced at both application and database layers.
8. Public transparency is aggregate-only, delayed where needed, and privacy-thresholded.
9. V1 is a modular monolith; split services only when scale or ownership demands it.
10. Security operations, incident response, backup, and audit export are product features, not infrastructure afterthoughts.

## Recommended V1 Stack

| Layer | Recommendation | Reason |
| --- | --- | --- |
| Citizen app | React + TypeScript PWA, Vite initially | Matches current prototype, fast mobile UX, offline-friendly, avoids SSR/caching complexity for sensitive workflows. |
| Government consoles | React + TypeScript, shared component system | CM Cell, Minister, MLA, Verification, and Admin can share UI primitives while preserving role-specific screens. |
| Public/marketing pages | Static site or Next.js later | Use Next.js only where SSR/SEO matters, such as V2 transparency or public documentation pages. |
| API/backend | TypeScript modular monolith with Fastify or NestJS | One deployable backend keeps V1 secure and operable while preserving modular boundaries. |
| API contracts | OpenAPI + generated clients | Makes mobile, console, partner, and future native app integration safer. |
| Database | PostgreSQL | Source of truth for tickets, lifecycle state, RBAC scopes, SLAs, audit events, and configuration. |
| Authorization | App-level ABAC/RBAC + PostgreSQL RLS | Defense in depth for ministry, district, constituency, ward, team, and protected-category scopes. |
| Object storage | S3-compatible storage | Evidence files, photos, videos, documents, and future exports. Can be cloud S3 or self-hosted MinIO depending deployment policy. |
| Queue/workers | Postgres outbox first, Redis/BullMQ or equivalent for acceleration | Keeps audit-critical jobs durable while supporting notifications, SLA jobs, evidence processing, and exports. |
| Identity | OIDC provider with MFA for officials | Keycloak or government-approved OIDC provider. Citizen auth can start with phone OTP/session model. |
| Secrets/keys | KMS/HSM/Vault-backed secrets and envelope encryption | Required for protected complaints, evidence, and production credentials. |
| Observability | OpenTelemetry + logs/metrics/traces | Needed to debug SLA jobs, queue delays, API latency, and incident response. |
| Deployment | Containers with IaC; Kubernetes/OpenShift when ops team is ready | Containerize from day one. Avoid operational Kubernetes complexity unless the deployment team can run it. |
| Analytics | Postgres materialized views in V1; ClickHouse/warehouse in V2 | Avoid premature data platform; add warehouse for public transparency and scale. |
| Agentic layer | V2 Python FastAPI + LangGraph workers | Recommend-only, isolated from lifecycle mutation, with audit and evaluation. |

## Core System Modules

### Ticket Service

Owns ticket creation, status, lifecycle transitions, queue assignment, SLA clocks, escalation, rejection review state, and citizen-visible timeline.

Required tables include:

- `tickets`
- `ticket_events`
- `ticket_queue_assignments`
- `ticket_status_history`
- `sla_policies`
- `sla_clock_segments`
- `categories`
- `jurisdictions`
- `ministries`
- `departments`

The ticket service is the only authority allowed to change ticket state.

### Identity And Access Service

Owns users, teams, scopes, role grants, temporary grants, MFA state, and access policy.

Required tables include:

- `users`
- `teams`
- `team_memberships`
- `role_grants`
- `permission_profiles`
- `scope_bindings`
- `access_review_events`

Access must support:

- CM Cell statewide scope.
- Minister assigned-ministry scope.
- MLA constituency scope.
- Local ward/panchayat/local-body scope.
- Verification queue scope.
- Rejection review scope.
- Protected complaint scope.
- Admin configuration scope.

### Evidence Service

Owns file metadata, upload sessions, malware scanning, signed access, retention, and evidence visibility.

Required controls:

- Direct-to-object-storage upload through signed URLs.
- Malware scanning before evidence becomes viewable.
- EXIF/metadata stripping where practical.
- Content-type validation and size limits.
- Per-object encryption.
- Evidence access grants tied to ticket role and state.
- No public CDN exposure for private evidence.
- Download disabled by default for sensitive categories.
- Watermark sensitive evidence views with user, timestamp, and ticket ID.

### Audit Service

Owns append-only audit events for ticket, evidence, access, admin, agent, notification, and export actions.

Audit events must capture:

- Actor.
- Role/team/scope.
- Action.
- Entity.
- Before/after where safe.
- Reason code.
- Request correlation ID.
- IP/device/session metadata.
- Sensitive/protected access flag.

Audit logs should be exported to immutable/WORM storage or SIEM-compatible pipelines.

### SLA And Escalation Service

Runs SLA timers, due-soon alerts, breach detection, escalation jobs, and queue transitions.

Rules:

- SLA state is derived from ticket lifecycle and `sla_clock_segments`.
- Awaiting-citizen time must be explicitly configured.
- Escalation transitions write ticket events and audit events.
- Jobs are idempotent and safe to retry.
- Escalation jobs cannot bypass authorization or policy checks.

### Notification Service

Sends citizen and government notifications through pluggable providers.

V1 channels:

- In-app notification log.
- SMS if provider is approved.
- WhatsApp later if policy and provider contracts are ready.

Notification content must avoid exposing sensitive complaint details through insecure channels.

## Security Architecture

Security should be aligned to NIST CSF 2.0 governance and risk-management thinking, with OWASP ASVS/API Security as the application baseline.

### Trust Zones

| Zone | Examples | Security posture |
| --- | --- | --- |
| Public citizen zone | PWA, OTP, complaint submission | Rate-limited, bot-resistant, minimal PII exposure, secure upload flow. |
| Government operations zone | Verification, MLA, Minister, CM Cell | OIDC + MFA, role-scoped APIs, audit on every sensitive action. |
| Admin zone | Users, teams, SLAs, category toggles | Strong MFA, least privilege, approval workflows for critical config, full audit. |
| Protected zone | Corruption/sensitive reports | Compartmentalized access, break-glass logging, stricter evidence controls. |
| Public transparency zone | Aggregate dashboard | No raw production tables, privacy thresholds, delayed data where needed. |
| Agentic zone | V2 recommendation workers | Read from governed projections, no direct mutation, prompt/output audit. |

### Authorization Model

Use layered authorization:

- OIDC authentication for officials.
- Team-based RBAC for broad role assignment.
- Attribute-based checks for ministry, district, constituency, ward, category, queue, and protected state.
- PostgreSQL Row-Level Security for critical tenant/scope enforcement.
- Policy-as-code for higher-level decisions, such as protected access and public visibility.
- Explicit deny by default.

This responds directly to OWASP API Security 2023 risks around broken object-level, object-property, and function-level authorization.

### Data Protection

Data classes:

- Public aggregate data.
- Citizen profile/contact data.
- Ticket operational data.
- Evidence files.
- Protected/sensitive complaint data.
- Admin/security audit data.
- Agent prompts/outputs.

Controls:

- Encryption in transit and at rest.
- Field-level encryption for high-risk attributes where needed.
- KMS-managed key rotation.
- Separate encryption context for protected categories.
- Data retention and deletion policy by class.
- Audit access to PII and evidence.
- Redaction-safe exports.
- Backups encrypted and access-controlled.

### Protected Complaint Controls

Protected corruption or sensitive reports should not be broadly enabled until these are tested:

- Separate protected queue scope.
- Restricted evidence preview.
- Explicit access reason.
- Break-glass workflow.
- Watermarked sensitive views.
- Export controls.
- Incident response runbook.
- Retention and chain-of-custody policy.

## Performance And Scale Architecture

The architecture should comfortably support the reference target of 1 crore citizens, 50,000 complaints/day normal load, and large bursts during crises or public campaigns.

### Scaling Strategy

V1 should scale vertically and horizontally without becoming a microservice system:

- Stateless API replicas behind a load balancer.
- Postgres primary with read replicas for dashboards.
- Table partitioning by time and jurisdiction for large ticket/event/audit tables.
- Materialized views for dashboard aggregates.
- Async evidence upload and processing.
- Queue workers for SLA, notifications, exports, and evidence scanning.
- Cache only non-sensitive read-heavy aggregates.
- CDN only for public static assets, never private evidence.

### Suggested SLOs

| Flow | Target |
| --- | --- |
| Citizen app first load on 4G | Under 3 seconds for core shell after optimization. |
| Complaint submit API | P95 under 800 ms excluding upload time. |
| Ticket status API | P95 under 300 ms. |
| Government queue API | P95 under 500 ms for indexed filters. |
| Dashboard aggregate refresh | Under 60 seconds for operational dashboards. |
| SLA breach job delay | Under 5 minutes from configured breach time. |
| Evidence processing | Malware scan queued within 1 minute; view enabled only after pass. |

### Database Design For Performance

Use:

- Narrow operational tables for ticket state.
- Append-only `ticket_events` and `audit_ledger`.
- Partition large append-only tables monthly or by volume.
- Composite indexes for role filters: ministry, district, constituency, ward, queue, status, SLA state.
- Read models/materialized views for dashboards.
- Avoid joining raw audit/evidence tables in operational queue screens.
- Use cursor pagination everywhere.
- Use idempotency keys for citizen submission and workflow decisions.

## Agentic Architecture For V2

Agents should start as recommend-only.

Recommended V2 stack:

- Python FastAPI agent service.
- LangGraph workers with persistent checkpoints.
- Postgres projections/read replicas as governed input.
- Optional pgvector or dedicated vector store for duplicate/context search after privacy review.
- Agent run table with prompt version, model version, inputs, outputs, confidence, reasons, reviewer decision, and audit event.

Agents may:

- Suggest category/department.
- Detect missing information.
- Find duplicate candidates.
- Draft citizen clarification messages.
- Recommend protected-review routing.
- Score rejection risk.
- Summarize SLA risk.
- Draft CM/ministry briefs.

Agents must not:

- Directly change ticket state.
- Directly notify citizens without human-approved templates.
- Access raw protected evidence unless explicitly authorized.
- Train on sensitive data without approval and anonymization.
- Feed public transparency directly.

## Deployment Options

### V1 Practical Deployment

Use containerized services with clear separation:

- `web-citizen`
- `web-console`
- `api`
- `worker`
- `postgres`
- `object-storage`
- `identity`
- `observability`

If the deployment environment has mature Kubernetes/OpenShift operations, deploy there. If not, use a simpler managed container or VM-based deployment first. Kubernetes horizontal pod autoscaling is useful once the team can operate it, but it is not a reason to create microservices in V1.

### Environment Separation

Required environments:

- Local developer environment using Docker Compose.
- Dev environment with seed data.
- Staging environment with production-like auth and storage.
- Security test environment.
- Production.

Never use production evidence or citizen PII in lower environments without explicit anonymization.

## Technology Choices By Phase

| Phase | Stack posture |
| --- | --- |
| V0 | Architecture ADRs, threat model, data model, Docker Compose, prototype hardening, deployment decision. |
| V1 | React/Vite clients, TypeScript modular API, Postgres, object storage, OIDC/MFA, audit ledger, workers, OpenTelemetry. |
| V2 | Native Android/iOS apps, public transparency app, analytics warehouse, privacy thresholds, recommend-only Python/LangGraph agent service. |
| V3 | Field mobile/workbench modules, integrations, stronger search, workflow automation, offline/low-connectivity support. |
| V4 | Call-center/kiosk flows, data warehouse scale-out, advanced protected workflow, multi-jurisdiction packs. |

## Key Architecture Decisions

### Use A Modular Monolith For V1

V1 should be one backend codebase with strong internal modules. This avoids distributed transaction complexity, duplicated authorization logic, and observability overhead before the workflow is proven.

Split later only when there is evidence:

- Evidence processing becomes independently heavy.
- Notifications need provider-specific scaling.
- Agent workers need separate compute/security boundaries.
- Public analytics needs a separate warehouse.
- Integrations require isolation.

### Keep PostgreSQL As Source Of Truth

Postgres owns lifecycle state, audit state, RBAC scopes, and operational configuration. Events and queues may distribute changes, but no event bus should become the system of record in V1.

### Treat Evidence As A Separate Security Product

Evidence is the highest-risk data class. It must have its own upload, storage, scanning, access, retention, export, and audit controls.

### Build For Multi-Jurisdiction, Launch Single-Jurisdiction

The data model should support tenant/jurisdiction boundaries from day one, but the first deployment should be operationally contained. This preserves future reuse without increasing V1 blast radius.

## First 30-Day Technical Plan

### Week 1: Architecture Lock

- Write ADRs for stack, data classification, authorization, evidence, audit, deployment, and agent isolation.
- Define core schema: tickets, events, audit, users, teams, scopes, categories, jurisdictions, evidence, SLA policies.
- Define OpenAPI contracts for citizen submission, ticket status, verification queue, role dashboards, Admin config.
- Produce the first threat model.

### Week 2: Secure Spine Prototype

- Build API skeleton with OIDC integration.
- Implement ticket creation and status.
- Implement role/scope model.
- Implement audit ledger writes.
- Implement object-storage upload session and evidence metadata.
- Add OpenTelemetry baseline traces/logs.

### Week 3: V1 Vertical Path

- Citizen submits ticket.
- Verification routes/request-info/rejects.
- MLA/Minister/CM Cell sees scoped queue.
- Admin changes SLA/category config.
- SLA worker creates due/breach events.
- Every action writes audit events.

### Week 4: Security And Performance Gate

- Run authorization tests for every role/scope.
- Run protected complaint access tests.
- Run upload/malware-scan flow tests.
- Run basic load tests for submit/status/queue/dashboard APIs.
- Run backup/restore drill.
- Produce V1 go/no-go checklist.

## Open Questions To Resolve Before Build

- Hosting and data residency requirements.
- Government-approved OIDC/MFA provider.
- Citizen OTP provider and WhatsApp/SMS provider.
- Whether corruption is disabled, protected-only, or fully enabled in V1.
- Official role hierarchy and action powers.
- Exact evidence retention and export policy.
- Whether Admin changes require two-person approval for critical settings.
- Whether public transparency needs delayed publishing and minimum-cell thresholds in V2.
- Which V2 native app approach should be used after PWA validation: Capacitor wrapper, React Native, or fully native Android/iOS.

## Reference Anchors

- [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x00-header/): authorization risks are central for API systems with complex user hierarchies.
- [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework): governance is a first-class security function.
- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html): database-side row policies can restrict rows returned or modified by users.
- [Keycloak OpenID Connect documentation](https://www.keycloak.org/securing-apps/oidc-layers): OIDC endpoints and flows support official-user authentication and token handling.
- [OpenTelemetry documentation](https://opentelemetry.io/docs/): vendor-neutral traces, metrics, and logs support production observability.
- [Kubernetes Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/): useful for scaling workloads when the operations team is ready.
