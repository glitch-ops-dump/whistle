import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileWarning,
  Gauge,
  Landmark,
  MapPin,
  RadioTower,
  Search,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  fetchRoleDashboard,
  generateDashboardBrief,
  hoursUntil,
  submitFieldAction,
  type DashboardBriefRunDto,
  type DashboardTicketDto,
  type FieldActionRequest,
  type RoleDashboardDto,
} from "./govDashboardApi";

type MinistrySection = "overview" | "districts" | "queue" | "field";
type MinistryMetricMode = "breach" | "risk" | "age" | "open";
type MinistryActionMode = "directive" | "request_evidence" | "resolve";

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

type DistrictOpsMetric = {
  district: string;
  open: number;
  breached: number;
  due48h: number;
  cmRisk: number;
  resolvedWeek: number;
  avgAge: number;
  fieldTeams: number;
  escalationRate: number;
  leadOwner: string;
  bottleneck: string;
};

type MinistryTicket = {
  id: string;
  title: string;
  district: string;
  source: string;
  stage: string;
  ownerStage: "verification" | "local" | "ministry" | "cm_cell";
  hoursLeft: number;
  owner: string;
  ask: string;
};

type FieldAction = {
  district: string;
  action: string;
  owner: string;
  target: string;
  status: "On track" | "At risk" | "Blocked";
};

type PortfolioId = "maws" | "rural" | "food";

type AssignedPortfolio = {
  id: PortfolioId;
  ministry: string;
  shortName: string;
  controlRoomTitle: string;
  focus: string;
  accessNote: string;
  seedOffset: number;
  loadFactor: number;
  queueLabel: string;
  ownerPrimary: [string, string, string];
  bottlenecks: [string, string, string, string];
  districtOverrides: Record<string, Partial<DistrictOpsMetric>>;
  tickets: MinistryTicket[];
  fieldActions: FieldAction[];
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

const defaultPortfolioId: PortfolioId = "maws";
const mockMinisterName = "Thiru. K. Arulmozhi Selvan";

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

const sectionItems: Array<{ id: MinistrySection; label: string; detail: string }> = [
  { id: "overview", label: "Overview", detail: "Ministry control room" },
  { id: "districts", label: "Districts", detail: "SLA heatmap" },
  { id: "queue", label: "SLA queue", detail: "Primary ministry tickets" },
  { id: "field", label: "Field action", detail: "Directives and teams" },
];

const ministryActionCopy: Record<MinistryActionMode, { label: string; detail: string; icon: LucideIcon }> = {
  directive: {
    label: "Issue directive",
    detail: "Record a ministry directive, owner instruction, and escalation-prevention note.",
    icon: ClipboardCheck,
  },
  request_evidence: {
    label: "Request field evidence",
    detail: "Schedule a district field proof update so closure can be verified.",
    icon: FileWarning,
  },
  resolve: {
    label: "Resolve with proof",
    detail: "Close a primary ministry ticket with checklist and closure evidence.",
    icon: CheckCircle2,
  },
};

const districtOverrides: Record<string, Partial<DistrictOpsMetric>> = {
  Chennai: {
    open: 4760,
    breached: 820,
    due48h: 620,
    cmRisk: 188,
    resolvedWeek: 1130,
    avgAge: 8.8,
    fieldTeams: 18,
    escalationRate: 14,
    leadOwner: "Greater Chennai Corporation",
    bottleneck: "Sewer desilting crew availability",
  },
  Madurai: {
    open: 3120,
    breached: 610,
    due48h: 390,
    cmRisk: 126,
    resolvedWeek: 760,
    avgAge: 8.1,
    fieldTeams: 11,
    escalationRate: 12,
    leadOwner: "Madurai Corporation",
    bottleneck: "School-zone sewage overflow cluster",
  },
  Coimbatore: {
    open: 2840,
    breached: 430,
    due48h: 310,
    cmRisk: 94,
    resolvedWeek: 820,
    avgAge: 6.6,
    fieldTeams: 14,
    escalationRate: 8,
    leadOwner: "Coimbatore Corporation",
    bottleneck: "Water quality lab turnaround",
  },
  Tiruchirappalli: {
    open: 2250,
    breached: 360,
    due48h: 240,
    cmRisk: 82,
    resolvedWeek: 610,
    avgAge: 7.2,
    fieldTeams: 9,
    escalationRate: 9,
    leadOwner: "Trichy Corporation",
    bottleneck: "Pump station repair approvals",
  },
  Salem: {
    open: 2180,
    breached: 330,
    due48h: 255,
    cmRisk: 76,
    resolvedWeek: 590,
    avgAge: 6.9,
    fieldTeams: 8,
    escalationRate: 7,
    leadOwner: "Salem Corporation",
    bottleneck: "Contractor reassignment delay",
  },
  Thiruvallur: {
    open: 2520,
    breached: 520,
    due48h: 360,
    cmRisk: 108,
    resolvedWeek: 570,
    avgAge: 8.4,
    fieldTeams: 10,
    escalationRate: 13,
    leadOwner: "District Municipal Office",
    bottleneck: "Urban panchayat tanker routing",
  },
};

const ministryTickets: MinistryTicket[] = [
  {
    id: "MAWS-26-1184",
    title: "Sewage overflow outside corporation school",
    district: "Madurai",
    source: "Escalated from MLA office",
    stage: "Ministry primary queue",
    ownerStage: "ministry",
    hoursLeft: -18,
    owner: "Madurai Corporation Commissioner",
    ask: "Approve 48-hour jetting crew and publish field closure note",
  },
  {
    id: "MAWS-26-1162",
    title: "Drinking water contamination cluster",
    district: "Coimbatore",
    source: "Verification team",
    stage: "Lab evidence pending",
    ownerStage: "ministry",
    hoursLeft: 9,
    owner: "TWAD district engineer",
    ask: "Attach water sample result and alternate supply plan",
  },
  {
    id: "MAWS-26-1131",
    title: "Storm-water drain blockage causing road flooding",
    district: "Chennai",
    source: "Councillor secondary queue",
    stage: "Field crew assigned",
    ownerStage: "ministry",
    hoursLeft: 16,
    owner: "Zone 10 assistant engineer",
    ask: "Confirm desilting completion before 6 PM review",
  },
  {
    id: "MAWS-26-1098",
    title: "Street tap dry for six days",
    district: "Thiruvallur",
    source: "Citizen resubmitted info",
    stage: "Ministry action needed",
    ownerStage: "ministry",
    hoursLeft: -6,
    owner: "Town panchayat executive officer",
    ask: "Route tanker schedule and permanent line repair date",
  },
  {
    id: "MAWS-26-1039",
    title: "Garbage transfer point overflowing near market",
    district: "Salem",
    source: "Local body queue",
    stage: "Due soon",
    ownerStage: "ministry",
    hoursLeft: 22,
    owner: "Sanitation field inspector",
    ask: "Upload before/after evidence and disposal log",
  },
  {
    id: "MAWS-26-1016",
    title: "Pump station outage affecting two wards",
    district: "Tiruchirappalli",
    source: "District collector review",
    stage: "Awaiting parts",
    ownerStage: "ministry",
    hoursLeft: 31,
    owner: "Metro water operations lead",
    ask: "Approve emergency procurement note",
  },
];

const fieldActions: FieldAction[] = [
  {
    district: "Madurai",
    action: "Deploy sewer jetting unit to school cluster",
    owner: "Commissioner + district engineer",
    target: "Today 6 PM",
    status: "At risk",
  },
  {
    district: "Chennai",
    action: "Close 120 long-pending storm drain tickets",
    owner: "Corporation zonal teams",
    target: "48h",
    status: "On track",
  },
  {
    district: "Thiruvallur",
    action: "Publish tanker schedule for dry street-tap pockets",
    owner: "Town panchayat directorate",
    target: "Tomorrow noon",
    status: "Blocked",
  },
  {
    district: "Coimbatore",
    action: "Complete water sample tests for contamination complaints",
    owner: "TWAD lab officer",
    target: "24h",
    status: "On track",
  },
  {
    district: "Tiruchirappalli",
    action: "Approve pump station spare-parts exception",
    owner: "Ministry procurement cell",
    target: "Today",
    status: "At risk",
  },
];

const ruralDistrictOverrides: Record<string, Partial<DistrictOpsMetric>> = {
  Thanjavur: {
    open: 3380,
    breached: 690,
    due48h: 510,
    cmRisk: 142,
    resolvedWeek: 730,
    avgAge: 8.5,
    fieldTeams: 15,
    escalationRate: 13,
    leadOwner: "District rural development agency",
    bottleneck: "Village road repair estimates pending",
  },
  Villupuram: {
    open: 3160,
    breached: 660,
    due48h: 480,
    cmRisk: 134,
    resolvedWeek: 680,
    avgAge: 8.2,
    fieldTeams: 13,
    escalationRate: 12,
    leadOwner: "Block development officers",
    bottleneck: "Panchayat sanitation crew availability",
  },
  Dharmapuri: {
    open: 2680,
    breached: 510,
    due48h: 360,
    cmRisk: 104,
    resolvedWeek: 590,
    avgAge: 7.7,
    fieldTeams: 10,
    escalationRate: 11,
    leadOwner: "Panchayat union commissioner",
    bottleneck: "Rural water supply material delay",
  },
};

const foodDistrictOverrides: Record<string, Partial<DistrictOpsMetric>> = {
  Chennai: {
    open: 3890,
    breached: 740,
    due48h: 560,
    cmRisk: 152,
    resolvedWeek: 910,
    avgAge: 7.9,
    fieldTeams: 16,
    escalationRate: 12,
    leadOwner: "Civil supplies regional manager",
    bottleneck: "Fair price shop stock reconciliation",
  },
  Tirunelveli: {
    open: 2840,
    breached: 520,
    due48h: 390,
    cmRisk: 116,
    resolvedWeek: 650,
    avgAge: 7.4,
    fieldTeams: 11,
    escalationRate: 10,
    leadOwner: "District supply officer",
    bottleneck: "Biometric exception approvals",
  },
  Cuddalore: {
    open: 2520,
    breached: 460,
    due48h: 330,
    cmRisk: 96,
    resolvedWeek: 570,
    avgAge: 6.8,
    fieldTeams: 9,
    escalationRate: 9,
    leadOwner: "Taluk supply inspectors",
    bottleneck: "Rice quality replacement logistics",
  },
};

const ruralTickets: MinistryTicket[] = [
  {
    id: "RDP-26-0914",
    title: "Village road washed out after rain",
    district: "Thanjavur",
    source: "Escalated from MLA office",
    stage: "Ministry primary queue",
    ownerStage: "ministry",
    hoursLeft: -14,
    owner: "District rural development engineer",
    ask: "Approve emergency patch work and publish contractor mobilization note",
  },
  {
    id: "RDP-26-0872",
    title: "Panchayat drain overflow near health sub-centre",
    district: "Villupuram",
    source: "Verification team",
    stage: "Block office action needed",
    ownerStage: "ministry",
    hoursLeft: 7,
    owner: "Block development officer",
    ask: "Assign sanitation crew and upload cleaned drain evidence",
  },
  {
    id: "RDP-26-0821",
    title: "Rural drinking water motor failed",
    district: "Dharmapuri",
    source: "Citizen resubmitted info",
    stage: "Material approval pending",
    ownerStage: "ministry",
    hoursLeft: -5,
    owner: "Panchayat union engineer",
    ask: "Clear replacement motor approval and tanker bridge plan",
  },
  {
    id: "RDP-26-0797",
    title: "Street lights out on panchayat main road",
    district: "Krishnagiri",
    source: "Councillor secondary queue",
    stage: "Due soon",
    ownerStage: "ministry",
    hoursLeft: 18,
    owner: "Village panchayat secretary",
    ask: "Confirm EB coordination and fixture replacement date",
  },
  {
    id: "RDP-26-0755",
    title: "MGNREGS worksite wage grievance unresolved",
    district: "Ramanathapuram",
    source: "District collector review",
    stage: "Finance reconciliation",
    ownerStage: "ministry",
    hoursLeft: 28,
    owner: "DRDA programme officer",
    ask: "Attach wage payment correction note",
  },
];

const ruralFieldActions: FieldAction[] = [
  {
    district: "Thanjavur",
    action: "Mobilize road patch crew for washed-out village stretch",
    owner: "DRDA engineer + contractor",
    target: "Today 7 PM",
    status: "At risk",
  },
  {
    district: "Villupuram",
    action: "Close drain overflow cluster around health sub-centres",
    owner: "Block development officers",
    target: "48h",
    status: "On track",
  },
  {
    district: "Dharmapuri",
    action: "Authorize emergency motor procurement for rural water scheme",
    owner: "Panchayat union engineer",
    target: "Tomorrow noon",
    status: "Blocked",
  },
  {
    district: "Krishnagiri",
    action: "Complete panchayat street light night audit",
    owner: "Village panchayat secretaries",
    target: "24h",
    status: "On track",
  },
];

const foodTickets: MinistryTicket[] = [
  {
    id: "FCS-26-1442",
    title: "Fair price shop rice stock unavailable for three days",
    district: "Chennai",
    source: "Escalated from MLA office",
    stage: "Ministry primary queue",
    ownerStage: "ministry",
    hoursLeft: -10,
    owner: "Regional civil supplies manager",
    ask: "Authorize stock transfer and publish shop-level replenishment note",
  },
  {
    id: "FCS-26-1396",
    title: "Biometric failure blocking elderly ration access",
    district: "Tirunelveli",
    source: "Verification team",
    stage: "Exception approval pending",
    ownerStage: "ministry",
    hoursLeft: 5,
    owner: "District supply officer",
    ask: "Enable manual exception window and notify affected cardholders",
  },
  {
    id: "FCS-26-1348",
    title: "Poor rice quality reported across PDS cluster",
    district: "Cuddalore",
    source: "Citizen evidence reviewed",
    stage: "Quality replacement needed",
    ownerStage: "ministry",
    hoursLeft: -3,
    owner: "Taluk supply inspector",
    ask: "Replace stock batch and upload depot inspection note",
  },
  {
    id: "FCS-26-1289",
    title: "Kerosene entitlement mismatch in coastal villages",
    district: "Nagapattinam",
    source: "Local owner secondary queue",
    stage: "Due soon",
    ownerStage: "ministry",
    hoursLeft: 21,
    owner: "Assistant commissioner civil supplies",
    ask: "Reconcile card list and correct entitlement mapping",
  },
  {
    id: "FCS-26-1240",
    title: "Shop closed during notified distribution hours",
    district: "Vellore",
    source: "District flying squad",
    stage: "Show-cause response",
    ownerStage: "ministry",
    hoursLeft: 30,
    owner: "Taluk supply officer",
    ask: "Record inspection action and citizen update",
  },
];

const foodFieldActions: FieldAction[] = [
  {
    district: "Chennai",
    action: "Transfer buffer stock to shops with three-day rice outage",
    owner: "Regional civil supplies manager",
    target: "Today 5 PM",
    status: "At risk",
  },
  {
    district: "Tirunelveli",
    action: "Open biometric exception window for elderly cardholders",
    owner: "District supply officer",
    target: "Today",
    status: "On track",
  },
  {
    district: "Cuddalore",
    action: "Replace flagged rice batch and inspect depot records",
    owner: "Taluk supply inspectors",
    target: "24h",
    status: "Blocked",
  },
  {
    district: "Nagapattinam",
    action: "Correct coastal entitlement mismatch list",
    owner: "Assistant commissioner civil supplies",
    target: "48h",
    status: "On track",
  },
];

const assignedPortfolios: AssignedPortfolio[] = [
  {
    id: "maws",
    ministry: "Municipal Administration & Water Supply",
    shortName: "MAWS",
    controlRoomTitle: "Water and urban services control room",
    focus: "Urban water, drainage, sanitation, and municipal civic services",
    accessNote: "Minister portfolio 1 of 3. No other ministries are visible.",
    seedOffset: 0,
    loadFactor: 1,
    queueLabel: "Primary: MAWS",
    ownerPrimary: ["Municipal commissioner", "District municipal office", "TWAD district engineer"],
    bottlenecks: ["Field evidence pending", "Contract crew capacity", "Material approval", "Local body response lag"],
    districtOverrides,
    tickets: ministryTickets,
    fieldActions,
  },
  {
    id: "rural",
    ministry: "Rural Development & Panchayat Raj",
    shortName: "Rural Development",
    controlRoomTitle: "Panchayat and rural services control room",
    focus: "Village roads, panchayat drains, rural water schemes, and local works",
    accessNote: "Minister portfolio 2 of 3. Data is scoped to this ministry only.",
    seedOffset: 37,
    loadFactor: 0.82,
    queueLabel: "Primary: Rural Development",
    ownerPrimary: ["District rural development agency", "Block development officer", "Panchayat union engineer"],
    bottlenecks: ["Panchayat fund release", "Block engineer inspection", "Contractor mobilization", "Village-level evidence pending"],
    districtOverrides: ruralDistrictOverrides,
    tickets: ruralTickets,
    fieldActions: ruralFieldActions,
  },
  {
    id: "food",
    ministry: "Food and Civil Supplies",
    shortName: "Food & Civil Supplies",
    controlRoomTitle: "PDS and civil supplies control room",
    focus: "Fair price shops, PDS quality, ration access, and supply exceptions",
    accessNote: "Minister portfolio 3 of 3. This dashboard has no all-ministry mode.",
    seedOffset: 73,
    loadFactor: 0.72,
    queueLabel: "Primary: Food & Civil Supplies",
    ownerPrimary: ["District supply officer", "Taluk supply inspector", "Regional civil supplies manager"],
    bottlenecks: ["Stock reconciliation", "Biometric exception approval", "Depot inspection", "Shop-level compliance response"],
    districtOverrides: foodDistrictOverrides,
    tickets: foodTickets,
    fieldActions: foodFieldActions,
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function districtName(feature: GeoFeature) {
  return String(feature.properties.dtname ?? feature.properties.district ?? feature.properties.DISTRICT ?? feature.properties.name ?? "");
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function collectPositions(input: unknown, output: Array<[number, number]>) {
  if (!Array.isArray(input)) return;
  if (typeof input[0] === "number" && typeof input[1] === "number") {
    output.push([Number(input[0]), Number(input[1])]);
    return;
  }
  input.forEach((item) => collectPositions(item, output));
}

function geometryRings(feature: GeoFeature) {
  if (feature.geometry.type === "Polygon") return (feature.geometry.coordinates ?? []) as Array<Array<[number, number]>>;
  return ((feature.geometry.coordinates ?? []) as Array<Array<Array<[number, number]>>>).flat();
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
      .then((nextGeoJson) => {
        if (cancelled) return;
        setGeoJson(nextGeoJson);
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { geoJson, loadState };
}

function seedValue(name: string) {
  return [...name].reduce((total, character, index) => total + character.charCodeAt(0) * (index + 7), 0);
}

function createDistrictMetric(district: string, index: number, portfolio: AssignedPortfolio): DistrictOpsMetric {
  const seed = seedValue(`${district}-${portfolio.id}`) + portfolio.seedOffset;
  const open = Math.round((540 + (seed % 2100) + index * 19) * portfolio.loadFactor);
  const breached = Math.round(open * (0.08 + (seed % 9) * 0.012));
  const cmRisk = Math.round(breached * (0.14 + (index % 4) * 0.035));
  return {
    district,
    open,
    breached,
    due48h: Math.round(breached * 0.48 + (index % 5) * 14),
    cmRisk,
    resolvedWeek: Math.round(open * (0.19 + (index % 6) * 0.018)),
    avgAge: Number((4.2 + (seed % 52) / 10).toFixed(1)),
    fieldTeams: 3 + (index % 9),
    escalationRate: 3 + (seed % 13),
    leadOwner: portfolio.ownerPrimary[index % portfolio.ownerPrimary.length],
    bottleneck: portfolio.bottlenecks[index % portfolio.bottlenecks.length],
    ...portfolio.districtOverrides[district],
  };
}

function metricValue(metric: DistrictOpsMetric, mode: MinistryMetricMode) {
  if (mode === "risk") return metric.cmRisk;
  if (mode === "age") return metric.avgAge;
  if (mode === "open") return metric.open;
  return metric.breached;
}

function metricLabel(mode: MinistryMetricMode) {
  if (mode === "risk") return "CM escalation risk";
  if (mode === "age") return "Average age";
  if (mode === "open") return "Open tickets";
  return "SLA breaches";
}

function districtTone(metric: DistrictOpsMetric, mode: MinistryMetricMode) {
  const value = metricValue(metric, mode);
  if (mode === "age") return value > 8 ? "critical" : value > 6.5 ? "high" : value > 5.2 ? "medium" : "low";
  if (mode === "risk") return value > 140 ? "critical" : value > 90 ? "high" : value > 50 ? "medium" : "low";
  if (mode === "open") return value > 3200 ? "critical" : value > 2200 ? "high" : value > 1300 ? "medium" : "low";
  return value > 700 ? "critical" : value > 420 ? "high" : value > 220 ? "medium" : "low";
}

function summarize(metrics: DistrictOpsMetric[]) {
  const total = (key: keyof Pick<DistrictOpsMetric, "open" | "breached" | "due48h" | "cmRisk" | "resolvedWeek" | "fieldTeams">) =>
    metrics.reduce((sum, item) => sum + item[key], 0);
  const avgAge = metrics.reduce((sum, item) => sum + item.avgAge, 0) / metrics.length;
  return {
    open: total("open"),
    breached: total("breached"),
    due48h: total("due48h"),
    cmRisk: total("cmRisk"),
    resolvedWeek: total("resolvedWeek"),
    fieldTeams: total("fieldTeams"),
    redDistricts: metrics.filter((item) => item.breached > 420 || item.cmRisk > 90).length,
    avgAge,
  };
}

function apiMinistryForPortfolio(portfolio: AssignedPortfolio) {
  if (portfolio.id === "maws") return "Municipal Administration and Water Supply";
  if (portfolio.id === "food") return "Cooperation, Food and Consumer Protection";
  return portfolio.ministry;
}

function metricsFromDashboard(fallback: DistrictOpsMetric[], dashboard: RoleDashboardDto | null): DistrictOpsMetric[] {
  if (!dashboard) return fallback;
  const rowsByDistrict = new Map(dashboard.byDistrict.map((row) => [row.label, row]));
  return fallback.map((metric) => {
    const row = rowsByDistrict.get(metric.district);
    if (!row) return metric;
    return {
      ...metric,
      open: row.openTickets,
      breached: row.slaBreached,
      due48h: row.dueIn48h,
      cmRisk: dashboard.tickets.filter((ticket) => ticket.district === metric.district && ticket.primaryQueue.kind === "cm_cell").length,
    };
  });
}

function summaryFromDashboard(fallback: ReturnType<typeof summarize>, dashboard: RoleDashboardDto | null): ReturnType<typeof summarize> {
  if (!dashboard || dashboard.tickets.length === 0) return fallback;
  const open = dashboard.kpis.openTickets;
  return {
    ...fallback,
    open,
    breached: dashboard.kpis.slaBreached,
    due48h: dashboard.kpis.dueIn48h,
    cmRisk: dashboard.kpis.escalatedToCmCell,
    resolvedWeek: Math.round(open * 0.6),
    redDistricts: dashboard.byDistrict.filter((district) => district.slaBreached > 0 || district.dueIn48h > 0).length,
    avgAge: dashboard.kpis.averageAgeHours > 0 ? Number((dashboard.kpis.averageAgeHours / 24).toFixed(1)) : fallback.avgAge,
  };
}

function ticketFromDashboard(ticket: DashboardTicketDto): MinistryTicket {
  const hoursLeft = hoursUntil(ticket.sla.dueAt);
  const secondaryOwner = ticket.secondaryQueues.find((queue) => queue.kind === "ministry") ?? ticket.secondaryQueues[0];
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
    district: ticket.district,
    source: ticket.primaryQueue.kind === "cm_cell" ? "Escalated to CM Cell; ministry still visible" : `${ticket.primaryQueue.ownerLabel} primary`,
    stage: ticket.primaryQueue.kind === "cm_cell" ? "CM Cell primary queue" : ticket.sla.stage === "ministry" ? "Ministry primary queue" : `${ticket.sla.stage} stage`,
    ownerStage,
    hoursLeft,
    owner: ticket.primaryQueue.kind === "cm_cell" ? (secondaryOwner?.ownerLabel ?? "Ministry secondary owner") : ticket.primaryQueue.ownerLabel,
    ask: ticket.primaryQueue.kind === "cm_cell" ? `Respond to CM Cell on ${ticket.ministry} delay and clear secondary ownership.` : `Clear ${ticket.category} issue before it reaches CM Cell.`,
  };
}

function ticketsFromDashboard(dashboard: RoleDashboardDto | null, fallback: MinistryTicket[]) {
  if (!dashboard || dashboard.tickets.length === 0) return fallback;
  return dashboard.tickets.map(ticketFromDashboard);
}

function Header({ portfolio }: { portfolio: AssignedPortfolio }) {
  return (
    <header className="min-header">
      <div className="min-brand">
        <img alt="Whistle logo" src={ASSETS.logo} />
        <div>
          <strong>Whistle</strong>
          <span>Ministry Operations</span>
        </div>
      </div>
      <div className="min-gov">
        <img alt="Neutral civic service mark" src={ASSETS.emblem} />
        <div>
          <strong>Tamil Nadu Government</strong>
          <span>{portfolio.ministry}</span>
        </div>
      </div>
      <div className="min-shift">
        <span>Minister</span>
        <strong>{mockMinisterName}</strong>
        <small>Today, 4:15 PM | Mock data</small>
      </div>
    </header>
  );
}

function SectionMenu({ active, setActive }: { active: MinistrySection; setActive: (section: MinistrySection) => void }) {
  return (
    <nav aria-label="Ministry dashboard sections" className="min-menu-list">
      {sectionItems.map((item) => (
        <button className={active === item.id ? "active" : ""} data-section={item.id} key={item.id} onClick={() => setActive(item.id)} type="button">
          <strong>{item.label}</strong>
          <span>{item.detail}</span>
        </button>
      ))}
    </nav>
  );
}

function PortfolioSwitcher({
  portfolios,
  selectedPortfolioId,
  setSelectedPortfolioId,
}: {
  portfolios: AssignedPortfolio[];
  selectedPortfolioId: PortfolioId;
  setSelectedPortfolioId: (id: PortfolioId) => void;
}) {
  return (
    <section className="min-portfolio-card" aria-label="Assigned ministry portfolios">
      <div className="min-portfolio-heading">
        <ShieldCheck size={18} />
        <div>
          <strong>Assigned ministries</strong>
          <span>{mockMinisterName}</span>
        </div>
      </div>
      <div className="min-portfolio-list">
        {portfolios.map((portfolio) => (
          <button
            className={selectedPortfolioId === portfolio.id ? "active" : ""}
            data-portfolio={portfolio.id}
            key={portfolio.id}
            onClick={() => setSelectedPortfolioId(portfolio.id)}
            type="button"
          >
            <strong>{portfolio.shortName}</strong>
            <span>{portfolio.focus}</span>
          </button>
        ))}
      </div>
      <p>No all-ministry view for this role.</p>
    </section>
  );
}

function SectionIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <section className="min-section-intro">
      <div>
        <span className="min-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
      <div className="min-search">
        <Search size={17} />
        <span>Search ticket, district, owner...</span>
      </div>
    </section>
  );
}

function KpiCard({ icon: Icon, label, value, note, tone = "red" }: { icon: LucideIcon; label: string; value: string; note: string; tone?: "red" | "amber" | "green" | "dark" }) {
  return (
    <div className={`min-kpi tone-${tone}`}>
      <span className="min-kpi-icon">
        <Icon size={18} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function OverviewSummary({
  summary,
  selectedDistrict,
  activeTicket,
  portfolio,
}: {
  summary: ReturnType<typeof summarize>;
  selectedDistrict: string;
  activeTicket: MinistryTicket;
  portfolio: AssignedPortfolio;
}) {
  return (
    <section className="min-overview-summary">
      <div className="min-section-heading">
        <div>
          <span>Operating readout</span>
          <h2>Keep issues inside ministry SLA</h2>
        </div>
        <Gauge size={22} />
      </div>
      <div className="min-overview-cards">
        <div>
          <span>Escalation prevention</span>
          <strong>{formatNumber(summary.cmRisk)} at risk</strong>
          <small>Tickets likely to reach CM Cell if district action slips.</small>
        </div>
        <div>
          <span>Active district</span>
          <strong>{selectedDistrict}</strong>
          <small>District drilldown drives the heatmap, queue, and directive context.</small>
        </div>
        <div>
          <span>Weekly closure</span>
          <strong>{formatNumber(summary.resolvedWeek)}</strong>
          <small>Resolved this week under {portfolio.shortName}.</small>
        </div>
        <div>
          <span>Next ministry action</span>
          <strong>{activeTicket.id}</strong>
          <small>{activeTicket.ask}</small>
        </div>
      </div>
    </section>
  );
}

function DistrictWatchlist({ metrics, setSelectedDistrict }: { metrics: DistrictOpsMetric[]; setSelectedDistrict: (district: string) => void }) {
  const watchlist = [...metrics].sort((a, b) => b.cmRisk - a.cmRisk).slice(0, 6);
  return (
    <section className="min-watch-card">
      <div className="min-section-heading">
        <div>
          <span>District watchlist</span>
          <h2>Where intervention is needed</h2>
        </div>
        <AlertTriangle size={22} />
      </div>
      <div className="min-watch-list">
        {watchlist.map((item) => (
          <button key={item.district} onClick={() => setSelectedDistrict(item.district)} type="button">
            <strong>{item.district}</strong>
            <span>{formatNumber(item.breached)} breached</span>
            <small>{formatNumber(item.cmRisk)} CM-risk tickets</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function MinistryBriefPanel({ briefRun, portfolio }: { briefRun: DashboardBriefRunDto | null; portfolio: AssignedPortfolio }) {
  const brief = briefRun?.brief;
  const actions = brief?.recommendedActions.slice(0, 2) ?? [];

  return (
    <section className="min-brief-card">
      <div className="min-section-heading">
        <div>
          <span>Recommend-only brief</span>
          <h2>{brief ? `${brief.riskLevel} daily readout` : "Daily ministry readout"}</h2>
        </div>
        <Sparkles size={22} />
      </div>
      <strong className="min-brief-headline">{brief?.headline ?? `${portfolio.shortName} should clear local bottlenecks before CM escalation.`}</strong>
      <p>{brief?.summary ?? portfolio.accessNote}</p>
      <div className="min-brief-focus">
        {(brief?.focusAreas ?? []).slice(0, 3).map((item) => (
          <div className={`tone-${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
      <div className="min-brief-actions">
        {actions.map((action) => (
          <div key={action.label}>
            <CheckCircle2 size={16} />
            <span>
              <strong>{action.label}</strong> · {action.reason}
            </span>
          </div>
        ))}
      </div>
      {brief ? <small className="min-brief-guardrail">{brief.nonMutationGuarantee}</small> : null}
    </section>
  );
}

function StateHeatmap({
  geoJson,
  loadState,
  metrics,
  metricMode,
  selectedDistrict,
  setMetricMode,
  setSelectedDistrict,
}: {
  geoJson: GeoCollection | null;
  loadState: "loading" | "ready" | "error";
  metrics: DistrictOpsMetric[];
  metricMode: MinistryMetricMode;
  selectedDistrict: string;
  setMetricMode: (mode: MinistryMetricMode) => void;
  setSelectedDistrict: (district: string) => void;
}) {
  const projection = useMemo(() => {
    if (!geoJson) return null;
    const positions: Array<[number, number]> = [];
    geoJson.features.forEach((feature) => collectPositions(feature.geometry.coordinates, positions));
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    positions.forEach(([lon, lat]) => {
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
    <section className="min-map-card">
      <div className="min-section-heading">
        <div>
          <span>Ministry district map</span>
          <h2>{metricLabel(metricMode)}</h2>
        </div>
        <div className="min-map-tabs">
          {[
            ["breach", "SLA"],
            ["risk", "CM risk"],
            ["age", "Age"],
            ["open", "Open"],
          ].map(([mode, label]) => (
            <button className={metricMode === mode ? "active" : ""} key={mode} onClick={() => setMetricMode(mode as MinistryMetricMode)} type="button">
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-map-layout">
        <div className="min-map-frame">
          {loadState === "loading" && <div className="min-map-state">Loading sample district map...</div>}
          {loadState === "error" && <div className="min-map-state error">District map could not be loaded.</div>}
          {geoJson && projection && (
            <svg aria-label="Tamil Nadu ministry district heatmap" className="min-tn-map" role="img" viewBox="0 0 450 650">
              {geoJson.features.map((feature) => {
                const name = districtName(feature);
                const metric = metricFor(name);
                const tone = metric ? districtTone(metric, metricMode) : "low";
                return (
                  <path
                    className={`min-district tone-${tone} ${selectedDistrict === name ? "selected" : ""}`}
                    d={pathForFeature(feature)}
                    fillRule="evenodd"
                    key={name}
                    onClick={() => setSelectedDistrict(name)}
                    tabIndex={0}
                  >
                    <title>
                      {metric ? `${name}: ${formatNumber(metricValue(metric, metricMode))} ${metricLabel(metricMode).toLowerCase()}` : name}
                    </title>
                  </path>
                );
              })}
            </svg>
          )}
        </div>
        <div className="min-map-legend">
          <span className="low" /> Low
          <span className="medium" /> Medium
          <span className="high" /> High
          <span className="critical" /> Critical
        </div>
      </div>
    </section>
  );
}

function DistrictPanel({ district, metrics }: { district: string; metrics: DistrictOpsMetric[] }) {
  const metric = metrics.find((item) => item.district === district) ?? metrics[0];
  return (
    <section className="min-district-panel">
      <div className="min-section-heading">
        <div>
          <span>Selected district</span>
          <h2>{metric.district}</h2>
        </div>
        <MapPin size={22} />
      </div>
      <div className="min-district-stats">
        <div>
          <span>Open</span>
          <strong>{formatNumber(metric.open)}</strong>
        </div>
        <div>
          <span>Breached</span>
          <strong>{formatNumber(metric.breached)}</strong>
        </div>
        <div>
          <span>Due 48h</span>
          <strong>{formatNumber(metric.due48h)}</strong>
        </div>
        <div>
          <span>CM risk</span>
          <strong>{formatNumber(metric.cmRisk)}</strong>
        </div>
      </div>
      <div className="min-drill-path">
        <span>Owner and bottleneck</span>
        <strong>{metric.leadOwner}</strong>
        <small>{metric.bottleneck}</small>
      </div>
    </section>
  );
}

function TicketQueue({
  actionBusy,
  actionError,
  actionMode,
  actionNotice,
  actionNote,
  onSubmitAction,
  tickets,
  selected,
  setSelected,
  setActionMode,
  setActionNote,
}: {
  actionBusy: boolean;
  actionError: string | null;
  actionMode: MinistryActionMode;
  actionNotice: string | null;
  actionNote: string;
  onSubmitAction: () => void;
  tickets: MinistryTicket[];
  selected: string;
  setSelected: (id: string) => void;
  setActionMode: (mode: MinistryActionMode) => void;
  setActionNote: (note: string) => void;
}) {
  const selectedItem = tickets.find((item) => item.id === selected) ?? tickets[0];
  const canAct = selectedItem.ownerStage === "ministry" || selectedItem.ownerStage === "cm_cell";
  const canResolve = selectedItem.ownerStage === "ministry";
  const canSubmitAction = canAct && (actionMode !== "resolve" || canResolve);
  const activeCopy = ministryActionCopy[actionMode];
  return (
    <section className="min-queue-card">
      <div className="min-section-heading">
        <div>
          <span>Primary ministry queue</span>
          <h2>Stop CM escalation</h2>
        </div>
        <BellRing size={22} />
      </div>
      <div className="min-queue-list">
        {tickets.map((item) => (
          <button className={selected === item.id ? "active" : ""} key={item.id} onClick={() => setSelected(item.id)} type="button">
            <span className={item.hoursLeft < 0 ? "min-priority breached" : "min-priority"}>{item.hoursLeft < 0 ? `${Math.abs(item.hoursLeft)}h late` : `${item.hoursLeft}h`}</span>
            <div>
              <strong>{item.title}</strong>
              <small>
                {item.district} | {item.source}
              </small>
            </div>
          </button>
        ))}
      </div>
      <div className="min-ticket-detail">
        <span>{selectedItem.id}</span>
        <h3>{selectedItem.ask}</h3>
        <p>
          {selectedItem.stage} | Owner: {selectedItem.owner}
        </p>
        <div className="min-ministry-workbench">
          <div className="min-action-mode-grid">
            {(Object.keys(ministryActionCopy) as MinistryActionMode[]).map((mode) => {
              const copy = ministryActionCopy[mode];
              const Icon = copy.icon;
              const disabled = !canAct || (mode === "resolve" && !canResolve);
              return (
                <button className={actionMode === mode ? "active" : ""} disabled={disabled || actionBusy} key={mode} onClick={() => setActionMode(mode)} type="button">
                  <Icon size={15} />
                  <span>{copy.label}</span>
                </button>
              );
            })}
          </div>
          <label className="min-action-note">
            <span>{activeCopy.label}</span>
            <textarea
              onChange={(event) => setActionNote(event.target.value)}
              placeholder={activeCopy.detail}
              value={actionNote}
            />
          </label>
          <button className="min-submit-action" disabled={!canSubmitAction || actionBusy} onClick={onSubmitAction} type="button">
            {actionBusy ? "Saving action..." : activeCopy.label}
          </button>
          {actionNotice ? <div className="min-action-notice success">{actionNotice}</div> : null}
          {actionError ? <div className="min-action-notice error">{actionError}</div> : null}
          {!canAct ? <small className="min-action-footnote">This ticket is not in the ministry or CM escalation lane yet. Use the dashboard for visibility until routing reaches the ministry.</small> : null}
          {selectedItem.ownerStage === "cm_cell" ? <small className="min-action-footnote">CM Cell is primary now. Ministry actions are supporting notes and evidence requests only.</small> : null}
        </div>
      </div>
    </section>
  );
}

function QueueFilterPanel({ portfolio }: { portfolio: AssignedPortfolio }) {
  return (
    <section className="min-filter-card">
      <div className="min-section-heading">
        <div>
          <span>Queue filter</span>
          <h2>Default: {portfolio.queueLabel}</h2>
        </div>
        <FileWarning size={22} />
      </div>
      <div className="min-filter-pills">
        <span className="active">{portfolio.queueLabel}</span>
        <span>SLA breached</span>
        <span>Due in 48h</span>
        <span>Secondary: MLA/local</span>
      </div>
      <p>Tickets here are owned by this assigned ministry until resolved or escalated to CM Cell. No all-ministry access is available in this role.</p>
    </section>
  );
}

function FieldActionPanel({ actions }: { actions: FieldAction[] }) {
  return (
    <section className="min-field-card">
      <div className="min-section-heading">
        <div>
          <span>Field action board</span>
          <h2>Directives by district</h2>
        </div>
        <Wrench size={22} />
      </div>
      <div className="min-field-list">
        {actions.map((item) => (
          <div key={`${item.district}-${item.action}`}>
            <strong>{item.district}</strong>
            <span>{item.action}</span>
            <small>
              {item.owner} | {item.target}
            </small>
            <em className={`status-${item.status.toLowerCase().replaceAll(" ", "-")}`}>{item.status}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function OperatingPlan({ summary, portfolio }: { summary: ReturnType<typeof summarize>; portfolio: AssignedPortfolio }) {
  return (
    <section className="min-plan-card">
      <div className="min-section-heading">
        <div>
          <span>Minister's operating plan</span>
          <h2>Today before escalation review</h2>
        </div>
        <ClipboardCheck size={22} />
      </div>
      <div className="min-plan-list">
        <div>
          <CheckCircle2 size={18} />
          <span>Close {formatNumber(summary.due48h)} tickets before they breach the ministry SLA.</span>
        </div>
        <div>
          <TimerReset size={18} />
          <span>Prioritize {portfolio.shortName} districts where CM-risk tickets exceed 90.</span>
        </div>
        <div>
          <RadioTower size={18} />
          <span>Keep local/MLA owners visible as secondary queues after escalation.</span>
        </div>
      </div>
    </section>
  );
}

function TeamCapacity({ summary, portfolio }: { summary: ReturnType<typeof summarize>; portfolio: AssignedPortfolio }) {
  const requestLabel =
    portfolio.id === "food" ? "stock and exception requests" : portfolio.id === "rural" ? "block-level reassignment requests" : "crew reassignment requests";
  const requestNote =
    portfolio.id === "food"
      ? "Mostly stock transfers, biometric exceptions, and shop compliance follow-up."
      : portfolio.id === "rural"
        ? "Mostly road repair, panchayat sanitation, and rural water crews."
        : "Mostly sewer jetting and storm-drain work.";
  const blockLabel = portfolio.id === "food" ? "supply blocks" : portfolio.id === "rural" ? "fund release blocks" : "procurement blocks";
  const blockNote =
    portfolio.id === "food"
      ? "Can be cleared by district supply directive today."
      : portfolio.id === "rural"
        ? "Can be cleared by ministry order and district collector review."
        : "Can be cleared by ministry directive today.";

  return (
    <section className="min-capacity-card">
      <div className="min-section-heading">
        <div>
          <span>Field capacity</span>
          <h2>Teams and bottlenecks</h2>
        </div>
        <Building2 size={22} />
      </div>
      <div className="min-capacity-list">
        <div>
          <strong>{summary.fieldTeams}</strong>
          <span>active field teams</span>
          <small>{portfolio.shortName} district and field teams.</small>
        </div>
        <div>
          <strong>18</strong>
          <span>{requestLabel}</span>
          <small>{requestNote}</small>
        </div>
        <div>
          <strong>7</strong>
          <span>{blockLabel}</span>
          <small>{blockNote}</small>
        </div>
      </div>
    </section>
  );
}

export default function MinistryMockup() {
  const { geoJson, loadState } = useDistrictGeoJson();
  const [dashboard, setDashboard] = useState<RoleDashboardDto | null>(null);
  const [briefRun, setBriefRun] = useState<DashboardBriefRunDto | null>(null);
  const [dashboardState, setDashboardState] = useState<"live" | "mock" | "offline">("mock");
  const [activeSection, setActiveSection] = useState<MinistrySection>("overview");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<PortfolioId>(defaultPortfolioId);
  const [metricMode, setMetricMode] = useState<MinistryMetricMode>("breach");
  const [selectedDistrict, setSelectedDistrict] = useState("Chennai");
  const [dashboardVersion, setDashboardVersion] = useState(0);
  const [ministryActionMode, setMinistryActionMode] = useState<MinistryActionMode>("directive");
  const [ministryActionNote, setMinistryActionNote] = useState("District owner must clear the bottleneck and upload field proof before the next SLA review.");
  const [ministryActionBusy, setMinistryActionBusy] = useState(false);
  const [ministryActionNotice, setMinistryActionNotice] = useState<string | null>(null);
  const [ministryActionError, setMinistryActionError] = useState<string | null>(null);
  const portfolio = assignedPortfolios.find((item) => item.id === selectedPortfolioId) ?? assignedPortfolios[0];
  const [selectedTicket, setSelectedTicket] = useState(portfolio.tickets[0].id);

  useEffect(() => {
    setSelectedTicket(portfolio.tickets[0].id);
    setSelectedDistrict(portfolio.tickets[0].district);
  }, [portfolio, dashboardVersion]);

  useEffect(() => {
    const controller = new AbortController();
    fetchRoleDashboard({ role: "minister", ministry: apiMinistryForPortfolio(portfolio) }, controller.signal, {
      role: "minister",
      actor: "minister:prototype",
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
    generateDashboardBrief({ role: "minister", ministry: apiMinistryForPortfolio(portfolio) }, controller.signal, {
      role: "minister",
      actor: "minister:prototype",
    })
      .then(setBriefRun)
      .catch(() => {
        if (!controller.signal.aborted) setBriefRun(null);
      });
    return () => controller.abort();
  }, [portfolio]);

  const fallbackMetrics = useMemo(() => {
    const names = geoJson?.features.map(districtName).filter(Boolean) ?? fallbackDistricts;
    return names.map((district, index) => createDistrictMetric(district, index, portfolio));
  }, [geoJson, portfolio]);

  const metrics = useMemo(() => metricsFromDashboard(fallbackMetrics, dashboard), [dashboard, fallbackMetrics]);
  const summary = summaryFromDashboard(summarize(metrics), dashboard);
  const ticketItems = useMemo(() => ticketsFromDashboard(dashboard, portfolio.tickets), [dashboard, portfolio.tickets]);
  const activeTicket = ticketItems.find((item) => item.id === selectedTicket) ?? ticketItems[0];

  useEffect(() => {
    if (!ticketItems.some((ticket) => ticket.id === selectedTicket)) {
      setSelectedTicket(ticketItems[0]?.id ?? portfolio.tickets[0].id);
      setSelectedDistrict(ticketItems[0]?.district ?? portfolio.tickets[0].district);
    }
  }, [portfolio.tickets, selectedTicket, ticketItems]);

  useEffect(() => {
    setMinistryActionNotice(null);
    setMinistryActionError(null);
    if (activeTicket?.ownerStage !== "ministry" && ministryActionMode === "resolve") {
      setMinistryActionMode("directive");
    }
  }, [activeTicket?.id, activeTicket?.ownerStage, ministryActionMode]);

  async function submitMinisterAction() {
    if (!activeTicket) return;
    setMinistryActionBusy(true);
    setMinistryActionNotice(null);
    setMinistryActionError(null);
    const note = ministryActionNote.trim() || ministryActionCopy[ministryActionMode].detail;
    const actor = "minister:prototype";
    const safeTicketId = activeTicket.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket";
    const visitAt = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    let action: FieldActionRequest;

    if (ministryActionMode === "request_evidence") {
      action = {
        action: "schedule_visit",
        actor,
        fieldOfficer: `${portfolio.shortName} district field lead`,
        visitAt,
        note,
      };
    } else if (ministryActionMode === "resolve") {
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
            fileName: `${safeTicketId}-ministry-closure-proof.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: 740_000,
          },
        ],
      };
    } else {
      action = {
        action: "add_field_report",
        actor,
        fieldOfficer: `${portfolio.shortName} minister office`,
        note,
        evidence: [
          {
            label: "field_report",
            fileName: `${safeTicketId}-ministry-directive.txt`,
            mimeType: "text/plain",
            sizeBytes: Math.max(128, note.length * 2),
          },
        ],
      };
    }

    try {
      await submitFieldAction(activeTicket.id, action, { role: "minister", actor });
      setMinistryActionNotice(`${ministryActionCopy[ministryActionMode].label} saved for ${activeTicket.id}. Ministry dashboard refreshed.`);
      setDashboardVersion((version) => version + 1);
    } catch (error) {
      setMinistryActionError(error instanceof Error ? error.message : "Ministry action could not be saved.");
    } finally {
      setMinistryActionBusy(false);
    }
  }

  return (
    <div className="min-app">
      <Header portfolio={portfolio} />
      <main className="min-main">
        <aside className="min-left-rail">
          <PortfolioSwitcher portfolios={assignedPortfolios} selectedPortfolioId={selectedPortfolioId} setSelectedPortfolioId={setSelectedPortfolioId} />
          <SectionMenu active={activeSection} setActive={setActiveSection} />
        </aside>
        <div className={`min-content-panel min-page-${activeSection}`}>
          {activeSection === "overview" && (
            <>
              <SectionIntro
                body={`Scoped to ${portfolio.ministry}. Clear district bottlenecks, protect SLA timelines, and stop these tickets from reaching CM Cell.`}
                eyebrow="Ministry operations"
                title={portfolio.controlRoomTitle}
              />
              <section className="min-kpi-grid">
                <KpiCard icon={Landmark} label="Open in portfolio" note={portfolio.accessNote} value={formatNumber(summary.open)} />
                <KpiCard icon={AlertTriangle} label="SLA breached" note={`${summary.redDistricts} districts need review`} value={formatNumber(summary.breached)} />
                <KpiCard icon={Clock3} label="Due in 48h" note="Prevent next breach wave" tone="amber" value={formatNumber(summary.due48h)} />
                <KpiCard icon={RadioTower} label="CM risk" note="Likely to escalate" value={formatNumber(summary.cmRisk)} />
                <KpiCard icon={CheckCircle2} label="Closed this week" note="Verified field closure" tone="green" value={formatNumber(summary.resolvedWeek)} />
                <KpiCard icon={Gauge} label="Average age" note="Across open tickets" tone="dark" value={`${summary.avgAge.toFixed(1)}d`} />
              </section>
              <section className="min-overview-grid">
                <OverviewSummary activeTicket={activeTicket} portfolio={portfolio} selectedDistrict={selectedDistrict} summary={summary} />
                <MinistryBriefPanel briefRun={briefRun} portfolio={portfolio} />
              </section>
            </>
          )}

          {activeSection === "districts" && (
            <>
              <SectionIntro
                body={`District performance for ${portfolio.shortName}, with SLA pressure, CM escalation risk, age, and open workload by district.`}
                eyebrow="Districts"
                title={`${portfolio.shortName} SLA heatmap`}
              />
              <section className="min-district-grid">
                <StateHeatmap
                  geoJson={geoJson}
                  loadState={loadState}
                  metricMode={metricMode}
                  metrics={metrics}
                  selectedDistrict={selectedDistrict}
                  setMetricMode={setMetricMode}
                  setSelectedDistrict={setSelectedDistrict}
                />
                <div className="min-right-stack">
                  <DistrictPanel district={selectedDistrict} metrics={metrics} />
                  <OperatingPlan portfolio={portfolio} summary={summary} />
                </div>
              </section>
            </>
          )}

          {activeSection === "queue" && (
            <>
              <SectionIntro
                body={`Primary ${portfolio.shortName} queue for SLA-breached and due-soon tickets. Secondary local/MLA ownership remains visible after escalation.`}
                eyebrow="SLA queue"
                title={`${portfolio.shortName} ticket control`}
              />
              <section className="min-queue-grid">
                <div className="min-left-stack">
                  <QueueFilterPanel portfolio={portfolio} />
                  <TicketQueue
                    actionBusy={ministryActionBusy}
                    actionError={ministryActionError}
                    actionMode={ministryActionMode}
                    actionNotice={ministryActionNotice}
                    actionNote={ministryActionNote}
                    onSubmitAction={submitMinisterAction}
                    selected={selectedTicket}
                    setActionMode={setMinistryActionMode}
                    setActionNote={setMinistryActionNote}
                    setSelected={setSelectedTicket}
                    tickets={ticketItems}
                  />
                </div>
                <div className="min-right-stack">
                  <DistrictPanel district={activeTicket.district} metrics={metrics} />
                  <OperatingPlan portfolio={portfolio} summary={summary} />
                </div>
              </section>
            </>
          )}

          {activeSection === "field" && (
            <>
              <SectionIntro
                body={`Field directives, team capacity, and district bottlenecks that ${portfolio.shortName} can clear without waiting for CM Cell intervention.`}
                eyebrow="Field action"
                title={`${portfolio.shortName} directives`}
              />
              <section className="min-field-grid">
                <FieldActionPanel actions={portfolio.fieldActions} />
                <div className="min-right-stack">
                  <TeamCapacity portfolio={portfolio} summary={summary} />
                  <OperatingPlan portfolio={portfolio} summary={summary} />
                </div>
              </section>
            </>
          )}
        </div>
      </main>
      <div className="min-mode-banner">
        <Sparkles size={16} />
        <span>{dashboardState === "live" ? "Minister dashboard: reading live MVP ticket-spine sample data for the selected ministry." : "Minister dashboard: using portfolio prototype data until matching MVP API data is reachable."}</span>
      </div>
    </div>
  );
}
