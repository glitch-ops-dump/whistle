import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  defaultAccessGrants,
  defaultAccessReviewEvents,
  defaultAccessTeams,
  defaultAccessUsers,
  defaultTeamMemberships,
} from "../server/access/defaults.js";
import type { AccessSnapshot } from "../server/access/types.js";
import { createDeploymentPreflightReport, deploymentPreflightRuntimeFromEnv } from "../server/config/deploymentPreflight.js";
import { defaultAdminConfig } from "../server/config/defaults.js";
import { createMvp1LaunchHandoffReport } from "../server/config/launchHandoff.js";
import type { Mvp1LaunchHandoffReport } from "../server/config/types.js";
import { parseEnvFile } from "./env-file.js";

type EnvLike = Record<string, string | undefined>;

type HandoffPacket = {
  kind: "whistle-mvp1-launch-handoff-packet";
  generatedAt: string;
  sourceEnv: string;
  handoff: Mvp1LaunchHandoffReport;
};

type CliOptions = {
  envFile?: string;
  format: "markdown" | "json";
  out?: string;
};

function usage() {
  return [
    "Usage: npm run mvp1:handoff-packet -- [--env-file <path>] [--out <path>] [--format markdown|json]",
    "",
    "Examples:",
    "  npm run mvp1:handoff-packet -- --out artifacts/whistle-mvp1-launch-handoff.md",
    "  npm run mvp1:handoff-packet -- --env-file /secure/rendered/whistle-staging.env --format json",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { format: "markdown" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      const value = argv[index + 1];
      if (!value) throw new Error("--env-file requires a path.");
      options.envFile = value;
      index += 1;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error("--out requires a path.");
      options.out = value;
      index += 1;
      continue;
    }
    if (arg === "--format") {
      const value = argv[index + 1];
      if (value !== "markdown" && value !== "json") throw new Error("--format must be markdown or json.");
      options.format = value;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.format = "json";
      continue;
    }
    if (arg === "--markdown") {
      options.format = "markdown";
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function accessSnapshot(): AccessSnapshot {
  return {
    users: defaultAccessUsers.map((item) => ({ ...item })),
    teams: defaultAccessTeams.map((item) => ({ ...item })),
    memberships: defaultTeamMemberships.map((item) => ({ ...item })),
    grants: defaultAccessGrants.map((item) => ({ ...item, actions: [...item.actions] })),
    reviewEvents: defaultAccessReviewEvents.map((item) => ({ ...item })),
  };
}

function redactText(value: string) {
  return value
    .replace(/postgres:\/\/[^,\s;)]+/g, "postgres://<redacted>")
    .replace(/https?:\/\/[^,\s;)]+/g, "<url-redacted>")
    .replace(/backupDrillAt=[^;]+/g, "backupDrillAt=<redacted>")
    .replace(/REPLACE_WITH_[A-Z0-9_]+/g, "<template-value>");
}

function redactedReport(report: Mvp1LaunchHandoffReport): Mvp1LaunchHandoffReport {
  return {
    ...report,
    lanes: report.lanes.map((lane) => ({
      ...lane,
      purpose: redactText(lane.purpose),
      adminControls: lane.adminControls.map((control) => ({ ...control, value: redactText(control.value) })),
      runtimeChecks: lane.runtimeChecks.map((check) => ({
        ...check,
        observed: redactText(check.observed),
        remediation: redactText(check.remediation),
      })),
      commands: lane.commands.map(redactText),
      blockers: lane.blockers.map(redactText),
      nextActions: lane.nextActions.map(redactText),
      evidenceNeeded: lane.evidenceNeeded.map(redactText),
    })),
    commands: report.commands.map(redactText),
    holdConditions: report.holdConditions.map(redactText),
    safeHandlingRules: report.safeHandlingRules.map(redactText),
  };
}

export function createMvp1LaunchHandoffPacket(input: { env?: EnvLike; envFile?: string; generatedAt?: string } = {}): HandoffPacket {
  const env = input.env ?? process.env;
  const preflight = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(env), env);
  const handoff = createMvp1LaunchHandoffReport(defaultAdminConfig(), accessSnapshot(), [], preflight);
  return {
    kind: "whistle-mvp1-launch-handoff-packet",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceEnv: input.envFile ? input.envFile.split(/[\\/]/).pop() ?? "provided-env" : "process-env",
    handoff: redactedReport(handoff),
  };
}

function markdownTable(rows: string[][]) {
  const header = rows[0] ?? [];
  const separator = header.map(() => "---");
  return [header, separator, ...rows.slice(1)].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function list(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderMvp1LaunchHandoffMarkdown(packet: HandoffPacket) {
  const handoff = packet.handoff;
  const laneRows = handoff.lanes.map((lane) => [
    lane.owner.replaceAll("_", " "),
    lane.status.replaceAll("_", " "),
    String(lane.blockers.length),
    String(lane.requiredEnv.length),
    lane.title,
  ]);
  const laneSections = handoff.lanes
    .map((lane, index) => {
      const controlRows = lane.adminControls.map((control) => [
        control.name,
        control.ready ? "ready" : "pending",
        control.critical ? "critical" : "standard",
        control.value,
      ]);
      const runtimeRows = lane.runtimeChecks.map((check) => [check.label, check.status, check.observed, check.remediation]);
      return `### ${index + 1}. ${lane.title}

Owner: ${lane.owner.replaceAll("_", " ")}  
Status: ${lane.status.replaceAll("_", " ")}  
Purpose: ${lane.purpose}

Blockers:

${lane.blockers.length ? list(lane.blockers) : "- None"}

Next actions:

${list(lane.nextActions)}

Evidence needed:

${list(lane.evidenceNeeded)}

Required env keys:

${lane.requiredEnv.length ? list(lane.requiredEnv.map((key) => `\`${key}\``)) : "- None"}

Commands:

${list(lane.commands.map((command) => `\`${command}\``))}

Admin controls:

${controlRows.length ? markdownTable([["Control", "State", "Criticality", "Value"], ...controlRows]) : "_No Admin controls assigned to this lane._"}

Runtime checks:

${runtimeRows.length ? markdownTable([["Check", "Status", "Observed", "Remediation"], ...runtimeRows]) : "_No runtime checks assigned to this lane._"}`;
    })
    .join("\n\n");

  return `# Whistle MVP1 Launch Handoff Packet

Kind: \`${packet.kind}\`  
Generated: \`${packet.generatedAt}\`  
Source env: \`${packet.sourceEnv}\`  
Active build: \`${handoff.activeBuild}\`  
Implementation: ${handoff.implementationPercent}%  
Launch readiness: ${handoff.launchReadinessPercent}%  
Launch verdict: ${handoff.launchVerdict.replaceAll("_", " ")} (${handoff.launchScore}%)

This packet is redacted. It is for provider, UAT, platform, security, observability, and operations handoff. It names controls, env keys, checks, commands, blockers, and evidence needs without printing raw secrets.

## Lane Summary

${markdownTable([["Owner", "Status", "Blockers", "Env Keys", "Lane"], ...laneRows])}

## Lanes

${laneSections}

## Global Commands

${list(handoff.commands.map((command) => `\`${command}\``))}

## Launch Hold Conditions

${list(handoff.holdConditions)}

## Safe Handling Rules

${list(handoff.safeHandlingRules)}
`;
}

export function renderMvp1LaunchHandoffJson(packet: HandoffPacket) {
  return `${JSON.stringify(packet, null, 2)}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = options.envFile ? parseEnvFile(options.envFile) : process.env;
  const packet = createMvp1LaunchHandoffPacket({ env, envFile: options.envFile });
  const rendered = options.format === "json" ? renderMvp1LaunchHandoffJson(packet) : renderMvp1LaunchHandoffMarkdown(packet);
  if (options.out) {
    const outPath = resolve(process.cwd(), options.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered, "utf8");
    console.log(`Wrote ${options.format} MVP1 launch handoff packet to ${outPath}`);
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
