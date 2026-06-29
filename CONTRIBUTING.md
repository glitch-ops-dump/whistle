# Contributing To Whistle

Thank you for helping improve Whistle. This project is intended as open civic infrastructure for citizen complaints, accountability, SLA tracking, protected complaint handling, and government operations.

## Contribution License

By submitting a pull request, patch, issue attachment, design asset, documentation edit, or other contribution to this repository, you agree that your contribution is provided under the MIT License used by this project.

You also confirm that you have the right to contribute the material and that it does not knowingly include code, text, images, data, marks, or credentials that you are not allowed to share.

The current root license uses `Whistle Contributors` as the copyright holder placeholder until the final legal copyright name is confirmed.

## Asset And Identity Rules

Do not add government emblems, department seals, official logos, political-party identity material, public-figure portraits, photos, or third-party design assets unless the usage rights are documented and approved.

For public-facing or exported prototype surfaces, prefer neutral Whistle-owned placeholder assets. Any future use of official marks, portraits, emblems, or likenesses must be reviewed before public, production, commercial, or government deployment.

## Jurisdiction Pack Contributions

Sample packs live under `packs/`. Pack contributions are welcome when they are clearly marked as sample/template data, include source and license notes, avoid unverified office-holder claims, and do not imply official government endorsement.

Production deployments must verify boundaries, ministries, departments, constituencies, wards, local bodies, approval authority, and data licensing locally before activating a pack.

## Privacy And Safety Rules

Do not commit:

- Real citizen names, phone numbers, addresses, IDs, complaint descriptions, or evidence.
- Raw secrets, API keys, database URLs, OTP values, private keys, salts, provider tokens, or signed evidence URLs.
- Production incident data or audit exports that have not been redacted.
- Content that exposes protected corruption complainants or sensitive evidence.

Use controlled references such as `artifact://...`, `secret-manager://...`, or `ops://...` in docs and configuration examples instead of raw credentials or sensitive URLs.

## Development Checks

Before proposing production-related changes, run the relevant checks for the area you touched. Common local checks are:

```bash
npm run mvp1:status
npm run mvp:check
DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run mvp:check:postgres
```

Documentation-only changes do not require a build unless they alter generated artifacts or executable examples.

## Security Issues

Do not disclose exploitable security issues in public issues or public screenshots. Share only the minimum safe summary needed for maintainers to triage the problem, and keep secrets, citizen data, evidence, and protected complaint details out of the repository.
