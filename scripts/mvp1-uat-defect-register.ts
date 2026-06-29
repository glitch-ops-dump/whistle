import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mvp1DefectTriagePolicy, mvp1RehearsalScenarios, rehearsalRoles, type DefectTriageLane } from "./mvp1-launch-rehearsal-packet.js";

type DefectStatus = "open" | "fixed_pending_retest" | "closed" | "deferred";

type DefectRegisterOptions = {
  runId: string;
  json: boolean;
  out?: string;
};

type DefectTemplateRow = {
  id: string;
  severity: DefectTriageLane["severity"];
  scenarioId: string;
  role: string;
  summary: string;
  owner: string;
  targetMvp: "MVP1" | "MVP2" | "MVP3" | "MVP4";
  status: DefectStatus;
  retestCommand: string;
  signoffOwner: string;
};

export type Mvp1UatDefectRegister = {
  kind: "whistle-mvp1-uat-defect-register";
  runId: string;
  generatedAt: string;
  scope: string;
  redactionPolicy: string[];
  zeroLaunchHoldRule: string;
  triagePolicy: DefectTriageLane[];
  coveredScenarios: Array<{
    id: string;
    title: string;
    roles: string[];
    provingCommands: string[];
  }>;
  templateRows: DefectTemplateRow[];
  signoffChecklist: string[];
  adminControlMapping: Array<{ controlId: string; expectedEvidence: string }>;
};

function defaultRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `uat-${stamp}`;
}

function parseArgs(argv: string[]): DefectRegisterOptions {
  const options: DefectRegisterOptions = {
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

function ownerForSeverity(severity: DefectTriageLane["severity"]) {
  if (severity === "Blocker") return "launch_owner";
  if (severity === "Critical") return "role_owner";
  if (severity === "Major") return "product_owner";
  return "backlog_owner";
}

function statusForSeverity(severity: DefectTriageLane["severity"]): DefectStatus {
  return severity === "Minor" ? "deferred" : "open";
}

function targetForSeverity(severity: DefectTriageLane["severity"]): DefectTemplateRow["targetMvp"] {
  if (severity === "Major") return "MVP2";
  if (severity === "Minor") return "MVP2";
  return "MVP1";
}

function scenarioForSeverity(severity: DefectTriageLane["severity"]) {
  if (severity === "Blocker") return "protected-evidence-privacy";
  if (severity === "Critical") return "role-dashboards-sla-accountability";
  if (severity === "Major") return "admin-launch-controls";
  return "citizen-intake-status";
}

function roleForScenario(scenarioId: string) {
  const scenario = mvp1RehearsalScenarios.find((item) => item.id === scenarioId);
  return scenario?.roles[0] ?? rehearsalRoles[0];
}

function templateRows(runId: string): DefectTemplateRow[] {
  return mvp1DefectTriagePolicy.map((lane, index) => {
    const scenarioId = scenarioForSeverity(lane.severity);
    const code = lane.severity.slice(0, 1).toUpperCase();
    return {
      id: `UAT-${runId}-${code}-${String(index + 1).padStart(3, "0")}`,
      severity: lane.severity,
      scenarioId,
      role: roleForScenario(scenarioId),
      summary: `Replace this ${lane.severity.toLowerCase()} template row with the observed issue, or delete it if none exists.`,
      owner: ownerForSeverity(lane.severity),
      targetMvp: targetForSeverity(lane.severity),
      status: statusForSeverity(lane.severity),
      retestCommand: lane.severity === "Blocker" ? "npm run mvp:check" : "npm run smoke:mvp1-local-uat",
      signoffOwner: lane.severity === "Blocker" || lane.severity === "Critical" ? "CM Cell + Admin" : "Product/UAT owner",
    };
  });
}

export function createMvp1UatDefectRegister(runId = defaultRunId(), generatedAt = new Date().toISOString()): Mvp1UatDefectRegister {
  return {
    kind: "whistle-mvp1-uat-defect-register",
    runId,
    generatedAt,
    scope: "MVP1 UAT only: citizen lifecycle, verification, role dashboards, protected handling, Admin controls, worker/security seams, and launch-gate evidence.",
    redactionPolicy: [
      "Do not paste citizen names, phone numbers, raw addresses, raw complaint descriptions, evidence files, signed URLs, or screenshots containing personal data.",
      "Use ticket IDs only in a private UAT artifact. Shared summaries should use scenario IDs and sanitized observations.",
      "Do not paste provider credentials, API keys, worker tokens, database URLs, OTP values, rate-limit salts, OIDC secrets, or restore timestamps.",
    ],
    zeroLaunchHoldRule: "MVP1 launch sign-off requires zero open Blocker defects and zero open Critical defects.",
    triagePolicy: mvp1DefectTriagePolicy,
    coveredScenarios: mvp1RehearsalScenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      roles: scenario.roles,
      provingCommands: scenario.commands.map((command) => command.command),
    })),
    templateRows: templateRows(runId),
    signoffChecklist: [
      "Run the local seed, role assertions, full MVP check, and any scenario-specific smoke listed in the rehearsal packet.",
      "Replace or remove every template row before attaching this register as UAT evidence.",
      "Keep Blocker and Critical open counts at zero before setting Admin UAT sign-off controls.",
      "For any Major or Minor deferral, record target MVP, owner, retest path, and approving authority.",
      "Attach the final register through Admin as artifact://whistle/mvp1/defect-register/<run-id>.",
    ],
    adminControlMapping: [
      { controlId: "uat-defect-register-ref", expectedEvidence: `artifact://whistle/mvp1/defect-register/${runId}` },
      { controlId: "uat-open-blocker-defects", expectedEvidence: "0 before launch sign-off" },
      { controlId: "uat-open-critical-defects", expectedEvidence: "0 before launch sign-off" },
      { controlId: "uat-open-major-defects", expectedEvidence: "Count open Major defects and approve/phase-tag any deferrals" },
      { controlId: "uat-open-minor-defects", expectedEvidence: "Count open Minor defects and phase-tag deferrals" },
      { controlId: "uat-defect-triage-ready", expectedEvidence: "true only after the register is reviewed and accepted" },
    ],
  };
}

function list(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function triageRows(items: DefectTriageLane[]) {
  return items
    .map((item) => `| ${item.severity} | ${item.launchDecision} | ${item.requiredAction} | ${item.deferralRule} |`)
    .join("\n");
}

function scenarioRows(register: Mvp1UatDefectRegister) {
  return register.coveredScenarios
    .map((scenario) => `| ${scenario.id} | ${scenario.title} | ${scenario.roles.join(", ")} | ${scenario.provingCommands.map((command) => `\`${command}\``).join("<br>")} |`)
    .join("\n");
}

function defectRows(register: Mvp1UatDefectRegister) {
  return register.templateRows
    .map(
      (row) =>
        `| ${row.id} | ${row.severity} | ${row.scenarioId} | ${row.role} | ${row.summary} | ${row.owner} | ${row.targetMvp} | ${row.status} | \`${row.retestCommand}\` | ${row.signoffOwner} |`,
    )
    .join("\n");
}

function controlRows(register: Mvp1UatDefectRegister) {
  return register.adminControlMapping.map((item) => `| \`${item.controlId}\` | ${item.expectedEvidence} |`).join("\n");
}

export function renderMvp1UatDefectRegisterMarkdown(register: Mvp1UatDefectRegister) {
  return `# Whistle MVP1 UAT Defect Register

Run ID: \`${register.runId}\`  
Generated: \`${register.generatedAt}\`  
Scope: ${register.scope}

## Redaction Policy

${list(register.redactionPolicy)}

## Launch Rule

${register.zeroLaunchHoldRule}

## Triage Policy

| Severity | Launch decision | Required action | Deferral rule |
| --- | --- | --- | --- |
${triageRows(register.triagePolicy)}

## Covered Scenarios

| Scenario | Title | Roles | Proving commands |
| --- | --- | --- | --- |
${scenarioRows(register)}

## Defect Log Template

Replace these template rows with actual UAT defects. Delete rows that do not apply. Do not attach this register as launch evidence until template text is removed or explicitly marked not applicable.

| Defect ID | Severity | Scenario | Role | Summary | Owner | Target MVP | Status | Retest command | Sign-off owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${defectRows(register)}

## Sign-Off Checklist

${list(register.signoffChecklist)}

## Admin Control Mapping

| Admin control | Evidence / value |
| --- | --- |
${controlRows(register)}
`;
}

export function renderMvp1UatDefectRegisterJson(register: Mvp1UatDefectRegister) {
  return `${JSON.stringify(register, null, 2)}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const register = createMvp1UatDefectRegister(options.runId);
  const rendered = options.json ? renderMvp1UatDefectRegisterJson(register) : renderMvp1UatDefectRegisterMarkdown(register);

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
