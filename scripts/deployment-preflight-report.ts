import path from "node:path";
import { assertProductionDeploymentPreflight, createDeploymentPreflightReport, deploymentPreflightRuntimeFromEnv } from "../server/config/deploymentPreflight.js";
import { parseEnvFile } from "./env-file.js";

type EnvLike = Record<string, string | undefined>;

type CliOptions = {
  assert: boolean;
  envFile?: string;
  json: boolean;
  strict: boolean;
};

function usage() {
  return [
    "Usage: npm run deployment:preflight -- [--env-file <path>] [--json] [--assert] [--strict]",
    "",
    "Examples:",
    "  npm run deployment:preflight",
    "  npm run deployment:preflight -- --env-file ops/env/whistle-mvp1-test.env.example",
    "  npm run deployment:preflight -- --env-file ops/env/whistle-mvp1-staging.env.example",
    "  npm run deployment:preflight:assert -- --env-file /secure/rendered/whistle-staging.env",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { assert: false, json: false, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--assert") {
      options.assert = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--env-file") {
      const value = argv[index + 1];
      if (!value) throw new Error("--env-file requires a path.");
      options.envFile = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printText(report: ReturnType<typeof createDeploymentPreflightReport>, envFile?: string) {
  console.log("Whistle deployment preflight");
  if (envFile) console.log(`Env file: ${path.resolve(process.cwd(), envFile)}`);
  console.log(`Profile: ${report.profile}`);
  console.log(`Production target: ${report.productionTarget ? "yes" : "no"}`);
  console.log(`Production ready: ${report.productionReady ? "yes" : "no"}`);
  console.log(`Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s), ${report.summary.passes} pass(es)`);

  const blockers = report.checks.filter((check) => check.status === "blocker");
  const warnings = report.checks.filter((check) => check.status === "warning");
  if (blockers.length) {
    console.log("");
    console.log("Blockers:");
    for (const blocker of blockers) {
      console.log(`- ${blocker.id}: ${blocker.label} (${blocker.observed})`);
      console.log(`  Fix: ${blocker.remediation}`);
    }
  }
  if (warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning.id}: ${warning.label} (${warning.observed})`);
      console.log(`  Fix: ${warning.remediation}`);
    }
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const fileEnv = options.envFile ? parseEnvFile(options.envFile) : {};
  const env = { ...process.env, ...fileEnv } satisfies EnvLike;
  const report = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(env), env);
  if (options.json) {
    console.log(JSON.stringify({ report }, null, 2));
  } else {
    printText(report, options.envFile);
  }

  if (options.assert) {
    assertProductionDeploymentPreflight(env);
    if (options.strict && report.summary.warnings > 0) {
      throw new Error(`Whistle ${report.profile} deployment preflight has warning(s): ${report.checks.filter((check) => check.status === "warning").map((check) => check.id).join(", ")}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
