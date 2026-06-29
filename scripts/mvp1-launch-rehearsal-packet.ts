import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

type RehearsalRole =
  | "Citizen"
  | "Verification Team"
  | "MLA"
  | "Minister / Department Officer"
  | "CM Cell"
  | "Admin"
  | "Worker / Security";

type RehearsalCommand = {
  script: string;
  command: string;
  proves: string;
};

export type RehearsalScenario = {
  id: string;
  title: string;
  purpose: string;
  roles: RehearsalRole[];
  commands: RehearsalCommand[];
  acceptanceSignals: string[];
  operatorSignoff: string[];
  dataSafety: string[];
};

export type DefectTriageLane = {
  severity: "Blocker" | "Critical" | "Major" | "Minor";
  launchDecision: string;
  examples: string[];
  requiredAction: string;
  deferralRule: string;
};

export type LaunchRehearsalPacket = {
  kind: "whistle-mvp1-launch-rehearsal-packet";
  generatedAt: string;
  scope: string;
  redactionPolicy: string[];
  roles: RehearsalRole[];
  scenarios: RehearsalScenario[];
  defectTriagePolicy: DefectTriageLane[];
  rehearsalCommands: string[];
  launchHoldConditions: string[];
};

export const rehearsalRoles: RehearsalRole[] = [
  "Citizen",
  "Verification Team",
  "MLA",
  "Minister / Department Officer",
  "CM Cell",
  "Admin",
  "Worker / Security",
];

export const mvp1RehearsalScenarios: RehearsalScenario[] = [
  {
    id: "citizen-intake-status",
    title: "Citizen intake, OTP, status tracking, and add-more-info loop",
    purpose: "Prove that a citizen can submit, verify phone ownership, track status, receive citizen-safe updates, and add requested information.",
    roles: ["Citizen", "Verification Team", "Admin"],
    commands: [
      { script: "smoke:lifecycle", command: "npm run smoke:lifecycle", proves: "Ticket creation, status transitions, citizen tracking, and clarification loop." },
      { script: "smoke:otp-delivery", command: "npm run smoke:otp-delivery", proves: "Phone verification challenge, retry, and token behavior." },
      {
        script: "smoke:notification-templates",
        command: "npm run smoke:notification-templates",
        proves: "Tamil/English citizen-safe lifecycle notification copy.",
      },
    ],
    acceptanceSignals: [
      "Citizen can finish a complaint without government-console access.",
      "Ticket status, SLA stage, and next action are understandable to a non-technical user.",
      "Add-more-info returns the ticket to verification without losing history.",
    ],
    operatorSignoff: [
      "Verification lead confirms request-info wording is actionable.",
      "Admin confirms enabled categories are intentionally launch-ready.",
    ],
    dataSafety: ["Packet includes no phone numbers, ticket ids, raw descriptions, or evidence content."],
  },
  {
    id: "verification-routing-rejection-review",
    title: "Verification routing, request-info, reject, and CM-maintained rejection review",
    purpose: "Prove that verification can route complete tickets, ask citizens for missing data, and send rejected tickets to independent review.",
    roles: ["Verification Team", "CM Cell", "Admin"],
    commands: [
      { script: "smoke:lifecycle", command: "npm run smoke:lifecycle", proves: "Verification decisions, rejection review, and audit history." },
      { script: "smoke:agent-runs", command: "npm run smoke:agent-runs", proves: "Recommend-only intake advice that cannot mutate ticket state." },
      { script: "smoke:governance", command: "npm run smoke:governance", proves: "Critical configuration changes and approval trail." },
    ],
    acceptanceSignals: [
      "Rejected tickets are reviewable outside the original verification queue.",
      "Incorrect or incomplete reports can be returned to the citizen with a clear reason.",
      "Advisory agents remain non-mutating.",
    ],
    operatorSignoff: [
      "Verification lead signs off triage SOP.",
      "CM Cell lead signs off rejection-review ownership and turnaround.",
    ],
    dataSafety: ["Review screens mask citizen identity unless the role and access reason permit it."],
  },
  {
    id: "role-dashboards-sla-accountability",
    title: "Role dashboards, SLA queues, and escalation accountability",
    purpose: "Prove that MLA, Minister, CM Cell, and Admin users see the right scope and can explain KPI counts.",
    roles: ["MLA", "Minister / Department Officer", "CM Cell", "Admin"],
    commands: [
      { script: "smoke:dashboard-briefs", command: "npm run smoke:dashboard-briefs", proves: "Scoped queue and KPI summaries for each role." },
      { script: "smoke:dashboard-explain", command: "npm run smoke:dashboard-explain", proves: "Explainable dashboard counts and filtered queues." },
      { script: "smoke:access", command: "npm run smoke:access", proves: "Role grants, scope boundaries, and sensitive access checks." },
    ],
    acceptanceSignals: [
      "CM Cell sees statewide escalation and ministry/district overview.",
      "Minister sees only assigned ministry information across districts.",
      "MLA sees local queue accountability and escalated-secondary visibility.",
    ],
    operatorSignoff: [
      "Each role owner confirms the dashboard answers their daily operating question.",
      "Admin confirms default filters and visible actions match launch SOP.",
    ],
    dataSafety: ["Role dashboards do not leak unrelated districts, ministries, citizen identity, or protected details."],
  },
  {
    id: "protected-evidence-privacy",
    title: "Protected complaints, identity masking, evidence access, and audit trail",
    purpose: "Prove that corruption/protected reports bypass local visibility until authorized and evidence access is governed.",
    roles: ["Citizen", "Verification Team", "CM Cell", "Worker / Security"],
    commands: [
      {
        script: "smoke:evidence-object-store",
        command: "npm run smoke:evidence-object-store",
        proves: "Evidence upload-session seam, scan metadata, and storage policy behavior.",
      },
      { script: "smoke:access", command: "npm run smoke:access", proves: "Protected ticket and evidence access boundaries." },
      { script: "smoke:security-export", command: "npm run smoke:security-export", proves: "Redacted security/audit export payloads." },
    ],
    acceptanceSignals: [
      "Protected cases are hidden from local roles until authorized by policy.",
      "Evidence access requires scoped role permission and writes audit events.",
      "Security export is redacted and chain-verifiable.",
    ],
    operatorSignoff: [
      "CM Cell or vigilance owner signs off protected-track handling.",
      "Security owner signs off evidence retention, scanning, and access audit expectations.",
    ],
    dataSafety: ["Evidence placeholders only; packet never embeds media, signed URLs, raw descriptions, or citizen identity."],
  },
  {
    id: "field-closure-quality",
    title: "Field action, closure checklist, reopen, and dispute path",
    purpose: "Prove that local and department owners can execute closure steps while citizens retain reopen/dispute rights.",
    roles: ["MLA", "Minister / Department Officer", "Citizen", "Verification Team"],
    commands: [{ script: "smoke:field-execution", command: "npm run smoke:field-execution", proves: "Visit, transfer, directive, resolution, reopen, and dispute actions." }],
    acceptanceSignals: [
      "Closure needs required checklist evidence instead of a silent status flip.",
      "Citizen dispute returns the case to an accountable queue.",
      "Escalated tickets preserve secondary visibility for the earlier owner.",
    ],
    operatorSignoff: [
      "Local owner signs off closure checklist wording.",
      "Department owner signs off transfer/directive rules.",
    ],
    dataSafety: ["Closure evidence remains in governed evidence storage and is not published in this packet."],
  },
  {
    id: "admin-launch-controls",
    title: "Admin launch controls, category readiness, access, and governance",
    purpose: "Prove that launch readiness is controlled through Admin configuration, access grants, category state, and critical-change approval.",
    roles: ["Admin", "CM Cell", "Worker / Security"],
    commands: [
      { script: "smoke:admin-config", command: "npm run smoke:admin-config", proves: "Category readiness, asset policy, SLA, privacy, and launch controls." },
      { script: "smoke:governance", command: "npm run smoke:governance", proves: "Second-admin approval for critical launch changes." },
      { script: "smoke:mvp-scope", command: "npm run smoke:mvp-scope", proves: "MVP1 scope, blockers, implementation percent, and launch readiness report." },
    ],
    acceptanceSignals: [
      "Admin can pause public intake without breaking citizen tracking.",
      "Only approved categories are open for intake.",
      "Neutral placeholder assets remain selected until official assets are legally approved.",
    ],
    operatorSignoff: [
      "Admin owner signs off launch-control SOP.",
      "CM Cell owner signs off escalation and protected-category governance.",
    ],
    dataSafety: ["Admin evidence is config-level only and does not contain live citizen personal data."],
  },
  {
    id: "production-security-preflight",
    title: "Production security preflight and redacted readiness packet",
    purpose: "Prove that staging/production fails closed until real providers, storage, rate limits, telemetry, and runbook evidence are configured.",
    roles: ["Admin", "Worker / Security"],
    commands: [
      { script: "mvp1:uat-preflight", command: "npm run mvp1:uat-preflight", proves: "Local UAT harness keeps OIDC, browser bearer tokens, worker auth, Postgres, and rate limits testable without clearing external launch gates." },
      { script: "smoke:deployment-preflight", command: "npm run smoke:deployment-preflight", proves: "Runtime profile blockers and all-green env contract." },
      { script: "smoke:deployment-preflight-cli", command: "npm run smoke:deployment-preflight-cli", proves: "CLI validation for rendered environment files." },
      {
        script: "smoke:deployment-readiness-packet",
        command: "npm run smoke:deployment-readiness-packet",
        proves: "Readiness packet redacts secret values and reports owner-lane status.",
      },
      {
        script: "smoke:mvp1-handoff-packet",
        command: "npm run smoke:mvp1-handoff-packet",
        proves: "MVP1 handoff packet redacts secrets while mapping launch lanes, controls, blockers, evidence, and owner actions.",
      },
      { script: "smoke:production-runbook", command: "npm run smoke:production-runbook", proves: "Runbook contains required launch hold conditions and commands." },
    ],
    acceptanceSignals: [
      "Local prototype seams remain available only for local development.",
      "Staging/production cannot start as ready while providers or restore evidence are missing.",
      "Readiness evidence can be shared without exposing secrets.",
    ],
    operatorSignoff: [
      "Security owner signs off OIDC/MFA, OTP, evidence, notification, SIEM, and rate-limit providers.",
      "Operations owner signs off restore drill and incident hold conditions.",
    ],
    dataSafety: ["Provider secrets, database passwords, API keys, salts, tokens, and restore timestamps are redacted."],
  },
  {
    id: "scale-worker-performance",
    title: "High-volume API, worker batching, rate limits, and telemetry",
    purpose: "Prove that the API and worker seams have bounded execution, rate limiting, metrics, and authenticated job execution.",
    roles: ["Worker / Security", "Admin", "CM Cell"],
    commands: [
      { script: "smoke:api-slos", command: "npm run smoke:api-slos", proves: "API SLO and latency measurement envelope." },
      { script: "smoke:worker-batches", command: "npm run smoke:worker-batches", proves: "Bounded worker batch processing and has-more behavior." },
      { script: "smoke:worker-auth", command: "npm run smoke:worker-auth", proves: "Worker endpoint authentication contract." },
      { script: "smoke:rate-limits", command: "npm run smoke:rate-limits", proves: "Public endpoint rate-limit behavior and hashed bucket strategy." },
      { script: "smoke:metrics", command: "npm run smoke:metrics", proves: "Metrics endpoint and sanitized counters." },
      { script: "smoke:telemetry-export", command: "npm run smoke:telemetry-export", proves: "Sanitized telemetry export path." },
    ],
    acceptanceSignals: [
      "Worker jobs run in bounded passes and do not require manual database surgery.",
      "Public endpoints enforce rate limits using non-raw identity buckets.",
      "Metrics and telemetry can support launch watch without exposing citizen data.",
    ],
    operatorSignoff: [
      "Platform owner signs off expected volume envelope for pilot.",
      "CM Cell owner signs off launch-watch KPI cadence.",
    ],
    dataSafety: ["Telemetry and metrics are aggregate or sanitized; packet contains no request payloads."],
  },
];

export const mvp1DefectTriagePolicy: DefectTriageLane[] = [
  {
    severity: "Blocker",
    launchDecision: "Launch hold",
    examples: [
      "Citizen cannot submit or track a launch-ready category.",
      "Protected identity or evidence is exposed to an unauthorized role.",
      "SLA escalation, audit chain, or verification routing is broken.",
      "Production preflight reports any blocker.",
    ],
    requiredAction: "Fix, retest the owning smoke/UAT scenario, and attach evidence before sign-off can proceed.",
    deferralRule: "Cannot be deferred to MVP2-MVP4.",
  },
  {
    severity: "Critical",
    launchDecision: "Fix before launch unless explicitly accepted by CM Cell and Admin owners",
    examples: [
      "A role dashboard answers the wrong operating question but does not leak data.",
      "Citizen copy is confusing enough to create duplicate complaints.",
      "Worker job can recover manually but has no clear operator runbook.",
    ],
    requiredAction: "Assign owner, date, acceptance test, and approving authority before the rehearsal packet is signed.",
    deferralRule: "May defer only with written launch-owner acceptance and no privacy, SLA, or citizen-blocking impact.",
  },
  {
    severity: "Major",
    launchDecision: "Triage before launch",
    examples: [
      "A secondary queue count is hard to explain.",
      "Admin wording needs polishing but the control works.",
      "A non-core pilot category has unclear operator ownership.",
    ],
    requiredAction: "Record owner, target MVP, and retest path. Keep it in MVP1 only if it affects active launch categories or roles.",
    deferralRule: "Can defer to MVP2-MVP4 only when MVP1 flows remain safe and understandable.",
  },
  {
    severity: "Minor",
    launchDecision: "Can defer with owner",
    examples: [
      "Copy polish, visual spacing, or non-blocking report formatting.",
      "Convenience filter or export enhancement outside MVP1 launch flow.",
      "Future transparency or intelligence request discovered during UAT.",
    ],
    requiredAction: "Log as backlog with phase tag and owner; do not expand MVP1 for convenience work.",
    deferralRule: "Default to defer unless it hides a real Blocker, Critical, or Major issue.",
  },
];

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

export function createMvp1LaunchRehearsalPacket(generatedAt = new Date().toISOString()): LaunchRehearsalPacket {
  return {
    kind: "whistle-mvp1-launch-rehearsal-packet",
    generatedAt,
    scope: "MVP1 only: citizen intake, verification, role dashboards, SLA/audit, protected track, Admin controls, production preflight, and worker/scale seams.",
    redactionPolicy: [
      "Do not include raw phone numbers, ticket IDs, citizen names, addresses, evidence files, signed URLs, or raw complaint descriptions.",
      "Do not include database passwords, API keys, shared worker tokens, rate-limit salts, restore-drill timestamps, OIDC secrets, or provider credentials.",
      "Use this packet to map rehearsal coverage and operator sign-off; it does not replace live UAT notes, security approval, or provider contracts.",
    ],
    roles: rehearsalRoles,
    scenarios: mvp1RehearsalScenarios,
    defectTriagePolicy: mvp1DefectTriagePolicy,
    rehearsalCommands: [
      "npm run mvp1:uat-preflight",
      "npm run mvp1:uat-token -- --actor admin:prototype --role admin",
      "npm run mvp1:uat-seed -- --json --quiet --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.json",
      "npm run mvp1:uat-run -- --run-id <run-id> --seed-file artifacts/whistle-mvp1-local-uat-seed.json --out artifacts/whistle-mvp1-local-uat-run.md",
      "npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md",
      "npm run mvp1:uat-signoff -- --run-id <run-id> --out artifacts/whistle-mvp1-uat-signoff.md",
      "npm run mvp:check",
      "DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run mvp:check:postgres",
      "npm run deployment:preflight:assert -- --env-file /secure/rendered/whistle-staging.env",
      "npm run deployment:packet -- --env-file /secure/rendered/whistle-staging.env --out artifacts/whistle-mvp1-readiness-packet.md",
      "npm run mvp1:handoff-packet -- --env-file /secure/rendered/whistle-staging.env --out artifacts/whistle-mvp1-launch-handoff.md",
    ],
    launchHoldConditions: [
      "Any deployment preflight blocker remains.",
      "Any MVP1 role owner has not completed operator sign-off.",
      "Any Blocker or Critical defect remains open in the MVP1 defect register.",
      "Public intake is enabled for a category without approved SOP, owner, SLA, and training.",
      "Official OIDC/MFA, OTP, evidence storage/KMS/scanning, notifications, distributed rate limits, SIEM/WORM export, telemetry, or restore-drill evidence is missing.",
      "Public surfaces use unapproved official marks, emblems, portraits, or public-figure likenesses instead of the neutral Whistle placeholders.",
    ],
  };
}

function list(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function triageRows(items: DefectTriageLane[]) {
  return items
    .map(
      (item) =>
        `| ${item.severity} | ${item.launchDecision} | ${item.requiredAction} | ${item.deferralRule} | ${item.examples.join("<br>")} |`,
    )
    .join("\n");
}

export function renderMvp1LaunchRehearsalMarkdown(packet: LaunchRehearsalPacket) {
  const scenarioSections = packet.scenarios
    .map((scenario, index) => {
      const commandRows = scenario.commands
        .map((item) => `| \`${item.command}\` | ${item.proves} |`)
        .join("\n");
      return `### ${index + 1}. ${scenario.title}

Purpose: ${scenario.purpose}

Roles: ${scenario.roles.join(", ")}

| Command | What it proves |
| --- | --- |
${commandRows}

Acceptance signals:

${list(scenario.acceptanceSignals)}

Operator sign-off:

${list(scenario.operatorSignoff)}

Data-safety rule:

${list(scenario.dataSafety)}`;
    })
    .join("\n\n");

  const scripts = unique(packet.scenarios.flatMap((scenario) => scenario.commands.map((item) => item.script))).sort();

  return `# Whistle MVP1 Launch Rehearsal Packet

Kind: \`${packet.kind}\`  
Generated: \`${packet.generatedAt}\`  
Scope: ${packet.scope}

## Redaction Policy

${list(packet.redactionPolicy)}

## Roles Covered

${list(packet.roles)}

## Rehearsal Commands

${list(packet.rehearsalCommands.map((command) => `\`${command}\``))}

## Scenario Coverage

${scenarioSections}

## MVP1 Defect Triage Policy

| Severity | Launch decision | Required action | Deferral rule | Examples |
| --- | --- | --- | --- | --- |
${triageRows(packet.defectTriagePolicy)}

## Package Scripts Used

${list(scripts.map((script) => `\`${script}\``))}

## Launch Hold Conditions

${list(packet.launchHoldConditions)}
`;
}

export function renderMvp1LaunchRehearsalJson(packet: LaunchRehearsalPacket) {
  return `${JSON.stringify(packet, null, 2)}\n`;
}

function parseArgs(argv: string[]) {
  const options: { out?: string; format: "markdown" | "json" } = { format: "markdown" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json" || (arg === "--format" && argv[index + 1] === "json")) {
      options.format = "json";
      if (arg === "--format") index += 1;
      continue;
    }
    if (arg === "--markdown" || (arg === "--format" && argv[index + 1] === "markdown")) {
      options.format = "markdown";
      if (arg === "--format") index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packet = createMvp1LaunchRehearsalPacket();
  const rendered = options.format === "json" ? renderMvp1LaunchRehearsalJson(packet) : renderMvp1LaunchRehearsalMarkdown(packet);
  if (options.out) {
    const outPath = resolve(process.cwd(), options.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered);
    console.log(`Wrote ${options.format} MVP1 launch rehearsal packet to ${outPath}`);
    return;
  }
  process.stdout.write(rendered);
}

const isCli = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false;
if (isCli) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
