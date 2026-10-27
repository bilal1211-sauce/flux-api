"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Blocks,
  Braces,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FileClock,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Users,
  X,
  Waypoints,
} from "lucide-react";
import { api, apiPage, apiPages, ApiError } from "@/lib/api";
import type {
  ApiRequest,
  Collection,
  Environment,
  Folder,
  Monitor,
  Summary,
  User,
  Workspace,
} from "@/lib/types";
import { Badge, Button, Dialog, Loading } from "./ui";
import {
  Overview,
  History,
  Monitoring,
  Environments,
  Collections,
  Reports,
  Settings,
  AuditLog,
  Alerts,
  Admin,
} from "./modules";
import { Studio } from "./studio";
import { Analytics } from "./analytics";
import { Auth } from "./account";
import { clearDrafts } from "@/lib/drafts";
import type {
  HistoryRouteFilters,
  IncidentRouteFilters,
} from "@/lib/route-state";

const navigation = [
  {
    group: "WORKSPACE",
    items: [
      ["dashboard", "Overview", LayoutDashboard],
      ["studio", "API Studio", Braces],
      ["collections", "Collections", FolderOpen],
      ["environments", "Environments", Blocks],
    ],
  },
  {
    group: "RELIABILITY",
    items: [
      ["monitoring", "Monitoring", Activity],
      ["analytics", "Analytics", Gauge],
      ["history", "Run History", FileClock],
      ["alerts", "Alerts", Bell],
    ],
  },
  {
    group: "COLLABORATION",
    items: [
      ["reports", "Reports", ArrowUpRight],
      ["settings", "Team & Access", Users],
    ],
  },
  {
    group: "SYSTEM",
    items: [["audit", "Audit Trail", ShieldCheck]],
  },
] as const;
export type Action = <T>(
  work: () => Promise<T>,
  message?: string,
) => Promise<T | undefined>;
export type ModuleProps = {
  workspace: Workspace;
  base: string;
  requests: ApiRequest[];
  hasMoreStudioResources: boolean;
  loadingStudioResources: boolean;
  loadMoreStudioResources: () => void;
  collections: Collection[];
  folders: Folder[];
  environments: Environment[];
  monitors: Monitor[];
  monitorTotal: number;
  monitorSummary?: Summary["monitor_overview"];
  hasMoreMonitors: boolean;
  loadingMoreMonitors: boolean;
  loadMoreMonitors: () => void;
  act: Action;
  busy: boolean;
  canEdit: boolean;
};

export function Console({
  section,
  runId,
  outcomeFilter,
  historyFilters,
  historyPage,
  incidentFilters,
  incidentPage,
  incidentId,
}: {
  section: string;
  runId?: number;
  outcomeFilter?: "passed" | "failed";
  historyFilters?: HistoryRouteFilters;
  historyPage?: number;
  incidentFilters?: IncidentRouteFilters;
  incidentPage?: number;
  incidentId?: number;
}) {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("auth/me"),
  });
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<Workspace[]>("workspaces"),
    enabled: !!me.data,
  });
  const [selected, setSelected] = useState<number | null>(() =>
    typeof window === "undefined"
      ? null
      : Number(localStorage.getItem("apiforge-workspace")) || null,
  );
  if (me.isPending || (me.data && workspaces.isPending)) return <Loading />;
  if (me.error instanceof ApiError && me.error.status === 401) return <Auth />;
  if (me.error || workspaces.error)
    return (
      <main className="fatal">
        <h1>Unable to connect</h1>
        <p>{(me.error || workspaces.error)?.message}</p>
        <Button onClick={() => location.reload()}>Try again</Button>
      </main>
    );
  const workspace =
    workspaces.data?.find((w) => w.id === selected) || workspaces.data?.[0];
  if (!workspace || !me.data)
    return (
      <main className="fatal">
        <p>No workspace is available for this account.</p>
      </main>
    );
  return (
    <WorkspaceConsole
      key={workspace.id}
      user={me.data}
      workspace={workspace}
      workspaces={workspaces.data || []}
      section={section}
      runId={runId}
      outcomeFilter={outcomeFilter}
      historyFilters={historyFilters}
      historyPage={historyPage}
      incidentFilters={incidentFilters}
      incidentPage={incidentPage}
      incidentId={incidentId}
      select={(id) => {
        setSelected(id);
        localStorage.setItem("apiforge-workspace", String(id));
      }}
    />
  );
}

function WorkspaceConsole({
  user,
  workspace,
  workspaces,
  section,
  runId,
  outcomeFilter,
  historyFilters,
  historyPage,
  incidentFilters,
  incidentPage,
  incidentId,
  select,
}: {
  user: User;
  workspace: Workspace;
  workspaces: Workspace[];
  section: string;
  runId?: number;
  outcomeFilter?: "passed" | "failed";
  historyFilters?: HistoryRouteFilters;
  historyPage?: number;
  incidentFilters?: IncidentRouteFilters;
  incidentPage?: number;
  incidentId?: number;
  select: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [periodDays, setPeriodDays] = useState(7);
  const [analyticsEndpoint, setAnalyticsEndpoint] = useState("");
  const [analyticsSource, setAnalyticsSource] = useState("");
  const [analyticsMode, setAnalyticsMode] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const base = `workspaces/${workspace.id}`;
  const connection = useQuery({
    queryKey: ["api-health"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/gateway/health", {
        cache: "no-store",
        signal,
      });
      const result = (await response.json().catch(() => null)) as {
        data?: { service?: string; status?: string };
      } | null;
      if (
        !response.ok ||
        result?.data?.service !== "APIForge API" ||
        result.data.status !== "ok"
      ) {
        throw new Error("The API is unavailable.");
      }
      return true;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const resourceNeeds = {
    collections: ["studio", "collections"].includes(section),
    folders: ["studio", "collections"].includes(section),
    requests: section === "monitoring" || search !== null,
    environments: ["studio", "environments", "monitoring"].includes(section),
    monitors: ["monitoring", "environments", "alerts"].includes(section),
  };
  const collections = useQuery({
    queryKey: [base, "collections"],
    queryFn: () => apiPages<Collection>(`${base}/collections`),
    enabled: resourceNeeds.collections && section !== "studio",
  });
  const folders = useQuery({
    queryKey: [base, "folders"],
    queryFn: () => apiPages<Folder>(`${base}/folders`),
    enabled: resourceNeeds.folders && section !== "studio",
  });
  const requests = useQuery({
    queryKey: [base, "requests"],
    queryFn: () => apiPages<ApiRequest>(`${base}/requests`),
    enabled: resourceNeeds.requests && section !== "studio",
  });
  const studioCollections = useInfiniteQuery({
    queryKey: [base, "collections", "studio"],
    queryFn: ({ pageParam }) =>
      apiPage<Collection>(`${base}/collections`, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta && lastPage.meta.current_page < lastPage.meta.last_page
        ? lastPage.meta.current_page + 1
        : undefined,
    enabled: section === "studio",
  });
  const studioFolders = useInfiniteQuery({
    queryKey: [base, "folders", "studio"],
    queryFn: ({ pageParam }) => apiPage<Folder>(`${base}/folders`, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta && lastPage.meta.current_page < lastPage.meta.last_page
        ? lastPage.meta.current_page + 1
        : undefined,
    enabled: section === "studio",
  });
  const studioRequests = useInfiniteQuery({
    queryKey: [base, "requests", "studio"],
    queryFn: ({ pageParam }) =>
      apiPage<ApiRequest>(`${base}/requests`, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta && lastPage.meta.current_page < lastPage.meta.last_page
        ? lastPage.meta.current_page + 1
        : undefined,
    enabled: section === "studio",
  });
  const environments = useQuery({
    queryKey: [base, "environments"],
    queryFn: () => apiPages<Environment>(`${base}/environments`),
    enabled: resourceNeeds.environments,
  });
  const monitors = useInfiniteQuery({
    queryKey: [base, "monitors"],
    queryFn: ({ pageParam }) =>
      apiPage<Monitor>(`${base}/monitors`, pageParam, 50),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta && lastPage.meta.current_page < lastPage.meta.last_page
        ? lastPage.meta.current_page + 1
        : undefined,
    enabled: resourceNeeds.monitors,
  });
  const monitorRows = monitors.data?.pages.flatMap((page) => page.data) || [];
  const monitorTotal =
    monitors.data?.pages[0]?.meta?.total ?? monitorRows.length;
  const summaryDays = section === "monitoring" ? 7 : periodDays;
  const summary = useQuery({
    queryKey: [
      base,
      "summary",
      summaryDays,
      section === "analytics" ? analyticsEndpoint : "",
      section === "analytics" ? analyticsSource : "",
      section === "analytics" ? analyticsMode : "",
    ],
    queryFn: () => {
      const params = new URLSearchParams({ days: String(summaryDays) });
      if (section === "analytics" && analyticsEndpoint.trim())
        params.set("endpoint", analyticsEndpoint.trim());
      if (section === "analytics" && analyticsSource)
        params.set("source", analyticsSource);
      if (section === "analytics" && analyticsMode)
        params.set("mode", analyticsMode);
      return api<Summary>(`${base}/summary?${params}`);
    },
    refetchInterval: section === "dashboard" ? 60_000 : false,
  });
  useEffect(() => {
    const invalidate = (queryKey: (string | number)[]) => {
      void qc.invalidateQueries({ queryKey });
    };
    const onMutation = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; method: string }>)
        .detail;
      const path = detail?.path?.split("?")[0] || "";
      if (path === "admin" || path.startsWith("admin/")) {
        invalidate([base, "admin"]);
        return;
      }
      if (!path.startsWith(`${base}/`)) return;
      const endpoint = path.slice(base.length + 1).split("/");
      const resource = endpoint[0];
      if (
        resource === "execute" ||
        (resource === "runs" &&
          (endpoint[1] === "local" || endpoint.length === 1)) ||
        (resource === "monitors" && endpoint[2] === "check")
      ) {
        invalidate([base, "summary"]);
        invalidate([base, "runs"]);
        invalidate([base, "alerts"]);
        invalidate([base, "alert-deliveries"]);
        invalidate([base, "monitors"]);
      } else if (
        [
          "collections",
          "folders",
          "requests",
          "environments",
          "monitors",
        ].includes(resource)
      ) {
        invalidate([base, resource]);
        if (
          ["collections", "folders", "requests", "monitors"].includes(resource)
        )
          invalidate([base, "summary"]);
      } else if (resource === "alerts") {
        invalidate([base, "alerts"]);
        invalidate([base, "summary"]);
      } else if (resource === "shares") {
        invalidate([base, "shares"]);
        invalidate([base, "share-overview"]);
      } else if (resource === "members" || resource === "invitations") {
        invalidate([base, "members"]);
      } else if (resource === "preferences") {
        invalidate(["workspaces"]);
      }
      if (detail.method !== "GET") invalidate([base, "audit"]);
    };
    window.addEventListener("apiforge:mutation", onMutation);
    return () => window.removeEventListener("apiforge:mutation", onMutation);
  }, [base, qc]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearch((s) => (s === null ? "" : null));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const media = window.matchMedia(
      "(min-width: 761px) and (max-width: 1100px)",
    );
    const update = () => {
      const stored = localStorage.getItem("workspace-shell-sidebar-collapsed");
      setCollapsed(stored === null ? media.matches : stored === "true");
    };
    const frame = window.requestAnimationFrame(update);
    media.addEventListener("change", update);
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 760px)");
    const closeDrawerOnDesktop = () => {
      if (!mobile.matches) setMenu(false);
    };
    mobile.addEventListener("change", closeDrawerOnDesktop);
    return () => mobile.removeEventListener("change", closeDrawerOnDesktop);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const applySystemTheme = () => {
      if (localStorage.getItem("apiforge-theme")) return;
      const next = media.matches ? "light" : "dark";
      document.documentElement.dataset.theme = next;
    };
    media.addEventListener("change", applySystemTheme);
    return () => media.removeEventListener("change", applySystemTheme);
  }, []);
  useEffect(() => {
    if (!menu || !window.matchMedia("(max-width: 760px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      sidebarRef.current
        ?.querySelector<HTMLElement>("a[href], button:not(:disabled), select")
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileNavigation();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), select, [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);
  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node))
        setAccountOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const act: Action = async (work, message) => {
    setBusy(true);
    try {
      const result = await work();
      if (message) setToast({ text: message, error: false });
      return result;
    } catch (e) {
      setToast({ text: (e as Error).message, error: true });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const hasMoreStudioResources = !!(
    studioCollections.hasNextPage ||
    studioFolders.hasNextPage ||
    studioRequests.hasNextPage
  );
  const loadingStudioResources =
    studioCollections.isFetchingNextPage ||
    studioFolders.isFetchingNextPage ||
    studioRequests.isFetchingNextPage;
  function loadMoreStudioResources() {
    void Promise.all([
      studioCollections.hasNextPage
        ? studioCollections.fetchNextPage()
        : Promise.resolve(),
      studioFolders.hasNextPage
        ? studioFolders.fetchNextPage()
        : Promise.resolve(),
      studioRequests.hasNextPage
        ? studioRequests.fetchNextPage()
        : Promise.resolve(),
    ]);
  }
  function loadMoreMonitors() {
    if (monitors.hasNextPage && !monitors.isFetchingNextPage)
      void monitors.fetchNextPage();
  }
  const props: ModuleProps = {
    workspace,
    base,
    requests:
      section === "studio"
        ? studioRequests.data?.pages.flatMap((page) => page.data) || []
        : requests.data || [],
    collections:
      section === "studio"
        ? studioCollections.data?.pages.flatMap((page) => page.data) || []
        : collections.data || [],
    folders:
      section === "studio"
        ? studioFolders.data?.pages.flatMap((page) => page.data) || []
        : folders.data || [],
    hasMoreStudioResources,
    loadingStudioResources,
    loadMoreStudioResources,
    environments: environments.data || [],
    monitors: monitorRows,
    monitorTotal,
    monitorSummary: summary.data?.monitor_overview,
    hasMoreMonitors: monitors.hasNextPage,
    loadingMoreMonitors: monitors.isFetchingNextPage,
    loadMoreMonitors,
    act,
    busy,
    canEdit: workspace.role !== "viewer",
  };
  const loading =
    section === "studio"
      ? studioCollections.isPending ||
        studioFolders.isPending ||
        studioRequests.isPending
      : (resourceNeeds.collections && collections.isPending) ||
        (resourceNeeds.folders && folders.isPending) ||
        (resourceNeeds.requests && requests.isPending) ||
        (resourceNeeds.environments && environments.isPending) ||
        (resourceNeeds.monitors && monitors.isPending);
  const error =
    (section === "studio"
      ? [studioCollections.error, studioFolders.error, studioRequests.error]
      : [
          resourceNeeds.collections ? collections.error : null,
          resourceNeeds.folders ? folders.error : null,
          resourceNeeds.requests ? requests.error : null,
          resourceNeeds.environments ? environments.error : null,
          resourceNeeds.monitors ? monitors.error : null,
        ]
    ).find(Boolean) || (section !== "dashboard" ? summary.error : null);
  const title =
    navigation
      .flatMap((g) => [...g.items])
      .find((i) => i[0] === section)?.[1] ||
    (section === "admin" ? "Admin Console" : "Workspace");
  const openRequest = (id: number) => {
    sessionStorage.setItem("apiforge-open-request", String(id));
  };
  function theme() {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("apiforge-theme", next);
  }
  function closeMobileNavigation() {
    setMenu(false);
    window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
  }
  function openMobileNavigation() {
    menuTriggerRef.current?.blur();
    setMenu(true);
  }
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("workspace-shell-sidebar-collapsed", String(next));
  }
  async function signOut() {
    try {
      await api("auth/logout", "POST");
      clearDrafts();
      qc.clear();
      location.assign("/");
    } catch (error) {
      setToast({ text: (error as Error).message, error: true });
      setAccountOpen(false);
    }
  }
  const connectionState = connection.isPending
    ? "checking"
    : connection.isError
      ? "offline"
      : "online";
  return (
    <div className="app-shell">
      {menu && (
        <button
          aria-label="Close navigation"
          className="sidebar-scrim"
          onClick={closeMobileNavigation}
        />
      )}
      <aside
        ref={sidebarRef}
        id="primary-navigation-drawer"
        className={`sidebar ${menu ? "open" : ""} ${collapsed ? "collapsed" : "sidebar-expanded"}`}
        aria-label="Primary navigation"
        role={menu ? "dialog" : undefined}
        aria-modal={menu || undefined}
      >
        <div className="brand-row">
          <Link href="/dashboard" className="brand" aria-label="FluxAPI home">
            <span className="brand-mark">
              <Waypoints size={20} strokeWidth={2.2} />
            </span>
            <span className="brand-name">FluxAPI</span>
          </Link>
          <button
            className="icon-button sidebar-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleSidebar}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={closeMobileNavigation}
          >
            <X size={18} />
          </button>
        </div>
        <label className="workspace-select">
          <span className="workspace-avatar">
            {workspace.name[0].toUpperCase()}
          </span>
          <span>
            <small>WORKSPACE</small>
            <select
              aria-label="Workspace"
              value={workspace.id}
              onChange={(e) => select(Number(e.target.value))}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <button
          className="search-trigger"
          aria-label="Search workspace requests"
          title="Search workspace requests"
          onClick={() => setSearch("")}
        >
          <Search size={15} /> <span>Search requests</span> <kbd>Ctrl K</kbd>
        </button>
        <nav className="sidebar-nav" aria-label="Workspace sections">
          {navigation.map((group) => (
            <div className="nav-group" key={group.group}>
              <p>{group.group}</p>
              {group.items.map(([id, label, Icon]) => (
                <Link
                  key={id}
                  href={`/${id}`}
                  className={`nav-link ${section === id ? "active" : ""}`}
                  aria-label={label}
                  title={collapsed ? label : undefined}
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => menu && closeMobileNavigation()}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  {id === "alerts" && !!summary.data?.open_alerts && (
                    <span className="nav-count">
                      {summary.data.open_alerts}
                    </span>
                  )}
                  {id === "studio" && <span className="nav-new">NEW</span>}
                </Link>
              ))}
              {group.group === "SYSTEM" && user.is_admin && (
                <Link
                  className={`nav-link ${section === "admin" ? "active" : ""}`}
                  href="/admin"
                  aria-label="Admin Console"
                  title={collapsed ? "Admin Console" : undefined}
                  aria-current={section === "admin" ? "page" : undefined}
                  onClick={() => menu && closeMobileNavigation()}
                >
                  <Settings2 size={18} /> <span>Admin Console</span>
                </Link>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div
            className="plan-card"
            title={`${summary.data?.usage_today ?? 0} of ${workspace.daily_run_limit.toLocaleString()} runs used today`}
          >
            <div>
              <span className="plan-dot" /> Workspace usage <Badge>DAILY</Badge>
            </div>
            <p>
              {summary.data?.usage_today ?? 0}{" "}
              <span>/ {workspace.daily_run_limit.toLocaleString()} runs</span>
            </p>
            <progress
              aria-label={`Daily execution quota: ${summary.data?.usage_today ?? 0} of ${workspace.daily_run_limit} runs`}
              max={workspace.daily_run_limit}
              value={summary.data?.usage_today ?? 0}
            />
          </div>
          <button
            className="help-link"
            title="Quick start"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={17} /> <span>Quick start</span>{" "}
            <ExternalLink size={12} />
          </button>
          <div className="profile">
            <span className="avatar">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>{workspace.role}</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={menu} aria-hidden={menu || undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              ref={menuTriggerRef}
              aria-label="Open navigation"
              aria-controls="primary-navigation-drawer"
              aria-expanded={menu}
              onClick={openMobileNavigation}
            >
              <Menu size={20} />
            </button>
            <Link href="/dashboard" className="breadcrumb-brand">
              FluxAPI
            </Link>
            <ChevronRight className="workspace-separator" size={14} />
            <span className="workspace-crumb">{workspace.name}</span>
            <ChevronRight className="workspace-separator" size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="header-search"
              aria-label="Search workspace requests"
              onClick={() => setSearch("")}
            >
              <Search size={15} /> <span>Search</span> <kbd>Ctrl K</kbd>
            </button>
            <button
              className="connection"
              data-state={connectionState}
              aria-label={`API connection: ${connectionState}`}
              title={
                connectionState === "offline"
                  ? "Retry API connection"
                  : `API ${connectionState}`
              }
              onClick={() => void connection.refetch()}
            >
              <span aria-hidden="true" />
              {connectionState === "checking"
                ? "Checking API"
                : connectionState === "offline"
                  ? "API unavailable"
                  : "API online"}
            </button>
            <button
              className="icon-button theme-toggle"
              aria-label="Toggle color theme"
              title="Switch color theme"
              onClick={theme}
            >
              <Moon className="moon" size={17} />
              <Sun className="sun" size={17} />
            </button>
            <Link
              href="/alerts"
              className="icon-button notification-trigger"
              aria-label={`View alerts${summary.data?.open_alerts ? `, ${summary.data.open_alerts} open` : ""}`}
              title="View workspace alerts"
            >
              <Bell size={18} />
              {!!summary.data?.open_alerts && (
                <i className="notification-dot" />
              )}
            </Link>
            <div className="account-menu" ref={accountMenuRef}>
              <button
                ref={accountTriggerRef}
                className="account-trigger"
                aria-label="Account menu"
                aria-expanded={accountOpen}
                aria-controls="account-options"
                onClick={() => setAccountOpen((open) => !open)}
              >
                <span className="avatar small">
                  {user.name[0].toUpperCase()}
                </span>
                <span className="account-trigger-name">{user.name}</span>
                <ChevronDown size={14} />
              </button>
              {accountOpen && (
                <div
                  id="account-options"
                  className="account-popover"
                  aria-label="Account options"
                >
                  <div className="account-popover-user">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    <small>
                      {workspace.name} · {workspace.role}
                    </small>
                  </div>
                  <Link href="/settings" onClick={() => setAccountOpen(false)}>
                    <Users size={16} /> Team &amp; workspace settings
                  </Link>
                  <button onClick={() => void signOut()}>
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div role="alert" className="error-box">
              {error.message}
            </div>
          )}
          {loading ? (
            <Loading />
          ) : (
            <>
              {section === "dashboard" && (
                <Overview
                  {...props}
                  summary={summary.data}
                  analytics={false}
                  periodDays={periodDays}
                  setPeriodDays={setPeriodDays}
                  summaryLoading={summary.isPending}
                  summaryError={summary.error?.message}
                  refreshing={summary.isFetching}
                  refresh={() => void summary.refetch()}
                />
              )}
              {section === "analytics" && (
                <Analytics
                  {...props}
                  summary={summary.data}
                  periodDays={periodDays}
                  setPeriodDays={setPeriodDays}
                  endpoint={analyticsEndpoint}
                  setEndpoint={setAnalyticsEndpoint}
                  source={analyticsSource}
                  setSource={setAnalyticsSource}
                  mode={analyticsMode}
                  setMode={setAnalyticsMode}
                  loading={summary.isPending}
                  error={summary.error?.message}
                  refreshing={summary.isFetching}
                  refresh={() => void summary.refetch()}
                />
              )}
              {section === "studio" && <Studio {...props} />}
              {section === "collections" && <Collections {...props} />}
              {section === "environments" && <Environments {...props} />}
              {section === "monitoring" && (
                <Monitoring
                  {...props}
                  monitorSummary={summary.data?.monitor_overview}
                />
              )}
              {section === "history" && (
                <History
                  key={`${runId ?? "history"}-${outcomeFilter ?? "all"}-${historyPage ?? 1}-${JSON.stringify(historyFilters ?? {})}`}
                  {...props}
                  initialRunId={runId}
                  initialOutcome={outcomeFilter}
                  initialFilters={historyFilters}
                  initialPage={historyPage}
                />
              )}
              {section === "alerts" && (
                <Alerts
                  key={`${incidentId ?? "alerts"}-${incidentPage ?? 1}-${JSON.stringify(incidentFilters ?? {})}`}
                  {...props}
                  initialFilters={incidentFilters}
                  initialPage={incidentPage}
                  initialIncidentId={incidentId}
                />
              )}
              {section === "reports" && <Reports {...props} />}
              {section === "settings" && (
                <Settings
                  {...props}
                  refreshWorkspaces={() =>
                    qc.invalidateQueries({ queryKey: ["workspaces"] })
                  }
                />
              )}
              {section === "audit" && <AuditLog {...props} />}
              {section === "admin" && user.is_admin && <Admin {...props} />}
            </>
          )}
        </main>
        <footer className="footer">
          <span>
            <span className="status-dot" /> FluxAPI · API reliability, in focus.
          </span>
          <span>
            v1.0 <span className="footer-sep">/</span> Build. Test. Monitor.
            Trust.
          </span>
        </footer>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <X size={17} /> : <ShieldCheck size={17} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {search !== null && (
        <Dialog
          title={`Search ${workspace.name} requests`}
          close={() => setSearch(null)}
        >
          <input
            autoFocus
            aria-label="Search requests"
            placeholder="Search by name, URL, or method…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="search-results">
            {props.requests
              .filter((r) =>
                `${r.name} ${r.url} ${r.method}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((r) => (
                <Link
                  key={r.id}
                  href="/studio"
                  onClick={() => {
                    openRequest(r.id!);
                    setSearch(null);
                    if (section === "studio") location.assign("/studio");
                  }}
                >
                  <Badge tone="mint">{r.method}</Badge>
                  <span>
                    {r.name}
                    <small>{r.url}</small>
                  </span>
                  <ChevronRight size={15} />
                </Link>
              ))}
          </div>
        </Dialog>
      )}
      {help && (
        <Dialog title="Your first API test" close={() => setHelp(false)}>
          <ol className="help-steps">
            <li>Open a saved request from Collections.</li>
            <li>
              Select the Demo environment for <code>{"{{base_url}}"}</code>{" "}
              variables.
            </li>
            <li>Press Send or Ctrl + Enter to execute it.</li>
            <li>Inspect the response and assertion results.</li>
            <li>Add the saved request to a monitor for scheduled checks.</li>
          </ol>
          <p className="muted">
            Only operator-approved HTTPS destinations can be executed. Put
            credentials in encrypted environment variables.
          </p>
          <Link
            href="/studio"
            className="button primary"
            onClick={() => setHelp(false)}
          >
            Open Request Studio <ArrowUpRight size={16} />
          </Link>
        </Dialog>
      )}
    </div>
  );
}
