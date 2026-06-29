import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  createMvp1UatDefectRegister,
  renderMvp1UatDefectRegisterJson,
  renderMvp1UatDefectRegisterMarkdown,
} from "./mvp1-uat-defect-register.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
const register = createMvp1UatDefectRegister("uat-run-smoke-001", "2026-06-01T00:00:00.000Z");
const markdown = renderMvp1UatDefectRegisterMarkdown(register);
const json = renderMvp1UatDefectRegisterJson(register);

assert(packageJson.scripts["mvp1:defect-register"]?.includes("mvp1-uat-defect-register.ts"), "Package should expose the MVP1 defect-register generator.");
assert(register.kind === "whistle-mvp1-uat-defect-register", "Defect register kind should be stable.");
assert(register.zeroLaunchHoldRule.includes("zero open Blocker") && register.zeroLaunchHoldRule.includes("zero open Critical"), "Defect register should hold launch on blocker/critical defects.");
assert(register.triagePolicy.length === 4, "Defect register should include four severity lanes.");
assert(register.coveredScenarios.length >= 6, "Defect register should cover the MVP1 rehearsal scenarios.");
assert(register.adminControlMapping.some((item) => item.controlId === "uat-defect-register-ref"), "Defect register should map to the Admin defect-register evidence control.");
assert(register.adminControlMapping.some((item) => item.controlId === "uat-open-blocker-defects" && item.expectedEvidence.includes("0")), "Defect register should map blocker counts to zero before sign-off.");
assert(markdown.includes("# Whistle MVP1 UAT Defect Register"), "Markdown should include the register heading.");
assert(markdown.includes("## Defect Log Template"), "Markdown should include the defect log template.");
assert(markdown.includes("UAT-uat-run-smoke-001-B-001"), "Markdown should include deterministic template defect IDs.");
assert(markdown.includes("artifact://whistle/mvp1/defect-register/uat-run-smoke-001"), "Markdown should include the expected Admin evidence reference.");

for (const severity of ["Blocker", "Critical", "Major", "Minor"]) {
  assert(markdown.includes(severity), `Markdown should include ${severity} severity.`);
  assert(json.includes(severity), `JSON should include ${severity} severity.`);
}

for (const phrase of [
  "citizen lifecycle",
  "verification",
  "role dashboards",
  "protected handling",
  "Admin controls",
  "worker/security seams",
]) {
  assert(markdown.toLowerCase().includes(phrase.toLowerCase()), `Markdown should include ${phrase}.`);
}

const forbiddenPatterns = [
  /\+91\s?\d/i,
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

const tempDir = mkdtempSync(join(tmpdir(), "whistle-mvp1-defect-register-"));
try {
  const markdownPath = join(tempDir, "defects.md");
  const jsonPath = join(tempDir, "defects.json");
  execFileSync("npm", ["run", "mvp1:defect-register", "--", "--run-id", "uat-run-cli-001", "--out", markdownPath], { stdio: "pipe" });
  execFileSync("npm", ["run", "mvp1:defect-register", "--", "--json", "--run-id", "uat-run-cli-001", "--out", jsonPath], { stdio: "pipe" });
  assert(readFileSync(markdownPath, "utf8").includes("Whistle MVP1 UAT Defect Register"), "CLI should write markdown defect register.");
  const renderedJson = JSON.parse(readFileSync(jsonPath, "utf8")) as { kind?: string; runId?: string };
  assert(renderedJson.kind === "whistle-mvp1-uat-defect-register", "CLI should write JSON defect register.");
  assert(renderedJson.runId === "uat-run-cli-001", "CLI JSON should preserve the run ID.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

pass("MVP1 UAT defect register is redacted, scenario-mapped, and launch-gate aligned");
