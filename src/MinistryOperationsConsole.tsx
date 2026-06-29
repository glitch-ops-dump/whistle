import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  Landmark,
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
  type DashboardMetricRowDto,
  type DashboardTicketDto,
  type FieldActionRequest,
  type GovRole,
  type RoleDashboardDto,
  type TicketDetailDto,
} from "./govDashboardApi";
import {
  CitizenVisibleUpdateCard,
  RolePatternSummary,
  SlaLadderCard,
  coherentDemoTicket,
  roleConsolePatterns,
  type SelectedTicketSummary,
} from "./roleConsolePattern";

type RuntimeAssets = {
  logo: string;
  emblem: string;
  portrait: string;
};

type MinistrySection = "overview" | "districts" | "queue" | "workspace";
type MinistryActionMode = "directive" | "request_evidence" | "resolve";
type MinistryConsoleRole = Extract<GovRole, "minister" | "department_officer">;

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

const assignedMinistry = "Municipal Administration and Water Supply";
const shortMinistry = "MAWS";

const fallbackMinistryTickets: DashboardTicketDto[] = [
  {
    id: coherentDemoTicket.id,
    title: coherentDemoTicket.title,
    category: "sanitation",
    status: "escalated_ministry",
    protected: false,
    district: coherentDemoTicket.district,
    area: coherentDemoTicket.area,
    ministry: assignedMinistry,
    primaryQueue: {
      kind: "ministry",
      ownerKey: "ministry:maws-chennai",
      ownerLabel: coherentDemoTicket.ministryOwner,
      scope: {
        jurisdiction: "ministry",
        value: assignedMinistry,
      },
    },
    secondaryQueues: [
      {
        kind: "mla",
        ownerKey: "mla:velachery",
        ownerLabel: coherentDemoTicket.localOwner,
        scope: {
          jurisdiction: "constituency",
          value: coherentDemoTicket.area,
        },
      },
      {
        kind: "cm_cell",
        ownerKey: "cm_cell:command",
        ownerLabel: coherentDemoTicket.cmOwner,
        scope: {
          jurisdiction: "state",
          value: "Tamil Nadu",
        },
      },
    ],
    sla: {
      stage: "ministry_field_proof",
      state: "due_soon",
      dueAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      paused: false,
    },
    citizenIdentityVisible: false,
    evidenceCount: 3,
    createdAt: new Date(Date.now() - 62 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "WH-2026-DEMO-CM-SANITATION",
    title: coherentDemoTicket.title,
    category: "sanitation",
    status: "escalated_cm_cell",
    protected: false,
    district: coherentDemoTicket.district,
    area: coherentDemoTicket.area,
    ministry: assignedMinistry,
    primaryQueue: {
      kind: "cm_cell",
      ownerKey: "cm_cell:command",
      ownerLabel: coherentDemoTicket.cmOwner,
      scope: {
        jurisdiction: "state",
        value: "Tamil Nadu",
      },
    },
    secondaryQueues: [
      {
        kind: "ministry",
        ownerKey: "ministry:maws-chennai",
        ownerLabel: coherentDemoTicket.ministryOwner,
        scope: {
          jurisdiction: "ministry",
          value: assignedMinistry,
        },
      },
      {
        kind: "mla",
        ownerKey: "mla:velachery",
        ownerLabel: coherentDemoTicket.localOwner,
        scope: {
          jurisdiction: "constituency",
          value: coherentDemoTicket.area,
        },
      },
    ],
    sla: {
      stage: "cm_cell_directive",
      state: "breached",
      dueAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      paused: false,
    },
    citizenIdentityVisible: false,
    evidenceCount: 4,
    createdAt: new Date(Date.now() - 84 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  },
];

const fallbackDistrictRows: DashboardMetricRowDto[] = [
  {
    key: "district:chennai",
    label: coherentDemoTicket.district,
    openTickets: fallbackMinistryTickets.length,
    slaBreached: 1,
    dueIn48h: 1,
    protectedCount: 0,
  },
];

const roleProfiles: Record<MinistryConsoleRole, { actor: string; name: string; title: string; purpose: string }> = {
  minister: {
    actor: "minister:prototype",
    name: "Thiru. K. Arulmozhi Selvan",
    title: "Minister",
    purpose: "District performance and escalation prevention",
  },
  department_officer: {
    actor: "department_officer:prototype",
    name: "Tmt. R. Priya Dharshini",
    title: "Department Officer",
    purpose: "Ministry queue execution and field proof",
  },
};

const sectionItems: Array<{ id: MinistrySection; label: string; detail: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", detail: "Ministry control room", icon: Landmark },
  { id: "districts", label: "Districts", detail: "District KPI drilldown", icon: Building2 },
  { id: "queue", label: "Queue", detail: "Primary ministry tickets", icon: ClipboardCheck },
  { id: "workspace", label: "Workspace", detail: "Directive and closure", icon: FileText },
];

const actionCopy: Record<MinistryActionMode, { label: string; short: string; detail: string; icon: LucideIcon }> = {
  directive: {
    label: "Issue directive",
    short: "Directive",
    detail: "Record a ministry instruction, owner follow-up, or escalation-response note.",
    icon: ClipboardCheck,
  },
  request_evidence: {
    label: "Request field proof",
    short: "Field proof",
    detail: "Schedule a district field proof update so closure can be verified.",
    icon: UploadCloud,
  },
  resolve: {
    label: "Resolve with proof",
    short: "Resolve",
    detail: "Close a primary ministry ticket only after field proof and citizen impact checks.",
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

function authFor(role: MinistryConsoleRole): DashboardAuth {
  return {
    role,
    actor: roleProfiles[role].actor,
  };
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

function canResolve(ticket: DashboardTicketDto | null) {
  return Boolean(ticket && ticket.primaryQueue.kind === "ministry" && ticket.status !== "resolved" && ticket.status !== "closed");
}

function canAct(ticket: DashboardTicketDto | null) {
  return Boolean(ticket && ticket.status !== "resolved" && ticket.status !== "closed" && (ticket.primaryQueue.kind === "ministry" || ticket.primaryQueue.kind === "cm_cell"));
}

function noteFor(mode: MinistryActionMode, note: string) {
  const trimmed = note.trim();
  if (trimmed.length >= 12) return trimmed;
  if (mode === "resolve") return "Ministry owner confirms field proof, citizen impact check, and safety-risk closure before resolving the ticket.";
  if (mode === "request_evidence") return "District officer must upload field proof and closure evidence before the next SLA review.";
  return "Ministry directs the district owner to clear the bottleneck and report back before the next SLA review.";
}

function Header({ role, setRole }: { role: MinistryConsoleRole; setRole: (role: MinistryConsoleRole) => void }) {
  const profile = roleProfiles[role];
  return (
    <header className="ministry-header">
      <div className="ministry-brand">
        <img alt="Whistle logo" src={ASSETS.logo} />
        <div>
          <strong>Whistle</strong>
          <span>Ministry Operations Console</span>
        </div>
      </div>
      <div className="ministry-gov">
        <img alt="Neutral civic service mark" src={ASSETS.emblem} />
        <div>
          <strong>{assignedMinistry}</strong>
          <span>Assigned ministry only | No all-ministry mode</span>
        </div>
      </div>
      <div className="ministry-user">
        <div>
          <span>{profile.title}</span>
          <strong>{profile.name}</strong>
          <small>{profile.purpose}</small>
        </div>
        <div className="ministry-role-toggle" aria-label="Console role">
          {(["minister", "department_officer"] as MinistryConsoleRole[]).map((item) => (
            <button className={role === item ? "active" : ""} key={item} onClick={() => setRole(item)} type="button">
              {item === "minister" ? "Minister" : "Officer"}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

function Sidebar({ active, role, setActive }: { active: MinistrySection; role: MinistryConsoleRole; setActive: (section: MinistrySection) => void }) {
  return (
    <aside className="ministry-sidebar">
      <div className="ministry-profile-card">
        <img alt="Neutral service illustration" src={ASSETS.portrait} />
        <div>
          <span>Ministry mandate</span>
          <strong>Clear district bottlenecks</strong>
          <small>{roleProfiles[role].purpose}</small>
        </div>
      </div>
      <nav className="ministry-nav" aria-label="Ministry console sections">
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
      <div className="ministry-policy-note">
        <ShieldCheck size={18} />
        <span>Protected complaints stay hidden from this ministry unless CM Cell policy explicitly releases them.</span>
      </div>
    </aside>
  );
}

function KpiCard({ icon: Icon, label, value, note, tone = "neutral" }: { icon: LucideIcon; label: string; value: string; note: string; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return (
    <article className={`ministry-kpi ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function DistrictList({
  districts,
  selectedDistrict,
  setSelectedDistrict,
}: {
  districts: DashboardMetricRowDto[];
  selectedDistrict: string | null;
  setSelectedDistrict: (district: string) => void;
}) {
  return (
    <section className="ministry-panel ministry-districts">
      <div className="ministry-panel-head">
        <div>
          <span>District KPIs</span>
          <h2>Where ministry action is slipping</h2>
        </div>
        <Building2 size={22} />
      </div>
      <div className="ministry-district-list">
        {districts.length === 0 ? <div className="ministry-empty">No district rows are visible for this ministry scope.</div> : null}
        {districts.map((row) => (
          <button className={selectedDistrict === row.label ? "active" : ""} key={row.key} onClick={() => setSelectedDistrict(row.label)} type="button">
            <div>
              <strong>{row.label}</strong>
              <small>{formatNumber(row.openTickets)} open | {formatNumber(row.dueIn48h)} due 48h</small>
            </div>
            <span className={row.slaBreached > 0 ? "hot" : "ok"}>{formatNumber(row.slaBreached)} breached</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TicketRow({ selected, ticket, onSelect }: { selected: boolean; ticket: DashboardTicketDto; onSelect: (ticketId: string) => void }) {
  return (
    <button className={`ministry-ticket-row ${selected ? "active" : ""}`} onClick={() => onSelect(ticket.id)} type="button">
      <span className={`ministry-sla ${slaTone(ticket)}`}>{slaText(ticket)}</span>
      <div>
        <strong>{ticket.title}</strong>
        <small>{ticket.id} | {titleCase(ticket.category)} | {ticket.district}</small>
      </div>
      <b className={ticket.primaryQueue.kind}>{titleCase(ticket.primaryQueue.kind)}</b>
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
    <section className="ministry-panel ministry-ticket-panel">
      <div className="ministry-panel-head">
        <div>
          <span>Ticket queue</span>
          <h2>{title}</h2>
        </div>
        <FileText size={22} />
      </div>
      <div className="ministry-ticket-list">
        {tickets.length === 0 ? <div className="ministry-empty">{emptyText}</div> : null}
        {tickets.map((ticket) => (
          <TicketRow key={ticket.id} onSelect={onSelect} selected={selectedTicketId === ticket.id} ticket={ticket} />
        ))}
      </div>
    </section>
  );
}

function Workspace({
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
  actionMode: MinistryActionMode;
  actionNotice: string | null;
  detail: TicketDetailDto | null;
  note: string;
  onSubmit: () => void;
  selected: DashboardTicketDto | null;
  setActionMode: (mode: MinistryActionMode) => void;
  setNote: (note: string) => void;
}) {
  const selectedCanAct = canAct(selected);
  const selectedCanResolve = canResolve(selected);
  const active = actionCopy[actionMode];
  const selectedPatternTicket: SelectedTicketSummary | undefined = selected
    ? {
        id: selected.id,
        title: selected.title,
        owner: selected.primaryQueue.ownerLabel,
        status: titleCase(selected.status),
      }
    : undefined;
  return (
    <section className="ministry-panel ministry-workspace">
      <div className="ministry-panel-head">
        <div>
          <span>{selected?.id ?? "No ticket selected"}</span>
          <h2>Ministry action workspace</h2>
        </div>
        <ClipboardCheck size={22} />
      </div>
      {selected ? (
        <>
          <h3>{selected.title}</h3>
          <p>{detail?.description ?? `${selected.area}, ${selected.district} | ${selected.ministry}`}</p>
          <div className="ministry-queue-stack">
            <span className="primary">Primary: {selected.primaryQueue.ownerLabel}</span>
            {selected.secondaryQueues.map((queue) => (
              <span key={`${queue.kind}-${queue.ownerKey}`}>Secondary: {queue.ownerLabel}</span>
            ))}
          </div>
          <div className="ministry-detail-grid">
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
              <span>Location</span>
              <strong>{selected.district}</strong>
            </div>
          </div>
          <div className="ministry-pattern-stack">
            <SlaLadderCard pattern={roleConsolePatterns.ministry} selectedTicket={selectedPatternTicket} />
            <CitizenVisibleUpdateCard pattern={roleConsolePatterns.ministry} selectedTicket={selectedPatternTicket} />
          </div>
          <div className="ministry-action-grid">
            {(Object.keys(actionCopy) as MinistryActionMode[]).map((mode) => {
              const Icon = actionCopy[mode].icon;
              const disabled = actionBusy || !selectedCanAct || (mode === "resolve" && !selectedCanResolve);
              return (
                <button className={actionMode === mode ? "active" : ""} disabled={disabled} key={mode} onClick={() => setActionMode(mode)} type="button">
                  <Icon size={15} />
                  <span>{actionCopy[mode].short}</span>
                </button>
              );
            })}
          </div>
          <label className="ministry-note">
            <span>{active.label}</span>
            <textarea onChange={(event) => setNote(event.target.value)} placeholder={active.detail} rows={4} value={note} />
          </label>
          <button className="ministry-submit" disabled={actionBusy || !selectedCanAct || (actionMode === "resolve" && !selectedCanResolve)} onClick={onSubmit} type="button">
            {actionBusy ? "Saving..." : active.label}
          </button>
          {!selectedCanResolve && selected.primaryQueue.kind === "cm_cell" ? (
            <small className="ministry-footnote">CM Cell is primary now. Ministry can add directives and proof requests, but cannot close the ticket.</small>
          ) : null}
          {actionNotice ? <div className="ministry-notice success">{actionNotice}</div> : null}
          {actionError ? <div className="ministry-notice error">{actionError}</div> : null}
        </>
      ) : (
        <div className="ministry-empty">Select a ministry ticket to issue a directive or close with proof.</div>
      )}
    </section>
  );
}

function Timeline({ detail }: { detail: TicketDetailDto | null }) {
  const events = detail ? [...detail.governmentEvents, ...detail.citizenTimeline].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8) : [];
  return (
    <section className="ministry-panel ministry-timeline-panel">
      <div className="ministry-panel-head compact">
        <div>
          <span>Audit-visible trail</span>
          <h2>Latest activity</h2>
        </div>
      </div>
      <div className="ministry-timeline">
        {events.length === 0 ? <div className="ministry-empty tight">Select a ticket to load timeline.</div> : null}
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

export default function MinistryOperationsConsole() {
  const [role, setRole] = useState<MinistryConsoleRole>("minister");
  const [activeSection, setActiveSection] = useState<MinistrySection>("overview");
  const [dashboard, setDashboard] = useState<RoleDashboardDto | null>(null);
  const [primaryDashboard, setPrimaryDashboard] = useState<RoleDashboardDto | null>(null);
  const [dashboardBusy, setDashboardBusy] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<MinistryActionMode>("directive");
  const [actionNote, setActionNote] = useState("Ministry directs the district owner to clear the bottleneck and upload proof before the next SLA review.");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDashboardBusy(true);
    setDashboardError(null);
    const baseRequest = {
      role,
      ministry: assignedMinistry,
      q: query.trim() || undefined,
      ticketLimit: 75,
    } as const;
    Promise.all([
      fetchRoleDashboard(baseRequest, controller.signal, authFor(role)),
      fetchRoleDashboard({ ...baseRequest, primaryQueue: "ministry" }, controller.signal, authFor(role)),
    ])
      .then(([nextDashboard, nextPrimaryDashboard]) => {
        setDashboard(nextDashboard);
        setPrimaryDashboard(nextPrimaryDashboard);
        setDashboardError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDashboard(null);
          setPrimaryDashboard(null);
          setDashboardError(error instanceof Error ? error.message : "Ministry dashboard could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDashboardBusy(false);
      });
    return () => controller.abort();
  }, [query, refreshIndex, role]);

  const tickets = dashboard?.tickets ?? fallbackMinistryTickets;
  const primaryMinistryTickets = primaryDashboard?.tickets ?? tickets.filter((ticket) => ticket.primaryQueue.kind === "ministry");
  const combinedTickets = useMemo(() => {
    const rows = new Map<string, DashboardTicketDto>();
    [...primaryMinistryTickets, ...tickets].forEach((ticket) => rows.set(ticket.id, ticket));
    return [...rows.values()];
  }, [primaryMinistryTickets, tickets]);
  const cmCellTickets = useMemo(() => tickets.filter((ticket) => ticket.primaryQueue.kind === "cm_cell"), [tickets]);
  const districtRows = dashboard?.byDistrict.length ? dashboard.byDistrict : fallbackDistrictRows;
  const filteredByDistrict = useMemo(() => {
    if (!selectedDistrict) return combinedTickets;
    return combinedTickets.filter((ticket) => ticket.district === selectedDistrict);
  }, [combinedTickets, selectedDistrict]);
  const selectedTicket = combinedTickets.find((ticket) => ticket.id === selectedTicketId) ?? primaryMinistryTickets[0] ?? tickets[0] ?? null;
  const selectedPatternTicket: SelectedTicketSummary | undefined = selectedTicket
    ? {
        id: selectedTicket.id,
        title: selectedTicket.title,
        owner: selectedTicket.primaryQueue.ownerLabel,
        status: titleCase(selectedTicket.status),
      }
    : undefined;

  useEffect(() => {
    if (!selectedDistrict && districtRows[0]) setSelectedDistrict(districtRows[0].label);
  }, [districtRows, selectedDistrict]);

  useEffect(() => {
    const defaultTicketId = primaryMinistryTickets[0]?.id ?? tickets[0]?.id ?? null;
    if (!selectedTicketId && defaultTicketId) setSelectedTicketId(defaultTicketId);
    if (selectedTicketId && combinedTickets.length > 0 && !combinedTickets.some((ticket) => ticket.id === selectedTicketId) && defaultTicketId) {
      setSelectedTicketId(defaultTicketId);
    }
  }, [combinedTickets, primaryMinistryTickets, selectedTicketId, tickets]);

  useEffect(() => {
    setSelectedTicketId(null);
    setTicketDetail(null);
    setActionNotice(null);
    setActionError(null);
  }, [role]);

  useEffect(() => {
    if (!selectedTicket) {
      setTicketDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailError(null);
    fetchTicketDetail(selectedTicket.id, authFor(role), controller.signal)
      .then(setTicketDetail)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setTicketDetail(null);
          setDetailError(error instanceof Error ? error.message : "Ticket detail could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [refreshIndex, role, selectedTicket?.id]);

  useEffect(() => {
    setActionNotice(null);
    setActionError(null);
    if (!canResolve(selectedTicket) && actionMode === "resolve") setActionMode("directive");
  }, [actionMode, selectedTicket?.id, selectedTicket?.primaryQueue.kind, selectedTicket?.status]);

  async function submitMinistryAction() {
    if (!selectedTicket) return;
    setActionBusy(true);
    setActionNotice(null);
    setActionError(null);
    const note = noteFor(actionMode, actionNote);
    const safeTicketId = selectedTicket.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket";
    const fieldOfficer = role === "minister" ? `${shortMinistry} minister office` : `${shortMinistry} department officer`;
    const visitAt = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    let action: FieldActionRequest;
    if (actionMode === "request_evidence") {
      action = {
        action: "schedule_visit",
        fieldOfficer,
        visitAt,
        note,
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
            label: "closure",
            fileName: `${safeTicketId}-ministry-closure-proof.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: 740_000,
          },
        ],
      };
    } else {
      action = {
        action: "add_field_report",
        fieldOfficer,
        note,
        evidence: [
          {
            label: "field_report",
            fileName: `${safeTicketId}-ministry-directive.txt`,
            mimeType: "text/plain",
            sizeBytes: Math.max(256, note.length * 2),
          },
        ],
      };
    }

    try {
      await submitFieldAction(selectedTicket.id, action, authFor(role));
      setActionNotice(`${actionCopy[actionMode].label} saved for ${selectedTicket.id}.`);
      setRefreshIndex((value) => value + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Ministry action could not be saved.");
    } finally {
      setActionBusy(false);
    }
  }

  const openTickets = dashboard?.kpis.openTickets ?? tickets.length;
  const breached = dashboard?.kpis.slaBreached ?? tickets.filter((ticket) => slaTone(ticket) === "danger").length;
  const due48 = dashboard?.kpis.dueIn48h ?? tickets.filter((ticket) => ticket.sla.dueAt && hoursUntil(ticket.sla.dueAt) >= 0 && hoursUntil(ticket.sla.dueAt) <= 48).length;
  const cmEscalated = dashboard?.kpis.escalatedToCmCell ?? cmCellTickets.length;
  const primaryMinistryTotal = primaryDashboard?.ticketWindow?.total ?? primaryDashboard?.kpis.openTickets ?? primaryMinistryTickets.length;
  const avgAgeDays = dashboard?.kpis.averageAgeHours ? Math.max(0.1, dashboard.kpis.averageAgeHours / 24) : 2.8;

  return (
    <div className="ministry-app">
      <Header role={role} setRole={setRole} />
      <main className="ministry-shell">
        <Sidebar active={activeSection} role={role} setActive={setActiveSection} />
        <section className="ministry-main">
          <div className="ministry-toolbar">
            <div>
              <span>Ministry control room</span>
              <h1>{shortMinistry}: clear district bottlenecks before CM escalation</h1>
            </div>
            <label className="ministry-search">
              <Search size={16} />
              <input aria-label="Search ministry tickets" onChange={(event) => setQuery(event.target.value)} placeholder="Search ticket, district, owner..." value={query} />
            </label>
            <button className="ministry-refresh" disabled={dashboardBusy} onClick={() => setRefreshIndex((value) => value + 1)} type="button">
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          <section className="ministry-kpi-grid" aria-label="Ministry queue metrics">
            <KpiCard icon={Landmark} label="Visible in ministry" note="Assigned MAWS scope only" value={formatNumber(openTickets)} />
            <KpiCard icon={AlertTriangle} label="SLA breached" note="Needs immediate owner review" tone="danger" value={formatNumber(breached)} />
            <KpiCard icon={Clock3} label="Due in 48h" note="Prevent next breach wave" tone="warn" value={formatNumber(due48)} />
            <KpiCard icon={ClipboardCheck} label="Primary ministry" note="Current owner is MAWS" tone="good" value={formatNumber(primaryMinistryTotal)} />
            <KpiCard icon={TimerReset} label="At CM Cell" note="Ministry still secondary-visible" value={formatNumber(cmEscalated)} />
            <KpiCard icon={Gauge} label="Average age" note="Open ministry work" value={`${avgAgeDays.toFixed(1)}d`} />
          </section>

          <RolePatternSummary pattern={roleConsolePatterns.ministry} selectedTicket={selectedPatternTicket} />

          {dashboardError ? <div className="ministry-error">{dashboardError}. Start the API on http://localhost:3001.</div> : null}

          {activeSection === "overview" ? (
            <section className="ministry-two-col">
              <DistrictList districts={districtRows.slice(0, 12)} selectedDistrict={selectedDistrict} setSelectedDistrict={setSelectedDistrict} />
              <TicketList
                emptyText="No ministry tickets are visible. Route or escalate a MAWS ticket to populate this queue."
                onSelect={(ticketId) => {
                  setSelectedTicketId(ticketId);
                  setActiveSection("workspace");
                }}
                selectedTicketId={selectedTicket?.id ?? null}
                tickets={tickets.slice(0, 14)}
                title="Highest-risk ministry tickets"
              />
            </section>
          ) : null}

          {activeSection === "districts" ? (
            <section className="ministry-two-col wide-right">
              <DistrictList districts={districtRows} selectedDistrict={selectedDistrict} setSelectedDistrict={setSelectedDistrict} />
              <TicketList
                emptyText="No ticket rows for the selected district."
                onSelect={(ticketId) => {
                  setSelectedTicketId(ticketId);
                  setActiveSection("workspace");
                }}
                selectedTicketId={selectedTicket?.id ?? null}
                tickets={filteredByDistrict}
                title={selectedDistrict ? `${selectedDistrict} ticket queue` : "District ticket queue"}
              />
            </section>
          ) : null}

          {activeSection === "queue" ? (
            <section className="ministry-two-col wide-right">
              <TicketList
                emptyText="No primary ministry tickets. Escalated tickets may already be at CM Cell."
                onSelect={(ticketId) => {
                  setSelectedTicketId(ticketId);
                  setActiveSection("workspace");
                }}
                selectedTicketId={selectedTicket?.id ?? null}
                tickets={primaryMinistryTickets}
                title="Primary ministry queue"
              />
              <Workspace
                actionBusy={actionBusy}
                actionError={actionError}
                actionMode={actionMode}
                actionNotice={actionNotice}
                detail={ticketDetail}
                note={actionNote}
                onSubmit={submitMinistryAction}
                selected={selectedTicket}
                setActionMode={setActionMode}
                setNote={setActionNote}
              />
            </section>
          ) : null}

          {activeSection === "workspace" ? (
            <section className="ministry-two-col wide-left">
              <Workspace
                actionBusy={actionBusy}
                actionError={actionError}
                actionMode={actionMode}
                actionNotice={actionNotice}
                detail={ticketDetail}
                note={actionNote}
                onSubmit={submitMinistryAction}
                selected={selectedTicket}
                setActionMode={setActionMode}
                setNote={setActionNote}
              />
              <Timeline detail={ticketDetail} />
            </section>
          ) : null}

          {detailError ? <div className="ministry-error subtle">{detailError}</div> : null}
          <div className="ministry-mode-banner">
            {dashboardBusy ? "Loading live ticket spine..." : `Live ministry console. ${roleProfiles[role].title} is scoped to ${assignedMinistry}.`}
          </div>
        </section>
      </main>
    </div>
  );
}
