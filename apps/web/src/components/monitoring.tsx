"use client";

import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Edit3,
  Filter,
  History,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { api, when } from "@/lib/api";
import type {
  ApiRequest,
  Monitor,
  MonitorDetail,
  MonitorHistoryRun,
} from "@/lib/types";
import type { ModuleProps } from "./console";
import {
  Badge,
  Button,
  DeleteButton,
  Dialog,
  Empty,
  Field,
  Loading,
  Panel,
} from "./ui";

type Health = "healthy" | "degraded" | "failing" | "paused" | "waiting";
type Draft = {
  id?: number;
  name: string;
  api_request_id: number;
  environment_id: number | null;
  interval_minutes: number;
  enabled: boolean;
  failure_threshold: number;
};

function health(monitor: Monitor): Health {
  if (!monitor.enabled) return "paused";
  if (!monitor.last_outcome) return "waiting";
  if (monitor.last_outcome === "passed") return "healthy";
  return monitor.last_status === null || monitor.last_status === undefined
    ? "failing"
    : "degraded";
}

function healthLabel(value: Health) {
  return {
    healthy: "Healthy",
    degraded: "Degraded",
    failing: "Failing",
    paused: "Paused",
    waiting: "Awaiting check",
  }[value];
}

function endpointLabel(request?: ApiRequest) {
  if (!request?.url) return "Saved request unavailable";
  try {
    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const safePath = segments
      .map((segment, index) => {
        const previous = segments[index - 1] ?? "";
        const keyedSecret =
          /^(token|secret|password|api[_-]?key|authorization|bearer|signature|access[_-]?token)$/i.test(
            previous,
          );
        const tokenLike =
          segment.length >= 40 && /^[A-Za-z0-9._~-]+$/.test(segment);
        return keyedSecret || tokenLike ? "[redacted]" : segment;
      })
      .join("/");
    return `${url.host}${safePath || "/"}`;
  } catch {
    return request.url.split("?")[0].slice(0, 140);
  }
}

function errorKind(run: MonitorHistoryRun) {
  if (run.status === null)
    return `Execution failure${run.error_code ? ` · ${run.error_code}` : " · no response"}`;
  if (run.status >= 400) return `HTTP error · ${run.status}`;
  if (run.outcome === "failed")
    return `Assertion failure${run.error_code ? ` · ${run.error_code}` : ""}`;
  return `HTTP ${run.status} response`;
}

function StatusBadge({ value }: { value: Health }) {
  const tone =
    value === "healthy"
      ? "mint"
      : value === "degraded" || value === "failing"
        ? "red"
        : value === "waiting"
          ? "violet"
          : "neutral";
  return (
    <Badge tone={tone}>
      <span className={`health-pip ${value}`} />
      {healthLabel(value)}
    </Badge>
  );
}

function LatencyHistory({ runs }: { runs: MonitorHistoryRun[] }) {
  const points = runs
    .filter((run) => typeof run.duration_ms === "number")
    .slice(0, 16)
    .reverse();
  if (!points.length)
    return <p className="muted">No recorded latency samples yet.</p>;
  const max = Math.max(...points.map((point) => point.duration_ms ?? 0), 1);
  return (
    <div
      className="monitor-latency-chart"
      role="img"
      aria-label="Recorded monitor execution durations"
    >
      {points.map((point) => (
        <div
          className={`monitor-latency-bar ${point.outcome}`}
          key={point.id}
          title={`${point.duration_ms} ms · ${new Date(point.created_at).toLocaleString()}`}
        >
          <i
            style={{
              height: `${Math.max(5, ((point.duration_ms ?? 0) / max) * 100)}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function MonitorDetails({
  monitor,
  base,
  close,
}: {
  monitor: Monitor;
  base: string;
  close: () => void;
}) {
  const history = useInfiniteQuery({
    queryKey: [base, "monitor-history", monitor.id],
    queryFn: ({ pageParam }) =>
      api<MonitorDetail>(
        `${base}/monitors/${monitor.id}/history?page=${pageParam}&per_page=20`,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.history.current_page < lastPage.history.last_page
        ? lastPage.history.current_page + 1
        : undefined,
  });
  const detail = history.data?.pages[0];
  const runs = history.data?.pages.flatMap((page) => page.history.data) ?? [];
  return (
    <Dialog title={`${monitor.name} · monitor details`} close={close}>
      {history.isPending ? (
        <Loading />
      ) : history.error ? (
        <div role="alert" className="error-box">
          {history.error.message}
          <Button variant="secondary" onClick={() => void history.refetch()}>
            Retry
          </Button>
        </div>
      ) : detail ? (
        <div className="monitor-detail-content">
          <div className="monitor-detail-top">
            <div>
              <StatusBadge value={health(monitor)} />
              <p>
                {detail.monitor.request?.method ?? "Request"} ·{" "}
                {detail.monitor.request?.name ?? "Saved request unavailable"}
              </p>
              <code title="Credentials and query parameters are hidden">
                {detail.monitor.request?.endpoint ?? "Endpoint unavailable"}
              </code>
            </div>
            <Link
              className="button secondary"
              href={`/history?search=${encodeURIComponent(detail.monitor.request?.name ?? monitor.name)}&source=monitor&monitor_id=${monitor.id}`}
            >
              <History size={15} /> Run history <ExternalLink size={14} />
            </Link>
          </div>
          <div className="monitor-config-grid">
            <div>
              <span>Environment</span>
              <strong>
                {detail.monitor.environment_name ?? "No environment"}
              </strong>
            </div>
            <div>
              <span>Schedule</span>
              <strong>
                Every {detail.monitor.interval_minutes} min ·{" "}
                {monitor.enabled ? "enabled" : "paused"}
              </strong>
            </div>
            <div>
              <span>Alert threshold</span>
              <strong>
                {detail.monitor.failure_threshold ??
                  monitor.alert_rule?.failure_threshold ??
                  "—"}{" "}
                consecutive failures
              </strong>
            </div>
            <div>
              <span>Last successful check</span>
              <strong>{when(detail.monitor.last_success_at)}</strong>
            </div>
          </div>
          <section className="monitor-detail-section">
            <div className="panel-heading">
              <div>
                <h3>Recorded latency</h3>
                <p>
                  Execution duration for loaded checks. Missing values are
                  omitted.
                </p>
              </div>
              <Clock3 size={16} />
            </div>
            <LatencyHistory runs={runs} />
          </section>
          <section className="monitor-detail-section">
            <div className="panel-heading">
              <div>
                <h3>Check history</h3>
                <p>
                  Latest first · failures remain visible even after recovery.
                </p>
              </div>
            </div>
            {runs.length ? (
              <ol className="monitor-timeline">
                {runs.map((run) => (
                  <li key={run.id} className={run.outcome}>
                    <span className="timeline-mark" />
                    <div>
                      <strong>
                        {run.outcome === "passed" ? "Passed" : "Failed"}{" "}
                        <small>
                          {run.status === null
                            ? "No HTTP response"
                            : `HTTP ${run.status}`}
                        </small>
                      </strong>
                      <p>
                        {run.outcome === "failed"
                          ? errorKind(run)
                          : `${run.execution_mode ?? "Execution"} check`}
                      </p>
                      <time>
                        {when(run.created_at)} ·{" "}
                        {run.duration_ms === null
                          ? "—"
                          : `${run.duration_ms} ms`}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty
                title="No checks recorded"
                text="A monitor check will appear here after it runs."
              />
            )}
            {history.hasNextPage && (
              <Button
                variant="secondary"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {history.isFetchingNextPage ? "Loading…" : "Load older checks"}
                <ChevronDown size={14} />
              </Button>
            )}
          </section>
          <section className="monitor-detail-section">
            <div className="panel-heading">
              <div>
                <h3>Expected response and assertions</h3>
                <p>Assertion values are omitted from this diagnostics view.</p>
              </div>
            </div>
            <div className="monitor-assertions">
              {detail.monitor.request?.assertions.length ? (
                detail.monitor.request.assertions.map((assertion, index) => (
                  <div key={`${assertion.type}-${index}`}>
                    <Check size={14} />
                    <span>
                      {assertion.type.replaceAll("_", " ")}
                      {assertion.path ? ` · ${assertion.path}` : ""}
                    </span>
                    {assertion.expected_status !== null && (
                      <Badge>HTTP {assertion.expected_status}</Badge>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">No saved assertions are configured.</p>
              )}
            </div>
          </section>
          <section className="monitor-detail-section">
            <div className="panel-heading">
              <div>
                <h3>Related incidents</h3>
                <p>
                  {detail.incidents.length} recent incident
                  {detail.incidents.length === 1 ? "" : "s"}
                </p>
              </div>
              <TriangleAlert size={16} />
            </div>
            {detail.incidents.length ? (
              <ul className="monitor-incidents">
                {detail.incidents.map((incident) => (
                  <li key={incident.id}>
                    <span
                      className={incident.resolved_at ? "resolved" : "open"}
                    >
                      {incident.resolved_at ? "Resolved" : "Open"}
                    </span>
                    <Link href={`/alerts?incident=${incident.id}`}>{incident.message}</Link>
                    <time>{when(incident.created_at)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No incidents are linked to this monitor.</p>
            )}
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}

export function Monitoring(p: ModuleProps) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<Monitor | null>(null);
  const [requestedMonitorId] = useState(() => {
    const requested = typeof window === "undefined"
      ? 0
      : Number(new URLSearchParams(window.location.search).get("monitor"));
    return Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  });
  const [dismissedRouteMonitor, setDismissedRouteMonitor] = useState(false);
  const routeDetail = requestedMonitorId && !dismissedRouteMonitor
    ? p.monitors.find((monitor) => monitor.id === requestedMonitorId) ?? null
    : null;
  const activeDetail = detail ?? routeDetail;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!requestedMonitorId || routeDetail || !p.hasMoreMonitors || p.loadingMoreMonitors) return;
    p.loadMoreMonitors();
  }, [requestedMonitorId, routeDetail, p]);
  const requestById = useMemo(
    () =>
      new Map(
        p.requests
          .filter((request) => request.id)
          .map((request) => [request.id!, request]),
      ),
    [p.requests],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = p.monitors.filter((monitor) => {
      const request = requestById.get(monitor.api_request_id);
      const matches =
        !query ||
        `${monitor.name} ${request?.name ?? ""} ${request?.method ?? ""} ${endpointLabel(request)}`
          .toLowerCase()
          .includes(query);
      return matches && (status === "all" || health(monitor) === status);
    });
    rows.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "failures"
          ? b.consecutive_failures - a.consecutive_failures
          : (b.last_run_at ?? "").localeCompare(a.last_run_at ?? ""),
    );
    return rows;
  }, [p.monitors, requestById, search, sort, status]);
  const pageSize = 15;
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const checkCount =
    p.monitorSummary?.checks_in_period ??
    p.monitors.reduce((sum, monitor) => sum + (monitor.checks_7d ?? 0), 0);
  const passedCount =
    p.monitorSummary?.passed_in_period ??
    p.monitors.reduce((sum, monitor) => sum + (monitor.passed_7d ?? 0), 0);
  const healthy =
    p.monitorSummary?.healthy ??
    p.monitors.filter((monitor) => health(monitor) === "healthy").length;
  const unhealthy =
    p.monitorSummary?.unhealthy ??
    p.monitors.filter((monitor) =>
      ["degraded", "failing"].includes(health(monitor)),
    ).length;
  const paused =
    p.monitorSummary?.paused ??
    p.monitors.filter((monitor) => health(monitor) === "paused").length;
  const openIncidents =
    p.monitorSummary?.open_incidents ??
    p.monitors.reduce((sum, monitor) => sum + (monitor.open_incidents ?? 0), 0);
  const resetPage = (change: () => void) => {
    change();
    setPage(1);
  };

  return (
    <>
      <div className="page-heading monitoring-heading">
        <div>
          <span className="eyebrow">Service health center</span>
          <h1>
            Monitoring<span className="title-dot">.</span>
          </h1>
          <p>
            Track scheduled checks, failures, and incidents across{" "}
            {p.monitorTotal ?? p.monitors.length} monitored services.
          </p>
        </div>
        <Button
          disabled={!p.canEdit || !p.requests.length}
          onClick={() =>
            setEditing({
              name: "",
              api_request_id: p.requests[0]?.id ?? 0,
              environment_id: p.environments[0]?.id ?? null,
              interval_minutes: 5,
              enabled: true,
              failure_threshold: 2,
            })
          }
        >
          <Plus size={16} /> Create monitor
        </Button>
      </div>
      <div className="monitor-overview-grid" aria-label="Monitoring overview">
        <div>
          <span>Total monitors</span>
          <strong>{p.monitorTotal ?? p.monitors.length}</strong>
          <small>Configured in this workspace</small>
        </div>
        <div>
          <span>Healthy</span>
          <strong className="healthy-text">{healthy}</strong>
          <small>Latest check passed</small>
        </div>
        <div>
          <span>Degraded / failing</span>
          <strong className={unhealthy ? "danger-text" : ""}>
            {unhealthy}
          </strong>
          <small>Most recent check did not pass</small>
        </div>
        <div>
          <span>Paused</span>
          <strong>{paused}</strong>
          <small>Scheduling disabled</small>
        </div>
        <div>
          <span>Open incidents</span>
          <strong className={openIncidents ? "danger-text" : ""}>
            {openIncidents}
          </strong>
          <small>Unresolved monitor events</small>
        </div>
        <div>
          <span>7-day check success</span>
          <strong>
            {checkCount
              ? `${((passedCount / checkCount) * 100).toFixed(1)}%`
              : "—"}
          </strong>
          <small>{checkCount.toLocaleString()} recorded checks</small>
        </div>
      </div>
      <Panel className="monitor-explorer">
        <div className="monitor-explorer-head">
          <div>
            <h2>Monitored services</h2>
            <p>
              Current health follows the most recent check. Older success never
              clears a newer failure.
            </p>
          </div>
          <div className="monitor-explorer-count">
            <Activity size={15} /> {p.monitorTotal ?? p.monitors.length} total
          </div>
        </div>
        <div className="monitor-toolbar">
          <label className="monitor-search">
            <Search size={15} />
            <input
              aria-label="Search monitors"
              placeholder="Search service or endpoint"
              value={search}
              onChange={(event) =>
                resetPage(() => setSearch(event.target.value))
              }
            />
            <kbd>/</kbd>
          </label>
          <label className="monitor-select">
            <Filter size={14} />
            <select
              aria-label="Filter monitor health"
              value={status}
              onChange={(event) =>
                resetPage(() => setStatus(event.target.value))
              }
            >
              <option value="all">All health states</option>
              <option value="healthy">Healthy</option>
              <option value="degraded">Degraded</option>
              <option value="failing">Failing</option>
              <option value="paused">Paused</option>
              <option value="waiting">Awaiting check</option>
            </select>
          </label>
          <label className="monitor-select">
            <ArrowDownUp size={14} />
            <select
              aria-label="Sort monitors"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="recent">Most recently checked</option>
              <option value="name">Name A–Z</option>
              <option value="failures">Most failures</option>
            </select>
          </label>
        </div>
        {p.monitors.length ? (
          <>
            <div className="monitor-table-wrap">
              <table className="monitor-table">
                <thead>
                  <tr>
                    <th>Service / endpoint</th>
                    <th>Environment</th>
                    <th>Health</th>
                    <th>Interval</th>
                    <th>Last execution</th>
                    <th>Latency</th>
                    <th>Failures</th>
                    <th>Incident</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((monitor) => {
                    const request = requestById.get(monitor.api_request_id);
                    const currentHealth = health(monitor);
                    return (
                      <tr
                        key={monitor.id}
                        onClick={() => setDetail(monitor)}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setDetail(monitor);
                          }
                        }}
                        aria-label={`Open ${monitor.name} details`}
                      >
                        <td>
                          <div className="monitor-name-cell">
                            <span
                              className={`monitor-service-icon ${currentHealth}`}
                            >
                              <Activity size={15} />
                            </span>
                            <span>
                              <strong>{monitor.name}</strong>
                              <small>
                                {request?.method ?? "API"} ·{" "}
                                {endpointLabel(request)}
                              </small>
                            </span>
                          </div>
                        </td>
                        <td>
                          {p.environments.find(
                            (environment) =>
                              environment.id === monitor.environment_id,
                          )?.name ?? "No environment"}
                        </td>
                        <td>
                          <StatusBadge value={currentHealth} />
                        </td>
                        <td>{monitor.interval_minutes} min</td>
                        <td>{when(monitor.last_run_at)}</td>
                        <td>
                          {monitor.last_duration_ms == null
                            ? "—"
                            : `${monitor.last_duration_ms} ms`}
                        </td>
                        <td
                          className={
                            monitor.consecutive_failures ? "danger-text" : ""
                          }
                        >
                          {monitor.consecutive_failures}
                        </td>
                        <td>
                          {monitor.open_incidents ? (
                            <Badge tone="red">
                              {monitor.open_incidents} open
                            </Badge>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <div className="monitor-row-actions">
                            <button
                              className="icon-button"
                              aria-label={`Open ${monitor.name} details`}
                              title="Details"
                              onClick={() => setDetail(monitor)}
                            >
                              <ArrowUpRight size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={
                                monitor.enabled
                                  ? `Pause ${monitor.name}`
                                  : `Resume ${monitor.name}`
                              }
                              title={
                                monitor.enabled
                                  ? "Pause monitor"
                                  : "Resume monitor"
                              }
                              disabled={!p.canEdit || p.busy}
                              onClick={() =>
                                p.act(
                                  () =>
                                    api(
                                      `${p.base}/monitors/${monitor.id}`,
                                      "PUT",
                                      {
                                        name: monitor.name,
                                        api_request_id: monitor.api_request_id,
                                        environment_id: monitor.environment_id,
                                        interval_minutes:
                                          monitor.interval_minutes,
                                        enabled: !monitor.enabled,
                                        failure_threshold:
                                          monitor.alert_rule
                                            ?.failure_threshold ?? 2,
                                      },
                                    ),
                                  monitor.enabled
                                    ? "Monitor paused."
                                    : "Monitor resumed.",
                                )
                              }
                            >
                              {monitor.enabled ? (
                                <Pause size={14} />
                              ) : (
                                <Play size={14} />
                              )}
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Check ${monitor.name} now`}
                              disabled={
                                !p.canEdit || p.busy || !monitor.enabled
                              }
                              onClick={() =>
                                p.act(
                                  () =>
                                    api(
                                      `${p.base}/monitors/${monitor.id}/check`,
                                      "POST",
                                    ),
                                  "Monitor check requested.",
                                )
                              }
                            >
                              <Activity size={14} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Edit ${monitor.name}`}
                              disabled={!p.canEdit}
                              onClick={() =>
                                setEditing({
                                  id: monitor.id,
                                  name: monitor.name,
                                  api_request_id: monitor.api_request_id,
                                  environment_id: monitor.environment_id,
                                  interval_minutes: monitor.interval_minutes,
                                  enabled: monitor.enabled,
                                  failure_threshold:
                                    monitor.alert_rule?.failure_threshold ?? 2,
                                })
                              }
                            >
                              <Edit3 size={14} />
                            </button>
                            <DeleteButton
                              name={monitor.name}
                              disabled={!p.canEdit}
                              remove={() =>
                                p.act(
                                  () =>
                                    api(
                                      `${p.base}/monitors/${monitor.id}`,
                                      "DELETE",
                                    ),
                                  "Monitor deleted.",
                                )
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="monitor-mobile-list">
              {visible.map((monitor) => {
                const request = requestById.get(monitor.api_request_id);
                const currentHealth = health(monitor);
                return (
                  <article className="monitor-mobile-card" key={monitor.id}>
                    <button
                      className="monitor-mobile-open"
                      onClick={() => setDetail(monitor)}
                    >
                      <span className="monitor-name-cell">
                        <span
                          className={`monitor-service-icon ${currentHealth}`}
                        >
                          <Activity size={15} />
                        </span>
                        <span>
                          <strong>{monitor.name}</strong>
                          <small>
                            {request?.method ?? "API"} ·{" "}
                            {endpointLabel(request)}
                          </small>
                        </span>
                      </span>
                      <StatusBadge value={currentHealth} />
                    </button>
                    <div className="monitor-mobile-meta">
                      <span>{monitor.interval_minutes} min interval</span>
                      <span>
                        {monitor.last_duration_ms == null
                          ? "—"
                          : `${monitor.last_duration_ms} ms`}
                      </span>
                      <span>
                        {monitor.open_incidents
                          ? `${monitor.open_incidents} open incident`
                          : "No open incident"}
                      </span>
                    </div>
                    <div className="monitor-mobile-actions">
                      <Button
                        variant="secondary"
                        disabled={!p.canEdit || p.busy || !monitor.enabled}
                        onClick={() =>
                          p.act(
                            () =>
                              api(
                                `${p.base}/monitors/${monitor.id}/check`,
                                "POST",
                              ),
                            "Monitor check requested.",
                          )
                        }
                      >
                        <Activity size={14} /> Check now
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!p.canEdit || p.busy}
                        onClick={() =>
                          p.act(
                            () =>
                              api(`${p.base}/monitors/${monitor.id}`, "PUT", {
                                name: monitor.name,
                                api_request_id: monitor.api_request_id,
                                environment_id: monitor.environment_id,
                                interval_minutes: monitor.interval_minutes,
                                enabled: !monitor.enabled,
                                failure_threshold:
                                  monitor.alert_rule?.failure_threshold ?? 2,
                              }),
                            monitor.enabled
                              ? "Monitor paused."
                              : "Monitor resumed.",
                          )
                        }
                      >
                        {monitor.enabled ? (
                          <Pause size={14} />
                        ) : (
                          <Play size={14} />
                        )}
                        {monitor.enabled ? "Pause" : "Resume"}
                      </Button>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${monitor.name}`}
                        disabled={!p.canEdit}
                        onClick={() =>
                          setEditing({
                            id: monitor.id,
                            name: monitor.name,
                            api_request_id: monitor.api_request_id,
                            environment_id: monitor.environment_id,
                            interval_minutes: monitor.interval_minutes,
                            enabled: monitor.enabled,
                            failure_threshold:
                              monitor.alert_rule?.failure_threshold ?? 2,
                          })
                        }
                      >
                        <Edit3 size={14} />
                      </button>
                      <DeleteButton
                        name={monitor.name}
                        disabled={!p.canEdit}
                        remove={() =>
                          p.act(
                            () =>
                              api(`${p.base}/monitors/${monitor.id}`, "DELETE"),
                            "Monitor deleted.",
                          )
                        }
                      />
                    </div>
                  </article>
                );
              })}
            </div>
            {!visible.length && (
              <Empty
                title="No matching monitors"
                text="Try another service name or health filter."
              />
            )}
            <div className="monitor-pagination">
              <span>
                Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–
                {Math.min(page * pageSize, filtered.length)} of{" "}
                {filtered.length} loaded
                {p.monitorTotal !== undefined
                  ? ` · ${p.monitorTotal} total`
                  : ""}
              </span>
              <div>
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    page * pageSize >= filtered.length && !p.hasMoreMonitors
                  }
                  onClick={() => {
                    if (page * pageSize >= filtered.length && p.hasMoreMonitors)
                      p.loadMoreMonitors();
                    else setPage(page + 1);
                  }}
                >
                  {page * pageSize >= filtered.length && p.hasMoreMonitors
                    ? p.loadingMoreMonitors
                      ? "Loading…"
                      : "Load more"
                    : "Next"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            title="No monitors configured"
            text="Choose a saved request, set an interval, and let FluxAPI track the latest check and incident state."
          >
            <Button
              disabled={!p.canEdit || !p.requests.length}
              onClick={() =>
                setEditing({
                  name: "",
                  api_request_id: p.requests[0]?.id ?? 0,
                  environment_id: p.environments[0]?.id ?? null,
                  interval_minutes: 5,
                  enabled: true,
                  failure_threshold: 2,
                })
              }
            >
              <Plus size={15} /> Create your first monitor
            </Button>
          </Empty>
        )}
      </Panel>
      <div className="monitor-security-note">
        <ShieldCheck size={15} />
        <span>
          Cloud monitoring uses the existing approved-destination checks and
          execution quotas.
        </span>
      </div>
      {activeDetail && (
        <MonitorDetails
          monitor={activeDetail}
          base={p.base}
          close={() => {
            setDetail(null);
            setDismissedRouteMonitor(true);
          }}
        />
      )}
      {editing && (
        <Dialog
          title={editing.id ? "Edit monitor" : "Create monitor"}
          close={() => setEditing(null)}
        >
          <form
            className="monitor-edit-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await p.act(
                () =>
                  api(
                    `${p.base}/monitors${editing.id ? `/${editing.id}` : ""}`,
                    editing.id ? "PUT" : "POST",
                    editing,
                  ),
                "Monitor saved.",
              );
              if (result) setEditing(null);
            }}
          >
            <Field label="Monitor name">
              <input
                required
                autoFocus
                maxLength={150}
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </Field>
            <Field label="Saved request">
              <select
                required
                value={editing.api_request_id}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    api_request_id: Number(event.target.value),
                  })
                }
              >
                {p.requests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {request.method} · {request.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Environment">
              <select
                value={editing.environment_id ?? 0}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    environment_id: Number(event.target.value) || null,
                  })
                }
              >
                <option value={0}>No environment</option>
                {p.environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Interval (minutes)">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  required
                  value={editing.interval_minutes}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      interval_minutes: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Failures before incident">
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={editing.failure_threshold}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      failure_threshold: Number(event.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(event) =>
                  setEditing({ ...editing, enabled: event.target.checked })
                }
              />{" "}
              Enable scheduled checks
            </label>
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(null)}
              >
                <X size={14} /> Cancel
              </Button>
              <Button
                disabled={!p.canEdit || p.busy || !editing.api_request_id}
              >
                <Check size={14} /> Save monitor
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
