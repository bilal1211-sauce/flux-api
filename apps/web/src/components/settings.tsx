"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { AccountSettings } from "./account";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import type { ModuleProps } from "./console";
import {
  Badge,
  Button,
  DeleteButton,
  Dialog,
  Field,
  Loading,
  Panel,
} from "./ui";

export function Settings(
  p: ModuleProps & { refreshWorkspaces: () => Promise<unknown> },
) {
  const members = useQuery({
    queryKey: [p.base, "members"],
    queryFn: () =>
      api<{
        members: Member[];
        invitations: { id: number; email: string; role: string }[];
      }>(`${p.base}/members`),
  });
  const [invite, setInvite] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(location.hash.slice(1)).get("invite") ||
        new URLSearchParams(location.search).get("invite") ||
        "",
  );
  const owner = p.workspace.role === "owner";
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Workspace access</span>
          <h1>
            Team & settings<span className="title-dot">.</span>
          </h1>
          <p>Manage workspace members, roles and invitations.</p>
        </div>
        <Button disabled={!owner} onClick={() => setInvite(true)}>
          <UserPlus size={16} /> Invite member
        </Button>
      </div>
      <Panel>
        <div className="panel-heading">
          <div>
            <h2>{p.workspace.name}</h2>
            <p>
              Your role: {p.workspace.role}. Owners manage the team. Editors
              manage requests. Viewers can inspect results.
            </p>
          </div>
          <Badge tone="mint">WORKSPACE #{p.workspace.id}</Badge>
        </div>
        {members.isPending ? (
          <Loading />
        ) : members.error ? (
          <p className="error-box">{members.error.message}</p>
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.data?.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="request-cell">
                        <span className="avatar">
                          {m.name.slice(0, 2).toUpperCase()}
                        </span>
                        <strong>{m.name}</strong>
                      </div>
                    </td>
                    <td className="muted">{m.email}</td>
                    <td>
                      {owner && m.role !== "owner" ? (
                        <select
                          aria-label={`Role for ${m.name}`}
                          value={m.role}
                          disabled={p.busy}
                          onChange={(e) =>
                            p.act(
                              () =>
                                api(`${p.base}/members/${m.id}`, "PATCH", {
                                  role: e.target.value,
                                }),
                              "Member role updated.",
                            )
                          }
                        >
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <Badge tone={m.role === "owner" ? "violet" : "neutral"}>
                          {m.role}
                        </Badge>
                      )}
                    </td>
                    <td>
                      {owner && m.role !== "owner" && (
                        <DeleteButton
                          name={m.name}
                          remove={() =>
                            p.act(
                              () => api(`${p.base}/members/${m.id}`, "DELETE"),
                              "Member removed.",
                            )
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {!!members.data?.invitations.length && (
        <Panel className="pending-invites">
          <div className="panel-heading">
            <h2>Pending invitations</h2>
          </div>
          {members.data.invitations.map((i) => (
            <div className="simple-row" key={i.id}>
              <UserPlus size={16} />
              <span>{i.email}</span>
              <Badge>{i.role}</Badge>
            </div>
          ))}
        </Panel>
      )}
      {link && (
        <Panel className="share-created">
          <strong>Invitation created</strong>
          <p className="muted small">
            Share this link with the invited person. They must sign in using the
            invited email address. Invitation links expire in seven days.
          </p>
          <div>
            <input aria-label="Invitation link" readOnly value={link} />
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </Panel>
      )}
      <div className="settings-grid">
        <Panel className="settings-card">
          <span className="quick-icon cyan">
            <Users size={22} />
          </span>
          <h2>Another team, another workspace</h2>
          <p>
            Keep projects separate with their own members, collections, and
            environments.
          </p>
          <Button variant="secondary" onClick={() => setNewWorkspace(true)}>
            <Plus size={14} /> New workspace
          </Button>
        </Panel>
        <Panel className="settings-card">
          <span className="quick-icon violet">
            <ShieldCheck size={22} />
          </span>
          <h2>Have an invitation?</h2>
          <p>
            Paste your invitation token or open your invitation link while
            signed in.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const accepted = await p.act(
                () => api("invitations/accept", "POST", { token }),
                "Invitation accepted. Switch workspaces using the sidebar.",
              );
              if (accepted) {
                setToken("");
                await p.refreshWorkspaces();
                history.replaceState(null, "", "/settings");
              }
            }}
          >
            <input
              aria-label="Invitation token"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Invitation token"
            />
            <Button variant="secondary" disabled={p.busy}>
              Accept invitation
            </Button>
          </form>
        </Panel>
      </div>
      {invite && (
        <Dialog title="Invite a teammate" close={() => setInvite(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const result = await p.act(
                () =>
                  api<{ token: string }>(`${p.base}/invitations`, "POST", {
                    email: form.get("email"),
                    role: form.get("role"),
                  }),
                "Invitation created.",
              );
              if (result) {
                setLink(`${location.origin}/settings#invite=${result.token}`);
                setCopied(false);
                setInvite(false);
              }
            }}
          >
            <Field label="Email address">
              <input
                type="email"
                name="email"
                required
                autoFocus
                placeholder="teammate@company.com"
              />
            </Field>
            <Field label="Workspace role">
              <select name="role">
                <option value="editor">
                  Editor · manage requests and monitors
                </option>
                <option value="viewer">Viewer · read-only access</option>
              </select>
            </Field>
            <div className="form-actions">
              <Button disabled={p.busy}>Create invitation</Button>
            </div>
          </form>
        </Dialog>
      )}
      {newWorkspace && (
        <Dialog title="Create a workspace" close={() => setNewWorkspace(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const result = await p.act(
                () => api("workspaces", "POST", { name: form.get("name") }),
                "Workspace created. Select it from the sidebar.",
              );
              if (result) {
                setNewWorkspace(false);
                await p.refreshWorkspaces();
              }
            }}
          >
            <Field label="Workspace name">
              <input
                autoFocus
                name="name"
                required
                maxLength={100}
                placeholder="Platform engineering"
              />
            </Field>
            <div className="form-actions">
              <Button disabled={p.busy}>Create workspace</Button>
            </div>
          </form>
        </Dialog>
      )}
      <Panel className="workspace-preferences">
        <div className="panel-heading">
          <div>
            <h2>Workspace preferences</h2>
            <p>
              Monitor incidents always appear in Alerts. Choose additional
              delivery channels.
            </p>
          </div>
        </div>
        <form
          key={`${p.workspace.id}-${p.workspace.name}-${p.workspace.email_alerts}-${p.workspace.webhook_alerts}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const values = new FormData(e.currentTarget);
            const result = await p.act(
              () =>
                api(`${p.base}/preferences`, "PATCH", {
                  name: values.get("name"),
                  email_alerts: values.has("email_alerts"),
                  webhook_alerts: values.has("webhook_alerts"),
                }),
              "Workspace preferences saved.",
            );
            if (result) await p.refreshWorkspaces();
          }}
        >
          <Field label="Workspace display name">
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={p.workspace.name}
              disabled={!owner}
            />
          </Field>
          <label className="preference-toggle">
            <input
              type="checkbox"
              name="email_alerts"
              defaultChecked={p.workspace.email_alerts}
              disabled={!owner}
            />{" "}
            Email verified owners and editors when a monitor fails or recovers
          </label>
          <label className="preference-toggle">
            <input
              type="checkbox"
              name="webhook_alerts"
              defaultChecked={p.workspace.webhook_alerts}
              disabled={!owner || !p.workspace.webhook_available}
            />{" "}
            Send incidents to the connected webhook
          </label>
          {!p.workspace.webhook_available && (
            <p className="muted small">
              A workspace administrator can connect a webhook on the server.
            </p>
          )}
          <div className="form-actions">
            <Button disabled={!owner || p.busy}>
              Save workspace preferences
            </Button>
          </div>
        </form>
      </Panel>
      <AccountSettings {...p} />
    </>
  );
}
