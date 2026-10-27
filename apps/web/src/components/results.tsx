"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  FileJson,
  GitCompare,
  Link2,
  ListFilter,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { api, when } from "@/lib/api";
import type { Alert, Audit, Page, Run, Share } from "@/lib/types";
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
import { RunsTable } from "./overview";
import { ResponseInspector } from "./studio";

function Pagination({
  page,
  last,
  change,
}: {
  page: number;
  last: number;
  change: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        Page {page} of {last}
      </span>
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
      >
        Previous
      </Button>
      <Button
        variant="secondary"
        disabled={page >= last}
        onClick={() => change(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
function exportJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function History(
  p: ModuleProps & {
    initialRunId?: number;
    initialOutcome?: "passed" | "failed";
    initialSearch?: string;
    initialSource?: string;
    initialMode?: string;
  },
) {
  const routeQuery = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  );
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState(p.initialOutcome ?? "");
  const [source, setSource] = useState(
    p.initialSource ?? routeQuery.get("source") ?? "",
  );
  const [mode, setMode] = useState(
    p.initialMode ?? routeQuery.get("mode") ?? "",
  );
  const [search, setSearch] = useState(
    p.initialSearch ?? routeQuery.get("search") ?? "",
  );
  const [searchDraft, setSearchDraft] = useState(
    p.initialSearch ?? routeQuery.get("search") ?? "",
  );
  const [selected, setSelected] = useState<number | null>(
    p.initialRunId ?? null,
  );
  const [compare, setCompare] = useState(false);
  const [first, setFirst] = useState(0);
  const [second, setSecond] = useState(0);
  const [comparison, setComparison] = useState<{
    first: Run;
    second: Run;
    duration_delta_ms: number;
    status_changed: boolean;
    body_changed: boolean;
  } | null>(null);
  const history = useQuery({
    queryKey: [p.base, "runs", page, outcome, search, source, mode],
    queryFn: () =>
      api<Page<Run>>(
        `${p.base}/runs?${new URLSearchParams({ page: String(page), outcome, search, source, mode })}`,
      ),
  });
  const detail = useQuery({
    queryKey: [p.base, "run", selected],
    queryFn: () => api<Run>(`${p.base}/runs/${selected}`),
    enabled: !!selected,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Request runs</span>
          <h1>
            Run history<span className="title-dot">.</span>
          </h1>
          <p>Revisit results. Compare changes. Keep moving.</p>
        </div>
        <div className="heading-actions">
          <Button
            variant="secondary"
            disabled={!history.data?.data.length}
            onClick={() => exportJson(history.data?.data, "apiforge-runs.json")}
          >
            <ArrowDownToLine size={15} /> Export page
          </Button>
          <Button variant="secondary" onClick={() => setCompare(true)}>
            <GitCompare size={16} /> Compare runs
          </Button>
        </div>
      </div>
      <Panel>
        <div className="filter-bar">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchDraft);
              setPage(1);
            }}
            className="list-search"
          >
            <Search size={16} />
            <input
              aria-label="Search history"
              placeholder="Search request name…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
            <button className="icon-button" aria-label="Apply search">
              <ArrowUpRight size={15} />
            </button>
          </form>
          <select
            aria-label="Filter by result"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All results</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
          <select
            aria-label="Filter by source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All sources</option>
            <option value="manual">Manual requests</option>
            <option value="monitor">Monitor checks</option>
          </select>
          <select
            aria-label="Filter by execution mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Cloud and local</option>
            <option value="cloud">Cloud runs</option>
            <option value="local">Local runs</option>
          </select>
          <Badge>{history.data?.total ?? 0} runs</Badge>
        </div>
        {history.isPending ? (
          <Loading />
        ) : history.error ? (
          <p className="error-box">{history.error.message}</p>
        ) : history.data?.data.length ? (
          <RunsTable runs={history.data.data} open={(r) => setSelected(r.id)} />
        ) : (
          <Empty
            title="No runs found"
            text="Execute a request in the Studio or adjust your filters."
          />
        )}
        {history.data && (
          <Pagination
            page={page}
            last={history.data.last_page}
            change={setPage}
          />
        )}
      </Panel>
      {selected && (
        <Dialog title={`Run #${selected}`} close={() => setSelected(null)}>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <p className="error-box">{detail.error.message}</p>
          ) : (
            <>
              <p className="muted">
                {detail.data?.name} · {when(detail.data?.created_at)}
              </p>
              <ResponseInspector run={detail.data || null} />
              <div className="form-actions">
                <Button
                  variant="secondary"
                  onClick={() =>
                    exportJson(detail.data, `apiforge-run-${selected}.json`)
                  }
                >
                  <ArrowDownToLine size={14} /> Download result
                </Button>
              </div>
            </>
          )}
        </Dialog>
      )}
      {compare && (
        <Dialog
          title="Compare two runs"
          close={() => {
            setCompare(false);
            setComparison(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await p.act(() =>
                api<typeof comparison>(
                  `${p.base}/runs/compare?first=${first}&second=${second}`,
                ),
              );
              if (result) setComparison(result);
            }}
          >
            <div className="form-grid">
              <Field label="First run ID">
                <input
                  type="number"
                  required
                  min={1}
                  value={first || ""}
                  onChange={(e) => setFirst(Number(e.target.value))}
                />
              </Field>
              <Field label="Second run ID">
                <input
                  type="number"
                  required
                  min={1}
                  value={second || ""}
                  onChange={(e) => setSecond(Number(e.target.value))}
                />
              </Field>
            </div>
            <Button disabled={p.busy}>Compare</Button>
          </form>
          {comparison && (
            <>
              <div className="comparison-summary">
                <Badge tone={comparison.status_changed ? "red" : "mint"}>
                  Status {comparison.status_changed ? "changed" : "unchanged"}
                </Badge>
                <Badge tone={comparison.body_changed ? "amber" : "mint"}>
                  Body {comparison.body_changed ? "changed" : "unchanged"}
                </Badge>
                <Badge>
                  {comparison.duration_delta_ms > 0 ? "+" : ""}
                  {comparison.duration_delta_ms} ms
                </Badge>
              </div>
              <h3>Run #{comparison.first.id}</h3>
              <ResponseInspector run={comparison.first} />
              <h3>Run #{comparison.second.id}</h3>
              <ResponseInspector run={comparison.second} />
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

export function Alerts(p: ModuleProps) {
  const alerts = useQuery({
    queryKey: [p.base, "alerts"],
    queryFn: () => api<Alert[]>(`${p.base}/alerts`),
  });
  const deliveries = useQuery({
    queryKey: [p.base, "alert-deliveries"],
    queryFn: () =>
      api<
        {
          id: number;
          alert_event_id: number;
          channel: string;
          recovery: boolean;
          status: string;
          error_code: string | null;
          delivered_at: string | null;
          created_at: string;
        }[]
      >(`${p.base}/alert-deliveries`),
    refetchInterval: 30000,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Monitor incidents</span>
          <h1>
            Alerts<span className="title-dot">.</span>
          </h1>
          <p>Review monitor failures, recoveries and notification delivery.</p>
        </div>
        <Badge tone="violet">IN-APP NOTIFICATIONS</Badge>
      </div>
      <Panel>
        <div className="panel-heading">
          <h2>Monitor incidents</h2>
          <Badge>
            {alerts.data?.filter((a) => !a.resolved_at).length || 0} open
          </Badge>
        </div>
        {alerts.isPending ? (
          <Loading />
        ) : alerts.error ? (
          <p className="error-box">{alerts.error.message}</p>
        ) : !alerts.data?.length ? (
          <Empty
            title="No monitor incidents"
            text="Alerts appear when a monitor reaches its configured failure threshold."
          />
        ) : (
          alerts.data.map((a) => (
            <div key={a.id} className="alert-row">
              <span className={`quick-icon ${a.resolved_at ? "mint" : "red"}`}>
                <Bell size={19} />
              </span>
              <div>
                <strong>{a.message}</strong>
                <p>
                  {when(a.created_at)} ·{" "}
                  {a.resolved_at
                    ? `Recovered ${when(a.resolved_at)}`
                    : "Active incident"}
                </p>
              </div>
              <Badge tone={a.resolved_at ? "mint" : "red"}>
                {a.resolved_at ? "Resolved" : "Open"}
              </Badge>
              {a.acknowledged_at ? (
                <Badge>
                  <Check size={12} /> Acknowledged
                </Badge>
              ) : (
                <Button
                  variant="secondary"
                  disabled={!p.canEdit || p.busy}
                  onClick={() =>
                    p.act(
                      () =>
                        api(`${p.base}/alerts/${a.id}/acknowledge`, "PATCH"),
                      "Alert acknowledged.",
                    )
                  }
                >
                  Acknowledge
                </Button>
              )}
            </div>
          ))
        )}
      </Panel>
      <p className="small muted">
        One alert per active incident. Recovery automatically resolves it; a
        later incident creates a new alert.
      </p>
      <Panel className="delivery-panel">
        <div className="panel-heading">
          <div>
            <h2>Notification delivery</h2>
            <p>
              Recent email and webhook attempts. Enable channels in Team &
              settings.
            </p>
          </div>
        </div>
        {deliveries.error ? (
          <p className="error-box">{deliveries.error.message}</p>
        ) : !deliveries.data?.length ? (
          <Empty
            title="No external deliveries yet"
            text="Delivery records appear when an enabled channel processes an incident or recovery."
          />
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Event</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.data.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.alert_event_id}</td>
                    <td>{item.recovery ? "Recovery" : "Failure"}</td>
                    <td>{item.channel}</td>
                    <td>
                      <Badge tone={item.status === "sent" ? "mint" : "red"}>
                        {item.status === "sent"
                          ? "Accepted by transport"
                          : item.status}
                      </Badge>
                      {item.error_code && (
                        <small>{item.error_code.replaceAll("_", " ")}</small>
                      )}
                    </td>
                    <td>{when(item.delivered_at || item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

type AuditFilterValues = {
  action: string;
  actor: string;
  resource_type: string;
  date_from: string;
  date_to: string;
  sort: string;
};

function AuditFilterFields({
  filters,
  changeFilter,
}: {
  filters: AuditFilterValues;
  changeFilter: (key: keyof AuditFilterValues, value: string) => void;
}) {
  return (
    <div className="audit-filters">
      <label><span>Action category</span><select aria-label="Filter audit action category" value={filters.action} onChange={(event) => changeFilter("action", event.target.value)}><option value="">All activity</option><option value="workspace">Workspace</option><option value="collections">Collections</option><option value="requests">Requests</option><option value="environments">Environments</option><option value="monitoring">Monitoring & incidents</option><option value="access">Members & invitations</option><option value="reports">Reports</option><option value="integrations">Integrations</option><option value="platform">Platform administration</option><option value="other">Other</option></select></label>
      <label><span>Actor</span><input aria-label="Filter by actor" placeholder="Name or email" value={filters.actor} onChange={(event) => changeFilter("actor", event.target.value)} /></label>
      <label><span>Resource type</span><input aria-label="Filter by resource type" placeholder="e.g. ApiRequest" value={filters.resource_type} onChange={(event) => changeFilter("resource_type", event.target.value)} /></label>
      <label><span>From</span><input aria-label="Audit date from" type="date" value={filters.date_from} onChange={(event) => changeFilter("date_from", event.target.value)} /></label>
      <label><span>To</span><input aria-label="Audit date to" type="date" value={filters.date_to} onChange={(event) => changeFilter("date_to", event.target.value)} /></label>
      <label><span>Sort</span><select aria-label="Sort audit events" value={filters.sort} onChange={(event) => changeFilter("sort", event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="action_asc">Action A–Z</option><option value="action_desc">Action Z–A</option></select></label>
    </div>
  );
}

export function AuditLog(p: ModuleProps) {
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    action: "",
    actor: "",
    resource_type: "",
    date_from: "",
    date_to: "",
    sort: "newest",
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const log = useQuery({
    queryKey: [p.base, "audit", page, filters],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), per_page: "25" });
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      return api<Page<Audit>>(`${p.base}/audit?${params}`);
    },
  });
  const detail = useQuery({
    queryKey: [p.base, "audit-detail", selected],
    queryFn: () => api<Audit>(`${p.base}/audit/${selected}`),
    enabled: selected !== null,
  });
  const applySearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setFilters((current) => ({ ...current, search: searchDraft.trim() }));
  };
  const changeFilter = (key: keyof typeof filters, value: string) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const hasFilters = Object.values(filters).some((value) => value !== "" && value !== "newest");
  const exportRecords = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
      const result = await api<{ records: Audit[]; exported: number; total_matching: number; limited: boolean }>(`${p.base}/audit/export?${params}`);
      const rows = [
        ["event_id", "activity", "actor", "actor_email", "resource_type", "resource_id", "timestamp"],
        ...result.records.map((event) => [
          String(event.id),
          event.action,
          event.actor_name || (event.user_id ? `User #${event.user_id}` : "Not recorded"),
          event.actor_email || "",
          event.resource_type || "",
          event.resource_id == null ? "" : String(event.resource_id),
          event.created_at,
        ]),
      ];
      const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "fluxapi-audit-events.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      p.act(async () => result, result.limited ? `Downloaded ${result.exported} of ${result.total_matching} matching events (500 record limit).` : `Downloaded ${result.exported} audit events.`);
    } catch (error) {
      p.act(async () => { throw error; });
    } finally {
      setExporting(false);
    }
  };

  const activityLabel = (action: string) => {
    const known: Record<string, string> = {
      "request.executed": "Executed a request",
      "invitation.created": "Invited a workspace member",
      "invitation.accepted": "Accepted a workspace invitation",
      "invitation.revoked": "Revoked a workspace invitation",
      "member.removed": "Removed a workspace member",
      "member.updated": "Changed a member role",
      "workspace.preferences.updated": "Updated workspace preferences",
      "monitor.checked": "Ran a monitor check",
      "alert.acknowledged": "Acknowledged an incident",
      "report.shared": "Created a report share",
      "report.revoked": "Revoked a report share",
      "openapi.imported": "Imported an OpenAPI collection",
      "admin.quota.updated": "Updated a workspace quota",
    };
    if (known[action]) return known[action];
    const parts = action.split(".");
    const actionWord = parts.pop()?.replaceAll("_", " ") || "updated";
    const subject = parts.join(" ").replaceAll("_", " ") || "workspace item";
    return `${actionWord.charAt(0).toUpperCase()}${actionWord.slice(1)} ${subject}`;
  };
  const actorName = (event: Audit) => event.actor_name || (event.user_id ? `User #${event.user_id}` : "Not recorded");

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Workspace governance</span>
          <h1>Audit Trail</h1>
          <p>Search the recorded activity for {p.workspace.name}. Sensitive payloads are never included.</p>
        </div>
        <div className="audit-heading-actions">
          <Badge tone="violet"><ShieldCheck size={13} /> Workspace scoped</Badge>
          <Button variant="secondary" disabled={exporting || !log.data?.total} onClick={() => void exportRecords()}><ArrowDownToLine size={15} /> {exporting ? "Preparing export…" : "Export filtered events"}</Button>
        </div>
      </div>
      <div className="audit-summary-row">
        <div><Activity size={16} /><span>Matching events</span><strong>{log.data?.total ?? "—"}</strong></div>
        <div><CalendarDays size={16} /><span>Page</span><strong>{log.data?.current_page ?? page}<small> / {log.data?.last_page ?? 1}</small></strong></div>
        <div><SlidersHorizontal size={16} /><span>Export limit</span><strong>500<small> events</small></strong></div>
      </div>
      <Panel className="audit-explorer">
        <form className="audit-search-row" onSubmit={applySearch}>
          <label className="audit-search"><Search size={16} /><input aria-label="Search audit events" placeholder="Search activity, actor, event ID…" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></label>
          <Button type="submit" variant="secondary">Search</Button>
          <Button type="button" variant="secondary" className="audit-mobile-filter-trigger" onClick={() => setMobileFiltersOpen(true)}><ListFilter size={15} /> Filters</Button>
          <Button type="button" variant="ghost" disabled={!hasFilters} onClick={() => { setPage(1); setSearchDraft(""); setFilters({ search: "", action: "", actor: "", resource_type: "", date_from: "", date_to: "", sort: "newest" }); }}>Clear filters</Button>
        </form>
        <div className="audit-desktop-filters"><AuditFilterFields filters={filters} changeFilter={changeFilter} /></div>
        {log.isPending ? <Loading /> : log.error ? <p className="error-box" role="alert">{log.error.message}</p> : !log.data?.data.length ? (
          <Empty title={hasFilters ? "No events match these filters" : "No activity has been recorded yet"} text={hasFilters ? "Adjust your search or clear filters to see more workspace events." : "Workspace changes and recorded actions will appear here as they happen."} />
        ) : <>
          <div className="audit-result-meta"><span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, log.data.total)} of {log.data.total} events</span><span>Original event identifiers are retained for audit review</span></div>
          <div className="audit-table-wrap"><div className="data-table"><table className="audit-table"><thead><tr><th>Activity</th><th>Actor</th><th>Resource</th><th>Date & time</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
            {log.data.data.map((event) => <tr key={event.id}>
              <td><div className="audit-activity"><span className="audit-event-icon"><Activity size={15} /></span><span><strong>{activityLabel(event.action)}</strong><small><code>{event.action}</code></small></span></div></td>
              <td>{actorName(event)}{event.actor_email && <small className="audit-cell-subtitle">{event.actor_email}</small>}</td>
              <td>{event.resource_type ? <><span>{event.resource_type}</span>{event.resource_id != null && <small className="audit-cell-subtitle">ID {event.resource_id}</small>}</> : <span className="muted">Workspace</span>}</td>
              <td><time dateTime={event.created_at}>{when(event.created_at)}</time></td>
              <td><Button variant="ghost" aria-label={`View audit event ${event.id}`} onClick={() => setSelected(event.id)}>Details <ArrowUpRight size={14} /></Button></td>
            </tr>)}
          </tbody></table></div></div>
          <div className="audit-mobile-list">{log.data.data.map((event) => <article className="audit-mobile-card" key={event.id}><div className="audit-mobile-title"><span className="audit-event-icon"><Activity size={15} /></span><div><strong>{activityLabel(event.action)}</strong><small><code>{event.action}</code></small></div></div><div className="audit-mobile-facts"><span>Actor<strong>{actorName(event)}</strong></span><span>Resource<strong>{event.resource_type || "Workspace"}{event.resource_id != null ? ` #${event.resource_id}` : ""}</strong></span><span>Time<strong>{when(event.created_at)}</strong></span></div><Button variant="secondary" aria-label={`View audit event ${event.id}`} onClick={() => setSelected(event.id)}>View details</Button></article>)}</div>
          <Pagination page={page} last={log.data.last_page} change={setPage} />
        </>}
      </Panel>
      {mobileFiltersOpen && <Dialog title="Audit filters" close={() => setMobileFiltersOpen(false)}>
        <div className="audit-mobile-filter-dialog">
          <AuditFilterFields filters={filters} changeFilter={changeFilter} />
          <div className="audit-mobile-filter-actions"><span>Changes apply immediately</span><Button onClick={() => setMobileFiltersOpen(false)}>Done</Button></div>
        </div>
      </Dialog>}
      {selected !== null && <Dialog title={`Audit event ${selected}`} close={() => setSelected(null)}>
        {detail.isPending ? <Loading /> : detail.error ? <p className="error-box" role="alert">{detail.error.message}</p> : detail.data && <div className="audit-detail-content">
          <div className="audit-detail-heading"><span className="audit-event-icon"><Activity size={17} /></span><div><span className="eyebrow">Recorded activity</span><h3>{activityLabel(detail.data.action)}</h3><code>{detail.data.action}</code></div></div>
          <dl className="audit-detail-grid">
            <div><dt>Event ID</dt><dd>#{detail.data.id}</dd></div>
            <div><dt>Timestamp</dt><dd><time dateTime={detail.data.created_at}>{new Date(detail.data.created_at).toLocaleString()}</time></dd></div>
            <div><dt>Actor</dt><dd>{actorName(detail.data)}{detail.data.actor_email && <small>{detail.data.actor_email}</small>}</dd></div>
            <div><dt>Workspace</dt><dd>{detail.data.workspace_name || `Workspace #${detail.data.workspace_id}`}</dd></div>
            <div><dt>Resource</dt><dd>{detail.data.resource_type ? `${detail.data.resource_type}${detail.data.resource_id != null ? ` #${detail.data.resource_id}` : ""}` : "Not recorded"}</dd></div>
            <div><dt>Context</dt><dd className="muted">No additional metadata was stored for this event.</dd></div>
          </dl>
          {detail.data.resource_url && <a className="button secondary" href={detail.data.resource_url}><ExternalLink size={14} /> Open related resource</a>}
          <p className="audit-security-note"><ShieldCheck size={14} /> Audit details contain recorded identifiers only. Request bodies, credentials, tokens, and decrypted secrets are not included.</p>
        </div>}
      </Dialog>}
    </>
  );
}

export function Reports(p: ModuleProps) {
  const shares = useQuery({
    queryKey: [p.base, "shares"],
    queryFn: () => api<Share[]>(`${p.base}/shares`),
  });
  const [create, setCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [spec, setSpec] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Reports and imports</span>
          <h1>
            Reports & integrations<span className="title-dot">.</span>
          </h1>
          <p>Turn your results into something everyone can understand.</p>
        </div>
        <Button disabled={!p.canEdit} onClick={() => setCreate(true)}>
          <Plus size={15} /> Share a report
        </Button>
      </div>
      <div className="info-banner">
        <ShieldCheck size={18} />
        <span>
          Shared reports contain a fixed summary of results. Request URLs,
          response bodies, and secrets are excluded.
        </span>
      </div>
      {link && (
        <Panel className="share-created">
          <strong>Your read-only report is ready</strong>
          <div>
            <input aria-label="Report URL" readOnly value={link} />
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <a
              className="button secondary"
              href={link}
              target="_blank"
              rel="noreferrer"
            >
              Open <ArrowUpRight size={14} />
            </a>
          </div>
          <small className="muted">
            Copy this link now. Its access token is only shown once.
          </small>
        </Panel>
      )}
      <Panel>
        <div className="panel-heading">
          <h2>Shared reports</h2>
          <Badge>{shares.data?.length || 0}</Badge>
        </div>
        {shares.isPending ? (
          <Loading />
        ) : shares.error ? (
          <p className="error-box">{shares.error.message}</p>
        ) : shares.data?.length ? (
          shares.data.map((s) => (
            <div className="simple-row" key={s.id}>
              <span className="quick-icon violet">
                <Link2 size={18} />
              </span>
              <div>
                <strong>{s.name}</strong>
                <small>Expires {when(s.expires_at)}</small>
              </div>
              <Badge
                tone={
                  s.revoked_at
                    ? "red"
                    : new Date(s.expires_at) < new Date()
                      ? "neutral"
                      : "mint"
                }
              >
                {s.revoked_at
                  ? "Revoked"
                  : new Date(s.expires_at) < new Date()
                    ? "Expired"
                    : "Active"}
              </Badge>
              {!s.revoked_at && (
                <DeleteButton
                  name={s.name}
                  disabled={!p.canEdit}
                  remove={() =>
                    p.act(
                      () => api(`${p.base}/shares/${s.id}`, "DELETE"),
                      "Report access revoked.",
                    )
                  }
                />
              )}
            </div>
          ))
        ) : (
          <Empty
            title="No shared reports"
            text="Create a read-only report with an expiry of up to seven days."
          />
        )}
      </Panel>
      <Panel className="integration-card">
        <span className="quick-icon cyan">
          <FileJson size={23} />
        </span>
        <div>
          <h2>Bring your OpenAPI specification</h2>
          <p>
            Import OpenAPI 3.0 or 3.1 JSON into a collection with tagged
            folders, example parameters, and status assertions.
          </p>
          <small>
            Expand $ref references first. Remote documents, YAML, and schema
            validation are not supported.
          </small>
        </div>
        <Button
          variant="secondary"
          disabled={!p.canEdit}
          onClick={() => setImporting(true)}
        >
          <Upload size={15} /> Import OpenAPI
        </Button>
      </Panel>
      {create && (
        <Dialog
          title="Share a reliability report"
          close={() => setCreate(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const result = await p.act(
                () =>
                  api<{ token: string }>(`${p.base}/shares`, "POST", {
                    name: form.get("name"),
                    expires_in_hours: Number(form.get("hours")),
                  }),
                "Read-only report created.",
              );
              if (result) {
                setLink(`${location.origin}/report/${result.token}`);
                setCreate(false);
                setCopied(false);
              }
            }}
          >
            <Field label="Report name">
              <input
                required
                name="name"
                autoFocus
                placeholder="Weekly reliability review"
                maxLength={100}
              />
            </Field>
            <Field label="Expires in">
              <select name="hours">
                <option value={24}>24 hours</option>
                <option value={72}>3 days</option>
                <option value={168}>7 days</option>
              </select>
            </Field>
            <p className="muted small">
              The report captures results from the last seven days. Anyone with
              the link can read this summary until it expires or you revoke it.
            </p>
            <div className="form-actions">
              <Button disabled={p.busy}>Create report link</Button>
            </div>
          </form>
        </Dialog>
      )}
      {importing && (
        <Dialog
          title="Import an OpenAPI document"
          close={() => setImporting(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await p.act(
                () =>
                  api<{ imported_requests: number }>(
                    `${p.base}/openapi/import`,
                    "POST",
                    { document: spec },
                  ),
                "Specification imported into Collections.",
              );
              if (result) {
                setImporting(false);
                setSpec("");
              }
            }}
          >
            <Field label="Choose a JSON or YAML file">
              <input
                type="file"
                accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 450000) {
                      await p.act(async () => {
                        throw new Error(
                          "The specification exceeds the 450 KB import limit.",
                        );
                      });
                      return;
                    }
                    setSpec(await file.text());
                  }
                }}
              />
            </Field>
            <Field label="Or paste your specification">
              <textarea
                className="mono spec-input"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                required
                placeholder={'{"openapi":"3.0.3", ...}'}
              />
            </Field>
            <div className="form-actions">
              <Button disabled={p.busy}>Import collection</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
