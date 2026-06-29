import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  FileWarning,
  Flame,
  Gauge,
  Landmark,
  LockKeyhole,
  MapPin,
  Megaphone,
  RadioTower,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  fetchRoleDashboard,
  generateDashboardBrief,
  hoursUntil,
  submitFieldAction,
  submitRejectionReviewAction,
  type DashboardBriefRunDto,
  type DashboardTicketDto,
  type FieldActionRequest,
  type RejectionReviewActionRequest,
  type RoleDashboardDto,
} from "./govDashboardApi";
import {
  CitizenVisibleUpdateCard,
  RolePatternSummary,
  SlaLadderCard,
  coherentDemoTicket,
  roleConsolePatterns,
  type SelectedTicketSummary,
} from "./roleConsolePattern";

type MetricMode = "breach" | "cm" | "protected" | "age";
type CmSection = "overview" | "heatmap" | "ministry" | "tickets";
type CmActionMode = "directive" | "ministry_response" | "audit_note" | "resolve";
type RejectionReviewMode = "overturn_and_route" | "request_info" | "uphold_rejection";

type GeoFeature = {
  type: "Feature";
  properties: Record<string, string | number | null | undefined>;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
};

type GeoCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

type RuntimeAssets = {
  logo: string;
  emblem: string;
  portrait: string;
};

type DistrictMetric = {
  district: string;
  open: number;
  breached: number;
  cmEscalated: number;
  protectedCount: number;
  dueToday: number;
  avgAge: number;
  redMinistries: number;
  primaryMinistry: string;
  directivePending: number;
  responseOverdue: number;
};

type MinistryMetric = {
  ministry: string;
  open: number;
  breached: number;
  dueToday: number;
  cmEscalated: number;
  protectedCount: number;
  avgAge: number;
  responseOverdue: number;
  directiveStatus: "Red" | "Amber" | "Watch";
  trend: number;
};

type DecisionItem = {
  id: string;
  title: string;
  district: string;
  ministry: string;
  status: string;
  breachHours: number;
  ask: string;
  protectedCase?: boolean;
  actionPrimary?: boolean;
  closed?: boolean;
};

declare global {
  interface Window {
    __TN_DISTRICT_GEOJSON__?: GeoCollection;
    __WHISTLE_ASSETS__?: RuntimeAssets;
  }
}

const ASSETS: RuntimeAssets = window.__WHISTLE_ASSETS__ ?? {
  logo: "/assets/brand/whistle-fake-logo.svg",
  emblem: "/assets/brand/whistle-civic-mark.svg",
  portrait: "/assets/brand/whistle-service-portrait.svg",
};

const fallbackDistricts = [
  "Ariyalur",
  "Chengalpattu",
  "Chennai",
  "Coimbatore",
  "Cuddalore",
  "Dharmapuri",
  "Dindigul",
  "Erode",
  "Kallakurichi",
  "Kanniyakumari",
  "Karur",
  "Madurai",
  "Mayiladuthurai",
  "Nagapattinam",
  "Namakkal",
  "Perambalur",
  "Pudukkottai",
  "Ramanathapuram",
  "Ranipet",
  "Salem",
  "Sivaganga",
  "Tenkasi",
  "Thanjavur",
  "The Nilgiris",
  "Theni",
  "Thiruvallur",
  "Thiruvarur",
  "Tiruchirappalli",
  "Tirunelveli",
  "Tirupathur",
  "Tiruppur",
  "Tiruvannamalai",
  "Tuticorin",
  "Vellore",
  "Villupuram",
  "Virudhunagar",
  "Kanchipuram",
  "Krishnagiri",
];

const ministryMetrics: MinistryMetric[] = [
  {
    ministry: "Municipal Administration & Water Supply",
    open: 35520,
    breached: 5215,
    dueToday: 1480,
    cmEscalated: 1063,
    protectedCount: 42,
    avgAge: 9.3,
    responseOverdue: 188,
    directiveStatus: "Red",
    trend: 18,
  },
  {
    ministry: "Highways and Minor Ports",
    open: 18420,
    breached: 2510,
    dueToday: 820,
    cmEscalated: 420,
    protectedCount: 12,
    avgAge: 8.1,
    responseOverdue: 74,
    directiveStatus: "Amber",
    trend: 11,
  },
  {
    ministry: "Revenue and Disaster Management",
    open: 8910,
    breached: 1515,
    dueToday: 410,
    cmEscalated: 310,
    protectedCount: 188,
    avgAge: 10.2,
    responseOverdue: 61,
    directiveStatus: "Red",
    trend: 23,
  },
  {
    ministry: "Energy",
    open: 15110,
    breached: 1410,
    dueToday: 620,
    cmEscalated: 210,
    protectedCount: 9,
    avgAge: 5.6,
    responseOverdue: 36,
    directiveStatus: "Watch",
    trend: -6,
  },
  {
    ministry: "Rural Development & Panchayat Raj",
    open: 10780,
    breached: 1240,
    dueToday: 510,
    cmEscalated: 160,
    protectedCount: 5,
    avgAge: 7.4,
    responseOverdue: 42,
    directiveStatus: "Amber",
    trend: 8,
  },
  {
    ministry: "Health and Family Welfare",
    open: 6730,
    breached: 610,
    dueToday: 260,
    cmEscalated: 80,
    protectedCount: 2,
    avgAge: 4.8,
    responseOverdue: 18,
    directiveStatus: "Watch",
    trend: -4,
  },
  {
    ministry: "Food and Civil Supplies",
    open: 5840,
    breached: 540,
    dueToday: 230,
    cmEscalated: 72,
    protectedCount: 7,
    avgAge: 5.1,
    responseOverdue: 17,
    directiveStatus: "Watch",
    trend: 3,
  },
  {
    ministry: "CM Cell / Vigilance",
    open: 2190,
    breached: 360,
    dueToday: 88,
    cmEscalated: 540,
    protectedCount: 1124,
    avgAge: 3.8,
    responseOverdue: 24,
    directiveStatus: "Amber",
    trend: 14,
  },
];

const districtOverrides: Record<string, Partial<DistrictMetric>> = {
  Chennai: {
    open: 8940,
    breached: 1590,
    cmEscalated: 620,
    protectedCount: 240,
    primaryMinistry: "Municipal Administration & Water Supply",
    redMinistries: 5,
    responseOverdue: 83,
  },
  Thiruvallur: {
    open: 6190,
    breached: 930,
    cmEscalated: 328,
    protectedCount: 88,
    primaryMinistry: "Highways and Minor Ports",
    redMinistries: 4,
    responseOverdue: 56,
  },
  Madurai: {
    open: 6840,
    breached: 880,
    cmEscalated: 284,
    protectedCount: 76,
    primaryMinistry: "Municipal Administration & Water Supply",
    redMinistries: 4,
    responseOverdue: 41,
  },
  Coimbatore: {
    open: 7120,
    breached: 740,
    cmEscalated: 238,
    protectedCount: 54,
    primaryMinistry: "Municipal Administration & Water Supply",
    redMinistries: 3,
    responseOverdue: 37,
  },
  Tuticorin: {
    open: 4720,
    breached: 793,
    cmEscalated: 302,
    protectedCount: 52,
    primaryMinistry: "Highways and Minor Ports",
    redMinistries: 4,
    responseOverdue: 44,
  },
  Thanjavur: {
    open: 3820,
    breached: 461,
    cmEscalated: 246,
    protectedCount: 148,
    primaryMinistry: "Revenue and Disaster Management",
    redMinistries: 3,
    responseOverdue: 35,
  },
};

const decisionQueue: DecisionItem[] = [
  {
    id: "WH-2026-DEMO-CM-SANITATION",
    title: coherentDemoTicket.title,
    district: "Chennai",
    ministry: "Municipal Administration & Water Supply",
    status: "CM Cell primary | MAWS and Velachery MLA Office remain secondary-visible",
    breachHours: 6,
    ask: "Issue 48-hour MAWS secretary directive with closure plan and field proof.",
    actionPrimary: true,
  },
  {
    id: "CM-PRO-1042",
    title: "Protected contractor-pressure report linked to Velachery drain repair",
    district: "Chennai",
    ministry: "CM Cell / Vigilance",
    status: "Protected review | identity masked outside protected cell",
    breachHours: 4,
    ask: "Keep identity protected while verifying whether field proof was deliberately delayed.",
    protectedCase: true,
    actionPrimary: true,
  },
  {
    id: "CM-AUD-1042",
    title: "Duplicate school-gate sanitation report rejected without field note",
    district: "Chennai",
    ministry: "Municipal Administration & Water Supply",
    status: "Rejection audit linked | citizen update needed",
    breachHours: 2,
    ask: "Restore the linked citizen report into the same Velachery closure chain.",
    actionPrimary: true,
  },
];

const auditSignals = [
  {
    label: "Rejected without field note",
    value: 318,
    detail: "Revenue and municipal cases dominate this pattern.",
  },
  {
    label: "Protected corruption intake",
    value: 1124,
    detail: "Identity visible only to protected CM Cell users.",
  },
  {
    label: "Repeat district breach",
    value: 11,
    detail: "Districts breached 3 straight review cycles.",
  },
];

const cmMenuItems: Array<{ id: CmSection; label: string; detail: string }> = [
  { id: "overview", label: "Overview", detail: "State command summary" },
  { id: "heatmap", label: "State heatmap", detail: "District pressure view" },
  { id: "ministry", label: "Ministry", detail: "Accountability lanes" },
  { id: "tickets", label: "Tickets", detail: "CMCell queue filter" },
];

const cmActionCopy: Record<CmActionMode, { label: string; detail: string; icon: LucideIcon }> = {
  directive: {
    label: "Issue directive",
    detail: "Record a CM Cell directive and keep the ministry accountable as secondary owner.",
    icon: Megaphone,
  },
  ministry_response: {
    label: "Ask ministry response",
    detail: "Set a 24-hour response request for the ministry or district field lead.",
    icon: RadioTower,
  },
  audit_note: {
    label: "Open audit note",
    detail: "Append a command note for the escalation trail without changing ownership.",
    icon: FileWarning,
  },
  resolve: {
    label: "Resolve at CM Cell",
    detail: "Close the CM-primary ticket with closure evidence, citizen impact check, and safety-risk confirmation.",
    icon: CheckCircle2,
  },
};

const rejectionReviewCopy: Record<RejectionReviewMode, { label: string; detail: string; icon: LucideIcon }> = {
  overturn_and_route: {
    label: "Reverse rejection",
    detail: "Restore a valid citizen issue to local execution with rejection-review oversight retained.",
    icon: RotateCcw,
  },
  request_info: {
    label: "Ask citizen info",
    detail: "Keep the case alive and ask the citizen for missing routing details.",
    icon: Search,
  },
  uphold_rejection: {
    label: "Uphold closure",
    detail: "Close a valid rejection with a CM-maintained audit note.",
    icon: ShieldCheck,
  },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function districtName(feature: GeoFeature) {
  return String(feature.properties.dtname ?? feature.properties.district ?? feature.properties.DISTRICT ?? feature.properties.name ?? "");
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function collectPositions(input: unknown, output: [number, number][]) {
  if (!Array.isArray(input)) return;
  if (typeof input[0] === "number" && typeof input[1] === "number") {
    output.push([Number(input[0]), Number(input[1])]);
    return;
  }
  input.forEach((item) => collectPositions(item, output));
}

function geometryRings(feature: GeoFeature): [number, number][][] {
  if (feature.geometry.type === "Polygon") {
    return (feature.geometry.coordinates as [number, number][][]) ?? [];
  }
  return ((feature.geometry.coordinates as [number, number][][][]) ?? []).flat();
}

function useDistrictGeoJson() {
  const [geoJson, setGeoJson] = useState<GeoCollection | null>(window.__TN_DISTRICT_GEOJSON__ ?? null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(window.__TN_DISTRICT_GEOJSON__ ? "ready" : "loading");

  useEffect(() => {
    if (window.__TN_DISTRICT_GEOJSON__) return;
    let cancelled = false;
    fetch("/assets/data/tamil-nadu-districts.geojson")
      .then((response) => {
        if (!response.ok) throw new Error("Map failed to load");
        return response.json() as Promise<GeoCollection>;
      })
      .then((data) => {
        if (cancelled) return;
        setGeoJson(data);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { geoJson, loadState };
}

function hashDistrict(name: string) {
  return [...name].reduce((total, char, index) => total + char.charCodeAt(0) * (index + 3), 0);
}

function createDistrictMetric(district: string, index: number): DistrictMetric {
  const base = hashDistrict(district);
  const ministry = ministryMetrics[(base + index) % ministryMetrics.length].ministry;
  const open = 1350 + (base % 4200) + index * 37;
  const breached = Math.round(open * (0.07 + (base % 8) * 0.012));
  const cmEscalated = Math.round(breached * (0.18 + (index % 5) * 0.032));
  const protectedCount = Math.round(18 + (base % 95));
  const dueToday = Math.round(breached * 0.38 + (index % 6) * 18);

  return {
    district,
    open,
    breached,
    cmEscalated,
    protectedCount,
    dueToday,
    avgAge: Number((4.6 + (base % 58) / 10).toFixed(1)),
    redMinistries: 1 + (index % 5),
    primaryMinistry: ministry,
    directivePending: Math.round(cmEscalated * 0.32),
    responseOverdue: Math.round(cmEscalated * 0.18),
    ...districtOverrides[district],
  };
}

function metricValue(metric: DistrictMetric, mode: MetricMode) {
  if (mode === "cm") return metric.cmEscalated;
  if (mode === "protected") return metric.protectedCount;
  if (mode === "age") return metric.avgAge;
  return metric.breached;
}

function metricLabel(mode: MetricMode) {
  if (mode === "cm") return "CM escalations";
  if (mode === "protected") return "Protected cases";
  if (mode === "age") return "Average age";
  return "SLA breaches";
}

function districtTone(metric: DistrictMetric, mode: MetricMode) {
  const value = metricValue(metric, mode);
  if (mode === "age") {
    if (value > 9) return "critical";
    if (value > 7.2) return "high";
    if (value > 5.8) return "medium";
    return "low";
  }
  if (mode === "protected") {
    if (value > 180) return "critical";
    if (value > 90) return "high";
    if (value > 45) return "medium";
    return "low";
  }
  if (mode === "cm") {
    if (value > 450) return "critical";
    if (value > 250) return "high";
    if (value > 130) return "medium";
    return "low";
  }
  if (value > 1000) return "critical";
  if (value > 650) return "high";
  if (value > 350) return "medium";
  return "low";
}

function sumDistricts(metrics: DistrictMetric[], key: keyof Pick<DistrictMetric, "open" | "breached" | "cmEscalated" | "protectedCount" | "dueToday" | "directivePending">) {
  return metrics.reduce((total, item) => total + item[key], 0);
}

function commandStatus(metrics: DistrictMetric[]) {
  const redDistricts = metrics.filter((metric) => metric.breached > 650 || metric.cmEscalated > 250).length;
  const redMinistries = ministryMetrics.filter((metric) => metric.directiveStatus === "Red").length;
  return {
    open: sumDistricts(metrics, "open"),
    breached: sumDistricts(metrics, "breached"),
    cmEscalated: sumDistricts(metrics, "cmEscalated"),
    protectedCount: sumDistricts(metrics, "protectedCount"),
    dueToday: sumDistricts(metrics, "dueToday"),
    directives: sumDistricts(metrics, "directivePending"),
    redDistricts,
    redMinistries,
  };
}

function statusFromDashboard(fallback: ReturnType<typeof commandStatus>, dashboard: RoleDashboardDto | null): ReturnType<typeof commandStatus> {
  if (!dashboard) return fallback;
  return {
    open: dashboard.kpis.openTickets,
    breached: dashboard.kpis.slaBreached,
    cmEscalated: dashboard.kpis.escalatedToCmCell,
    protectedCount: dashboard.kpis.protectedCount,
    dueToday: dashboard.kpis.dueToday,
    directives: dashboard.tickets.filter((ticket) => ticket.primaryQueue.kind === "cm_cell").length,
    redDistricts: dashboard.byDistrict.filter((district) => district.slaBreached > 0).length,
    redMinistries: dashboard.byMinistry.filter((ministry) => ministry.slaBreached > 0).length,
  };
}

function decisionItemsFromDashboard(dashboard: RoleDashboardDto | null): DecisionItem[] {
  if (!dashboard) return decisionQueue;
  const cmTickets = dashboard.tickets.filter((ticket) => ticket.primaryQueue.kind === "cm_cell" || ticket.status === "escalated_cm_cell");
  const source = cmTickets.length > 0 ? cmTickets : dashboard.tickets.slice(0, 4);
  if (source.length === 0) return decisionQueue;
  return source.map((ticket: DashboardTicketDto) => {
    const lateHours = Math.max(0, -hoursUntil(ticket.sla.dueAt));
    const secondary = ticket.secondaryQueues.length ? `${ticket.secondaryQueues.length} secondary owner(s)` : "No secondary owner";
    return {
      id: ticket.id,
      title: ticket.title,
      district: ticket.district,
      ministry: ticket.ministry,
      status: `${ticket.primaryQueue.ownerLabel} primary | ${secondary}`,
      breachHours: lateHours || Math.max(1, hoursUntil(ticket.sla.dueAt)),
      ask: ticket.primaryQueue.kind === "cm_cell" ? `Issue directive to ${ticket.ministry}; ministry remains accountable as secondary owner.` : `Review ${ticket.primaryQueue.ownerLabel} queue and confirm next action.`,
      protectedCase: ticket.protected,
      actionPrimary: ticket.primaryQueue.kind === "cm_cell",
      closed: ticket.status === "resolved" || ticket.status === "closed",
    };
  });
}

function CommandKpi({
  icon: Icon,
  label,
  value,
  note,
  tone = "red",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  tone?: "red" | "amber" | "dark" | "green";
}) {
  return (
    <div className={`cm-kpi tone-${tone}`}>
      <span className="cm-kpi-icon">
        <Icon size={19} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Header() {
  return (
    <header className="cm-header">
      <div className="cm-brand">
        <img alt="Whistle logo" src={ASSETS.logo} />
        <div>
          <strong>Whistle</strong>
          <span>CM Cell Command Center</span>
        </div>
      </div>

      <div className="cm-gov">
        <img alt="Neutral civic service mark" src={ASSETS.emblem} />
        <div>
          <strong>Tamil Nadu Government</strong>
          <span>State grievance oversight and intervention</span>
        </div>
      </div>

      <div className="cm-shift">
        <span>Command review</span>
        <strong>Today, 3:55 PM</strong>
        <small>Prototype data</small>
      </div>
    </header>
  );
}

function StateHeatmap({
  geoJson,
  loadState,
  metrics,
  metricMode,
  setMetricMode,
  selectedDistrict,
  setSelectedDistrict,
}: {
  geoJson: GeoCollection | null;
  loadState: "loading" | "ready" | "error";
  metrics: DistrictMetric[];
  metricMode: MetricMode;
  setMetricMode: (mode: MetricMode) => void;
  selectedDistrict: string;
  setSelectedDistrict: (district: string) => void;
}) {
  const projection = useMemo(() => {
    if (!geoJson) return null;
    const points: [number, number][] = [];
    geoJson.features.forEach((feature) => collectPositions(feature.geometry.coordinates, points));
    let minLon = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;

    points.forEach(([lon, lat]) => {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });

    const width = 450;
    const height = 650;
    const scale = Math.min((width * 0.9) / (maxLon - minLon), (height * 0.9) / (maxLat - minLat));
    const mapWidth = (maxLon - minLon) * scale;
    const mapHeight = (maxLat - minLat) * scale;
    const offsetX = (width - mapWidth) / 2;
    const offsetY = (height - mapHeight) / 2;

    return (position: [number, number]) => {
      const x = (position[0] - minLon) * scale + offsetX;
      const y = height - ((position[1] - minLat) * scale + offsetY);
      return [x, y] as [number, number];
    };
  }, [geoJson]);

  function pathForFeature(feature: GeoFeature) {
    if (!projection) return "";
    return geometryRings(feature)
      .map((ring) =>
        ring
          .map((position, index) => {
            const [x, y] = projection(position);
            return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
          })
          .join(" ")
          .concat(" Z"),
      )
      .join(" ");
  }

  function metricFor(name: string) {
    const normalized = normalize(name);
    return metrics.find((metric) => normalize(metric.district) === normalized);
  }

  return (
    <section className="cm-map-card">
      <div className="cm-section-heading">
        <div>
          <span>State pressure map</span>
          <h2>{metricLabel(metricMode)}</h2>
        </div>
        <div className="cm-map-tabs">
          {[
            ["breach", "SLA"],
            ["cm", "CM"],
            ["protected", "Protected"],
            ["age", "Age"],
          ].map(([mode, label]) => (
            <button className={`cm-metric-tab ${metricMode === mode ? "active" : ""}`} key={mode} onClick={() => setMetricMode(mode as MetricMode)} type="button">
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="cm-map-layout">
        <div className="cm-map-frame">
          {loadState === "loading" && <div className="cm-map-state">Loading sample district map...</div>}
          {loadState === "error" && <div className="cm-map-state error">District map could not be loaded.</div>}
          {geoJson && projection && (
            <svg aria-label="Tamil Nadu district command heatmap" className="cm-tn-map" role="img" viewBox="0 0 450 650">
              {geoJson.features.map((feature) => {
                const name = districtName(feature);
                const metric = metricFor(name);
                const tone = metric ? districtTone(metric, metricMode) : "low";
                return (
                  <path
                    className={`cm-district tone-${tone} ${selectedDistrict === name ? "selected" : ""}`}
                    d={pathForFeature(feature)}
                    fillRule="evenodd"
                    key={name}
                    onClick={() => setSelectedDistrict(name)}
                    tabIndex={0}
                  >
                    <title>
                      {metric
                        ? `${name}: ${formatNumber(metricValue(metric, metricMode))} ${metricLabel(metricMode).toLowerCase()}`
                        : name}
                    </title>
                  </path>
                );
              })}
            </svg>
          )}
        </div>
        <div className="cm-map-legend">
          <span className="low" /> Low
          <span className="medium" /> Medium
          <span className="high" /> High
          <span className="critical" /> Critical
        </div>
      </div>
    </section>
  );
}

function DistrictCommandPanel({
  district,
  metrics,
  selectedMinistry,
}: {
  district: string;
  metrics: DistrictMetric[];
  selectedMinistry: string;
}) {
  const metric = metrics.find((item) => item.district === district) ?? metrics[0];

  return (
    <section className="cm-district-panel">
      <div className="cm-section-heading">
        <div>
          <span>Selected district</span>
          <h2>{metric.district}</h2>
        </div>
        <MapPin size={22} />
      </div>
      <div className="cm-district-stats">
        <div>
          <span>SLA breached</span>
          <strong>{formatNumber(metric.breached)}</strong>
        </div>
        <div>
          <span>At CM Cell</span>
          <strong>{formatNumber(metric.cmEscalated)}</strong>
        </div>
        <div>
          <span>Response overdue</span>
          <strong>{formatNumber(metric.responseOverdue)}</strong>
        </div>
        <div>
          <span>Red ministries</span>
          <strong>{metric.redMinistries}</strong>
        </div>
      </div>
      <div className="cm-drill-path">
        <span>Current drilldown path</span>
        <strong>
          State &gt; {metric.district} &gt; {selectedMinistry || metric.primaryMinistry}
        </strong>
        <small>Click a ministry or district to shift the command context.</small>
      </div>
    </section>
  );
}

function DecisionQueue({
  items,
  selected,
  setSelected,
  actionMode,
  actionNote,
  actionBusy,
  actionNotice,
  actionError,
  setActionMode,
  setActionNote,
  onSubmitAction,
  selectedPatternTicket,
}: {
  items: DecisionItem[];
  selected: string;
  setSelected: (id: string) => void;
  actionMode: CmActionMode;
  actionNote: string;
  actionBusy: boolean;
  actionNotice: string | null;
  actionError: string | null;
  setActionMode: (mode: CmActionMode) => void;
  setActionNote: (value: string) => void;
  onSubmitAction: () => void;
  selectedPatternTicket?: SelectedTicketSummary;
}) {
  const selectedItem = items.find((item) => item.id === selected) ?? items[0] ?? decisionQueue[0];
  const activeCopy = cmActionCopy[actionMode];
  const canAct = selectedItem.actionPrimary === true && !selectedItem.closed;

  return (
    <section className="cm-decision-card">
      <div className="cm-section-heading">
        <div>
          <span>CM decision queue</span>
          <h2>Needs command intervention</h2>
        </div>
        <BellRing size={22} />
      </div>
      <div className="cm-decision-list">
        {items.map((item) => (
          <button className={`cm-decision-row ${selected === item.id ? "active" : ""}`} key={item.id} onClick={() => setSelected(item.id)} type="button">
            <span className={item.protectedCase ? "cm-priority protected" : "cm-priority"}>{item.breachHours}h</span>
            <div>
              <strong>{item.title}</strong>
              <small>
                {item.ministry} | {item.district}
              </small>
            </div>
          </button>
        ))}
      </div>

      <div className="cm-decision-detail">
        <span>{selectedItem.id}</span>
        <h3 className="cm-ticket-ask">{selectedItem.ask}</h3>
        <p>{selectedItem.status}</p>
        <div className="cm-pattern-stack">
          <SlaLadderCard pattern={roleConsolePatterns.cm_cell} selectedTicket={selectedPatternTicket} />
          <CitizenVisibleUpdateCard pattern={roleConsolePatterns.cm_cell} selectedTicket={selectedPatternTicket} />
        </div>
        <div className="cm-action-mode-grid">
          {(Object.keys(cmActionCopy) as CmActionMode[]).map((mode) => {
            const copy = cmActionCopy[mode];
            const Icon = copy.icon;
            return (
              <button className={actionMode === mode ? "active" : ""} disabled={!canAct} key={mode} onClick={() => setActionMode(mode)} type="button">
                <Icon size={14} />
                {copy.label}
              </button>
            );
          })}
        </div>
        <label className="cm-action-note">
          <span>{activeCopy.detail}</span>
          <textarea disabled={!canAct || actionBusy} onChange={(event) => setActionNote(event.target.value)} rows={2} value={actionNote} />
        </label>
        <button className="cm-submit-action" disabled={!canAct || actionBusy} onClick={onSubmitAction} type="button">
          {actionBusy ? "Saving command..." : activeCopy.label}
        </button>
        {selectedItem.closed ? <small className="cm-action-footnote">This ticket is resolved. The citizen notification history is now the source of truth for closure communication.</small> : null}
        {!selectedItem.closed && !canAct ? <small className="cm-action-footnote">This ticket is visible to CM Cell but is not CMCell-primary yet. Use the primary queue owner until escalation reaches CM Cell.</small> : null}
        {actionNotice ? <small className="cm-action-notice success">{actionNotice}</small> : null}
        {actionError ? <small className="cm-action-notice error">{actionError}</small> : null}
      </div>
    </section>
  );
}

function MinistryAccountability({
  selectedMinistry,
  setSelectedMinistry,
}: {
  selectedMinistry: string;
  setSelectedMinistry: (ministry: string) => void;
}) {
  return (
    <section className="cm-ministry-card">
      <div className="cm-section-heading">
        <div>
          <span>Ministry accountability</span>
          <h2>Who owns the delay?</h2>
        </div>
        <Building2 size={22} />
      </div>
      <div className="cm-ministry-table">
        <div className="cm-ministry-head">
          <span>Ministry</span>
          <span>Breached</span>
          <span>At CM</span>
          <span>Overdue response</span>
          <span>Status</span>
        </div>
        {ministryMetrics.map((item) => {
          const breachRate = Math.round((item.breached / item.open) * 100);
          return (
            <button
              className={`cm-ministry-row ${selectedMinistry === item.ministry ? "active" : ""}`}
              key={item.ministry}
              onClick={() => setSelectedMinistry(item.ministry)}
              type="button"
            >
              <span>
                <strong>{item.ministry}</strong>
                <small>
                  {formatNumber(item.open)} open | {breachRate}% breach
                </small>
              </span>
              <span>{formatNumber(item.breached)}</span>
              <span>{formatNumber(item.cmEscalated)}</span>
              <span>{formatNumber(item.responseOverdue)}</span>
              <span className={`cm-status-pill ${item.directiveStatus.toLowerCase()}`}>{item.directiveStatus}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GuardrailPanel() {
  return (
    <section className="cm-guard-card">
      <div className="cm-section-heading">
        <div>
          <span>Protected and audit guardrails</span>
          <h2>Do not lose citizen trust</h2>
        </div>
        <ShieldAlert size={22} />
      </div>
      <div className="cm-guard-list">
        {auditSignals.map((item) => (
          <div key={item.label}>
            <strong>{formatNumber(item.value)}</strong>
            <span>{item.label}</span>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function CommandBrief({
  briefRun,
  selectedDistrict,
  selectedMinistry,
}: {
  briefRun: DashboardBriefRunDto | null;
  selectedDistrict: string;
  selectedMinistry: string;
}) {
  const brief = briefRun?.brief;
  const focusItems = brief?.focusAreas.slice(0, 2) ?? [];
  const action = brief?.recommendedActions[0];

  return (
    <section className="cm-brief-card">
      <div className="cm-portrait">
        <img alt="Neutral service illustration" src={ASSETS.portrait} />
        <div>
          <span>{brief ? `${brief.riskLevel} recommend-only brief` : "CM Cell operating question"}</span>
          <strong>{brief?.headline ?? "Where should the state intervene today?"}</strong>
        </div>
      </div>
      <div className="cm-brief-list">
        {focusItems.length ? (
          focusItems.map((item, index) => (
            <div key={item.label}>
              {index === 0 ? <Flame size={18} /> : <Landmark size={18} />}
              <span>
                <strong>{item.value}</strong> · {item.detail}
              </span>
            </div>
          ))
        ) : (
          <>
            <div>
              <Flame size={18} />
              <span>{selectedDistrict} is the active geography.</span>
            </div>
            <div>
              <Landmark size={18} />
              <span>{selectedMinistry} is the active accountability lane.</span>
            </div>
          </>
        )}
        <div>
          <RadioTower size={18} />
          <span>{action ? `${action.label}: ${action.reason}` : "Every CM-escalated ticket keeps ministry as secondary owner."}</span>
        </div>
        {brief ? (
          <div>
            <ShieldCheck size={18} />
            <span>{brief.nonMutationGuarantee}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CmSectionMenu({
  active,
  setActive,
}: {
  active: CmSection;
  setActive: (section: CmSection) => void;
}) {
  return (
    <nav aria-label="CM Cell dashboard sections" className="cm-menu-list">
      {cmMenuItems.map((item) => (
        <button className={active === item.id ? "active" : ""} data-section={item.id} key={item.id} onClick={() => setActive(item.id)} type="button">
          <strong>{item.label}</strong>
          <span>{item.detail}</span>
        </button>
      ))}
    </nav>
  );
}

function SectionIntro({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <section className="cm-section-intro">
      <div>
        <span className="cm-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
      <div className="cm-search">
        <Search size={17} />
        <span>Search ticket, district, ministry...</span>
      </div>
    </section>
  );
}

function OverviewCommandSummary({
  decisionItems,
  status,
  selectedDecision,
  selectedDistrict,
  selectedMinistry,
}: {
  decisionItems: DecisionItem[];
  status: ReturnType<typeof commandStatus>;
  selectedDecision: string;
  selectedDistrict: string;
  selectedMinistry: string;
}) {
  const activeTicket = decisionItems.find((item) => item.id === selectedDecision) ?? decisionItems[0] ?? decisionQueue[0];
  const activeMinistry = ministryMetrics.find((item) => item.ministry === selectedMinistry) ?? ministryMetrics[0];
  const liveSizedStatus = status.open < 1000;
  const ministryRiskLabel = liveSizedStatus
    ? status.redMinistries > 0
      ? "Watch status"
      : status.cmEscalated > 0
        ? "Low escalation brief"
        : "Low status"
    : `${activeMinistry.directiveStatus} status`;
  const ministryRiskDetail = liveSizedStatus
    ? `${formatNumber(status.cmEscalated)} CM Cell ticket(s), ${formatNumber(status.breached)} SLA breach(es), and ${formatNumber(status.dueToday)} due today in the live command view.`
    : `${formatNumber(activeMinistry.responseOverdue)} responses are overdue under this selected ministry lane.`;

  return (
    <section className="cm-overview-summary">
      <div className="cm-section-heading">
        <div>
          <span>Executive readout</span>
          <h2>What needs CM Cell attention?</h2>
        </div>
        <Eye size={22} />
      </div>
      <div className="cm-overview-cards">
        <div>
          <span>State pressure</span>
          <strong>{formatNumber(status.breached)} SLA breaches</strong>
          <small>{status.redDistricts} districts are in red, with {formatNumber(status.cmEscalated)} tickets already sitting at CM Cell level.</small>
        </div>
        <div>
          <span>Active drilldown</span>
          <strong>{selectedDistrict}</strong>
          <small>{selectedMinistry} is the current accountability lane for the command view.</small>
        </div>
        <div>
          <span>Ministry risk</span>
          <strong>{ministryRiskLabel}</strong>
          <small>{ministryRiskDetail}</small>
        </div>
        <div>
          <span>Next decision</span>
          <strong>{activeTicket.id}</strong>
          <small>{activeTicket.ask}</small>
        </div>
      </div>
    </section>
  );
}

function TicketFilterPanel() {
  return (
    <section className="cm-ticket-filter-card">
      <div className="cm-section-heading">
        <div>
          <span>Ticket queue filter</span>
          <h2>Default: CMCell</h2>
        </div>
        <FileWarning size={22} />
      </div>
      <div className="cm-filter-pills">
        <span className="active">Primary queue: CM Cell</span>
        <span>SLA breached</span>
        <span>Escalated from ministry</span>
        <span>Protected allowed</span>
      </div>
      <p>
        CM Cell is the primary queue; ministries stay visible as secondary owners.
      </p>
    </section>
  );
}

function RejectionReviewPanel({
  tickets,
  selected,
  setSelected,
  mode,
  note,
  busy,
  notice,
  error,
  setMode,
  setNote,
  onSubmit,
}: {
  tickets: DashboardTicketDto[];
  selected: string;
  setSelected: (id: string) => void;
  mode: RejectionReviewMode;
  note: string;
  busy: boolean;
  notice: string | null;
  error: string | null;
  setMode: (mode: RejectionReviewMode) => void;
  setNote: (value: string) => void;
  onSubmit: () => void;
}) {
  const selectedTicket = tickets.find((ticket) => ticket.id === selected) ?? tickets[0] ?? null;
  const copy = rejectionReviewCopy[mode];

  return (
    <section className="cm-rejection-card">
      <div className="cm-section-heading">
        <div>
          <span>Rejection review</span>
          <h2>Prevent suppression</h2>
        </div>
        <RotateCcw size={22} />
      </div>

      {tickets.length === 0 ? (
        <div className="cm-empty-review">
          <strong>No rejected tickets in CM review</strong>
          <small>Rejected cases will appear here after verification sends them to CM-maintained review.</small>
          {notice ? <small className="cm-action-notice success">{notice}</small> : null}
          {error ? <small className="cm-action-notice error">{error}</small> : null}
        </div>
      ) : (
        <>
          <div className="cm-rejection-list">
            {tickets.map((ticket) => (
              <button className={selectedTicket?.id === ticket.id ? "active" : ""} key={ticket.id} onClick={() => setSelected(ticket.id)} type="button">
                <span>{ticket.id}</span>
                <strong>{ticket.title}</strong>
                <small>
                  {ticket.district} | {ticket.primaryQueue.ownerLabel}
                </small>
              </button>
            ))}
          </div>

          <div className="cm-rejection-workbench">
            <span>{selectedTicket?.id}</span>
            <strong>{selectedTicket?.title}</strong>
            <small>{copy.detail}</small>
            <div className="cm-rejection-actions">
              {(Object.keys(rejectionReviewCopy) as RejectionReviewMode[]).map((nextMode) => {
                const nextCopy = rejectionReviewCopy[nextMode];
                const Icon = nextCopy.icon;
                return (
                  <button className={mode === nextMode ? "active" : ""} disabled={busy} key={nextMode} onClick={() => setMode(nextMode)} type="button">
                    <Icon size={14} />
                    {nextCopy.label}
                  </button>
                );
              })}
            </div>
            <textarea disabled={busy} onChange={(event) => setNote(event.target.value)} rows={2} value={note} />
            <button className="cm-submit-review" disabled={!selectedTicket || busy} onClick={onSubmit} type="button">
              {busy ? "Saving review..." : copy.label}
            </button>
            {notice ? <small className="cm-action-notice success">{notice}</small> : null}
            {error ? <small className="cm-action-notice error">{error}</small> : null}
          </div>
        </>
      )}
    </section>
  );
}

export default function CmCellMockup() {
  const { geoJson, loadState } = useDistrictGeoJson();
  const [dashboard, setDashboard] = useState<RoleDashboardDto | null>(null);
  const [briefRun, setBriefRun] = useState<DashboardBriefRunDto | null>(null);
  const [dashboardState, setDashboardState] = useState<"live" | "mock" | "offline">("mock");
  const [dashboardVersion, setDashboardVersion] = useState(0);
  const [activeSection, setActiveSection] = useState<CmSection>("overview");
  const [metricMode, setMetricMode] = useState<MetricMode>("breach");
  const [selectedDistrict, setSelectedDistrict] = useState("Chennai");
  const [selectedMinistry, setSelectedMinistry] = useState("Municipal Administration & Water Supply");
  const [selectedDecision, setSelectedDecision] = useState(decisionQueue[0].id);
  const [cmActionMode, setCmActionMode] = useState<CmActionMode>("directive");
  const [cmActionNote, setCmActionNote] = useState("CM Cell directs the ministry secretary to submit field proof and closure plan before the next command review.");
  const [cmActionBusy, setCmActionBusy] = useState(false);
  const [cmActionNotice, setCmActionNotice] = useState<string | null>(null);
  const [cmActionError, setCmActionError] = useState<string | null>(null);
  const [selectedRejection, setSelectedRejection] = useState("");
  const [rejectionReviewMode, setRejectionReviewMode] = useState<RejectionReviewMode>("overturn_and_route");
  const [rejectionReviewNote, setRejectionReviewNote] = useState("CM review found this issue should not be closed; restore it to the local owner with oversight retained.");
  const [rejectionReviewBusy, setRejectionReviewBusy] = useState(false);
  const [rejectionReviewNotice, setRejectionReviewNotice] = useState<string | null>(null);
  const [rejectionReviewError, setRejectionReviewError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchRoleDashboard({ role: "cm_cell" }, controller.signal, {
      role: "cm_cell",
      actor: "cm_cell:prototype",
    })
      .then((nextDashboard) => {
        setDashboard(nextDashboard);
        setDashboardState("live");
      })
      .catch(() => {
        if (!controller.signal.aborted) setDashboardState("offline");
      });
    generateDashboardBrief({ role: "cm_cell" }, controller.signal, {
      role: "cm_cell",
      actor: "cm_cell:prototype",
    })
      .then(setBriefRun)
      .catch(() => {
        if (!controller.signal.aborted) setBriefRun(null);
      });
    return () => controller.abort();
  }, [dashboardVersion]);

  const districts = useMemo(() => {
    const names = geoJson?.features.map(districtName).filter(Boolean) ?? fallbackDistricts;
    return names.map((district, index) => createDistrictMetric(district, index));
  }, [geoJson]);

  const status = statusFromDashboard(commandStatus(districts), dashboard);
  const decisionItems = useMemo(() => decisionItemsFromDashboard(dashboard), [dashboard]);
  const selectedDecisionItem = decisionItems.find((item) => item.id === selectedDecision) ?? decisionItems[0] ?? null;
  const selectedPatternTicket: SelectedTicketSummary | undefined = selectedDecisionItem
    ? {
        id: selectedDecisionItem.id,
        title: selectedDecisionItem.title,
        owner: selectedDecisionItem.ministry,
        status: selectedDecisionItem.status,
      }
    : undefined;
  const rejectionReviewTickets = useMemo(
    () => dashboard?.tickets.filter((ticket) => ticket.primaryQueue.kind === "rejection_review" || ticket.status === "rejected") ?? [],
    [dashboard],
  );

  useEffect(() => {
    if (!decisionItems.some((item) => item.id === selectedDecision)) setSelectedDecision(decisionItems[0]?.id ?? decisionQueue[0].id);
  }, [decisionItems, selectedDecision]);

  useEffect(() => {
    if (!rejectionReviewTickets.length) {
      if (selectedRejection) setSelectedRejection("");
      return;
    }
    if (!rejectionReviewTickets.some((ticket) => ticket.id === selectedRejection)) setSelectedRejection(rejectionReviewTickets[0].id);
  }, [rejectionReviewTickets, selectedRejection]);

  useEffect(() => {
    setCmActionNotice(null);
    setCmActionError(null);
  }, [selectedDecision, cmActionMode]);

  useEffect(() => {
    if (selectedRejection) {
      setRejectionReviewNotice(null);
      setRejectionReviewError(null);
    }
  }, [selectedRejection, rejectionReviewMode]);

  async function submitCmCellAction() {
    const selectedItem = decisionItems.find((item) => item.id === selectedDecision);
    if (!selectedItem?.actionPrimary || selectedItem.closed) return;
    setCmActionBusy(true);
    setCmActionNotice(null);
    setCmActionError(null);
    const actor = "cm_cell:prototype";
    const note = cmActionNote.trim() || cmActionCopy[cmActionMode].detail;
    const safeTicketId = selectedItem.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket";
    const visitAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    let action: FieldActionRequest;

    if (cmActionMode === "ministry_response") {
      action = {
        action: "schedule_visit",
        actor,
        fieldOfficer: `${selectedItem.ministry} secretary response cell`,
        visitAt,
        note,
      };
    } else if (cmActionMode === "resolve") {
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
            label: "closure",
            fileName: `${safeTicketId}-cm-cell-closure-proof.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: 860_000,
          },
        ],
      };
    } else if (cmActionMode === "audit_note") {
      action = {
        action: "add_field_report",
        actor,
        fieldOfficer: "CM Cell Command Desk",
        note,
      };
    } else {
      action = {
        action: "add_field_report",
        actor,
        fieldOfficer: "CM Cell Command Desk",
        note,
        evidence: [
          {
            label: "field_report",
            fileName: `${safeTicketId}-cm-cell-directive.txt`,
            mimeType: "text/plain",
            sizeBytes: Math.max(180, note.length * 2),
          },
        ],
      };
    }

    try {
      await submitFieldAction(selectedItem.id, action, { role: "cm_cell", actor });
      setCmActionNotice(`${cmActionCopy[cmActionMode].label} saved for ${selectedItem.id}. Dashboard refreshed.`);
      setDashboardVersion((version) => version + 1);
    } catch (error) {
      setCmActionError(error instanceof Error ? error.message : "CM Cell action could not be saved.");
    } finally {
      setCmActionBusy(false);
    }
  }

  async function submitRejectionReview() {
    const ticket = rejectionReviewTickets.find((item) => item.id === selectedRejection);
    if (!ticket) return;
    setRejectionReviewBusy(true);
    setRejectionReviewNotice(null);
    setRejectionReviewError(null);
    const actor = "cm_cell:prototype";
    const note = rejectionReviewNote.trim() || rejectionReviewCopy[rejectionReviewMode].detail;
    let action: RejectionReviewActionRequest;

    if (rejectionReviewMode === "request_info") {
      action = {
        action: "request_info",
        actor,
        reason: note,
        missingFields: ["Exact street", "Nearest landmark"],
        citizenMessage: "CM review found this may be valid. Please add the exact street and nearest landmark so we can route it.",
      };
    } else if (rejectionReviewMode === "uphold_rejection") {
      action = {
        action: "uphold_rejection",
        actor,
        reason: note,
        closureNote: note,
      };
    } else {
      const safeDistrict = ticket.district.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "district";
      action = {
        action: "overturn_and_route",
        actor,
        reason: note,
        ownerKey: `local:${safeDistrict}`,
        ownerLabel: `${ticket.district} Local Field Team`,
        scopeValue: ticket.district,
      };
    }

    try {
      await submitRejectionReviewAction(ticket.id, action, { role: "cm_cell", actor });
      setRejectionReviewNotice(`${rejectionReviewCopy[rejectionReviewMode].label} saved for ${ticket.id}.`);
      setDashboardVersion((version) => version + 1);
    } catch (caught) {
      setRejectionReviewError(caught instanceof Error ? caught.message : "Rejection review action could not be saved.");
    } finally {
      setRejectionReviewBusy(false);
    }
  }

  return (
    <div className="cm-app">
      <Header />

      <main className="cm-main">
        <CmSectionMenu active={activeSection} setActive={setActiveSection} />

        <div className={`cm-content-panel cm-page-${activeSection}`}>
          {activeSection === "overview" && (
            <>
              <SectionIntro
                body="One screen for the CM Cell to see district pressure, ministry accountability, protected complaints, and escalation decisions that need state intervention."
                eyebrow="State Command Center"
                title="CM Cell intervention view"
              />

              <section className="cm-kpi-grid">
                <CommandKpi icon={AlertTriangle} label="SLA breached" note={`${status.redDistricts} districts in red`} value={formatNumber(status.breached)} />
                <CommandKpi icon={Landmark} label="At CM Cell" note="Primary queue with CM Cell" value={formatNumber(status.cmEscalated)} />
                <CommandKpi icon={Building2} label="Ministries in red" note="Needs secretary response" value={String(status.redMinistries)} />
                <CommandKpi icon={TimerReset} label="Due today" note="Before midnight review" tone="amber" value={formatNumber(status.dueToday)} />
                <CommandKpi icon={LockKeyhole} label="Protected corruption" note="Masked outside protected cell" value={formatNumber(status.protectedCount)} />
                <CommandKpi icon={Megaphone} label="Directive pending" note="Awaiting CM Cell order" tone="dark" value={formatNumber(status.directives)} />
              </section>

              <RolePatternSummary pattern={roleConsolePatterns.cm_cell} selectedTicket={selectedPatternTicket} />

              <section className="cm-overview-grid">
                <OverviewCommandSummary
                  decisionItems={decisionItems}
                  selectedDecision={selectedDecision}
                  selectedDistrict={selectedDistrict}
                  selectedMinistry={selectedMinistry}
                  status={status}
                />
                <CommandBrief briefRun={briefRun} selectedDistrict={selectedDistrict} selectedMinistry={selectedMinistry} />
              </section>
            </>
          )}

          {activeSection === "heatmap" && (
            <>
              <SectionIntro
                body="District-level operating picture for where SLA breaches, CM escalations, protected cases, and average ticket age are building pressure."
                eyebrow="State heatmap"
                title="District pressure and SLA risk"
              />
              <section className="cm-command-grid">
                <div className="cm-left-stack">
                  <StateHeatmap
                    geoJson={geoJson}
                    loadState={loadState}
                    metricMode={metricMode}
                    metrics={districts}
                    selectedDistrict={selectedDistrict}
                    setMetricMode={setMetricMode}
                    setSelectedDistrict={setSelectedDistrict}
                  />
                </div>

                <div className="cm-right-stack">
                  <DistrictCommandPanel district={selectedDistrict} metrics={districts} selectedMinistry={selectedMinistry} />
                  <CommandBrief briefRun={briefRun} selectedDistrict={selectedDistrict} selectedMinistry={selectedMinistry} />
                </div>
              </section>
            </>
          )}

          {activeSection === "ministry" && (
            <>
              <SectionIntro
                body="Ministry-level accountability view for spotting owners, delayed responses, red lanes, and departments that need a directive."
                eyebrow="Ministry accountability"
                title="Who owns the delay?"
              />
              <section className="cm-bottom-grid">
                <MinistryAccountability selectedMinistry={selectedMinistry} setSelectedMinistry={setSelectedMinistry} />
                <div className="cm-right-stack">
                  <CommandBrief briefRun={briefRun} selectedDistrict={selectedDistrict} selectedMinistry={selectedMinistry} />
                  <GuardrailPanel />
                </div>
              </section>
            </>
          )}

          {activeSection === "tickets" && (
            <>
              <SectionIntro
                body="Escalated ticket workspace opened with CMCell as the default primary queue filter, while ministries remain visible as secondary accountability owners."
                eyebrow="Tickets"
                title="CMCell ticket queue"
              />
              <section className="cm-tickets-grid">
                <div className="cm-left-stack">
                  <TicketFilterPanel />
                  <DecisionQueue
                    actionBusy={cmActionBusy}
                    actionError={cmActionError}
                    actionMode={cmActionMode}
                    actionNote={cmActionNote}
                    actionNotice={cmActionNotice}
                    items={decisionItems}
                    onSubmitAction={submitCmCellAction}
                    selected={selectedDecision}
                    selectedPatternTicket={selectedPatternTicket}
                    setActionMode={setCmActionMode}
                    setActionNote={setCmActionNote}
                    setSelected={setSelectedDecision}
                  />
                </div>
                <div className="cm-right-stack">
                  <DistrictCommandPanel district={selectedDistrict} metrics={districts} selectedMinistry={selectedMinistry} />
                  <RejectionReviewPanel
                    busy={rejectionReviewBusy}
                    error={rejectionReviewError}
                    mode={rejectionReviewMode}
                    note={rejectionReviewNote}
                    notice={rejectionReviewNotice}
                    onSubmit={submitRejectionReview}
                    selected={selectedRejection}
                    setMode={setRejectionReviewMode}
                    setNote={setRejectionReviewNote}
                    setSelected={setSelectedRejection}
                    tickets={rejectionReviewTickets}
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      <div className="cm-mode-banner">
        <Sparkles size={16} />
        <span>{dashboardState === "live" ? "CM Cell mockup: reading live MVP ticket-spine sample data." : "CM Cell mockup: using local prototype data until the MVP API is reachable."}</span>
      </div>
    </div>
  );
}
