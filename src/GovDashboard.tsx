import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Filter,
  Flame,
  Gauge,
  History,
  Landmark,
  Layers3,
  LockKeyhole,
  Map as MapIcon,
  MapPin,
  MessageSquareWarning,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  TimerReset,
  UserCog,
  UsersRound,
} from "lucide-react";

type GovRole =
  | "cm-cell"
  | "department-minister"
  | "department-officer"
  | "mla"
  | "councillor"
  | "verification"
  | "rejection-review";

type DashboardView = "overview" | "heatmap" | "tickets" | "ministries" | "rejections" | "protected";
type QueueFilter = "all" | "primary" | "secondary" | "breached" | "dueSoon" | "protected" | "rejected" | "resolved";
type SlaState = "breached" | "dueSoon" | "onTrack" | "awaitingCitizen" | "resolved";
type TicketStatus =
  | "Submitted"
  | "Verification"
  | "Awaiting Citizen"
  | "Local/MLA Queue"
  | "Ministry Queue"
  | "CM Cell Escalated"
  | "Rejected Review"
  | "Resolved";
type MetricMode = "open" | "breach" | "escalation" | "age";

type RoleScope = {
  id: GovRole;
  label: string;
  shortLabel: string;
  scope: string;
  goal: string;
  description: string;
  canSeeProtectedQueue: boolean;
  canSeeReporterIdentity: boolean;
  allowedActions: string[];
  focusDistricts?: string[];
  focusDepartments?: string[];
};

type GeoMetric = {
  district: string;
  open: number;
  breached: number;
  dueToday: number;
  due48: number;
  escalated: number;
  protectedCount: number;
  avgAge: number;
  topDepartment: string;
};

type DepartmentMetric = {
  department: string;
  ministry: string;
  open: number;
  breached: number;
  dueSoon: number;
  cmEscalated: number;
  protectedCount: number;
  avgAge: number;
  resolutionRate: number;
  trend: number;
};

type QueueAssignment = {
  primary: string;
  secondary: string[];
};

type SlaStage = {
  label: string;
  owner: string;
  limit: string;
  state: "done" | "active" | "breached" | "waiting" | "future";
  started: string;
  due: string;
};

type TimelineEvent = {
  title: string;
  time: string;
  note: string;
  tone: "good" | "warn" | "danger" | "neutral";
};

type GovTicket = {
  id: string;
  title: string;
  category: string;
  status: TicketStatus;
  slaState: SlaState;
  priority: "Critical" | "High" | "Medium" | "Low";
  protectedCase: boolean;
  reporter: string;
  phone: string;
  department: string;
  ministry: string;
  district: string;
  city: string;
  constituency: string;
  ward: string;
  owner: string;
  ageDays: number;
  dueInHours: number;
  breachHours: number;
  queue: QueueAssignment;
  slaStages: SlaStage[];
  escalationHistory: string[];
  privacy: "Public civic" | "Identity masked" | "Protected corruption";
  description: string;
  evidence: string[];
  timeline: TimelineEvent[];
  rejectionReview?: string;
};

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

const MINISTER_MINISTRY = "Municipal Administration & Water Supply";
const MINISTER_DEPARTMENTS = ["Water Supply Board", "Municipal Administration"];

const roleScopes: RoleScope[] = [
  {
    id: "cm-cell",
    label: "CM Cell",
    shortLabel: "CM",
    scope: "Statewide oversight",
    goal: "See every ministry, compare district KPIs, and decide escalations.",
    description: "All civic queues, protected corruption, escalations, rejection reversals, and ministry accountability.",
    canSeeProtectedQueue: true,
    canSeeReporterIdentity: true,
    allowedActions: ["Assign", "Issue directive", "Escalate", "Reverse rejection", "Request audit"],
  },
  {
    id: "department-minister",
    label: "Department Minister",
    shortLabel: "Minister",
    scope: "MAWS statewide execution",
    goal: "Drive one ministry efficiently across all districts before cases reach CM Cell.",
    description:
      "Municipal Administration & Water Supply minister view: drive efficient action across districts before issues reach CM Cell.",
    canSeeProtectedQueue: false,
    canSeeReporterIdentity: false,
    allowedActions: ["Assign officer", "Escalate to CM Cell", "Request field report", "Resolve"],
    focusDepartments: [MINISTER_MINISTRY],
  },
  {
    id: "department-officer",
    label: "Department Officer / Ministry Queue",
    shortLabel: "Officer",
    scope: "Operational ministry queue",
    goal: "Move field teams, evidence checks, and daily SLA closure for the ministry queue.",
    description: "Department-owned tickets, field-owner follow-up, evidence completeness, and SLA closure risk.",
    canSeeProtectedQueue: false,
    canSeeReporterIdentity: false,
    allowedActions: ["Request info", "Update field status", "Recommend closure", "Escalate"],
    focusDepartments: MINISTER_DEPARTMENTS,
  },
  {
    id: "mla",
    label: "MLA",
    shortLabel: "MLA",
    scope: "Constituency closure",
    goal: "Close constituency issues locally before they escalate to a ministry.",
    description: "Close constituency issues before escalation, while tracking what has already moved to ministry.",
    canSeeProtectedQueue: false,
    canSeeReporterIdentity: false,
    allowedActions: ["Comment", "Request local action", "Escalate to ministry"],
    focusDistricts: ["Chennai", "Thiruvallur", "Chengalpattu"],
  },
  {
    id: "councillor",
    label: "Councillor / Local Owner",
    shortLabel: "Local",
    scope: "Ward-level closure",
    goal: "Resolve ward issues within local SLA before MLA, ministry, or CM escalation.",
    description: "Resolve local civic issues within SLA before they escalate to MLA, ministry, or CM Cell.",
    canSeeProtectedQueue: false,
    canSeeReporterIdentity: false,
    allowedActions: ["Accept", "Comment", "Request citizen info", "Mark field visit"],
    focusDistricts: ["Chennai"],
  },
  {
    id: "verification",
    label: "Ticket Verification Team",
    shortLabel: "Verify",
    scope: "2-day intake SLA",
    goal: "Clear intake within two days or request usable citizen information.",
    description: "Completeness review, routing decisions, citizen info requests, and incorrect-data rejection queue.",
    canSeeProtectedQueue: true,
    canSeeReporterIdentity: true,
    allowedActions: ["Route", "Request info", "Reject with reason", "Mark protected"],
  },
  {
    id: "rejection-review",
    label: "CM-maintained Rejection Review Team",
    shortLabel: "Reject Review",
    scope: "Independent rejection audit",
    goal: "Catch improper rejections and restore valid citizen tickets.",
    description: "CM-maintained review of rejected tickets to catch improper rejection and restore valid cases.",
    canSeeProtectedQueue: true,
    canSeeReporterIdentity: true,
    allowedActions: ["Reverse rejection", "Send to CM Cell", "Request verifier note", "Close audit"],
  },
];

const departmentMetrics: DepartmentMetric[] = [
  {
    department: "Roads & Highways",
    ministry: "Highways and Minor Ports",
    open: 18420,
    breached: 2510,
    dueSoon: 3910,
    cmEscalated: 420,
    protectedCount: 12,
    avgAge: 8.1,
    resolutionRate: 71,
    trend: 11,
  },
  {
    department: "Water Supply Board",
    ministry: "Municipal Administration & Water Supply",
    open: 22680,
    breached: 3185,
    dueSoon: 5420,
    cmEscalated: 688,
    protectedCount: 25,
    avgAge: 9.7,
    resolutionRate: 67,
    trend: 18,
  },
  {
    department: "TANGEDCO / Energy",
    ministry: "Energy",
    open: 15110,
    breached: 1410,
    dueSoon: 2910,
    cmEscalated: 210,
    protectedCount: 9,
    avgAge: 5.6,
    resolutionRate: 82,
    trend: -6,
  },
  {
    department: "Municipal Administration",
    ministry: "Municipal Administration & Water Supply",
    open: 12840,
    breached: 2030,
    dueSoon: 2660,
    cmEscalated: 375,
    protectedCount: 17,
    avgAge: 7.9,
    resolutionRate: 73,
    trend: 9,
  },
  {
    department: "Rural Development",
    ministry: "Rural Development & Panchayat Raj",
    open: 10780,
    breached: 1240,
    dueSoon: 2180,
    cmEscalated: 160,
    protectedCount: 11,
    avgAge: 6.8,
    resolutionRate: 78,
    trend: 4,
  },
  {
    department: "Health & Family Welfare",
    ministry: "Health and Family Welfare",
    open: 6730,
    breached: 620,
    dueSoon: 1140,
    cmEscalated: 80,
    protectedCount: 8,
    avgAge: 4.8,
    resolutionRate: 86,
    trend: -3,
  },
  {
    department: "Revenue",
    ministry: "Revenue and Disaster Management",
    open: 8910,
    breached: 1540,
    dueSoon: 1770,
    cmEscalated: 310,
    protectedCount: 31,
    avgAge: 10.4,
    resolutionRate: 61,
    trend: 14,
  },
  {
    department: "Civil Supplies / PDS",
    ministry: "Food and Civil Supplies",
    open: 5840,
    breached: 510,
    dueSoon: 890,
    cmEscalated: 72,
    protectedCount: 6,
    avgAge: 4.1,
    resolutionRate: 88,
    trend: -8,
  },
  {
    department: "Vigilance & Anti-Corruption",
    ministry: "CM Cell / Vigilance",
    open: 2190,
    breached: 340,
    dueSoon: 470,
    cmEscalated: 540,
    protectedCount: 2190,
    avgAge: 12.7,
    resolutionRate: 58,
    trend: 22,
  },
];

const districtNames = [
  "Ariyalur",
  "Chengalpattu",
  "Chennai",
  "Coimbatore",
  "Cuddalore",
  "Dharmapuri",
  "Dindigul",
  "Erode",
  "Kallakurichi",
  "Kanchipuram",
  "Kanniyakumari",
  "Karur",
  "Krishnagiri",
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
];

const topDepartmentCycle = [
  "Water Supply Board",
  "Roads & Highways",
  "TANGEDCO / Energy",
  "Municipal Administration",
  "Revenue",
  "Civil Supplies / PDS",
];

const districtOverrides: Record<string, Partial<GeoMetric>> = {
  Chennai: { open: 8940, breached: 1590, dueToday: 580, due48: 1260, escalated: 450, protectedCount: 126, avgAge: 9.9 },
  Coimbatore: { open: 6720, breached: 740, dueToday: 310, due48: 880, escalated: 210, protectedCount: 72, avgAge: 6.2 },
  Madurai: { open: 6110, breached: 880, dueToday: 340, due48: 790, escalated: 240, protectedCount: 68, avgAge: 7.4 },
  Thiruvallur: { open: 5840, breached: 930, dueToday: 375, due48: 840, escalated: 290, protectedCount: 54, avgAge: 8.2 },
  Salem: { open: 5360, breached: 640, dueToday: 260, due48: 720, escalated: 170, protectedCount: 39, avgAge: 6.8 },
  Tiruchirappalli: { open: 4980, breached: 610, dueToday: 245, due48: 650, escalated: 160, protectedCount: 37, avgAge: 6.5 },
  Mayiladuthurai: { open: 2110, breached: 310, dueToday: 115, due48: 285, escalated: 88, protectedCount: 19, avgAge: 7.1 },
};

const districtMetrics: GeoMetric[] = districtNames.map((district, index) => {
  const base = 1180 + ((index * 379) % 3250);
  const open = base + (index % 4) * 260;
  const breached = Math.round(open * (0.08 + (index % 7) * 0.014));
  const dueToday = Math.round(breached * 0.36 + (index % 5) * 12);
  const due48 = Math.round(open * 0.13 + (index % 6) * 22);
  const escalated = Math.round(breached * 0.24 + (index % 4) * 18);
  const protectedCount = 8 + ((index * 7) % 44);
  const avgAge = Number((4.1 + (index % 9) * 0.7).toFixed(1));

  return {
    district,
    open,
    breached,
    dueToday,
    due48,
    escalated,
    protectedCount,
    avgAge,
    topDepartment: topDepartmentCycle[index % topDepartmentCycle.length],
    ...districtOverrides[district],
  };
});

const categoryCycle = [
  "Water",
  "Roads",
  "Power",
  "Sanitation",
  "Revenue",
  "Ration/PDS",
  "Public Safety",
  "Health",
  "Education",
];

const statusCycle: TicketStatus[] = [
  "Verification",
  "Local/MLA Queue",
  "Ministry Queue",
  "CM Cell Escalated",
  "Awaiting Citizen",
  "Rejected Review",
  "Resolved",
];

const priorityCycle: GovTicket["priority"][] = ["Critical", "High", "Medium", "High", "Low"];

const issueTitles = [
  "Stagnant drinking water complaint pending",
  "Road cave-in near bus route",
  "Repeated transformer outage",
  "Garbage overflow at market street",
  "Patta transfer delay and demand concern",
  "Ration shop stock irregularity",
  "Street light outage near school zone",
  "Primary health centre medicine shortage",
  "School building repair delayed",
  "Storm water drain blocked",
];

function makeStages(status: TicketStatus, slaState: SlaState): SlaStage[] {
  const verificationState =
    status === "Submitted" || status === "Verification" || status === "Awaiting Citizen"
      ? slaState === "breached"
        ? "breached"
        : "active"
      : "done";
  const localState =
    status === "Local/MLA Queue"
      ? slaState === "breached"
        ? "breached"
        : "active"
      : status === "Ministry Queue" || status === "CM Cell Escalated" || status === "Resolved"
        ? "done"
        : "future";
  const ministryState =
    status === "Ministry Queue"
      ? slaState === "breached"
        ? "breached"
        : "active"
      : status === "CM Cell Escalated" || status === "Resolved"
        ? "done"
        : "future";
  const cmState =
    status === "CM Cell Escalated" || status === "Rejected Review"
      ? slaState === "breached"
        ? "breached"
        : "active"
      : status === "Resolved"
        ? "done"
        : "future";

  return [
    {
      label: "Intake verification",
      owner: "Ticket Verification Team",
      limit: "2 days",
      state: verificationState,
      started: "May 12, 09:10",
      due: "May 14, 09:10",
    },
    {
      label: "Local resolution",
      owner: "Councillor / MLA",
      limit: "7 days",
      state: localState,
      started: "May 14, 12:45",
      due: "May 21, 12:45",
    },
    {
      label: "Ministry action",
      owner: "Department ministry",
      limit: "10 days",
      state: ministryState,
      started: "May 21, 13:20",
      due: "May 31, 13:20",
    },
    {
      label: "CM Cell command",
      owner: "CM Cell",
      limit: "Priority review",
      state: cmState,
      started: "Jun 1, 10:00",
      due: "Open directive",
    },
  ];
}

function makeTimeline(status: TicketStatus, roleOwner: string): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      title: "Citizen submitted complaint",
      time: "May 12, 09:10",
      note: "OTP mock verified. Evidence packet received.",
      tone: "good",
    },
    {
      title: "Verification completed",
      time: "May 13, 15:42",
      note: "Routed based on department, district, and ward.",
      tone: "good",
    },
  ];

  if (status === "Awaiting Citizen") {
    events.push({
      title: "Additional information requested",
      time: "May 14, 11:20",
      note: "House number and clearer photo required before routing.",
      tone: "warn",
    });
  } else if (status === "Rejected Review") {
    events.push({
      title: "Rejected by verification",
      time: "May 14, 16:05",
      note: "Rejection automatically queued for CM-maintained review.",
      tone: "danger",
    });
  } else if (status === "CM Cell Escalated") {
    events.push({
      title: "SLA breached at ministry level",
      time: "May 26, 18:00",
      note: "Primary queue moved to CM Cell. Ministry retains secondary visibility.",
      tone: "danger",
    });
  } else if (status === "Resolved") {
    events.push({
      title: "Resolved and closure note added",
      time: "May 16, 17:35",
      note: "Citizen notified by SMS and WhatsApp mock channels.",
      tone: "good",
    });
  } else {
    events.push({
      title: `Owned by ${roleOwner}`,
      time: "May 15, 10:00",
      note: "SLA clock is active for this stage.",
      tone: "neutral",
    });
  }

  return events;
}

const seedTickets: GovTicket[] = [
  {
    id: "TN-WH-260512-0018",
    title: "Protected bribery complaint in building approval office",
    category: "Corruption",
    status: "CM Cell Escalated",
    slaState: "breached",
    priority: "Critical",
    protectedCase: true,
    reporter: "R. Kumar",
    phone: "+91 9XXXX 21840",
    department: "Vigilance & Anti-Corruption",
    ministry: "CM Cell / Vigilance",
    district: "Chennai",
    city: "Chennai",
    constituency: "Chepauk-Thiruvallikeni",
    ward: "Ward 114",
    owner: "CM Cell Protected Intake",
    ageDays: 13,
    dueInHours: -42,
    breachHours: 42,
    queue: { primary: "CM Cell Protected Queue", secondary: ["Vigilance Officer", "Revenue Minister Dashboard"] },
    slaStages: makeStages("CM Cell Escalated", "breached"),
    escalationHistory: ["Verification bypassed local visibility", "Protected queue", "CM Cell directive pending"],
    privacy: "Protected corruption",
    description: "Citizen alleges an illegal demand during building approval processing. Identity must be masked outside protected users.",
    evidence: ["Audio clip placeholder", "Receipt photo placeholder", "Office visit note"],
    timeline: makeTimeline("CM Cell Escalated", "CM Cell Protected Intake"),
  },
  {
    id: "TN-WH-260513-0142",
    title: "Sewage overflow near school entrance",
    category: "Sanitation",
    status: "Ministry Queue",
    slaState: "breached",
    priority: "High",
    protectedCase: false,
    reporter: "A. Meena",
    phone: "+91 9XXXX 90122",
    department: "Municipal Administration",
    ministry: "Municipal Administration & Water Supply",
    district: "Madurai",
    city: "Madurai",
    constituency: "Madurai Central",
    ward: "Ward 52",
    owner: "MAWS Ministry Queue",
    ageDays: 11,
    dueInHours: -18,
    breachHours: 18,
    queue: { primary: "MAWS Ministry Queue", secondary: ["Madurai MLA", "Ward 52 Councillor"] },
    slaStages: makeStages("Ministry Queue", "breached"),
    escalationHistory: ["Local queue SLA breached", "Primary moved to ministry", "MLA retained secondary visibility"],
    privacy: "Identity masked",
    description: "Overflow has continued for four days near a school. Field photo and location pin are available.",
    evidence: ["Photo placeholder", "Location pin", "Resident association note"],
    timeline: makeTimeline("Ministry Queue", "MAWS Ministry Queue"),
  },
  {
    id: "TN-WH-260514-0327",
    title: "Major potholes on bus corridor",
    category: "Roads",
    status: "Local/MLA Queue",
    slaState: "dueSoon",
    priority: "High",
    protectedCase: false,
    reporter: "S. Priya",
    phone: "+91 9XXXX 33018",
    department: "Roads & Highways",
    ministry: "Highways and Minor Ports",
    district: "Coimbatore",
    city: "Coimbatore",
    constituency: "Coimbatore South",
    ward: "Ward 82",
    owner: "Local Roads Engineer",
    ageDays: 5,
    dueInHours: 16,
    breachHours: 0,
    queue: { primary: "Councillor / Local Owner", secondary: ["MLA Dashboard", "Highways Department"] },
    slaStages: makeStages("Local/MLA Queue", "dueSoon"),
    escalationHistory: ["Verified", "Local SLA running", "Due in 16 hours"],
    privacy: "Identity masked",
    description: "Two-wheeler accidents reported near the bus stop. Citizen added photo references.",
    evidence: ["Road photos", "Accident witness note"],
    timeline: makeTimeline("Local/MLA Queue", "Local Roads Engineer"),
  },
  {
    id: "TN-WH-260515-0064",
    title: "Incorrect water supply location details",
    category: "Water",
    status: "Awaiting Citizen",
    slaState: "awaitingCitizen",
    priority: "Medium",
    protectedCase: false,
    reporter: "N. Farzana",
    phone: "+91 9XXXX 55201",
    department: "Water Supply Board",
    ministry: "Municipal Administration & Water Supply",
    district: "Thiruvallur",
    city: "Avadi",
    constituency: "Avadi",
    ward: "Ward 22",
    owner: "Ticket Verification Team",
    ageDays: 2,
    dueInHours: 22,
    breachHours: 0,
    queue: { primary: "Ticket Verification Team", secondary: ["Citizen action needed"] },
    slaStages: makeStages("Awaiting Citizen", "awaitingCitizen"),
    escalationHistory: ["Verification started", "Sent back for missing street and landmark"],
    privacy: "Identity masked",
    description: "Complaint appears valid but needs a clearer service location for routing.",
    evidence: ["Blurred photo placeholder"],
    timeline: makeTimeline("Awaiting Citizen", "Ticket Verification Team"),
  },
  {
    id: "TN-WH-260516-0219",
    title: "Rejected road complaint under CM review",
    category: "Roads",
    status: "Rejected Review",
    slaState: "dueSoon",
    priority: "Medium",
    protectedCase: false,
    reporter: "M. Senthil",
    phone: "+91 9XXXX 11877",
    department: "Roads & Highways",
    ministry: "Highways and Minor Ports",
    district: "Salem",
    city: "Salem",
    constituency: "Salem West",
    ward: "Ward 14",
    owner: "CM-maintained Rejection Review Team",
    ageDays: 4,
    dueInHours: 31,
    breachHours: 0,
    queue: { primary: "Rejection Review Team", secondary: ["Highways Department"] },
    slaStages: makeStages("Rejected Review", "dueSoon"),
    escalationHistory: ["Verification rejected", "Auto-forwarded for rejection audit"],
    privacy: "Identity masked",
    description: "Verifier marked duplicate, but citizen supplied different ward and photos.",
    evidence: ["Rejected note", "Road photo", "Prior ticket reference"],
    timeline: makeTimeline("Rejected Review", "Rejection Review Team"),
    rejectionReview: "Possible incorrect rejection. Compare photos and ward boundary before closure.",
  },
];

const generatedTickets: GovTicket[] = districtMetrics.map((metric, index) => {
  const department = departmentMetrics[index % departmentMetrics.length];
  const status = statusCycle[index % statusCycle.length];
  const protectedCase = index % 13 === 0;
  const category = protectedCase ? "Corruption" : categoryCycle[index % categoryCycle.length];
  const slaState: SlaState =
    status === "Resolved"
      ? "resolved"
      : status === "Awaiting Citizen"
        ? "awaitingCitizen"
        : index % 5 === 0 || metric.breached > 700
          ? "breached"
          : index % 3 === 0
            ? "dueSoon"
            : "onTrack";
  const primary =
    status === "CM Cell Escalated"
      ? "CM Cell Command Queue"
      : status === "Ministry Queue"
        ? `${department.ministry} Queue`
        : status === "Verification" || status === "Awaiting Citizen"
          ? "Ticket Verification Team"
          : status === "Rejected Review"
            ? "Rejection Review Team"
            : status === "Resolved"
              ? "Closed Queue"
              : "Councillor / Local Owner";
  const secondary =
    status === "CM Cell Escalated"
      ? [department.ministry, "District Collector"]
      : status === "Ministry Queue"
        ? [`${metric.district} MLA`, "Local Owner"]
        : status === "Local/MLA Queue"
          ? [department.department, `${metric.district} District Monitor`]
          : [];

  return {
    id: `TN-WH-2605${String(10 + (index % 19)).padStart(2, "0")}-${String(300 + index).padStart(4, "0")}`,
    title: issueTitles[index % issueTitles.length],
    category,
    status,
    slaState,
    priority: priorityCycle[index % priorityCycle.length],
    protectedCase,
    reporter: ["K. Anitha", "B. Ravi", "J. Mary", "P. Karthik", "S. Rahman"][index % 5],
    phone: `+91 9XXXX ${String(12000 + index * 173).slice(0, 5)}`,
    department: protectedCase ? "Vigilance & Anti-Corruption" : department.department,
    ministry: protectedCase ? "CM Cell / Vigilance" : department.ministry,
    district: metric.district,
    city: metric.district === "The Nilgiris" ? "Udhagamandalam" : metric.district,
    constituency: `${metric.district} ${["North", "South", "East", "West", "Central"][index % 5]}`,
    ward: `Ward ${12 + (index * 7) % 118}`,
    owner: primary,
    ageDays: Math.max(1, Math.round(metric.avgAge + (index % 6))),
    dueInHours: slaState === "breached" ? -1 * (8 + (index % 5) * 9) : 12 + (index % 8) * 9,
    breachHours: slaState === "breached" ? 8 + (index % 5) * 9 : 0,
    queue: { primary, secondary },
    slaStages: makeStages(status, slaState),
    escalationHistory:
      status === "CM Cell Escalated"
        ? ["Local SLA breached", "Ministry SLA breached", "Primary moved to CM Cell"]
        : status === "Ministry Queue"
          ? ["Local SLA breached", "Primary moved to ministry", "Local remains secondary"]
          : ["Verified intake", "Primary queue assigned"],
    privacy: protectedCase ? "Protected corruption" : "Identity masked",
    description: `Representative ${category.toLowerCase()} complaint from ${metric.district}. The prototype uses mock evidence and state-level SLA routing.`,
    evidence: ["Photo placeholder", "Location pin", "Citizen note"],
    timeline: makeTimeline(status, primary),
    rejectionReview: status === "Rejected Review" ? "Rejected ticket is pending independent CM-maintained review." : undefined,
  };
});

const tickets: GovTicket[] = [...seedTickets, ...generatedTickets];

const navItems: { id: DashboardView; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "heatmap", label: "Heatmap", icon: MapIcon },
  { id: "tickets", label: "Tickets", icon: Ticket },
  { id: "ministries", label: "Ministries", icon: Building2 },
  { id: "rejections", label: "Rejections", icon: RotateCcw },
  { id: "protected", label: "Protected Queue", icon: LockKeyhole },
];

const queueFilters: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "primary", label: "Primary queue" },
  { id: "secondary", label: "Secondary visibility" },
  { id: "breached", label: "SLA breached" },
  { id: "dueSoon", label: "Due soon" },
  { id: "protected", label: "Protected" },
  { id: "rejected", label: "Rejected review" },
  { id: "resolved", label: "Resolved" },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function getRole(role: GovRole) {
  return roleScopes.find((scope) => scope.id === role) ?? roleScopes[0];
}

function sumDistricts(list: GeoMetric[], key: keyof Pick<GeoMetric, "open" | "breached" | "dueToday" | "due48" | "escalated" | "protectedCount">) {
  return list.reduce((total, item) => total + item[key], 0);
}

function roleDistricts(role: RoleScope) {
  if (!role.focusDistricts) return districtMetrics;
  return districtMetrics.filter((metric) => role.focusDistricts?.includes(metric.district));
}

function roleDepartments(role: RoleScope) {
  if (!role.focusDepartments) return departmentMetrics;
  return departmentMetrics.filter(
    (metric) => role.focusDepartments?.includes(metric.department) || role.focusDepartments?.includes(metric.ministry),
  );
}

function roleAggregate(role: RoleScope) {
  const scopedDistricts = roleDistricts(role);
  const scopedDepartments = roleDepartments(role);

  if (role.id === "department-minister") {
    return {
      open: scopedDepartments.reduce((total, item) => total + item.open, 0),
      breached: scopedDepartments.reduce((total, item) => total + item.breached, 0),
      dueToday: 1240,
      due48: scopedDepartments.reduce((total, item) => total + item.dueSoon, 0),
      escalated: scopedDepartments.reduce((total, item) => total + item.cmEscalated, 0),
      protectedCount: scopedDepartments.reduce((total, item) => total + item.protectedCount, 0),
      avgAge: 8.8,
      rejections: 420,
    };
  }

  if (role.id === "department-officer") {
    return {
      open: 7340,
      breached: 920,
      dueToday: 280,
      due48: 1130,
      escalated: 118,
      protectedCount: 0,
      avgAge: 6.4,
      rejections: 82,
    };
  }

  if (role.id === "mla") {
    return {
      open: Math.round(sumDistricts(scopedDistricts, "open") * 0.22),
      breached: Math.round(sumDistricts(scopedDistricts, "breached") * 0.24),
      dueToday: Math.round(sumDistricts(scopedDistricts, "dueToday") * 0.18),
      due48: Math.round(sumDistricts(scopedDistricts, "due48") * 0.2),
      escalated: Math.round(sumDistricts(scopedDistricts, "escalated") * 0.25),
      protectedCount: 0,
      avgAge: 7.2,
      rejections: 54,
    };
  }

  if (role.id === "councillor") {
    return {
      open: 286,
      breached: 31,
      dueToday: 18,
      due48: 42,
      escalated: 9,
      protectedCount: 0,
      avgAge: 4.6,
      rejections: 7,
    };
  }

  if (role.id === "verification") {
    return {
      open: 6410,
      breached: 710,
      dueToday: 980,
      due48: 2170,
      escalated: 130,
      protectedCount: 680,
      avgAge: 1.6,
      rejections: 1120,
    };
  }

  if (role.id === "rejection-review") {
    return {
      open: 1880,
      breached: 260,
      dueToday: 310,
      due48: 690,
      escalated: 140,
      protectedCount: 190,
      avgAge: 3.3,
      rejections: 1880,
    };
  }

  return {
    open: sumDistricts(scopedDistricts, "open"),
    breached: sumDistricts(scopedDistricts, "breached"),
    dueToday: sumDistricts(scopedDistricts, "dueToday"),
    due48: sumDistricts(scopedDistricts, "due48"),
    escalated: sumDistricts(scopedDistricts, "escalated"),
    protectedCount: sumDistricts(scopedDistricts, "protectedCount"),
    avgAge: Number((scopedDistricts.reduce((total, item) => total + item.avgAge, 0) / scopedDistricts.length).toFixed(1)),
    rejections: 2440,
  };
}

function ministryRollups() {
  const rollups = new Map<string, DepartmentMetric>();

  departmentMetrics.forEach((metric) => {
    const existing = rollups.get(metric.ministry);
    if (!existing) {
      rollups.set(metric.ministry, { ...metric, department: metric.ministry });
      return;
    }

    const open = existing.open + metric.open;
    rollups.set(metric.ministry, {
      ...existing,
      open,
      breached: existing.breached + metric.breached,
      dueSoon: existing.dueSoon + metric.dueSoon,
      cmEscalated: existing.cmEscalated + metric.cmEscalated,
      protectedCount: existing.protectedCount + metric.protectedCount,
      avgAge: Number(((existing.avgAge + metric.avgAge) / 2).toFixed(1)),
      resolutionRate: Math.round((existing.resolutionRate * existing.open + metric.resolutionRate * metric.open) / open),
      trend: Math.round((existing.trend + metric.trend) / 2),
    });
  });

  return [...rollups.values()].sort((a, b) => b.breached - a.breached);
}

function ministryDistrictMetrics() {
  return districtMetrics
    .map((metric, index) => {
      const focusBoost = metric.topDepartment === "Water Supply Board" || metric.topDepartment === "Municipal Administration" ? 0.58 : 0.31;
      const open = Math.round(metric.open * (focusBoost + (index % 5) * 0.025));
      const breached = Math.round(open * (0.07 + (index % 6) * 0.013));
      const dueToday = Math.round(breached * 0.38 + (index % 4) * 9);
      const due48 = Math.round(open * 0.14 + (index % 5) * 17);
      const escalatedToCm = Math.round(breached * 0.18 + (index % 3) * 7);
      return {
        district: metric.district,
        open,
        breached,
        dueToday,
        due48,
        escalatedToCm,
        avgAge: Number((5.1 + (index % 7) * 0.55).toFixed(1)),
        owner: index % 2 === 0 ? "Water Supply Board" : "Municipal Administration",
        fieldTeams: 4 + (index % 6),
        resolutionRate: 62 + (index % 8) * 4,
      };
    })
    .sort((a, b) => b.breached - a.breached);
}

function localVisibleTickets(role: RoleScope) {
  return tickets
    .filter((ticket) => isTicketVisibleForRole(ticket, role))
    .filter((ticket) => ticket.status !== "Resolved")
    .sort((a, b) => {
      const aRisk = a.slaState === "breached" ? 3 : a.slaState === "dueSoon" ? 2 : a.slaState === "awaitingCitizen" ? 1 : 0;
      const bRisk = b.slaState === "breached" ? 3 : b.slaState === "dueSoon" ? 2 : b.slaState === "awaitingCitizen" ? 1 : 0;
      return bRisk - aRisk || a.dueInHours - b.dueInHours;
    });
}

function cmEscalationTickets() {
  return tickets
    .filter((ticket) => ticket.status === "CM Cell Escalated" || ticket.queue.primary.includes("CM Cell"))
    .sort((a, b) => b.breachHours - a.breachHours)
    .slice(0, 6);
}

function isTicketVisibleForRole(ticket: GovTicket, role: RoleScope) {
  if (role.id === "cm-cell") return true;
  if (role.id === "verification") return ticket.status === "Verification" || ticket.status === "Awaiting Citizen" || ticket.protectedCase;
  if (role.id === "rejection-review") return ticket.status === "Rejected Review" || Boolean(ticket.rejectionReview);
  if (role.id === "department-minister") {
    return (
      !ticket.protectedCase &&
      (ticket.ministry === MINISTER_MINISTRY || ticket.queue.secondary.includes(MINISTER_MINISTRY))
    );
  }
  if (role.id === "department-officer") {
    return !ticket.protectedCase && (ticket.department === "Water Supply Board" || ticket.department === "Municipal Administration");
  }
  if (role.id === "mla") return !ticket.protectedCase && role.focusDistricts?.includes(ticket.district);
  if (role.id === "councillor") return !ticket.protectedCase && ticket.district === "Chennai" && ticket.status !== "Ministry Queue";
  return true;
}

function filterTickets({
  role,
  queueFilter,
  selectedDistrict,
  search,
}: {
  role: RoleScope;
  queueFilter: QueueFilter;
  selectedDistrict: string | null;
  search: string;
}) {
  const needle = search.trim().toLowerCase();

  return tickets.filter((ticket) => {
    if (!isTicketVisibleForRole(ticket, role)) return false;
    if (selectedDistrict && ticket.district !== selectedDistrict) return false;
    if (needle) {
      const haystack = [
        ticket.id,
        ticket.title,
        ticket.category,
        ticket.district,
        ticket.city,
        ticket.constituency,
        ticket.ward,
        ticket.department,
        ticket.ministry,
        ticket.owner,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    if (queueFilter === "primary") {
      if (role.id === "cm-cell") return ticket.queue.primary.includes("CM Cell");
      if (role.id === "department-minister") return ticket.queue.primary.includes("Ministry") || ticket.queue.primary.includes("Water");
      if (role.id === "department-officer") return ticket.queue.primary.includes("Water") || ticket.queue.primary.includes("Municipal");
      if (role.id === "mla") return ticket.queue.primary.includes("Local") || ticket.queue.secondary.some((item) => item.includes("MLA"));
      if (role.id === "councillor") return ticket.queue.primary.includes("Local") || ticket.queue.primary.includes("Councillor");
      if (role.id === "verification") return ticket.queue.primary.includes("Verification");
      if (role.id === "rejection-review") return ticket.queue.primary.includes("Rejection");
    }
    if (queueFilter === "secondary") return ticket.queue.secondary.length > 0;
    if (queueFilter === "breached") return ticket.slaState === "breached";
    if (queueFilter === "dueSoon") return ticket.slaState === "dueSoon";
    if (queueFilter === "protected") return ticket.protectedCase && role.canSeeProtectedQueue;
    if (queueFilter === "rejected") return ticket.status === "Rejected Review";
    if (queueFilter === "resolved") return ticket.status === "Resolved";
    return true;
  });
}

function slaLabel(ticket: GovTicket) {
  if (ticket.slaState === "resolved") return "Resolved";
  if (ticket.slaState === "awaitingCitizen") return "Citizen info";
  if (ticket.slaState === "breached") return `${ticket.breachHours}h breached`;
  if (ticket.slaState === "dueSoon") return `${ticket.dueInHours}h left`;
  return `${ticket.dueInHours}h on track`;
}

function districtName(feature: GeoFeature) {
  return String(feature.properties.dtname ?? feature.properties.district ?? feature.properties.DISTRICT ?? feature.properties.name ?? "");
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
  const polygons = (feature.geometry.coordinates as [number, number][][][]) ?? [];
  return polygons.flat();
}

function metricForDistrict(name: string) {
  const normalized = normalize(name);
  return districtMetrics.find((metric) => normalize(metric.district) === normalized);
}

function metricValue(metric: GeoMetric, mode: MetricMode) {
  if (mode === "breach") return metric.breached;
  if (mode === "escalation") return Math.round((metric.escalated / Math.max(metric.open, 1)) * 100);
  if (mode === "age") return metric.avgAge;
  return metric.open;
}

function metricLabel(mode: MetricMode) {
  if (mode === "breach") return "SLA breaches";
  if (mode === "escalation") return "Escalation rate";
  if (mode === "age") return "Average age";
  return "Open tickets";
}

function toneForMetric(metric: GeoMetric, mode: MetricMode) {
  const value = metricValue(metric, mode);
  if (mode === "open") {
    if (value > 6000) return "critical";
    if (value > 4300) return "high";
    if (value > 2700) return "medium";
    return "low";
  }
  if (mode === "breach") {
    if (value > 1000) return "critical";
    if (value > 620) return "high";
    if (value > 330) return "medium";
    return "low";
  }
  if (mode === "escalation") {
    if (value > 8) return "critical";
    if (value > 6) return "high";
    if (value > 4) return "medium";
    return "low";
  }
  if (value > 8.5) return "critical";
  if (value > 7) return "high";
  if (value > 5.5) return "medium";
  return "low";
}

function maskedReporter(ticket: GovTicket, role: RoleScope) {
  if (role.canSeeReporterIdentity) return `${ticket.reporter} · ${ticket.phone}`;
  if (ticket.protectedCase) return "Masked protected identity";
  return "Masked citizen identity";
}

function useDistrictGeoJson() {
  const [geoJson, setGeoJson] = useState<GeoCollection | null>(window.__TN_DISTRICT_GEOJSON__ ?? null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(window.__TN_DISTRICT_GEOJSON__ ? "ready" : "loading");

  useEffect(() => {
    if (window.__TN_DISTRICT_GEOJSON__) return;

    let cancelled = false;
    fetch("/assets/data/tamil-nadu-districts.geojson")
      .then((response) => {
        if (!response.ok) throw new Error("District map failed to load");
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

function KpiCard({
  label,
  value,
  meta,
  tone,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  meta: string;
  tone: "red" | "amber" | "green" | "dark";
  icon: typeof Gauge;
  onClick: () => void;
}) {
  return (
    <button className={`kpi-card tone-${tone}`} onClick={onClick} type="button">
      <span className="kpi-icon">
        <Icon size={18} />
      </span>
      <span className="kpi-label">{label}</span>
      <strong>{value}</strong>
      <span className="kpi-meta">{meta}</span>
    </button>
  );
}

function Header({
  role,
  activeRole,
  setActiveRole,
  dateRange,
  setDateRange,
}: {
  role: RoleScope;
  activeRole: GovRole;
  setActiveRole: (role: GovRole) => void;
  dateRange: string;
  setDateRange: (range: string) => void;
}) {
  return (
    <header className="gov-header">
      <div className="brand-lockup">
        <img alt="Whistle logo" className="brand-logo" src={ASSETS.logo} />
        <div>
          <strong>Whistle</strong>
          <span>Government Operations Dashboard</span>
        </div>
      </div>

      <div className="gov-emblem-block">
        <img alt="Neutral civic service mark" src={ASSETS.emblem} />
        <div>
          <strong>Tamil Nadu Government</strong>
          <span>Citizen grievance command center</span>
        </div>
      </div>

      <div className="header-controls">
        <label>
          Role
          <select value={activeRole} onChange={(event) => setActiveRole(event.target.value as GovRole)}>
            {roleScopes.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Range
          <select value={dateRange} onChange={(event) => setDateRange(event.target.value)}>
            <option>Today</option>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Quarter to date</option>
          </select>
        </label>
        <div className="role-pill">
          <UserCog size={16} />
          <span>{role.shortLabel}</span>
        </div>
      </div>
    </header>
  );
}

function Sidebar({
  activeView,
  setActiveView,
  selectedDistrict,
  clearDistrict,
}: {
  activeView: DashboardView;
  setActiveView: (view: DashboardView) => void;
  selectedDistrict: string | null;
  clearDistrict: () => void;
}) {
  return (
    <aside className="gov-sidebar">
      <nav>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={activeView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActiveView(item.id)}
              type="button"
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {selectedDistrict ? (
        <div className="district-filter">
          <span>District filter</span>
          <strong>{selectedDistrict}</strong>
          <button onClick={clearDistrict} type="button">
            Clear
          </button>
        </div>
      ) : (
        <div className="district-filter muted">
          <span>District filter</span>
          <strong>Statewide</strong>
          <p>Click a heatmap district to drill into queues.</p>
        </div>
      )}

      <div className="chief-card">
        <img alt="Campaign portrait placeholder" src={ASSETS.portrait} />
        <div>
          <strong>CM visibility</strong>
          <span>Every SLA breach remains visible after escalation.</span>
        </div>
      </div>
    </aside>
  );
}

function RoleSummary({ role }: { role: RoleScope }) {
  return (
    <section className="role-summary">
      <div>
        <span className="eyebrow">Current access</span>
        <h1>{role.label}</h1>
        <div className="role-goal">
          <Gauge size={15} />
          <span>{role.goal}</span>
        </div>
        <p>{role.description}</p>
      </div>
      <div className="permission-grid">
        <div>
          {role.canSeeProtectedQueue ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
          <span>Protected queue</span>
          <strong>{role.canSeeProtectedQueue ? "Visible" : "Hidden"}</strong>
        </div>
        <div>
          {role.canSeeReporterIdentity ? <Eye size={18} /> : <EyeOff size={18} />}
          <span>Citizen identity</span>
          <strong>{role.canSeeReporterIdentity ? "Allowed" : "Masked"}</strong>
        </div>
        <div>
          <Layers3 size={18} />
          <span>Scope</span>
          <strong>{role.scope}</strong>
        </div>
      </div>
    </section>
  );
}

function KpiGrid({
  role,
  onOpenQueue,
}: {
  role: RoleScope;
  onOpenQueue: (filter: QueueFilter, view?: DashboardView) => void;
}) {
  const aggregate = roleAggregate(role);
  const ministryRows = ministryDistrictMetrics();
  const localRows = localVisibleTickets(role);
  const localEscalated = localRows.filter((ticket) => ticket.status === "Ministry Queue" || ticket.status === "CM Cell Escalated").length;
  const localRisk = localRows.filter((ticket) => ticket.slaState === "breached" || ticket.slaState === "dueSoon").length;
  const commonQueueClick = (filter: QueueFilter, view: DashboardView = "tickets") => () => onOpenQueue(filter, view);

  const cards =
    role.id === "department-minister"
      ? [
          {
            icon: Building2,
            label: "MAWS open",
            meta: "Water + municipal tickets",
            onClick: commonQueueClick("all"),
            tone: "dark" as const,
            value: formatNumber(aggregate.open),
          },
          {
            icon: AlertTriangle,
            label: "District SLA breaches",
            meta: "Needs district action",
            onClick: commonQueueClick("breached"),
            tone: "red" as const,
            value: formatNumber(aggregate.breached),
          },
          {
            icon: Clock3,
            label: "Due today",
            meta: "Must be moved today",
            onClick: commonQueueClick("dueSoon"),
            tone: "amber" as const,
            value: formatNumber(aggregate.dueToday),
          },
          {
            icon: TimerReset,
            label: "Due in 48h",
            meta: "Prevent CM escalation",
            onClick: commonQueueClick("dueSoon"),
            tone: "amber" as const,
            value: formatNumber(aggregate.due48),
          },
          {
            icon: Landmark,
            label: "At CM Cell",
            meta: "Already escalated up",
            onClick: commonQueueClick("breached"),
            tone: "red" as const,
            value: formatNumber(aggregate.escalated),
          },
          {
            icon: MapPin,
            label: "Districts at risk",
            meta: "Breach rate above 12%",
            onClick: commonQueueClick("breached"),
            tone: "red" as const,
            value: String(ministryRows.filter((row) => row.breached / row.open > 0.12).length),
          },
          {
            icon: UsersRound,
            label: "Field teams",
            meta: "Active district teams",
            onClick: commonQueueClick("primary"),
            tone: "dark" as const,
            value: formatNumber(ministryRows.reduce((total, row) => total + row.fieldTeams, 0)),
          },
          {
            icon: CheckCircle2,
            label: "Resolution rate",
            meta: "Ministry average",
            onClick: commonQueueClick("resolved"),
            tone: "green" as const,
            value: "70%",
          },
        ]
      : role.id === "mla" || role.id === "councillor"
        ? [
            {
              icon: Ticket,
              label: role.id === "mla" ? "Constituency issues" : "Ward issues",
              meta: "Open local workload",
              onClick: commonQueueClick("all"),
              tone: "dark" as const,
              value: formatNumber(aggregate.open),
            },
            {
              icon: Clock3,
              label: "Due today",
              meta: "Close before escalation",
              onClick: commonQueueClick("dueSoon"),
              tone: "amber" as const,
              value: formatNumber(aggregate.dueToday),
            },
            {
              icon: TimerReset,
              label: "Due in 48h",
              meta: "Needs field movement",
              onClick: commonQueueClick("dueSoon"),
              tone: "amber" as const,
              value: formatNumber(aggregate.due48),
            },
            {
              icon: AlertTriangle,
              label: "Escalation risk",
              meta: "Due soon or breached",
              onClick: commonQueueClick("breached"),
              tone: "red" as const,
              value: String(localRisk || aggregate.breached),
            },
            {
              icon: Landmark,
              label: "Escalated out",
              meta: "Now with ministry/CM",
              onClick: commonQueueClick("secondary"),
              tone: "red" as const,
              value: String(localEscalated || aggregate.escalated),
            },
            {
              icon: CheckCircle2,
              label: "Closed this week",
              meta: "Within local SLA",
              onClick: commonQueueClick("resolved"),
              tone: "green" as const,
              value: role.id === "mla" ? "148" : "23",
            },
            {
              icon: Gauge,
              label: "SLA closure",
              meta: "Local target health",
              onClick: commonQueueClick("all"),
              tone: "green" as const,
              value: role.id === "mla" ? "82%" : "88%",
            },
            {
              icon: MessageSquareWarning,
              label: "Need update",
              meta: "Citizen/field info pending",
              onClick: commonQueueClick("all"),
              tone: "amber" as const,
              value: role.id === "mla" ? "37" : "6",
            },
          ]
        : [
            {
              icon: Ticket,
              label: "Open tickets",
              meta: role.id === "cm-cell" ? "Statewide ministry workload" : "Active visible workload",
              onClick: commonQueueClick("all"),
              tone: "dark" as const,
              value: formatNumber(aggregate.open),
            },
            {
              icon: AlertTriangle,
              label: role.id === "cm-cell" ? "Ministry SLA breaches" : "SLA breached",
              meta: role.id === "cm-cell" ? "Across all ministries" : "Needs command attention",
              onClick: commonQueueClick("breached"),
              tone: "red" as const,
              value: formatNumber(aggregate.breached),
            },
            {
              icon: Clock3,
              label: "Due today",
              meta: "Must move before midnight",
              onClick: commonQueueClick("dueSoon"),
              tone: "amber" as const,
              value: formatNumber(aggregate.dueToday),
            },
            {
              icon: TimerReset,
              label: "Due in 48h",
              meta: "At risk of breach",
              onClick: commonQueueClick("dueSoon"),
              tone: "amber" as const,
              value: formatNumber(aggregate.due48),
            },
            {
              icon: Landmark,
              label: "CM escalated",
              meta: "Primary queue at CM Cell",
              onClick: commonQueueClick("breached"),
              tone: "red" as const,
              value: formatNumber(aggregate.escalated),
            },
            {
              icon: Gauge,
              label: "Average age",
              meta: "Across visible queues",
              onClick: commonQueueClick("all"),
              tone: "dark" as const,
              value: `${aggregate.avgAge}d`,
            },
            {
              icon: RotateCcw,
              label: "Rejection reversals",
              meta: "CM-maintained audit lane",
              onClick: commonQueueClick("rejected", "rejections"),
              tone: "amber" as const,
              value: formatNumber(aggregate.rejections),
            },
            {
              icon: LockKeyhole,
              label: "Protected corruption",
              meta: role.canSeeProtectedQueue ? "Visible to this role" : "Masked for this role",
              onClick: commonQueueClick("protected", "protected"),
              tone: "red" as const,
              value: formatNumber(aggregate.protectedCount),
            },
          ];

  return (
    <section className="kpi-grid">
      {cards.map((card) => (
        <KpiCard
          icon={card.icon}
          key={card.label}
          label={card.label}
          meta={card.meta}
          onClick={card.onClick}
          tone={card.tone}
          value={card.value}
        />
      ))}
    </section>
  );
}

function TamilNaduHeatmap({
  geoJson,
  loadState,
  metricMode,
  setMetricMode,
  selectedDistrict,
  setSelectedDistrict,
  compact = false,
}: {
  geoJson: GeoCollection | null;
  loadState: "loading" | "ready" | "error";
  metricMode: MetricMode;
  setMetricMode: (mode: MetricMode) => void;
  selectedDistrict: string | null;
  setSelectedDistrict: (district: string) => void;
  compact?: boolean;
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

    if (!Number.isFinite(minLon) || !Number.isFinite(maxLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
      return null;
    }
    const width = 420;
    const height = 620;
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

  const selectedMetric = selectedDistrict ? metricForDistrict(selectedDistrict) : null;

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

  return (
    <section className={`heatmap-card ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Tamil Nadu district heatmap</span>
          <h2>{metricLabel(metricMode)}</h2>
        </div>
        <div className="metric-toggle">
          {[
            ["open", "Open"],
            ["breach", "SLA"],
            ["escalation", "Esc."],
            ["age", "Age"],
          ].map(([mode, label]) => (
            <button
              className={metricMode === mode ? "active" : ""}
              key={mode}
              onClick={() => setMetricMode(mode as MetricMode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="heatmap-layout">
        <div className="map-frame">
          {loadState === "loading" && <div className="map-state">Loading sample district map...</div>}
          {loadState === "error" && <div className="map-state error">District map could not be loaded.</div>}
          {geoJson && projection && (
            <svg aria-label="Tamil Nadu district heatmap" className="tn-map" role="img" viewBox="0 0 420 620">
              {geoJson.features.map((feature) => {
                const name = districtName(feature);
                const metric = metricForDistrict(name);
                const tone = metric ? toneForMetric(metric, metricMode) : "low";
                return (
                  <path
                    className={`district district-${tone} ${selectedDistrict === name ? "selected" : ""}`}
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
        <div className="heatmap-panel">
          {selectedMetric ? (
            <>
              <span className="eyebrow">Selected district</span>
              <h3>{selectedMetric.district}</h3>
              <div className="district-stats">
                <span>Open</span>
                <strong>{formatNumber(selectedMetric.open)}</strong>
                <span>SLA breached</span>
                <strong>{formatNumber(selectedMetric.breached)}</strong>
                <span>Due in 48h</span>
                <strong>{formatNumber(selectedMetric.due48)}</strong>
                <span>Top department</span>
                <strong>{selectedMetric.topDepartment}</strong>
              </div>
            </>
          ) : (
            <>
              <span className="eyebrow">Statewide map</span>
              <h3>Click a district</h3>
              <p>Heatmap drilldown filters KPI context and ticket queues by district.</p>
            </>
          )}
          <div className="map-legend">
            <span className="legend-low" /> Low
            <span className="legend-medium" /> Medium
            <span className="legend-high" /> High
            <span className="legend-critical" /> Critical
          </div>
        </div>
      </div>
    </section>
  );
}

function SlaRiskList({ onSelectTicket }: { onSelectTicket: (ticket: GovTicket) => void }) {
  const riskTickets = tickets
    .filter((ticket) => ticket.slaState === "breached" || ticket.slaState === "dueSoon")
    .sort((a, b) => b.breachHours - a.breachHours)
    .slice(0, 6);

  return (
    <section className="panel-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SLA breach command center</span>
          <h2>Highest risk tickets</h2>
        </div>
        <Flame size={22} />
      </div>
      <div className="risk-list">
        {riskTickets.map((ticket) => (
          <button key={ticket.id} onClick={() => onSelectTicket(ticket)} type="button">
            <span className={`status-dot ${ticket.slaState}`} />
            <div>
              <strong>{ticket.title}</strong>
              <small>
                {ticket.district} · {ticket.department}
              </small>
            </div>
            <span className="risk-time">{slaLabel(ticket)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function MinistryPerformance({
  role,
  onDepartmentClick,
}: {
  role: RoleScope;
  onDepartmentClick: (department: string) => void;
}) {
  const metrics = roleDepartments(role)
    .slice()
    .sort((a, b) => b.breached - a.breached);

  return (
    <section className="panel-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Ministry performance</span>
          <h2>SLA compliance ranking</h2>
        </div>
        <Building2 size={22} />
      </div>
      <div className="ministry-list">
        {metrics.map((metric) => {
          const breachRate = Math.round((metric.breached / metric.open) * 100);
          return (
            <button key={metric.department} onClick={() => onDepartmentClick(metric.department)} type="button">
              <div>
                <strong>{metric.department}</strong>
                <span>{metric.ministry}</span>
              </div>
              <div className="ministry-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, breachRate * 4)}%` }} />
              </div>
              <span className="ministry-score">{breachRate}% breach</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CmMinistryCommand({ onDepartmentClick }: { onDepartmentClick: (department: string) => void }) {
  return (
    <section className="panel-card command-card span-2">
      <div className="section-heading">
        <div>
          <span className="eyebrow">CM Cell command view</span>
          <h2>Ministry accountability ranking</h2>
        </div>
        <Landmark size={22} />
      </div>
      <div className="command-list">
        {ministryRollups().map((metric, index) => {
          const breachRate = Math.round((metric.breached / metric.open) * 100);
          return (
            <button key={metric.ministry} onClick={() => onDepartmentClick(metric.ministry)} type="button">
              <span className="rank-badge">{index + 1}</span>
              <div>
                <strong>{metric.ministry}</strong>
                <small>
                  {formatNumber(metric.open)} open · {formatNumber(metric.cmEscalated)} at CM Cell
                </small>
              </div>
              <div className="command-meter" aria-hidden="true">
                <span style={{ width: `${Math.min(100, breachRate * 4)}%` }} />
              </div>
              <strong className="command-risk">{breachRate}% SLA breach</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DistrictMinistryMatrix({
  onDistrictClick,
}: {
  onDistrictClick: (district: string) => void;
}) {
  const rows = districtMetrics
    .slice()
    .sort((a, b) => b.breached - a.breached)
    .slice(0, 8);
  const columns = [
    { label: "MAWS", factor: 0.42 },
    { label: "Roads", factor: 0.28 },
    { label: "Energy", factor: 0.18 },
    { label: "Revenue", factor: 0.14 },
  ];

  return (
    <section className="panel-card matrix-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">District x ministry KPIs</span>
          <h2>Where escalations are forming</h2>
        </div>
        <SlidersHorizontal size={22} />
      </div>
      <div className="matrix-table">
        <div className="matrix-row matrix-head">
          <span>District</span>
          {columns.map((column) => (
            <span key={column.label}>{column.label}</span>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <button className="matrix-row" key={row.district} onClick={() => onDistrictClick(row.district)} type="button">
            <strong>{row.district}</strong>
            {columns.map((column, columnIndex) => {
              const open = Math.round(row.open * (column.factor + ((rowIndex + columnIndex) % 3) * 0.025));
              const breachRate = Math.round(7 + ((rowIndex * 3 + columnIndex * 5) % 14));
              return (
                <span className={breachRate > 16 ? "hot" : breachRate > 11 ? "warm" : ""} key={column.label}>
                  {formatNumber(open)}
                  <small>{breachRate}%</small>
                </span>
              );
            })}
          </button>
        ))}
      </div>
    </section>
  );
}

function CmEscalationPanel({ onSelectTicket }: { onSelectTicket: (ticket: GovTicket) => void }) {
  return (
    <section className="panel-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Escalation handling</span>
          <h2>Awaiting CM Cell decision</h2>
        </div>
        <Bell size={22} />
      </div>
      <div className="risk-list">
        {cmEscalationTickets().map((ticket) => (
          <button key={ticket.id} onClick={() => onSelectTicket(ticket)} type="button">
            <span className={`status-dot ${ticket.slaState}`} />
            <div>
              <strong>{ticket.title}</strong>
              <small>
                {ticket.ministry} · {ticket.district}
              </small>
            </div>
            <span className="risk-time">{slaLabel(ticket)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function MinistryDistrictExecution({
  onDistrictClick,
}: {
  onDistrictClick: (district: string) => void;
}) {
  return (
    <section className="panel-card span-2">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Ministry execution board</span>
          <h2>{MINISTER_MINISTRY}: district performance</h2>
        </div>
        <Building2 size={22} />
      </div>
      <div className="district-execution-list">
        {ministryDistrictMetrics()
          .slice(0, 10)
          .map((row) => {
            const breachRate = Math.round((row.breached / row.open) * 100);
            return (
              <button key={row.district} onClick={() => onDistrictClick(row.district)} type="button">
                <div>
                  <strong>{row.district}</strong>
                  <small>
                    {row.owner} · {row.fieldTeams} field teams
                  </small>
                </div>
                <span>
                  <strong>{formatNumber(row.open)}</strong>
                  Open
                </span>
                <span>
                  <strong>{formatNumber(row.due48)}</strong>
                  Due 48h
                </span>
                <span className={breachRate > 12 ? "danger" : "ok"}>
                  <strong>{breachRate}%</strong>
                  SLA breach
                </span>
                <span>
                  <strong>{formatNumber(row.escalatedToCm)}</strong>
                  At CM
                </span>
              </button>
            );
          })}
      </div>
    </section>
  );
}

function OfficerLoadPanel() {
  const teams = [
    { name: "Chennai Metro Water Response", open: 1280, breach: 212, load: 92 },
    { name: "Madurai Municipal Field Cell", open: 910, breach: 138, load: 78 },
    { name: "Coimbatore Water Board", open: 840, breach: 74, load: 66 },
    { name: "Thiruvallur Urban Services", open: 790, breach: 121, load: 82 },
  ];

  return (
    <section className="panel-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Officer workload</span>
          <h2>Balance action capacity</h2>
        </div>
        <UsersRound size={22} />
      </div>
      <div className="officer-load-list">
        {teams.map((team) => (
          <div key={team.name}>
            <div>
              <strong>{team.name}</strong>
              <small>
                {formatNumber(team.open)} open · {formatNumber(team.breach)} breached
              </small>
            </div>
            <span className="load-bar" aria-hidden="true">
              <span style={{ width: `${team.load}%` }} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MinistryRiskPanel({ onSelectTicket }: { onSelectTicket: (ticket: GovTicket) => void }) {
  const riskTickets = tickets
    .filter((ticket) => ticket.ministry === MINISTER_MINISTRY && !ticket.protectedCase)
    .filter((ticket) => ticket.slaState === "breached" || ticket.slaState === "dueSoon")
    .sort((a, b) => b.breachHours - a.breachHours)
    .slice(0, 5);

  return (
    <section className="panel-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Prevent CM escalation</span>
          <h2>Ministry tickets at risk</h2>
        </div>
        <AlertTriangle size={22} />
      </div>
      <div className="risk-list">
        {riskTickets.map((ticket) => (
          <button key={ticket.id} onClick={() => onSelectTicket(ticket)} type="button">
            <span className={`status-dot ${ticket.slaState}`} />
            <div>
              <strong>{ticket.title}</strong>
              <small>
                {ticket.district} · {ticket.queue.primary}
              </small>
            </div>
            <span className="risk-time">{slaLabel(ticket)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function LocalPriorityQueue({ role, onSelectTicket }: { role: RoleScope; onSelectTicket: (ticket: GovTicket) => void }) {
  const localTickets = localVisibleTickets(role).slice(0, 7);

  return (
    <section className="panel-card span-2">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Close before escalation</span>
          <h2>{role.id === "mla" ? "Constituency priority queue" : "Ward priority queue"}</h2>
        </div>
        <CheckCircle2 size={22} />
      </div>
      <div className="local-queue-list">
        {localTickets.map((ticket) => (
          <button key={ticket.id} onClick={() => onSelectTicket(ticket)} type="button">
            <div>
              <strong>{ticket.title}</strong>
              <small>
                {ticket.district} · {ticket.ward} · {ticket.department}
              </small>
            </div>
            <span className={`sla-chip ${ticket.slaState}`}>{slaLabel(ticket)}</span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}

function LocalEscalationPanel({ role }: { role: RoleScope }) {
  const localTickets = localVisibleTickets(role);
  const escalationRisk = localTickets.filter((ticket) => ticket.slaState === "breached" || ticket.slaState === "dueSoon").length;
  const escalatedOut = localTickets.filter((ticket) => ticket.status === "Ministry Queue" || ticket.status === "CM Cell Escalated").length;

  return (
    <section className="panel-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Escalation control</span>
          <h2>Keep local ownership</h2>
        </div>
        <ShieldAlert size={22} />
      </div>
      <div className="closure-metrics">
        <div>
          <span>Escalation risk</span>
          <strong>{escalationRisk || roleAggregate(role).breached}</strong>
        </div>
        <div>
          <span>Escalated out</span>
          <strong>{escalatedOut || roleAggregate(role).escalated}</strong>
        </div>
        <div>
          <span>Field updates pending</span>
          <strong>{role.id === "mla" ? 37 : 6}</strong>
        </div>
        <div>
          <span>Closed within SLA</span>
          <strong>{role.id === "mla" ? "82%" : "88%"}</strong>
        </div>
      </div>
    </section>
  );
}

function LocalTrendsPanel({ role }: { role: RoleScope }) {
  const labels = role.id === "mla" ? ["Roads", "Water", "Sanitation", "Power"] : ["Drainage", "Road patch", "Street light", "Waste"];

  return (
    <section className="panel-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Local issue trends</span>
          <h2>Recurring blockers</h2>
        </div>
        <MapPin size={22} />
      </div>
      <div className="trend-list">
        {labels.map((label, index) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{formatNumber((role.id === "mla" ? 180 : 24) - index * (role.id === "mla" ? 31 : 4))}</strong>
            <small>{index === 0 ? "Highest repeat category" : "Watch this week"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function QueueToolbar({
  queueFilter,
  setQueueFilter,
  search,
  setSearch,
}: {
  queueFilter: QueueFilter;
  setQueueFilter: (filter: QueueFilter) => void;
  search: string;
  setSearch: (search: string) => void;
}) {
  return (
    <div className="queue-toolbar">
      <div className="filter-tabs">
        {queueFilters.map((filter) => (
          <button
            className={queueFilter === filter.id ? "active" : ""}
            key={filter.id}
            onClick={() => setQueueFilter(filter.id)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>
      <label className="search-box">
        <Search size={17} />
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search ID, district, department, owner..."
          value={search}
        />
      </label>
    </div>
  );
}

function TicketTable({
  role,
  queueFilter,
  selectedDistrict,
  search,
  onSelectTicket,
}: {
  role: RoleScope;
  queueFilter: QueueFilter;
  selectedDistrict: string | null;
  search: string;
  onSelectTicket: (ticket: GovTicket) => void;
}) {
  const visibleTickets = filterTickets({ role, queueFilter, selectedDistrict, search });

  return (
    <section className="ticket-table-card">
      <div className="table-heading">
        <div>
          <span className="eyebrow">Filtered ticket queue</span>
          <h2>
            {selectedDistrict ? `${selectedDistrict} queue` : "Statewide queue"} · {visibleTickets.length} sample rows
          </h2>
        </div>
        <div className="queue-note">
          <Filter size={16} />
          <span>{role.scope}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Department</th>
              <th>District</th>
              <th>Primary queue</th>
              <th>SLA</th>
              <th>Privacy</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleTickets.map((ticket) => (
              <tr key={ticket.id} onClick={() => onSelectTicket(ticket)}>
                <td>
                  <strong>{ticket.id}</strong>
                  <span>{ticket.title}</span>
                </td>
                <td>
                  <strong>{ticket.department}</strong>
                  <span>{ticket.category}</span>
                </td>
                <td>
                  <strong>{ticket.district}</strong>
                  <span>
                    {ticket.constituency} · {ticket.ward}
                  </span>
                </td>
                <td>
                  <strong>{ticket.queue.primary}</strong>
                  <span>{ticket.queue.secondary.length ? `Secondary: ${ticket.queue.secondary.join(", ")}` : "No secondary queue"}</span>
                </td>
                <td>
                  <span className={`sla-chip ${ticket.slaState}`}>{slaLabel(ticket)}</span>
                </td>
                <td>
                  <span className={`privacy-chip ${ticket.protectedCase ? "protected" : ""}`}>
                    {ticket.protectedCase ? "Protected" : "Masked"}
                  </span>
                </td>
                <td>
                  <ChevronRight size={17} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleTickets.length === 0 && (
          <div className="empty-state">
            <FileText size={24} />
            <strong>No visible tickets for this role and filter.</strong>
            <span>Protected or out-of-scope cases remain hidden by policy.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function TicketDetail({
  ticket,
  role,
  onClose,
}: {
  ticket: GovTicket | null;
  role: RoleScope;
  onClose: () => void;
}) {
  if (!ticket) {
    return (
      <aside className="ticket-detail empty">
        <FileCheck2 size={28} />
        <strong>Select a ticket</strong>
        <span>KPI cards, heatmap districts, and queue rows open this read-only workspace.</span>
      </aside>
    );
  }

  const canSeeProtected = !ticket.protectedCase || role.canSeeProtectedQueue;
  const visibleActions = role.allowedActions;

  return (
    <aside className="ticket-detail">
      <div className="detail-top">
        <div>
          <span className="eyebrow">{ticket.id}</span>
          <h2>{ticket.title}</h2>
          <p>
            {ticket.category} · {ticket.district} · {ticket.status}
          </p>
        </div>
        <button onClick={onClose} type="button">
          Close
        </button>
      </div>

      <div className="detail-alert">
        {canSeeProtected ? <ShieldCheck size={18} /> : <EyeOff size={18} />}
        <span>
          {canSeeProtected
            ? "Role can view this ticket workspace. Actions are disabled in the prototype."
            : "Protected details are hidden for this role. Only aggregate status is visible."}
        </span>
      </div>

      <div className="detail-actions">
        {visibleActions.map((action) => (
          <button disabled key={action} type="button">
            {action}
          </button>
        ))}
      </div>

      <div className="detail-grid">
        <div>
          <span>Reporter</span>
          <strong>{maskedReporter(ticket, role)}</strong>
        </div>
        <div>
          <span>Primary queue</span>
          <strong>{ticket.queue.primary}</strong>
        </div>
        <div>
          <span>Secondary visibility</span>
          <strong>{ticket.queue.secondary.length ? ticket.queue.secondary.join(", ") : "None"}</strong>
        </div>
        <div>
          <span>SLA state</span>
          <strong>{slaLabel(ticket)}</strong>
        </div>
        <div>
          <span>Owner</span>
          <strong>{ticket.owner}</strong>
        </div>
        <div>
          <span>Privacy</span>
          <strong>{ticket.privacy}</strong>
        </div>
      </div>

      <section className="detail-section">
        <h3>SLA ladder</h3>
        <div className="sla-ladder">
          {ticket.slaStages.map((stage) => (
            <div className={`sla-stage ${stage.state}`} key={stage.label}>
              <span />
              <div>
                <strong>{stage.label}</strong>
                <small>
                  {stage.owner} · {stage.limit}
                </small>
                <small>
                  {stage.started} to {stage.due}
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>Escalation history</h3>
        <div className="tag-list">
          {ticket.escalationHistory.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>Evidence placeholders</h3>
        <div className="evidence-grid">
          {ticket.evidence.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>Timeline</h3>
        <div className="timeline">
          {ticket.timeline.map((event) => (
            <div className={`timeline-item ${event.tone}`} key={`${event.title}-${event.time}`}>
              <CircleDot size={15} />
              <div>
                <strong>{event.title}</strong>
                <span>{event.time}</span>
                <p>{event.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function Overview({
  role,
  geoJson,
  loadState,
  metricMode,
  setMetricMode,
  selectedDistrict,
  setSelectedDistrict,
  onOpenQueue,
  onSelectTicket,
  onDepartmentClick,
}: {
  role: RoleScope;
  geoJson: GeoCollection | null;
  loadState: "loading" | "ready" | "error";
  metricMode: MetricMode;
  setMetricMode: (mode: MetricMode) => void;
  selectedDistrict: string | null;
  setSelectedDistrict: (district: string) => void;
  onOpenQueue: (filter: QueueFilter, view?: DashboardView) => void;
  onSelectTicket: (ticket: GovTicket) => void;
  onDepartmentClick: (department: string) => void;
}) {
  if (role.id === "cm-cell") {
    return (
      <>
        <RoleSummary role={role} />
        <KpiGrid onOpenQueue={onOpenQueue} role={role} />
        <div className="overview-grid role-command-grid">
          <CmMinistryCommand onDepartmentClick={onDepartmentClick} />
          <CmEscalationPanel onSelectTicket={onSelectTicket} />
          <TamilNaduHeatmap
            compact
            geoJson={geoJson}
            loadState={loadState}
            metricMode={metricMode}
            selectedDistrict={selectedDistrict}
            setMetricMode={setMetricMode}
            setSelectedDistrict={setSelectedDistrict}
          />
          <DistrictMinistryMatrix onDistrictClick={setSelectedDistrict} />
        </div>
      </>
    );
  }

  if (role.id === "department-minister" || role.id === "department-officer") {
    return (
      <>
        <RoleSummary role={role} />
        <KpiGrid onOpenQueue={onOpenQueue} role={role} />
        <div className="overview-grid role-command-grid">
          <MinistryDistrictExecution onDistrictClick={setSelectedDistrict} />
          <MinistryRiskPanel onSelectTicket={onSelectTicket} />
          <OfficerLoadPanel />
          <TamilNaduHeatmap
            compact
            geoJson={geoJson}
            loadState={loadState}
            metricMode={metricMode}
            selectedDistrict={selectedDistrict}
            setMetricMode={setMetricMode}
            setSelectedDistrict={setSelectedDistrict}
          />
        </div>
      </>
    );
  }

  if (role.id === "mla" || role.id === "councillor") {
    return (
      <>
        <RoleSummary role={role} />
        <KpiGrid onOpenQueue={onOpenQueue} role={role} />
        <div className="overview-grid role-command-grid">
          <LocalPriorityQueue onSelectTicket={onSelectTicket} role={role} />
          <LocalEscalationPanel role={role} />
          <LocalTrendsPanel role={role} />
          <TamilNaduHeatmap
            compact
            geoJson={geoJson}
            loadState={loadState}
            metricMode={metricMode}
            selectedDistrict={selectedDistrict}
            setMetricMode={setMetricMode}
            setSelectedDistrict={setSelectedDistrict}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <RoleSummary role={role} />
      <KpiGrid onOpenQueue={onOpenQueue} role={role} />
      <div className="overview-grid">
        <SlaRiskList onSelectTicket={onSelectTicket} />
        <TamilNaduHeatmap
          compact
          geoJson={geoJson}
          loadState={loadState}
          metricMode={metricMode}
          selectedDistrict={selectedDistrict}
          setMetricMode={setMetricMode}
          setSelectedDistrict={setSelectedDistrict}
        />
        <MinistryPerformance onDepartmentClick={onDepartmentClick} role={role} />
      </div>
    </>
  );
}

function MinistriesView({ role, onDepartmentClick }: { role: RoleScope; onDepartmentClick: (department: string) => void }) {
  const metrics = roleDepartments(role).slice().sort((a, b) => b.open - a.open);

  return (
    <section className="ministries-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Department and ministry KPIs</span>
          <h2>Performance by operating owner</h2>
        </div>
      </div>
      <div className="department-grid">
        {metrics.map((metric) => (
          <button className="department-card" key={metric.department} onClick={() => onDepartmentClick(metric.department)} type="button">
            <div>
              <strong>{metric.department}</strong>
              <span>{metric.ministry}</span>
            </div>
            <div className="department-stats">
              <span>Open</span>
              <strong>{formatNumber(metric.open)}</strong>
              <span>Breached</span>
              <strong>{formatNumber(metric.breached)}</strong>
              <span>CM escalated</span>
              <strong>{formatNumber(metric.cmEscalated)}</strong>
              <span>Resolution</span>
              <strong>{metric.resolutionRate}%</strong>
            </div>
            <div className={`trend ${metric.trend > 0 ? "up" : "down"}`}>
              {metric.trend > 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
              <span>{Math.abs(metric.trend)}% ticket trend</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProtectedPolicy({ role }: { role: RoleScope }) {
  return (
    <section className="policy-strip">
      <LockKeyhole size={20} />
      <div>
        <strong>{role.canSeeProtectedQueue ? "Protected queue visible" : "Protected queue hidden"}</strong>
        <span>
          Corruption tickets bypass councillor and local department visibility until screened by protected users. Reporter identity is
          masked unless state configuration permits the role.
        </span>
      </div>
    </section>
  );
}

export default function GovDashboard() {
  const [activeRole, setActiveRole] = useState<GovRole>("cm-cell");
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [metricMode, setMetricMode] = useState<MetricMode>("breach");
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<GovTicket | null>(seedTickets[0]);
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState("Last 30 days");
  const { geoJson, loadState } = useDistrictGeoJson();
  const role = getRole(activeRole);

  useEffect(() => {
    const nextRole = getRole(activeRole);
    setActiveView("overview");
    setQueueFilter("all");
    setSelectedDistrict(null);
    setSearch("");
    setSelectedTicket(tickets.find((ticket) => isTicketVisibleForRole(ticket, nextRole)) ?? null);
  }, [activeRole]);

  function openQueue(filter: QueueFilter, view: DashboardView = "tickets") {
    if (filter === "protected" && !role.canSeeProtectedQueue) {
      setActiveView("tickets");
      setQueueFilter("all");
      return;
    }
    setQueueFilter(filter);
    setActiveView(view);
  }

  function selectDistrict(district: string) {
    setSelectedDistrict(district);
    setActiveView("heatmap");
    setQueueFilter("all");
  }

  function selectTicket(ticket: GovTicket) {
    setSelectedTicket(ticket);
    setActiveView("tickets");
  }

  function onDepartmentClick(department: string) {
    setSearch(department);
    setQueueFilter("all");
    setActiveView("tickets");
  }

  function renderMainView() {
    if (activeView === "overview") {
      return (
        <Overview
          geoJson={geoJson}
          loadState={loadState}
          metricMode={metricMode}
          onDepartmentClick={onDepartmentClick}
          onOpenQueue={openQueue}
          onSelectTicket={selectTicket}
          role={role}
          selectedDistrict={selectedDistrict}
          setMetricMode={setMetricMode}
          setSelectedDistrict={selectDistrict}
        />
      );
    }

    if (activeView === "heatmap") {
      return (
        <>
          <RoleSummary role={role} />
          <TamilNaduHeatmap
            geoJson={geoJson}
            loadState={loadState}
            metricMode={metricMode}
            selectedDistrict={selectedDistrict}
            setMetricMode={setMetricMode}
            setSelectedDistrict={selectDistrict}
          />
          <QueueToolbar queueFilter={queueFilter} search={search} setQueueFilter={setQueueFilter} setSearch={setSearch} />
          <TicketTable
            onSelectTicket={selectTicket}
            queueFilter={queueFilter}
            role={role}
            search={search}
            selectedDistrict={selectedDistrict}
          />
        </>
      );
    }

    if (activeView === "ministries") {
      return (
        <>
          <RoleSummary role={role} />
          <MinistriesView onDepartmentClick={onDepartmentClick} role={role} />
        </>
      );
    }

    if (activeView === "rejections") {
      return (
        <>
          <RoleSummary role={role} />
          <ProtectedPolicy role={role} />
          <QueueToolbar queueFilter={queueFilter} search={search} setQueueFilter={setQueueFilter} setSearch={setSearch} />
          <TicketTable
            onSelectTicket={selectTicket}
            queueFilter="rejected"
            role={role}
            search={search}
            selectedDistrict={selectedDistrict}
          />
        </>
      );
    }

    if (activeView === "protected") {
      return (
        <>
          <RoleSummary role={role} />
          <ProtectedPolicy role={role} />
          <QueueToolbar queueFilter={queueFilter} search={search} setQueueFilter={setQueueFilter} setSearch={setSearch} />
          <TicketTable
            onSelectTicket={selectTicket}
            queueFilter={role.canSeeProtectedQueue ? "protected" : "all"}
            role={role}
            search={search}
            selectedDistrict={selectedDistrict}
          />
        </>
      );
    }

    return (
      <>
        <RoleSummary role={role} />
        <QueueToolbar queueFilter={queueFilter} search={search} setQueueFilter={setQueueFilter} setSearch={setSearch} />
        <TicketTable
          onSelectTicket={selectTicket}
          queueFilter={queueFilter}
          role={role}
          search={search}
          selectedDistrict={selectedDistrict}
        />
      </>
    );
  }

  return (
    <div className="gov-app">
      <Header
        activeRole={activeRole}
        dateRange={dateRange}
        role={role}
        setActiveRole={setActiveRole}
        setDateRange={setDateRange}
      />
      <div className="gov-shell">
        <Sidebar
          activeView={activeView}
          clearDistrict={() => setSelectedDistrict(null)}
          selectedDistrict={selectedDistrict}
          setActiveView={setActiveView}
        />
        <main className="gov-main">{renderMainView()}</main>
        <TicketDetail onClose={() => setSelectedTicket(null)} role={role} ticket={selectedTicket} />
      </div>
      <div className="view-only-banner">
        <Sparkles size={16} />
        <span>Prototype mode: controls are clickable for navigation only. Ticket actions are intentionally view-only.</span>
      </div>
    </div>
  );
}
