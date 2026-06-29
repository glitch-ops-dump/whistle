import "./focus.css";
import { useEffect, useState } from "react";
import { fetchAuthConfig, type AuthConfig } from "./authApi";

const routeSteps = [
  {
    href: "/workflow.html",
    step: "01",
    eyebrow: "Program story",
    title: "Workflow Journey",
    body: "See how citizen tickets move through verification, local action, ministry escalation, CM Cell review, closure, and V2 transparency.",
    cta: "Open workflow",
    tone: "story",
  },
  {
    href: "/citizen.html",
    step: "02",
    eyebrow: "V1 citizen surface",
    title: "Citizen Mobile PWA",
    body: "Raise complaints, upload evidence, verify phone, track status, respond to information requests, and reopen disputed closures.",
    cta: "Open citizen app",
    tone: "citizen",
  },
  {
    href: "/verification.html",
    step: "03",
    eyebrow: "V1 intake surface",
    title: "Verification Console",
    body: "Intake queue, protected screening, evidence access, reviewer packet, and routing decisions.",
    cta: "Open console",
    tone: "console",
  },
  {
    href: "/mla.html",
    step: "04",
    eyebrow: "V1 escalation layer",
    title: "MLA Dashboard",
    body: "Constituency queue, due-soon risk, local closure pressure, and secondary visibility after escalation.",
    cta: "Open MLA",
    tone: "console",
  },
  {
    href: "/ministry.html",
    step: "05",
    eyebrow: "V1 escalation layer",
    title: "Ministry Console",
    body: "Assigned-ministry workload, district bottlenecks, SLA risk, and field-action review before CM escalation.",
    cta: "Open ministry",
    tone: "console",
  },
  {
    href: "/cm-cell.html",
    step: "06",
    eyebrow: "V1 command layer",
    title: "CM Cell",
    body: "Statewide command view for escalations, ministry accountability, rejection review, and protected visibility where enabled.",
    cta: "Open CM Cell",
    tone: "command",
  },
  {
    href: "/admin.html",
    step: "07",
    eyebrow: "V1 launch controls",
    title: "Admin Console",
    body: "Users, access, SLA/category controls, launch-gate evidence, operator UAT, audit, and setup health.",
    cta: "Open Admin",
    tone: "admin",
  },
];

const deferredLinks = [
  { href: "/local.html", label: "V3 Local owner" },
  { href: "/transparency.html", label: "V2 Transparency" },
  { href: "/dashboard.html", label: "Legacy state dashboard" },
];

function UatCredentialsCard() {
  const [config, setConfig] = useState<AuthConfig | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAuthConfig().then((next) => {
      if (active) setConfig(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const accounts = config?.demo.governmentAccounts ?? [];
  return (
    <section className="launcher-credentials" aria-label="UAT login help">
      <strong>Console logins for this demo</strong>
      {accounts.length ? (
        <ul>
          {accounts.map((account) => (
            <li key={account.phone}>
              <b>{account.displayName}</b> — {account.phone} / {account.password} ({account.roles.join(", ")})
            </li>
          ))}
        </ul>
      ) : (
        <p>Every console login comes prefilled with its seeded UAT account — open a console and press Login.</p>
      )}
    </section>
  );
}

function Launcher() {
  return (
    <main className="launcher-shell">
      <section className="launcher-hero">
        <div className="launcher-brand">
          <img alt="" src="/assets/brand/whistle-fake-logo.svg" />
          <div>
            <span>Whistle V1 demo route</span>
            <h1>Open the accountability journey</h1>
          </div>
        </div>
        <p>
          Follow the V1 story in order: workflow, citizen, verification, MLA, ministry, CM Cell, then Admin. Deferred and legacy surfaces stay separate so they do not blur launch scope.
        </p>
      </section>

      <section className="launcher-route" aria-label="V1 Whistle demo route">
        {routeSteps.map((item) => (
          <a className={`launcher-step ${item.tone}`} href={item.href} key={item.href}>
            <span className="launcher-step-number">{item.step}</span>
            <span className="launcher-step-eyebrow">{item.eyebrow}</span>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
            <b>{item.cta}</b>
          </a>
        ))}
      </section>

      <UatCredentialsCard />

      <nav className="launcher-secondary" aria-label="Deferred and legacy surfaces">
        {deferredLinks.map((item) => (
          <a href={item.href} key={item.href}>{item.label}</a>
        ))}
      </nav>
    </main>
  );
}

export default Launcher;
