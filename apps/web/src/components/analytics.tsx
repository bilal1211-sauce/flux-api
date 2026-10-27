"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import type { Summary } from "@/lib/types";
import type { ModuleProps } from "./console";
import { Badge, Button, Empty, Panel } from "./ui";

type Props = ModuleProps & {
  summary?: Summary;
  periodDays: number;
  setPeriodDays: (days: number) => void;
  endpoint: string;
  setEndpoint: (value: string) => void;
  source: string;
  setSource: (value: string) => void;
  mode: string;
  setMode: (value: string) => void;
  loading: boolean;
  error?: string;
  refreshing: boolean;
  refresh: () => void;
};

function countFor(summary: Summary, category: string) {
  return Number(
    summary.status_classes.find((item) => item.category === category)?.total ??
      0,
  );
}

function BarRows({
  rows,
  denominator,
  empty,
}: {
  rows: { label: string; value: number; color?: string }[];
  denominator: number;
  empty: string;
}) {
  if (!rows.length || !denominator)
    return <p className="analytics-empty-note">{empty}</p>;
  return (
    <div className="analytics-bars">
      {rows.map((row) => {
        const percent = denominator
          ? Math.min(100, (row.value / denominator) * 100)
          : 0;
        return (
          <div className="analytics-bar-row" key={row.label}>
            <span>{row.label}</span>
            <div>
              <i className={row.color ?? ""} style={{ width: `${percent}%` }} />
            </div>
            <strong>{row.value.toLocaleString()}</strong>
            <small>{percent.toFixed(1)}%</small>
          </div>
        );
      })}
    </div>
  );
}

function PerformanceChart({
  summary,
  days,
}: {
  summary: Summary;
  days: number;
}) {
  const points = summary.analytics_daily ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const width = 900;
  const height = 270;
  const left = 80;
  const right = 38;
  const top = 22;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const latencySamples = points
    .flatMap((point) => [point.avg_ms, point.p95_ms])
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
  const maxLatency = Math.max(100, ...latencySamples) * 1.15;
  const maxRuns = Math.max(1, ...points.map((point) => point.runs));
  const x = (index: number) =>
    left +
    (points.length <= 1
      ? plotWidth / 2
      : (index / (points.length - 1)) * plotWidth);
  const yLatency = (value: number) =>
    top + plotHeight - (value / maxLatency) * plotHeight;
  const volumeHeight = (value: number) => Math.max(2, (value / maxRuns) * 32);
  const pathFor = (metric: "avg_ms" | "p95_ms") => {
    const parts: string[] = [];
    let active = false;
    points.forEach((point, index) => {
      const value = point[metric];
      if (point.runs === 0 || value === null) {
        active = false;
        return;
      }
      parts.push(
        `${active ? "L" : "M"}${x(index).toFixed(1)},${yLatency(value).toFixed(1)}`,
      );
      active = true;
    });
    return parts.join(" ");
  };
  const active = selected === null ? null : points[selected];
  const label = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  const axisLabels =
    points.length <= 7
      ? points.map((point, index) => ({ ...point, index }))
      : [0, Math.floor((points.length - 1) / 2), points.length - 1].map(
          (index) => ({ ...points[index], index }),
        );
  if (!points.some((point) => point.runs > 0))
    return (
      <div className="analytics-chart-empty">
        <ChartNoAxesCombined size={22} />
        <span>No execution samples for this period and filter set.</span>
      </div>
    );
  return (
    <div className="analytics-chart-wrap">
      <div className="analytics-chart-legend">
        <span>
          <i className="avg" /> Average execution
        </span>
        <span>
          <i className="p95" /> P95 execution
        </span>
        <span>
          <i className="volume" /> Request volume
        </span>
        <span className="muted">P95 shown only for days with 20+ runs</span>
      </div>
      <div className="analytics-svg-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`Average and P95 execution duration with request volume, last ${days} days`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line
                className="analytics-gridline"
                x1={left}
                x2={width - right}
                y1={top + plotHeight * fraction}
                y2={top + plotHeight * fraction}
              />
              <text
                className="analytics-axis-text"
                x={left - 8}
                y={top + plotHeight * fraction + 4}
                textAnchor="end"
              >
                {Math.round(maxLatency * (1 - fraction))} ms
              </text>
            </g>
          ))}
          {points.map((point, index) => (
            <rect
              className="analytics-volume-bar"
              key={`volume-${point.day}`}
              x={x(index) - Math.min(10, plotWidth / points.length / 3)}
              y={top + plotHeight - volumeHeight(point.runs)}
              width={Math.min(20, plotWidth / points.length / 1.5)}
              height={volumeHeight(point.runs)}
              rx="3"
            />
          ))}
          <path className="analytics-average-path" d={pathFor("avg_ms")} />
          <path className="analytics-p95-path" d={pathFor("p95_ms")} />
          {points.map((point, index) =>
            point.avg_ms === null || point.runs === 0 ? (
              <g
                key={point.day}
                tabIndex={0}
                role="button"
                aria-label={`${label(point.day)}: no execution samples`}
                onFocus={() => setSelected(index)}
                onPointerDown={() => setSelected(index)}
              >
                <rect
                  className="analytics-hit-area"
                  x={x(index) - 12}
                  y={top}
                  width="24"
                  height={plotHeight}
                />
              </g>
            ) : (
              <g
                key={point.day}
                tabIndex={0}
                role="button"
                aria-label={`${label(point.day)}: ${point.runs} runs, average ${Math.round(point.avg_ms)} milliseconds${point.p95_ms === null ? ", P95 sample not available" : `, P95 ${Math.round(point.p95_ms)} milliseconds`}`}
                onFocus={() => setSelected(index)}
                onPointerDown={() => setSelected(index)}
                onMouseEnter={() => setSelected(index)}
              >
                <title>
                  {label(point.day)} · {point.runs} runs · average{" "}
                  {Math.round(point.avg_ms)} ms
                  {point.p95_ms === null
                    ? " · P95 requires 20 samples"
                    : ` · P95 ${Math.round(point.p95_ms)} ms`}
                </title>
                <rect
                  className="analytics-hit-area"
                  x={x(index) - 12}
                  y={top}
                  width="24"
                  height={plotHeight}
                />
                <circle
                  className="analytics-average-point"
                  cx={x(index)}
                  cy={yLatency(point.avg_ms)}
                  r="4"
                />
              </g>
            ),
          )}
          {axisLabels.map((point) => (
            <text
              className="analytics-axis-text"
              key={`label-${point.day}`}
              x={x(point.index)}
              y={height - 13}
              textAnchor="middle"
            >
              {label(point.day)}
            </text>
          ))}
          <text
            className="analytics-axis-right"
            x={width - right + 7}
            y={top + 12}
          >
            runs
          </text>
        </svg>
      </div>
      <div className="analytics-chart-tooltip" role="status" aria-live="polite">
        {active ? (
          <>
            <strong>{label(active.day)}</strong>
            <span>{active.runs.toLocaleString()} runs</span>
            <span>
              Average{" "}
              {active.avg_ms === null ? "—" : `${Math.round(active.avg_ms)} ms`}
            </span>
            <span>
              P95{" "}
              {active.p95_ms === null
                ? "Insufficient daily samples"
                : `${Math.round(active.p95_ms)} ms`}
            </span>
          </>
        ) : (
          <span>Focus or tap a chart day to inspect its samples.</span>
        )}
      </div>
    </div>
  );
}

export function Analytics({
  summary,
  periodDays,
  setPeriodDays,
  endpoint,
  setEndpoint,
  source,
  setSource,
  mode,
  setMode,
  loading,
  error,
  refreshing,
  refresh,
}: Props) {
  const [endpointDraft, setEndpointDraft] = useState(endpoint);
  const [endpointTab, setEndpointTab] = useState<
    "slowest" | "failures" | "volume"
  >("slowest");
  const endpointRows = useMemo(() => {
    if (!summary?.analytics) return [];
    if (endpointTab === "failures") return summary.analytics.failing_endpoints;
    if (endpointTab === "volume")
      return summary.analytics.highest_volume_endpoints;
    return summary.analytics.slowest_endpoints;
  }, [summary, endpointTab]);
  const assertionTotal =
    (summary?.assertions_passed ?? 0) + (summary?.assertions_failed ?? 0);
  const statuses = summary
    ? ["2xx", "3xx", "4xx", "5xx", "No response"].map((category) => ({
        label: category,
        value: countFor(summary, category),
        color:
          category === "2xx"
            ? "success"
            : category === "No response" || category === "5xx"
              ? "failure"
              : "",
      }))
    : [];
  const failures = (summary?.analytics?.failure_types ?? []).map((item) => ({
    label: item.category.replaceAll("_", " ").toLowerCase(),
    value: Number(item.total),
    color: "failure",
  }));
  const sourceRows = ["manual", "monitor"].map((category) => ({
    label: category === "manual" ? "Manual runs" : "Monitor checks",
    value: Number(
      summary?.analytics?.sources.find((item) => item.category === category)
        ?.total ?? 0,
    ),
  }));
  const modeRows = ["cloud", "local", "unknown"].map((category) => ({
    label:
      category === "cloud"
        ? "Cloud"
        : category === "local"
          ? "Local"
          : "Unknown mode",
    value: Number(
      summary?.analytics?.execution_modes.find(
        (item) => item.category === category,
      )?.total ?? 0,
    ),
  }));
  const checkDays = summary?.daily_monitor_checks ?? [];
  const opened = new Map(
    (summary?.incident_opened ?? []).map((item) => [item.day, item.total]),
  );
  const recovered = new Map(
    (summary?.incident_recoveries ?? []).map((item) => [item.day, item.total]),
  );
  const incidentDays = [
    ...new Set([...opened.keys(), ...recovered.keys()]),
  ].sort();
  const historyHref = (searchText = endpoint) => {
    const params = new URLSearchParams();
    if (searchText.trim()) params.set("search", searchText.trim());
    if (source) params.set("source", source);
    if (mode) params.set("mode", mode);
    return `/history${params.size ? `?${params}` : ""}`;
  };

  return (
    <>
      <div className="page-heading analytics-heading">
        <div>
          <span className="eyebrow">Performance intelligence</span>
          <h1>
            API Analytics<span className="title-dot">.</span>
          </h1>
          <p>
            Investigate execution time, response outcomes, and endpoint
            reliability across the selected window.
          </p>
        </div>
        <div className="analytics-heading-actions">
          <label className="analytics-select">
            <CalendarDays size={15} />
            <span className="sr-only">Date range</span>
            <select
              aria-label="Analytics period"
              value={periodDays}
              onChange={(event) => setPeriodDays(Number(event.target.value))}
            >
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </label>
          <Button variant="secondary" disabled={refreshing} onClick={refresh}>
            <RefreshCw
              size={15}
              className={refreshing ? "analytics-refreshing" : ""}
            />{" "}
            Refresh
          </Button>
        </div>
      </div>
      <Panel className="analytics-filter-panel">
        <form
          className="analytics-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setEndpoint(endpointDraft.trim());
          }}
        >
          <label className="analytics-endpoint-filter">
            <Search size={15} />
            <input
              aria-label="Filter by endpoint"
              maxLength={200}
              placeholder="Endpoint name, method, or URL"
              value={endpointDraft}
              onChange={(event) => setEndpointDraft(event.target.value)}
            />
            <button type="submit" className="analytics-apply-filter">
              Apply
            </button>
          </label>
          <label className="analytics-select">
            <Filter size={14} />
            <select
              aria-label="Execution source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">All sources</option>
              <option value="manual">Manual requests</option>
              <option value="monitor">Monitor checks</option>
            </select>
          </label>
          <label className="analytics-select">
            <Workflow size={14} />
            <select
              aria-label="Execution mode"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="">Cloud and local</option>
              <option value="cloud">Cloud</option>
              <option value="local">Local</option>
            </select>
          </label>
          {(endpoint || source || mode) && (
            <button
              className="analytics-clear-filter"
              type="button"
              onClick={() => {
                setEndpointDraft("");
                setEndpoint("");
                setSource("");
                setMode("");
              }}
            >
              Clear filters <span aria-hidden="true">×</span>
            </button>
          )}
        </form>
      </Panel>
      {error && (
        <div className="error-box" role="alert">
          Analytics could not load: {error}{" "}
          <Button variant="secondary" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      {loading && !summary ? (
        <div
          className="analytics-skeleton"
          role="status"
          aria-label="Loading API analytics"
        >
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : summary ? (
        <>
          <div className="analytics-kpi-row">
            <div>
              <span>Executions</span>
              <strong>{summary.total_runs.toLocaleString()}</strong>
              <small>
                {summary.success_rate === null
                  ? "No execution outcome data"
                  : `${summary.success_rate.toFixed(1)}% passed · ${summary.failed_runs.toLocaleString()} failed`}
              </small>
            </div>
            <div>
              <span>Average execution</span>
              <strong>
                {summary.avg_latency_ms === null
                  ? "—"
                  : `${summary.avg_latency_ms.toLocaleString()} ms`}
              </strong>
              <small>All recorded outcomes in this filter</small>
            </div>
            <div>
              <span>P95 execution</span>
              <strong>
                {summary.total_runs < 20 || summary.p95_latency_ms === null
                  ? "—"
                  : `${summary.p95_latency_ms.toLocaleString()} ms`}
              </strong>
              <small>
                {summary.total_runs < 20
                  ? "Fewer than 20 samples"
                  : "95th percentile duration"}
              </small>
            </div>
            <div>
              <span>Assertions</span>
              <strong>{assertionTotal.toLocaleString()}</strong>
              <small>
                {summary.assertions_passed.toLocaleString()} passed ·{" "}
                {summary.assertions_failed.toLocaleString()} failed
              </small>
            </div>
          </div>
          <Panel className="analytics-performance-panel">
            <div className="panel-heading">
              <div>
                <h2>Execution performance</h2>
                <p>
                  Average and P95 duration from persisted run records; daily
                  gaps break the lines.
                </p>
              </div>
              <Badge>
                <Activity size={13} /> {summary.period}
              </Badge>
            </div>
            <PerformanceChart summary={summary} days={periodDays} />
          </Panel>
          <div className="analytics-outcome-grid">
            <Panel>
              <div className="panel-heading">
                <div>
                  <h2>HTTP response classes</h2>
                  <p>
                    Denominator: {summary.total_runs.toLocaleString()} matching
                    executions, including “No response”.
                  </p>
                </div>
              </div>
              <BarRows
                rows={statuses}
                denominator={summary.total_runs}
                empty="No executions match these filters."
              />
            </Panel>
            <Panel>
              <div className="panel-heading">
                <div>
                  <h2>Failed execution classes</h2>
                  <p>
                    Each failed run is classified once by its persisted response
                    or execution error.
                  </p>
                </div>
                <ShieldAlert size={16} />
              </div>
              <BarRows
                rows={failures}
                denominator={summary.failed_runs}
                empty="No failed executions in this range."
              />
            </Panel>
            <Panel>
              <div className="panel-heading">
                <div>
                  <h2>Assertion outcomes</h2>
                  <p>
                    Denominator: saved assertions actually evaluated, not run
                    count.
                  </p>
                </div>
              </div>
              <BarRows
                rows={[
                  {
                    label: "Passed",
                    value: summary.assertions_passed,
                    color: "success",
                  },
                  {
                    label: "Failed",
                    value: summary.assertions_failed,
                    color: "failure",
                  },
                ]}
                denominator={assertionTotal}
                empty="No saved assertions were evaluated."
              />
            </Panel>
            <Panel>
              <div className="panel-heading">
                <div>
                  <h2>Execution source</h2>
                  <p>Persisted source labels for the matched executions.</p>
                </div>
              </div>
              <BarRows
                rows={sourceRows}
                denominator={summary.total_runs}
                empty="No executions match these filters."
              />
              <div className="analytics-mode-split">
                <h3>Runtime</h3>
                <BarRows
                  rows={modeRows}
                  denominator={summary.total_runs}
                  empty="No runtime data recorded."
                />
              </div>
            </Panel>
          </div>
          <Panel className="analytics-endpoints-panel">
            <div className="panel-heading">
              <div>
                <h2>Endpoint performance</h2>
                <p>
                  Grouped from matched runs; endpoint P95 is shown only with at
                  least 20 latency samples.
                </p>
              </div>
              <Link className="panel-footer-link" href={historyHref()}>
                <span>Open filtered history</span>
                <ArrowUpRight size={14} />
              </Link>
            </div>
            <div
              className="analytics-endpoint-tabs"
              role="tablist"
              aria-label="Endpoint rankings"
            >
              {(["slowest", "failures", "volume"] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={endpointTab === tab}
                  onClick={() => setEndpointTab(tab)}
                >
                  {tab === "slowest"
                    ? "Slowest"
                    : tab === "failures"
                      ? "Most failures"
                      : "Highest volume"}
                </button>
              ))}
            </div>
            {endpointRows.length ? (
              <div className="analytics-endpoint-list">
                {endpointRows.map((row) => (
                  <div
                    className="analytics-endpoint-row"
                    key={`${row.api_request_id ?? "adhoc"}-${row.method}-${row.name}`}
                  >
                    <span
                      className={`analytics-method ${row.method.toLowerCase()}`}
                    >
                      {row.method}
                    </span>
                    <div className="analytics-endpoint-name">
                      <strong title={row.name}>{row.name}</strong>
                      <small>
                        {row.runs.toLocaleString()} matched executions ·{" "}
                        {row.failed.toLocaleString()} failed
                      </small>
                    </div>
                    <div className="analytics-endpoint-metrics">
                      <span>
                        Avg{" "}
                        <strong>
                          {row.avg_ms === null
                            ? "—"
                            : `${Math.round(row.avg_ms)} ms`}
                        </strong>
                      </span>
                      {endpointTab === "slowest" && (
                        <span>
                          P95{" "}
                          <strong>
                            {"p95_ms" in row && typeof row.p95_ms === "number"
                              ? `${Math.round(row.p95_ms)} ms`
                              : "—"}
                          </strong>
                        </span>
                      )}
                    </div>
                    <Link
                      className="icon-button"
                      aria-label={`Open history for ${row.name}`}
                      href={historyHref(row.name)}
                    >
                      <ArrowUpRight size={15} />
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No endpoint rankings"
                text="No endpoint has matching executions for this period and filter set."
              />
            )}
          </Panel>
          <div className="analytics-reliability-grid">
            <Panel>
              <div className="panel-heading">
                <div>
                  <h2>Monitor check history</h2>
                  <p>
                    Recorded checks only · a check ratio is not inferred uptime.
                  </p>
                </div>
                <Clock3 size={16} />
              </div>
              <div className="analytics-monitor-summary">
                <strong>
                  {summary.monitor_availability === null
                    ? "—"
                    : `${summary.monitor_availability.toFixed(1)}%`}
                </strong>
                <span>
                  {summary.monitor_checks.toLocaleString()} matching checks
                  passed at this rate
                </span>
              </div>
              {checkDays.length ? (
                <div className="analytics-monitor-days">
                  {checkDays.map((day) => (
                    <div
                      key={day.day}
                      title={`${day.day}: ${day.passed}/${day.checks} passed`}
                    >
                      <span>
                        {new Date(`${day.day}T00:00:00`).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric" },
                        )}
                      </span>
                      <i>
                        <b
                          style={{
                            width: `${day.checks ? (day.passed / day.checks) * 100 : 0}%`,
                          }}
                        />
                      </i>
                      <strong>
                        {day.passed}/{day.checks}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="analytics-empty-note">
                  No monitor checks in this period.
                </p>
              )}
            </Panel>
            <Panel>
              <div className="panel-heading">
                <div>
                  <h2>Incident activity</h2>
                  <p>Incident records created and resolved in the workspace.</p>
                </div>
                <Activity size={16} />
              </div>
              {incidentDays.length ? (
                <div className="analytics-incident-days">
                  {incidentDays.map((day) => (
                    <div key={day}>
                      <time>
                        {new Date(`${day}T00:00:00`).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric" },
                        )}
                      </time>
                      <span className="opened">
                        <ArrowDownRight size={13} />
                        {opened.get(day) ?? 0} opened
                      </span>
                      <span className="recovered">
                        <ArrowUpRight size={13} />
                        {recovered.get(day) ?? 0} recovered
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="analytics-empty-note">
                  No incident or recovery records in this period.
                </p>
              )}
            </Panel>
          </div>
        </>
      ) : (
        <Empty
          title="Analytics unavailable"
          text="No summary response was returned. Check the workspace API connection and retry."
        >
          <Button variant="secondary" onClick={refresh}>
            Retry
          </Button>
        </Empty>
      )}
    </>
  );
}
