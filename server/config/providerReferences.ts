import { isPendingReference } from "./evidenceReferences.js";

export type ProviderReferenceKind =
  | "official_oidc"
  | "worker_auth"
  | "citizen_otp"
  | "evidence_security"
  | "notification_provider"
  | "rate_limit"
  | "observability"
  | "government_id_policy";

type ProviderReferenceRequirement = {
  label: string;
  allowedSchemes: string[];
  requiredTokens: string[];
  example: string;
};

const requirements: Record<ProviderReferenceKind, ProviderReferenceRequirement> = {
  official_oidc: {
    label: "Official OIDC/MFA config reference",
    allowedSchemes: ["secret-manager://", "provider-contract://", "ops://"],
    requiredTokens: ["oidc", "identity", "idp", "mfa"],
    example: "secret-manager://whistle/mvp1/official-oidc-mfa/<ref-id>",
  },
  worker_auth: {
    label: "Worker auth secret reference",
    allowedSchemes: ["secret-manager://", "ops://"],
    requiredTokens: ["worker", "auth"],
    example: "secret-manager://whistle/mvp1/worker-auth/<ref-id>",
  },
  citizen_otp: {
    label: "Citizen OTP/SMS provider reference",
    allowedSchemes: ["secret-manager://", "provider-contract://", "ops://"],
    requiredTokens: ["otp", "sms"],
    example: "secret-manager://whistle/mvp1/citizen-otp-provider/<ref-id>",
  },
  evidence_security: {
    label: "Evidence storage/KMS/scanner reference",
    allowedSchemes: ["secret-manager://", "provider-contract://", "ops://", "kms://"],
    requiredTokens: ["evidence", "storage", "kms", "scanner"],
    example: "secret-manager://whistle/mvp1/evidence-storage-kms-scanner/<ref-id>",
  },
  notification_provider: {
    label: "Notification provider reference",
    allowedSchemes: ["secret-manager://", "provider-contract://", "ops://"],
    requiredTokens: ["notification", "sms", "whatsapp"],
    example: "provider-contract://whistle/mvp1/notification-provider/<contract-id>",
  },
  rate_limit: {
    label: "Distributed rate-limit provider reference",
    allowedSchemes: ["secret-manager://", "provider-contract://", "ops://"],
    requiredTokens: ["rate-limit", "rate_limit", "ratelimit"],
    example: "secret-manager://whistle/mvp1/rate-limit-provider/<ref-id>",
  },
  observability: {
    label: "Deployment/SIEM/telemetry reference",
    allowedSchemes: ["secret-manager://", "provider-contract://", "ops://"],
    requiredTokens: ["observability", "siem", "telemetry", "deployment"],
    example: "ops://whistle/mvp1/observability-siem-telemetry/<ref-id>",
  },
  government_id_policy: {
    label: "Government ID provider/policy reference",
    allowedSchemes: ["policy://", "provider-contract://", "secret-manager://"],
    requiredTokens: ["government-id", "gov-id", "identity"],
    example: "policy://whistle/mvp1/gov-id-policy/<policy-id>",
  },
};

export const providerReferenceControlKinds = {
  "infra-official-oidc-config-ref": "official_oidc",
  "infra-worker-auth-config-ref": "worker_auth",
  "infra-citizen-otp-config-ref": "citizen_otp",
  "infra-evidence-storage-config-ref": "evidence_security",
  "infra-notification-provider-config-ref": "notification_provider",
  "infra-rate-limit-config-ref": "rate_limit",
  "infra-deployment-observability-config-ref": "observability",
  "identity-gov-id-provider-config-ref": "government_id_policy",
} as const satisfies Record<string, ProviderReferenceKind>;

export const mvp1ProviderReferenceControlIds = [
  "infra-official-oidc-config-ref",
  "infra-worker-auth-config-ref",
  "infra-citizen-otp-config-ref",
  "infra-evidence-storage-config-ref",
  "infra-notification-provider-config-ref",
  "infra-rate-limit-config-ref",
  "infra-deployment-observability-config-ref",
] as const;

export type ProviderReferenceControlId = keyof typeof providerReferenceControlKinds;

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

export function providerReferenceKindForControl(controlId: string): ProviderReferenceKind | null {
  return providerReferenceControlKinds[controlId as ProviderReferenceControlId] ?? null;
}

export function providerReferenceIssue(value: unknown, kind: ProviderReferenceKind, label = requirements[kind].label) {
  const requirement = requirements[kind];
  if (isPendingReference(value)) return `${label} is still pending. Expected ${requirement.example}.`;
  const reference = String(value).trim();
  const normalized = reference.toLowerCase();
  const rawLabel = rawReferenceLabel(normalized);
  if (rawLabel) return `${label} must be a controlled internal provider reference, not a ${rawLabel}. Expected ${requirement.example}.`;
  if (!startsWithAny(normalized, requirement.allowedSchemes)) {
    return `${label} must use ${requirement.allowedSchemes.join(", ")}. Expected ${requirement.example}.`;
  }
  if (!normalized.includes("mvp1")) return `${label} must identify the MVP1 launch dependency. Expected ${requirement.example}.`;
  if (!includesAny(normalized, requirement.requiredTokens)) {
    return `${label} must point to ${requirement.requiredTokens.join(" or ")} configuration. Expected ${requirement.example}.`;
  }
  return null;
}

export function providerReferenceIssueForControl(controlId: string, value: unknown, label?: string) {
  const kind = providerReferenceKindForControl(controlId);
  if (!kind) return null;
  return providerReferenceIssue(value, kind, label);
}

export function providerReferenceReady(value: unknown, kind: ProviderReferenceKind) {
  return providerReferenceIssue(value, kind) === null;
}

export function providerReferenceExample(kind: ProviderReferenceKind) {
  return requirements[kind].example;
}

export function providerReferenceExampleForControl(controlId: string) {
  const kind = providerReferenceKindForControl(controlId);
  return kind ? providerReferenceExample(kind) : null;
}
