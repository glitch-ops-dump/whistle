import "./focus.css";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  EyeOff,
  Landmark,
  LockKeyhole,
  MapPin,
  RadioTower,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchPublicInsights, type PublicAssetUse, type PublicInsights, type PublicMetricRow, type PublicTrendMetrics } from "./publicInsightsApi";

type PublicAssets = {
  logo: string;
  emblem: string;
};

declare global {
  interface Window {
    __WHISTLE_PUBLIC_ASSETS__?: PublicAssets;
  }
}

const ASSETS: PublicAssets = window.__WHISTLE_PUBLIC_ASSETS__ ?? {
  logo: "/assets/brand/whistle-fake-logo.svg",
  emblem: "/assets/brand/whistle-civic-mark.svg",
};

const fallbackInsights: PublicInsights = {
  enabled: true,
  generatedAt: new Date().toISOString(),
  assetPolicy: {
    logo: { approved: true, src: ASSETS.logo, label: "Whistle prototype logo", fallbackLabel: "Whistle" },
    emblem: { approved: true, src: ASSETS.emblem, label: "Neutral civic service mark", fallbackLabel: "Civic" },
    portrait: { approved: true, src: "/assets/brand/whistle-service-portrait.svg", label: "Neutral citizen-service illustration", fallbackLabel: "Service" },
    disclaimer: {
      approved: true,
      text: "MVP1 uses neutral Whistle-owned placeholder assets. Official marks, emblems, and public-figure likenesses are not used unless separately approved.",
    },
  },
  privacy: {
    threshold: 2,
    publicationDelayHours: 24,
    publicVisibleTickets: 5,
    withheldRecentTickets: 0,
    protectedCount: 1,
    withheldSmallCellRows: 4,
    withheldSmallCellTickets: 4,
    excludedFields: ["ticketId", "title", "description", "phone", "address", "landmark", "evidence", "timeline", "reporterIdentity"],
    protectedPolicy: "Protected complaints are published only as a statewide aggregate count in this V2 prototype.",
  },
  trends: {
    month: {
      totalTickets: 5,
      openTickets: 5,
      resolvedTickets: 0,
      slaBreached: 1,
      dueIn48h: 1,
      escalatedToCmCell: 1,
    },
    allTime: {
      totalTickets: 5,
      openTickets: 5,
      resolvedTickets: 0,
      slaBreached: 1,
      dueIn48h: 1,
      escalatedToCmCell: 1,
    },
  },
  openIssues: {
    byDistrict: [
      { key: "chennai", label: "Chennai", totalTickets: 3, openTickets: 3, resolvedTickets: 0, slaBreached: 1, dueIn48h: 1, escalatedToCmCell: 1 },
      { key: "madurai", label: "Madurai", totalTickets: 2, openTickets: 2, resolvedTickets: 0, slaBreached: 0, dueIn48h: 0, escalatedToCmCell: 0 },
    ],
    byMinistry: [
      {
        key: "municipal-administration-and-water-supply",
        label: "Municipal Administration and Water Supply",
        totalTickets: 5,
        openTickets: 5,
        resolvedTickets: 0,
        slaBreached: 1,
        dueIn48h: 1,
        escalatedToCmCell: 1,
      },
    ],
    byCategory: [
      { key: "roads", label: "Roads", totalTickets: 3, openTickets: 3, resolvedTickets: 0, slaBreached: 1, dueIn48h: 1, escalatedToCmCell: 1 },
      { key: "water", label: "Water", totalTickets: 2, openTickets: 2, resolvedTickets: 0, slaBreached: 0, dueIn48h: 0, escalatedToCmCell: 0 },
    ],
  },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function PublicAssetMark({ asset }: { asset: PublicAssetUse }) {
  if (asset.src) return <img alt={asset.label} src={asset.src} />;
  return (
    <span className="public-asset-placeholder" aria-label={asset.label}>
      {asset.fallbackLabel}
    </span>
  );
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function maxOpen(rows: PublicMetricRow[]) {
  return Math.max(1, ...rows.map((row) => row.openTickets));
}

function trendRate(metrics: PublicTrendMetrics) {
  if (!metrics.totalTickets) return "0%";
  return `${Math.round((metrics.resolvedTickets / metrics.totalTickets) * 100)}%`;
}

function KpiCard({ icon: Icon, label, note, value, tone = "neutral" }: { icon: LucideIcon; label: string; note: string; value: string; tone?: "neutral" | "good" | "warn" | "dark" }) {
  return (
    <article className={`public-kpi ${tone}`}>
      <div className="public-kpi-icon">
        <Icon size={19} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function TrendBlock({ icon: Icon, label, metrics }: { icon: LucideIcon; label: string; metrics: PublicTrendMetrics }) {
  const bars = [
    { label: "Open", value: metrics.openTickets, className: "open" },
    { label: "Resolved", value: metrics.resolvedTickets, className: "resolved" },
    { label: "SLA breach", value: metrics.slaBreached, className: "breach" },
    { label: "CM level", value: metrics.escalatedToCmCell, className: "cm" },
  ];
  const max = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <section className="trend-block">
      <div className="public-section-heading">
        <div>
          <span>{label}</span>
          <h2>{formatNumber(metrics.totalTickets)} publishable complaints</h2>
        </div>
        <Icon size={22} />
      </div>
      <div className="trend-mini-grid">
        <div>
          <strong>{formatNumber(metrics.openTickets)}</strong>
          <span>Open</span>
        </div>
        <div>
          <strong>{trendRate(metrics)}</strong>
          <span>Resolved share</span>
        </div>
        <div>
          <strong>{formatNumber(metrics.dueIn48h)}</strong>
          <span>Due in 48h</span>
        </div>
      </div>
      <div className="trend-bars">
        {bars.map((bar) => (
          <div className="trend-bar-row" key={bar.label}>
            <span>{bar.label}</span>
            <div className="trend-bar-track">
              <i className={bar.className} style={{ width: `${Math.max(8, (bar.value / max) * 100)}%` }} />
            </div>
            <strong>{formatNumber(bar.value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function RowTable({ icon: Icon, label, rows }: { icon: LucideIcon; label: string; rows: PublicMetricRow[] }) {
  const max = maxOpen(rows);
  return (
    <section className="public-row-table">
      <div className="public-section-heading compact">
        <div>
          <span>Open issues</span>
          <h2>{label}</h2>
        </div>
        <Icon size={20} />
      </div>
      <div className="public-row-list">
        {rows.length ? (
          rows.map((row) => (
            <article key={row.key}>
              <div className="row-title">
                <strong>{row.label}</strong>
                <span>{formatNumber(row.openTickets)} open</span>
              </div>
              <div className="public-row-meter">
                <i style={{ width: `${Math.max(10, (row.openTickets / max) * 100)}%` }} />
              </div>
              <div className="row-meta">
                <span>{formatNumber(row.slaBreached)} SLA breached</span>
                <span>{formatNumber(row.dueIn48h)} due 48h</span>
                <span>{formatNumber(row.escalatedToCmCell)} CM level</span>
              </div>
            </article>
          ))
        ) : (
          <div className="public-empty">
            <ShieldCheck size={20} />
            <span>No publishable aggregate rows meet the current privacy threshold.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function PrivacyPanel({ insights }: { insights: PublicInsights }) {
  return (
    <aside className="public-privacy-panel">
      <div className="public-section-heading compact">
        <div>
          <span>Privacy guardrail</span>
          <h2>Aggregate-only release</h2>
        </div>
        <EyeOff size={21} />
      </div>
      <div className="privacy-stat-grid">
        <div>
          <strong>{formatNumber(insights.privacy.threshold)}</strong>
          <span>minimum cell size</span>
        </div>
        <div>
          <strong>{formatNumber(insights.privacy.withheldSmallCellRows)}</strong>
          <span>small cells withheld</span>
        </div>
        <div>
          <strong>{formatNumber(insights.privacy.withheldRecentTickets)}</strong>
          <span>{formatNumber(insights.privacy.publicationDelayHours)}h delay hold</span>
        </div>
        <div>
          <strong>{formatNumber(insights.privacy.protectedCount)}</strong>
          <span>protected statewide count</span>
        </div>
      </div>
      <p>{insights.privacy.protectedPolicy}</p>
      <div className="excluded-fields" aria-label="Excluded public fields">
        {insights.privacy.excludedFields.slice(0, 9).map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>
    </aside>
  );
}

function DisabledState({ message }: { message: string }) {
  return (
    <div className="public-disabled">
      <div>
        <LockKeyhole size={30} />
      </div>
      <h1>Public insights paused</h1>
      <p>{message}</p>
    </div>
  );
}

export default function PublicTransparency() {
  const [activeTab, setActiveTab] = useState<"trends" | "open">("trends");
  const [insights, setInsights] = useState<PublicInsights>(fallbackInsights);
  const [source, setSource] = useState<"live" | "fallback" | "disabled">("fallback");
  const [disabledMessage, setDisabledMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicInsights(controller.signal)
      .then((payload) => {
        if ("disabled" in payload) {
          setSource("disabled");
          setDisabledMessage(payload.message);
          return;
        }
        setInsights(payload.insights);
        setSource("live");
      })
      .catch(() => {
        if (!controller.signal.aborted) setSource("fallback");
      });
    return () => controller.abort();
  }, []);

  const topRows = useMemo(() => [...insights.openIssues.byDistrict, ...insights.openIssues.byMinistry].slice(0, 4), [insights]);
  const suppressedPublicRows = insights.privacy.withheldSmallCellRows + insights.privacy.withheldRecentTickets;

  return (
    <div className="public-app">
      <header className="public-header">
        <div className="public-brand">
          <PublicAssetMark asset={insights.assetPolicy.logo} />
          <div>
            <strong>Whistle</strong>
            <span>Public Transparency</span>
          </div>
        </div>
        <div className="public-gov">
          <PublicAssetMark asset={insights.assetPolicy.emblem} />
          <div>
            <strong>Tamil Nadu Government</strong>
            <span>Aggregate civic dashboard</span>
          </div>
        </div>
        <div className={`public-source ${source}`}>
          <span>{source === "live" ? "Live MVP spine" : source === "disabled" ? "Paused" : "Prototype fallback"}</span>
          <small>{formatDateTime(insights.generatedAt)}</small>
        </div>
      </header>

      {source === "disabled" ? (
        <DisabledState message={disabledMessage} />
      ) : (
        <main className="public-main">
          <section className="public-title-band">
            <div>
              <span className="system-label">V2 aggregate transparency</span>
              <h1>Public issue trends without exposing citizens</h1>
              <p>Only aggregate numbers are published. Protected complaints stay out of district, ministry, category, and ticket-level public views.</p>
              <div className="public-threshold-note">
                <LockKeyhole size={17} />
                <span>
                  Internal tickets can exist while public totals stay at zero. Whistle publishes only rows that clear privacy thresholds, delay rules, and protected-category policy.
                  {suppressedPublicRows > 0 ? ` ${formatNumber(suppressedPublicRows)} public row(s) are currently withheld by those rules.` : ""}
                </span>
              </div>
            </div>
            <div
              className="public-title-actions"
              role="tablist"
              aria-label="Public transparency tabs"
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const nextTab = activeTab === "trends" ? "open" : "trends";
                setActiveTab(nextTab);
                document.getElementById(`public-tab-${nextTab}`)?.focus();
              }}
            >
              <button
                aria-controls="public-tabpanel-trends"
                aria-selected={activeTab === "trends"}
                className={activeTab === "trends" ? "active" : ""}
                id="public-tab-trends"
                onClick={() => setActiveTab("trends")}
                role="tab"
                tabIndex={activeTab === "trends" ? 0 : -1}
                type="button"
              >
                <BarChart3 size={17} />
                Trends
              </button>
              <button
                aria-controls="public-tabpanel-open"
                aria-selected={activeTab === "open"}
                className={activeTab === "open" ? "active" : ""}
                id="public-tab-open"
                onClick={() => setActiveTab("open")}
                role="tab"
                tabIndex={activeTab === "open" ? 0 : -1}
                type="button"
              >
                <MapPin size={17} />
                Open issues
              </button>
            </div>
          </section>

          <section className="public-kpi-grid">
            <KpiCard icon={Landmark} label="Publishable total" note="Non-protected aggregate" value={formatNumber(insights.trends.allTime.totalTickets)} />
            <KpiCard icon={Clock3} label="Open issues" note="Currently active" tone="warn" value={formatNumber(insights.trends.allTime.openTickets)} />
            <KpiCard icon={AlertTriangle} label="SLA breached" note="Public aggregate only" value={formatNumber(insights.trends.allTime.slaBreached)} />
            <KpiCard icon={RadioTower} label="At CM level" note="Escalated aggregate" tone="dark" value={formatNumber(insights.trends.allTime.escalatedToCmCell)} />
            <KpiCard icon={CheckCircle2} label="Resolved" note="Closed public aggregate" tone="good" value={formatNumber(insights.trends.allTime.resolvedTickets)} />
            <KpiCard icon={LockKeyhole} label="Protected count" note="Statewide only" value={formatNumber(insights.privacy.protectedCount)} />
          </section>

          {activeTab === "trends" ? (
            <section aria-labelledby="public-tab-trends" className="public-dashboard-grid" id="public-tabpanel-trends" role="tabpanel">
              <div className="public-left-stack">
                <TrendBlock icon={CalendarDays} label="This month" metrics={insights.trends.month} />
                <TrendBlock icon={BarChart3} label="All time" metrics={insights.trends.allTime} />
              </div>
              <div className="public-right-stack">
                <PrivacyPanel insights={insights} />
                <section className="public-watchlist">
                  <div className="public-section-heading compact">
                    <div>
                      <span>Highest visible pressure</span>
                      <h2>Public aggregate watchlist</h2>
                    </div>
                    <Sparkles size={20} />
                  </div>
                  {topRows.map((row) => (
                    <div className="watch-row" key={`${row.key}-${row.label}`}>
                      <div>
                        <strong>{row.label}</strong>
                        <span>{formatNumber(row.openTickets)} open, {formatNumber(row.slaBreached)} breached</span>
                      </div>
                      <ChevronRight size={17} />
                    </div>
                  ))}
                </section>
              </div>
            </section>
          ) : (
            <section aria-labelledby="public-tab-open" className="public-open-grid" id="public-tabpanel-open" role="tabpanel">
              <RowTable icon={MapPin} label="District / city view" rows={insights.openIssues.byDistrict} />
              <RowTable icon={Building2} label="Department / ministry view" rows={insights.openIssues.byMinistry} />
              <RowTable icon={Landmark} label="Category view" rows={insights.openIssues.byCategory} />
            </section>
          )}
        </main>
      )}
    </div>
  );
}
