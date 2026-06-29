import "./focus.css";
import type { CSSProperties } from "react";
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

type RuntimeAssets = {
  logo: string;
  emblem: string;
  civic: string;
};

type StageId = "citizen" | "verification" | "local" | "ministry" | "cm" | "resolution" | "public";

type Stage = {
  id: StageId;
  label: string;
  detail: string;
  sla: string;
  visibility: string;
  icon: LucideIcon;
};

type JourneyEvent = {
  stage: StageId;
  label: string;
  detail: string;
  state?: "hold" | "escalate" | "closed" | "protected";
};

type Journey = {
  id: string;
  category: string;
  title: string;
  location: string;
  citizenSignal: string;
  routeLabel: string;
  outcome: string;
  accent: string;
  tint: string;
  icon: LucideIcon;
  events: JourneyEvent[];
  proof: string[];
};

type GovernanceSignal = {
  label: string;
  detail: string;
  icon: LucideIcon;
};

declare global {
  interface Window {
    __WHISTLE_WORKFLOW_ASSETS__?: RuntimeAssets;
  }
}

const ASSETS: RuntimeAssets = window.__WHISTLE_WORKFLOW_ASSETS__ ?? {
  logo: "/assets/brand/whistle-fake-logo.svg",
  emblem: "/assets/brand/whistle-civic-mark.svg",
  civic: "/assets/brand/whistle-civic-mark.svg",
};

const stages: Stage[] = [
  {
    id: "citizen",
    label: "Citizen PWA",
    detail: "Complaint, location, media, OTP check, ticket ID.",
    sla: "Instant intake",
    visibility: "Citizen can track",
    icon: Megaphone,
  },
  {
    id: "verification",
    label: "Verification Desk",
    detail: "Completeness, category, duplicates, evidence, sensitivity.",
    sla: "2 day SLA",
    visibility: "Intake audit visible",
    icon: Search,
  },
  {
    id: "local",
    label: "MLA / Local Queue",
    detail: "Constituency ownership, field action, closure proof.",
    sla: "7 day SLA",
    visibility: "MLA stays informed",
    icon: MapPin,
  },
  {
    id: "ministry",
    label: "Ministry Desk",
    detail: "Portfolio ownership, district bottlenecks, department action.",
    sla: "10 day SLA",
    visibility: "Minister scope only",
    icon: Landmark,
  },
  {
    id: "cm",
    label: "CM Cell",
    detail: "Statewide command, escalations, protected review, exceptions.",
    sla: "State configured",
    visibility: "Restricted command",
    icon: RadioTower,
  },
  {
    id: "resolution",
    label: "Resolution",
    detail: "Before and after evidence, closure note, citizen notification.",
    sla: "Closure proof",
    visibility: "Citizen timeline",
    icon: CheckCircle2,
  },
  {
    id: "public",
    label: "V2 Transparency",
    detail: "Aggregate counts, SLA performance, trends, no personal data.",
    sla: "Policy gated",
    visibility: "Public aggregate",
    icon: Gauge,
  },
];

const stageIds = stages.map((stage) => stage.id);

const journeys: Journey[] = [
  {
    id: "local",
    category: "Sanitation",
    title: "Sewage overflow near school gate",
    location: "Velachery school gate",
    citizenSignal: "Photo, GPS, landmark",
    routeLabel: "Closes locally",
    outcome: "MLA/local team schedules inspection and closes with after-proof.",
    accent: "#b42318",
    tint: "#fff0e8",
    icon: Wrench,
    events: [
      { stage: "citizen", label: "Raised", detail: "Citizen uploads overflow photo." },
      { stage: "verification", label: "Accepted", detail: "Sanitation category confirmed." },
      { stage: "local", label: "Owned", detail: "Local field visit scheduled." },
      { stage: "resolution", label: "Closed", detail: "After photo and note sent.", state: "closed" },
      { stage: "public", label: "Counted", detail: "Aggregate sanitation closure metric." },
    ],
    proof: ["Before photo", "Crew note", "After proof"],
  },
  {
    id: "ministry",
    category: "Sanitation",
    title: "Field proof missed local SLA",
    location: "Velachery school gate",
    citizenSignal: "Repeated school-zone reports",
    routeLabel: "Escalates to ministry",
    outcome: "Local visibility remains, MAWS resolves the drain bottleneck.",
    accent: "#1166a4",
    tint: "#e9f5ff",
    icon: TimerReset,
    events: [
      { stage: "citizen", label: "Raised", detail: "Cluster detected nearby." },
      { stage: "verification", label: "Grouped", detail: "Duplicate reports linked." },
      { stage: "local", label: "SLA risk", detail: "Local action slips.", state: "escalate" },
      { stage: "ministry", label: "Escalated", detail: "MAWS field proof due.", state: "escalate" },
      { stage: "resolution", label: "Resolved", detail: "Drain cleared, note issued.", state: "closed" },
      { stage: "public", label: "Counted", detail: "District trend only." },
    ],
    proof: ["Cluster signal", "SLA breach", "Field proof"],
  },
  {
    id: "citizen-update",
    category: "Sanitation",
    title: "Landmark missing on same complaint",
    location: "Velachery school gate",
    citizenSignal: "Missing exact landmark",
    routeLabel: "Clarification loop",
    outcome: "Verification asks once for location detail, then routes to local owner.",
    accent: "#1a8b4c",
    tint: "#eaf7ef",
    icon: ClipboardCheck,
    events: [
      { stage: "citizen", label: "Raised", detail: "Photo provided." },
      { stage: "verification", label: "Info needed", detail: "Landmark requested.", state: "hold" },
      { stage: "citizen", label: "Clarified", detail: "Citizen adds location." },
      { stage: "local", label: "Routed", detail: "Velachery field crew assigned." },
      { stage: "resolution", label: "Closed", detail: "Drain cleared.", state: "closed" },
      { stage: "public", label: "Counted", detail: "Aggregate category trend." },
    ],
    proof: ["Citizen reply", "Crew assignment", "Clearance photo"],
  },
  {
    id: "cm-escalation",
    category: "Sanitation",
    title: "Sewage overflow reaches CM Cell",
    location: "Velachery school gate",
    citizenSignal: "Repeat unresolved reports",
    routeLabel: "CM Cell escalation",
    outcome: "CM Cell coordinates exception review while MAWS clears the drain bottleneck.",
    accent: "#087a78",
    tint: "#e7f6f3",
    icon: RadioTower,
    events: [
      { stage: "citizen", label: "Raised", detail: "Residents attach repeat evidence." },
      { stage: "verification", label: "Linked", detail: "Recurring reports are connected." },
      { stage: "local", label: "Breach risk", detail: "Local queue cannot resolve alone.", state: "escalate" },
      { stage: "ministry", label: "Directed", detail: "MAWS action is assigned.", state: "escalate" },
      { stage: "cm", label: "Reviewed", detail: "CM Cell monitors exception closure.", state: "escalate" },
      { stage: "resolution", label: "Cleared", detail: "Drain work completed and notified.", state: "closed" },
      { stage: "public", label: "Counted", detail: "Only trend data appears publicly." },
    ],
    proof: ["Repeat cluster", "CM review", "Drain cleared"],
  },
];

const protectedEvents: JourneyEvent[] = [
  { stage: "citizen", label: "Protected intake", detail: "Citizen can submit sensitive material.", state: "protected" },
  { stage: "verification", label: "Sufficiency only", detail: "Completeness checked without wide exposure.", state: "protected" },
  { stage: "cm", label: "Restricted review", detail: "Approved protected users only.", state: "protected" },
  { stage: "resolution", label: "Guarded action", detail: "Identity and evidence are compartmentalized.", state: "protected" },
  { stage: "public", label: "Aggregate only", detail: "No personal or case-level public trace.", state: "protected" },
];

const governanceSignals: GovernanceSignal[] = [
  {
    label: "SLA clock",
    detail: "Each owner sees due time, breach risk, and escalation trigger.",
    icon: Clock3,
  },
  {
    label: "RBAC visibility",
    detail: "Queues show only what each role is authorized to act on.",
    icon: ShieldCheck,
  },
  {
    label: "Evidence vault",
    detail: "Uploads stay tied to the ticket record and closure proof.",
    icon: FileWarning,
  },
  {
    label: "Audit trail",
    detail: "Every route, rejection, escalation, and closure is recorded.",
    icon: CalendarCheck,
  },
  {
    label: "Citizen updates",
    detail: "Status changes, info requests, and closure notes notify the citizen.",
    icon: BellRing,
  },
  {
    label: "Admin controls",
    detail: "Categories, teams, SLAs, scopes, and launch toggles are configured.",
    icon: Sparkles,
  },
];

function cssVars(values: Record<string, string>) {
  return values as CSSProperties;
}

function StageCard({ stage, index }: { stage: Stage; index: number }) {
  const Icon = stage.icon;
  return (
    <article className="workflow-stage-card">
      <div className="workflow-stage-topline">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <Icon size={18} strokeWidth={2.4} />
      </div>
      <strong>{stage.label}</strong>
      <p>{stage.detail}</p>
      <div className="workflow-stage-meta">
        <span>{stage.sla}</span>
        <span>{stage.visibility}</span>
      </div>
    </article>
  );
}

function PhoneScene() {
  return (
    <div className="workflow-phone-scene" aria-label="Citizen phone ticket preview">
      <div className="workflow-phone">
        <div className="workflow-phone-speaker" />
        <div className="workflow-phone-ticket">
          <img src={ASSETS.logo} alt="" />
          <span>WH-2026-0148</span>
          <strong>Submitted</strong>
          <small>Sanitation / Velachery</small>
        </div>
        <div className="workflow-phone-timeline">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="workflow-signal-card primary">
        <Megaphone size={17} />
        <span>Voice becomes a ticket</span>
      </div>
      <div className="workflow-signal-card secondary">
        <ShieldCheck size={17} />
        <span>Promise becomes trackable</span>
      </div>
    </div>
  );
}

function JourneyLane({ journey }: { journey: Journey }) {
  const Icon = journey.icon;
  return (
    <article className="journey-lane" style={cssVars({ "--accent": journey.accent, "--tint": journey.tint })}>
      <div className="journey-intro">
        <div className="journey-icon">
          <Icon size={24} strokeWidth={2.4} />
        </div>
        <div>
          <span>{journey.category}</span>
          <strong>{journey.title}</strong>
          <small>
            <MapPin size={13} /> {journey.location}
          </small>
        </div>
      </div>
      <div className="journey-route" aria-label={`${journey.title} journey`}>
        {stageIds.map((stageId) => {
          const event = journey.events.find((item) => item.stage === stageId);
          const className = ["journey-stop", event ? "active" : "", event?.state ?? ""].filter(Boolean).join(" ");
          return (
            <div className={className} key={`${journey.id}-${stageId}`}>
              <span className="journey-dot" />
              {event ? (
                <div className="journey-copy">
                  <strong>{event.label}</strong>
                  <small>{event.detail}</small>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="journey-result">
        <span>{journey.routeLabel}</span>
        <strong>{journey.outcome}</strong>
        <div className="proof-strip">
          {journey.proof.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
    </article>
  );
}

function ProtectedLane() {
  return (
    <section className="protected-chamber">
      <div className="protected-copy">
        <div className="protected-mark">
          <ShieldCheck size={28} strokeWidth={2.4} />
        </div>
        <span>Configurable protected path</span>
        <h2>Corruption or sensitive reports do not travel like potholes.</h2>
        <p>
          The protected path is visually and operationally separate: narrow visibility, masked identity, evidence controls,
          approved reviewers, and aggregate-only transparency.
        </p>
      </div>
      <div className="protected-route">
        {stageIds.map((stageId) => {
          const event = protectedEvents.find((item) => item.stage === stageId);
          return (
            <div className={`protected-stop ${event ? "active" : ""}`} key={`protected-${stageId}`}>
              <span className="protected-dot" />
              {event ? (
                <div>
                  <strong>{event.label}</strong>
                  <small>{event.detail}</small>
                </div>
              ) : (
                <div className="protected-muted">No broad queue</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="protected-warning">
        <AlertTriangle size={18} />
        <span>Enable only when SOP, legal, privacy, and anti-retaliation handling are ready.</span>
      </div>
    </section>
  );
}

function WorkflowInfographic() {
  return (
    <div className="workflow-page">
      <header className="workflow-header">
        <div className="workflow-brand">
          <img src={ASSETS.logo} alt="Whistle logo" />
          <div>
            <strong>Whistle</strong>
            <span>Civic accountability operating system</span>
          </div>
        </div>
        <div className="workflow-gov">
          <img src={ASSETS.emblem} alt="Neutral civic service mark" />
          <div>
            <strong>Citizen to state workflow</strong>
            <span>Illustrative program lifecycle</span>
          </div>
        </div>
      </header>

      <main className="workflow-main">
        <section className="workflow-hero">
          <div className="workflow-hero-copy">
            <span className="workflow-kicker">Whistle Civic Journey Map</span>
            <h1>From citizen voice to accountable closure.</h1>
            <p>
              A ticket enters one secure spine, then moves through verification, role-owned queues, SLA-driven escalation,
              closure proof, and citizen-visible updates. Different issues resolve at different layers, while protected
              complaints stay guarded.
            </p>
            <div className="workflow-hero-stats" aria-label="Workflow summary">
              <span>
                <strong>2 days</strong>
                verification
              </span>
              <span>
                <strong>7 days</strong>
                local / MLA
              </span>
              <span>
                <strong>10 days</strong>
                ministry
              </span>
            </div>
          </div>
          <PhoneScene />
        </section>

        <section className="workflow-stage-band" aria-label="Core ticket spine">
          <div className="workflow-section-heading">
            <span>One secure ticket spine</span>
            <h2>Every handoff answers: who owns it, how long they have, and what the citizen can see.</h2>
          </div>
          <div className="workflow-stage-grid">
            {stages.map((stage, index) => (
              <StageCard stage={stage} index={index} key={stage.id} />
            ))}
          </div>
        </section>

        <section className="journey-board" aria-label="Example ticket journeys">
          <div className="journey-board-header">
            <div>
              <span>Example issue journeys</span>
              <h2>Not every complaint travels the same route.</h2>
            </div>
            <p>
              These lanes show local closure, escalation, clarification, and aggregate transparency without turning the
              operating model into a box-and-arrow diagram.
            </p>
          </div>
          <div className="journey-columns" aria-hidden="true">
            {stages.map((stage) => (
              <span key={`column-${stage.id}`}>{stage.label}</span>
            ))}
          </div>
          <div className="journey-lanes">
            {journeys.map((journey) => (
              <JourneyLane journey={journey} key={journey.id} />
            ))}
          </div>
        </section>

        <ProtectedLane />

        <section className="governance-layer" aria-label="Controls carried with every ticket">
          <div className="workflow-section-heading">
            <span>Control layer</span>
            <h2>What makes this an accountability system, not only a complaint inbox.</h2>
          </div>
          <div className="governance-grid">
            {governanceSignals.map((signal) => {
              const Icon = signal.icon;
              return (
                <article className="governance-card" key={signal.label}>
                  <Icon size={22} strokeWidth={2.4} />
                  <strong>{signal.label}</strong>
                  <p>{signal.detail}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="version-layer" aria-label="Version boundary">
          <div>
            <strong>V1 launch promise</strong>
            <span>Citizen PWA + Verification + MLA + Minister + CM Cell + Admin Console.</span>
          </div>
          <div>
            <strong>V2 overlay</strong>
            <span>Public transparency and agentic recommendations appear after workflow stability.</span>
          </div>
          <img src={ASSETS.civic} alt="" />
        </section>
      </main>
    </div>
  );
}

export default WorkflowInfographic;
