import type { AdminConfigSnapshot } from "../config/types.js";
import { publicAssetPolicyFromConfig } from "../config/assetPolicy.js";
import { ministryForTicket } from "./dashboard.js";
import type { PublicInsights, PublicMetricRow, PublicTrendMetrics, TicketRecord } from "./types.js";

const closedStatuses = new Set(["resolved", "closed"]);
const PUBLIC_CELL_THRESHOLD_FLOOR = 2;
const DEFAULT_PUBLICATION_DELAY_HOURS = 24;

function normalise(value: string) {
  return value.trim().toLowerCase();
}

function isOpen(ticket: TicketRecord) {
  return !closedStatuses.has(ticket.status);
}

function isResolved(ticket: TicketRecord) {
  return closedStatuses.has(ticket.status);
}

function isSlaBreached(ticket: TicketRecord, now = new Date()) {
  if (ticket.sla.paused || !ticket.sla.dueAt || !isOpen(ticket)) return false;
  return ticket.sla.state === "breached" || new Date(ticket.sla.dueAt).getTime() < now.getTime();
}

function isDueWithin(ticket: TicketRecord, hours: number, now = new Date()) {
  if (ticket.sla.paused || !ticket.sla.dueAt || !isOpen(ticket)) return false;
  const dueAt = new Date(ticket.sla.dueAt).getTime();
  const delta = dueAt - now.getTime();
  return delta >= 0 && delta <= hours * 60 * 60 * 1000;
}

function isCurrentMonth(ticket: TicketRecord, now = new Date()) {
  const createdAt = new Date(ticket.createdAt);
  return createdAt.getUTCFullYear() === now.getUTCFullYear() && createdAt.getUTCMonth() === now.getUTCMonth();
}

function categoryLabel(ticket: TicketRecord, config: AdminConfigSnapshot) {
  return config.categories.find((category) => category.id === ticket.category)?.labelEn ?? ticket.category;
}

function canPublishTicket(ticket: TicketRecord, config: AdminConfigSnapshot) {
  if (ticket.protected) return false;
  const category = config.categories.find((item) => item.id === ticket.category);
  return category?.sensitivity !== "protected";
}

function publicationDelayHours(config: AdminConfigSnapshot) {
  const value = config.appControls.find((control) => control.id === "public-publish-delay-hours")?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PUBLICATION_DELAY_HOURS;
  return Math.max(0, Math.min(365 * 24, Math.trunc(value)));
}

// Small-cell suppression threshold. Config may only *tighten* privacy: the effective
// threshold can be raised above the floor but never lowered below it, so an Admin
// (mis)configuration can never weaken suppression below the baseline of 2.
function publicCellThreshold(config: AdminConfigSnapshot) {
  const value = config.appControls.find((control) => control.id === "public-cell-threshold")?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return PUBLIC_CELL_THRESHOLD_FLOOR;
  return Math.max(PUBLIC_CELL_THRESHOLD_FLOOR, Math.trunc(value));
}

function isPastPublicationDelay(ticket: TicketRecord, delayHours: number, now: Date) {
  if (delayHours <= 0) return true;
  const createdAt = new Date(ticket.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return createdAt <= now.getTime() - delayHours * 60 * 60 * 1000;
}

function metricsFor(tickets: TicketRecord[], now = new Date()): PublicTrendMetrics {
  return {
    totalTickets: tickets.length,
    openTickets: tickets.filter(isOpen).length,
    resolvedTickets: tickets.filter(isResolved).length,
    slaBreached: tickets.filter((ticket) => isSlaBreached(ticket, now)).length,
    dueIn48h: tickets.filter((ticket) => isDueWithin(ticket, 48, now)).length,
    escalatedToCmCell: tickets.filter((ticket) => ticket.status === "escalated_cm_cell" || ticket.primaryQueue.kind === "cm_cell").length,
  };
}

function rowFor(label: string, tickets: TicketRecord[], now: Date): PublicMetricRow {
  return {
    key: normalise(label).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown",
    label,
    ...metricsFor(tickets, now),
  };
}

function groupedRows(tickets: TicketRecord[], labelFor: (ticket: TicketRecord) => string, now: Date) {
  const groups = new Map<string, { label: string; tickets: TicketRecord[] }>();
  for (const ticket of tickets) {
    const label = labelFor(ticket);
    const key = normalise(label);
    const group = groups.get(key) ?? { label, tickets: [] };
    group.tickets.push(ticket);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => rowFor(group.label, group.tickets, now));
}

function thresholdRows(rows: PublicMetricRow[], threshold: number) {
  const visible = rows
    .filter((row) => row.totalTickets >= threshold)
    .sort((a, b) => b.openTickets - a.openTickets || b.slaBreached - a.slaBreached || a.label.localeCompare(b.label));
  const withheld = rows.filter((row) => row.totalTickets < threshold);
  return {
    visible,
    withheldRows: withheld.length,
    withheldTickets: withheld.reduce((sum, row) => sum + row.totalTickets, 0),
  };
}

export function isPublicInsightsEnabled(config: AdminConfigSnapshot) {
  return config.appControls.find((control) => control.id === "feature-public")?.value !== false;
}

export function createPublicInsights(tickets: TicketRecord[], config: AdminConfigSnapshot, now = new Date()): PublicInsights {
  const delayHours = publicationDelayHours(config);
  const cellThreshold = publicCellThreshold(config);
  const publishableTickets = tickets.filter((ticket) => canPublishTicket(ticket, config));
  const publicTickets = publishableTickets.filter((ticket) => isPastPublicationDelay(ticket, delayHours, now));
  const withheldRecentTickets = publishableTickets.length - publicTickets.length;
  const monthTickets = publicTickets.filter((ticket) => isCurrentMonth(ticket, now));
  const openTickets = publicTickets.filter(isOpen);

  const byDistrict = thresholdRows(groupedRows(openTickets, (ticket) => ticket.location.district, now), cellThreshold);
  const byMinistry = thresholdRows(groupedRows(openTickets, ministryForTicket, now), cellThreshold);
  const byCategory = thresholdRows(groupedRows(openTickets, (ticket) => categoryLabel(ticket, config), now), cellThreshold);

  return {
    enabled: true,
    generatedAt: now.toISOString(),
    assetPolicy: publicAssetPolicyFromConfig(config),
    privacy: {
      threshold: cellThreshold,
      publicationDelayHours: delayHours,
      publicVisibleTickets: publicTickets.length,
      withheldRecentTickets,
      protectedCount: tickets.filter((ticket) => ticket.protected).length,
      withheldSmallCellRows: byDistrict.withheldRows + byMinistry.withheldRows + byCategory.withheldRows,
      withheldSmallCellTickets: byDistrict.withheldTickets + byMinistry.withheldTickets + byCategory.withheldTickets,
      excludedFields: ["ticketId", "title", "description", "phone", "address", "landmark", "evidence", "timeline", "reporterIdentity"],
      protectedPolicy: "Protected complaints are published only as a statewide aggregate count in this V2 prototype. Non-protected complaints are delayed before public aggregation.",
    },
    trends: {
      month: metricsFor(monthTickets, now),
      allTime: metricsFor(publicTickets, now),
    },
    openIssues: {
      byDistrict: byDistrict.visible,
      byMinistry: byMinistry.visible,
      byCategory: byCategory.visible,
    },
  };
}
