import type { AuditEvent, DashboardTicketSummary, NotificationIntent, TicketRecord } from "./types.js";

export type TicketCursorKind =
  | "citizen-updated-desc"
  | "verification-created-asc"
  | "dashboard-sla-updated-desc"
  | "audit-chain-desc"
  | "notification-created-desc";

export type TicketCursorPayload = {
  v: 1;
  kind: TicketCursorKind;
  id: string;
  createdAt?: string;
  updatedAt?: string;
  slaBreached?: boolean;
  chainSequence?: number;
};

function encode(payload: TicketCursorPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function decodeTicketCursor(token: string | undefined | null, kind: TicketCursorKind): TicketCursorPayload | null {
  if (!token) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<TicketCursorPayload>;
    if (parsed.v !== 1 || parsed.kind !== kind || typeof parsed.id !== "string" || !parsed.id.trim()) return null;
    if (kind === "citizen-updated-desc" && !isIsoDate(parsed.updatedAt)) return null;
    if (kind === "verification-created-asc" && !isIsoDate(parsed.createdAt)) return null;
    if (kind === "dashboard-sla-updated-desc" && (!isIsoDate(parsed.updatedAt) || typeof parsed.slaBreached !== "boolean")) return null;
    if (kind === "audit-chain-desc" && (!Number.isInteger(parsed.chainSequence) || Number(parsed.chainSequence) < 0)) return null;
    if (kind === "notification-created-desc" && !isIsoDate(parsed.createdAt)) return null;
    return parsed as TicketCursorPayload;
  } catch {
    return null;
  }
}

export function cursorForCitizenTicket(ticket: TicketRecord) {
  return encode({
    v: 1,
    kind: "citizen-updated-desc",
    id: ticket.id,
    updatedAt: ticket.updatedAt,
  });
}

export function cursorForVerificationTicket(ticket: TicketRecord) {
  return encode({
    v: 1,
    kind: "verification-created-asc",
    id: ticket.id,
    createdAt: ticket.createdAt,
  });
}

export function cursorForDashboardTicket(ticket: TicketRecord, slaBreached: boolean) {
  return encode({
    v: 1,
    kind: "dashboard-sla-updated-desc",
    id: ticket.id,
    updatedAt: ticket.updatedAt,
    slaBreached,
  });
}

export function cursorForDashboardSummary(ticket: DashboardTicketSummary) {
  return encode({
    v: 1,
    kind: "dashboard-sla-updated-desc",
    id: ticket.id,
    updatedAt: ticket.updatedAt,
    slaBreached: ticket.sla.state === "breached",
  });
}

export function cursorForAuditEvent(event: AuditEvent) {
  return encode({
    v: 1,
    kind: "audit-chain-desc",
    id: event.id,
    chainSequence: event.chainSequence ?? 0,
  });
}

export function cursorForNotification(notification: NotificationIntent) {
  return encode({
    v: 1,
    kind: "notification-created-desc",
    id: notification.id,
    createdAt: notification.createdAt,
  });
}

export function isAfterCitizenCursor(ticket: TicketRecord, cursor: TicketCursorPayload) {
  if (!cursor.updatedAt) return false;
  if (ticket.updatedAt < cursor.updatedAt) return true;
  if (ticket.updatedAt > cursor.updatedAt) return false;
  return ticket.id < cursor.id;
}

export function isAfterVerificationCursor(ticket: TicketRecord, cursor: TicketCursorPayload) {
  if (!cursor.createdAt) return false;
  if (ticket.createdAt > cursor.createdAt) return true;
  if (ticket.createdAt < cursor.createdAt) return false;
  return ticket.id > cursor.id;
}

export function isAfterDashboardCursor(ticket: TicketRecord, slaBreached: boolean, cursor: TicketCursorPayload) {
  if (!cursor.updatedAt || typeof cursor.slaBreached !== "boolean") return false;
  const breachRank = slaBreached ? 1 : 0;
  const cursorRank = cursor.slaBreached ? 1 : 0;
  if (breachRank < cursorRank) return true;
  if (breachRank > cursorRank) return false;
  if (ticket.updatedAt < cursor.updatedAt) return true;
  if (ticket.updatedAt > cursor.updatedAt) return false;
  return ticket.id < cursor.id;
}

export function isAfterAuditCursor(event: AuditEvent, cursor: TicketCursorPayload) {
  if (typeof cursor.chainSequence !== "number") return false;
  const sequence = event.chainSequence ?? 0;
  if (sequence < cursor.chainSequence) return true;
  if (sequence > cursor.chainSequence) return false;
  return event.id < cursor.id;
}

export function isAfterNotificationCursor(notification: NotificationIntent, cursor: TicketCursorPayload) {
  if (!cursor.createdAt) return false;
  if (notification.createdAt < cursor.createdAt) return true;
  if (notification.createdAt > cursor.createdAt) return false;
  return notification.id < cursor.id;
}
