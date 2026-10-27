"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Activity,
  Bell,
  Check,
  ExternalLink,
  Filter,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, when } from "@/lib/api";
import type { IncidentRouteFilters } from "@/lib/route-state";
import type { Alert, Monitor, Page } from "@/lib/types";
import type { ModuleProps } from "./console";
import { Badge, Button, Dialog, Empty, Loading, Panel } from "./ui";

type AlertFilters = {
  search: string;
  monitor_id: string;
  status: string;
  date_from: string;
  date_to: string;
  sort: string;
};

type IncidentPage = {
  incidents: Page<Alert>;
  summary: { open: number; resolved: number; acknowledged: number };
};

type Delivery = {
  id: number;
  alert_event_id: number;
  channel: string;
  recovery: boolean;
  status: string;
  error_code: string | null;
  delivered_at: string | null;
  created_at: string;
};

type TimelineEvent = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  run_id: number | null;
  occurred_at: string;
};

type IncidentDetail = {
  incident: Alert;
  monitor: Monitor & { api_request_id: number; failure_threshold: number | null };
  timeline: TimelineEvent[];
  deliveries: Omit<Delivery, "alert_event_id">[];
  checks_included: number;
  checks_total: number;
  checks_truncated: boolean;
};

function routeValue(key: string): string {
  return typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get(key) ?? "";
}

function filterParams(filters: AlertFilters, page?: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === "status" && value === "all") && !(key === "sort" && value === "newest")) params.set(key, value);
  }
  if (page && page > 1) {
    params.set("page", String(page));
  }
  return params;
}

function deliveryTone(delivery: { status: string; delivered_at: string | null }) {
  if (delivery.status === "failed") return "red";
  if (delivery.status === "sent" && delivery.delivered_at) return "mint";
  return "neutral";
}

function Pagination({ page, last, change }: { page: number; last: number; change: (value: number) => void }) {
  if (last <= 1) return null;
  return <div className="pagination incident-pagination"><span>Page {page} of {last}</span><div><Button variant="secondary" disabled={page <= 1} onClick={() => change(page - 1)}>Previous</Button><Button variant="secondary" disabled={page >= last} onClick={() => change(page + 1)}>Next</Button></div></div>;
}

export function Alerts(p: ModuleProps & {
  initialFilters?: IncidentRouteFilters;
  initialPage?: number;
  initialIncidentId?: number;
}) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<AlertFilters>(() => ({
    search: p.initialFilters?.search ?? routeValue("search"),
    monitor_id: p.initialFilters?.monitor_id ?? routeValue("monitor_id"),
    status: p.initialFilters?.status || routeValue("status") || "all",
    date_from: p.initialFilters?.date_from ?? routeValue("date_from"),
    date_to: p.initialFilters?.date_to ?? routeValue("date_to"),
    sort: p.initialFilters?.sort || routeValue("sort") || "newest",
  }));
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [page, setPage] = useState(p.initialPage ?? (Number(routeValue("page")) || 1));
  const [selected, setSelected] = useState<number | null>(p.initialIncidentId ?? (Number(routeValue("incident")) || null));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const params = filterParams(filters, page);
  const query = params.toString();
  const incidents = useQuery({
    queryKey: [p.base, "alerts", query],
    queryFn: () => api<IncidentPage>(`${p.base}/alerts?${query}`),
    staleTime: 10_000,
  });
  const deliveries = useQuery({
    queryKey: [p.base, "alert-deliveries"],
    queryFn: () => api<Delivery[]>(`${p.base}/alert-deliveries`),
    staleTime: 30_000,
  });
  const detail = useQuery({
    queryKey: [p.base, "alert", selected],
    queryFn: () => api<IncidentDetail>(`${p.base}/alerts/${selected}`),
    enabled: selected !== null,
    retry: false,
  });

  useEffect(() => {
    const next = filterParams(filters, page);
    if (selected) next.set("incident", String(selected));
    const suffix = next.size ? `?${next.toString()}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${suffix}`);
  }, [filters, page, selected]);

  function update<K extends keyof AlertFilters>(key: K, value: AlertFilters[K]) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters({ search: "", monitor_id: "", status: "all", date_from: "", date_to: "", sort: "newest" });
    setSearchDraft("");
    setPage(1);
  }

  async function acknowledge(alert: Alert) {
    const result = await p.act(() => api<Alert>(`${p.base}/alerts/${alert.id}/acknowledge`, "PATCH"), "Incident acknowledged.");
    if (result) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [p.base, "alerts"] }),
        queryClient.invalidateQueries({ queryKey: [p.base, "alert", alert.id] }),
      ]);
    }
  }

  return (
    <>
      <div className="page-heading incident-heading">
        <div>
          <span className="eyebrow">Reliability operations</span>
          <h1>Incident center<span className="title-dot">.</span></h1>
          <p>Review recorded monitor incidents, acknowledgments, recovery, and delivery attempts.</p>
        </div>
        <Button variant="secondary" onClick={() => { void incidents.refetch(); void deliveries.refetch(); }} disabled={incidents.isFetching || deliveries.isFetching}><RefreshCw size={15} /> Refresh records</Button>
      </div>

      <div className="incident-summary-grid">
        <Panel className="incident-summary-card open"><span><Activity size={16} /> Open incidents</span><strong>{incidents.data?.summary.open ?? "—"}</strong><small>Not yet resolved by monitor recovery</small></Panel>
        <Panel className="incident-summary-card"><span><Check size={16} /> Resolved incidents</span><strong>{incidents.data?.summary.resolved ?? "—"}</strong><small>Recorded successful recovery</small></Panel>
        <Panel className="incident-summary-card"><span><ShieldCheck size={16} /> Acknowledged</span><strong>{incidents.data?.summary.acknowledged ?? "—"}</strong><small>Reviewed by a workspace member</small></Panel>
      </div>

      <Panel className="incident-panel">
        <div className="incident-panel-heading"><div><span className="eyebrow">Recorded events</span><h2>Monitor incidents</h2></div><Badge>{incidents.data?.incidents.total ?? 0} records</Badge></div>
        <div className="incident-toolbar">
          <form className="history-search" onSubmit={(event) => { event.preventDefault(); update("search", searchDraft.trim()); }}>
            <Search size={16} /><input aria-label="Search incidents" placeholder="Search incident or monitor" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /><button className="icon-button" aria-label="Apply incident search"><Search size={15} /></button>
          </form>
          <div className="history-toolbar-actions"><Button variant="secondary" className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><Filter size={15} /> Filters</Button><span className="small muted">{incidents.data?.incidents.total ?? 0} matching incidents</span></div>
        </div>
        <div className={`incident-filter-shell${filtersOpen ? " is-open" : ""}`}>
          {filtersOpen && <button className="history-filter-scrim" aria-label="Close incident filters" onClick={() => setFiltersOpen(false)} />}
          <section className="incident-filter-drawer" aria-label="Incident filters">
            <div className="history-filter-heading"><strong>Filter incidents</strong><button className="icon-button" aria-label="Close incident filters" onClick={() => setFiltersOpen(false)}><X size={16} /></button></div>
            <div className="incident-filter-grid">
              <label><span>Monitor</span><select aria-label="Filter by monitor" value={filters.monitor_id} onChange={(e) => update("monitor_id", e.target.value)}><option value="">All monitors</option>{p.monitors.map((monitor) => <option key={monitor.id} value={monitor.id}>{monitor.name}</option>)}</select></label>
              <label><span>Incident state</span><select aria-label="Filter by incident status" value={filters.status} onChange={(e) => update("status", e.target.value)}><option value="all">All states</option><option value="open">Open</option><option value="resolved">Resolved</option><option value="acknowledged">Acknowledged</option><option value="unacknowledged">Unacknowledged</option></select></label>
              <label><span>From</span><input aria-label="Incident start date" type="date" value={filters.date_from} onChange={(e) => update("date_from", e.target.value)} /></label>
              <label><span>To</span><input aria-label="Incident end date" type="date" value={filters.date_to} onChange={(e) => update("date_to", e.target.value)} /></label>
              <label><span>Sort</span><select aria-label="Sort incidents" value={filters.sort} onChange={(e) => update("sort", e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            </div>
            {p.hasMoreMonitors && <Button variant="ghost" disabled={p.loadingMoreMonitors} onClick={p.loadMoreMonitors}>{p.loadingMoreMonitors ? "Loading monitors…" : "Load more monitors"}</Button>}
            <div className="history-filter-footer"><span>Monitor state follows recorded recovery.</span><Button variant="ghost" onClick={clearFilters}>Clear all</Button><Button variant="secondary" onClick={() => setFiltersOpen(false)}>Done</Button></div>
          </section>
        </div>
        {incidents.isPending ? <Loading /> : incidents.error ? <div role="alert" className="error-box">{incidents.error.message}<Button variant="secondary" onClick={() => void incidents.refetch()}>Retry</Button></div> : incidents.data?.incidents.data.length ? (
          <div className="data-table incident-table-wrap"><table className="incident-table">
            <thead><tr><th>Incident / monitor</th><th>Detected</th><th>Incident state</th><th>Review state</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{incidents.data.incidents.data.map((incident) => (
              <tr key={incident.id}>
                <td data-label="Incident / monitor"><div className="incident-row-title"><span className={`incident-symbol ${incident.resolved_at ? "resolved" : "open"}`}><Bell size={16} /></span><div><strong>{incident.monitor_name ?? `Monitor #${incident.monitor_id}`}</strong><small>{incident.message}</small></div></div></td>
                <td data-label="Detected"><span>{when(incident.created_at)}</span><small>{incident.resolved_at ? `Recovered ${when(incident.resolved_at)}` : "Active incident"}</small></td>
                <td data-label="Incident state"><Badge tone={incident.resolved_at ? "mint" : "red"}>{incident.resolved_at ? "Resolved" : "Open"}</Badge></td>
                <td data-label="Review state">{incident.acknowledged_at ? <span className="incident-reviewed"><Check size={13} /> Acknowledged</span> : <span className="muted">Not acknowledged</span>}</td>
                <td data-label="Actions"><div className="incident-row-actions"><Button variant="secondary" onClick={() => setSelected(incident.id)}>Details</Button>{!incident.acknowledged_at && <Button variant="ghost" disabled={!p.canEdit || p.busy} onClick={() => void acknowledge(incident)} aria-label={`Acknowledge incident ${incident.id}`}>Acknowledge</Button>}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No incidents match these filters" text="Monitor incidents appear after the configured failure threshold is reached." />}
        {incidents.data && <Pagination page={incidents.data.incidents.current_page} last={incidents.data.incidents.last_page} change={setPage} />}
      </Panel>

      <Panel className="delivery-panel incident-delivery-panel">
        <div className="incident-panel-heading"><div><span className="eyebrow">Recorded transport activity</span><h2>Notification delivery</h2><p>Only persisted channel statuses are shown; a successful transport record does not confirm recipient delivery.</p></div><Badge>{deliveries.data?.length ?? 0} latest</Badge></div>
        {deliveries.isPending ? <Loading /> : deliveries.error ? <div role="alert" className="error-box">{deliveries.error.message}<Button variant="secondary" onClick={() => void deliveries.refetch()}>Retry</Button></div> : deliveries.data?.length ? <div className="data-table delivery-table-wrap"><table className="delivery-table"><thead><tr><th>Incident</th><th>Event</th><th>Channel</th><th>Recorded status</th><th>Attempt time</th><th /></tr></thead><tbody>{deliveries.data.map((delivery) => <tr key={delivery.id}>
          <td data-label="Incident">#{delivery.alert_event_id}</td><td data-label="Event">{delivery.recovery ? "Recovery" : "Failure"}</td><td data-label="Channel">{delivery.channel}</td><td data-label="Recorded status"><Badge tone={deliveryTone(delivery)}>{delivery.status}</Badge>{delivery.error_code && <small className="delivery-diagnostic">{delivery.error_code.replaceAll("_", " ")}</small>}</td><td data-label="Attempt time">{when(delivery.created_at)}{delivery.delivered_at && <small>Transport timestamp {when(delivery.delivered_at)}</small>}</td><td data-label="Incident details"><button className="icon-button" aria-label={`Open incident ${delivery.alert_event_id}`} onClick={() => setSelected(delivery.alert_event_id)}><ExternalLink size={15} /></button></td>
        </tr>)}</tbody></table></div> : <Empty title="No delivery attempts recorded" text="Email and webhook rows appear only after an enabled channel creates a delivery record." />}
      </Panel>

      {selected !== null && <Dialog title={`Incident #${selected}`} close={() => setSelected(null)}>
        {detail.isPending ? <Loading /> : detail.error ? <div role="alert" className="error-box">{detail.error.message}<Button variant="secondary" onClick={() => void detail.refetch()}>Retry</Button></div> : detail.data ? <div className="incident-detail-content">
          <div className="incident-detail-summary"><div><span className="eyebrow">Monitor incident</span><h3>{detail.data.monitor.name}</h3><p>{detail.data.incident.message}</p><div className="incident-detail-badges"><Badge tone={detail.data.incident.resolved_at ? "mint" : "red"}>{detail.data.incident.resolved_at ? "Resolved" : "Open"}</Badge><Badge tone={detail.data.incident.acknowledged_at ? "violet" : "neutral"}>{detail.data.incident.acknowledged_at ? "Acknowledged" : "Unacknowledged"}</Badge></div></div><div className="incident-detail-links"><Link className="button secondary" href={`/monitoring?monitor=${detail.data.monitor.id}`}><Activity size={14} /> Open monitor</Link><Link className="button secondary" href={`/history?source=monitor&monitor_id=${detail.data.monitor.id}`}><History size={14} /> Related run history</Link>{detail.data.monitor.api_request_id && <Link className="button ghost" href={`/studio?request=${detail.data.monitor.api_request_id}`}>Open saved request <ExternalLink size={13} /></Link>}</div></div>
          <dl className="incident-facts"><div><dt>First recorded</dt><dd>{when(detail.data.incident.created_at)}</dd></div><div><dt>Acknowledged</dt><dd>{detail.data.incident.acknowledged_at ? when(detail.data.incident.acknowledged_at) : "Not acknowledged"}</dd></div><div><dt>Resolved</dt><dd>{detail.data.incident.resolved_at ? when(detail.data.incident.resolved_at) : "Still open"}</dd></div><div><dt>Failure threshold</dt><dd>{detail.data.monitor.failure_threshold ?? "Not recorded"}</dd></div><div><dt>Check interval</dt><dd>{detail.data.monitor.interval_minutes} minutes</dd></div></dl>
          <section className="incident-timeline-section"><div className="incident-panel-heading"><div><span className="eyebrow">Stored timestamps</span><h3>Incident timeline</h3></div><Badge>{detail.data.timeline.length} events</Badge></div>
            {detail.data.timeline.length ? <ol className="incident-timeline">{detail.data.timeline.map((event) => <li className={`timeline-event ${event.kind}`} key={event.id}><span className="timeline-marker" /><div className="timeline-copy"><div><strong>{event.title}</strong><time dateTime={event.occurred_at}>{when(event.occurred_at)}</time></div><p>{event.detail}</p>{event.run_id && <Link href={`/history?run=${event.run_id}&source=monitor&monitor_id=${detail.data.monitor.id}`}>Inspect execution #{event.run_id}</Link>}</div></li>)}</ol> : <Empty title="No timeline events recorded" text="This incident has no stored monitor checks or delivery records." />}
            {detail.data.checks_truncated && <p className="small muted">Showing {detail.data.checks_included} of {detail.data.checks_total} linked monitor checks.</p>}
          </section>
          <section className="incident-detail-deliveries"><h3>Notification records</h3>{detail.data.deliveries.length ? <div className="incident-delivery-records">{detail.data.deliveries.map((delivery) => <div key={delivery.id}><div><strong>{delivery.recovery ? "Recovery" : "Failure"} · {delivery.channel}</strong><Badge tone={deliveryTone(delivery)}>{delivery.status}</Badge></div><small>Attempt recorded {when(delivery.created_at)}{delivery.delivered_at ? ` · transport timestamp ${when(delivery.delivered_at)}` : ""}</small>{delivery.error_code && <code>{delivery.error_code}</code>}</div>)}</div> : <p className="muted">No external notification attempts are recorded for this incident.</p>}</section>
        </div> : null}
      </Dialog>}
    </>
  );
}
