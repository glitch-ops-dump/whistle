import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMvp1StatusReport } from "./mvp1-readiness-status.js";
import { parseEnvFile } from "./env-file.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

const envFile = "ops/env/whistle-mvp1-staging.env.example";
const report = createMvp1StatusReport({
  env: { ...process.env, ...parseEnvFile(envFile) },
  envFile,
  generatedAt: "2026-06-01T00:00:00.000Z",
});

assert(report.kind === "whistle-mvp1-readiness-status", "MVP1 status should use a stable artifact kind.");
assert(report.activeBuild === "MVP1", "MVP1 should remain the active build.");
assert(report.implementationPercent >= 70, "MVP1 implementation should report substantial completed capability.");
assert(report.launchReadinessPercent < report.implementationPercent, "Launch readiness should stay below implementation while external gates remain.");
assert(report.launchVerdict === "no_go", "Staging template status should stay no-go until real providers and restore evidence are supplied.");
assert(report.readiness.blockers > 0, "Status should surface launch blockers.");
assert(report.mvp1.includedSurfaces.includes("Citizen PWA"), "Status should include the Citizen PWA as MVP1 scope.");
assert(report.mvp1.includedSurfaces.includes("CM Cell Dashboard"), "Status should include CM Cell dashboard as MVP1 scope.");
assert(report.mvp1.deferredSurfaces.includes("Public transparency"), "Status should keep public transparency deferred from MVP1.");
assert(
  report.topBlockers.some((item) => item.includes("Official OIDC") || item.includes("OIDC")),
  "Status should name OIDC as a launch blocker when the staging template is unresolved.",
);
assert(
  report.workstreams.some((item) => item.id === "mvp1-provider-and-scale-readiness" && item.blockers.length > 0),
  "Status should expose provider and scale readiness as a blocked parallel workstream.",
);
assert(
  report.workstreams.some((item) => item.id === "mvp1-operator-uat-and-sop" && item.nextActions.some((action) => action.includes("launch rehearsal"))),
  "Status should preserve operator UAT next actions.",
);
assert(
  report.workstreams.some((item) => item.id === "mvp1-operator-uat-and-sop" && item.nextActions.some((action) => action.includes("sign-off checklist"))),
  "Status should preserve the UAT sign-off checklist as an operator next action.",
);

const jsonOutput = execFileSync("npm", ["run", "mvp1:status", "--", "--json"], { encoding: "utf8" });
const jsonStart = jsonOutput.indexOf("{");
assert(jsonStart >= 0, "MVP1 status JSON CLI should print a JSON object.");
const parsed = JSON.parse(jsonOutput.slice(jsonStart)) as typeof report;
assert(parsed.kind === report.kind && parsed.activeBuild === "MVP1", "MVP1 status JSON CLI should be parseable.");

const markdownPath = resolve(process.cwd(), "artifacts/whistle-mvp1-status-smoke.md");
execFileSync("npm", ["run", "mvp1:status", "--", "--out", markdownPath], { encoding: "utf8" });
assert(existsSync(markdownPath), "MVP1 status CLI should write markdown artifacts.");
const markdown = readFileSync(markdownPath, "utf8");
assert(markdown.includes("# Whistle MVP1 Readiness Status"), "MVP1 status markdown should include the title.");
assert(markdown.includes("Current Top Blockers"), "MVP1 status markdown should include top blockers.");
assert(markdown.includes("Parallel Workstreams"), "MVP1 status markdown should include workstream summary.");

pass("MVP1 readiness status separates implementation scope from launch blockers");
