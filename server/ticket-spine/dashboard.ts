import type {
  CategoryId,
  DashboardExplanation,
  DashboardFilter,
  DashboardKpiExplanation,
  DashboardKpis,
  DashboardMetricRow,
  DashboardTicketSummary,
  GovRole,
  QueueAssignment,
  RoleDashboard,
  TicketRecord,
} from "./types.js";
import {
  cursorForDashboardTicket,
  decodeTicketCursor,
  isAfterDashboardCursor,
} from "./pagination.js";

const ministryByCategory: Record<CategoryId, string> = {
  corruption: "CM Cell / Vigilance",
  roads: "Municipal Administration and Water Supply",
  water: "Municipal Administration and Water Supply",
  power: "Energy",
  sanitation: "Municipal Administration and Water Supply",
  safety: "Home",
  health: "Health and Family Welfare",
  education: "School Education",
  revenue: "Revenue",
  ration: "Cooperation, Food and Consumer Protection",
  other: "CM Cell Routing",
};

const closedStatuses = new Set(["resolved", "closed"]);
const dashboardSourceTables = ["tickets", "ticket_queue_assignments", "sla_clock_segments", "evidence_objects"] as const;

export function ministryForTicket(ticket: TicketRecord) {
  if (ticket.departmentHint?.toLowerCase().includes("tangedco")) return "Energy";
  if (ticket.departmentHint?.toLowerCase().includes("revenue")) return "Revenue";
  return ministryByCategory[ticket.category];
}

function normalise(value: string) {
  return value.trim().toLowerCase();
}

function queueMatches(queue: QueueAssignment, query: string) {
  const target = normalise(query);
  return normalise(queue.ownerKey).includes(target) || normalise(queue.ownerLabel).includes(target) || normalise(queue.scope.value).includes(target);
}

function activeQueues(ticket: TicketRecord) {
  return [ticket.primaryQueue, ...ticket.secondaryQueues];
}

export function activeMinistryAssignment(ticket: TicketRecord, ministry?: string) {
  const target = ministry ? normalise(ministry) : null;
  return activeQueues(ticket).find(
    (queue) =>
      queue.kind === "ministry" &&
      queue.scope.jurisdiction === "ministry" &&
      (!target || normalise(queue.scope.value) === target),
  );
}

function isOpen(ticket: TicketRecord) {
  return !closedStatuses.has(ticket.status);
}

export function isSlaBreached(ticket: TicketRecord, now = new Date()) {
  if (ticket.sla.paused || !ticket.sla.dueAt || !isOpen(ticket)) return false;
  return ticket.sla.state === "breached" || new Date(ticket.sla.dueAt).getTime() < now.getTime();
}

function isDueWithin(ticket: TicketRecord, hours: number, now = new Date()) {
  if (ticket.sla.paused || !ticket.sla.dueAt || !isOpen(ticket)) return false;
  const dueAt = new Date(ticket.sla.dueAt).getTime();
  const delta = dueAt - now.getTime();
  return delta >= 0 && delta <= hours * 60 * 60 * 1000;
}

function ageHours(ticket: TicketRecord, now = new Date()) {
  const createdAt = new Date(ticket.createdAt).getTime();
  return Math.max(0, Math.round((now.getTime() - createdAt) / (60 * 60 * 1000)));
}

function canSeeProtected(role: GovRole) {
  return role === "cm_cell" || role === "verification";
}

function hasRoleVisibility(ticket: TicketRecord, filter: DashboardFilter) {
  const queues = activeQueues(ticket);
  const mappedMinistry = ministryForTicket(ticket);

  if (ticket.protected && !canSeeProtected(filter.role)) return false;
  if (filter.queue && filter.queue !== "all" && !queues.some((queue) => queue.kind === filter.queue)) return false;
  if (filter.primaryQueue && filter.primaryQueue !== "all" && ticket.primaryQueue.kind !== filter.primaryQueue) return false;
  if (filter.district && normalise(ticket.location.district) !== normalise(filter.district)) return false;
  if (filter.q) {
    const query = normalise(filter.q);
    const activeMinistry = activeMinistryAssignment(ticket)?.scope.value;
    const haystack = [ticket.id, ticket.title, ticket.description, ticket.category, ticket.status, ticket.location.district, ticket.location.area, mappedMinistry, activeMinistry ?? ""].join(" ").toLowerCase();
    if (!haystack.includes(query) && !queues.some((queue) => queueMatches(queue, query))) return false;
  }

  if (filter.role === "cm_cell") return true;
  if (filter.role === "admin") return false;
  if (filter.role === "verification") return queues.some((queue) => ["verification", "protected_review", "rejection_review"].includes(queue.kind));

  if (filter.role === "minister" || filter.role === "department_officer") {
    if (!filter.ministry) return false;
    return Boolean(activeMinistryAssignment(ticket, filter.ministry));
  }

  if (filter.role === "mla") {
    const constituency = filter.constituency;
    if (constituency && queues.some((queue) => normalise(queue.scope.value) === normalise(constituency))) return true;
    return Boolean(filter.district && normalise(ticket.location.district) === normalise(filter.district) && queues.some((queue) => ["local", "mla"].includes(queue.kind)));
  }

  if (filter.role === "councillor") {
    const ward = filter.ward;
    if (!ward) return false;
    return queues.some((queue) => queue.kind === "local" && normalise(queue.scope.value) === normalise(ward));
  }

  return false;
}

function dashboardMinistryForTicket(ticket: TicketRecord, filter: DashboardFilter) {
  if (filter.role === "minister" || filter.role === "department_officer") {
    return activeMinistryAssignment(ticket, filter.ministry)?.scope.value ?? filter.ministry ?? "Unassigned ministry";
  }
  return ministryForTicket(ticket);
}

export function ticketSummary(ticket: TicketRecord, filter: DashboardFilter): DashboardTicketSummary {
  return {
    id: ticket.id,
    title: ticket.title,
    category: ticket.category,
    status: ticket.status,
    protected: ticket.protected,
    district: ticket.location.district,
    area: ticket.location.area,
    ministry: dashboardMinistryForTicket(ticket, filter),
    primaryQueue: ticket.primaryQueue,
    secondaryQueues: ticket.secondaryQueues,
    sla: {
      ...ticket.sla,
      state: isSlaBreached(ticket) ? "breached" : ticket.sla.state,
    },
    citizenIdentityVisible: ticket.protected ? filter.role === "cm_cell" : filter.role !== "councillor",
    evidenceCount: ticket.evidence.length,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

function metricRows(tickets: TicketRecord[], labelFor: (ticket: TicketRecord) => string): DashboardMetricRow[] {
  const rows = new Map<string, DashboardMetricRow>();
  for (const ticket of tickets) {
    const label = labelFor(ticket);
    const key = normalise(label);
    const row =
      rows.get(key) ??
      ({
        key,
        label,
        openTickets: 0,
        slaBreached: 0,
        dueIn48h: 0,
        protectedCount: 0,
      } satisfies DashboardMetricRow);
    if (isOpen(ticket)) row.openTickets += 1;
    if (isSlaBreached(ticket)) row.slaBreached += 1;
    if (isDueWithin(ticket, 48)) row.dueIn48h += 1;
    if (ticket.protected) row.protectedCount += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.slaBreached - a.slaBreached || b.openTickets - a.openTickets || a.label.localeCompare(b.label));
}

function dashboardKpis(tickets: TicketRecord[]): DashboardKpis {
  const openTickets = tickets.filter(isOpen);
  return {
    openTickets: openTickets.length,
    slaBreached: tickets.filter((ticket) => isSlaBreached(ticket)).length,
    dueToday: tickets.filter((ticket) => isDueWithin(ticket, 24)).length,
    dueIn48h: tickets.filter((ticket) => isDueWithin(ticket, 48)).length,
    escalatedToCmCell: tickets.filter((ticket) => ticket.status === "escalated_cm_cell" || ticket.primaryQueue.kind === "cm_cell").length,
    protectedCount: tickets.filter((ticket) => ticket.protected).length,
    rejectionReview: tickets.filter((ticket) => ticket.primaryQueue.kind === "rejection_review").length,
    averageAgeHours: openTickets.length ? Math.round(openTickets.reduce((sum, ticket) => sum + ageHours(ticket), 0) / openTickets.length) : 0,
  };
}

function protectedPolicyFor(role: GovRole) {
  if (canSeeProtected(role)) return "Protected tickets are visible to CM Cell and Verification/protected-review roles in this MVP.";
  if (role === "admin") return "Admin does not receive operational ticket rows; Admin can inspect definitions without entering the ticket queue.";
  return "Protected tickets are excluded before KPI and grouping calculations for this role.";
}

function roleScopeRule(filter: DashboardFilter) {
  if (filter.role === "cm_cell") return "CM Cell scope includes all visible statewide tickets after optional filters.";
  if (filter.role === "verification") return "Verification scope includes verification, protected-review, and rejection-review queues.";
  if (filter.role === "minister" || filter.role === "department_officer") return `Scope includes tickets with an active ministry assignment matching: ${filter.ministry ?? "missing ministry filter"}.`;
  if (filter.role === "mla") return `Scope includes constituency/local visibility for ${filter.constituency ?? filter.district ?? "the requested MLA filters"}.`;
  if (filter.role === "councillor") return `Scope includes local ward tickets for ${filter.ward ?? "the requested ward"}.`;
  return "Admin is excluded from operational ticket queue visibility.";
}

function appliedFilters(filter: DashboardFilter): DashboardExplanation["appliedFilters"] {
  const items: DashboardExplanation["appliedFilters"] = [];
  if (filter.ministry) items.push({ key: "ministry", value: filter.ministry, rule: "Include tickets with an active ministry queue assignment for this ministry." });
  if (filter.district) items.push({ key: "district", value: filter.district, rule: "Include tickets whose location district matches this value." });
  if (filter.constituency) items.push({ key: "constituency", value: filter.constituency, rule: "Include MLA/local queue records scoped to this constituency." });
  if (filter.ward) items.push({ key: "ward", value: filter.ward, rule: "Include local queue records scoped to this ward." });
  if (filter.queue && filter.queue !== "all") items.push({ key: "queue", value: filter.queue, rule: "Include tickets with a primary or secondary queue of this kind." });
  if (filter.primaryQueue && filter.primaryQueue !== "all") items.push({ key: "primaryQueue", value: filter.primaryQueue, rule: "Include tickets whose current primary owner queue matches this kind." });
  if (filter.q) items.push({ key: "q", value: "redacted search text", rule: "Search across non-sensitive operational fields and queue labels; raw search text is not echoed." });
  if (filter.ticketLimit) items.push({ key: "ticketLimit", value: String(filter.ticketLimit), rule: "Limit ticket rows returned while preserving full scoped KPI and grouping calculations." });
  if (filter.ticketOffset) items.push({ key: "ticketOffset", value: String(filter.ticketOffset), rule: "Offset ticket rows for paginated queue review." });
  return items;
}

function explanationScope(filter: DashboardFilter): DashboardFilter {
  return filter.q ? { ...filter, q: "redacted search text" } : filter;
}

function kpiExplanations(kpis: DashboardKpis): DashboardKpiExplanation[] {
  return [
    {
      key: "openTickets",
      label: "Open tickets",
      value: kpis.openTickets,
      definition: "Scoped visible tickets whose status is not resolved or closed.",
      sourceFields: ["tickets.status"],
    },
    {
      key: "slaBreached",
      label: "SLA breached",
      value: kpis.slaBreached,
      definition: "Scoped visible open tickets whose active SLA is marked breached or whose due time has passed.",
      sourceFields: ["sla_clock_segments.state", "sla_clock_segments.due_at", "tickets.status"],
    },
    {
      key: "dueToday",
      label: "Due today",
      value: kpis.dueToday,
      definition: "Scoped visible open tickets due within the next 24 hours and not paused.",
      sourceFields: ["sla_clock_segments.due_at", "sla_clock_segments.paused_at", "tickets.status"],
    },
    {
      key: "dueIn48h",
      label: "Due in 48h",
      value: kpis.dueIn48h,
      definition: "Scoped visible open tickets due within the next 48 hours and not paused.",
      sourceFields: ["sla_clock_segments.due_at", "sla_clock_segments.paused_at", "tickets.status"],
    },
    {
      key: "escalatedToCmCell",
      label: "Escalated to CM Cell",
      value: kpis.escalatedToCmCell,
      definition: "Scoped visible tickets with escalated_cm_cell status or CM Cell as the primary queue.",
      sourceFields: ["tickets.status", "ticket_queue_assignments.queue_kind", "ticket_queue_assignments.is_primary"],
    },
    {
      key: "protectedCount",
      label: "Protected count",
      value: kpis.protectedCount,
      definition: "Scoped visible tickets marked protected. Roles without protected visibility see zero because protected tickets are excluded before aggregation.",
      sourceFields: ["tickets.is_protected"],
    },
    {
      key: "rejectionReview",
      label: "Rejection review",
      value: kpis.rejectionReview,
      definition: "Scoped visible tickets whose active primary queue is the CM-maintained rejection-review queue.",
      sourceFields: ["ticket_queue_assignments.queue_kind", "ticket_queue_assignments.is_primary", "ticket_queue_assignments.released_at"],
    },
    {
      key: "averageAgeHours",
      label: "Average age hours",
      value: kpis.averageAgeHours,
      definition: "Average age in hours across scoped visible open tickets, measured from ticket creation time.",
      sourceFields: ["tickets.created_at", "tickets.status"],
    },
  ];
}

export function createRoleDashboard(tickets: TicketRecord[], filter: DashboardFilter): RoleDashboard {
  const scopedTickets = tickets.filter((ticket) => hasRoleVisibility(ticket, filter));
  const limit = filter.ticketLimit ?? 50;
  const offset = filter.ticketOffset ?? 0;
  const sortedTicketRows = scopedTickets.sort((a, b) => {
    const breachDelta = Number(isSlaBreached(b)) - Number(isSlaBreached(a));
    if (breachDelta !== 0) return breachDelta;
    const updatedDelta = b.updatedAt.localeCompare(a.updatedAt);
    if (updatedDelta !== 0) return updatedDelta;
    return b.id.localeCompare(a.id);
  });
  const cursor = decodeTicketCursor(filter.ticketCursor, "dashboard-sla-updated-desc");
  const cursorRows = cursor ? sortedTicketRows.filter((ticket) => isAfterDashboardCursor(ticket, isSlaBreached(ticket), cursor)) : sortedTicketRows;
  const pageRows = cursorRows.slice(offset, offset + limit);
  const nextCursorSource = pageRows.at(-1);
  const hasMore = offset + pageRows.length < cursorRows.length;
  const ticketSummaries = pageRows.map((ticket) => ticketSummary(ticket, filter));
  return {
    role: filter.role,
    scope: filter,
    kpis: dashboardKpis(scopedTickets),
    readModel: {
      source: "ticket_graph",
      aggregateStrategy: "in_memory_ticket_graph",
      ticketRowsHydrated: pageRows.length,
      scopedTicketTotal: sortedTicketRows.length,
    },
    byDistrict: metricRows(scopedTickets, (ticket) => ticket.location.district),
    byMinistry: metricRows(scopedTickets, (ticket) => dashboardMinistryForTicket(ticket, filter)),
    ticketWindow: {
      limit,
      offset,
      cursor: filter.ticketCursor ?? null,
      total: sortedTicketRows.length,
      returned: pageRows.length,
      hasMore,
      nextOffset: !filter.ticketCursor && hasMore ? offset + limit : null,
      nextCursor: hasMore && nextCursorSource ? cursorForDashboardTicket(nextCursorSource, isSlaBreached(nextCursorSource)) : null,
    },
    tickets: ticketSummaries,
  };
}

export function createDashboardExplanationFromDashboard(dashboard: RoleDashboard, inputRecords: number, hiddenProtectedRecords: number): DashboardExplanation {
  const exposesExactHiddenProtectedRecords = canSeeProtected(dashboard.role);
  return {
    role: dashboard.role,
    scope: explanationScope(dashboard.scope),
    generatedAt: new Date().toISOString(),
    source: {
      system: "whistle-ticket-spine",
      inputRecords,
      scopedRecords: dashboard.readModel.scopedTicketTotal,
      readModel: "role-dashboard",
      projection: dashboard.readModel,
      sourceTables: [...dashboardSourceTables],
    },
    visibility: {
      protectedPolicy: protectedPolicyFor(dashboard.role),
      adminPolicy: "Admin can inspect dashboard definitions and scoped aggregate counts, but Admin is intentionally not an operational ticket queue.",
      roleScopeRule: roleScopeRule(dashboard.scope),
      hiddenProtectedRecords: exposesExactHiddenProtectedRecords ? hiddenProtectedRecords : null,
      hiddenProtectedRecordsRedacted: !exposesExactHiddenProtectedRecords,
      hiddenProtectedRecordPolicy: exposesExactHiddenProtectedRecords
        ? "Exact hidden protected-ticket counts are visible only to roles with protected-ticket visibility."
        : "Exact hidden protected-ticket counts are redacted for roles without protected-ticket visibility.",
    },
    appliedFilters: appliedFilters(dashboard.scope),
    kpis: kpiExplanations(dashboard.kpis),
    groupings: [
      {
        key: "byDistrict",
        definition: "Groups scoped visible tickets by ticket location district, then calculates open, SLA-breached, due-in-48h, and protected counts.",
        sourceFields: ["tickets.location.district", "tickets.status", "tickets.is_protected", "sla_clock_segments"],
        rowCount: dashboard.byDistrict.length,
      },
      {
        key: "byMinistry",
        definition: "Groups scoped visible tickets by active ministry assignment for ministry roles, or by category/department mapping for statewide views, then calculates open, SLA-breached, due-in-48h, and protected counts.",
        sourceFields: ["tickets.category_id", "tickets.department_hint", "ticket_queue_assignments.scope_value", "sla_clock_segments"],
        rowCount: dashboard.byMinistry.length,
      },
    ],
    privacyGuarantees: [
      "No citizen phone number, citizen phone hash, address, raw complaint description, raw evidence, or notification content is returned.",
      "Search text is not echoed in explanations.",
      "Protected tickets are excluded for unauthorized roles before KPI and grouping calculations.",
      "Use /api/audit or governance exports for ticket-level investigation; this endpoint is for count explainability.",
    ],
  };
}

export function createDashboardExplanation(tickets: TicketRecord[], filter: DashboardFilter): DashboardExplanation {
  const dashboard = createRoleDashboard(tickets, filter);
  const hiddenProtectedRecords = tickets.filter((ticket) => ticket.protected && !hasRoleVisibility(ticket, filter)).length;
  return createDashboardExplanationFromDashboard(dashboard, tickets.length, hiddenProtectedRecords);
}
