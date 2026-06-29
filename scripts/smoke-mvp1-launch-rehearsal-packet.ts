import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  createMvp1LaunchRehearsalPacket,
  mvp1DefectTriagePolicy,
  mvp1RehearsalScenarios,
  renderMvp1LaunchRehearsalJson,
  renderMvp1LaunchRehearsalMarkdown,
} from "./mvp1-launch-rehearsal-packet.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
const scripts = packageJson.scripts;
const packet = createMvp1LaunchRehearsalPacket("2026-06-01T00:00:00.000Z");
const markdown = renderMvp1LaunchRehearsalMarkdown(packet);
const json = renderMvp1LaunchRehearsalJson(packet);

assert(packet.kind === "whistle-mvp1-launch-rehearsal-packet", "Packet kind should be stable.");
assert(packet.scope.includes("MVP1 only"), "Packet should explicitly stay focused on MVP1.");
assert(markdown.includes("## Redaction Policy"), "Markdown should include redaction policy.");
assert(markdown.includes("## Scenario Coverage"), "Markdown should include scenario coverage.");
assert(markdown.includes("## MVP1 Defect Triage Policy"), "Markdown should include MVP1 defect triage policy.");
assert(markdown.includes("## Launch Hold Conditions"), "Markdown should include launch hold conditions.");
assert(markdown.includes("Any Blocker or Critical defect remains open in the MVP1 defect register"), "Markdown should hold launch on open blocker/critical defects.");
assert(markdown.includes("npm run mvp1:uat-run"), "Markdown should include the local UAT role runner command.");
assert(markdown.includes("npm run mvp1:defect-register"), "Markdown should include the defect-register generator command.");
assert(markdown.includes("npm run mvp1:uat-signoff"), "Markdown should include the UAT sign-off checklist generator command.");
assert(packet.defectTriagePolicy.length === 4, "Packet should include four defect triage lanes.");

for (const role of ["Citizen", "Verification Team", "MLA", "Minister / Department Officer", "CM Cell", "Admin", "Worker / Security"]) {
  assert(markdown.includes(role), `Markdown should cover ${role}.`);
}

for (const scenario of mvp1RehearsalScenarios) {
  assert(markdown.includes(scenario.title), `Markdown should include scenario ${scenario.id}.`);
  assert(scenario.commands.length > 0, `${scenario.id} should include at least one proving command.`);
  for (const command of scenario.commands) {
    assert(Boolean(scripts[command.script]), `Scenario ${scenario.id} references missing package script ${command.script}.`);
    assert(command.command === `npm run ${command.script}`, `Scenario ${scenario.id} should render simple npm command for ${command.script}.`);
  }
}

for (const lane of mvp1DefectTriagePolicy) {
  assert(markdown.includes(lane.severity), `Markdown should include ${lane.severity} triage lane.`);
  assert(lane.examples.length >= 2, `${lane.severity} should include concrete examples.`);
  assert(lane.deferralRule.length > 0, `${lane.severity} should include a deferral rule.`);
}

for (const scriptName of [
  "mvp:check",
  "mvp:check:postgres",
  "mvp1:uat-preflight",
  "mvp1:uat-token",
  "mvp1:uat-seed",
  "mvp1:uat-run",
  "mvp1:defect-register",
  "mvp1:uat-signoff",
  "deployment:preflight:assert",
  "deployment:packet",
  "mvp1:handoff-packet",
  "smoke:mvp1-rehearsal-packet",
  "smoke:mvp1-handoff-packet",
]) {
  assert(Boolean(scripts[scriptName]), `Package script ${scriptName} should exist.`);
}

const forbiddenPatterns = [
  /\+91\s?\d/i,
  /WT-[A-Z0-9]/i,
  /api[_-]?key\s*[:=]\s*[A-Za-z0-9_-]{8,}/i,
  /password\s*[:=]\s*[A-Za-z0-9_-]{8,}/i,
  /shared[_-]?secret\s*[:=]\s*[A-Za-z0-9_-]{8,}/i,
  /rate[_-]?limit[_-]?salt\s*[:=]\s*[A-Za-z0-9_-]{8,}/i,
  /signed-url/i,
  /citizen name\s*[:=]\s*[A-Za-z]/i,
];
for (const pattern of forbiddenPatterns) {
  assert(!pattern.test(markdown), `Markdown should not leak sensitive pattern ${pattern}.`);
  assert(!pattern.test(json), `JSON should not leak sensitive pattern ${pattern}.`);
}

const tempDir = mkdtempSync(join(tmpdir(), "whistle-mvp1-rehearsal-"));
try {
  const markdownPath = join(tempDir, "packet.md");
  const jsonPath = join(tempDir, "packet.json");
  execFileSync("npm", ["run", "mvp1:rehearsal-packet", "--", "--out", markdownPath], { stdio: "pipe" });
  execFileSync("npm", ["run", "mvp1:rehearsal-packet", "--", "--json", "--out", jsonPath], { stdio: "pipe" });
  assert(readFileSync(markdownPath, "utf8").includes("Whistle MVP1 Launch Rehearsal Packet"), "CLI should write markdown packet.");
  const renderedJson = JSON.parse(readFileSync(jsonPath, "utf8")) as { kind?: string };
  assert(renderedJson.kind === "whistle-mvp1-launch-rehearsal-packet", "CLI should write JSON packet.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

pass("MVP1 launch rehearsal packet is scoped, redacted, and mapped to package smoke scripts");
