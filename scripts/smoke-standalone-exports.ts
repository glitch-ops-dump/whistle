import { readFileSync, statSync } from "node:fs";

type ExportCheck = {
  file: string;
  mustContain: string[];
};

const exportChecks: ExportCheck[] = [
  {
    file: "exports/standalone/whistle-workable.html",
    mustContain: ["Whistle", "Raise Complaint", "My Tickets", "Whistle is running in local UAT mode", "data:image/svg+xml"],
  },
  {
    file: "exports/standalone/whistle-verification-console.html",
    mustContain: ["Whistle Verification Console", "Intake decision bench", "data:image/svg+xml"],
  },
  {
    file: "exports/standalone/whistle-local-owner-workbench.html",
    mustContain: ["Whistle Local Owner Workbench", "Local Owner Workbench", "Ward Field Team", "data:image/svg+xml"],
  },
  {
    file: "exports/standalone/whistle-dashboard.html",
    mustContain: ["Whistle Government Dashboard", "SLA breach command center", "Ministry performance", "data:image/svg+xml"],
  },
  {
    file: "exports/standalone/whistle-cm-cell-mockup.html",
    mustContain: ["CM Cell Command Center", "State Command Center", "data:image/svg+xml"],
  },
  {
    file: "exports/standalone/whistle-ministry-console.html",
    mustContain: ["Whistle Ministry Operations Console", "Ministry control room", "Live ministry console", "data:image/svg+xml"],
  },
  {
    file: "exports/standalone/whistle-mla-mockup.html",
    mustContain: ["Whistle MLA Local Closure Dashboard", "Constituency pressure", "data:image/svg+xml"],
  },
  {
    file: "exports/standalone/whistle-public-transparency.html",
    mustContain: ["Public Transparency", "Aggregate-only", "data:image/svg+xml"],
  },
  {
    file: "exports/standalone/whistle-workflow-infographic.html",
    mustContain: [
      "Whistle Civic Journey Map",
      "From citizen voice to accountable closure",
      "Verification Desk",
      "MLA / Local Queue",
      "Statewide command",
      "Protected intake",
      "Configurable protected path",
      "V2 overlay",
      "data:image/svg+xml",
    ],
  },
  {
    file: "exports/standalone/whistle-admin-console.html",
    mustContain: [
      "Whistle Admin Console",
      "Governance approvals",
      "Generate audit export",
      "Deployment and incident sign-off",
      "Exact questions to answer before staging",
      "Government and Admin consoles need an approved identity model before launch",
      "Local role-testing launcher",
      "Seed assertion JSON",
      "Run role assertions",
      "Generate defect register",
      "Seeded scenarios",
      "Operator UAT and SOP sign-off",
      "MVP1 launch decision rules",
      "MVP1 launch handoff",
      "Data-backed lanes for provider, UAT, and ops teams",
      "MVP1 production-security handoff",
      "Configuration options",
      "Citizen government ID policy mode",
      "Approved identity policy",
      "ops/env/whistle-mvp1-staging.env.example",
      "npm run deployment:preflight:assert",
      "npm run deployment:packet",
      "data:image/svg+xml",
    ],
  },
];

const forbiddenRefs = [
  'src="/assets/',
  "src='/assets/",
  'href="/assets/',
  "href='/assets/",
  'src="/src/',
  "src='/src/",
  'href="/src/',
  "href='/src/",
  "/manifest.webmanifest",
];

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function importedModuleSpecifiers(source: string) {
  return [...source.matchAll(/(?:from|import\s*\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

function assertStandaloneModules(file: string, html: string) {
  const seenDataModules = new Set<string>();
  const queue: Array<{ label: string; source: string }> = [{ label: file, source: html }];

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const specifier of importedModuleSpecifiers(current.source)) {
      const isForbiddenSpecifier =
        specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/assets/") || specifier.startsWith("/src/");
      assert(!isForbiddenSpecifier, `${file} contains a non-standalone module import in ${current.label}: ${specifier}`);

      if (!specifier.startsWith("data:text/javascript;base64,") || seenDataModules.has(specifier)) continue;
      seenDataModules.add(specifier);
      const moduleSource = Buffer.from(specifier.slice("data:text/javascript;base64,".length), "base64").toString("utf8");
      queue.push({ label: `${file} data module ${seenDataModules.size}`, source: moduleSource });
    }
  }
}

for (const check of exportChecks) {
  const stat = statSync(check.file);
  assert(stat.size > 10_000, `${check.file} is unexpectedly small`);
  const html = readFileSync(check.file, "utf8");
  for (const text of check.mustContain) {
    assert(html.includes(text), `${check.file} is missing required text: ${text}`);
  }
  for (const ref of forbiddenRefs) {
    assert(!html.includes(ref), `${check.file} still references a non-standalone asset: ${ref}`);
  }
  assertStandaloneModules(check.file, html);
}

console.log(`PASS standalone export smoke completed for ${exportChecks.length} file(s)`);
