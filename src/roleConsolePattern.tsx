import "./role-console-pattern.css";

export type RoleConsoleKind = "verification" | "mla" | "ministry" | "cm_cell";

export type SlaLadderStep = {
  label: string;
  owner: string;
  target: string;
  status: "done" | "active" | "watch" | "blocked";
  detail: string;
};

export type SelectedTicketSummary = {
  id: string;
  title: string;
  owner: string;
  status: string;
};

type RoleConsolePattern = {
  roleLabel: string;
  mandate: string;
  kpiFocus: string;
  nextAction: string;
  ticketList: string;
  selectedTicket: SelectedTicketSummary;
  citizenVisibleUpdate: string;
  slaLadder: SlaLadderStep[];
};

export const coherentDemoTicket = {
  id: "WH-2026-DEMO-SANITATION",
  title: "Sewage overflow near Velachery school gate",
  category: "Sanitation",
  district: "Chennai",
  area: "Velachery",
  ministry: "Municipal Administration and Water Supply",
  localOwner: "Velachery MLA Office",
  ministryOwner: "MAWS Chennai Field Cell",
  cmOwner: "CM Cell Command Desk",
  citizenUpdate:
    "Your school-gate sewage complaint is under government review. Velachery MLA Office and MAWS are coordinating field proof; the next public update is due after the field team uploads closure evidence.",
};

export const roleConsolePatterns: Record<RoleConsoleKind, RoleConsolePattern> = {
  verification: {
    roleLabel: "Verification",
    mandate: "Confirm category, location, privacy posture, and human-approved routing before any owner can act.",
    kpiFocus: "Awaiting intake, protected intake, SLA watch, and governed evidence readiness.",
    nextAction: "Route the Velachery school-gate sewage complaint to local ownership or ask for missing proof.",
    ticketList: "Standard, protected, due-soon, and rejection-review intake share one decision bench.",
    selectedTicket: {
      id: coherentDemoTicket.id,
      title: coherentDemoTicket.title,
      owner: "Ticket Verification Team",
      status: "Awaiting intake decision",
    },
    citizenVisibleUpdate:
      "We are checking your complaint details and evidence before routing it to the correct owner. If a landmark or proof is missing, you will be asked once from this stage.",
    slaLadder: [
      {
        label: "Citizen submitted",
        owner: "Citizen app",
        target: "Received",
        status: "done",
        detail: "Phone verified and evidence metadata captured.",
      },
      {
        label: "Intake review",
        owner: "Verification team",
        target: "4 hours",
        status: "active",
        detail: "Category, location, duplicate risk, and protected signals checked before routing.",
      },
      {
        label: "Local action",
        owner: coherentDemoTicket.localOwner,
        target: "48 hours",
        status: "watch",
        detail: "Local owner must schedule the field visit and publish the next citizen update.",
      },
      {
        label: "Ministry / CM escalation",
        owner: "MAWS, then CM Cell",
        target: "SLA breach",
        status: "blocked",
        detail: "Escalation opens only if local or ministry ownership misses the proof deadline.",
      },
    ],
  },
  mla: {
    roleLabel: "MLA",
    mandate: "Own constituency closure, keep citizens updated, and prevent avoidable ministry escalation.",
    kpiFocus: "Open in scope, local queue, due in 48 hours, escalated out, SLA breach, and average age.",
    nextAction: "Schedule the Velachery field visit and upload a local action note before the ministry clock takes over.",
    ticketList: "Local primary work stays first; escalated tickets remain visible for secondary accountability.",
    selectedTicket: {
      id: coherentDemoTicket.id,
      title: coherentDemoTicket.title,
      owner: coherentDemoTicket.localOwner,
      status: "Local field action due",
    },
    citizenVisibleUpdate: coherentDemoTicket.citizenUpdate,
    slaLadder: [
      {
        label: "Intake routed",
        owner: "Verification team",
        target: "Done",
        status: "done",
        detail: "Complaint is standard civic work, not protected intake.",
      },
      {
        label: "Local visit",
        owner: coherentDemoTicket.localOwner,
        target: "24 hours",
        status: "active",
        detail: "Field coordinator schedules inspection and captures before evidence.",
      },
      {
        label: "Local closure proof",
        owner: coherentDemoTicket.localOwner,
        target: "48 hours",
        status: "watch",
        detail: "After photo and citizen impact check are needed before closure.",
      },
      {
        label: "Escalation watch",
        owner: coherentDemoTicket.ministryOwner,
        target: "After local SLA",
        status: "blocked",
        detail: "MAWS becomes primary if local proof is missed.",
      },
    ],
  },
  ministry: {
    roleLabel: "Ministry",
    mandate: "Clear district bottlenecks for the assigned MAWS lane without seeing unrelated ministries.",
    kpiFocus: "Visible MAWS tickets, breached SLA, due in 48 hours, primary ministry, CM Cell, and average age.",
    nextAction: "Issue a MAWS directive for field proof on the same Velachery school-gate sanitation complaint.",
    ticketList: "Primary ministry tickets plus CM-escalated secondary-visible work remain in one operating queue.",
    selectedTicket: {
      id: coherentDemoTicket.id,
      title: coherentDemoTicket.title,
      owner: coherentDemoTicket.ministryOwner,
      status: "Ministry proof due",
    },
    citizenVisibleUpdate: coherentDemoTicket.citizenUpdate,
    slaLadder: [
      {
        label: "Local handoff",
        owner: coherentDemoTicket.localOwner,
        target: "Completed / late",
        status: "done",
        detail: "Local field note exists, but closure proof is not enough for citizen notification.",
      },
      {
        label: "Ministry directive",
        owner: coherentDemoTicket.ministryOwner,
        target: "36 hours",
        status: "active",
        detail: "MAWS asks the district owner for field proof and closure plan.",
      },
      {
        label: "Citizen impact check",
        owner: "MAWS district officer",
        target: "Before resolve",
        status: "watch",
        detail: "Closure requires safety-risk closure and public update text.",
      },
      {
        label: "CM Cell intervention",
        owner: coherentDemoTicket.cmOwner,
        target: "If ministry misses SLA",
        status: "blocked",
        detail: "CM Cell becomes primary only after ministry escalation criteria are met.",
      },
    ],
  },
  cm_cell: {
    roleLabel: "CM Cell",
    mandate: "Intervene on breached, protected, or suppressed complaints while ministries remain accountable.",
    kpiFocus: "SLA breached, at CM Cell, ministries in red, due today, protected corruption, and directive pending.",
    nextAction: "Direct the MAWS secretary to publish a 48-hour closure plan for the Velachery school-gate complaint.",
    ticketList: "CM Cell queue defaults to CM-primary escalations while protected and rejection-review work stay guarded.",
    selectedTicket: {
      id: coherentDemoTicket.id,
      title: coherentDemoTicket.title,
      owner: coherentDemoTicket.cmOwner,
      status: "CM directive pending",
    },
    citizenVisibleUpdate:
      "Your complaint has reached CM Cell oversight because the field response missed the SLA. MAWS must now publish a closure plan and evidence-backed update.",
    slaLadder: [
      {
        label: "Citizen and verification",
        owner: "Citizen app / Verification",
        target: "Done",
        status: "done",
        detail: "Complaint was accepted and routed as standard sanitation work.",
      },
      {
        label: "Local and ministry clocks",
        owner: "MLA office / MAWS",
        target: "Breached",
        status: "done",
        detail: "Local and ministry owners missed enough proof for closure.",
      },
      {
        label: "CM directive",
        owner: coherentDemoTicket.cmOwner,
        target: "24 hours",
        status: "active",
        detail: "Command desk directs secretary response and district proof timeline.",
      },
      {
        label: "Public closure update",
        owner: "MAWS with CM oversight",
        target: "48 hours",
        status: "watch",
        detail: "Citizen-facing message must include action taken, proof state, and next review time.",
      },
    ],
  },
};

function ticketSummary(pattern: RoleConsolePattern, selectedTicket?: SelectedTicketSummary) {
  return selectedTicket ?? pattern.selectedTicket;
}

function citizenUpdateFor(pattern: RoleConsolePattern, selectedTicket?: SelectedTicketSummary, message?: string) {
  if (message) return message;
  const ticket = ticketSummary(pattern, selectedTicket);
  if (ticket.id === pattern.selectedTicket.id) return pattern.citizenVisibleUpdate;
  return `${ticket.id}: ${ticket.title} is currently ${ticket.status}. Current owner: ${ticket.owner}.`;
}

export function RolePatternSummary({
  pattern,
  selectedTicket,
}: {
  pattern: RoleConsolePattern;
  selectedTicket?: SelectedTicketSummary;
}) {
  const ticket = ticketSummary(pattern, selectedTicket);
  const items = [
    ["Mandate", pattern.mandate],
    ["KPI focus", pattern.kpiFocus],
    ["Next action", pattern.nextAction],
    ["Ticket list", pattern.ticketList],
    ["Selected ticket", `${ticket.id}: ${ticket.title} (${ticket.owner})`],
    ["Citizen-visible update", citizenUpdateFor(pattern, selectedTicket)],
  ];

  return (
    <section className="role-pattern role-pattern-summary" aria-label={`${pattern.roleLabel} console operating pattern`}>
      <div className="role-pattern-head">
        <div>
          <span>{pattern.roleLabel} console pattern</span>
          <h2>Mandate, metrics, action, ticket, SLA, update</h2>
        </div>
        <strong>{ticket.status}</strong>
      </div>
      <div className="role-pattern-grid">
        {items.map(([label, value]) => (
          <div className="role-pattern-card" key={label}>
            <span>{label}</span>
            <p>{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SlaLadderCard({ pattern, selectedTicket }: { pattern: RoleConsolePattern; selectedTicket?: SelectedTicketSummary }) {
  const ticket = ticketSummary(pattern, selectedTicket);
  return (
    <section className="role-pattern role-sla-card" aria-label={`${pattern.roleLabel} SLA ladder`}>
      <div className="role-pattern-head compact">
        <div>
          <span>SLA ladder</span>
          <h2>{ticket.id}</h2>
        </div>
      </div>
      <div className="role-sla-list">
        {pattern.slaLadder.map((step) => (
          <div className={`role-sla-step ${step.status}`} key={`${step.label}-${step.owner}`}>
            <span className="role-sla-dot" />
            <div>
              <strong>{step.label}</strong>
              <small>{step.owner} | {step.target}</small>
              <p>{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CitizenVisibleUpdateCard({
  pattern,
  message,
  selectedTicket,
}: {
  pattern: RoleConsolePattern;
  message?: string;
  selectedTicket?: SelectedTicketSummary;
}) {
  const ticket = ticketSummary(pattern, selectedTicket);
  return (
    <section className="role-pattern role-citizen-update" aria-label={`${pattern.roleLabel} citizen-visible update`}>
      <div>
        <span>Citizen-visible update</span>
        <strong>{ticket.id}</strong>
      </div>
      <p>{citizenUpdateFor(pattern, selectedTicket, message)}</p>
    </section>
  );
}
