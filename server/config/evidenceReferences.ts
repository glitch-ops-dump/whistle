export type LaunchEvidenceReferenceKind =
  | "postgres_migration"
  | "postgres_mvp_check"
  | "uat_rehearsal"
  | "uat_defect_register"
  | "restore_drill"
  | "siem_worm"
  | "telemetry_watch"
  | "origin_allowlist"
  | "incident_hold";

type EvidenceReferenceRequirement = {
  label: string;
  allowedSchemes: string[];
  requiredTokens: string[];
  example: string;
};

const requirements: Record<LaunchEvidenceReferenceKind, EvidenceReferenceRequirement> = {
  postgres_migration: {
    label: "Postgres migration evidence reference",
    allowedSchemes: ["artifact://", "runbook://", "ops://"],
    requiredTokens: ["postgres-migration", "migration"],
    example: "artifact://whistle/mvp1/postgres-migration/<run-id>",
  },
  postgres_mvp_check: {
    label: "Postgres MVP check evidence reference",
    allowedSchemes: ["artifact://", "runbook://", "ops://"],
    requiredTokens: ["postgres-mvp-check", "mvp-check"],
    example: "artifact://whistle/mvp1/postgres-mvp-check/<run-id>",
  },
  uat_rehearsal: {
    label: "MVP1 rehearsal evidence reference",
    allowedSchemes: ["artifact://", "runbook://"],
    requiredTokens: ["rehearsal", "uat"],
    example: "artifact://whistle/mvp1/rehearsal-packet/<run-id>",
  },
  uat_defect_register: {
    label: "MVP1 defect register reference",
    allowedSchemes: ["artifact://", "runbook://", "ops://"],
    requiredTokens: ["defect", "triage"],
    example: "artifact://whistle/mvp1/defect-register/<run-id>",
  },
  restore_drill: {
    label: "Restore drill evidence reference",
    allowedSchemes: ["artifact://", "runbook://", "ops://"],
    requiredTokens: ["restore"],
    example: "artifact://whistle/mvp1/restore-drill/<run-id>",
  },
  siem_worm: {
    label: "SIEM/WORM export evidence reference",
    allowedSchemes: ["artifact://", "siem://", "ops://"],
    requiredTokens: ["siem", "worm"],
    example: "artifact://whistle/mvp1/siem-worm-export/<run-id>",
  },
  telemetry_watch: {
    label: "Telemetry launch watch evidence reference",
    allowedSchemes: ["artifact://", "runbook://", "ops://"],
    requiredTokens: ["telemetry", "watch"],
    example: "artifact://whistle/mvp1/telemetry-launch-watch/<run-id>",
  },
  origin_allowlist: {
    label: "Browser origin allowlist evidence reference",
    allowedSchemes: ["artifact://", "runbook://", "ops://"],
    requiredTokens: ["origin", "allowlist"],
    example: "artifact://whistle/mvp1/origin-allowlist/<run-id>",
  },
  incident_hold: {
    label: "Incident hold policy evidence reference",
    allowedSchemes: ["artifact://", "runbook://", "ops://"],
    requiredTokens: ["incident", "hold"],
    example: "artifact://whistle/mvp1/incident-hold-policy/<run-id>",
  },
};

export function isPendingReference(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return true;
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("pending-") || normalized.startsWith("not-enabled");
}

function startsWithAny(value: string, prefixes: string[]) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function includesAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(token));
}

function rawReferenceLabel(value: string) {
  if (/^https?:\/\//.test(value)) return "raw URL";
  if (/^file:\/\//.test(value)) return "local file URL";
  if (/^data:/.test(value)) return "inline data URL";
  if (/^postgres:\/\//.test(value)) return "database URL";
  return null;
}

export function launchEvidenceReferenceIssue(value: unknown, kind: LaunchEvidenceReferenceKind, label = requirements[kind].label) {
  const requirement = requirements[kind];
  if (isPendingReference(value)) return `${label} is still pending. Expected ${requirement.example}.`;
  const reference = String(value).trim();
  const normalized = reference.toLowerCase();
  const rawLabel = rawReferenceLabel(normalized);
  if (rawLabel) return `${label} must be a controlled artifact reference, not a ${rawLabel}. Expected ${requirement.example}.`;
  if (!startsWithAny(normalized, requirement.allowedSchemes)) {
    return `${label} must use ${requirement.allowedSchemes.join(", ")}. Expected ${requirement.example}.`;
  }
  if (!normalized.includes("mvp1")) return `${label} must identify MVP1 evidence. Expected ${requirement.example}.`;
  if (!includesAny(normalized, requirement.requiredTokens)) {
    return `${label} must point to ${requirement.requiredTokens.join(" or ")} evidence. Expected ${requirement.example}.`;
  }
  return null;
}

export function launchEvidenceReferenceReady(value: unknown, kind: LaunchEvidenceReferenceKind) {
  return launchEvidenceReferenceIssue(value, kind) === null;
}

export function launchEvidenceReferenceExample(kind: LaunchEvidenceReferenceKind) {
  return requirements[kind].example;
}
