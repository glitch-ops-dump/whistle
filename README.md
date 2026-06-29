# Whistle

Whistle is an open-source civic accountability prototype for citizen complaints, SLA-driven government workflows, and transparent service delivery. The MVP1 build includes a mobile-first citizen PWA, role-specific government consoles, a deterministic ticket spine, escalation logic, protected corruption handling, Admin launch controls, and local UAT tooling.

The reference configuration is Tamil Nadu-oriented, but the product is role-based: a Chief Minister's office, state executive office, ministry, MLA office, local body, or verification team can be configured by each adopter. The open-source repository intentionally ships with neutral Whistle-owned placeholder assets instead of official emblems, party marks, public-figure portraits, or government seals.

## Acknowledgement

Whistle is offered as a public-interest software contribution inspired by the need for cleaner, more accountable, and more measurable civic service delivery in Tamil Nadu and beyond. It is written with respect for citizens, public institutions, and elected leadership, while remaining an unofficial open-source project.

This repository is not affiliated with, endorsed by, sponsored by, or authorized by the Government of Tamil Nadu, any Chief Minister's office, any political party, or any public figure. Official state emblems, seals, portraits, photographs, and party identity materials should be used only by authorized deployments with documented rights and approval.

## What It Does

- Citizen complaint intake with bilingual Tamil/English prototype flows.
- Ticket verification, routing, SLA clocks, escalation, and audit events.
- Role-specific consoles for Admin, Verification, Local Owner, MLA, Ministry, CM Cell, public transparency, and workflow explanation.
- Protected handling patterns for sensitive corruption complaints.
- Public insights that expose aggregate metrics without citizen identities, phone numbers, raw evidence, or sensitive ticket details.
- Sample jurisdiction packs for adapting the model to different states or offices.

## Run Locally

```bash
npm install
npm run dev
npm run api:dev
```

Frontend pages run through Vite, with the API defaulting to `http://localhost:3001`.

Common entry points:

- `citizen.html`: citizen mobile PWA prototype.
- `verification.html`: intake and verification console.
- `local.html`: local owner workbench.
- `mla.html`: MLA dashboard.
- `ministry.html`: ministry operations console.
- `cm-cell.html`: state executive / CM Cell command center.
- `admin.html`: launch and configuration controls.
- `transparency.html`: public aggregate insights.
- `workflow.html`: workflow explainer.

## Repository Layout

- `src/`: Vite/React source for the citizen app and government consoles.
- `server/`: local API, ticket spine, worker, and persistence code.
- `public/assets/`: open-source-safe neutral assets, sample data, and bundled fonts.
- `packs/`: sample jurisdiction configuration packs.
- `docs/`: product, deployment, roadmap, and operating-model notes.
- `scripts/`: build, export, smoke, and UAT utilities.
- `exports/standalone/`: generated standalone HTML exports.

Private demo or video assets should stay in an ignored `private-assets/` folder or a separate private repository. See [docs/whistle-private-demo-assets.md](docs/whistle-private-demo-assets.md).

## Asset And Identity Policy

Open-source Whistle uses neutral placeholder identity by default:

- `public/assets/brand/`: Whistle-owned prototype SVG marks and service illustration.
- `public/assets/data/tamil-nadu-districts.geojson`: hand-authored schematic sample data, not official GIS boundaries.
- `public/assets/fonts/`: bundled Noto Sans Tamil font files under the SIL Open Font License.

Do not commit official state emblems, government seals, department logos, party marks, public-figure portraits, third-party photographs, production videos, or private demo media unless redistribution rights are documented. Authorized deployments can replace the neutral assets through configuration or a private asset package.

## MVP1 Local UAT

```bash
npm run db:up
DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run db:migrate
npm run mvp1:uat-preflight
npm run mvp1:uat-seed -- --out artifacts/whistle-mvp1-local-uat-seed.md
npm run mvp1:uat-signoff -- --out artifacts/whistle-mvp1-uat-signoff.md
npm run api:dev:mvp1-uat
```

The seed command creates local Postgres test tickets and browser-local smoke OIDC tokens for Admin, Verification, CM Cell, Minister, Department Officer, MLA, and Councillor testing.

## Validation

```bash
npm run mvp1:status
npm run mvp:check
DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run mvp:check:postgres
```

`npm run mvp1:status` summarizes the current MVP1 implementation percentage, launch readiness percentage, included/deferred surfaces, launch blockers, and parallel workstreams. By default it reads `ops/env/whistle-mvp1-staging.env.example`; pass `-- --env-file <rendered-env>` to check a real staging or production environment without printing secret values.

## Jurisdiction Packs

Whistle includes sample jurisdiction packs under [packs](packs). They show how the same open-source product can be configured for a generic deployment, an India-oriented government model, a Tamil Nadu sample, or a single MLA/minister office fork. Packs are templates and samples only; adopters must verify official boundaries, departments, roles, data licenses, and approval rules before production use.

## Community And Security

Use [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules, asset boundaries, privacy rules, and local validation checks. Use [SECURITY.md](SECURITY.md) for vulnerability reporting; do not post exploit details, secrets, citizen data, or private evidence in public issues.

## License

Original Whistle source code and original Whistle documentation are licensed under the MIT License. See [LICENSE](LICENSE) for the full license text.

The npm package is marked `"private": true` only to prevent accidental package-registry publication from this app repository; it does not change the source license.

This license does not grant rights over third-party assets, official marks, government emblems, state emblems, seals, logos, public-figure likenesses, portraits, photographs, or other protected identity material that may appear in prototypes, mockups, screenshots, or design references. See [NOTICE.md](NOTICE.md) for the civic notice and asset-rights clarification.

Bundled fonts and npm dependencies keep their own upstream licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Contributions are welcome under the same MIT licensing terms. See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.
