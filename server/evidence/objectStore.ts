import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceMetadata, TicketRecord } from "../ticket-spine/types.js";
import { evidencePolicyViolation } from "./policy.js";

type EnvLike = Record<string, string | undefined>;

export type EvidenceObjectRecord = {
  ticketId: string;
  evidenceId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  actor: string;
  uploadedAt: string;
  metadataStripped: boolean;
  scanStatus: "pending" | "clean" | "blocked";
  scanReason?: string;
  scannedAt?: string;
  storageProvider?: string;
  bucket?: string;
  endpoint?: string;
  kmsKeyId?: string;
  dataResidency?: string;
  malwareScannerConfigured?: boolean;
  binaryStored?: boolean;
  binarySizeBytes?: number;
  binarySha256?: string;
};

export type EvidenceObjectScanResult = {
  evidenceId: string;
  status: "clean" | "blocked" | "missing";
  reason: string;
  checksum?: string;
  metadataStripped: boolean;
};

export type EvidenceObjectStore = {
  readonly mode: string;
  healthCheck(): Promise<void>;
  recordCompletedUpload(input: { ticket: TicketRecord; evidence: EvidenceMetadata; checksum: string; actor: string }): Promise<EvidenceObjectRecord>;
  recordBinaryUpload(input: { ticket: TicketRecord; evidence: EvidenceMetadata; checksum: string; actor: string; bytes: Buffer }): Promise<EvidenceObjectRecord>;
  scanObject(ticket: TicketRecord, evidence: EvidenceMetadata, actor: string): Promise<EvidenceObjectScanResult>;
};

function defaultRootDir() {
  return process.env.WHISTLE_EVIDENCE_STORE_DIR ?? join(process.cwd(), ".whistle", "evidence-objects");
}

function modeFromEnv(env: EnvLike = process.env) {
  return env.WHISTLE_EVIDENCE_OBJECT_STORE_MODE?.trim().toLowerCase() ?? "";
}

function normalise(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function deploymentRequiresEvidenceObjectStore(env: EnvLike = process.env) {
  const value = normalise(env.WHISTLE_DEPLOYMENT_PROFILE) || normalise(env.WHISTLE_ENV) || normalise(env.NODE_ENV);
  return ["production", "prod", "staging", "stage", "pilot", "uat"].includes(value);
}

function envValue(env: EnvLike, key: string) {
  return env[key]?.trim() ?? "";
}

function isTruthy(value: string | undefined) {
  return ["1", "true", "yes", "ready", "enabled"].includes((value ?? "").trim().toLowerCase());
}

function configuredStorage(env: EnvLike = process.env) {
  return {
    endpoint: envValue(env, "WHISTLE_EVIDENCE_S3_ENDPOINT"),
    bucket: envValue(env, "WHISTLE_EVIDENCE_S3_BUCKET"),
    region: envValue(env, "WHISTLE_EVIDENCE_S3_REGION") || "ap-south-1",
    kmsKeyId: envValue(env, "WHISTLE_EVIDENCE_KMS_KEY_ID"),
    dataResidency: envValue(env, "WHISTLE_EVIDENCE_DATA_RESIDENCY") || "India",
    malwareScannerConfigured: isTruthy(env.WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED),
  };
}

function storageFileName(storageKey: string) {
  return `${createHash("sha256").update(storageKey).digest("hex")}.json`;
}

function storageBinaryFileName(storageKey: string) {
  return `${createHash("sha256").update(storageKey).digest("hex")}.bin`;
}

function blockedReason(evidence: EvidenceMetadata) {
  return evidencePolicyViolation(evidence);
}

export class LocalEvidenceObjectStore implements EvidenceObjectStore {
  readonly mode: string = "local-mock-object-store";

  constructor(private readonly rootDir = defaultRootDir()) {}

  async healthCheck() {
    await mkdir(this.rootDir, { recursive: true });
  }

  async recordCompletedUpload(input: { ticket: TicketRecord; evidence: EvidenceMetadata; checksum: string; actor: string }) {
    if (!input.evidence.storageKey) throw new Error(`Evidence ${input.evidence.id} has no storage key.`);
    await this.healthCheck();
    const record: EvidenceObjectRecord = {
      ticketId: input.ticket.id,
      evidenceId: input.evidence.id,
      storageKey: input.evidence.storageKey,
      fileName: input.evidence.fileName,
      mimeType: input.evidence.mimeType,
      sizeBytes: input.evidence.sizeBytes,
      checksum: input.checksum,
      actor: input.actor,
      uploadedAt: new Date().toISOString(),
      metadataStripped: false,
      scanStatus: "pending",
    };
    await writeFile(this.objectPath(input.evidence.storageKey), JSON.stringify(record, null, 2));
    return record;
  }

  async recordBinaryUpload(input: { ticket: TicketRecord; evidence: EvidenceMetadata; checksum: string; actor: string; bytes: Buffer }) {
    if (!input.evidence.storageKey) throw new Error(`Evidence ${input.evidence.id} has no storage key.`);
    await this.healthCheck();
    const binarySha256 = createHash("sha256").update(input.bytes).digest("hex");
    const record: EvidenceObjectRecord = {
      ticketId: input.ticket.id,
      evidenceId: input.evidence.id,
      storageKey: input.evidence.storageKey,
      fileName: input.evidence.fileName,
      mimeType: input.evidence.mimeType,
      sizeBytes: input.evidence.sizeBytes,
      checksum: input.checksum,
      actor: input.actor,
      uploadedAt: new Date().toISOString(),
      metadataStripped: false,
      scanStatus: "pending",
      binaryStored: true,
      binarySizeBytes: input.bytes.byteLength,
      binarySha256,
    };
    await writeFile(this.objectBytesPath(input.evidence.storageKey), input.bytes);
    await writeFile(this.objectPath(input.evidence.storageKey), JSON.stringify(record, null, 2));
    return record;
  }

  async scanObject(ticket: TicketRecord, evidence: EvidenceMetadata, actor: string): Promise<EvidenceObjectScanResult> {
    if (!evidence.storageKey) {
      return {
        evidenceId: evidence.id,
        status: "missing",
        reason: "Evidence has no object-storage key.",
        metadataStripped: false,
      };
    }
    const record = await this.readRecord(evidence.storageKey);
    if (!record || record.ticketId !== ticket.id || record.evidenceId !== evidence.id) {
      return {
        evidenceId: evidence.id,
        status: "missing",
        reason: "No completed object upload exists for this evidence item.",
        metadataStripped: false,
      };
    }
    if (record.mimeType !== evidence.mimeType || record.sizeBytes !== evidence.sizeBytes || record.checksum !== evidence.checksum) {
      return {
        evidenceId: evidence.id,
        status: "blocked",
        reason: "Stored object metadata no longer matches ticket evidence metadata.",
        checksum: record.checksum,
        metadataStripped: false,
      };
    }
    if (record.binaryStored) {
      try {
        const bytes = await readFile(this.objectBytesPath(evidence.storageKey));
        const binarySha256 = createHash("sha256").update(bytes).digest("hex");
        if (record.binarySizeBytes !== bytes.byteLength || record.binarySha256 !== binarySha256 || record.checksum !== `sha256:${binarySha256}`) {
          return {
            evidenceId: evidence.id,
            status: "blocked",
            reason: "Stored binary no longer matches evidence upload metadata.",
            checksum: `sha256:${binarySha256}`,
            metadataStripped: false,
          };
        }
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") {
          return {
            evidenceId: evidence.id,
            status: "missing",
            reason: "Evidence binary file is missing from local object storage.",
            metadataStripped: false,
          };
        }
        throw error;
      }
    }

    const reason = blockedReason(evidence);
    const blocked = Boolean(reason);
    const nextRecord: EvidenceObjectRecord = {
      ...record,
      actor,
      metadataStripped: !blocked,
      scanStatus: blocked ? "blocked" : "clean",
      scanReason: reason ?? "Local scanner marked object clean and metadata-stripped.",
      scannedAt: new Date().toISOString(),
    };
    await writeFile(this.objectPath(evidence.storageKey), JSON.stringify(nextRecord, null, 2));
    return {
      evidenceId: evidence.id,
      status: blocked ? "blocked" : "clean",
      reason: nextRecord.scanReason ?? "Local scanner completed.",
      checksum: record.checksum,
      metadataStripped: nextRecord.metadataStripped,
    };
  }

  protected objectPath(storageKey: string) {
    return join(this.rootDir, storageFileName(storageKey));
  }

  protected objectBytesPath(storageKey: string) {
    return join(this.rootDir, storageBinaryFileName(storageKey));
  }

  private async readRecord(storageKey: string): Promise<EvidenceObjectRecord | null> {
    try {
      const raw = await readFile(this.objectPath(storageKey), "utf8");
      return JSON.parse(raw) as EvidenceObjectRecord;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }
}

export class DisabledEvidenceObjectStore implements EvidenceObjectStore {
  readonly mode = "evidence-object-store-disabled";

  async healthCheck() {
    throw new Error("Evidence object storage is disabled; configure approved object storage, malware scanning, and KMS before production launch.");
  }

  async recordCompletedUpload(): Promise<EvidenceObjectRecord> {
    await this.healthCheck();
    throw new Error("Evidence object storage is disabled.");
  }

  async recordBinaryUpload(): Promise<EvidenceObjectRecord> {
    await this.healthCheck();
    throw new Error("Evidence object storage is disabled.");
  }

  async scanObject(): Promise<EvidenceObjectScanResult> {
    await this.healthCheck();
    throw new Error("Evidence object storage is disabled.");
  }
}

export class S3CompatibleEvidenceObjectStore implements EvidenceObjectStore {
  readonly mode = "s3-compatible-object-store-unimplemented";

  constructor(private readonly config = configuredStorage()) {}

  async healthCheck() {
    const missing = [
      this.config.endpoint ? null : "WHISTLE_EVIDENCE_S3_ENDPOINT",
      this.config.bucket ? null : "WHISTLE_EVIDENCE_S3_BUCKET",
      this.config.kmsKeyId ? null : "WHISTLE_EVIDENCE_KMS_KEY_ID",
      this.config.malwareScannerConfigured ? null : "WHISTLE_EVIDENCE_MALWARE_SCANNER_CONFIGURED=true",
    ].filter((item): item is string => Boolean(item));
    if (missing.length) {
      throw new Error(`S3-compatible evidence storage is missing ${missing.join(", ")}.`);
    }
    throw new Error("S3-compatible evidence storage is declared but no real object-store adapter is implemented in this build; keep evidence storage disabled or wire a remote adapter before staging/production.");
  }

  async recordCompletedUpload(): Promise<EvidenceObjectRecord> {
    await this.healthCheck();
    throw new Error("S3-compatible evidence storage is unavailable.");
  }

  async recordBinaryUpload(): Promise<EvidenceObjectRecord> {
    await this.healthCheck();
    throw new Error("S3-compatible evidence storage is unavailable.");
  }

  async scanObject(): Promise<EvidenceObjectScanResult> {
    await this.healthCheck();
    throw new Error("S3-compatible evidence storage is unavailable.");
  }

}

export function evidenceObjectStoreModeFromRuntimeEnv(env: EnvLike = process.env) {
  const mode = modeFromEnv(env);
  if (mode === "disabled") return "evidence-object-store-disabled";
  if (mode === "s3" || mode === "s3-compatible" || mode === "object-store") return "s3-compatible-object-store-unimplemented";
  if (deploymentRequiresEvidenceObjectStore(env)) return "evidence-object-store-disabled";
  return "local-mock-object-store";
}

export function createEvidenceObjectStore(): EvidenceObjectStore {
  const mode = modeFromEnv();
  if (mode === "disabled") return new DisabledEvidenceObjectStore();
  if (mode === "s3" || mode === "s3-compatible" || mode === "object-store") return new S3CompatibleEvidenceObjectStore();
  if (deploymentRequiresEvidenceObjectStore()) return new DisabledEvidenceObjectStore();
  return new LocalEvidenceObjectStore();
}
