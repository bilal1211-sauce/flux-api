"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Eye,
  Gauge,
  HardDrive,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api, when } from "@/lib/api";
import type { ModuleProps } from "./console";
import { Badge, Button, Dialog, Empty, Field, Loading, Panel } from "./ui";

type Pagination = { current_page: number; last_page: number; per_page: number; total: number };

type AdminWorkspace = {
  id: number;
  name: string;
  owner_id: number;
  owner_name: string | null;
  owner_email: string | null;
  member_count: number;
  usage_today: number;
  daily_run_limit: number;
  created_at: string;
};
type AdminUser = {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
  email_verified_at: string | null;
  created_at: string;
  workspace_count: number;
};
type Platform = {
  users: AdminUser[];
  users_pagination: Pagination;
  workspaces: AdminWorkspace[];
  workspaces_pagination: Pagination;
  total_users: number;
  total_workspaces: number;
  total_runs: number;
  queued_jobs: number;
  failed_jobs: number;
  usage_today: number;
  daily_quota_capacity: number;
  quota_used_percent: number | null;
  queue_driver: string;
  worker_status: "not_monitored" | string;
  recent_failed_jobs: { id: string; queue: string; failed_at: string }[];
  executor_hosts: string[];
  destination_approvals: {
    id: number;
    hostname: string;
    status: "pending" | "approved" | "denied";
    reason: string | null;
    created_at: string;
    requester?: { name: string };
    reviewer?: { name: string };
  }[];
};
type WorkspaceDetail = {
  workspace: AdminWorkspace;
  members: { id: number; name: string; email: string; role: string }[];
};
type UserDetail = {
  user: AdminUser;
  workspaces: { id: number; name: string; daily_run_limit: number; role: string }[];
};

function PageControls({ page, change }: { page: Pagination; change: (page: number) => void }) {
  return <div className="admin-pagination"><span>{page.total} records · page {page.current_page} of {page.last_page}</span><div><Button variant="secondary" aria-label="Previous page" disabled={page.current_page <= 1} onClick={() => change(page.current_page - 1)}><ChevronLeft size={15} /> Previous</Button><Button variant="secondary" aria-label="Next page" disabled={page.current_page >= page.last_page} onClick={() => change(page.current_page + 1)}>Next <ChevronRight size={15} /></Button></div></div>;
}

export function Admin(p: ModuleProps) {
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [workspacePage, setWorkspacePage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const [selected, setSelected] = useState<{ kind: "workspace" | "user"; id: number } | null>(null);
  const [edit, setEdit] = useState<AdminWorkspace | null>(null);
  const [nextLimit, setNextLimit] = useState("");
  const [confirmQuota, setConfirmQuota] = useState(false);
  const [destinationHost, setDestinationHost] = useState("");
  const [pendingDestination, setPendingDestination] = useState<{ id: number; hostname: string; status: "approved" | "denied" } | null>(null);
  const params = new URLSearchParams({
    workspace_page: String(workspacePage),
    users_page: String(userPage),
    per_page: "12",
  });
  if (workspaceSearch.trim()) params.set("workspace_search", workspaceSearch.trim());
  if (userSearch.trim()) params.set("user_search", userSearch.trim());
  const data = useQuery({
    queryKey: [p.base, "admin", workspacePage, userPage, workspaceSearch, userSearch],
    queryFn: () => api<Platform>(`admin?${params}`),
  });
  const detail = useQuery({
    queryKey: ["admin-detail", selected?.kind, selected?.id],
    queryFn: () => api<WorkspaceDetail | UserDetail>(`admin/${selected?.kind === "workspace" ? "workspaces" : "users"}/${selected?.id}`),
    enabled: selected !== null,
  });

  const confirmQuotaChange = async () => {
    if (!edit) return;
    const result = await p.act(
      () => api<AdminWorkspace>(`admin/workspaces/${edit.id}/limit`, "PATCH", { daily_run_limit: Number(nextLimit) }),
      "Workspace quota updated and recorded in its audit trail.",
    );
    if (result) {
      setEdit(null);
      setConfirmQuota(false);
    }
  };

  const reviewDestination = async () => {
    if (!pendingDestination) return;
    const destination = pendingDestination;
    const result = await p.act(
      () => api(`admin/destinations/${destination.id}`, "PATCH", { status: destination.status }),
      `Destination ${destination.status}.`,
    );
    if (result) setPendingDestination(null);
  };

  return <>
    <div className="page-heading admin-page-heading">
      <div><span className="eyebrow">Platform operations</span><h1>Admin Console</h1><p>Verified platform totals, workspace capacity, accounts, and queue records.</p></div>
      <Badge tone="violet"><ShieldCheck size={13} /> Platform administrator</Badge>
    </div>

    {data.isPending ? <Loading /> : data.error ? <p className="error-box" role="alert">{data.error.message}</p> : data.data && <>
      <nav className="admin-section-nav" aria-label="Admin console sections"><a href="#platform-overview">Overview</a><a href="#platform-workspaces">Workspaces</a><a href="#platform-users">Users & access</a><a href="#platform-queue">Queue operations</a></nav>

      <section id="platform-overview" className="admin-metric-grid" aria-label="Platform overview">
        <Panel className="admin-metric"><span><BriefcaseBusiness size={15} /> Workspaces</span><strong>{data.data.total_workspaces.toLocaleString()}</strong><small>Registered workspaces</small></Panel>
        <Panel className="admin-metric"><span><Users size={15} /> Registered users</span><strong>{data.data.total_users.toLocaleString()}</strong><small>Platform accounts</small></Panel>
        <Panel className="admin-metric"><span><Activity size={15} /> API executions</span><strong>{data.data.total_runs.toLocaleString()}</strong><small>Recorded run history</small></Panel>
        <Panel className="admin-metric"><span><Gauge size={15} /> Daily quota used</span><strong>{data.data.usage_today.toLocaleString()} <small>/ {data.data.daily_quota_capacity.toLocaleString()}</small></strong><small>{data.data.quota_used_percent === null ? "No configured workspace capacity" : `${data.data.quota_used_percent}% of combined daily limits`}</small></Panel>
        <Panel className="admin-metric"><span><Clock3 size={15} /> Jobs awaiting</span><strong>{data.data.queued_jobs.toLocaleString()}</strong><small>Current queue depth</small></Panel>
        <Panel className="admin-metric"><span><X size={15} /> Failed jobs</span><strong>{data.data.failed_jobs.toLocaleString()}</strong><small>Recorded in failed job storage</small></Panel>
      </section>

      <Panel id="platform-workspaces" className="admin-section-panel">
        <div className="panel-heading admin-section-heading"><div><h2>Workspaces</h2><p>Search by workspace or owner. Quota usage reflects recorded runs today.</p></div><Badge>{data.data.workspaces_pagination.total} total</Badge></div>
        <label className="admin-search"><Search size={15} /><input aria-label="Search workspaces" placeholder="Search name or owner…" value={workspaceSearch} onChange={(event) => { setWorkspaceSearch(event.target.value); setWorkspacePage(1); }} /></label>
        {data.data.workspaces.length ? <>
          <div className="data-table admin-table-wrap"><table><thead><tr><th>Workspace</th><th>Owner</th><th>Members</th><th>Usage / quota today</th><th>Created</th><th>Actions</th></tr></thead><tbody>{data.data.workspaces.map((workspace) => <tr key={workspace.id}>
            <td><strong>{workspace.name}</strong><small className="admin-subline">Workspace #{workspace.id}</small></td>
            <td>{workspace.owner_name || "Owner unavailable"}<small className="admin-subline">{workspace.owner_email || ""}</small></td>
            <td>{workspace.member_count}</td>
            <td><strong>{Number(workspace.usage_today).toLocaleString()}</strong><span className="muted"> / {workspace.daily_run_limit.toLocaleString()}</span><div className="admin-usage-track"><i style={{ width: `${Math.min(100, workspace.daily_run_limit ? Number(workspace.usage_today) / workspace.daily_run_limit * 100 : 0)}%` }} /></div></td>
            <td>{when(workspace.created_at)}</td>
            <td><div className="admin-row-actions"><Button variant="ghost" onClick={() => setSelected({ kind: "workspace", id: workspace.id })}><Eye size={14} /> View</Button><Button variant="secondary" onClick={() => { setEdit(workspace); setNextLimit(String(workspace.daily_run_limit)); setConfirmQuota(false); }}>Set quota</Button></div></td>
          </tr>)}</tbody></table></div>
          <div className="admin-mobile-list">{data.data.workspaces.map((workspace) => <article className="admin-mobile-card" key={workspace.id}><div className="admin-mobile-card-title"><strong>{workspace.name}</strong><Badge>#{workspace.id}</Badge></div><p>{workspace.owner_name || "Owner unavailable"}<small>{workspace.owner_email}</small></p><div className="admin-mobile-facts"><span>Members<strong>{workspace.member_count}</strong></span><span>Usage today<strong>{Number(workspace.usage_today).toLocaleString()} / {workspace.daily_run_limit}</strong></span><span>Created<strong>{when(workspace.created_at)}</strong></span></div><div className="admin-row-actions"><Button variant="secondary" onClick={() => setSelected({ kind: "workspace", id: workspace.id })}><Eye size={14} /> View details</Button><Button variant="ghost" onClick={() => { setEdit(workspace); setNextLimit(String(workspace.daily_run_limit)); setConfirmQuota(false); }}>Set quota</Button></div></article>)}</div>
        </> : <Empty title="No workspaces found" text={workspaceSearch ? "Try another workspace or owner search." : "Workspaces will appear here when created."} />}
        <PageControls page={data.data.workspaces_pagination} change={setWorkspacePage} />
      </Panel>

      <Panel id="platform-users" className="admin-section-panel">
        <div className="panel-heading admin-section-heading"><div><h2>Users & access</h2><p>Inspect account verification and workspace associations. No account access controls are exposed here.</p></div><Badge>{data.data.users_pagination.total} total</Badge></div>
        <label className="admin-search"><Search size={15} /><input aria-label="Search user accounts" placeholder="Search name or email…" value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserPage(1); }} /></label>
        {data.data.users.length ? <>
          <div className="data-table admin-table-wrap"><table><thead><tr><th>Account</th><th>Access</th><th>Verification</th><th>Workspaces</th><th>Joined</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{data.data.users.map((user) => <tr key={user.id}>
            <td><strong>{user.name}</strong><small className="admin-subline">{user.email}</small></td>
            <td><Badge tone={user.is_admin ? "violet" : "neutral"}>{user.is_admin ? "Platform admin" : "Standard account"}</Badge></td>
            <td><Badge tone={user.email_verified_at ? "mint" : "amber"}>{user.email_verified_at ? "Verified" : "Unverified"}</Badge></td>
            <td>{user.workspace_count}</td><td>{when(user.created_at)}</td>
            <td><Button variant="ghost" onClick={() => setSelected({ kind: "user", id: user.id })}><Eye size={14} /> Details</Button></td>
          </tr>)}</tbody></table></div>
          <div className="admin-mobile-list">{data.data.users.map((user) => <article className="admin-mobile-card" key={user.id}><div className="admin-mobile-card-title"><strong>{user.name}</strong><Badge tone={user.is_admin ? "violet" : "neutral"}>{user.is_admin ? "Platform admin" : "Standard"}</Badge></div><p>{user.email}</p><div className="admin-mobile-facts"><span>Verification<strong>{user.email_verified_at ? "Verified" : "Unverified"}</strong></span><span>Workspaces<strong>{user.workspace_count}</strong></span><span>Joined<strong>{when(user.created_at)}</strong></span></div><Button variant="secondary" onClick={() => setSelected({ kind: "user", id: user.id })}><Eye size={14} /> Account details</Button></article>)}</div>
        </> : <Empty title="No accounts found" text={userSearch ? "Try another name or email search." : "Registered accounts will appear here."} />}
        <PageControls page={data.data.users_pagination} change={setUserPage} />
      </Panel>

      <Panel id="platform-queue" className="admin-section-panel admin-queue-panel">
        <div className="panel-heading"><div><h2>Queue & system operations</h2><p>Queue counts are read from the configured backend. Worker heartbeats are not collected by this application.</p></div><Badge tone="neutral">Operational visibility</Badge></div>
        <div className="admin-queue-grid">
          <div className="admin-queue-fact"><Database size={16} /><span>Queue connection</span><strong>{data.data.queue_driver}</strong></div>
          <div className="admin-queue-fact"><HardDrive size={16} /><span>Worker heartbeat</span><strong><Badge>Not monitored</Badge></strong></div>
          <div className="admin-queue-fact"><Clock3 size={16} /><span>Pending jobs</span><strong>{data.data.queued_jobs.toLocaleString()}</strong></div>
          <div className="admin-queue-fact"><X size={16} /><span>Failed jobs</span><strong>{data.data.failed_jobs.toLocaleString()}</strong></div>
        </div>
        <div className="admin-failure-list"><div className="admin-subsection-heading"><h3>Recent failed jobs</h3><span>Safe metadata only</span></div>{data.data.recent_failed_jobs.length ? data.data.recent_failed_jobs.map((failure) => <div className="admin-failure-row" key={failure.id}><span><strong>{failure.queue}</strong><small>Job {failure.id}</small></span><time dateTime={failure.failed_at}>{when(failure.failed_at)}</time></div>) : <p className="muted">No failed jobs are recorded.</p>}</div>
      </Panel>

      <Panel className="admin-section-panel">
        <div className="panel-heading"><div><h2>Cloud destination approvals</h2><p>Exact hosts only. DNS and TLS checks still run for each cloud execution.</p></div><Badge>{data.data.destination_approvals.length} recent</Badge></div>
        <form className="admin-destination-form" onSubmit={async (event) => { event.preventDefault(); const result = await p.act(() => api("admin/destinations", "POST", { hostname: destinationHost.trim().toLowerCase() }), "Destination submitted for review."); if (result) setDestinationHost(""); }}><Field label="Exact DNS hostname"><input required maxLength={253} value={destinationHost} onChange={(event) => setDestinationHost(event.target.value)} placeholder="api.example.com" /></Field><Button disabled={p.busy}>Add destination</Button></form>
        {data.data.destination_approvals.length ? <div className="admin-destination-list">{data.data.destination_approvals.map((destination) => <div className="admin-destination-row" key={destination.id}><div><strong className="mono">{destination.hostname}</strong><small>{destination.requester?.name || "Deleted account"} · {when(destination.created_at)}{destination.reviewer ? ` · reviewed by ${destination.reviewer.name}` : ""}</small></div><Badge tone={destination.status === "approved" ? "mint" : destination.status === "denied" ? "red" : "amber"}>{destination.status}</Badge><div className="admin-row-actions"><Button variant="secondary" disabled={p.busy || destination.status === "approved"} onClick={() => setPendingDestination({ id: destination.id, hostname: destination.hostname, status: "approved" })}><Check size={14} /> Approve</Button><Button variant="danger" disabled={p.busy || destination.status === "denied"} onClick={() => setPendingDestination({ id: destination.id, hostname: destination.hostname, status: "denied" })}><X size={14} /> Deny</Button></div></div>)}</div> : <Empty title="No destination requests" text="Requested hostnames will appear here for review." />}
        <p className="admin-approved-hosts"><ShieldCheck size={14} /> Approved execution hosts: {data.data.executor_hosts.length ? data.data.executor_hosts.join(", ") : "None configured"}</p>
      </Panel>
    </>}

    {edit && <Dialog title={confirmQuota ? "Confirm quota change" : `Workspace quota · ${edit.name}`} close={() => { setEdit(null); setConfirmQuota(false); }}>
      {!confirmQuota ? <form onSubmit={(event) => { event.preventDefault(); setConfirmQuota(true); }}><Field label="Daily execution limit" hint="Choose a limit from 1 to 100,000 runs per day."><input aria-label="Daily execution limit" type="number" min={1} max={100000} required value={nextLimit} onChange={(event) => setNextLimit(event.target.value)} /></Field><p className="admin-quota-current">Current use today: <strong>{Number(edit.usage_today).toLocaleString()}</strong> of {edit.daily_run_limit.toLocaleString()} runs.</p><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!nextLimit || Number(nextLimit) < 1 || Number(nextLimit) > 100000}>Review change</Button></div></form> : <div className="admin-quota-confirm"><p>Change the daily limit for <strong>{edit.name}</strong>?</p><div className="admin-quota-delta"><span>{edit.daily_run_limit.toLocaleString()}<small>current daily limit</small></span><ArrowRight size={16} /><strong>{Number(nextLimit).toLocaleString()}<small>new daily limit</small></strong></div><p className="muted small">This update is restricted to platform administrators and will create a workspace audit event.</p><div className="form-actions"><Button variant="secondary" onClick={() => setConfirmQuota(false)}>Back</Button><Button disabled={p.busy} onClick={() => void confirmQuotaChange()}>Confirm quota update</Button></div></div>}
    </Dialog>}

    {selected && <Dialog title={selected.kind === "workspace" ? "Workspace details" : "Account details"} close={() => setSelected(null)}>
      {detail.isPending ? <Loading /> : detail.error ? <p className="error-box" role="alert">{detail.error.message}</p> : detail.data && (selected.kind === "workspace" ? <WorkspaceDetailView value={detail.data as WorkspaceDetail} /> : <UserDetailView value={detail.data as UserDetail} />)}
    </Dialog>}

    {pendingDestination && <Dialog title={`Confirm ${pendingDestination.status === "approved" ? "approval" : "denial"}`} close={() => setPendingDestination(null)}><p>{pendingDestination.status === "approved" ? "Approve" : "Deny"} the exact destination <strong className="mono">{pendingDestination.hostname}</strong>?</p><p className="muted small">Every cloud request still passes the approved-destination enforcement checks.</p><div className="form-actions"><Button variant="secondary" onClick={() => setPendingDestination(null)}>Cancel</Button><Button variant={pendingDestination.status === "denied" ? "danger" : "primary"} disabled={p.busy} onClick={() => void reviewDestination()}>{pendingDestination.status === "approved" ? "Approve host" : "Deny host"}</Button></div></Dialog>}
  </>;
}

function WorkspaceDetailView({ value }: { value: WorkspaceDetail }) {
  const workspace = value.workspace;
  return <div className="admin-detail-content"><div className="admin-detail-title"><span className="admin-detail-icon"><BriefcaseBusiness size={18} /></span><div><span className="eyebrow">Workspace #{workspace.id}</span><h3>{workspace.name}</h3></div></div><dl className="admin-detail-grid"><div><dt>Owner</dt><dd>{workspace.owner_name || "Unavailable"}<small>{workspace.owner_email}</small></dd></div><div><dt>Members</dt><dd>{workspace.member_count}</dd></div><div><dt>Runs used today</dt><dd>{Number(workspace.usage_today).toLocaleString()} / {workspace.daily_run_limit.toLocaleString()}</dd></div><div><dt>Created</dt><dd>{new Date(workspace.created_at).toLocaleString()}</dd></div></dl><div className="admin-detail-members"><div className="admin-subsection-heading"><h3>Workspace members</h3><span>{value.members.length === 50 ? "First 50" : value.members.length}</span></div>{value.members.length ? value.members.map((member) => <div className="admin-detail-member" key={member.id}><span><strong>{member.name}</strong><small>{member.email}</small></span><Badge>{member.role}</Badge></div>) : <p className="muted">No workspace members are recorded.</p>}</div></div>;
}

function UserDetailView({ value }: { value: UserDetail }) {
  const user = value.user;
  return <div className="admin-detail-content"><div className="admin-detail-title"><span className="admin-detail-icon"><Users size={18} /></span><div><span className="eyebrow">Account #{user.id}</span><h3>{user.name}</h3></div></div><dl className="admin-detail-grid"><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Platform access</dt><dd>{user.is_admin ? "Platform administrator" : "Standard account"}</dd></div><div><dt>Email verification</dt><dd>{user.email_verified_at ? `Verified ${when(user.email_verified_at)}` : "Not verified"}</dd></div><div><dt>Created</dt><dd>{new Date(user.created_at).toLocaleString()}</dd></div></dl><div className="admin-detail-members"><div className="admin-subsection-heading"><h3>Workspace memberships</h3><span>{value.workspaces.length === 50 ? "First 50" : value.workspaces.length}</span></div>{value.workspaces.length ? value.workspaces.map((workspace) => <div className="admin-detail-member" key={workspace.id}><span><strong>{workspace.name}</strong><small>Workspace #{workspace.id} · {workspace.daily_run_limit.toLocaleString()} daily runs</small></span><Badge>{workspace.role}</Badge></div>) : <p className="muted">This account has no workspace memberships.</p>}</div></div>;
}
