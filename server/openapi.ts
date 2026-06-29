export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Whistle MVP Ticket Spine API",
    version: "0.1.0",
    description:
      "Whistle MVP API contract for citizen submission, ticket status, verification queue, Admin configuration, evidence handling, worker jobs, role-scoped dashboards, human-approved verification decisions, and V3 field execution/reopen workflows. Local prototype authorization uses x-whistle-role and x-whistle-actor headers; when WHISTLE_OFFICIAL_OIDC_ISSUER, WHISTLE_OFFICIAL_OIDC_AUDIENCE, and a signing source are configured, government APIs require OIDC bearer tokens with MFA assurance and map token role/actor claims into Whistle access grants. Requests may provide x-whistle-correlation-id or x-request-id; the API echoes x-whistle-correlation-id, returns x-whistle-duration-ms, emits structured request logs, and stamps audit events created during that request.",
  },
  paths: {
    "/api/health": {
      get: {
        summary: "Service health",
        responses: { "200": { description: "API is reachable" } },
      },
    },
    "/api/ready": {
      get: {
        summary: "Service readiness",
        description:
          "Checks whether the configured ticket spine, official auth mode, worker authentication, Admin config, access-control, citizen phone verification, citizen OTP delivery, evidence-object-store, notification-delivery, security-export, telemetry-export, and public rate-limit dependencies are usable. This is intended for deployment readiness probes; it returns only modes, probe status, latency, and sanitized dependency errors. If WHISTLE_PROTOTYPE_OFFICIAL_AUTH=false or the deployment profile is staging/production and no OIDC/MFA provider is configured, readiness fails and government APIs reject prototype role headers. If WHISTLE_OFFICIAL_OIDC_ISSUER, WHISTLE_OFFICIAL_OIDC_AUDIENCE, and WHISTLE_OFFICIAL_OIDC_HS256_SECRET or WHISTLE_OFFICIAL_OIDC_JWKS_URL are configured, official auth runs in oidc-jwt mode and requires bearer tokens with MFA assurance. If WHISTLE_WORKER_AUTH_REQUIRED=true or the deployment profile is staging/production, readiness fails until WHISTLE_WORKER_SHARED_SECRET is configured for worker jobs. If the deployment profile is staging/production and no webhook OTP provider is configured, readiness fails and citizen OTP start returns 503 instead of falling back to mock SMS. If WHISTLE_EVIDENCE_OBJECT_STORE_MODE=disabled, or if the deployment profile is staging/production and no S3-compatible evidence store is configured, readiness fails and evidence upload completion returns storage unavailable. If WHISTLE_NOTIFICATION_PROVIDER_MODE=disabled, or if the deployment profile is staging/production and no webhook notification provider is configured, readiness fails and notification jobs record failed attempts instead of marking messages sent. If WHISTLE_NOTIFICATION_PROVIDER_MODE=webhook, readiness requires WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL and WHISTLE_NOTIFICATION_PROVIDER_API_KEY. If WHISTLE_SECURITY_EXPORT_MODE=disabled, or if the deployment profile is staging/production and no webhook SIEM/WORM provider is configured, readiness fails and governance audit export cannot pretend external retention happened. If WHISTLE_SECURITY_EXPORT_MODE=webhook, readiness requires WHISTLE_SECURITY_EXPORT_WEBHOOK_URL and WHISTLE_SECURITY_EXPORT_API_KEY for SIEM/WORM export. If WHISTLE_TELEMETRY_EXPORT_MODE=disabled, or if the deployment profile is staging/production and no OpenTelemetry endpoint is configured, readiness fails instead of silently keeping local-only telemetry. If WHISTLE_TELEMETRY_EXPORT_MODE=otlp-http or WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT is configured, readiness requires a valid OpenTelemetry HTTP endpoint. If the deployment profile is staging/production and no shared public rate-limit backend is configured, readiness fails and public citizen endpoints return 503 instead of falling back to in-memory rate limits. If WHISTLE_RATE_LIMIT_BACKEND=gateway, readiness requires WHISTLE_RATE_LIMIT_GATEWAY_URL and WHISTLE_RATE_LIMIT_GATEWAY_API_KEY. If WHISTLE_RATE_LIMIT_BACKEND=postgres, readiness requires the migrated public_rate_limit_buckets table and stores only hashed public bucket keys.",
        responses: {
          "200": { description: "API dependencies are ready" },
          "503": { description: "One or more API dependencies are not ready" },
        },
      },
    },
    "/api/metrics": {
      get: {
        summary: "Service request metrics",
        description:
          "Returns PII-safe in-process API request counters and route-pattern latency summaries for pilot operations and exports the same sanitized snapshot through the configured telemetry exporter when enabled. Local MVP mode keeps telemetry in process for development only; staging/production profiles require a configured OpenTelemetry endpoint instead of local-only telemetry. Access is limited to Admin and CM Cell prototype roles with observability.metrics.read grants. The response contains route patterns, status counts, latency summaries, and buckets; it does not include query strings, phone numbers, ticket descriptions, evidence, or citizen identity.",
        responses: {
          "200": { description: "PII-safe route metrics snapshot" },
          "403": { description: "Role or grant cannot read observability metrics" },
        },
      },
    },
    "/api/tickets": {
      post: {
        summary: "Create a citizen ticket",
        description:
          "Creates a ticket in the secure ticket spine. Citizen submissions include a short-lived mock phone verification token while the Admin OTP-required control is enabled. Public citizen intake is readiness-aware and rate-limited: launch-ready categories are accepted, pilot-only protected categories enter protected screening, and other pilot/blocked categories return a safe rejection reason. Staging/production without a shared public rate-limit backend returns 503 instead of falling back to local in-memory limits. Admin maintenance mode pauses new public citizen submissions with a safe rejection while existing ticket tracking remains available. Corruption complaints enter protected screening; other complaints enter ticket verification. Supports the Idempotency-Key header so citizen retries do not create duplicate tickets; changed payload reuse is rejected.",
        responses: {
          "200": { description: "Complaint was not accepted because an Admin policy disabled the category, readiness blocks citizen intake, or an idempotent retry returned the original ticket" },
          "201": { description: "Ticket created" },
          "400": { description: "Invalid complaint payload" },
          "401": { description: "Citizen phone verification is missing, invalid, or expired" },
          "403": { description: "Verified phone token does not match the complaint phone number" },
          "409": { description: "Idempotency-Key was reused with a changed request" },
          "429": { description: "Citizen ticket creation rate limit exceeded" },
          "503": { description: "Public citizen rate limiting or another intake dependency is unavailable" },
        },
      },
    },
    "/api/tickets/{ticketId}": {
      get: {
        summary: "Get ticket status",
        description:
          "Returns a single ticket after role-scoped ticket read authorization. Citizen callers must provide x-whistle-citizen-phone and x-whistle-citizen-token headers so a ticket ID alone cannot open another citizen's complaint. Government reads of protected complaints require x-whistle-access-reason and write a sensitive protected-access audit event.",
        responses: {
          "200": { description: "Ticket found" },
          "401": { description: "Citizen phone verification is missing, invalid, or expired" },
          "403": { description: "Role or verified citizen phone cannot read this ticket" },
          "404": { description: "Ticket not found" },
        },
      },
    },
    "/api/citizen/tickets": {
      get: {
        summary: "List tickets for a verified citizen phone",
        description:
          "MVP citizen My Tickets lookup. The request supplies the phone query plus x-whistle-citizen-phone and x-whistle-citizen-token headers from mock OTP verification. The API validates that the token belongs to the requested phone, hashes the phone for matching, and returns only a bounded page of tickets for that phone. Cursor pagination is supported for high-volume lookups; offset remains for prototype compatibility. Raw phone numbers are not stored or returned; production should replace this with OTP/session-bound citizen authentication.",
        parameters: [
          { name: "phone", in: "query", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "x-whistle-citizen-phone", in: "header", required: true, schema: { type: "string" } },
          { name: "x-whistle-citizen-token", in: "header", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Citizen ticket list from the ticket spine" },
          "400": { description: "Invalid phone lookup query" },
          "401": { description: "Citizen phone verification is missing, invalid, or expired" },
          "403": { description: "Role or verified phone cannot read this citizen ticket list" },
          "429": { description: "Citizen ticket lookup rate limit exceeded" },
          "503": { description: "Public citizen rate limiting is unavailable" },
        },
      },
    },
    "/api/citizen/config": {
      get: {
        summary: "Get citizen-safe launch configuration",
        description:
          "Returns only citizen-safe category availability and public asset-use policy for the mobile PWA: labels, sensitivity, enabled flag, intake status, short public message, and whether neutral-or-approved logo/emblem/portrait assets can be used. During Admin maintenance mode, every category is reported as disabled with a public maintenance message so the citizen PWA can stop new intake without exposing internal controls. It intentionally omits Admin owners, SOP/training internals, role grants, SLA policy details, and protected handling internals. MVP1 defaults expose neutral Whistle-owned placeholder assets; official marks, government emblems, and public-figure likenesses must stay out unless separately approved.",
        responses: {
          "200": { description: "Citizen-safe category availability" },
          "403": { description: "Role cannot read citizen launch configuration" },
        },
      },
    },
    "/api/citizen/otp/start": {
      post: {
        summary: "Start citizen phone OTP verification",
        description:
          "Creates a short-lived OTP challenge for the citizen phone number and routes it through the configured OTP delivery provider. Local MVP mode can use a mock SMS provider, with WHISTLE_EXPOSE_MOCK_OTP=false hiding the mock code from API responses while verification still works through the provider seam. WHISTLE_OTP_PROVIDER_MODE=webhook sends the OTP to a configured SMS/OTP webhook and returns only masked phone, provider mode, and provider message id. WHISTLE_OTP_PROVIDER_MODE=disabled, or staging/production without a webhook OTP provider, fails readiness and returns 503 instead of creating fake challenges. Public OTP start is rate-limited per phone/IP bucket. Staging/production without WHISTLE_RATE_LIMIT_BACKEND=gateway or WHISTLE_RATE_LIMIT_BACKEND=postgres returns 503 instead of using local in-memory limits. WHISTLE_RATE_LIMIT_BACKEND=gateway sends only hashed bucket keys to a managed rate-limit gateway for multi-instance launch safety; WHISTLE_RATE_LIMIT_BACKEND=postgres shares hashed buckets through Postgres.",
        responses: {
          "201": { description: "OTP challenge created" },
          "400": { description: "Invalid phone payload" },
          "403": { description: "Role cannot start citizen phone verification" },
          "503": { description: "Citizen OTP delivery provider or public rate-limit backend is unavailable" },
          "429": { description: "Citizen OTP start rate limit exceeded" },
        },
      },
    },
    "/api/citizen/otp/verify": {
      post: {
        summary: "Verify citizen phone OTP",
        description:
          "Validates the OTP challenge and returns a short-lived phone verification token. Citizen ticket creation requires this token while the Admin `citizen-phone-otp-required` control is enabled.",
        responses: {
          "200": { description: "Phone verification token issued" },
          "400": { description: "Invalid OTP payload" },
          "401": { description: "OTP was incorrect or phone verification is required" },
          "410": { description: "OTP challenge expired" },
          "423": { description: "OTP challenge locked after too many attempts" },
          "429": { description: "Citizen OTP verify rate limit exceeded" },
        },
      },
    },
    "/api/tickets/{ticketId}/notifications": {
      get: {
        summary: "List citizen notification history for a ticket",
        description:
          "Returns notification outbox records for the ticket after role-scoped ticket read authorization. Citizen callers must prove ownership with x-whistle-citizen-phone and x-whistle-citizen-token headers. External-channel messages are safe summaries and do not include raw evidence or sensitive complaint details.",
        responses: {
          "200": { description: "Ticket notification history" },
          "401": { description: "Citizen phone verification is missing, invalid, or expired" },
          "403": { description: "Role cannot read this ticket's notifications" },
          "404": { description: "Ticket not found" },
        },
      },
    },
    "/api/tickets/{ticketId}/citizen-update": {
      post: {
        summary: "Submit citizen clarification after request-info",
        description:
          "Adds citizen-provided details/evidence after the caller proves ownership with x-whistle-citizen-phone and x-whistle-citizen-token headers. Returns the ticket to the verification primary queue, restarts the verification SLA, and writes citizen/government timeline plus audit events. Supports the Idempotency-Key header so retries do not append duplicate evidence or timeline updates; changed payload reuse is rejected.",
        responses: {
          "200": { description: "Citizen update accepted and ticket returned to verification" },
          "400": { description: "Invalid citizen update payload" },
          "401": { description: "Citizen phone verification is missing, invalid, or expired" },
          "403": { description: "Verified citizen phone does not own this ticket" },
          "404": { description: "Ticket not found" },
          "409": { description: "Idempotency-Key was reused with a changed request" },
          "429": { description: "Citizen ticket update rate limit exceeded" },
        },
      },
    },
    "/api/tickets/{ticketId}/reopen-dispute": {
      post: {
        summary: "Submit citizen reopen/dispute request after resolution",
        description:
          "Allows a verified ticket owner to dispute a resolved ticket. Citizen callers must prove ownership with x-whistle-citizen-phone and x-whistle-citizen-token headers. The ticket returns to verification as primary queue, prior owners remain secondary, CM Cell receives oversight visibility, evidence metadata can be attached, and audit plus citizen-safe notifications are written. Supports the Idempotency-Key header so retries do not reopen twice or append duplicate evidence; changed payload reuse is rejected.",
        responses: {
          "200": { description: "Ticket reopened and returned to verification" },
          "400": { description: "Invalid dispute payload" },
          "401": { description: "Citizen phone verification is missing, invalid, or expired" },
          "403": { description: "Verified citizen phone does not own this ticket" },
          "404": { description: "Ticket not found" },
          "409": { description: "Ticket is not resolved yet or Idempotency-Key was reused with a changed request" },
          "429": { description: "Citizen reopen/dispute rate limit exceeded" },
        },
      },
    },
    "/api/tickets/{ticketId}/field-actions": {
      post: {
        summary: "Record field execution action",
        description:
          "V3 field-workflow endpoint for department officers, ministers, MLAs, councillors, and CM Cell. Supports field visit scheduling, field report/evidence metadata, transfer-with-reason, and resolution with closure checklist. Actions are role/scope checked, mutate only the ticket spine, and write audit plus citizen-safe notifications.",
        responses: {
          "200": { description: "Field action applied" },
          "400": { description: "Invalid field action payload" },
          "403": { description: "Role or scope cannot perform field action" },
          "404": { description: "Ticket not found" },
          "409": { description: "Ticket is not in a field-actionable state or closure checklist is incomplete" },
        },
      },
    },
    "/api/tickets/{ticketId}/evidence/upload-session": {
      post: {
        summary: "Create a governed evidence upload session",
        description:
          "Creates evidence metadata with security controls only after the actor can read the ticket and has an evidence-upload grant for the ticket scope. Citizen callers must also prove ticket ownership with x-whistle-citizen-phone and x-whistle-citizen-token headers. Returns a signed direct-upload contract, marks the item upload_pending, and writes an evidence audit event. Upload_pending evidence is not previewable and is not scan-eligible until the upload-completion endpoint confirms the object metadata. The MVP records classification, retention policy, encryption context, metadata stripping policy, no-download policy, and watermark requirement. Local mode uses a mock object-store ledger for development only. Staging/production profiles disable that local ledger; S3-compatible declarations currently fail closed until a real remote object-store adapter exists.",
        responses: {
          "201": { description: "Evidence upload session created" },
          "400": { description: "Invalid evidence metadata" },
          "403": { description: "Role or scope cannot upload evidence for this ticket" },
          "404": { description: "Ticket not found" },
          "429": { description: "Citizen evidence upload-session rate limit exceeded" },
        },
      },
    },
    "/api/tickets/{ticketId}/evidence/{evidenceId}/complete-upload": {
      post: {
        summary: "Complete a governed evidence upload",
        description:
          "Confirms that a previously issued evidence upload session has a matching object payload before the scanner can process it. The actor must be able to read the ticket and have evidence upload-completion access for the ticket scope; citizen callers must also prove ticket ownership. The MVP validates file type and size against the signed session metadata, records a configured object-storage receipt with checksum, moves evidence from upload_pending to scan_pending, and writes audit. WHISTLE_EVIDENCE_OBJECT_STORE_MODE=disabled makes readiness fail and this endpoint return storage unavailable instead of pretending evidence was stored. Staging/production profiles also disable local/mock evidence storage; WHISTLE_EVIDENCE_OBJECT_STORE_MODE=s3-compatible now fails closed until a real adapter performs remote object verification with private bucket policy, KMS, data residency, and scanner verdict checks. Production should drive this from trusted object-storage callbacks or a verified upload proxy.",
        responses: {
          "200": { description: "Evidence upload completed and queued for scan" },
          "400": { description: "Invalid upload-completion payload" },
          "403": { description: "Role or scope cannot complete evidence upload for this ticket" },
          "404": { description: "Ticket or evidence not found" },
          "409": { description: "Evidence is not upload_pending or object metadata does not match the signed session" },
          "429": { description: "Citizen evidence upload rate limit exceeded" },
          "503": { description: "Evidence object store is unavailable or disabled" },
        },
      },
    },
    "/api/tickets/{ticketId}/evidence": {
      get: {
        summary: "List role-scoped evidence metadata/access",
        description:
          "Returns evidence metadata, security controls, and preview access only after the actor can read the ticket and has evidence-read access for the ticket scope. Citizen callers must also prove ticket ownership with x-whistle-citizen-phone and x-whistle-citizen-token headers. Protected evidence is denied to local/MLA/ministry/citizen prototype roles. Government reads of protected evidence require x-whistle-access-reason or accessReason and write a sensitive protected-access audit event. Preview access is signed, watermarked, and no-download by default.",
        parameters: [
          { name: "role", in: "query", required: false, schema: { enum: ["citizen", "cm_cell", "minister", "department_officer", "mla", "councillor", "verification", "admin"] } },
          { name: "actor", in: "query", required: false, schema: { type: "string" } },
          { name: "accessReason", in: "query", required: false, schema: { type: "string", minLength: 8, maxLength: 240 } },
          { name: "x-whistle-access-reason", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 240 } },
        ],
        responses: {
          "200": { description: "Role-scoped evidence access result" },
          "400": { description: "Invalid access query" },
          "403": { description: "Role or scope cannot read evidence for this ticket" },
          "404": { description: "Ticket not found" },
        },
      },
    },
    "/api/verification/queue": {
      get: {
        summary: "List verification queue",
        description: "Returns a bounded cursor-capable page of tickets currently awaiting verification or protected screening. Optional q searches non-sensitive operational fields so large queues can be filtered without exposing citizen identity. Offset remains available for prototype compatibility, but clients should prefer cursor/nextCursor for high-volume queues.",
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "q", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Verification queue page" }, "400": { description: "Invalid queue filter" } },
      },
    },
    "/api/verification/{ticketId}/agent-runs": {
      get: {
        summary: "List intake recommendation runs for a ticket",
        description:
          "Returns logged V2 recommend-only intake intelligence runs for a ticket in verification/protected intake. Agent runs are advisory and cannot mutate ticket lifecycle state.",
        responses: {
          "200": { description: "Recommendation runs" },
          "403": { description: "Role or grant cannot inspect recommendation runs" },
          "404": { description: "Ticket not found" },
          "409": { description: "Ticket is no longer in intake" },
        },
      },
      post: {
        summary: "Create a recommend-only intake recommendation",
        description:
          "Creates a deterministic MVP agent recommendation packet for human verification review. It records prompt/model versions, input hash, confidence, reasons, privacy flags, draft citizen message, and audit event. It does not change status, queues, SLA clocks, evidence, or notifications.",
        responses: {
          "201": { description: "Recommendation run created" },
          "403": { description: "Role or grant cannot run recommendations" },
          "404": { description: "Ticket not found" },
          "409": { description: "Ticket is no longer in intake" },
        },
      },
    },
    "/api/dashboard": {
      get: {
        summary: "Get role-scoped operational dashboard read model",
        description:
          "Returns scoped KPIs, district/ministry aggregates, dashboard read-model metadata, and a bounded cursor-capable page of ticket summaries for CM Cell, Minister, Department Officer, MLA, Councillor, and Verification prototype roles. The Postgres repository calculates aggregates through SQL projections and hydrates only the returned ticket rows. The effective x-whistle-role must match the requested dashboard role. Admin is intentionally kept out of operational ticket queues; Admin configuration is exposed through /api/admin/config. This read model is derived from the ticket spine and does not mutate lifecycle state.",
        parameters: [
          { name: "role", in: "query", required: false, schema: { enum: ["cm_cell", "minister", "department_officer", "mla", "councillor", "verification", "admin"] } },
          { name: "ministry", in: "query", required: false, schema: { type: "string" } },
          { name: "district", in: "query", required: false, schema: { type: "string" } },
          { name: "constituency", in: "query", required: false, schema: { type: "string" } },
          { name: "ward", in: "query", required: false, schema: { type: "string" } },
          { name: "queue", in: "query", required: false, schema: { type: "string" } },
          { name: "q", in: "query", required: false, schema: { type: "string" } },
          { name: "ticketLimit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "ticketOffset", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } },
          { name: "ticketCursor", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Role-scoped dashboard" }, "400": { description: "Invalid filter" } },
      },
    },
    "/api/dashboard/explain": {
      get: {
        summary: "Explain role-scoped dashboard counts",
        description:
          "Returns the definitions, source fields, scope rules, projection metadata, applied filters, and privacy guarantees used to calculate a role dashboard. Admin can use this endpoint to explain counts without entering operational ticket queues; non-Admin roles can explain only their own scoped dashboard. In Postgres mode the explanation reuses the SQL projection-backed dashboard read model. The response contains aggregate definitions and counts, not ticket IDs, citizen identity, raw complaint text, phone hashes, evidence, or search text.",
        responses: {
          "200": { description: "Dashboard count explanation" },
          "400": { description: "Invalid dashboard filter" },
          "403": { description: "Role or grant cannot explain this dashboard" },
        },
      },
    },
    "/api/dashboard/briefs": {
      post: {
        summary: "Create a recommend-only dashboard SLA brief",
        description:
          "Creates an audited V2 recommendation brief for CM Cell or a scoped Minister dashboard. The brief summarizes SLA risk, focus areas, recommended actions, and watchlist tickets from governed dashboard projections. It cannot mutate ticket lifecycle state, queues, SLA clocks, notifications, evidence, or citizen-visible messages.",
        responses: {
          "201": { description: "Dashboard brief run created" },
          "400": { description: "Invalid dashboard brief request or unsupported role" },
          "403": { description: "Role or grant cannot create the scoped brief" },
        },
      },
    },
    "/api/public/insights": {
      get: {
        summary: "Get public aggregate transparency insights",
        description:
          "Returns V2 public transparency metrics derived from the ticket spine. The response is aggregate-only, applies the configured publication delay and small-cell thresholds, exposes only neutral-or-approved public asset URLs, excludes ticket ids, names, phone numbers, addresses, raw complaint text, raw evidence, timelines, and protected complaint details, and can be disabled by the Admin public aggregate insights feature flag. The publication delay is governed by the public-publish-delay-hours Admin control.",
        responses: {
          "200": { description: "Aggregate-only public insights" },
          "403": { description: "Public aggregate insights are disabled by Admin configuration" },
        },
      },
    },
    "/api/jobs/sla-escalations/run": {
      post: {
        summary: "Run the SLA escalation job",
        description:
          "MVP worker trigger that processes a bounded batch of due active SLA clocks, escalates local tickets to ministry, escalates ministry tickets to CM Cell, marks other breached stages, preserves secondary visibility, and writes audit events. The request body accepts limit, defaulting to 100 and capped at 500, and the result reports hasMore so schedulers can continue safely. Prototype policy allows only worker/admin roles; when worker auth is required, worker callers must send x-whistle-worker-token or a Bearer token.",
        responses: {
          "200": { description: "SLA job result with per-ticket actions" },
          "400": { description: "Invalid job payload" },
        },
      },
    },
    "/api/jobs/evidence-scans/run": {
      post: {
        summary: "Run the evidence scan job",
        description:
          "MVP worker trigger that asks the configured evidence object-store/scanner seam to inspect a bounded batch of scan_pending evidence before moving it to available or blocked states. Upload sessions left in upload_pending are ignored until upload completion is recorded; scan_pending records without a completed object receipt are skipped for retry. The request body accepts limit, defaulting to 100 and capped at 500, and the result reports hasMore so schedulers can continue safely. Clean files are marked metadata-stripped before preview. If the configured object store is disabled, misconfigured, or unavailable, the endpoint returns 503 when scan-pending work needs that provider. Prototype policy allows only worker/admin roles; when worker auth is required, worker callers must send x-whistle-worker-token or a Bearer token. Production should back this with object storage callbacks, malware scanning, and metadata stripping.",
        responses: {
          "200": { description: "Evidence scan job result with per-object actions" },
          "400": { description: "Invalid job payload" },
          "503": { description: "Evidence object store is unavailable or disabled" },
        },
      },
    },
    "/api/jobs/notifications/run": {
      post: {
        summary: "Run the notification outbox job",
        description:
          "MVP worker trigger that sends a bounded batch of queued in-app/SMS/WhatsApp notification intents through the configured notification-delivery provider and writes notification audit events. The request body accepts limit, defaulting to 100 and capped at 500, and the result reports hasMore so schedulers can continue safely. The default local provider is a mock provider for development only. WHISTLE_NOTIFICATION_PROVIDER_MODE=disabled makes readiness fail and marks delivery attempts failed so missing provider contracts cannot masquerade as successful delivery. Staging/production profiles also disable mock notification delivery unless WHISTLE_NOTIFICATION_PROVIDER_MODE=webhook is configured. WHISTLE_NOTIFICATION_PROVIDER_MODE=webhook posts only citizen-safe payloads with masked recipients and safe messages, then preserves provider message ids for delivery audit. When worker auth is required, worker callers must send x-whistle-worker-token or a Bearer token. Production should replace this with approved SMS/WhatsApp providers.",
        responses: {
          "200": { description: "Notification job result with per-message actions" },
          "400": { description: "Invalid job payload" },
          "403": { description: "Only worker/admin roles can run the job" },
        },
      },
    },
    "/api/verification/{ticketId}/decision": {
      post: {
        summary: "Record a human verification decision",
        description:
          "Supports request-info, reject, route-local, and route-protected decisions only while the ticket is in verification/protected intake. Every decision writes ticket and audit events. Protected complaints cannot be routed to local/MLA visibility through the ordinary route-local action. Supports the Idempotency-Key header so verifier retries do not apply a decision twice; changed payload reuse is rejected.",
        responses: {
          "200": { description: "Decision applied" },
          "400": { description: "Invalid verification decision payload" },
          "403": { description: "Role or grant cannot make verification decisions" },
          "404": { description: "Ticket not found" },
          "409": { description: "Ticket is no longer decisionable by verification, protected-local routing is blocked, or Idempotency-Key was reused with a changed request" },
        },
      },
    },
    "/api/rejection-review/{ticketId}/decision": {
      post: {
        summary: "Record a CM-maintained rejection-review decision",
        description:
          "Allows CM Cell rejection reviewers to uphold and close a valid rejection, request additional citizen information, or overturn an improper rejection and route it to a local accountable owner. Decisions are state-scoped, audited, citizen-notified where appropriate, and preserve rejection-review oversight as secondary visibility.",
        responses: {
          "200": { description: "Rejection-review decision applied" },
          "400": { description: "Invalid rejection-review payload" },
          "403": { description: "Role or grant cannot perform rejection review" },
          "404": { description: "Ticket not found" },
          "409": { description: "Ticket is not in rejection review or protected-local routing is blocked" },
        },
      },
    },
    "/api/audit": {
      get: {
        summary: "List MVP audit events",
        description:
          "Admin/CM Cell/Verification inspection endpoint for append-only audit events. Returns a bounded cursor-capable page ordered by audit chain sequence. Optional ticketId scopes the page to one ticket. Verification users must supply ticketId and the ticket must still be visible through verification, protected-review, rejection-review, or retained secondary queue scope; broad audit pages are limited to Admin and CM Cell. Ticket-scoped reads for protected complaints require x-whistle-access-reason and are themselves written to the sensitive audit ledger. Offset remains available for prototype compatibility, but clients should prefer cursor/nextCursor for high-volume audit review.",
        parameters: [
          { name: "ticketId", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "x-whistle-access-reason", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 240 } },
        ],
        responses: { "200": { description: "Audit events" }, "400": { description: "Invalid audit filter or cursor" }, "403": { description: "Role cannot inspect audit events" } },
      },
    },
    "/api/notifications/outbox": {
      get: {
        summary: "List notification outbox records",
        description:
          "Admin/CM Cell/Verification inspection endpoint for queued and sent notification intents. Returns a bounded cursor-capable page ordered by creation time. Optional ticketId scopes the page to one ticket. Verification users must supply ticketId and the ticket must still be visible through verification, protected-review, rejection-review, or retained secondary queue scope; broad outbox pages are limited to Admin and CM Cell. Ticket-scoped reads for protected complaints require x-whistle-access-reason and are themselves written to the sensitive audit ledger. This is an MVP operations view, not a public transparency surface.",
        parameters: [
          { name: "ticketId", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "x-whistle-access-reason", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 240 } },
        ],
        responses: {
          "200": { description: "Notification outbox records" },
          "400": { description: "Invalid outbox filter or cursor" },
          "403": { description: "Role cannot inspect notification outbox" },
        },
      },
    },
    "/api/admin/config": {
      get: {
        summary: "Get Admin configuration snapshot",
        description: "Returns governed category toggles, launch-readiness matrix, SLA policies, privacy controls, language flags, and notification controls.",
        responses: { "200": { description: "Admin configuration snapshot" } },
      },
    },
    "/api/admin/launch-readiness": {
      get: {
        summary: "Get V1 launch readiness report",
        description:
          "Returns a server-derived V0/V1 go/no-go report over category readiness, role/team setup, SLA policy, protected-track controls, production provider seams, runtime deployment preflight blockers, critical approval queue, citizen communication controls, and asset/identity approval controls. Admin approval toggles alone cannot make launch ready while runtime preflight still reports local/mock/missing production dependencies.",
        responses: {
          "200": { description: "Launch readiness report" },
          "403": { description: "Role or grant cannot read launch readiness" },
        },
      },
    },
    "/api/admin/deployment-preflight": {
      get: {
        summary: "Get production deployment preflight report",
        description:
          "Returns a hard deployment preflight for security and scale gates. The report separates local API readiness from production safety and flags blockers such as in-memory repositories, prototype or disabled official auth instead of OIDC/MFA, HS256 local-smoke OIDC signing instead of HTTPS JWKS key rotation, HS256 secrets left configured alongside JWKS outside local smoke tests, missing worker service authentication, mock OTP/SMS, exposed mock OTP, local or disabled evidence storage, missing S3-compatible evidence endpoint/bucket/KMS/scanning declarations, mock or disabled notifications without webhook/provider contracts, in-memory public rate limits instead of Postgres/shared gateway backing, missing deployment-specific rate-limit bucket salt, copied-template/localhost/example/smoke-test values in provider env, local or disabled security export instead of SIEM/WORM webhook wiring, missing deployment runbook version or fresh restore-drill timestamp evidence, and local/disabled telemetry instead of OpenTelemetry HTTP export.",
        responses: {
          "200": { description: "Deployment preflight report" },
          "403": { description: "Role or grant cannot read deployment preflight" },
        },
      },
    },
    "/api/admin/mvp-scope": {
      get: {
        summary: "Get MVP1-MVP4 scope and readiness map",
        description:
          "Returns an Admin-readable product scope map for MVP1 through MVP4. The report keeps the build order explicit, separates implementation progress from launch readiness, lists current evidence and gaps, and reinforces that MVP1 proves the secure accountability spine before MVP2 transparency/intelligence, MVP3 field execution, and MVP4 advanced scale.",
        responses: {
          "200": { description: "MVP phase scope report" },
          "403": { description: "Role or grant cannot read MVP scope report" },
        },
      },
    },
    "/api/admin/mvp1-launch-handoff": {
      get: {
        summary: "Get MVP1 launch handoff lanes",
        description:
          "Returns an Admin-readable, evidence-safe MVP1 handoff report for platform, identity, provider, evidence/security, observability/incident, and UAT owners. The report maps Admin controls, runtime preflight checks, required env keys, commands, evidence needs, blockers, and launch hold conditions without exposing raw secrets.",
        responses: {
          "200": { description: "MVP1 launch handoff report" },
          "403": { description: "Role or grant cannot read MVP1 launch handoff" },
        },
      },
    },
    "/api/admin/governance/config-change-requests": {
      get: {
        summary: "List governed configuration change requests",
        description:
          "Returns pending, approved, and rejected Admin configuration change requests. Critical changes are retained as a review trail for two-person governance.",
        responses: {
          "200": { description: "Configuration change request list" },
          "403": { description: "Role or grant cannot inspect governance requests" },
        },
      },
      post: {
        summary: "Propose a governed configuration change",
        description:
          "Creates a pending Admin configuration change request for category, launch-readiness, SLA policy, or app-control changes. Critical changes are applied only after a different Admin approves them.",
        responses: {
          "201": { description: "Configuration change request created" },
          "400": { description: "Invalid governance request payload" },
          "403": { description: "Role or grant cannot create governance requests" },
        },
      },
    },
    "/api/admin/governance/config-change-requests/{requestId}/approve": {
      post: {
        summary: "Approve and apply a governed configuration change",
        description:
          "Applies a pending configuration change after second-Admin approval. The approver must be different from the requester. The response includes the applied config snapshot.",
        responses: {
          "200": { description: "Configuration change approved and applied" },
          "403": { description: "Role or grant cannot approve config changes" },
          "404": { description: "Change request not found" },
          "409": { description: "Change is not pending or requester attempted self-approval" },
        },
      },
    },
    "/api/admin/governance/config-change-requests/{requestId}/reject": {
      post: {
        summary: "Reject a governed configuration change",
        description:
          "Rejects a pending configuration change with a second Admin review reason. The requester cannot reject their own critical request as the formal reviewer.",
        responses: {
          "200": { description: "Configuration change rejected" },
          "403": { description: "Role or grant cannot reject config changes" },
          "404": { description: "Change request not found" },
          "409": { description: "Change is not pending or requester attempted self-review" },
        },
      },
    },
    "/api/admin/governance/audit-export": {
      get: {
        summary: "Generate MVP governance audit export package",
        description:
          "Returns a JSON audit export package with ticket audit events, config approval metadata, counts, redaction/export controls, and the configured security export delivery result. Local MVP mode returns the package with external delivery skipped for development only. Staging/production profiles disable that local export unless WHISTLE_SECURITY_EXPORT_MODE=webhook is configured. WHISTLE_SECURITY_EXPORT_MODE=webhook writes a redacted audit package and sanitized request logs to the configured SIEM/WORM webhook; failed configured export returns 503 so immutable retention cannot be assumed.",
        responses: {
          "200": { description: "Governance audit export package" },
          "403": { description: "Role or grant cannot export audit data" },
          "503": { description: "Configured security export provider failed" },
        },
      },
    },
    "/api/admin/config/categories/{categoryId}": {
      patch: {
        summary: "Update category policy",
        description: "Updates whether a citizen complaint category is enabled and how sensitive it is. Critical/protected category changes require the governed change-request approval path.",
        responses: { "200": { description: "Category updated" }, "409": { description: "Critical category change requires approval" }, "404": { description: "Category not found" } },
      },
    },
    "/api/admin/config/category-readiness/{categoryId}": {
      patch: {
        summary: "Update category launch readiness",
        description:
          "Updates the V0 launch-readiness matrix for a complaint category: owner, SLA summary, escalation path, role access, public visibility, privacy level, SOP status, training status, and launch state. Marking a category ready or touching protected readiness requires second-Admin approval.",
        responses: {
          "200": { description: "Category readiness updated" },
          "400": { description: "Invalid readiness payload" },
          "409": { description: "Critical readiness change requires approval" },
          "404": { description: "Category readiness row not found" },
        },
      },
    },
    "/api/admin/config/sla-policies/{stage}": {
      patch: {
        summary: "Update SLA policy",
        description: "Updates an SLA stage duration or enabled state for the ticket lifecycle. Duration/disable changes require the governed change-request approval path.",
        responses: { "200": { description: "SLA policy updated" }, "409": { description: "Critical SLA policy change requires approval" }, "404": { description: "SLA policy not found" } },
      },
    },
    "/api/admin/config/app-controls/{controlId}": {
      patch: {
        summary: "Update app control",
        description: "Updates privacy, protected-routing, notification, language, feature flag, or operations controls. Critical controls require the governed change-request approval path.",
        responses: { "200": { description: "App control updated" }, "409": { description: "Critical app control change requires approval" }, "404": { description: "App control not found" } },
      },
    },
    "/api/admin/access": {
      get: {
        summary: "Get access governance snapshot",
        description:
          "Returns MVP users, teams, memberships, role grants, and access review events. Requires Admin role and an access.manage grant.",
        responses: {
          "200": { description: "Access governance snapshot" },
          "403": { description: "Role or grant cannot manage access" },
        },
      },
    },
    "/api/admin/access/effective": {
      get: {
        summary: "Preview effective access for an actor",
        description:
          "Computes effective roles, scopes, actions, protected visibility, and reporter identity visibility from direct and team grants.",
        parameters: [{ name: "actor", in: "query", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Effective access preview" },
          "400": { description: "Invalid actor query" },
          "403": { description: "Role or grant cannot manage access" },
        },
      },
    },
    "/api/admin/access/users": {
      post: {
        summary: "Create access user",
        description: "Creates an MVP access user record keyed by actor id. Production should back this with OIDC/MFA identity.",
        responses: { "201": { description: "Access user created" }, "403": { description: "Role or grant cannot manage access" } },
      },
    },
    "/api/admin/access/users/{userId}": {
      patch: {
        summary: "Update access user",
        description: "Updates an access user's active/inactive status or MFA state and records an access review event.",
        responses: {
          "200": { description: "Access user updated" },
          "403": { description: "Role or grant cannot manage access" },
          "404": { description: "Access user not found" },
        },
      },
    },
    "/api/admin/access/teams": {
      post: {
        summary: "Create access team",
        description: "Creates a role-scoped team. Teams are the primary access primitive for government users.",
        responses: { "201": { description: "Access team created" }, "403": { description: "Role or grant cannot manage access" } },
      },
    },
    "/api/admin/access/teams/{teamId}": {
      patch: {
        summary: "Update access team",
        description: "Updates team active/inactive state, owner actor, or default scope and records an access review event.",
        responses: {
          "200": { description: "Access team updated" },
          "403": { description: "Role or grant cannot manage access" },
          "404": { description: "Access team not found" },
        },
      },
    },
    "/api/admin/access/memberships": {
      post: {
        summary: "Create team membership",
        description: "Adds a user to a team with an optional expiry for temporary access.",
        responses: { "201": { description: "Team membership created" }, "403": { description: "Role or grant cannot manage access" } },
      },
    },
    "/api/admin/access/memberships/{membershipId}": {
      patch: {
        summary: "Update team membership",
        description: "Updates a membership role label or expiry. Revocation is modeled as an immediate expiry so audit history remains intact.",
        responses: {
          "200": { description: "Team membership updated" },
          "403": { description: "Role or grant cannot manage access" },
          "404": { description: "Team membership not found" },
        },
      },
    },
    "/api/admin/access/grants": {
      post: {
        summary: "Create role/scope grant",
        description:
          "Creates a direct or team grant with role, scope, protected queue visibility, reporter identity visibility, actions, and optional expiry.",
        responses: { "201": { description: "Access grant created" }, "403": { description: "Role or grant cannot manage access" } },
      },
    },
    "/api/admin/access/grants/{grantId}": {
      patch: {
        summary: "Update role/scope grant",
        description: "Updates protected queue visibility, reporter identity visibility, or expiry for an existing grant.",
        responses: {
          "200": { description: "Access grant updated" },
          "403": { description: "Role or grant cannot manage access" },
          "404": { description: "Access grant not found" },
        },
      },
    },
  },
};
