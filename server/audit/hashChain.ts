import { createHash } from "node:crypto";
import type { AuditEvent } from "../ticket-spine/types.js";

export const AUDIT_GENESIS_HASH = "whistle-audit-genesis-v1";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "eventHash")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function auditEventHash(event: AuditEvent, previousHash: string) {
  const payload = canonicalValue({
    previousHash,
    ticketId: event.ticketId ?? null,
    actor: event.actor,
    actorRole: event.actorRole,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    reason: event.reason ?? null,
    correlationId: event.correlationId,
    sensitive: event.sensitive,
    createdAt: event.createdAt,
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function chainAuditEvent(event: AuditEvent, previousHash: string, sequence?: number): AuditEvent {
  const eventHash = auditEventHash(event, previousHash);
  return {
    ...event,
    previousHash,
    eventHash,
    chainSequence: sequence,
  };
}

export function verifyAuditHashChain(events: AuditEvent[]) {
  let previousHash = AUDIT_GENESIS_HASH;
  for (const event of events) {
    if (!event.previousHash || !event.eventHash) {
      return { ok: false, reason: `Audit event ${event.id} is missing hash-chain metadata.` };
    }
    if (event.previousHash !== previousHash) {
      return { ok: false, reason: `Audit event ${event.id} previous hash does not match chain head.` };
    }
    const expected = auditEventHash(event, event.previousHash);
    if (event.eventHash !== expected) {
      return { ok: false, reason: `Audit event ${event.id} hash does not match event payload.` };
    }
    previousHash = event.eventHash;
  }
  return { ok: true, reason: "Audit hash chain verified." };
}
