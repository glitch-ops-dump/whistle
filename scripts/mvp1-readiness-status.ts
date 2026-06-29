import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
import { createLaunchReadinessReport } from "../server/config/launchReadiness.js";
import { createMvpScopeReport } from "../server/config/mvpScope.js";
import type { LaunchReadinessCheck, MvpLaunchWorkstream, MvpPhaseScope } from "../server/config/types.js";
import { parseEnvFile } from "./env-file.js";

type EnvLike = Record<string, string | undefined>;

type CliOptions = {
  envFile?: string;
  format: "markdown" | "json";
  out?: string;
};

type Mvp1StatusReport = {
  kind: "whistle-mvp1-readiness-status";
  generatedAt: string;
  sourceEnv: string;
  activeBuild: "MVP1";
  implementationPercent: number;
  launchReadinessPercent: number;
  launchVerdict: string;
  launchScore: number;
  readiness: {
    blockers: number;
    warnings: number;
    passes: number;
  };
  mvp1: {
    status: MvpPhaseScope["status"];
    includedSurfaces: string[];
    deferredSurfaces: string[];
    exitCriteria: string[];
    items: Array<{
      id: string;
      label: string;
      status: string;
      gaps: string[];
    }>;
  };
  workstreams: Array<{
    id: string;
    owner: MvpLaunchWorkstream["owner"];
    title: string;
    status: MvpLaunchWorkstream["status"];
    blockers: string[];
    nextActions: string[];
  }>;
  launchChecks: Array<{
    id: string;
    label: string;
    status: LaunchReadinessCheck["status"];
    details: string[];
  }>;
  topBlockers: string[];
  nextActions: string[];
};

function usage() {
  return [
    "Usage: npm run mvp1:status -- [--env-file <path>] [--out <path>] [--format markdown|json]",
    "",
    "Examples:",
    "  npm run mvp1:status",
    "  npm run mvp1:status -- --env-file /secure/rendered/whistle-staging.env --json",
    "  npm run mvp1:status -- --out artifacts/whistle-mvp1-status.md",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const defaultEnvFile = "ops/env/whistle-mvp1-staging.env.example";
  const options: CliOptions = {
    envFile: existsSync(resolve(process.cwd(), defaultEnvFile)) ? defaultEnvFile : undefined,
    format: "markdown",
  };
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

function compactList(items: string[], limit: number) {
  return items.slice(0, limit);
}

export function createMvp1StatusReport(input: { env?: EnvLike; envFile?: string; generatedAt?: string } = {}): Mvp1StatusReport {
  const env = input.env ?? process.env;
  const config = defaultAdminConfig();
  const access = accessSnapshot();
  const deploymentPreflight = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(env), env);
  const readiness = createLaunchReadinessReport(config, access, [], deploymentPreflight);
  const scope = createMvpScopeReport(config, access, [], deploymentPreflight);
  const mvp1 = scope.phases.find((phase) => phase.id === "MVP1");
  if (!mvp1) throw new Error("MVP1 phase is missing from the scope report.");
  const blockingChecks = readiness.checks.filter((check) => check.status === "blocker");
  const blockingWorkstreams = scope.activeBuildWorkstreams.filter((workstream) => workstream.blockers.length > 0);
  const topBlockers = [
    ...blockingChecks.flatMap((check) => check.details.map((detail) => `${check.label}: ${detail}`)),
    ...blockingWorkstreams.flatMap((workstream) => workstream.blockers.map((blocker) => `${workstream.title}: ${blocker}`)),
  ];
  const nextActions = [
    ...scope.activeBuildWorkstreams.flatMap((workstream) => workstream.nextActions),
    ...deploymentPreflight.nextActions,
  ];
  return {
    kind: "whistle-mvp1-readiness-status",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceEnv: input.envFile ? resolve(process.cwd(), input.envFile) : "process-env",
    activeBuild: "MVP1",
    implementationPercent: mvp1.implementationPercent,
    launchReadinessPercent: mvp1.launchReadinessPercent,
    launchVerdict: readiness.verdict,
    launchScore: readiness.score,
    readiness: {
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      passes: readiness.checks.filter((check) => check.status === "pass").length,
    },
    mvp1: {
      status: mvp1.status,
      includedSurfaces: [...mvp1.includedSurfaces],
      deferredSurfaces: [...mvp1.deferredSurfaces],
      exitCriteria: [...mvp1.exitCriteria],
      items: mvp1.items.map((item) => ({
        id: item.id,
        label: item.label,
        status: item.status,
        gaps: [...item.gaps],
      })),
    },
    workstreams: scope.activeBuildWorkstreams.map((workstream) => ({
      id: workstream.id,
      owner: workstream.owner,
      title: workstream.title,
      status: workstream.status,
      blockers: [...workstream.blockers],
      nextActions: [...workstream.nextActions],
    })),
    launchChecks: readiness.checks.map((check) => ({
      id: check.id,
      label: check.label,
      status: check.status,
      details: [...check.details],
    })),
    topBlockers: compactList(topBlockers, 18),
    nextActions: [...new Set(compactList(nextActions, 18))],
  };
}

function markdownTable(rows: string[][]) {
  const header = rows[0] ?? [];
  const separator = header.map(() => "---");
  return [header, separator, ...rows.slice(1)].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function list(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderMarkdown(report: Mvp1StatusReport) {
  const itemRows = report.mvp1.items.map((item) => [item.id, item.status, item.gaps.length ? item.gaps[0] : "No gap"]);
  const workstreamRows = report.workstreams.map((workstream) => [
    workstream.owner.replaceAll("_", " "),
    workstream.status,
    String(workstream.blockers.length),
    workstream.title,
  ]);
  const checkRows = report.launchChecks.map((check) => [check.id, check.status, check.details[0] ?? ""]);
  return `# Whistle MVP1 Readiness Status

Kind: \`${report.kind}\`  
Generated: \`${report.generatedAt}\`  
Source env: \`${report.sourceEnv}\`  
Active build: \`${report.activeBuild}\`

## Summary

- Implementation: ${report.implementationPercent}%
- Launch readiness: ${report.launchReadinessPercent}%
- Launch verdict: ${report.launchVerdict.replaceAll("_", " ")} (${report.launchScore}%)
- Readiness checks: ${report.readiness.passes} pass, ${report.readiness.warnings} warning, ${report.readiness.blockers} blocker

## MVP1 Surface Boundary

Included: ${report.mvp1.includedSurfaces.join(", ")}

Deferred: ${report.mvp1.deferredSurfaces.join(", ")}

## Current Top Blockers

${list(report.topBlockers)}

## MVP1 Items

${markdownTable([["Item", "Status", "First gap"], ...itemRows])}

## Parallel Workstreams

${markdownTable([["Owner", "Status", "Blockers", "Workstream"], ...workstreamRows])}

## Launch Checks

${markdownTable([["Check", "Status", "Detail"], ...checkRows])}

## Next Actions

${list(report.nextActions)}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = options.envFile ? { ...process.env, ...parseEnvFile(options.envFile) } : process.env;
  const report = createMvp1StatusReport({ env, envFile: options.envFile });
  const body = options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
  if (options.out) {
    const outPath = resolve(process.cwd(), options.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, body, "utf8");
    process.stdout.write(`Wrote ${outPath}\n`);
    return;
  }
  process.stdout.write(body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
