const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "application/pdf",
  "text/plain",
]);

const blockedFileNameTokens = ["malware", "virus"];

const blockedExtensions = new Set([".html", ".htm", ".svg", ".js", ".mjs", ".exe", ".bat", ".cmd", ".sh", ".php"]);

export type EvidenceFileInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function normaliseMimeType(mimeType: string) {
  return mimeType.trim().toLowerCase().split(";")[0];
}

function fileExtension(fileName: string) {
  const cleanName = fileName.trim().toLowerCase();
  const dotIndex = cleanName.lastIndexOf(".");
  return dotIndex >= 0 ? cleanName.slice(dotIndex) : "";
}

export function evidencePolicyViolation(input: EvidenceFileInput): string | null {
  const fileName = input.fileName.trim().toLowerCase();
  const mimeType = normaliseMimeType(input.mimeType);
  if (!allowedMimeTypes.has(mimeType)) {
    return "Evidence content type is not allowed for Whistle intake.";
  }
  if (blockedFileNameTokens.some((token) => fileName.includes(token))) {
    return "Evidence filename failed the safety guardrail.";
  }
  if (blockedExtensions.has(fileExtension(fileName))) {
    return "Evidence file extension is not allowed for Whistle intake.";
  }
  return null;
}

export function isEvidenceFileAllowed(input: EvidenceFileInput) {
  return evidencePolicyViolation(input) === null;
}
