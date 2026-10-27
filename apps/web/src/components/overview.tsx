"use client";
import Link from "next/link";
import {
  AlertTriangle,
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileClock,
  FolderOpen,
  Gauge,
  Globe2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useState } from "react";
import type { Summary, Run } from "@/lib/types";
import { when } from "@/lib/api";
import type { ModuleProps } from "./console";
import { Badge, Empty, Panel } from "./ui";

export function RunsTable({
  runs,
  open,
}: {
  runs: Run[];
  open?: (run: Run) => void;
}) {
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            <th>Request</th>
            <th>Status</th>
            <th>Response time</th>
            <th>Result</th>
            <th>Executed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="request-cell">
                  <span className={`method-text ${r.method.toLowerCase()}`}>
                    {r.method}
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {r.source === "monitor"
                        ? "Scheduled check"
                        : r.execution_mode === "local"
                          ? "Local execution"
                          : "Cloud execution"}{" "}
                      · #{r.id}
                    </small>
                  </span>
                </div>
              </td>
              <td>
                <Badge tone={r.status && r.status < 300 ? "mint" : "red"}>
                  {r.status || "Error"}
                </Badge>
              </td>
              <td className="mono">
                {r.duration_ms}
                <span className="muted"> ms</span>
              </td>
              <td>
                <span className={`result-label ${r.outcome}`}>
                  <span />
                  {r.outcome}
                </span>
              </td>
              <td className="muted small">{when(r.created_at)}</td>
              <td>
                {open && (
                  <button
                    className="icon-button"
                    aria-label={`Inspect run ${r.id}`}
                    onClick={() => open(r)}
                  >
                    <ChevronRight size={17} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function LatencyChart({ summary }: { summary: Summary }) {
  const points = summary.daily;
  const max = Math.max(...points.map((d) => Number(d.avg_ms)), 100);
  const coordinates = points.map(
    (d, i) =>
      `${45 + (i / Math.max(points.length - 1, 1)) * 645},${190 - (Number(d.avg_ms) / max) * 145}`,
  );
  return (
    <div className="chart">
      <svg
        viewBox="0 0 730 235"
        role="img"
        aria-label="Average request latency by day"
      >
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--mint)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--mint)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="45"
              y1={45 + i * 48.3}
              x2="705"
              y2={45 + i * 48.3}
              stroke="var(--border)"
              strokeDasharray="3 6"
            />
            <text x="0" y={49 + i * 48.3} fill="var(--muted)" fontSize="10">
              {Math.round(max * (1 - i / 3))} ms
            </text>
          </g>
        ))}
        {points.length > 0 && (
          <>
            <polygon
              points={`45,194 ${coordinates.join(" ")} ${45 + ((points.length - 1) / Math.max(points.length - 1, 1)) * 645},194`}
              fill="url(#area)"
            />
            <polyline
              points={coordinates.join(" ")}
              fill="none"
              stroke="var(--mint)"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {points.map((d, i) => (
              <g key={d.day}>
                <circle
                  cx={45 + (i / Math.max(points.length - 1, 1)) * 645}
                  cy={190 - (Number(d.avg_ms) / max) * 145}
                  r="4"
                  fill="var(--mint)"
                >
                  <title>
                    {d.day}: {Math.round(Number(d.avg_ms))} ms · {d.runs} runs
                  </title>
                </circle>
                <text
                  x={45 + (i / Math.max(points.length - 1, 1)) * 645}
                  y="220"
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize="10"
                >
                  {d.day.slice(5)}
                </text>
              </g>
            ))}
          </>
        )}
      </svg>
      {points.length === 0 && (
        <div className="chart-empty">
          <Activity size={23} />
          <strong>Ready for your first data point</strong>
          <span>Latency appears here after you send a request.</span>
        </div>
      )}
    </div>
  );
}

function ActivityChart({ summary }: { summary: Summary }) {
  const points = summary.daily;
  const max = Math.max(...points.map((point) => Number(point.runs)), 1);
  const slot = 660 / Math.max(points.length, 1);
  const width = Math.min(20, Math.max(5, slot * 0.62));
  return (
    <div className="trend-chart">
      {points.length ? (
        <svg
          viewBox="0 0 730 230"
          role="img"
          aria-label="Daily API request activity"
        >
          {[0, 1, 2, 3].map((line) => (
            <g key={line}>
              <line
                x1="45"
                y1={48 + line * 46}
                x2="705"
                y2={48 + line * 46}
                stroke="var(--border)"
                strokeDasharray="3 6"
              />
              <text x="4" y={52 + line * 46} fill="var(--muted)" fontSize="10">
                {Math.round(max * (1 - line / 3))}
              </text>
            </g>
          ))}
          {points.map((point, index) => {
            const height = Math.max(2, (Number(point.runs) / max) * 138);
            const x = 45 + index * slot + (slot - width) / 2;
            return (
              <g key={point.day}>
                <rect
                  x={x}
                  y={190 - height}
                  width={width}
                  height={height}
                  rx="3"
                  fill="var(--cyan)"
                />
                <title>
                  {point.day}: {point.runs} requests · {point.passed} passed
                </title>
                <text
                  x={x + width / 2}
                  y="215"
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize="9"
                >
                  {point.day.slice(5)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="chart-empty">
          <Activity size={23} />
          <strong>No request activity yet</strong>
          <span>Daily request totals appear after executions.</span>
        </div>
      )}
    </div>
  );
}

function AssertionChart({ summary }: { summary: Summary }) {
  const points = summary.daily_assertions;
  const max = Math.max(
    ...points.map((point) => Number(point.passed) + Number(point.failed)),
    1,
  );
  const slot = 660 / Math.max(points.length, 1);
  const width = Math.min(20, Math.max(5, slot * 0.62));
  return (
    <div className="trend-chart">
      {points.length ? (
        <svg
          viewBox="0 0 730 230"
          role="img"
          aria-label="Daily assertion pass and fail history"
        >
          {[0, 1, 2, 3].map((line) => (
            <g key={line}>
              <line
                x1="45"
                y1={48 + line * 46}
                x2="705"
                y2={48 + line * 46}
                stroke="var(--border)"
                strokeDasharray="3 6"
              />
              <text x="4" y={52 + line * 46} fill="var(--muted)" fontSize="10">
                {Math.round(max * (1 - line / 3))}
              </text>
            </g>
          ))}
          {points.map((point, index) => {
            const x = 45 + index * slot + (slot - width) / 2;
            const passedHeight = (Number(point.passed) / max) * 138;
            const failedHeight = (Number(point.failed) / max) * 138;
            return (
              <g key={point.day}>
                <rect
                  x={x}
                  y={190 - passedHeight}
                  width={width}
                  height={Math.max(passedHeight, point.passed ? 2 : 0)}
                  rx="2"
                  fill="var(--mint)"
                />
                <rect
                  x={x}
                  y={190 - passedHeight - failedHeight}
                  width={width}
                  height={Math.max(failedHeight, point.failed ? 2 : 0)}
                  rx="2"
                  fill="var(--red)"
                />
                <title>
                  {point.day}: {point.passed} passed · {point.failed} failed
                  assertions
                </title>
                <text
                  x={x + width / 2}
                  y="215"
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize="9"
                >
                  {point.day.slice(5)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="chart-empty">
          <CheckCheck size={23} />
          <strong>No assertions recorded yet</strong>
          <span>
            Configure request assertions to track pass and fail history.
          </span>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="dashboard-command-center"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="dashboard-skeleton-heading">
        <span />
        <i />
        <i />
      </div>
      <div className="dashboard-kpis">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            className="dashboard-skeleton dashboard-skeleton-kpi"
            key={index}
          />
        ))}
      </div>
      <div className="dashboard-chart-grid">
        <div className="dashboard-skeleton dashboard-skeleton-chart" />
        <div className="dashboard-skeleton dashboard-skeleton-chart" />
      </div>
      <div className="dashboard-operations-grid">
        <div className="dashboard-skeleton dashboard-skeleton-list" />
        <div className="dashboard-skeleton dashboard-skeleton-list" />
      </div>
      <span className="sr-only">Loading workspace metrics…</span>
    </div>
  );
}

function ResponseTrend({
  summary,
  mode,
}: {
  summary: Summary;
  mode: "avg" | "p95";
}) {
  const [hovered, setHovered] = useState<{
    index: number;
    day: string;
    value: number;
    runs: number;
  } | null>(null);
  const points = summary.daily
    .map((point) => ({
      day: point.day,
      runs: Number(point.runs),
      value:
        mode === "avg"
          ? Number(point.avg_ms)
          : point.p95_ms == null
            ? Number.NaN
            : Number(point.p95_ms),
    }))
    .filter((point) => Number.isFinite(point.value));
  const max = Math.max(...points.map((point) => point.value), 1);
  const x = (index: number) =>
    58 + (index / Math.max(points.length - 1, 1)) * 632;
  const y = (value: number) => 194 - (value / max) * 148;
  const coordinates = points.map(
    (point, index) => `${x(index)},${y(point.value)}`,
  );
  const ticks =
    points.length > 10
      ? points.filter(
          (_, index) => index % 5 === 0 || index === points.length - 1,
        )
      : points;

  if (!points.length) {
    return (
      <div className="dashboard-chart-empty">
        <Activity size={21} />
        <strong>
          {mode === "p95" && summary.daily.length
            ? "Daily P95 latency is unavailable"
            : "No response data in this period"}
        </strong>
        <span>
          {mode === "p95" && summary.daily.length
            ? "P95 points appear once response timings are recorded."
            : "Response performance will appear after an API request runs."}
        </span>
      </div>
    );
  }

  const showTooltip = (index: number) => {
    const point = points[index];
    if (point) setHovered({ ...point, index });
  };

  return (
    <div
      className="dashboard-response-chart"
      onMouseLeave={() => setHovered(null)}
    >
      <svg
        viewBox="0 0 720 242"
        role="img"
        aria-label={`${mode === "avg" ? "Average" : "P95"} response time by day`}
      >
        <defs>
          <linearGradient
            id="dashboard-latency-area"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop stopColor="var(--accent)" stopOpacity="0.24" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((tick) => {
          const value = max * (1 - tick / 3);
          const gridY = 39 + tick * 50;
          return (
            <g key={tick}>
              <line
                x1="58"
                y1={gridY}
                x2="700"
                y2={gridY}
                stroke="var(--border-soft)"
                strokeDasharray="3 6"
              />
              <text
                x="50"
                y={gridY + 4}
                textAnchor="end"
                fill="var(--faint)"
                fontSize="10"
              >
                {Math.round(value)} ms
              </text>
            </g>
          );
        })}
        <polygon
          points={`58,198 ${coordinates.join(" ")} ${x(points.length - 1)},198`}
          fill="url(#dashboard-latency-area)"
        />
        <polyline
          points={coordinates.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.7"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point, index) => (
          <g key={point.day}>
            <circle
              cx={x(index)}
              cy={y(point.value)}
              r="10"
              fill="transparent"
              className="dashboard-chart-hit-target"
              tabIndex={0}
              role="img"
              aria-label={`${point.day}: ${Math.round(point.value)} milliseconds, ${point.runs} runs`}
              onPointerEnter={() => showTooltip(index)}
              onFocus={() => showTooltip(index)}
              onBlur={() => setHovered(null)}
            />
            <circle
              cx={x(index)}
              cy={y(point.value)}
              r={hovered?.index === index ? 4.8 : 3.5}
              fill="var(--surface)"
              stroke="var(--accent)"
              strokeWidth="2"
              pointerEvents="none"
            />
          </g>
        ))}
        {ticks.map((point) => {
          const index = points.findIndex((item) => item.day === point.day);
          return (
            <text
              key={point.day}
              x={x(index)}
              y="224"
              textAnchor="middle"
              fill="var(--faint)"
              fontSize="10"
            >
              {point.day.slice(5)}
            </text>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="dashboard-plot-tooltip"
          style={{
            left: `${Math.min(88, Math.max(12, (hovered.index / Math.max(points.length - 1, 1)) * 100))}%`,
          }}
          role="status"
        >
          <strong>{hovered.day}</strong>
          <span>
            {Math.round(hovered.value)} ms {mode === "avg" ? "average" : "P95"}
          </span>
          <small>
            {hovered.runs} {hovered.runs === 1 ? "run" : "runs"}
          </small>
        </div>
      )}
    </div>
  );
}

function ExecutionHealth({ summary }: { summary: Summary }) {
  const httpOrder = ["2xx", "3xx", "4xx", "5xx", "No response"];
  const http = httpOrder
    .map((category) =>
      summary.status_classes.find((status) => status.category === category),
    )
    .filter(
      (status): status is Summary["status_classes"][number] =>
        !!status && Number(status.total) > 0,
    );
  const httpTotal = http.reduce((total, item) => total + Number(item.total), 0);
  const assertions = [
    { label: "Passed", total: summary.assertions_passed, tone: "mint" },
    { label: "Failed", total: summary.assertions_failed, tone: "red" },
  ];
  const assertionTotal = assertions.reduce(
    (total, item) => total + item.total,
    0,
  );
  const modeTotal = summary.local_runs + summary.cloud_runs;
  const toneForStatus = (category: string) =>
    category === "2xx"
      ? "mint"
      : category === "3xx"
        ? "cyan"
        : category === "4xx"
          ? "amber"
          : "red";

  return (
    <div className="dashboard-health-content">
      <section
        className="dashboard-health-section"
        aria-labelledby="dashboard-http-title"
      >
        <div className="dashboard-health-heading">
          <strong id="dashboard-http-title">HTTP responses</strong>
          <span>{httpTotal.toLocaleString()} responses</span>
        </div>
        {http.length ? (
          <>
            <div
              className="dashboard-stack"
              role="img"
              aria-label={http
                .map((item) => `${item.category}: ${item.total}`)
                .join(", ")}
            >
              {http.map((item) => (
                <span
                  key={item.category}
                  className={`tone-${toneForStatus(item.category)}`}
                  style={{
                    width: `${(Number(item.total) / httpTotal) * 100}%`,
                  }}
                />
              ))}
            </div>
            <div className="dashboard-health-legend">
              {http.map((item) => (
                <div key={item.category}>
                  <i className={`tone-${toneForStatus(item.category)}`} />
                  <span>{item.category}</span>
                  <strong>{Number(item.total).toLocaleString()}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="dashboard-health-empty">
            No HTTP responses recorded in this period.
          </p>
        )}
      </section>
      <section
        className="dashboard-health-section"
        aria-labelledby="dashboard-assertion-title"
      >
        <div className="dashboard-health-heading">
          <strong id="dashboard-assertion-title">Assertion outcomes</strong>
          <span>{assertionTotal.toLocaleString()} checks</span>
        </div>
        {assertionTotal ? (
          <>
            <div
              className="dashboard-stack"
              role="img"
              aria-label={`${summary.assertions_passed} passed assertions, ${summary.assertions_failed} failed assertions`}
            >
              {assertions
                .filter((item) => item.total)
                .map((item) => (
                  <span
                    key={item.label}
                    className={`tone-${item.tone}`}
                    style={{ width: `${(item.total / assertionTotal) * 100}%` }}
                  />
                ))}
            </div>
            <div className="dashboard-health-legend">
              {assertions.map((item) => (
                <div key={item.label}>
                  <i className={`tone-${item.tone}`} />
                  <span>{item.label}</span>
                  <strong>{item.total.toLocaleString()}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="dashboard-health-empty">
            No assertions have been recorded in this period.
          </p>
        )}
      </section>
      <section
        className="dashboard-health-section"
        aria-labelledby="dashboard-mode-title"
      >
        <div className="dashboard-health-heading">
          <strong id="dashboard-mode-title">Execution mode</strong>
          <span>{modeTotal.toLocaleString()} recorded runs</span>
        </div>
        {modeTotal ? (
          <>
            <div
              className="dashboard-stack"
              role="img"
              aria-label={`${summary.local_runs} local runs, ${summary.cloud_runs} cloud runs`}
            >
              {summary.local_runs > 0 && (
                <span
                  className="tone-violet"
                  style={{
                    width: `${(summary.local_runs / modeTotal) * 100}%`,
                  }}
                />
              )}
              {summary.cloud_runs > 0 && (
                <span
                  className="tone-cyan"
                  style={{
                    width: `${(summary.cloud_runs / modeTotal) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="dashboard-health-legend">
              <div>
                <i className="tone-violet" />
                <span>Local</span>
                <strong>{summary.local_runs.toLocaleString()}</strong>
              </div>
              <div>
                <i className="tone-cyan" />
                <span>Cloud</span>
                <strong>{summary.cloud_runs.toLocaleString()}</strong>
              </div>
            </div>
          </>
        ) : (
          <p className="dashboard-health-empty">
            No execution mode data in this period.
          </p>
        )}
      </section>
      <p className="dashboard-health-note">
        HTTP status and assertion results are separate from the executor
        pass/fail result.
      </p>
    </div>
  );
}

function DashboardOverview({
  workspace,
  summary,
  periodDays,
  setPeriodDays,
  loading,
  error,
  refreshing,
  refresh,
}: ModuleProps & {
  summary?: Summary;
  periodDays: number;
  setPeriodDays: (days: number) => void;
  loading: boolean;
  error?: string;
  refreshing: boolean;
  refresh: () => void;
}) {
  const [latencyMode, setLatencyMode] = useState<"avg" | "p95">("avg");
  if (loading && !summary) return <DashboardSkeleton />;
  if (!summary)
    return (
      <div className="dashboard-command-center">
        <div className="dashboard-load-error" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Dashboard data could not be loaded.</strong>
            <span>{error || "Try refreshing the workspace summary."}</span>
          </div>
          <button
            className="button secondary"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      </div>
    );

  const assertionCount = summary.assertions_passed + summary.assertions_failed;
  const assertionRate = assertionCount
    ? `${Math.round((summary.assertions_passed / assertionCount) * 100)}%`
    : "—";
  const kpis = [
    {
      label: "Saved requests",
      value: summary.requests.toLocaleString(),
      detail: `${summary.collections.toLocaleString()} collections`,
      icon: FolderOpen,
      tone: "mint",
      href: "/collections",
    },
    {
      label: "Runs in selected period",
      value: summary.total_runs.toLocaleString(),
      detail: `${summary.passed_runs.toLocaleString()} executor passes · ${summary.failed_runs.toLocaleString()} failed`,
      icon: Activity,
      tone: "cyan",
      href: "/history",
    },
    {
      label: "Assertion pass rate",
      value: assertionRate,
      detail: assertionCount
        ? `${summary.assertions_passed.toLocaleString()} passed · ${summary.assertions_failed.toLocaleString()} failed`
        : "No assertions in this period",
      icon: CheckCheck,
      tone: "mint",
      href: "/analytics",
    },
    {
      label: "Average response time",
      value:
        summary.avg_latency_ms === null
          ? "—"
          : Math.round(summary.avg_latency_ms).toLocaleString(),
      unit: summary.avg_latency_ms === null ? "" : "ms",
      detail:
        summary.p95_latency_ms === null
          ? "P95 · no latency samples"
          : `P95 · ${Math.round(summary.p95_latency_ms).toLocaleString()} ms`,
      icon: Clock3,
      tone: "violet",
      href: "/analytics",
    },
    {
      label: "Active monitors",
      value: summary.active_monitors.toLocaleString(),
      detail:
        summary.monitor_availability === null
          ? "No scheduled checks in this period"
          : `${summary.monitor_availability}% scheduled check success`,
      icon: ShieldCheck,
      tone: "amber",
      href: "/monitoring",
    },
    {
      label: "Open incidents",
      value: summary.open_alerts.toLocaleString(),
      detail: summary.open_alerts
        ? "Unresolved alerts need review"
        : "No unresolved monitor incidents",
      icon: AlertTriangle,
      tone: summary.open_alerts ? "red" : "mint",
      href: "/alerts",
    },
  ];
  const recentFailures = summary.recent_runs.filter(
    (run) => run.outcome === "failed",
  );
  const failingMonitors = summary.monitor_snapshots.filter(
    (monitor) =>
      monitor.last_outcome === "failed" || monitor.open_incidents > 0,
  );
  const hasIssues =
    summary.failed_runs > 0 ||
    summary.open_alerts > 0 ||
    recentFailures.length > 0 ||
    failingMonitors.length > 0;
  const endpoint = (url: string) => {
    try {
      const parsed = new URL(url);
      return `${parsed.host}${parsed.pathname}`;
    } catch {
      return url.split("?")[0];
    }
  };

  return (
    <div className="dashboard-command-center">
      <header className="dashboard-header">
        <div className="dashboard-heading">
          <span className="eyebrow">{workspace.name}</span>
          <h1>Workspace Overview</h1>
          <p>
            Monitor execution results, response performance, and active service
            health.
          </p>
        </div>
        <div className="dashboard-toolbar">
          <label className="period-control dashboard-period-control">
            <FileClock size={15} />
            <span>Time range</span>
            <select
              aria-label="Dashboard time range"
              value={periodDays}
              onChange={(event) => setPeriodDays(Number(event.target.value))}
            >
              <option value={1}>24 hours</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <button
            className="button secondary dashboard-refresh"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh dashboard data"
            title="Refresh dashboard data"
          >
            <RefreshCw
              size={15}
              className={refreshing ? "dashboard-refreshing" : ""}
            />
            <span>{refreshing ? "Updating" : "Refresh"}</span>
          </button>
          <Link
            href="/studio"
            className="button primary"
            onClick={() => sessionStorage.removeItem("apiforge-open-request")}
          >
            <Plus size={16} /> New Request
          </Link>
        </div>
      </header>

      {error && (
        <div className="dashboard-stale-notice" role="status">
          <AlertTriangle size={15} /> Refresh failed. Showing the last available
          dashboard data. <button onClick={refresh}>Retry</button>
        </div>
      )}

      <section className="dashboard-kpis" aria-label="Workspace metrics">
        {kpis.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="dashboard-kpi panel"
          >
            <div className="dashboard-kpi-top">
              <span>{item.label}</span>
              <i className={`metric-icon ${item.tone}`}>
                <item.icon size={17} />
              </i>
            </div>
            <div className="dashboard-kpi-value">
              {item.value}
              <small>{item.unit}</small>
            </div>
            <p>
              <i className={`tiny-dot ${item.tone}`} />
              {item.detail}
            </p>
          </Link>
        ))}
      </section>

      <section
        className="dashboard-chart-grid"
        aria-label="Performance and execution health"
      >
        <Panel className="dashboard-card dashboard-response-panel">
          <div className="panel-heading dashboard-panel-heading">
            <div>
              <h2>Response performance</h2>
              <p>Daily response latency · {summary.period}</p>
            </div>
            <div
              className="dashboard-chart-switch"
              role="group"
              aria-label="Latency chart metric"
            >
              <button
                type="button"
                aria-pressed={latencyMode === "avg"}
                onClick={() => setLatencyMode("avg")}
              >
                Average
              </button>
              <button
                type="button"
                aria-pressed={latencyMode === "p95"}
                onClick={() => setLatencyMode("p95")}
              >
                P95
              </button>
            </div>
          </div>
          <ResponseTrend summary={summary} mode={latencyMode} />
        </Panel>
        <Panel className="dashboard-card dashboard-execution-panel">
          <div className="panel-heading dashboard-panel-heading">
            <div>
              <h2>Execution health</h2>
              <p>Response, test, and run-mode breakdowns</p>
            </div>
            <ShieldCheck size={18} className="dashboard-heading-icon" />
          </div>
          <ExecutionHealth summary={summary} />
        </Panel>
      </section>

      <section
        className="dashboard-operations-grid"
        aria-label="Workspace operations"
      >
        <Panel className="dashboard-card dashboard-recent-panel">
          <div className="panel-heading dashboard-panel-heading">
            <div>
              <h2>
                Recent executions{" "}
                <span className="dashboard-count">
                  {summary.recent_runs.length}
                </span>
              </h2>
              <p>
                Latest request runs with their response and executor results
              </p>
            </div>
            <Link href="/history" className="subtle-link">
              Run history <ArrowRight size={14} />
            </Link>
          </div>
          {summary.recent_runs.length ? (
            <div className="dashboard-execution-list">
              {summary.recent_runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/history?run=${run.id}`}
                  className="dashboard-execution-row"
                  aria-label={`Open details for ${run.name}, ${run.method}, ${run.outcome}`}
                >
                  <span className="dashboard-execution-request">
                    <span className={`method-text ${run.method.toLowerCase()}`}>
                      {run.method}
                    </span>
                    <span className="dashboard-execution-name">
                      <strong>{run.name}</strong>
                      <small title={run.url}>{endpoint(run.url)}</small>
                    </span>
                  </span>
                  <span className="dashboard-execution-result">
                    <Badge
                      tone={run.status && run.status < 400 ? "mint" : "red"}
                    >
                      {run.status || "No response"}
                    </Badge>
                    <span className={`result-label ${run.outcome}`}>
                      <i />
                      {run.outcome}
                    </span>
                  </span>
                  <span className="dashboard-execution-duration mono">
                    {run.duration_ms}
                    <small> ms</small>
                  </span>
                  <span className="dashboard-execution-time">
                    {when(run.created_at)}
                  </span>
                  <ArrowRight size={15} className="dashboard-execution-arrow" />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="No executions yet"
              text="Run a saved request in API Studio to populate this activity list."
            >
              <Link href="/studio" className="button secondary">
                <Plus size={14} /> New Request
              </Link>
            </Empty>
          )}
        </Panel>

        <div className="dashboard-side-operations">
          <Panel className="dashboard-card dashboard-monitor-panel">
            <div className="panel-heading dashboard-panel-heading">
              <div>
                <h2>Monitor health</h2>
                <p>{summary.active_monitors} active monitors</p>
              </div>
              <Link href="/monitoring" className="subtle-link">
                Manage <ArrowRight size={14} />
              </Link>
            </div>
            {summary.monitor_snapshots.length ? (
              <div className="dashboard-monitor-list">
                {summary.monitor_snapshots.map((monitor) => (
                  <Link
                    key={monitor.id}
                    href={`/monitoring?monitor=${monitor.id}`}
                    className="dashboard-monitor-row"
                  >
                    <span className="dashboard-monitor-status">
                      <i
                        className={
                          monitor.last_outcome === "passed"
                            ? "tone-mint"
                            : monitor.last_outcome === "failed"
                              ? "tone-red"
                              : "tone-neutral"
                        }
                      />
                      <span>
                        <strong>{monitor.name}</strong>
                        <small>
                          {monitor.last_run_at
                            ? `Last checked ${when(monitor.last_run_at)}`
                            : "Waiting for first check"}
                        </small>
                      </span>
                    </span>
                    <Badge
                      tone={
                        monitor.last_outcome === "passed"
                          ? "mint"
                          : monitor.last_outcome === "failed"
                            ? "red"
                            : "neutral"
                      }
                    >
                      {monitor.last_outcome === "passed"
                        ? "Healthy"
                        : monitor.last_outcome === "failed"
                          ? "Failing"
                          : "Pending"}
                    </Badge>
                  </Link>
                ))}
                {summary.active_monitors > summary.monitor_snapshots.length && (
                  <p className="dashboard-list-note">
                    Showing {summary.monitor_snapshots.length} of{" "}
                    {summary.active_monitors} active monitors.
                  </p>
                )}
              </div>
            ) : (
              <Empty
                title="No active monitors"
                text="Create a monitor to keep an endpoint health check running."
              >
                <Link href="/monitoring" className="button secondary">
                  <Plus size={14} /> Set up monitoring
                </Link>
              </Empty>
            )}
          </Panel>

          <Panel
            className={`dashboard-card dashboard-issues-panel ${hasIssues ? "has-issues" : "all-clear"}`}
          >
            <div className="panel-heading dashboard-panel-heading">
              <div>
                <h2>Issues requiring attention</h2>
                <p>Period failures, unresolved alerts, and monitor health</p>
              </div>
              {hasIssues ? (
                <AlertTriangle size={17} />
              ) : (
                <ShieldCheck size={18} />
              )}
            </div>
            {hasIssues ? (
              <div className="dashboard-issue-list">
                {summary.failed_runs > 0 && (
                  <Link
                    href="/history?outcome=failed"
                    className="dashboard-issue-row"
                  >
                    <i className="tone-red" />
                    <span>
                      <strong>
                        {summary.failed_runs} failed{" "}
                        {summary.failed_runs === 1 ? "execution" : "executions"}{" "}
                        in {summary.period.toLowerCase()}
                      </strong>
                      <small>
                        Open filtered Run History to review failed results
                      </small>
                    </span>
                    <ArrowRight size={14} />
                  </Link>
                )}
                {summary.open_alerts > 0 && (
                  <Link href="/alerts" className="dashboard-issue-row">
                    <i className="tone-red" />
                    <span>
                      <strong>
                        {summary.open_alerts} unresolved{" "}
                        {summary.open_alerts === 1 ? "alert" : "alerts"}
                      </strong>
                      <small>Review monitor incidents and alert history</small>
                    </span>
                    <ArrowRight size={14} />
                  </Link>
                )}
                {recentFailures.slice(0, 3).map((run) => (
                  <Link
                    key={run.id}
                    href={`/history?run=${run.id}`}
                    className="dashboard-issue-row"
                  >
                    <i className="tone-red" />
                    <span>
                      <strong>{run.name} failed</strong>
                      <small>
                        {run.status || run.error_code || "No response"} ·{" "}
                        {when(run.created_at)}
                      </small>
                    </span>
                    <ArrowRight size={14} />
                  </Link>
                ))}
                {failingMonitors.slice(0, 3).map((monitor) => (
                  <Link
                    key={monitor.id}
                    href={`/monitoring?monitor=${monitor.id}`}
                    className="dashboard-issue-row"
                  >
                    <i className="tone-amber" />
                    <span>
                      <strong>{monitor.name} needs review</strong>
                      <small>
                        {monitor.open_incidents
                          ? `${monitor.open_incidents} open monitor incidents`
                          : `${monitor.consecutive_failures} consecutive check failures`}
                      </small>
                    </span>
                    <ArrowRight size={14} />
                  </Link>
                ))}
                {!summary.failed_runs &&
                  !summary.open_alerts &&
                  !recentFailures.length &&
                  !failingMonitors.length && (
                    <Link href="/alerts" className="dashboard-issue-row">
                      <i className="tone-red" />
                      <span>
                        <strong>Open alerts need review</strong>
                        <small>View unresolved workspace alerts</small>
                      </span>
                      <ArrowRight size={14} />
                    </Link>
                  )}
              </div>
            ) : (
              <div className="dashboard-all-clear">
                <ShieldCheck size={20} />
                <span>
                  <strong>All clear</strong>
                  <small>
                    No failed executions in this period, unresolved alerts, or
                    recent monitor failures.
                  </small>
                </span>
              </div>
            )}
          </Panel>
        </div>
      </section>
    </div>
  );
}

export function Overview({
  summary: s,
  analytics,
  periodDays,
  setPeriodDays,
  summaryLoading = false,
  summaryError,
  refreshing = false,
  refresh = () => undefined,
  ...moduleProps
}: ModuleProps & {
  summary?: Summary;
  analytics: boolean;
  periodDays: number;
  setPeriodDays: (days: number) => void;
  summaryLoading?: boolean;
  summaryError?: string;
  refreshing?: boolean;
  refresh?: () => void;
}) {
  if (!analytics)
    return (
      <DashboardOverview
        {...moduleProps}
        summary={s}
        periodDays={periodDays}
        setPeriodDays={setPeriodDays}
        loading={summaryLoading}
        error={summaryError}
        refreshing={refreshing}
        refresh={refresh}
      />
    );
  if (!s) return null;
  const metrics = [
    {
      label: "Saved requests",
      value: s.requests.toLocaleString(),
      icon: FolderOpen,
      detail: `${s.collections} collections`,
      color: "mint",
    },
    {
      label: "Runs in period",
      value: s.total_runs.toLocaleString(),
      icon: ArrowDownLeft,
      detail: `${s.passed_runs} passed · ${s.failed_runs} failed`,
      color: "cyan",
    },
    {
      label: "Assertion pass rate",
      value:
        s.assertions_passed + s.assertions_failed === 0
          ? "—"
          : `${Math.round((s.assertions_passed / (s.assertions_passed + s.assertions_failed)) * 100)}%`,
      icon: CheckCheck,
      detail: `${s.assertions_passed.toLocaleString()} passed · ${s.assertions_failed.toLocaleString()} failed`,
      color: "mint",
    },
    {
      label: "Avg. response time",
      value: s.avg_latency_ms === null ? "—" : String(s.avg_latency_ms),
      unit: s.avg_latency_ms === null ? "" : "ms",
      icon: Clock3,
      detail:
        s.p95_latency_ms === null
          ? "No latency samples yet"
          : `P95 latency · ${s.p95_latency_ms} ms`,
      color: "violet",
    },
    {
      label: "Active monitors",
      value: String(s.active_monitors),
      icon: Activity,
      detail:
        s.monitor_availability === null
          ? "No scheduled checks yet"
          : `${s.monitor_availability}% successful checks`,
      color: "amber",
    },
    {
      label: "Open incidents",
      value: s.open_alerts.toLocaleString(),
      icon: Activity,
      detail: s.open_alerts
        ? "Needs review"
        : "No unresolved monitor incidents",
      color: s.open_alerts ? "red" : "mint",
    },
    {
      label: "Local runs",
      value: s.local_runs.toLocaleString(),
      icon: Gauge,
      detail: `${s.cloud_runs.toLocaleString()} cloud runs`,
      color: "cyan",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Workspace activity</div>
          <h1>
            {analytics ? "Reliability analytics" : "Workspace overview"}
            <span className="title-dot">.</span>
          </h1>
          <p>
            {analytics
              ? "Understand performance. Find the failure patterns."
              : "Requests, test results and monitor checks in this workspace."}
          </p>
        </div>
        <div className="heading-actions">
          <label className="period-control">
            <FileClock size={14} />
            <span>Period</span>
            <select
              aria-label="Analytics period"
              value={periodDays}
              onChange={(event) => setPeriodDays(Number(event.target.value))}
            >
              <option value={1}>24 hours</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <Link
            href="/studio"
            className="button primary"
            onClick={() => sessionStorage.removeItem("apiforge-open-request")}
          >
            <Plus size={16} /> New request
          </Link>
        </div>
      </div>
      {!analytics && (
        <div className="welcome-banner">
          <div className="welcome-symbol">
            <Zap size={26} />
          </div>
          <div>
            <strong>Send a request, then check the results.</strong>
            <p>Open a saved request or create one in the Studio.</p>
          </div>
          <Link href="/studio">
            Open Request Studio <ArrowUpRight size={16} />
          </Link>
          <div className="banner-grid" aria-hidden="true" />
        </div>
      )}
      <div className="metric-grid">
        {metrics.map((m) => (
          <Panel key={m.label} className="metric-card">
            <div>
              <span>{m.label}</span>
              <span className={`metric-icon ${m.color}`}>
                <m.icon size={17} />
              </span>
            </div>
            <strong>
              {m.value}
              <small>{m.unit}</small>
            </strong>
            <p>
              <span className={`tiny-dot ${m.color}`} />
              {m.detail}
            </p>
          </Panel>
        ))}
      </div>
      <div className="overview-grid">
        <Panel className="latency-panel">
          <div className="panel-heading">
            <div>
              <h2>Response time</h2>
              <p>Average latency across your workspace</p>
            </div>
            <Badge>
              <span className="legend-dot" /> Latency
            </Badge>
          </div>
          <LatencyChart summary={s} />
        </Panel>
        <Panel className="health-panel">
          <div className="panel-heading">
            <div>
              <h2>Workspace health</h2>
              <p>Every check, accounted for.</p>
            </div>
            <ShieldCheck size={17} className="muted" />
          </div>
          <div
            className="health-ring"
            style={
              { "--rate": `${s.success_rate ?? 0}%` } as React.CSSProperties
            }
          >
            <div>
              <strong>
                {s.success_rate === null ? "—" : `${s.success_rate}%`}
              </strong>
              <span>success rate</span>
            </div>
          </div>
          <div className="health-legend">
            <span>
              <i className="mint" /> Passed <strong>{s.passed_runs}</strong>
            </span>
            <span>
              <i className="red" /> Failed <strong>{s.failed_runs}</strong>
            </span>
          </div>
          <Link href="/analytics" className="panel-footer-link">
            Explore analytics <ArrowUpRight size={14} />
          </Link>
        </Panel>
      </div>
      {analytics && (
        <div className="trend-grid">
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Request activity</h2>
                <p>Requests executed per day in this period.</p>
              </div>
              <Badge>
                <span className="legend-dot cyan" /> Requests
              </Badge>
            </div>
            <ActivityChart summary={s} />
          </Panel>
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Assertion history</h2>
                <p>Real passing and failing checks per day.</p>
              </div>
              <div className="trend-legend">
                <span>
                  <i className="mint" /> Passed
                </span>
                <span>
                  <i className="red" /> Failed
                </span>
              </div>
            </div>
            <AssertionChart summary={s} />
          </Panel>
        </div>
      )}
      {analytics && (
        <div className="insights-grid">
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>HTTP status groups</h2>
                <p>Response classes during {s.period.toLowerCase()}.</p>
              </div>
            </div>
            <div
              className="status-distribution"
              role="img"
              aria-label="HTTP status distribution"
            >
              {s.status_classes.map((item) => {
                const percent = s.total_runs
                  ? Math.round((item.total / s.total_runs) * 100)
                  : 0;
                return (
                  <div className="status-row" key={item.category}>
                    <span>{item.category}</span>
                    <div className="status-track">
                      <i
                        className={`status-${item.category.replace(/[^a-z]/gi, "").toLowerCase()}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <strong>{item.total}</strong>
                    <small>{percent}%</small>
                  </div>
                );
              })}
              {!s.status_classes.length && (
                <p className="muted pad">No runs in this period.</p>
              )}
            </div>
          </Panel>
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Slowest endpoints</h2>
                <p>Average duration across saved and ad hoc runs.</p>
              </div>
            </div>
            {s.endpoint_performance.length ? (
              s.endpoint_performance.map((endpoint) => (
                <div
                  className="endpoint-performance-row"
                  key={`${endpoint.method}:${endpoint.name}`}
                >
                  <span
                    className={`method-text ${endpoint.method.toLowerCase()}`}
                  >
                    {endpoint.method}
                  </span>
                  <strong title={endpoint.name}>{endpoint.name}</strong>
                  <span className="mono">
                    {Math.round(Number(endpoint.avg_ms))} ms
                  </span>
                  <small>
                    {endpoint.passed}/{endpoint.runs} passed
                  </small>
                </div>
              ))
            ) : (
              <p className="muted pad">
                Endpoint performance will appear after a request runs.
              </p>
            )}
          </Panel>
        </div>
      )}
      {!analytics && (
        <Panel className="active-monitor-panel">
          <div className="panel-heading">
            <div>
              <h2>Active monitors</h2>
              <p>Latest scheduled health checks and open incidents.</p>
            </div>
            <Link href="/monitoring" className="subtle-link">
              Manage monitors <ArrowRight size={14} />
            </Link>
          </div>
          {s.monitor_snapshots.length ? (
            <div className="data-table active-monitor-table">
              <table>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Health</th>
                    <th>Last checked</th>
                    <th>Response</th>
                    <th>Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {s.monitor_snapshots.map((monitor) => (
                    <tr key={monitor.id}>
                      <td>
                        <strong>{monitor.name}</strong>
                      </td>
                      <td>
                        <Badge
                          tone={
                            monitor.last_outcome === "passed"
                              ? "mint"
                              : monitor.last_outcome === "failed"
                                ? "red"
                                : "neutral"
                          }
                        >
                          {monitor.last_outcome === "passed"
                            ? "Healthy"
                            : monitor.last_outcome === "failed"
                              ? `Failing · ${monitor.last_status || monitor.error_code || "Error"}`
                              : "Awaiting check"}
                        </Badge>
                      </td>
                      <td className="muted small">
                        {when(monitor.last_run_at)}
                      </td>
                      <td className="mono">
                        {monitor.last_duration_ms === null
                          ? "—"
                          : `${monitor.last_duration_ms} ms`}
                      </td>
                      <td>
                        {monitor.open_incidents ? (
                          <Badge tone="red">
                            {monitor.open_incidents} open
                          </Badge>
                        ) : (
                          <span className="muted">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No active monitors yet"
              text="Create a monitor to see scheduled service health and incidents here."
            >
              <Link className="button secondary" href="/monitoring">
                Set up monitoring <ArrowUpRight size={14} />
              </Link>
            </Empty>
          )}
        </Panel>
      )}
      {analytics && (
        <Panel className="failure-panel">
          <div className="panel-heading">
            <div>
              <h2>Failure classification</h2>
              <p>Derived from stored runs in this period.</p>
            </div>
          </div>
          {s.failure_classes.length ? (
            s.failure_classes.map((f) => (
              <div className="simple-row" key={f.category}>
                <code>{f.category}</code>
                <Badge tone="red">{f.total}</Badge>
              </div>
            ))
          ) : (
            <p className="muted pad">No failures recorded in this period.</p>
          )}
          <p className="small muted pad">
            Monitor availability:{" "}
            {s.monitor_availability === null
              ? "No samples"
              : `${s.monitor_availability}%`}{" "}
            across {s.monitor_checks} checks. This measures sampled checks, not
            continuous uptime.
          </p>
        </Panel>
      )}
      <Panel className="recent-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Recent activity <Badge>{s.recent_runs.length}</Badge>
            </h2>
            <p>Your latest API requests and test results</p>
          </div>
          <Link href="/history" className="subtle-link">
            View all activity <ArrowRight size={15} />
          </Link>
        </div>
        {s.recent_runs.length ? (
          <RunsTable runs={s.recent_runs} />
        ) : (
          <Empty
            title="No requests have run yet"
            text="Send your first request to start building a history you can trust."
          >
            <Link className="button secondary" href="/studio">
              Send a request <ArrowUpRight size={14} />
            </Link>
          </Empty>
        )}
      </Panel>
      <div className="quick-grid">
        <Link href="/collections" className="quick-card">
          <span className="quick-icon mint">
            <FolderOpen size={20} />
          </span>
          <div>
            <h3>Your collections</h3>
            <p>
              {s.collections} collections · {s.requests} saved requests
            </p>
          </div>
          <ArrowUpRight size={17} />
        </Link>
        <Link href="/monitoring" className="quick-card">
          <span className="quick-icon violet">
            <Activity size={20} />
          </span>
          <div>
            <h3>Stay one step ahead</h3>
            <p>Schedule checks. Catch issues early.</p>
          </div>
          <ArrowUpRight size={17} />
        </Link>
        <Link href="/settings" className="quick-card">
          <span className="quick-icon cyan">
            <Globe2 size={20} />
          </span>
          <div>
            <h3>Better, together</h3>
            <p>Invite your team into the workspace.</p>
          </div>
          <ArrowUpRight size={17} />
        </Link>
      </div>
    </>
  );
}
