"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  Eye,
  FileJson,
  Link2,
  Link2Off,
  Plus,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { api, apiPage, when } from "@/lib/api";
import type { ModuleProps } from "./console";
import type { Share } from "@/lib/types";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  Loading,
  Panel,
} from "./ui";

type ShareOverview = {
  total: number;
  active: number;
  expired: number;
  recently_created: number;
};

type ReportPreview = {
  generated_at: string;
  period: string;
  period_days: number;
  total_runs: number;
  passed: number;
  failed: number;
  average_latency_ms: number | null;
  results: { outcome: string; status: number | null; duration_ms: number; created_at: string }[];
};

type ReportDetails = { share: Share; snapshot: ReportPreview & { name: string } };

const reportPeriods = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

function reportStatus(share: Share): "Active" | "Expired" | "Revoked" {
  if (share.revoked_at) return "Revoked";
  return new Date(share.expires_at) <= new Date() ? "Expired" : "Active";
}

export function Reports(p: ModuleProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("created_at");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Share | null>(null);
  const [selectedShare, setSelectedShare] = useState<Share | null>(null);
  const [reportName, setReportName] = useState("");
  const [periodDays, setPeriodDays] = useState(7);
  const [expiryHours, setExpiryHours] = useState(168);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [spec, setSpec] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  const filters = new URLSearchParams();
  if (search.trim()) filters.set("search", search.trim());
  if (status !== "all") filters.set("status", status);
  filters.set("sort", sort);
  filters.set("direction", sort === "name" ? "asc" : "desc");
  const listPath = `${p.base}/shares?${filters.toString()}`;
  const overview = useQuery({
    queryKey: [p.base, "share-overview"],
    queryFn: () => api<ShareOverview>(`${p.base}/shares/overview`),
  });
  const reports = useQuery({
    queryKey: [p.base, "shares", search, status, sort, page],
    queryFn: () => apiPage<Share>(listPath, page, 10),
  });
  const reportDetail = useQuery({
    queryKey: [p.base, "share-preview", selectedShare?.id],
    queryFn: () => api<ReportDetails>(`${p.base}/shares/${selectedShare?.id}`),
    enabled: Boolean(selectedShare),
  });

  async function loadPreview() {
    const result = await p.act(() =>
      api<ReportPreview>(`${p.base}/shares/preview?period_days=${periodDays}`),
    );
    if (result) setPreview(result);
  }

  async function createShare() {
    const result = await p.act(
      () =>
        api<{ token: string }>(`${p.base}/shares`, "POST", {
          name: reportName.trim(),
          period_days: periodDays,
          expires_in_hours: expiryHours,
        }),
      "Secure report link created.",
    );
    if (result) {
      setLink(`${location.origin}/report/${result.token}`);
      setCopied(false);
      setPreview(null);
      setCreateOpen(false);
    }
  }

  async function importOpenApi(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await p.act(
      () => api(`${p.base}/openapi/import`, "POST", { document: spec }),
      "OpenAPI document imported into Collections.",
    );
    if (result) {
      setImportOpen(false);
      setSpec("");
    }
  }

  const meta = reports.data?.meta;

  return (
    <>
      <div className="page-heading reports-heading">
        <div>
          <span className="eyebrow">Workspace reporting</span>
          <h1>Reports & integrations<span className="title-dot">.</span></h1>
          <p>Prepare safe execution summaries and manage their access links.</p>
        </div>
        <Button disabled={!p.canEdit} onClick={() => {
          setReportName("");
          setPreview(null);
          setCreateOpen(true);
        }}>
          <Plus size={15} /> Create report
        </Button>
      </div>

      <div className="info-banner report-security-note">
        <ShieldCheck size={18} />
        <span>Shared snapshots contain execution counts and safe status summaries only. Request URLs, response bodies, credentials, and environment values are excluded.</span>
      </div>

      <div className="report-overview" aria-label="Report overview">
        {[
          { label: "Reports", value: overview.data?.total ?? "—", icon: FileJson },
          { label: "Active shares", value: overview.data?.active ?? "—", icon: Link2 },
          { label: "Expired shares", value: overview.data?.expired ?? "—", icon: Clock3 },
          { label: "Created this week", value: overview.data?.recently_created ?? "—", icon: CalendarDays },
        ].map(({ label, value, icon: Icon }) => (
          <Panel className="report-stat" key={label}>
            <span className="report-stat-icon"><Icon size={16} /></span>
            <div><small>{label}</small><strong>{value}</strong></div>
          </Panel>
        ))}
      </div>

      <Panel className="reports-center">
        <div className="panel-heading report-list-heading">
          <div><h2>Shared reports</h2><p>{meta ? `${meta.total} total reports` : "Workspace links and their current access state"}</p></div>
          <div className="report-list-filters">
            <label className="report-search">
              <Search size={15} />
              <input aria-label="Search reports" placeholder="Search reports" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            </label>
            <label className="sr-only" htmlFor="report-status">Filter reports by status</label>
            <select id="report-status" aria-label="Filter reports by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="all">All statuses</option><option value="active">Active</option><option value="expired">Expired</option><option value="revoked">Revoked</option>
            </select>
            <label className="sr-only" htmlFor="report-sort">Sort reports</label>
            <select id="report-sort" aria-label="Sort reports" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
              <option value="created_at">Newest first</option><option value="expires_at">Expiry date</option><option value="name">Name</option>
            </select>
          </div>
        </div>
        {overview.error ? <p className="error-box">{overview.error.message}</p> : null}
        {reports.isPending ? <Loading /> : reports.error ? <p className="error-box">{reports.error.message}</p> : reports.data?.data.length ? (
          <>
            <div className="report-list-labels" aria-hidden="true"><span>Report</span><span>Created</span><span>Expires</span><span>Status</span><span>Actions</span></div>
            <div className="report-list">
              {reports.data.data.map((share) => {
                const state = reportStatus(share);
                return (
                  <article className="report-list-row" key={share.id}>
                    <div className="report-name-cell"><span className="quick-icon violet"><FileJson size={17} /></span><div><strong>{share.name}</strong><small>Created {when(share.created_at)}</small></div></div>
                    <span className="report-created-cell" data-label="Created">{when(share.created_at)}</span>
                    <span data-label="Expires">{when(share.expires_at)}</span>
                    <Badge tone={state === "Active" ? "mint" : state === "Expired" ? "amber" : "neutral"}>{state}</Badge>
                    <div className="report-row-actions">
                      <Button variant="secondary" aria-label={`Preview ${share.name}`} onClick={() => setSelectedShare(share)}><Eye size={14} /> Preview</Button>
                      {state === "Active" && <Button variant="ghost" className="report-revoke" disabled={!p.canEdit} aria-label={`Revoke ${share.name}`} onClick={() => setRevokeTarget(share)}><Link2Off size={14} /> Revoke</Button>}
                    </div>
                  </article>
                );
              })}
            </div>
            {meta && meta.last_page > 1 && <div className="report-pagination"><span>Showing {(meta.current_page - 1) * meta.per_page + 1}–{Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total}</span><div><Button variant="secondary" disabled={meta.current_page <= 1} onClick={() => setPage(meta.current_page - 1)}>Previous</Button><span>Page {meta.current_page} of {meta.last_page}</span><Button variant="secondary" disabled={meta.current_page >= meta.last_page} onClick={() => setPage(meta.current_page + 1)}>Next</Button></div></div>}
          </>
        ) : (
          <Empty title={search || status !== "all" ? "No reports match" : "No shared reports yet"} text={search || status !== "all" ? "Adjust the search or status filter to see other reports." : "Create a safe summary, review it, then decide whether to share it."}>
            {!search && status === "all" && <Button disabled={!p.canEdit} onClick={() => setCreateOpen(true)}><Plus size={14} /> Create report</Button>}
          </Empty>
        )}
      </Panel>

      {link && <Panel className="share-created report-created-link">
        <div><span className="quick-icon mint"><Link2 size={17} /></span><div><strong>Share link created</strong><small>The access token is shown once. Copy it now; the saved report list never stores the raw token.</small></div></div>
        <input aria-label="Report URL" readOnly value={link} />
        <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>
          {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}
        </Button>
        <a className="button secondary" href={link} target="_blank" rel="noreferrer">Open report <ArrowUpRight size={14} /></a>
        <Button variant="ghost" aria-label="Hide report link" onClick={() => { setLink(""); setCopied(false); }}>Hide link</Button>
      </Panel>}

      <Panel className="openapi-panel">
        <div className="openapi-copy"><span className="quick-icon cyan"><FileJson size={20} /></span><div><span className="eyebrow">Integrations</span><h2>Import an OpenAPI document</h2><p>Bring supported OpenAPI 3.0 or 3.1 JSON operations into a new collection, grouped by tags.</p><small>JSON only. Remote references, YAML, and schema validation are not supported.</small></div></div>
        <Button variant="secondary" disabled={!p.canEdit} onClick={() => setImportOpen(true)}><Upload size={15} /> Import OpenAPI</Button>
      </Panel>

      {createOpen && <Dialog title={preview ? "Review report preview" : "Create a report"} close={() => { setCreateOpen(false); setPreview(null); }}>
        {!preview ? <div className="report-wizard">
          <p className="muted">Choose a reporting period and link expiry. Preview uses workspace execution summaries and excludes request content.</p>
          <Field label="Report name"><input autoFocus required maxLength={100} value={reportName} onChange={(event) => setReportName(event.target.value)} placeholder="Weekly reliability review" /></Field>
          <Field label="Execution period"><select value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value))}>{reportPeriods.map((period) => <option key={period.days} value={period.days}>{period.label}</option>)}</select></Field>
          <Field label="Share link expiry"><select value={expiryHours} onChange={(event) => setExpiryHours(Number(event.target.value))}><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option></select></Field>
          <div className="form-actions"><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={!p.canEdit || p.busy || !reportName.trim()} onClick={() => void loadPreview()}>Preview report <ArrowUpRight size={14} /></Button></div>
        </div> : <div className="report-wizard report-preview">
          <div className="report-preview-title"><div><span className="eyebrow">{preview.period}</span><h3>{reportName || "Untitled report"}</h3></div><Badge tone="violet">Read-only snapshot</Badge></div>
          <div className="report-preview-metrics"><div><small>Total executions</small><strong>{preview.total_runs}</strong></div><div><small>Passed</small><strong>{preview.passed}</strong></div><div><small>Failed</small><strong>{preview.failed}</strong></div><div><small>Average latency</small><strong>{preview.average_latency_ms === null ? "—" : `${preview.average_latency_ms} ms`}</strong></div></div>
          <p className="muted small">Generated {when(preview.generated_at)}. The snapshot includes up to 50 recent outcomes; it contains no request URLs, headers, bodies, or environment values.</p>
          {preview.results.length > 0 && <div className="report-preview-runs" aria-label="Recent execution summary">{preview.results.slice(0, 5).map((run, index) => <div key={`${run.created_at}-${index}`}><Badge tone={run.outcome === "passed" ? "mint" : "red"}>{run.outcome}</Badge><span>{run.status ? `HTTP ${run.status}` : "No HTTP response"}</span><span>{run.duration_ms} ms</span><small>{when(run.created_at)}</small></div>)}</div>}
          {!preview.total_runs && <Empty title="No executions in this period" text="The share can still be created; it will contain an honest empty summary." />}
          <div className="form-actions"><Button variant="secondary" onClick={() => setPreview(null)}>Back to details</Button><Button disabled={!p.canEdit || p.busy} onClick={() => void createShare()}><Link2 size={14} /> Create secure link</Button></div>
        </div>}
      </Dialog>}

      {revokeTarget && <Dialog title="Revoke report access?" close={() => setRevokeTarget(null)}>
        <p className="muted">Anyone using <strong>{revokeTarget.name}</strong> will lose access to this snapshot immediately. The report record will remain available to workspace members.</p>
        <div className="form-actions"><Button variant="secondary" onClick={() => setRevokeTarget(null)}>Cancel</Button><Button variant="danger" disabled={p.busy || !p.canEdit} onClick={async () => { const result = await p.act(() => api(`${p.base}/shares/${revokeTarget.id}`, "DELETE"), "Report access revoked."); if (result) setRevokeTarget(null); }}>Revoke access</Button></div>
      </Dialog>}

      {selectedShare && <Dialog title={`Preview ${selectedShare.name}`} close={() => setSelectedShare(null)}>
        {reportDetail.isPending ? <Loading /> : reportDetail.error ? <p className="error-box">{reportDetail.error.message}</p> : reportDetail.data && <div className="report-wizard report-preview">
          <div className="report-preview-title"><div><span className="eyebrow">{reportDetail.data.snapshot.period}</span><h3>{reportDetail.data.snapshot.name}</h3></div><Badge tone={reportStatus(selectedShare) === "Active" ? "mint" : reportStatus(selectedShare) === "Expired" ? "amber" : "neutral"}>{reportStatus(selectedShare)}</Badge></div>
          <p className="muted small">Created {when(selectedShare.created_at)} · expires {when(selectedShare.expires_at)}. This read-only workspace preview does not reveal the one-time share token.</p>
          <div className="report-preview-metrics"><div><small>Total executions</small><strong>{reportDetail.data.snapshot.total_runs}</strong></div><div><small>Passed</small><strong>{reportDetail.data.snapshot.passed}</strong></div><div><small>Failed</small><strong>{reportDetail.data.snapshot.failed}</strong></div><div><small>Average latency</small><strong>{reportDetail.data.snapshot.average_latency_ms === null ? "—" : `${reportDetail.data.snapshot.average_latency_ms} ms`}</strong></div></div>
          {reportDetail.data.snapshot.results.length > 0 ? <div className="report-preview-runs" aria-label="Stored report summary">{reportDetail.data.snapshot.results.slice(0, 10).map((run, index) => <div key={`${run.created_at}-${index}`}><Badge tone={run.outcome === "passed" ? "mint" : "red"}>{run.outcome}</Badge><span>{run.status ? `HTTP ${run.status}` : "No HTTP response"}</span><span>{run.duration_ms} ms</span><small>{when(run.created_at)}</small></div>)}</div> : <Empty title="No execution data in this snapshot" text="The report was created without any runs in its selected period." />}
        </div>}
      </Dialog>}

      {importOpen && <Dialog title="Import an OpenAPI JSON document" close={() => setImportOpen(false)}>
        <form onSubmit={(event) => void importOpenApi(event)}>
          <Field label="Choose a JSON file"><input type="file" accept=".json,application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 450000) { await p.act(async () => { throw new Error("The specification exceeds the 450 KB import limit."); }); return; } setSpec(await file.text()); } }} /></Field>
          <Field label="Or paste your specification"><textarea className="mono spec-input" value={spec} onChange={(event) => setSpec(event.target.value)} required placeholder={'{"openapi":"3.0.3", ...}'} /></Field>
          <p className="muted small">Imports supported OpenAPI 3.0/3.1 JSON into Collections. Remote references, YAML, and schema validation are not supported.</p>
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setImportOpen(false)}>Cancel</Button><Button disabled={!p.canEdit || p.busy || !spec.trim()}><Upload size={14} /> Import collection</Button></div>
        </form>
      </Dialog>}
    </>
  );
}
