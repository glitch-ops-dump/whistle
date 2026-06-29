import { createHash } from "node:crypto";
import { internalId } from "./lifecycle.js";
import type {
  DashboardBrief,
  DashboardBriefFocusArea,
  DashboardBriefRun,
  DashboardBriefWatchItem,
  DashboardMetricRow,
  DashboardTicketSummary,
  RoleDashboard,
} from "./types.js";

const PROMPT_VERSION = "dashboard-sla-brief-v2.0";
const MODEL_VERSION = "deterministic-prototype-rules";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function dueText(dueAt: string | null) {
  if (!dueAt) return "No active SLA clock";
  const hours = Math.round((new Date(dueAt).getTime() - Date.now()) / 36e5);
  if (hours < 0) return `${Math.abs(hours)}h breached`;
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

function riskLevel(dashboard: RoleDashboard): DashboardBrief["riskLevel"] {
  const { slaBreached, dueToday, escalatedToCmCell, openTickets } = dashboard.kpis;
  const breachRate = openTickets ? slaBreached / openTickets : 0;
  if (slaBreached > 25 || breachRate > 0.3 || escalatedToCmCell > 10) return "critical";
  if (slaBreached > 8 || dueToday > 8 || breachRate > 0.18) return "elevated";
  if (slaBreached > 0 || dueToday > 0) return "watch";
  return "low";
}

function toneFor(row: DashboardMetricRow): DashboardBriefFocusArea["tone"] {
  if (row.slaBreached > 10) return "critical";
  if (row.slaBreached > 3 || row.dueIn48h > 8) return "elevated";
  if (row.slaBreached > 0 || row.dueIn48h > 0) return "watch";
  return "low";
}

function topRow(rows: DashboardMetricRow[]) {
  return rows[0] ?? { label: "No active data", openTickets: 0, slaBreached: 0, dueIn48h: 0, protectedCount: 0 };
}

function ticketPriority(ticket: DashboardTicketSummary) {
  const breached = ticket.sla.state === "breached" || (ticket.sla.dueAt ? new Date(ticket.sla.dueAt).getTime() < Date.now() : false);
  const dueSoon = ticket.sla.dueAt ? new Date(ticket.sla.dueAt).getTime() - Date.now() < 48 * 36e5 : false;
  return Number(breached) * 100 + Number(ticket.primaryQueue.kind === "cm_cell") * 50 + Number(dueSoon) * 25 + Number(ticket.protected) * 10;
}

function watchlist(dashboard: RoleDashboard): DashboardBriefWatchItem[] {
  return [...dashboard.tickets]
    .sort((a, b) => ticketPriority(b) - ticketPriority(a) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map((ticket) => ({
      ticketId: ticket.id,
      title: ticket.title,
      district: ticket.district,
      ministry: ticket.ministry,
      queue: ticket.primaryQueue.kind,
      slaState: ticket.sla.state,
      dueAt: ticket.sla.dueAt,
      reason:
        ticket.primaryQueue.kind === "cm_cell"
          ? `CM Cell primary queue; ${ticket.ministry} must remain accountable.`
          : `${ticket.primaryQueue.ownerLabel} owns the next action; ${dueText(ticket.sla.dueAt)}.`,
      protected: ticket.protected,
    }));
}

function focusAreas(dashboard: RoleDashboard): DashboardBriefFocusArea[] {
  const district = topRow(dashboard.byDistrict);
  const ministry = topRow(dashboard.byMinistry);
  return [
    {
      label: dashboard.role === "cm_cell" ? "Highest district pressure" : "Highest district bottleneck",
      value: district.label,
      detail: `${formatNumber(district.slaBreached)} breached, ${formatNumber(district.dueIn48h)} due in 48h.`,
      tone: toneFor(district),
    },
    {
      label: dashboard.role === "cm_cell" ? "Highest ministry pressure" : "Portfolio pressure",
      value: ministry.label,
      detail: `${formatNumber(ministry.openTickets)} open tickets, ${formatNumber(ministry.slaBreached)} breached.`,
      tone: toneFor(ministry),
    },
    {
      label: "Next breach wave",
      value: formatNumber(dashboard.kpis.dueIn48h),
      detail: `${formatNumber(dashboard.kpis.dueToday)} due today; act before escalation pressure moves upward.`,
      tone: dashboard.kpis.dueToday > 0 ? "watch" : "low",
    },
  ];
}

function recommendedActions(dashboard: RoleDashboard): DashboardBrief["recommendedActions"] {
  const topDistrict = topRow(dashboard.byDistrict);
  const topMinistry = topRow(dashboard.byMinistry);
  if (dashboard.role === "cm_cell") {
    return [
      {
        label: "Call the red-lane ministry response",
        owner: topMinistry.label,
        reason: `${formatNumber(topMinistry.slaBreached)} breached tickets need state-level explanation.`,
        due: "Today command review",
        readOnly: true,
      },
      {
        label: "Issue district directive for the top pressure cluster",
        owner: topDistrict.label,
        reason: `${formatNumber(topDistrict.dueIn48h)} tickets are due within 48h.`,
        due: "Before next SLA sweep",
        readOnly: true,
      },
      {
        label: "Protect sensitive queue handling",
        owner: "CM Cell protected desk",
        reason: `${formatNumber(dashboard.kpis.protectedCount)} protected ticket(s) remain masked from local/ministry roles.`,
        due: "Continuous",
        readOnly: true,
      },
    ];
  }

  return [
    {
      label: "Clear the highest-breach district queue",
      owner: topDistrict.label,
      reason: `${formatNumber(topDistrict.slaBreached)} breached tickets are still inside this portfolio.`,
      due: "Before CM escalation sweep",
      readOnly: true,
    },
    {
      label: "Block the next CM escalation wave",
      owner: dashboard.scope.ministry ?? topMinistry.label,
      reason: `${formatNumber(dashboard.kpis.dueIn48h)} tickets are due within 48h.`,
      due: "48h prevention window",
      readOnly: true,
    },
    {
      label: "Confirm field closure evidence",
      owner: "District field owners",
      reason: "Closure quality is the safest way to reduce repeat escalation.",
      due: "Before marking resolved",
      readOnly: true,
    },
  ];
}

function briefForDashboard(dashboard: RoleDashboard, generatedAt: string): DashboardBrief {
  const risk = riskLevel(dashboard);
  const topDistrict = topRow(dashboard.byDistrict);
  const headline =
    dashboard.role === "cm_cell"
      ? `${risk.toUpperCase()} state escalation brief: ${formatNumber(dashboard.kpis.slaBreached)} SLA breach(es), ${formatNumber(dashboard.kpis.escalatedToCmCell)} at CM Cell.`
      : `${risk.toUpperCase()} ministry brief for ${dashboard.scope.ministry ?? "selected portfolio"}: ${formatNumber(dashboard.kpis.slaBreached)} breach(es), ${formatNumber(dashboard.kpis.dueIn48h)} due in 48h.`;

  return {
    role: dashboard.role as DashboardBrief["role"],
    scope: dashboard.scope,
    generatedAt,
    headline,
    summary:
      dashboard.role === "cm_cell"
        ? `${topDistrict.label} is the highest-pressure district. Use the brief to focus ministries, districts, and protected desks without changing ticket state.`
        : `${topDistrict.label} needs the earliest intervention inside this ministry scope. Keep local owners accountable before issues reach CM Cell.`,
    riskLevel: risk,
    kpis: {
      openTickets: dashboard.kpis.openTickets,
      slaBreached: dashboard.kpis.slaBreached,
      dueToday: dashboard.kpis.dueToday,
      dueIn48h: dashboard.kpis.dueIn48h,
      escalatedToCmCell: dashboard.kpis.escalatedToCmCell,
      protectedCount: dashboard.kpis.protectedCount,
      averageAgeHours: dashboard.kpis.averageAgeHours,
    },
    focusAreas: focusAreas(dashboard),
    recommendedActions: recommendedActions(dashboard),
    watchlist: watchlist(dashboard),
    nonMutationGuarantee: "This brief is recommend-only. It cannot change ticket status, queues, SLA clocks, notifications, evidence, or citizen-visible messages.",
  };
}

function inputHash(dashboard: RoleDashboard) {
  const payload = {
    role: dashboard.role,
    scope: dashboard.scope,
    kpis: dashboard.kpis,
    tickets: dashboard.tickets.map((ticket) => ({ id: ticket.id, updatedAt: ticket.updatedAt, queue: ticket.primaryQueue.kind, sla: ticket.sla.state })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createDashboardBriefRun(dashboard: RoleDashboard, actor: string): DashboardBriefRun {
  const generatedAt = new Date().toISOString();
  return {
    id: internalId("brief"),
    actor,
    purpose: "dashboard_sla_brief",
    role: dashboard.role as DashboardBriefRun["role"],
    scope: dashboard.scope,
    promptVersion: PROMPT_VERSION,
    modelVersion: MODEL_VERSION,
    inputHash: inputHash(dashboard),
    brief: briefForDashboard(dashboard, generatedAt),
    createdAt: generatedAt,
  };
}
