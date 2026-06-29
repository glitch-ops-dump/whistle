import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createMvp1UatSignoffChecklist,
  renderMvp1UatSignoffChecklistJson,
  renderMvp1UatSignoffChecklistMarkdown,
} from "./mvp1-uat-signoff-checklist.js";
import { mvp1RehearsalScenarios } from "./mvp1-launch-rehearsal-packet.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
const checklist = createMvp1UatSignoffChecklist("uat-signoff-smoke-001", "2026-06-01T00:00:00.000Z");
const markdown = renderMvp1UatSignoffChecklistMarkdown(checklist);
const json = renderMvp1UatSignoffChecklistJson(checklist);

assert(packageJson.scripts["mvp1:uat-signoff"]?.includes("mvp1-uat-signoff-checklist.ts"), "Package should expose the MVP1 UAT sign-off checklist generator.");
assert(packageJson.scripts["smoke:mvp1-uat-signoff"]?.includes("smoke-mvp1-uat-signoff-checklist.ts"), "Package should expose the MVP1 UAT sign-off smoke.");
assert(checklist.kind === "whistle-mvp1-uat-signoff-checklist", "Checklist kind should be stable.");
assert(checklist.scope.includes("MVP1 operator UAT only"), "Checklist should stay scoped to MVP1 operator UAT.");
assert(checklist.commandSequence.some((command) => command.includes("mvp1:uat-run")), "Checklist should include local UAT role assertions.");
assert(checklist.commandSequence.some((command) => command.includes("mvp1:defect-register")), "Checklist should include defect register generation.");
assert(checklist.commandSequence.some((command) => command.includes("mvp1:uat-signoff")), "Checklist should include its own generation command for repeatability.");
assert(markdown.includes("# Whistle MVP1 UAT Sign-Off Checklist"), "Markdown should include the title.");
assert(markdown.includes("## Admin Control Mapping"), "Markdown should include Admin control mapping.");
assert(markdown.includes("Result: [ ] Pass [ ] Fail [ ] Not run"), "Markdown should provide manual pass/fail/not-run slots.");

for (const scenario of mvp1RehearsalScenarios) {
  assert(markdown.includes(scenario.id), `Checklist should include scenario ${scenario.id}.`);
  assert(checklist.scenarioChecks.some((item) => item.id === scenario.id), `JSON checklist should include scenario ${scenario.id}.`);
}

for (const controlId of [
  "uat-launch-rehearsal-evidence-ref",
  "uat-citizen-lifecycle-rehearsed",
  "uat-verification-sop-approved",
  "uat-role-dashboard-rehearsed",
  "uat-protected-track-sop-approved",
  "uat-defect-register-ref",
  "uat-defect-triage-ready",
]) {
  assert(markdown.includes(controlId), `Checklist should map ${controlId}.`);
  assert(checklist.signoffControls.some((item) => item.controlId === controlId), `JSON checklist should map ${controlId}.`);
}

for (const forbidden of [
  /\+91\s?\d/i,
  /api[_-]?key\s*[:=]\s*[A-Za-z0-9_-]{8,}/i,
  /password\s*[:=]\s*[A-Za-z0-9_-]{8,}/i,
  /shared[_-]?secret\s*[:=]\s*[A-Za-z0-9_-]{8,}/i,
  /signed-url/i,
  /citizen name\s*[:=]\s*[A-Za-z]/i,
]) {
  assert(!forbidden.test(markdown), `Markdown should not leak sensitive pattern ${forbidden}.`);
  assert(!forbidden.test(json), `JSON should not leak sensitive pattern ${forbidden}.`);
}

const tempDir = mkdtempSync(join(tmpdir(), "whistle-mvp1-uat-signoff-"));
try {
  const markdownPath = join(tempDir, "signoff.md");
  const jsonPath = join(tempDir, "signoff.json");
  execFileSync("npm", ["run", "mvp1:uat-signoff", "--", "--run-id", "uat-signoff-cli-001", "--out", markdownPath], { stdio: "pipe" });
  execFileSync("npm", ["run", "mvp1:uat-signoff", "--", "--json", "--run-id", "uat-signoff-cli-001", "--out", jsonPath], { stdio: "pipe" });
  assert(readFileSync(markdownPath, "utf8").includes("Whistle MVP1 UAT Sign-Off Checklist"), "CLI should write markdown sign-off checklist.");
  const renderedJson = JSON.parse(readFileSync(jsonPath, "utf8")) as { kind?: string; runId?: string };
  assert(renderedJson.kind === "whistle-mvp1-uat-signoff-checklist", "CLI should write JSON sign-off checklist.");
  assert(renderedJson.runId === "uat-signoff-cli-001", "CLI JSON should preserve run ID.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

pass("MVP1 UAT sign-off checklist maps scenarios, Admin controls, evidence, and redaction rules");
