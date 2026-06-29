# Whistle MVP1 Deployment Decisions

Status: MVP1 staging handoff note

This note lists only the deployment answers needed to start staging/UAT work in parallel. It does not require final vendor choices for every provider yet, and it must not contain raw passwords, API keys, database URLs, OTP values, private keys, or object-store credentials.

## Why Identity Approval Is Needed

Government and Admin consoles need an approved identity model because those users can view scoped queues, act on tickets, approve critical configuration, and access protected workflows. A prototype header or local bearer token cannot provide enough assurance for identity, revocation, audit, or incident investigation.

For MVP1 UAT, Whistle uses mobile number + password accounts, with OTP mandated by Admin when required. For staging/production, the program must explicitly approve that mobile/password + OTP policy for government users or configure an OIDC/MFA provider if government SSO policy requires it. This does not change the citizen flow: citizens use mobile accounts, phone OTP when Admin requires it, and government ID remains disabled unless separately approved for selected categories.

## Exact Questions Needed Now

| Decision | Owner | Exact Question | Expected Answer Format |
| --- | --- | --- | --- |
| Staging/prod domains and origins | Deployment owner | What exact HTTPS origins will host the citizen PWA, government consoles, and API in staging and production? | `staging citizen=https://...`, `staging govt=https://...`, `staging api=https://...`, `prod citizen=https://...`, `prod govt=https://...`, `prod api=https://...` |
| Target hosting/runtime | Platform owner | Where will the static frontend, API process, background workers, and scheduled jobs run for staging and production? | `frontend=<platform>`, `api=<runtime>`, `workers=<runtime>`, `scheduler=<runtime>`, `region=<approved region>` |
| Postgres environment | Database owner | Which managed Postgres environments are approved for staging and production, and who controls schema migration execution? | `staging db=<managed service/ref>`, `prod db=<managed service/ref>`, `migration owner=<name/team>`, `backup policy=<policy ref>` |
| Backup/restore drill | Database + operations owners | Who owns the production-like restore drill and what exact drill date/window should be recorded before launch? | `owner=<name/team>`, `drill window=<YYYY-MM-DD HH:mm zone>`, `evidence ref=artifact://whistle/mvp1/restore-drill/<run-id>` |
| Incident hold rules | CM Cell + operations owner | Which incidents must pause launch or intake immediately, and who has authority to resume? | `hold if=<conditions>`, `commander=<role>`, `resume authority=<role>`, `evidence ref=artifact://whistle/mvp1/incident-hold-policy/<run-id>` |

## Defaults We Can Assume Until Replaced

- Citizen identity policy remains mobile account + phone OTP when Admin requires it for MVP1.
- Government console identity policy is mobile number + password for UAT; production must either approve this with Admin-mandated OTP or configure mandated SSO/OIDC.
- Remote TEST uses `WHISTLE_DEPLOYMENT_PROFILE=test` and is for proper functional/UAT validation before staging or production launch. TEST still needs Postgres, restricted origins, worker authentication, hidden mock OTP, and shared rate limits, but it may use mock OTP delivery, mock notifications, local evidence storage on persistent test disk, local security export, and local telemetry.
- Government ID/Aadhaar category mandates are not enabled in MVP1 unless a state-approved policy and provider reference are supplied.
- Local UAT can use account-login-minted local official tokens and local Postgres; this is not production evidence.
- The detailed TEST deployment checklist is in `docs/whistle-test-deployment-plan.md`.
- Provider references in Admin should be controlled references such as `secret-manager://...`, `provider-contract://...`, `artifact://...`, or `ops://...`, not raw URLs or pasted credentials.
- Any production/staging deployment with unresolved preflight blockers must remain a launch hold.

## Open Items Not Required To Answer Today

- Final SMS/WhatsApp vendor.
- Final evidence object-store vendor.
- Final SIEM/WORM vendor.
- Final telemetry vendor.
- Whether V2 native apps use Capacitor, React Native, or fully native Android/iOS.
