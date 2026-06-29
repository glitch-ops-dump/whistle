# Whistle Jurisdiction Packs

Whistle packs are sample configuration files for adapting the same Whistle codebase to different governments, states, countries, or office-level deployments.

These packs are reference material only. They are not official boundary data, not legal advice, not government approval, and not a claim that any ministry, department, constituency, ward, office holder, or administrative boundary is current or authoritative.

## Pack Layers

Use packs in layers:

1. `core.whistle.json`
   - Generic Whistle roles, office types, scope rules, and lifecycle stages.
   - No India or Tamil Nadu assumptions.

2. `india.base.json`
   - Reusable Indian governance vocabulary and department templates.
   - Provides common structures such as State, District, Assembly Constituency, Ward, Panchayat, Ministry, Department, MLA, MP, Councillor, Panchayat/local representative, and Department Officer.
   - Template only; each state must verify and approve real data.

3. `india/tamil-nadu.sample.json`
   - Partial Tamil Nadu sample pack for demo and implementation reference.
   - Shows how a state root, districts, constituencies, wards/local bodies, ministries, and office-team scopes can be represented.
   - Not a complete or authoritative Tamil Nadu government catalog.

4. `office/*.template.json`
   - Small deployment/fork templates for a single MLA office or minister office.
   - Useful when one office wants to run Whistle for its own jurisdiction without a statewide deployment.

## Intended Import Flow

The future Admin import flow should:

1. Upload JSON or YAML pack.
2. Validate schema, duplicate codes, missing parents, and orphan nodes.
3. Preview diff against the active jurisdiction model.
4. Create a critical configuration change request.
5. Require approval before activation.

For state deployments, critical jurisdiction changes should require Admin plus CM Cell or state-command approval. For office forks, the fork owner defines the approving authority.

## Creating A New Pack

Anyone can copy these samples and configure Whistle differently. A pack should define:

- jurisdiction kinds
- jurisdiction nodes
- parent/child edges
- office types
- office scopes
- role labels
- default SLA stages
- category/routing templates if needed
- approval authority
- source and data-license notes

Avoid hardcoding office holders or political assumptions unless the deployment has explicit approval and a maintenance process for changes.

## Requesting Additional Packs

If you want the Whistle maintainers to help create a new pack, provide:

- country/state/locality name
- required government levels
- elected representative roles
- department/ministry catalog source
- boundary/catalog data source and license
- approval authority for future changes
- whether it is for a full state deployment or an office-level fork

Maintainers can add sample packs when the data source is public, reusable, and safe to include. Official production use still requires local verification and approval.
