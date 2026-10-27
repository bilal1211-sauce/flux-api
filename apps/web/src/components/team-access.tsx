"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { AccountSettings } from "./account";
import { api } from "@/lib/api";
import type { Member, Workspace } from "@/lib/types";
import type { ModuleProps } from "./console";
import { Badge, Button, Dialog, Empty, Field, Loading, Panel } from "./ui";

type Invitation = {
  id: number;
  email: string;
  role: "editor" | "viewer";
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type WorkspaceMembers = { members: Member[]; invitations: Invitation[] };
type TabId = "members" | "invitations" | "roles" | "preferences" | "account";

const tabs: { id: TabId; label: string }[] = [
  { id: "members", label: "Members" },
  { id: "invitations", label: "Invitations" },
  { id: "roles", label: "Roles & permissions" },
  { id: "preferences", label: "Workspace preferences" },
  { id: "account", label: "Account" },
];

function invitationStatus(invitation: Invitation): "Pending" | "Expired" | "Revoked" | "Accepted" {
  if (invitation.accepted_at) return "Accepted";
  if (invitation.revoked_at) return "Revoked";
  return new Date(invitation.expires_at) <= new Date() ? "Expired" : "Pending";
}

export function TeamAccess(p: ModuleProps & { refreshWorkspaces: () => Promise<unknown> }) {
  const members = useQuery({
    queryKey: [p.base, "members"],
    queryFn: () => api<WorkspaceMembers>(`${p.base}/members`),
  });
  const [tab, setTab] = useState<TabId>("members");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<Member | null>(null);
  const [revokeInvitation, setRevokeInvitation] = useState<Invitation | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(location.hash.slice(1)).get("invite") || new URLSearchParams(location.search).get("invite") || "");
  const owner = p.workspace.role === "owner";
  const currentTab = tabs.findIndex((item) => item.id === tab);

  function moveTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = (currentTab + direction + tabs.length) % tabs.length;
    setTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  async function createInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await p.act(
      () => api<{ token: string }>(`${p.base}/invitations`, "POST", { email: form.get("email"), role: form.get("role") }),
      "Invitation created.",
    );
    if (result) {
      setInviteLink(`${location.origin}/settings#invite=${result.token}`);
      setCopied(false);
      setInviteOpen(false);
      setTab("invitations");
    }
  }

  async function acceptInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await p.act(
      () => api<{ workspace_id: number }>("invitations/accept", "POST", { token }),
      "Invitation accepted. Switch workspaces from the sidebar.",
    );
    if (result) {
      setToken("");
      await p.refreshWorkspaces();
      history.replaceState(null, "", "/settings");
    }
  }

  return (
    <>
      <div className="page-heading team-heading">
        <div><span className="eyebrow">Workspace access</span><h1>Team & Access<span className="title-dot">.</span></h1><p>Manage who can work in {p.workspace.name} and what they can change.</p></div>
        <div className="team-heading-actions">
          <Button variant="secondary" onClick={() => setNewWorkspaceOpen(true)}><Plus size={15} /> New workspace</Button>
          <Button disabled={!owner} onClick={() => setInviteOpen(true)}><UserPlus size={15} /> Invite member</Button>
        </div>
      </div>

      <Panel className="team-workspace-banner">
        <span className="quick-icon violet"><Users size={18} /></span>
        <div><strong>{p.workspace.name}</strong><small>Your role: {p.workspace.role} · workspace #{p.workspace.id}</small></div>
        <Badge tone="mint">{members.data?.members.length ?? "—"} members</Badge>
        <Badge>{members.data?.invitations.filter((invitation) => invitationStatus(invitation) === "Pending").length ?? "—"} pending</Badge>
      </Panel>

      {inviteLink && <Panel className="share-created team-invite-link" role="status">
        <div><strong>Invitation created</strong><small>It expires in seven days and can only be accepted by signing in with the invited email address.</small></div>
        <input aria-label="Invitation link" readOnly value={inviteLink} />
        <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(inviteLink); setCopied(true); }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</Button>
        <Button variant="ghost" aria-label="Hide invitation link" onClick={() => { setInviteLink(""); setCopied(false); }}>Hide link</Button>
      </Panel>}

      {members.isPending ? <Panel><Loading /></Panel> : members.error ? <p className="error-box">{members.error.message}</p> : <>
        <div className="team-tabs-scroll">
          <div className="team-tabs" role="tablist" aria-label="Team and workspace settings" onKeyDown={moveTab}>
            {tabs.map((item, index) => <button key={item.id} ref={(element) => { tabRefs.current[index] = element; }} id={`team-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls="team-tab-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{item.label}</button>)}
          </div>
        </div>
        <div id="team-tab-panel" className="team-tab-panel" role="tabpanel" aria-labelledby={`team-tab-${tab}`} tabIndex={0}>
          {tab === "members" && <Panel className="team-panel">
            <div className="panel-heading"><div><h2>Workspace members</h2><p>Active people with access to this workspace.</p></div><Badge>{members.data?.members.length ?? 0}</Badge></div>
            {members.data?.members.length ? <>
              <div className="team-member-head" aria-hidden="true"><span>Member</span><span>Email</span><span>Role</span><span>Status</span><span>Actions</span></div>
              <div className="team-member-list">{members.data.members.map((member) => <article className="team-member-row" key={member.id}>
                <div className="team-member-name"><span className="avatar">{member.name.slice(0, 2).toUpperCase()}</span><strong>{member.name}</strong></div>
                <span className="team-member-email" data-label="Email">{member.email}</span>
                <div data-label="Role">{owner && member.role !== "owner" ? <select aria-label={`Role for ${member.name}`} value={member.role} disabled={p.busy} onChange={(event) => void p.act(() => api(`${p.base}/members/${member.id}`, "PATCH", { role: event.target.value }), "Member role updated.")}><option value="editor">Editor</option><option value="viewer">Viewer</option></select> : <Badge tone={member.role === "owner" ? "violet" : "neutral"}>{member.role}</Badge>}</div>
                <div data-label="Status"><Badge tone="mint">Active</Badge></div>
                <div className="team-row-actions">{owner && member.role !== "owner" ? <Button variant="ghost" className="team-remove" disabled={p.busy} onClick={() => setRemoveMember(member)}>Remove</Button> : <small className="muted">{member.role === "owner" ? "Workspace owner" : "Read only"}</small>}</div>
              </article>)}</div>
            </> : <Empty title="No members found" text="Workspace members will appear here when they join." />}
          </Panel>}

          {tab === "invitations" && <div className="team-invitations-layout">
            <Panel className="team-panel">
              <div className="panel-heading"><div><h2>Invitations</h2><p>Review active, accepted, expired, and revoked invitations.</p></div><Button variant="secondary" disabled={!owner} onClick={() => setInviteOpen(true)}><UserPlus size={14} /> Invite</Button></div>
              {members.data?.invitations.length ? <div className="team-invitation-list">{members.data.invitations.map((invitation) => {
                const state = invitationStatus(invitation);
                return <article className="team-invitation-row" key={invitation.id}>
                  <span className="quick-icon cyan"><UserPlus size={16} /></span>
                  <div className="team-invitation-main"><strong>{invitation.email}</strong><small>{invitation.role} access · invited {new Date(invitation.created_at).toLocaleDateString()}</small></div>
                  <div className="team-invitation-meta"><Badge tone={state === "Pending" ? "amber" : state === "Accepted" ? "mint" : "neutral"}>{state}</Badge><small>{state === "Pending" ? `Expires ${new Date(invitation.expires_at).toLocaleString()}` : state === "Accepted" ? `Accepted ${new Date(invitation.accepted_at!).toLocaleDateString()}` : state === "Revoked" ? `Revoked ${new Date(invitation.revoked_at!).toLocaleDateString()}` : `Expired ${new Date(invitation.expires_at).toLocaleDateString()}`}</small></div>
                  {state === "Pending" && owner && <Button variant="ghost" className="team-remove" disabled={p.busy} onClick={() => setRevokeInvitation(invitation)}>Revoke</Button>}
                </article>;
              })}</div> : <Empty title="No invitations yet" text="Invitations remain tied to the email address and expire after seven days." />}
            </Panel>
            <Panel className="team-panel accept-invitation-panel"><span className="quick-icon violet"><ShieldCheck size={19} /></span><h2>Accept an invitation</h2><p>Paste an invitation token or open the invitation link while signed in as the invited email address.</p><form onSubmit={(event) => void acceptInvitation(event)}><Field label="Invitation token"><input required value={token} onChange={(event) => setToken(event.target.value)} placeholder="48-character token" autoComplete="off" /></Field><Button variant="secondary" disabled={p.busy || !token.trim()}>Accept invitation</Button></form></Panel>
          </div>}

          {tab === "roles" && <Panel className="team-panel">
            <div className="panel-heading"><div><h2>Roles & permissions</h2><p>Workspace roles apply to shared collections, environments, executions, and reports.</p></div><ShieldCheck size={19} /></div>
            <div className="team-role-list">
              <article><div><Badge tone="violet">Owner</Badge><h3>Full workspace control</h3></div><p>Invite members, change editor/viewer roles, manage workspace preferences, create and revoke report links, and modify workspace resources.</p></article>
              <article><div><Badge tone="cyan">Editor</Badge><h3>Build and operate</h3></div><p>Create and update workspace resources, execute requests, manage monitors, and create or revoke report links. Cannot manage members or workspace preferences.</p></article>
              <article><div><Badge>Viewer</Badge><h3>Read-only access</h3></div><p>Inspect workspace resources, execution history, alerts, and reports. Cannot change configuration, execute requests, or manage access.</p></article>
            </div>
            <p className="muted small">Only owners can change member roles. Platform administrator access is managed separately and is never granted through workspace controls.</p>
          </Panel>}

          {tab === "preferences" && <Panel className="team-panel workspace-preferences">
            <div className="panel-heading"><div><h2>Workspace preferences</h2><p>Control notification delivery and the workspace display name.</p></div><Badge tone={owner ? "violet" : "neutral"}>{p.workspace.role}</Badge></div>
            <form key={`${p.workspace.id}-${p.workspace.name}-${p.workspace.email_alerts}-${p.workspace.webhook_alerts}`} onSubmit={async (event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              const result = await p.act(() => api(`${p.base}/preferences`, "PATCH", { name: values.get("name"), email_alerts: values.has("email_alerts"), webhook_alerts: values.has("webhook_alerts") }), "Workspace preferences saved.");
              if (result) await p.refreshWorkspaces();
            }}>
              <Field label="Workspace display name"><input name="name" required maxLength={100} defaultValue={p.workspace.name} disabled={!owner} /></Field>
              <label className="preference-toggle"><input type="checkbox" name="email_alerts" defaultChecked={p.workspace.email_alerts} disabled={!owner} /> Email verified owners and editors when a monitor fails or recovers</label>
              <label className="preference-toggle"><input type="checkbox" name="webhook_alerts" defaultChecked={p.workspace.webhook_alerts} disabled={!owner || !p.workspace.webhook_available} /> Send incidents to the connected webhook</label>
              {!p.workspace.webhook_available && <p className="muted small">A platform administrator must connect the webhook. Secret delivery credentials are managed server-side.</p>}
              <div className="form-actions"><Button disabled={!owner || p.busy}>Save workspace preferences</Button></div>
            </form>
          </Panel>}

          {tab === "account" && <AccountSettings {...p} />}
        </div>
      </>}

      {inviteOpen && <Dialog title="Invite a teammate" close={() => setInviteOpen(false)}>
        <form onSubmit={(event) => void createInvitation(event)}>
          <Field label="Email address"><input type="email" name="email" required autoFocus maxLength={255} placeholder="teammate@company.com" /></Field>
          <Field label="Workspace role"><select name="role"><option value="editor">Editor · manage resources</option><option value="viewer">Viewer · read only</option></select></Field>
          <p className="muted small">Owner access cannot be granted through an invitation. This link expires in seven days.</p>
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setInviteOpen(false)}>Cancel</Button><Button disabled={!owner || p.busy}>Create invitation</Button></div>
        </form>
      </Dialog>}

      {newWorkspaceOpen && <Dialog title="Create a workspace" close={() => setNewWorkspaceOpen(false)}>
        <form onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const result = await p.act(() => api<Workspace>("workspaces", "POST", { name: form.get("name") }), "Workspace created. Select it from the sidebar.");
          if (result) { setNewWorkspaceOpen(false); await p.refreshWorkspaces(); }
        }}>
          <Field label="Workspace name"><input autoFocus name="name" required maxLength={100} placeholder="Platform engineering" /></Field>
          <div className="form-actions"><Button variant="secondary" type="button" onClick={() => setNewWorkspaceOpen(false)}>Cancel</Button><Button disabled={p.busy}>Create workspace</Button></div>
        </form>
      </Dialog>}

      {removeMember && <Dialog title={`Remove ${removeMember.name}?`} close={() => setRemoveMember(null)}>
        <p className="muted">They will lose access to this workspace. Their user account and other workspace memberships remain unchanged.</p>
        <div className="form-actions"><Button variant="secondary" onClick={() => setRemoveMember(null)}>Cancel</Button><Button variant="danger" disabled={p.busy || !owner} onClick={async () => { const result = await p.act(() => api(`${p.base}/members/${removeMember.id}`, "DELETE"), "Member removed from this workspace."); if (result !== undefined) setRemoveMember(null); }}>Remove member</Button></div>
      </Dialog>}

      {revokeInvitation && <Dialog title="Revoke this invitation?" close={() => setRevokeInvitation(null)}>
        <p className="muted">The invitation for <strong>{revokeInvitation.email}</strong> will stop working. The invitation record remains in the workspace history.</p>
        <div className="form-actions"><Button variant="secondary" onClick={() => setRevokeInvitation(null)}>Cancel</Button><Button variant="danger" disabled={p.busy || !owner} onClick={async () => { const result = await p.act(() => api(`${p.base}/invitations/${revokeInvitation.id}`, "DELETE"), "Invitation revoked."); if (result !== undefined) setRevokeInvitation(null); }}>Revoke invitation</Button></div>
      </Dialog>}
    </>
  );
}
