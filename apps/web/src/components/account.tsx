"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { api, when } from "@/lib/api";
import type { User } from "@/lib/types";
import type { ModuleProps } from "./console";
import { Badge, Button, Dialog, Field, Loading, Panel } from "./ui";

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function useLinkParameters() {
  const fragment = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
  return new URLSearchParams(fragment.slice(1));
}

export function Auth({ mode = "login" }: { mode?: string }) {
  const client = useQueryClient();
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const parameters = useLinkParameters();
  const recovery = mode === "forgot-password";
  const reset = mode === "reset-password";
  const verify = mode === "verify-email";
  const normal = !recovery && !reset && !verify;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (normal) {
        await api(`auth/${register ? "register" : "login"}`, "POST", {
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          password_confirmation: form.get("password_confirmation"),
        });
        await client.invalidateQueries();
      } else {
        const data = await api<{ message: string }>(`auth/${mode}`, "POST", {
          email: form.get("email"),
          token: parameters.get("token"),
          password: form.get("password"),
          password_confirmation: form.get("password_confirmation"),
        });
        setMessage(data.message);
        if (reset || verify) {
          history.replaceState(null, "", location.pathname);
          await client.invalidateQueries({ queryKey: ["me"] });
        }
      }
    } catch (exception) {
      setError((exception as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title = recovery
    ? "Forgot your password?"
    : reset
      ? "Set a new password"
      : verify
        ? "Verify your email"
        : register
          ? "Create an account"
          : "Sign in to FluxAPI";
  return (
    <main className="auth-page">
      <div className="auth-art">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Waypoints size={21} />
          </span>
          FluxAPI
        </Link>
        <div>
          <span className="auth-label">API workspace</span>
          <h1>
            Build and test APIs.
            <br />
            Keep track of what changes.
          </h1>
          <p>
            Save requests, share environments with your team,
            <br />
            and check the endpoints you depend on.
          </p>
          <div className="auth-features">
            <span>
              <Check size={17} /> Requests and response assertions
            </span>
            <span>
              <Check size={17} /> Scheduled checks and incident alerts
            </span>
            <span>
              <Check size={17} /> Private workspaces and encrypted secrets
            </span>
          </div>
        </div>
        <small>FluxAPI · Built for day-to-day API work.</small>
      </div>
      <div className="auth-side">
        <form className="auth-form" onSubmit={submit}>
          <h2>{title}</h2>
          <p className="muted">
            {recovery
              ? "Enter your account email and we will send a reset link."
              : reset
                ? "Choose a password you have not used elsewhere."
                : verify
                  ? "Confirm that this email address belongs to you."
                  : register
                    ? "Start with a private workspace and a few example requests."
                    : "Use your email address and password to continue."}
          </p>
          {message ? (
            <>
              <div className="success-box" role="status">
                <ShieldCheck size={18} />
                {message}
              </div>
              <Link href="/dashboard" className="button primary">
                {verify ? "Go to workspace" : "Back to sign in"}
                <ArrowRight size={16} />
              </Link>
            </>
          ) : (
            <>
              {normal && register && (
                <Field label="Your name">
                  <input
                    required
                    name="name"
                    autoComplete="name"
                    maxLength={100}
                    placeholder="Your name"
                  />
                </Field>
              )}
              {!verify && (
                <Field label="Email address">
                  <input
                    key={reset ? parameters.get("email") || "email" : "email"}
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    defaultValue={reset ? parameters.get("email") || "" : ""}
                    readOnly={reset && !!parameters.get("email")}
                    placeholder="you@company.com"
                  />
                </Field>
              )}
              {!recovery && !verify && (
                <Field
                  label={reset ? "New password" : "Password"}
                  hint={
                    register || reset
                      ? "10–72 characters, including letters and numbers."
                      : undefined
                  }
                >
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={register || reset ? 10 : undefined}
                    maxLength={72}
                    autoComplete={
                      register || reset ? "new-password" : "current-password"
                    }
                  />
                </Field>
              )}
              {((normal && register) || reset) && (
                <Field label="Confirm password">
                  <input
                    name="password_confirmation"
                    type="password"
                    required
                    maxLength={72}
                    autoComplete="new-password"
                  />
                </Field>
              )}
              {error && (
                <p className="error-box" role="alert">
                  {error}
                </p>
              )}
              {(reset || verify) && !parameters.get("token") && (
                <p className="muted small">
                  Open the complete link from your email to continue.
                </p>
              )}
              <Button
                disabled={
                  busy || ((reset || verify) && !parameters.get("token"))
                }
              >
                {busy
                  ? "Please wait…"
                  : recovery
                    ? "Send reset link"
                    : reset
                      ? "Update password"
                      : verify
                        ? "Verify email address"
                        : register
                          ? "Create account"
                          : "Sign in"}
                <ArrowRight size={16} />
              </Button>
              {normal && (
                <>
                  {!register && (
                    <Link href="/forgot-password" className="forgot-link">
                      Forgot password?
                    </Link>
                  )}
                  <p className="auth-switch">
                    {register ? "Already have an account?" : "New here?"}
                    <button
                      type="button"
                      onClick={() => {
                        setRegister(!register);
                        setError("");
                      }}
                    >
                      {register ? "Sign in" : "Create an account"}
                    </button>
                  </p>
                </>
              )}
              {!normal && (
                <Link href="/dashboard" className="forgot-link">
                  Back to sign in
                </Link>
              )}
            </>
          )}
          <div className="secure-note">
            <LockKeyhole size={14} /> Your workspace stays private.
          </div>
        </form>
      </div>
    </main>
  );
}

type Session = {
  id: number;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  current: boolean;
};
type OutboxMail = {
  id: string;
  subject: string;
  to: string[];
  text: string;
  created_at: string;
};
export function AccountSettings(p: ModuleProps) {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("auth/me"),
  });
  const sessions = useQuery({
    queryKey: ["account-sessions"],
    queryFn: () => api<Session[]>("auth/sessions"),
  });
  const [inbox, setInbox] = useState(false);
  const mail = useQuery({
    queryKey: [p.base, "dev-mail"],
    queryFn: () => api<OutboxMail[]>("dev/mail"),
    enabled: inbox && !!me.data?.local_mail_preview,
  });
  const [selected, setSelected] = useState<OutboxMail | null>(null);
  async function update(work: () => Promise<unknown>, message: string) {
    const result = await p.act(work, message);
    if (result) {
      await client.invalidateQueries({ queryKey: ["me"] });
      await client.invalidateQueries({ queryKey: ["account-sessions"] });
    }
    return result;
  }
  if (!me.data) return null;
  const user = me.data;
  return (
    <>
      <div className="section-heading">
        <h2>Account & security</h2>
        <p>Manage your profile, password and signed-in sessions.</p>
      </div>
      <div className="settings-grid account-grid">
        <Panel className="settings-card">
          <h2>Your profile</h2>
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void update(
                () => api("auth/profile", "PATCH", { name: form.get("name") }),
                "Profile updated.",
              );
            }}
          >
            <Field label="Display name">
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={user.name}
              />
            </Field>
            <Field label="Account email">
              <input value={user.email} readOnly type="email" />
            </Field>
            <div className="verification-row">
              <Badge tone={user.email_verified_at ? "mint" : "amber"}>
                {user.email_verified_at
                  ? "Email verified"
                  : "Email not verified"}
              </Badge>
              {!user.email_verified_at && (
                <Button
                  variant="secondary"
                  type="button"
                  disabled={p.busy}
                  onClick={() =>
                    p.act(
                      () => api("auth/verification-email", "POST"),
                      "Verification email queued.",
                    )
                  }
                >
                  Send verification email
                </Button>
              )}
            </div>
            <Button disabled={p.busy}>Save profile</Button>
          </form>
        </Panel>
        <Panel className="settings-card">
          <h2>Change password</h2>
          <form
            className="stack-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const element = event.currentTarget;
              const form = new FormData(element);
              const result = await update(
                () => api("auth/password", "PUT", Object.fromEntries(form)),
                "Password changed. Other sessions were signed out.",
              );
              if (result) element.reset();
            }}
          >
            <Field label="Current password">
              <input
                name="current_password"
                required
                type="password"
                autoComplete="current-password"
                maxLength={72}
              />
            </Field>
            <Field label="New password">
              <input
                name="password"
                required
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={72}
              />
            </Field>
            <Field label="Confirm new password">
              <input
                name="password_confirmation"
                required
                type="password"
                autoComplete="new-password"
                maxLength={72}
              />
            </Field>
            <Button disabled={p.busy}>Change password</Button>
          </form>
        </Panel>
      </div>
      <Panel className="sessions-panel">
        <div className="panel-heading">
          <div>
            <h2>Active sessions</h2>
            <p>
              Sessions expire after 12 hours. Revoke any session you no longer
              use.
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={p.busy}
            onClick={async () => {
              await api("auth/logout-all", "POST");
              client.clear();
              window.dispatchEvent(new Event("apiforge:clear-drafts"));
              location.assign("/dashboard");
            }}
          >
            Sign out everywhere
          </Button>
        </div>
        {sessions.data?.map((session) => (
          <div className="simple-row" key={session.id}>
            <ShieldCheck size={17} />
            <div>
              <strong>Session #{session.id}</strong>
              <small>
                Created {when(session.created_at)} · Last used{" "}
                {when(session.last_used_at)}
              </small>
            </div>
            {session.current ? (
              <Badge tone="mint">This session</Badge>
            ) : (
              <Button
                variant="secondary"
                disabled={p.busy}
                onClick={() =>
                  update(
                    () => api(`auth/sessions/${session.id}`, "DELETE"),
                    "Session revoked.",
                  )
                }
              >
                Revoke
              </Button>
            )}
          </div>
        ))}
      </Panel>
      {user.local_mail_preview && (
        <Panel className="local-inbox">
          <div className="panel-heading">
            <div>
              <h2>
                <Mail size={16} /> Development inbox
              </h2>
              <p>
                Private previews of locally captured emails. This inbox is
                disabled in production.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setInbox(true);
                void mail.refetch();
              }}
            >
              <RefreshCw size={14} />
              {inbox ? "Refresh inbox" : "Open inbox"}
            </Button>
          </div>
          {inbox &&
            (mail.isPending ? (
              <Loading />
            ) : mail.error ? (
              <p className="error-box">{mail.error.message}</p>
            ) : mail.data?.length ? (
              mail.data.map((message) => (
                <button
                  key={message.id}
                  className="mail-item"
                  onClick={() => setSelected(message)}
                >
                  <span>
                    <strong>{message.subject}</strong>
                    <small>To {message.to.join(", ")}</small>
                  </span>
                  <small>{when(message.created_at)}</small>
                </button>
              ))
            ) : (
              <p className="muted pad">
                No email has been captured yet. Request a verification email or
                password reset to test delivery.
              </p>
            ))}
        </Panel>
      )}
      {selected && (
        <Dialog title={selected.subject} close={() => setSelected(null)}>
          <p className="muted small">
            To: {selected.to.join(", ")} · {when(selected.created_at)}
          </p>
          <pre className="mail-content">{selected.text}</pre>
          <div className="mail-actions">
            {Array.from(
              new Set(selected.text.match(/https?:\/\/[^\s<>"')]+/g) || []),
            )
              .filter((value) => {
                try {
                  const url = new URL(value);
                  return (
                    url.origin === location.origin &&
                    ["/verify-email", "/reset-password", "/settings"].includes(
                      url.pathname,
                    )
                  );
                } catch {
                  return false;
                }
              })
              .map((url) => (
                <a
                  key={url}
                  className="button secondary"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open email link <ArrowRight size={14} />
                </a>
              ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
