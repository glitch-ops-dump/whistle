import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  Home,
  Landmark,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  fetchRoleDashboard,
  fetchTicketDetail,
  hoursUntil,
  submitFieldAction,
  type DashboardAuth,
  type DashboardTicketDto,
  type FieldActionRequest,
  type RoleDashboardDto,
  type TicketDetailDto,
} from "./govDashboardApi";

type RuntimeAssets = {
  logo: string;
  emblem: string;
  portrait: string;
};

type LocalSection = "today" | "queue" | "escalated" | "workspace";
type ActionMode = "schedule_visit" | "add_field_report" | "transfer" | "resolve";

declare global {
  interface Window {
    __WHISTLE_ASSETS__?: RuntimeAssets;
  }
}

const ASSETS: RuntimeAssets = window.__WHISTLE_ASSETS__ ?? {
  logo: "/assets/brand/whistle-fake-logo.svg",
  emblem: "/assets/brand/whistle-civic-mark.svg",
  portrait: "/assets/brand/whistle-service-portrait.svg",
};

const roleAuth: DashboardAuth = {
  role: "councillor",
  actor: "councillor:prototype",
};

const ward = "Ward 48";
const localOwnerName = "Tmt. S. Thenmozhi";
const localBody = "Velachery Ward Field Team";
const district = "Chennai";
const constituency = "Velachery";

const sectionItems: Array<{ id: LocalSection; label: string; detail: string; icon: LucideIcon }> = [
  { id: "today", label: "Today", detail: "Visit and closure plan", icon: Home },
  { id: "queue", label: "Local queue", detail: "Primary ward work", icon: ClipboardCheck },
  { id: "escalated", label: "Escalated out", detail: "Secondary accountability", icon: TimerReset },
  { id: "workspace", label: "Ticket workspace", detail: "Field action and timeline", icon: FileText },
];

const actionCopy: Record<ActionMode, { label: string; short: string; detail: string; icon: LucideIcon }> = {
  schedule_visit: {
    label: "Schedule visit",
    short: "Visit",
    detail: "Schedule a field inspection and show the citizen an update.",
    icon: CalendarCheck,
  },
  add_field_report: {
    label: "Add field report",
    short: "Report",
    detail: "Record what the ward team found or did, with evidence metadata.",
    icon: UploadCloud,
  },
  transfer: {
    label: "Transfer to ministry",
    short: "Transfer",
    detail: "Move primary ownership up with a reason; keep local visibility.",
    icon: ArrowRight,
  },
  resolve: {
    label: "Resolve with proof",
    short: "Resolve",
    detail: "Close only when visit, evidence, citizen impact, and safety checks are complete.",
    icon: CheckCircle2,
  },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function slaText(ticket: DashboardTicketDto | TicketDetailDto) {
  if (!ticket.sla.dueAt) return "No active SLA";
  const hours = hoursUntil(ticket.sla.dueAt);
  if (hours < 0) return `${Math.abs(hours)}h late`;
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

function slaTone(ticket: DashboardTicketDto | TicketDetailDto) {
  if (ticket.sla.state === "breached" || hoursUntil(ticket.sla.dueAt) < 0) return "danger";
  if (ticket.sla.state === "due_soon" || (ticket.sla.dueAt && hoursUntil(ticket.sla.dueAt) <= 48)) return "warn";
  if (ticket.sla.state === "resolved") return "done";
  return "good";
}

function queueStage(ticket: DashboardTicketDto) {
  if (ticket.primaryQueue.kind === "local" || ticket.primaryQueue.kind === "mla") return "primary-local";
  if (ticket.primaryQueue.kind === "cm_cell") return "cm-cell";
  if (ticket.primaryQueue.kind === "ministry") return "ministry";
  return "other";
}

function isClosed(ticket?: DashboardTicketDto | TicketDetailDto | null) {
  return ticket?.status === "resolved" || ticket?.status === "closed";
}

function canPrimaryAct(ticket?: DashboardTicketDto | null) {
  return Boolean(ticket && (ticket.primaryQueue.kind === "local" || ticket.primaryQueue.kind === "mla") && !isClosed(ticket));
}

function canSupportAct(ticket?: DashboardTicketDto | null) {
  return Boolean(ticket && !isClosed(ticket));
}

function noteForAction(mode: ActionMode, note: string) {
  const trimmed = note.trim();
  if (trimmed.length >= 12) return trimmed;
  if (mode === "transfer") return "Ward team confirms this needs ministry ownership because contractor scheduling is outside local execution capacity.";
  if (mode === "resolve") return "Ward team completed the field visit, attached closure proof, checked citizen impact, and removed the safety risk.";
  if (mode === "add_field_report") return "Ward team inspected the location and recorded the current field status for closure follow-up.";
  return "Ward field visit scheduled for inspection and closure planning.";
}

function metricItems(dashboard: RoleDashboardDto | null, tickets: DashboardTicketDto[]) {
  const primaryLocal = tickets.filter((ticket) => canPrimaryAct(ticket)).length;
  const escalated = tickets.filter((ticket) => queueStage(ticket) === "cm-cell" || queueStage(ticket) === "ministry").length;
  const due48 = dashboard?.kpis.dueIn48h ?? tickets.filter((ticket) => ticket.sla.dueAt && hoursUntil(ticket.sla.dueAt) >= 0 && hoursUntil(ticket.sla.dueAt) <= 48).length;
  const breached = dashboard?.kpis.slaBreached ?? tickets.filter((ticket) => slaTone(ticket) === "danger").length;
  return {
    open: dashboard?.kpis.openTickets ?? tickets.length,
    primaryLocal,
    escalated,
    due48,
    breached,
    avgAgeDays: dashboard?.kpis.averageAgeHours ? Math.max(0.1, dashboard.kpis.averageAgeHours / 24) : 0,
  };
}

function Header() {
  return (
    <header className="local-header">
      <div className="local-brand">
        <img alt="Whistle logo" src={ASSETS.logo} />
        <div>
          <strong>Whistle</strong>
          <span>Local Owner Workbench</span>
        </div>
      </div>
      <div className="local-gov">
        <img alt="Neutral civic service mark" src={ASSETS.emblem} />
        <div>
          <strong>Tamil Nadu Government</strong>
          <span>{ward} | {constituency} | {district}</span>
        </div>
      </div>
      <div className="local-user">
        <span>Councillor / local owner</span>
        <strong>{localOwnerName}</strong>
        <small>{localBody}</small>
      </div>
    </header>
  );
}

function Sidebar({ active, setActive, liveState }: { active: LocalSection; setActive: (section: LocalSection) => void; liveState: string }) {
  return (
    <aside className="local-sidebar">
      <div className="local-profile">
        <img alt="Neutral service illustration" src={ASSETS.portrait} />
        <div>
          <span>Ward mandate</span>
          <strong>Visit, prove, close</strong>
          <small>{liveState}</small>
        </div>
      </div>
      <nav className="local-nav" aria-label="Local owner sections">
        {sectionItems.map((item) => {
          const Icon = item.icon;
          return (
            <button className={active === item.id ? "active" : ""} key={item.id} onClick={() => setActive(item.id)} type="button">
              <Icon size={17} />
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </button>
          );
        })}
      </nav>
      <div className="local-policy-note">
        <ShieldCheck size={18} />
        <span>Protected corruption reports are hidden from local users until authorized screening.</span>
      </div>
    </aside>
  );
}

function KpiCard({ icon: Icon, label, value, note, tone = "neutral" }: { icon: LucideIcon; label: string; value: string; note: string; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return (
    <article className={`local-kpi ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function TicketRow({
  selected,
  ticket,
  onSelect,
}: {
  selected: boolean;
  ticket: DashboardTicketDto;
  onSelect: (ticketId: string) => void;
}) {
  return (
    <button className={`local-ticket-row ${selected ? "active" : ""}`} onClick={() => onSelect(ticket.id)} type="button">
      <span className={`local-sla-chip ${slaTone(ticket)}`}>{slaText(ticket)}</span>
      <div>
        <strong>{ticket.title}</strong>
        <small>{ticket.id} | {titleCase(ticket.category)} | {ticket.area}</small>
      </div>
      <b className={queueStage(ticket)}>{ticket.primaryQueue.kind === "local" ? "Primary local" : titleCase(ticket.primaryQueue.kind)}</b>
    </button>
  );
}

function TicketList({
  emptyText,
  onSelect,
  selectedTicketId,
  tickets,
  title,
}: {
  emptyText: string;
  onSelect: (ticketId: string) => void;
  selectedTicketId: string | null;
  tickets: DashboardTicketDto[];
  title: string;
}) {
  return (
    <section className="local-panel local-list-panel">
      <div className="local-panel-head">
        <div>
          <span>Ticket list</span>
          <h2>{title}</h2>
        </div>
        <FileText size={21} />
      </div>
      <div className="local-ticket-list">
        {tickets.length === 0 ? <div className="local-empty">{emptyText}</div> : null}
        {tickets.map((ticket) => (
          <TicketRow key={ticket.id} onSelect={onSelect} selected={selectedTicketId === ticket.id} ticket={ticket} />
        ))}
      </div>
    </section>
  );
}

function Timeline({ detail }: { detail: TicketDetailDto | null }) {
  const events = detail ? [...detail.governmentEvents, ...detail.citizenTimeline].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8) : [];
  return (
    <section className="local-panel">
      <div className="local-panel-head compact">
        <div>
          <span>Audit-visible trail</span>
          <h2>Latest ticket activity</h2>
        </div>
      </div>
      <div className="local-timeline">
        {events.length === 0 ? <div className="local-empty tight">Select a ticket to load timeline.</div> : null}
        {events.map((event) => (
          <div key={event.id}>
            <span />
            <div>
              <strong>{titleCase(event.type)}</strong>
              <small>{new Date(event.createdAt).toLocaleString("en-IN")} | {event.visibility}</small>
              <p>{event.message}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TicketWorkspace({
  actionBusy,
  actionError,
  actionMode,
  actionNotice,
  detail,
  note,
  onSubmit,
  selected,
  setActionMode,
  setNote,
}: {
  actionBusy: boolean;
  actionError: string | null;
  actionMode: ActionMode;
  actionNotice: string | null;
  detail: TicketDetailDto | null;
  note: string;
  onSubmit: () => void;
  selected: DashboardTicketDto | null;
  setActionMode: (mode: ActionMode) => void;
  setNote: (note: string) => void;
}) {
  const primary = canPrimaryAct(selected);
  const support = canSupportAct(selected);
  const active = actionCopy[actionMode];
  return (
    <section className="local-panel local-workspace">
      <div className="local-panel-head">
        <div>
          <span>{selected?.id ?? "No ticket selected"}</span>
          <h2>{selected ? "Field action workspace" : "Select a ticket"}</h2>
        </div>
        <ClipboardCheck size={22} />
      </div>
      {selected ? (
        <>
          <h3>{selected.title}</h3>
          <p>{detail?.description ?? `${selected.area}, ${selected.district} | ${selected.ministry}`}</p>
          <div className="local-queue-stack">
            <span className="primary">Primary: {selected.primaryQueue.ownerLabel}</span>
            {selected.secondaryQueues.map((queue) => (
              <span key={`${queue.kind}-${queue.ownerKey}`}>Secondary: {queue.ownerLabel}</span>
            ))}
          </div>
          <div className="local-detail-grid">
            <div>
              <span>SLA</span>
              <strong>{slaText(selected)}</strong>
            </div>
            <div>
              <span>Stage</span>
              <strong>{titleCase(selected.sla.stage)}</strong>
            </div>
            <div>
              <span>Evidence</span>
              <strong>{detail?.evidence.length ?? selected.evidenceCount}</strong>
            </div>
            <div>
              <span>Reporter</span>
              <strong>{selected.citizenIdentityVisible ? "Masked details available by policy" : "Masked"}</strong>
            </div>
          </div>
          <div className="local-action-grid">
            {(Object.keys(actionCopy) as ActionMode[]).map((mode) => {
              const Icon = actionCopy[mode].icon;
              const disabled = actionBusy || !support || (!primary && (mode === "resolve" || mode === "transfer"));
              return (
                <button className={actionMode === mode ? "active" : ""} disabled={disabled} key={mode} onClick={() => setActionMode(mode)} type="button">
                  <Icon size={15} />
                  <span>{actionCopy[mode].short}</span>
                </button>
              );
            })}
          </div>
          <label className="local-note">
            <span>{active.label}</span>
            <textarea onChange={(event) => setNote(event.target.value)} placeholder={active.detail} rows={4} value={note} />
          </label>
          <button className="local-submit" disabled={actionBusy || !support || (!primary && (actionMode === "resolve" || actionMode === "transfer"))} onClick={onSubmit} type="button">
            {actionBusy ? "Saving..." : active.label}
          </button>
          {!primary ? <small className="local-workspace-footnote">This ticket is not primary local work now. The ward can add support notes, while closure stays with the current primary owner.</small> : null}
          {actionNotice ? <div className="local-notice success">{actionNotice}</div> : null}
          {actionError ? <div className="local-notice error">{actionError}</div> : null}
        </>
      ) : (
        <div className="local-empty">Open a local or escalated ticket to record a field action.</div>
      )}
    </section>
  );
}

function TodayPlan({ metrics, onOpenQueue }: { metrics: ReturnType<typeof metricItems>; onOpenQueue: (section: LocalSection) => void }) {
  return (
    <section className="local-panel local-plan">
      <div className="local-panel-head">
        <div>
          <span>Daily operating plan</span>
          <h2>What the ward team must do now</h2>
        </div>
        <Gauge size={22} />
      </div>
      <button onClick={() => onOpenQueue("queue")} type="button">
        <CalendarCheck size={18} />
        <span>Visit or update {metrics.primaryLocal} primary local ticket(s) before the local SLA clock expires.</span>
      </button>
      <button onClick={() => onOpenQueue("escalated")} type="button">
        <TimerReset size={18} />
        <span>Add support notes to {metrics.escalated} escalated ticket(s) where the ward remains accountable.</span>
      </button>
      <button onClick={() => onOpenQueue("workspace")} type="button">
        <UploadCloud size={18} />
        <span>Attach field reports and closure proof so citizens receive useful updates, not silence.</span>
      </button>
    </section>
  );
}

export default function LocalOwnerConsole() {
  const [activeSection, setActiveSection] = useState<LocalSection>("today");
  const [dashboard, setDashboard] = useState<RoleDashboardDto | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardBusy, setDashboardBusy] = useState(true);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [actionMode, setActionMode] = useState<ActionMode>("add_field_report");
  const [actionNote, setActionNote] = useState("Ward team inspected the location and assigned a field follow-up before the next SLA review.");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDashboardBusy(true);
    setDashboardError(null);
    fetchRoleDashboard(
      {
        role: "councillor",
        ward,
        q: query.trim() || undefined,
        ticketLimit: 75,
      },
      controller.signal,
      roleAuth,
    )
      .then((nextDashboard) => {
        setDashboard(nextDashboard);
        setDashboardError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDashboard(null);
          setDashboardError(error instanceof Error ? error.message : "Local dashboard could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDashboardBusy(false);
      });
    return () => controller.abort();
  }, [query, refreshIndex]);

  const tickets = dashboard?.tickets ?? [];
  const primaryLocalTickets = useMemo(() => tickets.filter((ticket) => ticket.primaryQueue.kind === "local" || ticket.primaryQueue.kind === "mla"), [tickets]);
  const escalatedTickets = useMemo(() => tickets.filter((ticket) => ticket.primaryQueue.kind === "ministry" || ticket.primaryQueue.kind === "cm_cell"), [tickets]);
  const metrics = metricItems(dashboard, tickets);
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId) ?? tickets[0] ?? null;

  useEffect(() => {
    if (!selectedTicketId && tickets[0]) setSelectedTicketId(tickets[0].id);
    if (selectedTicketId && tickets.length > 0 && !tickets.some((ticket) => ticket.id === selectedTicketId)) setSelectedTicketId(tickets[0].id);
  }, [selectedTicketId, tickets]);

  useEffect(() => {
    if (!selectedTicket) {
      setTicketDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailError(null);
    fetchTicketDetail(selectedTicket.id, roleAuth, controller.signal)
      .then(setTicketDetail)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setTicketDetail(null);
          setDetailError(error instanceof Error ? error.message : "Ticket detail could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [selectedTicket?.id, refreshIndex]);

  useEffect(() => {
    setActionNotice(null);
    setActionError(null);
    if (!canPrimaryAct(selectedTicket) && (actionMode === "resolve" || actionMode === "transfer")) setActionMode("add_field_report");
  }, [actionMode, selectedTicket?.id, selectedTicket?.primaryQueue.kind, selectedTicket?.status]);

  async function submitAction() {
    if (!selectedTicket) return;
    setActionBusy(true);
    setActionNotice(null);
    setActionError(null);
    const note = noteForAction(actionMode, actionNote);
    const safeTicketId = selectedTicket.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket";
    const visitAt = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
    let action: FieldActionRequest;
    if (actionMode === "schedule_visit") {
      action = {
        action: "schedule_visit",
        fieldOfficer: "Ward 48 Field Inspector",
        visitAt,
        note,
      };
    } else if (actionMode === "transfer") {
      action = {
        action: "transfer",
        reason: note,
        ownerKey: "ministry:maws",
        ownerLabel: "Municipal Administration and Water Supply Ministry Queue",
        scopeKind: "ministry",
        scopeValue: "Municipal Administration and Water Supply",
        queueKind: "ministry",
      };
    } else if (actionMode === "resolve") {
      action = {
        action: "resolve",
        resolutionNote: note,
        checklist: {
          fieldVisitCompleted: true,
          evidenceAttached: true,
          citizenImpactChecked: true,
          safetyRiskClosed: true,
        },
        evidence: [
          {
            label: "after",
            fileName: `${safeTicketId}-ward-48-closure-proof.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: 640_000,
          },
        ],
      };
    } else {
      action = {
        action: "add_field_report",
        fieldOfficer: "Ward 48 Field Inspector",
        note,
        evidence: [
          {
            label: "field_report",
            fileName: `${safeTicketId}-ward-48-field-report.txt`,
            mimeType: "text/plain",
            sizeBytes: Math.max(256, note.length * 2),
          },
        ],
      };
    }

    try {
      await submitFieldAction(selectedTicket.id, action, roleAuth);
      setActionNotice(`${actionCopy[actionMode].label} saved for ${selectedTicket.id}.`);
      setRefreshIndex((value) => value + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Field action could not be saved.");
    } finally {
      setActionBusy(false);
    }
  }

  const liveState = dashboardError ? "API issue" : dashboardBusy ? "Loading ticket spine" : "Reading live ticket spine";

  return (
    <div className="local-app">
      <Header />
      <main className="local-shell">
        <Sidebar active={activeSection} liveState={liveState} setActive={setActiveSection} />
        <section className="local-main">
          <div className="local-toolbar">
            <div>
              <span>Ward field workbench</span>
              <h1>{ward}: close issues before escalation</h1>
            </div>
            <label className="local-search">
              <Search size={16} />
              <input aria-label="Search local tickets" onChange={(event) => setQuery(event.target.value)} placeholder="Search ticket, area, category..." value={query} />
            </label>
            <button className="local-refresh" disabled={dashboardBusy} onClick={() => setRefreshIndex((value) => value + 1)} type="button">
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          <section className="local-kpi-grid" aria-label="Ward queue metrics">
            <KpiCard icon={Landmark} label="Open in ward" note="Visible non-protected tickets" value={formatNumber(metrics.open)} />
            <KpiCard icon={ClipboardCheck} label="Primary local" note="Ward owns next action" tone="good" value={formatNumber(metrics.primaryLocal)} />
            <KpiCard icon={Clock3} label="Due in 48h" note="Needs action today" tone="warn" value={formatNumber(metrics.due48)} />
            <KpiCard icon={AlertTriangle} label="SLA breached" note="Escalation risk" tone="danger" value={formatNumber(metrics.breached)} />
            <KpiCard icon={TimerReset} label="Escalated out" note="Still secondary-visible" value={formatNumber(metrics.escalated)} />
            <KpiCard icon={Gauge} label="Average age" note="Open ward work" value={`${metrics.avgAgeDays.toFixed(1)}d`} />
          </section>

          {dashboardError ? <div className="local-error">{dashboardError}. Check that the API is running on http://localhost:3001.</div> : null}

          {activeSection === "today" ? (
            <section className="local-two-col">
              <TodayPlan metrics={metrics} onOpenQueue={setActiveSection} />
              <TicketList
                emptyText="No Ward 48 tickets are currently visible. Route a ticket from the Verification Console to Ward 48 to start local work."
                onSelect={(ticketId) => {
                  setSelectedTicketId(ticketId);
                  setActiveSection("workspace");
                }}
                selectedTicketId={selectedTicket?.id ?? null}
                tickets={tickets.slice(0, 12)}
                title="Highest priority visible tickets"
              />
            </section>
          ) : null}

          {activeSection === "queue" ? (
            <section className="local-two-col wide-right">
              <TicketList
                emptyText="No primary local tickets. Everything visible may already have escalated upward."
                onSelect={(ticketId) => {
                  setSelectedTicketId(ticketId);
                  setActiveSection("workspace");
                }}
                selectedTicketId={selectedTicket?.id ?? null}
                tickets={primaryLocalTickets}
                title="Primary local queue"
              />
              <TicketWorkspace
                actionBusy={actionBusy}
                actionError={actionError}
                actionMode={actionMode}
                actionNotice={actionNotice}
                detail={ticketDetail}
                note={actionNote}
                onSubmit={submitAction}
                selected={selectedTicket}
                setActionMode={setActionMode}
                setNote={setActionNote}
              />
            </section>
          ) : null}

          {activeSection === "escalated" ? (
            <section className="local-two-col wide-right">
              <TicketList
                emptyText="No escalated tickets remain visible to this ward."
                onSelect={(ticketId) => {
                  setSelectedTicketId(ticketId);
                  setActiveSection("workspace");
                }}
                selectedTicketId={selectedTicket?.id ?? null}
                tickets={escalatedTickets}
                title="Escalated but still accountable"
              />
              <TicketWorkspace
                actionBusy={actionBusy}
                actionError={actionError}
                actionMode={actionMode}
                actionNotice={actionNotice}
                detail={ticketDetail}
                note={actionNote}
                onSubmit={submitAction}
                selected={selectedTicket}
                setActionMode={setActionMode}
                setNote={setActionNote}
              />
            </section>
          ) : null}

          {activeSection === "workspace" ? (
            <section className="local-two-col wide-left">
              <TicketWorkspace
                actionBusy={actionBusy}
                actionError={actionError}
                actionMode={actionMode}
                actionNotice={actionNotice}
                detail={ticketDetail}
                note={actionNote}
                onSubmit={submitAction}
                selected={selectedTicket}
                setActionMode={setActionMode}
                setNote={setActionNote}
              />
              <Timeline detail={ticketDetail} />
            </section>
          ) : null}

          {detailError ? <div className="local-error subtle">{detailError}</div> : null}
        </section>
      </main>
    </div>
  );
}
