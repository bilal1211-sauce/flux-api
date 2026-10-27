"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Clock3,
  ExternalLink,
  Filter,
  GitCompare,
  Search,
  X,
} from "lucide-react";
import { api, when } from "@/lib/api";
import type { HistoryRouteFilters } from "@/lib/route-state";
import type { Page, Run } from "@/lib/types";
import type { ModuleProps } from "./console";
import { Badge, Button, Dialog, Empty, Loading, Panel } from "./ui";
import { ResponseInspector } from "./studio";

type RunFilters = {
  search: string;
  method: string;
  status: string;
  outcome: string;
  classification: string;
  assertion_outcome: string;
  source: string;
  mode: string;
  monitor_id: string;
  date_from: string;
  date_to: string;
  sort: string;
};

type Comparison = {
  first: Run;
  second: Run;
  duration_delta_ms: number;
  size_delta_bytes: number;
  status_changed: boolean;
  outcome_changed: boolean;
  assertion_outcome_changed: boolean;
  failure_classification_changed: boolean;
  headers_changed: boolean;
  body_comparable: boolean;
  body_changed: boolean | null;
};

type ExportBundle = {
  records: Run[];
  meta: { total: number; exported: number; truncated: boolean; limit: number };
};

function routeValue(key: string): string {
  return typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get(key) ?? "";
}

function exportJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filterParams(filters: RunFilters, page?: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === "sort" && value === "newest")) params.set(key, value);
  }
  if (page && page > 1) {
    params.set("page", String(page));
  }
  return params;
}

function ResultBadge({ run }: { run: Run }) {
  const classification = run.failure_classification ?? (run.outcome === "passed" ? "success" : "execution_failure");
  const labels: Record<string, string> = {
    success: "Passed",
    execution_failure: "Execution failure",
    http_failure: "HTTP failure",
    assertion_failure: "Assertion failure",
  };
  const tone = classification === "success" ? "mint" : classification === "http_failure" || classification === "execution_failure" ? "red" : "amber";
  return <Badge tone={tone}>{labels[classification] ?? "Failed"}</Badge>;
}

function StatusBadge({ status }: { status: number | null }) {
  if (status === null) return <Badge tone="red">No response</Badge>;
  const tone = status >= 200 && status < 300 ? "mint" : status < 400 ? "amber" : "red";
  return <Badge tone={tone}>{status}</Badge>;
}

function Pagination({ page, last, change }: { page: number; last: number; change: (value: number) => void }) {
  if (last <= 1) return null;
  return (
    <div className="pagination history-pagination">
      <span>Page {page} of {last}</span>
      <div>
        <Button variant="secondary" disabled={page <= 1} onClick={() => change(page - 1)}>Previous</Button>
        <Button variant="secondary" disabled={page >= last} onClick={() => change(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function RunFacts({ run }: { run: Run }) {
  return (
    <dl className="run-facts">
      <div><dt>HTTP response</dt><dd><StatusBadge status={run.status} /></dd></div>
      <div><dt>Execution outcome</dt><dd><ResultBadge run={run} /></dd></div>
      <div><dt>Assertions</dt><dd><Badge tone={run.assertion_outcome === "failed" ? "amber" : run.assertion_outcome === "passed" ? "mint" : "neutral"}>{run.assertion_outcome ?? "Not recorded"}</Badge></dd></div>
      <div><dt>Mode and source</dt><dd>{run.execution_mode === "local" ? "Local" : run.execution_mode === "cloud" ? "Cloud" : "Unknown mode"} · {run.source}</dd></div>
      <div><dt>Duration</dt><dd>{run.duration_ms} ms</dd></div>
      <div><dt>Response size</dt><dd>{run.size_bytes.toLocaleString()} bytes</dd></div>
      <div><dt>Endpoint</dt><dd><code>{run.method} {run.url}</code></dd></div>
      <div><dt>Recorded</dt><dd>{when(run.created_at)}</dd></div>
      <div><dt>Execution ID</dt><dd><code>{run.execution_id ?? "Not recorded"}</code></dd></div>
      <div><dt>Failure code</dt><dd><code>{run.error_code ?? "None"}</code></dd></div>
    </dl>
  );
}

export function History(p: ModuleProps & {
  initialRunId?: number;
  initialOutcome?: "passed" | "failed";
  initialFilters?: HistoryRouteFilters;
  initialPage?: number;
}) {
  const [filters, setFilters] = useState<RunFilters>(() => ({
    search: p.initialFilters?.search ?? routeValue("search"),
    method: p.initialFilters?.method ?? routeValue("method"),
    status: p.initialFilters?.status ?? routeValue("status"),
    outcome: p.initialOutcome ?? p.initialFilters?.outcome ?? routeValue("outcome"),
    classification: p.initialFilters?.classification ?? routeValue("classification"),
    assertion_outcome: p.initialFilters?.assertion_outcome ?? routeValue("assertion_outcome"),
    source: p.initialFilters?.source ?? routeValue("source"),
    mode: p.initialFilters?.mode ?? routeValue("mode"),
    monitor_id: p.initialFilters?.monitor_id ?? routeValue("monitor_id"),
    date_from: p.initialFilters?.date_from ?? routeValue("date_from"),
    date_to: p.initialFilters?.date_to ?? routeValue("date_to"),
    sort: p.initialFilters?.sort || routeValue("sort") || "newest",
  }));
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [page, setPage] = useState(p.initialPage ?? (Number(routeValue("page")) || 1));
  const [selectedRun, setSelectedRun] = useState<number | null>(p.initialRunId ?? (Number(routeValue("run")) || null));
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const params = filterParams(filters, page);
  const query = params.toString();
  const history = useQuery({
    queryKey: [p.base, "runs", query],
    queryFn: () => api<Page<Run>>(`${p.base}/runs?${query}`),
    staleTime: 10_000,
  });
  const detail = useQuery({
    queryKey: [p.base, "run", selectedRun],
    queryFn: () => api<Run>(`${p.base}/runs/${selectedRun}`),
    enabled: selectedRun !== null,
    retry: false,
  });
  const comparison = useQuery({
    queryKey: [p.base, "run-compare", compareIds.join(":")],
    queryFn: () => api<Comparison>(`${p.base}/runs/compare?first=${compareIds[0]}&second=${compareIds[1]}`),
    enabled: comparisonOpen && compareIds.length === 2,
    retry: false,
  });

  useEffect(() => {
    const next = filterParams(filters, page);
    if (selectedRun) next.set("run", String(selectedRun));
    const suffix = next.size ? `?${next.toString()}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${suffix}`);
  }, [filters, page, selectedRun]);

  function update<K extends keyof RunFilters>(key: K, value: RunFilters[K]) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters({ search: "", method: "", status: "", outcome: "", classification: "", assertion_outcome: "", source: "", mode: "", monitor_id: "", date_from: "", date_to: "", sort: "newest" });
    setSearchDraft("");
    setPage(1);
  }

  async function downloadExport() {
    const exportQuery = filterParams(filters).toString();
    const result = await p.act(() => api<ExportBundle>(`${p.base}/runs/export${exportQuery ? `?${exportQuery}` : ""}`), "Redacted run export is ready.");
    if (!result) return;
    exportJson(result.records, "fluxapi-run-history.json");
    if (result.meta.truncated) {
      await p.act(async () => result.meta, `Export capped at ${result.meta.limit.toLocaleString()} of ${result.meta.total.toLocaleString()} matching runs.`);
    }
  }

  return (
    <>
      <div className="page-heading history-heading">
        <div>
          <span className="eyebrow">Execution explorer</span>
          <h1>Run history<span className="title-dot">.</span></h1>
          <p>Investigate outcomes, compare runs, and inspect safe stored snapshots.</p>
        </div>
        <div className="heading-actions">
          <Button variant="secondary" onClick={() => void downloadExport()} disabled={p.busy || !history.data?.total}>
            <ArrowDownToLine size={15} /> Export filtered runs
          </Button>
          <Button variant="secondary" onClick={() => setComparisonOpen(true)} disabled={compareIds.length !== 2}>
            <GitCompare size={15} /> Compare selected ({compareIds.length}/2)
          </Button>
        </div>
      </div>

      <Panel className="history-panel">
        <div className="history-toolbar">
          <form className="history-search" onSubmit={(event) => { event.preventDefault(); update("search", searchDraft.trim()); }}>
            <Search size={16} />
            <input aria-label="Search history by saved request name" placeholder="Search saved request name" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
            <button className="icon-button" aria-label="Apply search"><ArrowUpRight size={15} /></button>
          </form>
          <div className="history-toolbar-actions">
            <Button variant="secondary" className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><Filter size={15} /> Filters</Button>
            <Badge>{history.data?.total ?? 0} matching runs</Badge>
          </div>
        </div>

        <div className={`history-filter-shell${filtersOpen ? " is-open" : ""}`}>
          {filtersOpen && <button className="history-filter-scrim" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />}
          <section className="history-filter-drawer" aria-label="Run history filters">
            <div className="history-filter-heading"><strong>Filter executions</strong><button className="icon-button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><X size={16} /></button></div>
            <div className="history-filter-grid">
              <label><span>Method</span><select aria-label="Filter by method" value={filters.method} onChange={(e) => update("method", e.target.value)}><option value="">All methods</option>{["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => <option key={method}>{method}</option>)}</select></label>
              <label><span>HTTP status</span><select aria-label="Filter by HTTP status" value={filters.status} onChange={(e) => update("status", e.target.value)}><option value="">Any status</option><option value="2xx">2xx</option><option value="3xx">3xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option><option value="no_response">No response</option>{[200, 201, 204, 301, 302, 400, 401, 403, 404, 422, 429, 500, 502, 503, 504].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
              <label><span>Overall outcome</span><select aria-label="Filter by result" value={filters.outcome} onChange={(e) => update("outcome", e.target.value)}><option value="">All outcomes</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label>
              <label><span>Failure classification</span><select aria-label="Filter by failure classification" value={filters.classification} onChange={(e) => update("classification", e.target.value)}><option value="">Any classification</option><option value="success">Success</option><option value="execution_failure">Execution failure</option><option value="http_failure">HTTP failure</option><option value="assertion_failure">Assertion failure</option></select></label>
              <label><span>Assertions</span><select aria-label="Filter by assertion outcome" value={filters.assertion_outcome} onChange={(e) => update("assertion_outcome", e.target.value)}><option value="">Any assertion outcome</option><option value="passed">All recorded assertions passed</option><option value="failed">At least one assertion failed</option><option value="none">No assertions recorded</option></select></label>
              <label><span>Execution source</span><select aria-label="Filter by source" value={filters.source} onChange={(e) => update("source", e.target.value)}><option value="">All sources</option><option value="manual">Manual</option><option value="monitor">Monitor</option></select></label>
              <label><span>Execution mode</span><select aria-label="Filter by execution mode" value={filters.mode} onChange={(e) => update("mode", e.target.value)}><option value="">Local and Cloud</option><option value="local">Local</option><option value="cloud">Cloud</option></select></label>
              <label><span>Monitor</span><input aria-label="Filter by monitor ID" inputMode="numeric" pattern="[0-9]*" placeholder="Any monitor" value={filters.monitor_id} onChange={(e) => update("monitor_id", e.target.value)} /></label>
              <label><span>From</span><input aria-label="History start date" type="date" value={filters.date_from} onChange={(e) => update("date_from", e.target.value)} /></label>
              <label><span>To</span><input aria-label="History end date" type="date" value={filters.date_to} onChange={(e) => update("date_to", e.target.value)} /></label>
              <label><span>Sort</span><select aria-label="Sort run history" value={filters.sort} onChange={(e) => update("sort", e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="duration_desc">Longest duration</option><option value="duration_asc">Shortest duration</option><option value="name_asc">Request name A–Z</option><option value="name_desc">Request name Z–A</option></select></label>
            </div>
            <div className="history-filter-footer"><span>Filters are applied on the server.</span><Button variant="ghost" onClick={clearFilters}>Clear all</Button><Button variant="secondary" onClick={() => setFiltersOpen(false)}>Done</Button></div>
          </section>
        </div>

        <div className="history-result-meta"><span>{history.data ? `${history.data.total === 0 ? 0 : (history.data.current_page - 1) * 25 + 1}–${(history.data.current_page - 1) * 25 + history.data.data.length} of ${history.data.total.toLocaleString()} runs` : "Loading run records"}</span><span>Only authorized, redacted run metadata is exported.</span></div>
        {history.isPending ? <Loading /> : history.error ? <div className="error-box" role="alert">{history.error.message}<Button variant="secondary" onClick={() => void history.refetch()}>Retry</Button></div> : history.data?.data.length ? (
          <div className="data-table history-table-wrap"><table className="history-table">
            <thead><tr><th><span className="sr-only">Compare</span></th><th>Request</th><th>Source / mode</th><th>HTTP</th><th>Execution</th><th>Assertions</th><th>Duration</th><th>Executed</th><th><span className="sr-only">Details</span></th></tr></thead>
            <tbody>{history.data.data.map((run) => (
              <tr key={run.id}>
                <td data-label="Compare"><input type="checkbox" aria-label={`Select run ${run.id} for comparison`} checked={compareIds.includes(run.id)} onChange={(e) => setCompareIds((current) => e.target.checked ? (current.length < 2 ? [...current, run.id] : current) : current.filter((id) => id !== run.id))} /></td>
                <td data-label="Request"><div className="history-request-cell"><span className={`method-text ${run.method.toLowerCase()}`}>{run.method}</span><div><strong>{run.name}</strong><small><code>{run.url}</code></small></div></div></td>
                <td data-label="Source / mode"><span className="history-source">{run.source}</span><small>{run.execution_mode === "local" ? "Local execution" : run.execution_mode === "cloud" ? "Cloud execution" : "Unknown mode"}</small></td>
                <td data-label="HTTP"><StatusBadge status={run.status} /></td>
                <td data-label="Execution"><ResultBadge run={run} /></td>
                <td data-label="Assertions"><Badge tone={run.assertion_outcome === "failed" ? "amber" : run.assertion_outcome === "passed" ? "mint" : "neutral"}>{run.assertion_outcome ?? "unknown"}</Badge></td>
                <td data-label="Duration"><span className="history-duration"><Clock3 size={13} />{run.duration_ms} ms</span></td>
                <td data-label="Executed" className="history-time">{when(run.created_at)}</td>
                <td data-label="Details"><button className="icon-button history-open" aria-label={`Inspect run ${run.id}`} onClick={() => setSelectedRun(run.id)}><ArrowUpRight size={16} /></button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No runs match these filters" text="Try another request name, date range, or outcome filter." />}
        {history.data && <Pagination page={history.data.current_page} last={history.data.last_page} change={setPage} />}
      </Panel>

      {selectedRun !== null && <Dialog title={`Run #${selectedRun}`} close={() => setSelectedRun(null)}>
        {detail.isPending ? <Loading /> : detail.error ? <div role="alert" className="error-box">{detail.error.message}<Button variant="secondary" onClick={() => void detail.refetch()}>Retry</Button></div> : detail.data ? <div className="run-detail-content">
          <div className="run-detail-title"><div><span className="eyebrow">Stored execution record</span><h3>{detail.data.method} · {detail.data.name}</h3><code>{detail.data.url}</code></div>{detail.data.api_request_id && <Link className="button secondary" href={`/studio?request=${detail.data.api_request_id}`}><ExternalLink size={14} /> Open in Studio</Link>}</div>
          <RunFacts run={detail.data} />
          {!detail.data.response_available && <div className="info-banner">No response snapshot is retained for this run.</div>}
          {detail.data.error_code && <div className="error-box">Execution diagnostic: <code>{detail.data.error_code}</code>. Sensitive request credentials and raw authorization headers are not included.</div>}
          <ResponseInspector run={detail.data} />
        </div> : null}
      </Dialog>}

      {comparisonOpen && <Dialog title="Compare selected runs" close={() => setComparisonOpen(false)}>
        {compareIds.length !== 2 ? <Empty title="Select two runs" text="Choose exactly two authorized runs from the execution list to compare their recorded results." /> : comparison.isPending ? <Loading /> : comparison.error ? <div role="alert" className="error-box">{comparison.error.message}</div> : comparison.data ? <div className="run-comparison">
          <div className="comparison-summary">
            <Badge tone={comparison.data.status_changed ? "amber" : "mint"}>HTTP status {comparison.data.status_changed ? "changed" : "unchanged"}</Badge>
            <Badge tone={comparison.data.outcome_changed ? "amber" : "mint"}>Execution {comparison.data.outcome_changed ? "changed" : "unchanged"}</Badge>
            <Badge tone={comparison.data.assertion_outcome_changed ? "amber" : "mint"}>Assertions {comparison.data.assertion_outcome_changed ? "changed" : "unchanged"}</Badge>
          </div>
          <div className="comparison-deltas"><span>Duration <strong>{comparison.data.duration_delta_ms > 0 ? "+" : ""}{comparison.data.duration_delta_ms} ms</strong></span><span>Size <strong>{comparison.data.size_delta_bytes > 0 ? "+" : ""}{comparison.data.size_delta_bytes} bytes</strong></span><span>Headers <strong>{comparison.data.headers_changed ? "Changed" : "Unchanged"}</strong></span><span>Body <strong>{comparison.data.body_comparable ? comparison.data.body_changed ? "Changed" : "Unchanged" : "Unavailable or truncated"}</strong></span></div>
          <div className="comparison-columns"><section><h3>Run #{comparison.data.first.id}</h3><RunFacts run={comparison.data.first} /><ResponseInspector run={comparison.data.first} /></section><section><h3>Run #{comparison.data.second.id}</h3><RunFacts run={comparison.data.second} /><ResponseInspector run={comparison.data.second} /></section></div>
        </div> : null}
      </Dialog>}
    </>
  );
}
