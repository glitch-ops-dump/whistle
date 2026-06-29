import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mvp1DefectTriagePolicy, mvp1RehearsalScenarios, rehearsalRoles } from "./mvp1-launch-rehearsal-packet.js";

type SignoffChecklistOptions = {
  runId: string;
  json: boolean;
  out?: string;
};

type SignoffControl = {
  controlId: string;
  label: string;
  owner: string;
  requiredEvidence: string;
  scenarios: string[];
  passCriteria: string[];
};

export type Mvp1UatSignoffChecklist = {
  kind: "whistle-mvp1-uat-signoff-checklist";
  runId: string;
  generatedAt: string;
  scope: string;
  redactionPolicy: string[];
  commandSequence: string[];
  roleCoverage: string[];
  scenarioChecks: Array<{
    id: string;
    title: string;
    roles: string[];
    acceptanceSignals: string[];
    operatorSignoff: string[];
    dataSafety: string[];
    provingCommands: string[];
  }>;
  signoffControls: SignoffControl[];
  defectTriageRules: Array<{
    severity: string;
    launchDecision: string;
    requiredAction: string;
    deferralRule: string;
  }>;
  completionRules: string[];
};

function defaultRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `uat-signoff-${stamp}`;
}

function parseArgs(argv: string[]): SignoffChecklistOptions {
  const options: SignoffChecklistOptions = {
    runId: defaultRunId(),
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run-id") {
      options.runId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function signoffControls(runId: string): SignoffControl[] {
  return [
    {
      controlId: "uat-launch-rehearsal-evidence-ref",
      label: "MVP1 rehearsal evidence reference",
      owner: "Admin launch owner",
      requiredEvidence: `artifact://whistle/mvp1/rehearsal-packet/${runId}`,
      scenarios: mvp1RehearsalScenarios.map((scenario) => scenario.id),
      passCriteria: [
        "Rehearsal packet exists and is redacted.",
        "Every MVP1 scenario has either pass notes or defect IDs.",
        "MVP2-MVP4 requests discovered during UAT are logged as deferred, not added to MVP1.",
      ],
    },
    {
      controlId: "uat-citizen-lifecycle-rehearsed",
      label: "Citizen submit and track rehearsal complete",
      owner: "Citizen/UAT owner",
      requiredEvidence: "true after citizen intake, OTP, status, notification, add-more-info, and dispute paths are exercised.",
      scenarios: ["citizen-intake-status", "field-closure-quality"],
      passCriteria: [
        "Citizen can submit a launch-ready category and track status without government-console access.",
        "Requested additional information returns to verification without losing history.",
        "Citizen status copy is understandable in English and Tamil where the surface supports it.",
      ],
    },
    {
      controlId: "uat-verification-sop-approved",
      label: "Verification SOP and training approved",
      owner: "Verification lead",
      requiredEvidence: "true after verification route, request-info, reject, and protected-flag SOP is approved.",
      scenarios: ["verification-routing-rejection-review", "admin-launch-controls"],
      passCriteria: [
        "Verification team can route complete tickets and request missing information.",
        "Rejected tickets enter CM-maintained rejection review.",
        "Recommend-only agent output never mutates lifecycle state.",
      ],
    },
    {
      controlId: "uat-role-dashboard-rehearsed",
      label: "Role dashboard rehearsal complete",
      owner: "CM Cell + role owners",
      requiredEvidence: "true after MLA, Minister, Department Officer, CM Cell, and Admin role surfaces are rehearsed.",
      scenarios: ["role-dashboards-sla-accountability", "scale-worker-performance"],
      passCriteria: [
        "CM Cell can see statewide escalation and ministry/district overview.",
        "Minister can see only assigned ministry information across districts.",
        "MLA/councillor users can focus on local closure before escalation.",
      ],
    },
    {
      controlId: "uat-protected-track-sop-approved",
      label: "Protected-track SOP approved",
      owner: "CM Cell / protected review owner",
      requiredEvidence: "true after protected complaint, identity masking, access reason, and evidence handling SOP is approved.",
      scenarios: ["protected-evidence-privacy"],
      passCriteria: [
        "Protected cases stay hidden from local, MLA, minister, and department roles unless policy permits.",
        "Protected reads require an access reason and write sensitive audit events.",
        "Shared UAT evidence contains no citizen identity, raw evidence, signed URL, or sensitive complaint text.",
      ],
    },
    {
      controlId: "uat-defect-register-ref",
      label: "MVP1 defect register reference",
      owner: "UAT defect triage owner",
      requiredEvidence: `artifact://whistle/mvp1/defect-register/${runId}`,
      scenarios: mvp1RehearsalScenarios.map((scenario) => scenario.id),
      passCriteria: [
        "Template rows have been replaced, removed, or explicitly marked not applicable.",
        "Open Blocker and Critical counts match Admin controls.",
        "Major and Minor deferrals have owner, target MVP, retest path, and approving authority.",
      ],
    },
    {
      controlId: "uat-defect-triage-ready",
      label: "MVP1 defect triage queue accepted",
      owner: "CM Cell + Admin",
      requiredEvidence: "true only after the defect register is reviewed and blocker/critical counts are zero.",
      scenarios: mvp1RehearsalScenarios.map((scenario) => scenario.id),
      passCriteria: [
        "No open Blocker defects remain.",
        "No open Critical defects remain unless launch owners explicitly accept them under policy.",
        "No defect marked deferred hides a privacy, SLA, protected-track, or citizen-blocking issue.",
      ],
    },
  ];
}

export function createMvp1UatSignoffChecklist(runId = defaultRunId(), generatedAt = new Date().toISOString()): Mvp1UatSignoffChecklist {
  return {
    kind: "whistle-mvp1-uat-signoff-checklist",
    runId,
    generatedAt,
    scope: "MVP1 operator UAT only: citizen lifecycle, verification, role dashboards, protected handling, Admin controls, workers, security, and launch-gate evidence.",
    redactionPolicy: [
      "Do not include raw citizen names, phone numbers, addresses, complaint descriptions, evidence files, signed URLs, OTP values, ticket screenshots with personal data, or provider credentials.",
      "Use scenario IDs, role names, controlled artifact references, and sanitized observations in shared sign-off packets.",
      "Keep real ticket IDs only in private UAT systems if required by the launch owner.",
    ],
    commandSequence: [
      "npm run mvp1:uat-preflight",
      "npm run mvp1:rehearsal-packet -- --out artifacts/whistle-mvp1-launch-rehearsal.md",
      "npm run mvp1:uat-seed -- --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.md",
      "npm run mvp1:uat-seed -- --json --quiet --run-id <run-id> --out artifacts/whistle-mvp1-local-uat-seed.json",
      "npm run mvp1:uat-run -- --run-id <run-id> --seed-file artifacts/whistle-mvp1-local-uat-seed.json --out artifacts/whistle-mvp1-local-uat-run.md",
      "npm run mvp1:defect-register -- --run-id <run-id> --out artifacts/whistle-mvp1-defect-register.md",
      "npm run mvp1:uat-signoff -- --run-id <run-id> --out artifacts/whistle-mvp1-uat-signoff.md",
      "npm run mvp:check",
      "DATABASE_URL=postgres://whistle:whistle@localhost:54329/whistle npm run mvp:check:postgres",
    ],
    roleCoverage: [...rehearsalRoles],
    scenarioChecks: mvp1RehearsalScenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      roles: [...scenario.roles],
      acceptanceSignals: [...scenario.acceptanceSignals],
      operatorSignoff: [...scenario.operatorSignoff],
      dataSafety: [...scenario.dataSafety],
      provingCommands: scenario.commands.map((command) => command.command),
    })),
    signoffControls: signoffControls(runId),
    defectTriageRules: mvp1DefectTriagePolicy.map((lane) => ({
      severity: lane.severity,
      launchDecision: lane.launchDecision,
      requiredAction: lane.requiredAction,
      deferralRule: lane.deferralRule,
    })),
    completionRules: [
      "Attach the rehearsal packet reference in Admin before setting the UAT sign-off booleans.",
      "Attach the defect register reference and set open blocker and critical defect counts to zero before launch sign-off.",
      "Keep production provider and deployment preflight blockers separate from UAT sign-off; UAT approval cannot override runtime launch holds.",
      "Do not begin MVP2-MVP4 implementation until MVP1 launch gates are either green or explicitly deferred by the launch owner.",
    ],
  };
}

function list(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function commandRows(checklist: Mvp1UatSignoffChecklist) {
  return checklist.commandSequence.map((command, index) => `| ${index + 1} | \`${command}\` |`).join("\n");
}

function scenarioSections(checklist: Mvp1UatSignoffChecklist) {
  return checklist.scenarioChecks
    .map(
      (scenario, index) => `### ${index + 1}. ${scenario.title}

Scenario ID: \`${scenario.id}\`  
Roles: ${scenario.roles.join(", ")}

Proving commands:

${list(scenario.provingCommands.map((command) => `\`${command}\``))}

Acceptance signals:

${list(scenario.acceptanceSignals)}

Operator sign-off:

${list(scenario.operatorSignoff)}

Data-safety rule:

${list(scenario.dataSafety)}

Result: [ ] Pass [ ] Fail [ ] Not run  
Evidence reference:  
Defect IDs:  
Sign-off owner:  
Notes:`,
    )
    .join("\n\n");
}

function controlRows(checklist: Mvp1UatSignoffChecklist) {
  return checklist.signoffControls
    .map((control) => `| \`${control.controlId}\` | ${control.owner} | ${control.requiredEvidence} | ${control.scenarios.map((scenario) => `\`${scenario}\``).join("<br>")} |`)
    .join("\n");
}

function passCriteriaSections(checklist: Mvp1UatSignoffChecklist) {
  return checklist.signoffControls
    .map(
      (control) => `### ${control.label}

Admin control: \`${control.controlId}\`  
Owner: ${control.owner}  
Required evidence/value: ${control.requiredEvidence}

Pass criteria:

${list(control.passCriteria)}

Final state: [ ] Ready for Admin approval [ ] Not ready  
Approver:  
Date:  
Notes:`,
    )
    .join("\n\n");
}

function triageRows(checklist: Mvp1UatSignoffChecklist) {
  return checklist.defectTriageRules
    .map((rule) => `| ${rule.severity} | ${rule.launchDecision} | ${rule.requiredAction} | ${rule.deferralRule} |`)
    .join("\n");
}

export function renderMvp1UatSignoffChecklistMarkdown(checklist: Mvp1UatSignoffChecklist) {
  return `# Whistle MVP1 UAT Sign-Off Checklist

Run ID: \`${checklist.runId}\`  
Generated: \`${checklist.generatedAt}\`  
Scope: ${checklist.scope}

## Redaction Policy

${list(checklist.redactionPolicy)}

## Command Sequence

| Step | Command |
| --- | --- |
${commandRows(checklist)}

## Role Coverage

${list(checklist.roleCoverage)}

## Scenario Sign-Off

${scenarioSections(checklist)}

## Admin Control Mapping

| Admin control | Owner | Evidence / value | Scenario coverage |
| --- | --- | --- | --- |
${controlRows(checklist)}

## Control-Level Pass Criteria

${passCriteriaSections(checklist)}

## Defect Triage Rules

| Severity | Launch decision | Required action | Deferral rule |
| --- | --- | --- | --- |
${triageRows(checklist)}

## Completion Rules

${list(checklist.completionRules)}
`;
}

export function renderMvp1UatSignoffChecklistJson(checklist: Mvp1UatSignoffChecklist) {
  return `${JSON.stringify(checklist, null, 2)}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const checklist = createMvp1UatSignoffChecklist(options.runId);
  const rendered = options.json ? renderMvp1UatSignoffChecklistJson(checklist) : renderMvp1UatSignoffChecklistMarkdown(checklist);
  if (options.out) {
    const outPath = resolve(process.cwd(), options.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
