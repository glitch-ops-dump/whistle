# Third-Party Notices

This repository's original Whistle source code and original Whistle documentation are licensed under the MIT License. See `LICENSE`.

This notice records bundled or referenced material that is not relicensed as Whistle-owned MIT material.

## Runtime And Build Dependencies

Whistle depends on npm packages for React, Vite, Fastify, Postgres access, validation, icons, TypeScript tooling, and related build/runtime support.

Those dependencies keep their own upstream licenses. The current dependency tree includes packages declaring these SPDX license identifiers in `package-lock.json`:

- `0BSD`
- `Apache-2.0`
- `BSD-3-Clause`
- `ISC`
- `MIT`
- `MPL-2.0`

Before redistributing a bundled build, container image, mobile wrapper, or hosted package, review the current lockfile and the upstream package license files under `node_modules` or the package registry metadata.

## Bundled Fonts

Whistle bundles a Tamil subset of Noto Sans Tamil:

- `public/assets/fonts/noto-sans-tamil-400.woff2`
- `public/assets/fonts/noto-sans-tamil-700.woff2`

The font software is licensed under the SIL Open Font License, Version 1.1. The bundled license text is kept at:

- `public/assets/fonts/NOTO-SANS-TAMIL-LICENSE`

The Whistle MIT License does not relicense these font files.

## Public Prototype Assets

Neutral brand SVGs and the schematic district sample under `public/assets/brand/` and `public/assets/data/` are original Whistle placeholder/sample assets covered by the repository MIT License.

The file `public/assets/data/tamil-nadu-districts.geojson` is not official GIS or boundary data. It is a hand-authored schematic grid used only to keep prototype heatmaps working without shipping unlicensed boundary geometry.

The Whistle MIT License does not grant rights over third-party assets, official marks, government emblems, state emblems, seals, logos, public-figure likenesses, portraits, photographs, party identity material, or other protected identity material that may appear in prototype files, mockups, screenshots, or design references.

See `NOTICE.md` for the civic notice and asset-rights clarification.

## Sample Jurisdiction Packs

Files under `packs/` are sample/template configuration data. Original Whistle configuration text in those packs is MIT-licensed, but adopters must verify official boundaries, ministry/department catalogs, office mappings, source data licenses, and approval rules before production use.

Sample packs must not be treated as authoritative government data.
