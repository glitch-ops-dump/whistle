import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  FileWarning,
  Gauge,
  Landmark,
  MapPin,
  Megaphone,
  RadioTower,
  Search,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchRoleDashboard, hoursUntil, submitFieldAction, type DashboardTicketDto, type FieldActionRequest, type RoleDashboardDto } from "./govDashboardApi";
import {
  CitizenVisibleUpdateCard,
  RolePatternSummary,
  SlaLadderCard,
  coherentDemoTicket,
  roleConsolePatterns,
  type SelectedTicketSummary,
} from "./roleConsolePattern";

type MlaSection = "overview" | "queue" | "escalated" | "citizen";
type FieldActionMode = "schedule_visit" | "add_field_report" | "resolve" | "transfer";
type TicketListMode = "all" | "local" | "escalated";

type RuntimeAssets = {
  logo: string;
  emblem: string;
  portrait: string;
};

type LocalTicket = {
  id: string;
  title: string;
  category: string;
  district: string;
  area: string;
  status: string;
  primary: string;
  secondary: string[];
  ownerStage: "local" | "ministry" | "cm_cell" | "verification";
  hoursLeft: number;
  evidenceCount: number;
  ask: string;
};

const ASSETS: RuntimeAssets = window.__WHISTLE_ASSETS__ ?? {
  logo: "/assets/brand/whistle-fake-logo.svg",
  emblem: "/assets/brand/whistle-civic-mark.svg",
  portrait: "/assets/brand/whistle-service-portrait.svg",
};

const mlaName = "Tmt. R. Kayalvizhi";
const constituency = "Velachery";
const district = "Chennai";

const menuItems: Array<{ id: MlaSection; label: string; detail: string }> = [
  { id: "overview", label: "Overview", detail: "Local closure board" },
  { id: "queue", label: "Local queue", detail: "Primary MLA work" },
  { id: "escalated", label: "Escalated out", detail: "Still accountable" },
  { id: "citizen", label: "Citizen updates", detail: "Info requested" },
];

const fallbackTickets: LocalTicket[] = [
  {
    id: coherentDemoTicket.id,
    title: coherentDemoTicket.title,
    category: coherentDemoTicket.category,
    district,
    area: constituency,
    status: "routed_local",
    primary: coherentDemoTicket.localOwner,
    secondary: ["Ticket Verification Team", coherentDemoTicket.ministryOwner],
    ownerStage: "local",
    hoursLeft: 24,
    evidenceCount: 2,
    ask: "Schedule field visit and upload before/after proof before local SLA breach.",
  },
  {
    id: "WH-2026-DEMO-CM-SANITATION",
    title: coherentDemoTicket.title,
    category: coherentDemoTicket.category,
    district,
    area: constituency,
    status: "escalated_cm_cell",
    primary: coherentDemoTicket.cmOwner,
    secondary: [coherentDemoTicket.ministryOwner, coherentDemoTicket.localOwner],
    ownerStage: "cm_cell",
    hoursLeft: -6,
    evidenceCount: 3,
    ask: "Submit local action note so CM Cell can verify why field proof missed SLA.",
  },
];

const citizenUpdates = [
  {
    title: "Field visit visible",
    detail: "Citizen sees that Velachery MLA Office has scheduled a school-gate inspection.",
    count: 1,
  },
  {
    title: "Closure proof expected",
    detail: "The same sanitation ticket needs before/after evidence before citizens are notified.",
    count: 1,
  },
  {
    title: "Escalation watch",
    detail: "If proof misses SLA, MAWS becomes primary and the MLA office remains visible.",
    count: 1,
  },
];

const fieldActionCopy: Record<FieldActionMode, { label: string; detail: string; icon: LucideIcon }> = {
  schedule_visit: {
    label: "Schedule visit",
    detail: "Citizen timeline shows the planned field visit.",
    icon: CalendarCheck,
  },
  add_field_report: {
    label: "Add field note",
    detail: "Attach a local action note without changing ownership.",
    icon: ClipboardCheck,
  },
  resolve: {
    label: "Resolve locally",
    detail: "Close with checklist and after-proof evidence.",
    icon: CheckCircle2,
  },
  transfer: {
    label: "Escalate to ministry",
    detail: "Move primary ownership upward and keep MLA visibility.",
    icon: RadioTower,
  },
};

declare global {
  interface Window {
    __WHISTLE_ASSETS__?: RuntimeAssets;
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function ticketToLocal(ticket: DashboardTicketDto): LocalTicket {
  const ownerStage =
    ticket.primaryQueue.kind === "cm_cell"
      ? "cm_cell"
      : ticket.primaryQueue.kind === "ministry"
        ? "ministry"
        : ticket.primaryQueue.kind === "local" || ticket.primaryQueue.kind === "mla"
          ? "local"
          : "verification";
  return {
    id: ticket.id,
    title: ticket.title,
    category: titleCase(ticket.category),
    district: ticket.district,
    area: ticket.area,
    status: ticket.status,
    primary: ticket.primaryQueue.ownerLabel,
    secondary: ticket.secondaryQueues.map((queue) => queue.ownerLabel),
    ownerStage,
    hoursLeft: hoursUntil(ticket.sla.dueAt),
    evidenceCount: ticket.evidenceCount,
    ask:
      ownerStage === "local"
        ? "Close locally before this issue reaches ministry escalation."
        : ownerStage === "cm_cell"
          ? "Add MLA/local action note and help pull this back from CM Cell escalation."
          : "Coordinate with ministry while retaining local accountability.",
  };
}

function ticketsFromDashboard(dashboard: RoleDashboardDto | null) {
  if (!dashboard || dashboard.tickets.length === 0) return fallbackTickets;
  return dashboard.tickets.map(ticketToLocal);
}

function summarize(dashboard: RoleDashboardDto | null, tickets: LocalTicket[]) {
  const local = tickets.filter((ticket) => ticket.ownerStage === "local");
  const escalated = tickets.filter((ticket) => ticket.ownerStage === "ministry" || ticket.ownerStage === "cm_cell");
  const due48h = tickets.filter((ticket) => ticket.hoursLeft >= 0 && ticket.hoursLeft <= 48).length;
  return {
    open: dashboard?.kpis.openTickets ?? tickets.length,
    local: local.length,
    escalated: dashboard?.kpis.escalatedToCmCell ?? escalated.length,
    due48h: dashboard?.kpis.dueIn48h ?? due48h,
    breached: dashboard?.kpis.slaBreached ?? tickets.filter((ticket) => ticket.hoursLeft < 0).length,
    avgAgeDays: dashboard?.kpis.averageAgeHours ? Number((dashboard.kpis.averageAgeHours / 24).toFixed(1)) : 4.8,
    evidenceNeeded: Math.max(1, tickets.filter((ticket) => ticket.evidenceCount === 0).length + 1),
  };
}

function Header() {
  return (
    <header className="mla-header">
      <div className="mla-brand">
        <img alt="Whistle logo" src={ASSETS.logo} />
        <div>
          <strong>Whistle</strong>
          <span>MLA Local Closure Dashboard</span>
        </div>
      </div>
      <div className="mla-gov">
        <img alt="Neutral civic service mark" src={ASSETS.emblem} />
        <div>
          <strong>Tamil Nadu Government</strong>
          <span>{constituency} Constituency</span>
        </div>
      </div>
      <div className="mla-user">
        <span>MLA</span>
        <strong>{mlaName}</strong>
        <small>{district} district | Live prototype</small>
      </div>
    </header>
  );
}

function SectionMenu({ active, setActive }: { active: MlaSection; setActive: (section: MlaSection) => void }) {
  return (
    <nav aria-label="MLA dashboard sections" className="mla-menu">
      {menuItems.map((item) => (
        <button className={active === item.id ? "active" : ""} key={item.id} onClick={() => setActive(item.id)} type="button">
          <span>{item.label}</span>
          <small>{item.detail}</small>
        </button>
      ))}
    </nav>
  );
}

function SectionIntro({ title, body, eyebrow }: { title: string; body: string; eyebrow: string }) {
  return (
    <section className="mla-intro">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
      <div className="mla-search">
        <Search size={17} />
        <span>Search ticket, ward, owner...</span>
      </div>
    </section>
  );
}

function KpiCard({ icon: Icon, label, value, note, tone = "red" }: { icon: LucideIcon; label: string; value: string; note: string; tone?: "red" | "amber" | "green" | "dark" }) {
  return (
    <div className={`mla-kpi tone-${tone}`}>
      <span className="mla-kpi-icon">
        <Icon size={19} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function ticketMatchesMode(ticket: LocalTicket, mode: TicketListMode) {
  if (mode === "local") return ticket.ownerStage === "local";
  if (mode === "escalated") return ticket.ownerStage === "ministry" || ticket.ownerStage === "cm_cell";
  return true;
}

function isResolvedTicket(ticket: LocalTicket) {
  return ticket.status === "resolved" || ticket.status === "closed";
}

function priorityClass(ticket: LocalTicket) {
  if (isResolvedTicket(ticket)) return "mla-priority resolved";
  if (ticket.hoursLeft < 0) return "mla-priority breached";
  if (ticket.ownerStage === "cm_cell") return "mla-priority escalated";
  return "mla-priority";
}

function priorityLabel(ticket: LocalTicket) {
  if (isResolvedTicket(ticket)) return "Resolved";
  if (ticket.hoursLeft < 0) return `${Math.abs(ticket.hoursLeft)}h late`;
  return `${ticket.hoursLeft}h`;
}

function TicketList({ selected, setSelected, tickets, mode = "all" }: { selected: string; setSelected: (id: string) => void; tickets: LocalTicket[]; mode?: TicketListMode }) {
  const rows = tickets.filter((ticket) => ticketMatchesMode(ticket, mode));

  return (
    <section className="mla-ticket-card">
      <div className="mla-section-heading">
        <div>
          <span>{mode === "escalated" ? "Escalated but visible" : "Ticket queue"}</span>
          <h2>{mode === "local" ? "Close before escalation" : mode === "escalated" ? "Recover escalated issues" : "Local operating list"}</h2>
        </div>
        <BellRing size={22} />
      </div>
      <div className="mla-ticket-list">
        {rows.length === 0 ? <div className="mla-empty-ticket">No tickets in this queue for the current constituency scope.</div> : null}
        {rows.map((ticket) => (
          <button className={`${selected === ticket.id ? "active" : ""} ${isResolvedTicket(ticket) ? "resolved" : ""}`} key={ticket.id} onClick={() => setSelected(ticket.id)} type="button">
            <span className={priorityClass(ticket)}>{priorityLabel(ticket)}</span>
            <div>
              <strong>{ticket.title}</strong>
              <small>
                {ticket.area} | {ticket.category}
              </small>
              <span className={`mla-status-pill ${isResolvedTicket(ticket) ? "resolved" : "open"}`}>{isResolvedTicket(ticket) ? "Closed by MLA" : titleCase(ticket.status)}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function TicketDetail({
  actionBusy,
  actionError,
  actionMode,
  actionNotice,
  fieldNote,
  onSubmit,
  setActionMode,
  setFieldNote,
  ticket,
}: {
  actionBusy: boolean;
  actionError: string | null;
  actionMode: FieldActionMode;
  actionNotice: string | null;
  fieldNote: string;
  onSubmit: () => void;
  setActionMode: (mode: FieldActionMode) => void;
  setFieldNote: (note: string) => void;
  ticket: LocalTicket;
}) {
  const localPrimary = ticket.ownerStage === "local";
  const activeCopy = fieldActionCopy[actionMode];
  return (
    <section className="mla-detail-card">
      <div className="mla-section-heading">
        <div>
          <span>{ticket.id}</span>
          <h2>{ticket.ownerStage === "local" ? "Local closure workspace" : "Escalated-out visibility"}</h2>
        </div>
        <FileWarning size={22} />
      </div>
      <h3>{ticket.ask}</h3>
      <p>
        {ticket.title} | {ticket.area}, {ticket.district}
      </p>
      <div className="mla-queue-badges">
        <span className="primary">Primary: {ticket.primary}</span>
        {ticket.secondary.map((owner) => (
          <span key={owner}>Secondary: {owner}</span>
        ))}
      </div>
      <div className="mla-field-workbench">
        <div className="mla-field-mode-grid">
          {(Object.keys(fieldActionCopy) as FieldActionMode[]).map((mode) => {
            const copy = fieldActionCopy[mode];
            const Icon = copy.icon;
            const disabled = !localPrimary && (mode === "resolve" || mode === "transfer");
            return (
              <button className={actionMode === mode ? "active" : ""} disabled={disabled || actionBusy} key={mode} onClick={() => setActionMode(mode)} type="button">
                <Icon size={15} />
                <span>{copy.label}</span>
              </button>
            );
          })}
        </div>
        <label className="mla-field-note">
          <span>{activeCopy.label}</span>
          <textarea
            onChange={(event) => setFieldNote(event.target.value)}
            placeholder={activeCopy.detail}
            value={fieldNote}
          />
        </label>
        <button className="mla-submit-action" disabled={actionBusy} onClick={onSubmit} type="button">
          {actionBusy ? "Saving action..." : activeCopy.label}
        </button>
        {actionNotice ? <div className="mla-action-notice success">{actionNotice}</div> : null}
        {actionError ? <div className="mla-action-notice error">{actionError}</div> : null}
        {!localPrimary ? <small className="mla-secondary-note">This ticket is no longer primary local work. MLA can add support notes, while closure stays with the current primary owner.</small> : null}
      </div>
    </section>
  );
}

function LocalPlan({ summary }: { summary: ReturnType<typeof summarize> }) {
  return (
    <section className="mla-plan-card">
      <div className="mla-section-heading">
        <div>
          <span>MLA operating plan</span>
          <h2>Prevent avoidable escalations</h2>
        </div>
        <Wrench size={22} />
      </div>
      <div className="mla-plan-list">
        <div>
          <CheckCircle2 size={18} />
          <span>Close {summary.local} local ticket(s) before ministry escalation.</span>
        </div>
        <div>
          <TimerReset size={18} />
          <span>Submit field evidence for {summary.evidenceNeeded} issue(s) waiting on proof.</span>
        </div>
        <div>
          <RadioTower size={18} />
          <span>Track {summary.escalated} escalated issue(s) as secondary accountability.</span>
        </div>
      </div>
    </section>
  );
}

function ConstituencyPanel({ summary }: { summary: ReturnType<typeof summarize> }) {
  return (
    <section className="mla-constituency-card">
      <div className="mla-section-heading">
        <div>
          <span>Constituency pressure</span>
          <h2>{constituency}</h2>
        </div>
        <MapPin size={22} />
      </div>
      <div className="mla-district-stats">
        <div>
          <span>Open</span>
          <strong>{formatNumber(summary.open)}</strong>
        </div>
        <div>
          <span>Local</span>
          <strong>{formatNumber(summary.local)}</strong>
        </div>
        <div>
          <span>Due 48h</span>
          <strong>{formatNumber(summary.due48h)}</strong>
        </div>
        <div>
          <span>Escalated</span>
          <strong>{formatNumber(summary.escalated)}</strong>
        </div>
      </div>
      <div className="mla-drill-path">
        <span>Current drilldown path</span>
        <strong>
          State &gt; {district} &gt; {constituency}
        </strong>
        <small>MLA can act on local queue and remains visible after escalation.</small>
      </div>
    </section>
  );
}

function CitizenUpdatePanel() {
  return (
    <section className="mla-citizen-card">
      <div className="mla-section-heading">
        <div>
          <span>Citizen communication</span>
          <h2>Updates that unblock closure</h2>
        </div>
        <Megaphone size={22} />
      </div>
      <div className="mla-update-list">
        {citizenUpdates.map((item) => (
          <div key={item.title}>
            <strong>{item.count}</strong>
            <span>{item.title}</span>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function MlaDashboard() {
  const [dashboard, setDashboard] = useState<RoleDashboardDto | null>(null);
  const [dashboardState, setDashboardState] = useState<"live" | "mock" | "offline">("mock");
  const [activeSection, setActiveSection] = useState<MlaSection>("overview");
  const [selectedTicket, setSelectedTicket] = useState(fallbackTickets[0].id);
  const [dashboardVersion, setDashboardVersion] = useState(0);
  const [fieldActionMode, setFieldActionMode] = useState<FieldActionMode>("schedule_visit");
  const [fieldNote, setFieldNote] = useState("Field team will inspect the Velachery school-gate overflow and upload proof before SLA breach.");
  const [fieldActionBusy, setFieldActionBusy] = useState(false);
  const [fieldActionNotice, setFieldActionNotice] = useState<string | null>(null);
  const [fieldActionError, setFieldActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchRoleDashboard({ role: "mla", district, constituency }, controller.signal, {
      role: "mla",
      actor: "mla:prototype",
    })
      .then((nextDashboard) => {
        setDashboard(nextDashboard);
        setDashboardState(nextDashboard.tickets.length > 0 ? "live" : "mock");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDashboard(null);
          setDashboardState("offline");
        }
      });
    return () => controller.abort();
  }, [dashboardVersion]);

  const tickets = useMemo(() => ticketsFromDashboard(dashboard), [dashboard]);
  const summary = summarize(dashboard, tickets);
  const activeTicket = tickets.find((ticket) => ticket.id === selectedTicket) ?? tickets[0];
  const selectedPatternTicket: SelectedTicketSummary | undefined = activeTicket
    ? {
        id: activeTicket.id,
        title: activeTicket.title,
        owner: activeTicket.primary,
        status: titleCase(activeTicket.status),
      }
    : undefined;

  useEffect(() => {
    if (!tickets.some((ticket) => ticket.id === selectedTicket)) setSelectedTicket(tickets[0]?.id ?? fallbackTickets[0].id);
  }, [selectedTicket, tickets]);

  useEffect(() => {
    const mode: TicketListMode = activeSection === "queue" ? "local" : activeSection === "escalated" ? "escalated" : "all";
    const scopedTickets = tickets.filter((ticket) => ticketMatchesMode(ticket, mode));
    if (scopedTickets.length > 0 && !scopedTickets.some((ticket) => ticket.id === selectedTicket)) {
      setSelectedTicket(scopedTickets[0].id);
    }
  }, [activeSection, selectedTicket, tickets]);

  useEffect(() => {
    setFieldActionNotice(null);
    setFieldActionError(null);
    if (activeTicket?.ownerStage !== "local" && (fieldActionMode === "resolve" || fieldActionMode === "transfer")) {
      setFieldActionMode("add_field_report");
    }
  }, [activeTicket?.id, activeTicket?.ownerStage, fieldActionMode]);

  async function submitMlaFieldAction() {
    if (!activeTicket) return;
    setFieldActionBusy(true);
    setFieldActionNotice(null);
    setFieldActionError(null);
    const note = fieldNote.trim() || fieldActionCopy[fieldActionMode].detail;
    const actor = "mla:prototype";
    const safeTicketId = activeTicket.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket";
    const visitAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    let action: FieldActionRequest;

    if (fieldActionMode === "schedule_visit") {
      action = {
        action: "schedule_visit",
        actor,
        fieldOfficer: "Velachery MLA field coordinator",
        visitAt,
        note,
      };
    } else if (fieldActionMode === "add_field_report") {
      action = {
        action: "add_field_report",
        actor,
        fieldOfficer: "Velachery MLA field coordinator",
        note,
        evidence: [
          {
            label: "field_report",
            fileName: `${safeTicketId}-mla-field-note.txt`,
            mimeType: "text/plain",
            sizeBytes: Math.max(128, note.length * 2),
          },
        ],
      };
    } else if (fieldActionMode === "transfer") {
      action = {
        action: "transfer",
        actor,
        reason: note,
        ownerKey: "ministry:maws",
        ownerLabel: "Municipal Administration and Water Supply Ministry Queue",
        scopeKind: "ministry",
        scopeValue: "Municipal Administration and Water Supply",
        queueKind: "ministry",
      };
    } else {
      action = {
        action: "resolve",
        actor,
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
            fileName: `${safeTicketId}-mla-closure-proof.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: 620_000,
          },
        ],
      };
    }

    try {
      await submitFieldAction(activeTicket.id, action, { role: "mla", actor });
      setFieldActionNotice(`${fieldActionCopy[fieldActionMode].label} saved for ${activeTicket.id}. Dashboard refreshed.`);
      setDashboardVersion((version) => version + 1);
    } catch (error) {
      setFieldActionError(error instanceof Error ? error.message : "Field action could not be saved.");
    } finally {
      setFieldActionBusy(false);
    }
  }

  return (
    <div className="mla-app">
      <Header />
      <main className="mla-main">
        <aside className="mla-left-rail">
          <div className="mla-profile-card">
            <img alt="Neutral service illustration" src={ASSETS.portrait} />
            <div>
              <span>Local goal</span>
              <strong>Close without escalation</strong>
              <small>{dashboardState === "live" ? "Reading MVP ticket spine" : "Prototype data fallback"}</small>
            </div>
          </div>
          <SectionMenu active={activeSection} setActive={setActiveSection} />
        </aside>

        <div aria-label="MLA dashboard content" className={`mla-content-panel mla-page-${activeSection}`} role="region" tabIndex={0}>
          {activeSection === "overview" && (
            <>
              <SectionIntro
                body="One local operating board for the MLA team to clear constituency issues before they breach SLA and move upward."
                eyebrow="Local accountability"
                title="Close local issues before escalation"
              />
              <section className="mla-kpi-grid">
                <KpiCard icon={Landmark} label="Open in scope" note="Visible to MLA team" value={formatNumber(summary.open)} />
                <KpiCard icon={CheckCircle2} label="Local queue" note="Primary local owner" tone="green" value={formatNumber(summary.local)} />
                <KpiCard icon={Clock3} label="Due in 48h" note="Prevent escalation" tone="amber" value={formatNumber(summary.due48h)} />
                <KpiCard icon={RadioTower} label="Escalated out" note="Secondary visibility" value={formatNumber(summary.escalated)} />
                <KpiCard icon={AlertTriangle} label="SLA breached" note="Needs immediate review" value={formatNumber(summary.breached)} />
                <KpiCard icon={Gauge} label="Average age" note="Open local work" tone="dark" value={`${summary.avgAgeDays.toFixed(1)}d`} />
              </section>
              <RolePatternSummary pattern={roleConsolePatterns.mla} selectedTicket={selectedPatternTicket} />
              <section className="mla-overview-grid">
                <ConstituencyPanel summary={summary} />
                <LocalPlan summary={summary} />
              </section>
            </>
          )}

          {activeSection === "queue" && (
            <>
              <SectionIntro
                body="Primary local queue for civic issues the MLA office can push to closure without waiting for ministry intervention."
                eyebrow="Local queue"
                title="Own the next action"
              />
              <section className="mla-work-grid">
                <TicketList mode="local" selected={selectedTicket} setSelected={setSelectedTicket} tickets={tickets} />
                <div className="mla-right-stack">
                  <TicketDetail
                    actionBusy={fieldActionBusy}
                    actionError={fieldActionError}
                    actionMode={fieldActionMode}
                    actionNotice={fieldActionNotice}
                    fieldNote={fieldNote}
                    onSubmit={submitMlaFieldAction}
                    setActionMode={setFieldActionMode}
                    setFieldNote={setFieldNote}
                    ticket={activeTicket}
                  />
                  <SlaLadderCard pattern={roleConsolePatterns.mla} selectedTicket={selectedPatternTicket} />
                  <CitizenVisibleUpdateCard pattern={roleConsolePatterns.mla} selectedTicket={selectedPatternTicket} />
                  <LocalPlan summary={summary} />
                </div>
              </section>
            </>
          )}

          {activeSection === "escalated" && (
            <>
              <SectionIntro
                body="Tickets escalated to ministry or CM Cell remain visible so the MLA team can support resolution and learn where local SLA failed."
                eyebrow="Escalated out"
                title="Still visible after escalation"
              />
              <section className="mla-work-grid">
                <TicketList mode="escalated" selected={selectedTicket} setSelected={setSelectedTicket} tickets={tickets} />
                <div className="mla-right-stack">
                  <TicketDetail
                    actionBusy={fieldActionBusy}
                    actionError={fieldActionError}
                    actionMode={fieldActionMode}
                    actionNotice={fieldActionNotice}
                    fieldNote={fieldNote}
                    onSubmit={submitMlaFieldAction}
                    setActionMode={setFieldActionMode}
                    setFieldNote={setFieldNote}
                    ticket={activeTicket}
                  />
                  <SlaLadderCard pattern={roleConsolePatterns.mla} selectedTicket={selectedPatternTicket} />
                  <CitizenVisibleUpdateCard pattern={roleConsolePatterns.mla} selectedTicket={selectedPatternTicket} />
                  <ConstituencyPanel summary={summary} />
                </div>
              </section>
            </>
          )}

          {activeSection === "citizen" && (
            <>
              <SectionIntro
                body="Citizen-facing update needs, clarification loops, and closure proof items that keep trust intact."
                eyebrow="Citizen updates"
                title="Communicate before citizens chase"
              />
              <section className="mla-work-grid">
                <CitizenUpdatePanel />
                <div className="mla-right-stack">
                  <TicketDetail
                    actionBusy={fieldActionBusy}
                    actionError={fieldActionError}
                    actionMode={fieldActionMode}
                    actionNotice={fieldActionNotice}
                    fieldNote={fieldNote}
                    onSubmit={submitMlaFieldAction}
                    setActionMode={setFieldActionMode}
                    setFieldNote={setFieldNote}
                    ticket={activeTicket}
                  />
                  <CitizenVisibleUpdateCard pattern={roleConsolePatterns.mla} selectedTicket={selectedPatternTicket} />
                  <SlaLadderCard pattern={roleConsolePatterns.mla} selectedTicket={selectedPatternTicket} />
                  <LocalPlan summary={summary} />
                </div>
              </section>
            </>
          )}
        </div>
      </main>
      <div className="mla-mode-banner">
        <Sparkles size={16} />
        <span>{dashboardState === "live" ? "MLA dashboard: reading live MVP ticket-spine sample data for Velachery." : "MLA dashboard: using local prototype data until the MVP API is reachable."}</span>
      </div>
    </div>
  );
}
