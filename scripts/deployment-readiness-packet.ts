import fs from "node:fs";
import path from "node:path";
import { createDeploymentPreflightReport, deploymentPreflightRuntimeFromEnv } from "../server/config/deploymentPreflight.js";
import { parseEnvFile } from "./env-file.js";

type EnvLike = Record<string, string | undefined>;

type CliOptions = {
  envFile?: string;
  format: "markdown" | "json";
  out?: string;
};

type OwnerLane = {
  owner: string;
  purpose: string;
  keys: string[];
};

const ownerLanes: OwnerLane[] = [
  {
    owner: "Platform/Postgres",
    purpose: "Durable ticket spine, config, access, phone verification, and rate-limit persistence.",
    keys: ["DATABASE_URL"],
  },
  {
    owner: "Identity",
    purpose: "Official government console sessions with OIDC, MFA assurance, and JWKS key rotation.",
    keys: [
      "WHISTLE_PROTOTYPE_OFFICIAL_AUTH",
      "WHISTLE_OFFICIAL_OIDC_ISSUER",
      "WHISTLE_OFFICIAL_OIDC_AUDIENCE",
      "WHISTLE_OFFICIAL_OIDC_JWKS_URL",
      "WHISTLE_OFFICIAL_OIDC_MFA_REQUIRED",
    ],
  },
  {
    owner: "Worker Runtime",
    purpose: "Authenticated SLA, evidence-scan, notification, and batch jobs.",
    keys: ["WHISTLE_WORKER_AUTH_REQUIRED", "WHISTLE_WORKER_SHARED_SECRET"],
  },
  {
    owner: "Citizen OTP",
    purpose: "Out-of-band phone verification without exposing mock OTP codes.",
    keys: ["WHISTLE_OTP_PROVIDER_MODE", "WHISTLE_OTP_PROVIDER_WEBHOOK_URL", "WHISTLE_OTP_PROVIDER_API_KEY", "WHISTLE_EXPOSE_MOCK_OTP"],
  },
  {
    owner: "Evidence Security",
    purpose: "Private object storage, KMS, scanner declaration, and data residency.",
    keys: [
      "WHISTLE_EVIDENCE_OBJECT_STORE_MODE",
      "WHISTLE_EVIDENCE_S3_ENDPOINT",
      "WHISTLE_EVIDENCE_S3_BUCKET",
      "WHISTLE_EVIDENCE_S3_REGION",
      "WHISTLE_EVIDENCE_KMS_KEY_ID",
      "WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED",
      "WHISTLE_EVIDENCE_DATA_RESIDENCY",
    ],
  },
  {
    owner: "Citizen Notifications",
    purpose: "SMS/WhatsApp/in-app delivery provider contract and delivery receipts.",
    keys: ["WHISTLE_NOTIFICATION_PROVIDER_MODE", "WHISTLE_NOTIFICATION_PROVIDER_WEBHOOK_URL", "WHISTLE_NOTIFICATION_PROVIDER_API_KEY"],
  },
  {
    owner: "Network/Performance",
    purpose: "Origin allowlist, baseline security headers, and distributed public rate limiting.",
    keys: [
      "WHISTLE_RATE_LIMIT_BACKEND",
      "WHISTLE_RATE_LIMIT_GATEWAY_URL",
      "WHISTLE_RATE_LIMIT_GATEWAY_API_KEY",
      "WHISTLE_RATE_LIMIT_KEY_SALT",
      "WHISTLE_ALLOWED_ORIGINS",
      "WHISTLE_SECURITY_HEADERS_ENABLED",
    ],
  },
  {
    owner: "Security Export",
    purpose: "SIEM/WORM security log and audit export.",
    keys: ["WHISTLE_SECURITY_EXPORT_MODE", "WHISTLE_SECURITY_EXPORT_WEBHOOK_URL", "WHISTLE_SECURITY_EXPORT_API_KEY"],
  },
  {
    owner: "Telemetry",
    purpose: "OpenTelemetry export for request spans and service metrics.",
    keys: ["WHISTLE_TELEMETRY_EXPORT_MODE", "WHISTLE_OTEL_EXPORTER_OTLP_ENDPOINT"],
  },
  {
    owner: "Operations",
    purpose: "Runbook approval and fresh production-like backup/restore drill evidence.",
    keys: [
      "WHISTLE_DEPLOYMENT_PROFILE",
      "WHISTLE_DEPLOYMENT_RUNBOOK_APPROVED",
      "WHISTLE_DEPLOYMENT_RUNBOOK_VERSION",
      "WHISTLE_BACKUP_RESTORE_DRILL_APPROVED",
      "WHISTLE_BACKUP_RESTORE_DRILL_AT",
    ],
  },
] as const;

function usage() {
  return [
    "Usage: npm run deployment:packet -- --env-file <path> [--out <path>] [--format markdown|json]",
    "",
    "Examples:",
    "  npm run deployment:packet -- --env-file /secure/rendered/whistle-staging.env --out artifacts/mvp1-readiness-packet.md",
    "  npm run deployment:packet -- --env-file ops/env/whistle-mvp1-staging.env.example --format json",
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
    } else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error("--out requires a path.");
      options.out = value;
      index += 1;
    } else if (arg === "--format") {
      const value = argv[index + 1];
      if (value !== "markdown" && value !== "json") throw new Error("--format must be markdown or json.");
      options.format = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.envFile) throw new Error("--env-file is required.");
  return options;
}

function normalise(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function hasTemplatePlaceholderValue(value: string | undefined) {
  const normalized = normalise(value);
  if (!normalized) return false;
  return (
    normalized.includes("replace_with") ||
    normalized.includes("replace-with") ||
    normalized.includes("secret-manager") ||
    normalized.includes("placeholder") ||
    normalized.includes("changeme") ||
    normalized.includes("change_me") ||
    normalized.includes("dummy") ||
    normalized.includes("todo") ||
    normalized.includes("tbd") ||
    normalized.includes("example.com") ||
    normalized.includes("example.org") ||
    normalized.includes("example.net") ||
    normalized.includes("example.gov") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("0.0.0.0") ||
    normalized.includes("deployment-preflight-smoke") ||
    normalized.includes("smoke-secret") ||
    normalized.includes("smoke-key") ||
    normalized === "secret" ||
    normalized === "token" ||
    normalized === "password"
  );
}

function keyState(env: EnvLike, key: string) {
  const value = env[key];
  if (!value?.trim()) return "missing";
  if (hasTemplatePlaceholderValue(value)) return "placeholder";
  return "set";
}

function ownerLaneSummary(env: EnvLike) {
  return ownerLanes.map((lane) => {
    const keys = lane.keys.map((key) => ({ key, state: keyState(env, key) }));
    return {
      owner: lane.owner,
      purpose: lane.purpose,
      total: keys.length,
      set: keys.filter((item) => item.state === "set").length,
      missing: keys.filter((item) => item.state === "missing").map((item) => item.key),
      placeholder: keys.filter((item) => item.state === "placeholder").map((item) => item.key),
    };
  });
}

function redactObserved(value: string) {
  return value
    .replace(/backupDrillAt=[^;]+/g, "backupDrillAt=<redacted>")
    .replace(/https?:\/\/[^,\s;)]+/g, "<url-redacted>")
    .replace(/postgres:\/\/[^,\s;)]+/g, "postgres://<redacted>")
    .replace(/REPLACE_WITH_[A-Z0-9_]+/g, "<template-value>");
}

function packetFromEnv(env: EnvLike, envFile: string) {
  const report = createDeploymentPreflightReport(deploymentPreflightRuntimeFromEnv(env), env);
  const strictReady = report.productionReady && report.summary.warnings === 0;
  return {
    kind: "whistle-mvp1-readiness-packet",
    generatedAt: new Date().toISOString(),
    envFile: path.basename(envFile),
    profile: report.profile,
    productionTarget: report.productionTarget,
    strictReady,
    summary: report.summary,
    checks: report.checks.map((check) => ({
      id: check.id,
      area: check.area,
      label: check.label,
      status: check.status,
      observed: redactObserved(check.observed),
      remediation: check.remediation,
    })),
    ownerLanes: ownerLaneSummary(env),
    commands: [
      "npm run deployment:preflight -- --env-file <rendered-env>",
      "npm run deployment:preflight:assert -- --env-file <rendered-env>",
      "DATABASE_URL=<target-postgres> npm run mvp:check:postgres",
    ],
    holdConditions: [
      "Any deployment preflight blocker exists.",
      "Any warning remains when running strict assert mode.",
      "Any owner lane has missing or placeholder env values.",
      "Backup/restore drill timestamp is missing, invalid, stale, or from the future.",
      "Protected-category SOP, legal/vigilance owner, or incident hold conditions are not approved.",
    ],
  };
}

function markdownTable(rows: string[][]) {
  const header = rows[0] ?? [];
  const separator = header.map(() => "---");
  return [header, separator, ...rows.slice(1)].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function renderMarkdown(packet: ReturnType<typeof packetFromEnv>) {
  const blockers = packet.checks.filter((check) => check.status === "blocker");
  const warnings = packet.checks.filter((check) => check.status === "warning");
  const ownerRows = packet.ownerLanes.map((lane) => [
    lane.owner,
    `${lane.set}/${lane.total}`,
    lane.missing.length ? lane.missing.join(", ") : "-",
    lane.placeholder.length ? lane.placeholder.join(", ") : "-",
    lane.purpose,
  ]);
  const checkRows = packet.checks.map((check) => [check.id, check.area, check.status, check.observed, check.remediation]);
  return [
    "# Whistle MVP1 Readiness Packet",
    "",
    `Generated: ${packet.generatedAt}`,
    `Env file: ${packet.envFile}`,
    `Profile: ${packet.profile}`,
    `Production target: ${packet.productionTarget ? "yes" : "no"}`,
    `Strict ready: ${packet.strictReady ? "yes" : "no"}`,
    `Summary: ${packet.summary.blockers} blocker(s), ${packet.summary.warnings} warning(s), ${packet.summary.passes} pass(es)`,
    "",
    "This packet is redacted. It reports env key status and deployment checks, not secret values.",
    "",
    "## Owner Checklist",
    "",
    markdownTable([["Owner", "Keys Set", "Missing", "Placeholder", "Purpose"], ...ownerRows]),
    "",
    "## Deployment Checks",
    "",
    markdownTable([["Check", "Area", "Status", "Observed", "Remediation"], ...checkRows]),
    "",
    "## Priority Blockers",
    "",
    ...(blockers.length ? blockers.map((check) => `- ${check.id}: ${check.label} (${check.observed})`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(warnings.length ? warnings.map((check) => `- ${check.id}: ${check.label} (${check.observed})`) : ["- None"]),
    "",
    "## Commands",
    "",
    ...packet.commands.map((command) => `- \`${command}\``),
    "",
    "## Launch Hold Conditions",
    "",
    ...packet.holdConditions.map((condition) => `- ${condition}`),
    "",
  ].join("\n");
}

try {
  const options = parseArgs(process.argv.slice(2));
  const env = parseEnvFile(options.envFile!);
  const packet = packetFromEnv(env, options.envFile!);
  const output = options.format === "json" ? JSON.stringify(packet, null, 2) : renderMarkdown(packet);
  if (options.out) {
    const outPath = path.resolve(process.cwd(), options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, "utf8");
    console.log(`Wrote ${outPath}`);
  } else {
    console.log(output);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
