# Security Policy

Whistle handles civic complaints, verification workflows, protected complaint routing, role-based government consoles, and evidence references. Treat security reports carefully and avoid public disclosure of exploitable details.

## Supported Versions

| Version | Support status |
| --- | --- |
| `main` / `0.1.x` | Supported for prototype and pre-release security fixes |
| Generated exports and private demo assets | Not supported as production deployments |

## Reporting A Vulnerability

Use GitHub private vulnerability reporting or the repository Security tab when available. Do not open a public issue with exploit details.

If private vulnerability reporting is unavailable, open a public issue that asks maintainers for a private security contact without including technical exploit details, secrets, citizen data, evidence, or production URLs.

Include only safe information:

- A short description of the affected surface.
- The affected version, commit, or deployment profile if known.
- Whether the issue affects local development only, test/staging, or a real deployment.
- Redacted reproduction steps or proof that does not expose citizen data, credentials, tokens, OTPs, evidence, or private infrastructure.

## Scope

In scope:

- Authentication, authorization, account, session, worker, or role-boundary bypasses.
- Citizen privacy, protected complaint exposure, evidence leakage, or unsafe public transparency output.
- Injection, cross-site scripting, request forgery, insecure CORS, SSRF, path traversal, or unsafe file handling.
- Supply-chain, dependency, build, or release workflow issues.
- Security-sensitive configuration defaults that could affect staging, pilot, or production deployments.

Out of scope:

- Local-only prototype behavior that is clearly blocked by deployment-profile gates, unless it can cross into test, staging, pilot, or production.
- Reports requiring access to private assets, generated local evidence, or ignored local folders.
- Denial-of-service reports based only on high-volume traffic without a specific application flaw.

## Handling Expectations

Maintainers should acknowledge credible reports, preserve evidence privately, avoid public exploit details until a fix is available, and document any user-facing remediation needed for deployments.

Security fixes should include focused regression coverage where practical and should avoid committing secrets, raw incident data, private evidence, or real citizen information.
