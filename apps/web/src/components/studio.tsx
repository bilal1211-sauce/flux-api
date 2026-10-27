"use client";
import dynamic from "next/dynamic";
import { json } from "@codemirror/lang-json";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Braces,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  GripVertical,
  FolderOpen,
  Globe2,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, ApiError, blankRequest } from "@/lib/api";
import type { ApiRequest, Assertion, Run, ExecutionState, Collection, Folder } from "@/lib/types";
import type { ModuleProps } from "./console";
import { Badge, Button, Dialog, Field, Panel } from "./ui";
import {
  getStudioMemory,
  rememberStudio,
  type Draft,
  type StudioMemory,
} from "@/lib/drafts";
const Editor = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="code-loading">Loading editor…</div>,
});
function useEditorTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const update = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
function draft(request: ApiRequest): Draft {
  return {
    key: `tab-${request.id || crypto.randomUUID()}`,
    request,
    headers: JSON.stringify(
      Array.isArray(request.headers) ? {} : request.headers || {},
      null,
      2,
    ),
    params: JSON.stringify(
      Array.isArray(request.query_params) ? {} : request.query_params || {},
      null,
      2,
    ),
    assertions: JSON.stringify(
      request.assertions.map(({ type, path, expected }) => ({
        type,
        ...(path ? { path } : {}),
        expected,
      })),
      null,
      2,
    ),
    dirty: false,
  };
}
function map(text: string): Record<string, string> {
  const value = JSON.parse(text);
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.values(value).some((v) => typeof v !== "string")
  )
    throw new Error(
      "Headers and parameters must be JSON objects with string values.",
    );
  return value;
}
function expand(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => {
    if (!(key in variables)) throw new Error(`Environment variable {{${key}}} has no local value.`);
    return variables[key];
  });
}
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function multipartBody(fieldsJson: string, file: File | null, fileField: string, variables?: Record<string, string>, maxBytes = 1048576) {
  const parsed = fieldsJson.trim() ? map(fieldsJson) : {};
  const form = new FormData();
  for (const [name, value] of Object.entries(parsed)) form.append(name, variables ? expand(value, variables) : value);
  if (file) form.append(fileField, file, file.name);
  const request = new Request("http://127.0.0.1/", { method: "POST", body: form });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Multipart request body exceeds ${Math.floor(maxBytes / 1024)} KiB for this execution mode.`);
  return { body_base64: encodeBytes(bytes), content_type: request.headers.get("content-type") || "multipart/form-data" };
}
function redactLocalResponse<T extends { body: string; headers: Record<string, string> }>(response: T, secrets: string[]): T {
  const redact = (value: unknown, key = ""): unknown => {
    if (/(authorization|cookie|password|token|secret|api[-_]?key)/i.test(key)) return "[REDACTED]";
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
    if (typeof value !== "string") return value;
    return secrets.filter(Boolean).sort((a, b) => b.length - a.length).reduce((text, secret) => {
      const variants = [secret, encodeURIComponent(secret), new URLSearchParams({ value: secret }).toString().slice(6)];
      return variants.reduce((next, variant) => variant ? next.split(variant).join("[REDACTED]") : next, text);
    }, value);
  };
  let body = response.body;
  try { body = JSON.stringify(redact(JSON.parse(body)), null, 2); } catch { body = String(redact(body)); }
  const headers = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !/(authorization|cookie|set-cookie|token|secret|api[-_]?key)/i.test(name)).map(([name, value]) => [name, String(redact(value))]));
  return { ...response, body, headers };
}
function evaluateLocalAssertions(assertions: Assertion[], response: { status: number | null; duration_ms: number; body: string; headers: Record<string, string> }, variables: Record<string, string>): Assertion[] {
  let json: unknown;
  try { json = JSON.parse(response.body); } catch { json = null; }
  return assertions.map((assertion) => {
    const expected = typeof assertion.expected === "string" ? expand(assertion.expected, variables) : assertion.expected;
    const path = (assertion.path || "").replace(/^\$\.?/, "");
    let actual: unknown;
    if (assertion.type === "status") actual = response.status;
    else if (assertion.type === "duration_lt") actual = response.duration_ms;
    else if (assertion.type === "body_contains") actual = response.body;
    else if (assertion.type === "header_contains") actual = response.headers[path.toLowerCase()] ?? null;
    else actual = path.split(".").filter(Boolean).reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, json);
    const passed = assertion.type === "status" ? actual === Number(expected)
      : assertion.type === "duration_lt" ? Number(actual) < Number(expected)
      : assertion.type === "json_exists" ? actual !== undefined
      : assertion.type === "json_equals" ? JSON.stringify(actual) === JSON.stringify(expected)
      : typeof actual === "string" && actual.includes(String(expected ?? ""));
    return { type: assertion.type, path: assertion.path, expected, actual: typeof actual === "string" ? actual.slice(0, 1000) : actual ?? null, passed };
  });
}
export function ResponseInspector({ run, execution }: { run: Run | null; execution?: ExecutionState }) {
  const [tab, setTab] = useState("body");
  const [bodyView, setBodyView] = useState<"pretty" | "raw">("pretty");
  const [copied, setCopied] = useState(false);
  const editorTheme = useEditorTheme();
  const rawBody = run?.response?.body ?? "No response body captured.";
  const largeResponse = rawBody.length > 1_000_000;
  const displayBody = useMemo(() => {
    if (bodyView !== "pretty" || largeResponse) return rawBody;
    try { return JSON.stringify(JSON.parse(rawBody), null, 2); } catch { return rawBody; }
  }, [bodyView, largeResponse, rawBody]);
  return (
    <Panel className="response-panel">
      <div className="response-heading">
        <div>
          <span className="response-dot" /> <strong>Response</strong>
          {!run && execution && execution.phase !== "idle" && <Badge tone={execution.phase === "running" || execution.phase === "validating" ? "cyan" : "red"}>{execution.phase.replaceAll("_", " ")}</Badge>}
          {run && (
            <Badge tone={run.outcome === "passed" ? "mint" : "red"}>
              {run.status || "Error"}{" "}
              {run.outcome === "passed" ? "OK" : "Failed"}
            </Badge>
          )}
          {run && <Badge>{run.execution_mode === "local" ? "Local" : "Cloud"}</Badge>}
        </div>
        {run && (
          <div className="response-metrics">
            <span>
              <Clock3 size={13} /> {run.duration_ms} ms
            </span>
            <span>{(run.size_bytes / 1024).toFixed(2)} KB</span>
          </div>
        )}
      </div>
      <div className="editor-tabs response-tabs">
        {["body", "headers", "assertions", "timings"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
            {t === "assertions" && run?.assertions && (
              <span>
                {run.assertions.filter((a) => a.passed).length}/
                {run.assertions.length}
              </span>
            )}
          </button>
        ))}
        {run?.response && tab === "body" && <div className="response-tools">
          <button className="copy-response" aria-label="Pretty response" aria-pressed={bodyView === "pretty"} onClick={() => setBodyView("pretty")}>Pretty</button>
          <button className="copy-response" aria-label="Raw response" aria-pressed={bodyView === "raw"} onClick={() => setBodyView("raw")}>Raw</button>
          <button className="copy-response" aria-label="Download response" onClick={() => {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([rawBody], { type: "application/octet-stream" }));
            link.download = `apiforge-response-${run.id}.txt`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          }}><Download size={14} /></button>
          <button className="copy-response" aria-label="Copy response" onClick={async () => {
            try { await navigator.clipboard.writeText(rawBody); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
          }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        </div>}
      </div>
      {!run ? (
        <div className="response-empty">
          <span>
            <Braces size={29} />
          </span>
          <h3>{execution?.phase === "validating" ? "Validating request" : execution?.phase === "running" ? "Request in progress" : execution && execution.phase !== "idle" ? "No response for this execution" : "No response yet"}</h3>
          <p>
            {execution?.message || "Send a request to inspect its response, headers, and test results."}
          </p>
          <kbd>Ctrl ↵</kbd>
        </div>
      ) : (
        <div className="response-content">
          {run.error_code && (
            <div className="error-box">
              {run.error_code.replaceAll("_", " ")}{run.status ? ` · HTTP ${run.status}` : ""}
            </div>
          )}
          {run.response?.truncated && <div className="response-truncated" role="status">Response body was truncated by the execution service. The displayed body contains the captured portion.</div>}
          {tab === "body" && (
            largeResponse ? <pre className="large-response-body">{displayBody}</pre> : <Editor
              value={displayBody}
              extensions={[json()]}
              readOnly
              theme={editorTheme}
              minHeight="240px"
              maxHeight="500px"
              basicSetup={{ foldGutter: true, highlightActiveLine: false }}
            />
          )}
          {tab === "headers" && (
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>Header</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(run.response?.headers || {}).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k}</td>
                      <td className="mono break">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "assertions" && (
            <div className="assertion-results">
              {!run.assertions?.length && (
                <p className="muted">
                  No assertions were configured for this run.
                </p>
              )}
              {run.assertions?.map((a, i) => (
                <div key={i}>
                  <Badge tone={a.passed ? "mint" : "red"}>
                    {a.passed ? "PASS" : "FAIL"}
                  </Badge>
                  <span>
                    <strong>
                      {a.type}
                      {a.path ? ` · ${a.path}` : ""}
                    </strong>
                    <small>
                      Expected {JSON.stringify(a.expected)} · Actual{" "}
                      {JSON.stringify(a.actual)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
          {tab === "timings" && <div className="timing-results">
            {[["DNS lookup", run.timings?.dns_ms], ["Connection", run.timings?.connect_ms], ["TLS handshake", run.timings?.tls_ms], ["First byte", run.timings?.first_byte_ms], ["Total time", run.duration_ms]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value === null || value === undefined ? "—" : `${value} ms`}</strong></div>)}
            <p>{run.execution_mode === "local" ? "Timing is measured by the local companion on this device." : "The cloud executor reports total duration for this run."}</p>
          </div>}
        </div>
      )}
    </Panel>
  );
}

function RequestTree({ collections, folders, requests, openRequest, activeRequestId, duplicateRequest, manageRequest, deleteRequest, closeExplorer, canEdit, hasMoreResources, loadingMoreResources, loadMoreResources }: {
  collections: Collection[];
  folders: Folder[];
  requests: ApiRequest[];
  openRequest: (request: ApiRequest) => void;
  activeRequestId?: number;
  duplicateRequest: (request: ApiRequest) => void;
  manageRequest: (request: ApiRequest) => void;
  deleteRequest: (request: ApiRequest) => void;
  closeExplorer: () => void;
  canEdit: boolean;
  hasMoreResources: boolean;
  loadingMoreResources: boolean;
  loadMoreResources: () => void;
}) {
  const [search, setSearch] = useState("");
  const [menuId, setMenuId] = useState<number | null>(null);
  const needle = search.trim().toLowerCase();
  const collectionMatches = new Set(collections.filter((collection) => collection.name.toLowerCase().includes(needle)).map((collection) => collection.id));
  const folderMatches = new Set(folders.filter((folder) => folder.name.toLowerCase().includes(needle)).map((folder) => folder.id));
  function matchesFolderOrParent(folderId: number | null) {
    let current = folderId;
    while (current) {
      if (folderMatches.has(current)) return true;
      current = folders.find((folder) => folder.id === current)?.parent_id || null;
    }
    return false;
  }
  const visible = requests.filter((request) => !needle || `${request.name} ${request.url} ${request.method}`.toLowerCase().includes(needle) || collectionMatches.has(request.collection_id || -1) || matchesFolderOrParent(request.folder_id));
  const folderHasVisible = (folder: Folder): boolean => {
    if (!needle || folderMatches.has(folder.id) || visible.some((request) => request.folder_id === folder.id)) return true;
    return folders.filter((child) => child.parent_id === folder.id).some(folderHasVisible);
  };
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuId(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const requestItem = (request: ApiRequest) => <div key={request.id} className={`studio-tree-row${request.id === activeRequestId ? " active" : ""}`}><button type="button" className="studio-tree-request" aria-current={request.id === activeRequestId ? "page" : undefined} onClick={() => { setMenuId(null); openRequest(request); }}>
    <span className={`method-text ${request.method.toLowerCase()}`}>{request.method}</span>
    <span title={request.name}>{request.name}</span>
    {request.pinned && <span className="studio-tree-pin" aria-label="Pinned">★</span>}
  </button><div className="studio-tree-menu-wrap"><button type="button" className="studio-tree-menu-trigger" aria-label={`Actions for ${request.name}`} aria-haspopup="menu" aria-expanded={menuId === request.id} onClick={() => setMenuId((id) => id === request.id ? null : (request.id ?? -1))}><MoreHorizontal size={15} /></button>{menuId === request.id && <div className="studio-tree-menu" role="menu" aria-label={`${request.name} actions`}><button role="menuitem" onClick={() => { setMenuId(null); openRequest(request); }}>Open request</button><button role="menuitem" disabled={!canEdit} onClick={() => { setMenuId(null); duplicateRequest(request); }}>Duplicate request</button><button role="menuitem" disabled={!canEdit} onClick={() => { setMenuId(null); manageRequest(request); }}>Rename or move</button><button role="menuitem" className="danger" disabled={!canEdit} onClick={() => { setMenuId(null); deleteRequest(request); }}>Delete request</button></div>}</div></div>;
  const renderFolder = (folder: Folder): React.ReactNode => {
    if (!folderHasVisible(folder)) return null;
    const children = folders.filter((item) => item.parent_id === folder.id);
    const items = visible.filter((request) => request.folder_id === folder.id);
    return <details className="studio-tree-folder" key={folder.id} open={!!needle}>
      <summary>{folder.name}</summary>
      <div>{items.map(requestItem)}{children.map(renderFolder)}</div>
    </details>;
  };
  return <Panel className="studio-collections-panel">
    <div className="panel-title"><FolderOpen size={17} /><h3>Request explorer</h3><span title={hasMoreResources ? `${requests.length} loaded; more available` : `${requests.length} requests`}><Badge>{requests.length}{hasMoreResources ? "+" : ""}</Badge></span><button type="button" className="studio-drawer-close" aria-label="Close collection explorer" onClick={closeExplorer}><X size={16} /></button></div>
    <input aria-label="Search collection requests" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter requests…" />
    <div className="studio-collection-tree">
      {requests.some((request) => request.pinned && visible.includes(request)) && <section className="studio-pinned-requests"><h4>Pinned</h4>{requests.filter((request) => request.pinned && visible.includes(request)).map(requestItem)}</section>}
      {collections.map((collection) => {
        const collectionFolders = folders.filter((folder) => folder.collection_id === collection.id && !folder.parent_id);
        const collectionRequests = visible.filter((request) => request.collection_id === collection.id);
        const hasMatch = collectionRequests.some((request) => !request.folder_id) || collectionFolders.some(folderHasVisible);
        if (needle && !hasMatch) return null;
        return <details key={collection.id} className="studio-tree-collection" open>
          <summary><span>{collection.name}</span><small>{collectionRequests.length}</small></summary>
          <div>{collectionRequests.filter((request) => !request.folder_id).map(requestItem)}{collectionFolders.map(renderFolder)}</div>
        </details>;
      })}
      {!collections.length && <p className="muted small">Create a collection to organize saved requests.</p>}
      {collections.length > 0 && !visible.length && <p className="muted small">No requests match this filter.</p>}
      {hasMoreResources && <button type="button" className="studio-load-more" onClick={loadMoreResources} disabled={loadingMoreResources}>{loadingMoreResources ? <><LoaderCircle size={14} className="studio-spinner" /> Loading next page…</> : <><Plus size={14} /> Load more workspace items</>}</button>}
    </div>
  </Panel>;
}

export function Studio(props: ModuleProps) {
  const {
    requests,
    collections,
    folders,
    environments,
    hasMoreStudioResources,
    loadingStudioResources,
    loadMoreStudioResources,
    base,
    act,
    busy,
    canEdit,
  } = props;
  const editorTheme = useEditorTheme();
  const [initial] = useState<StudioMemory>(() => {
    const id =
      typeof window !== "undefined"
        ? Number(sessionStorage.getItem("apiforge-open-request"))
        : 0;
    const requestedEnvironment =
      typeof window !== "undefined"
        ? Number(sessionStorage.getItem("apiforge-environment-" + base)) || 0
        : 0;
    if (typeof window !== "undefined")
      sessionStorage.removeItem("apiforge-environment-" + base);
    const request = requests.find((item) => item.id === id);
    const opened = request?.id || null;
    const previous = getStudioMemory(base);
    if (previous && previous.opened === opened)
      return requestedEnvironment
        ? { ...previous, environmentId: requestedEnvironment }
        : previous;
    if (previous) {
      const existing = request
        ? previous.tabs.findIndex((tab) => tab.request.id === request.id)
        : -1;
      if (existing >= 0)
        return {
          ...previous,
          active: existing,
          opened,
          environmentId: requestedEnvironment || previous.environmentId,
        };
      return {
        ...previous,
        tabs: [...previous.tabs, draft(request || blankRequest())],
        active: previous.tabs.length,
        opened,
        environmentId: requestedEnvironment || previous.environmentId,
      };
    }
    return {
      tabs: [draft(request || blankRequest())],
      active: 0,
      tab: "params",
      environmentId: requestedEnvironment || environments[0]?.id || 0,
      responses: {},
      opened,
    };
  });
  const [requestedRequestId] = useState(() => {
    const requested = typeof window === "undefined"
      ? 0
      : Number(new URLSearchParams(window.location.search).get("request"));
    return Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  });
  const [routeRequest, setRouteRequest] = useState<ApiRequest | null>(null);
  const [tabs, setTabs] = useState<Draft[]>(initial.tabs);
  const [active, setActive] = useState(initial.active);
  const [tab, setTab] = useState(initial.tab);
  const [environmentId, setEnvironmentId] = useState(initial.environmentId);
  const [responses, setResponses] = useState(initial.responses);
  const [executions, setExecutions] = useState<Record<string, ExecutionState>>({});
  const controllers = useRef<Record<string, AbortController>>({});
  const [executionMode, setExecutionMode] = useState<"cloud" | "local">("cloud");
  const [companionToken, setCompanionToken] = useState("");
  const [companionConnected, setCompanionConnected] = useState(false);
  const [companionBusy, setCompanionBusy] = useState(false);
  const [companionMessage, setCompanionMessage] = useState("");
  const [uiOrigin, setUiOrigin] = useState("http://127.0.0.1:3000");
  const [pendingLocal, setPendingLocal] = useState<{ data: ApiRequest; keys: string[]; key: string; id: string } | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [uploadFiles, setUploadFiles] = useState<Record<string, File | null>>({});
  const [uploadFields, setUploadFields] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState<number | null>(null);
  const [contextOpen, setContextOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [compactLayout, setCompactLayout] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(252);
  const [contextWidth, setContextWidth] = useState(276);
  const [editorHeight, setEditorHeight] = useState(560);
  const [deleteTarget, setDeleteTarget] = useState<ApiRequest | null>(null);
  const [focusRequestName, setFocusRequestName] = useState(false);
  const [editorMessage, setEditorMessage] = useState("");
  const resizeState = useRef<{ panel: "explorer" | "context" | "editor"; x: number; y: number; value: number } | null>(null);
  const current = tabs[active];
  const selectedFile = uploadFiles[current.key] || null;
  const selectedFileField = uploadFields[current.key] || "file";
  const response = responses[current.key] || null;
  const execution = executions[current.key];
  const sending = execution?.phase === "running" || execution?.phase === "validating";
  const anySending = Object.values(executions).some((item) => item.phase === "running" || item.phase === "validating");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1180px)");
    const update = () => {
      setCompactLayout(media.matches);
      if (media.matches) { setContextOpen(false); setExplorerOpen(false); }
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!compactLayout) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setExplorerOpen(false); setContextOpen(false); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [compactLayout]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = resizeState.current;
      if (!drag) return;
      if (drag.panel === "explorer") setExplorerWidth(Math.max(190, Math.min(360, drag.value + event.clientX - drag.x)));
      if (drag.panel === "context") setContextWidth(Math.max(220, Math.min(380, drag.value + drag.x - event.clientX)));
      if (drag.panel === "editor") setEditorHeight(Math.max(420, Math.min(820, drag.value + event.clientY - drag.y)));
    };
    const finish = () => { resizeState.current = null; document.body.classList.remove("studio-resizing"); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
  }, []);
  useEffect(() => {
    if (!focusRequestName) return;
    document.querySelector<HTMLInputElement>('[aria-label="Request name"]')?.focus();
    setFocusRequestName(false);
  }, [active, focusRequestName]);
  useEffect(() => {
    rememberStudio(base, {
      tabs,
      active,
      tab,
      environmentId,
      responses,
      opened: initial.opened,
    });
  }, [base, tabs, active, tab, environmentId, responses, initial.opened]);
  useEffect(() => {
    if (!requestedRequestId) return;
    let cancelled = false;
    void api<ApiRequest>(`${base}/requests/${requestedRequestId}`)
      .then((request) => {
        if (!cancelled) setRouteRequest(request);
      })
      .catch((error) => {
        if (!cancelled) setEditorMessage((error as Error).message || "This saved request is unavailable in the selected workspace.");
      });
    return () => { cancelled = true; };
  }, [base, requestedRequestId]);
  useEffect(() => {
    if (!routeRequest?.id) return;
    const index = tabs.findIndex((item) => item.request.id === routeRequest.id);
    if (index >= 0) {
      setActive(index);
      return;
    }
    setTabs((currentTabs) => currentTabs.some((item) => item.request.id === routeRequest.id)
      ? currentTabs
      : [...currentTabs, draft(routeRequest)]);
  }, [routeRequest, tabs]);
  useEffect(() => { setUiOrigin(window.location.origin); }, []);
  function closeTab(index: number) {
    const removedKey = tabs[index]?.key;
    if (removedKey) {
      controllers.current[removedKey]?.abort();
      delete controllers.current[removedKey];
      setResponses((previous) => { const next = { ...previous }; delete next[removedKey]; return next; });
      setExecutions((previous) => { const next = { ...previous }; delete next[removedKey]; return next; });
    }
    setTabs((all) => all.filter((_, position) => position !== index));
    setActive((position) =>
      Math.max(0, position - (index <= position ? 1 : 0)),
    );
    setClosing(null);
  }
  function openSavedRequest(request: ApiRequest) {
    const existing = tabs.findIndex((tab) => tab.request.id === request.id);
    if (existing >= 0) {
      setActive(existing);
      return;
    }
    setTabs((all) => [...all, draft(request)]);
    setActive(tabs.length);
    if (compactLayout) setExplorerOpen(false);
  }
  function startResize(panel: "explorer" | "context" | "editor", event: React.PointerEvent) {
    event.preventDefault();
    const value = panel === "explorer" ? explorerWidth : panel === "context" ? contextWidth : editorHeight;
    resizeState.current = { panel, x: event.clientX, y: event.clientY, value };
    document.body.classList.add("studio-resizing");
  }
  function resizeByKeyboard(panel: "explorer" | "context" | "editor", event: React.KeyboardEvent) {
    const step = event.shiftKey ? 48 : 16;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (panel === "explorer") setExplorerWidth((width) => Math.max(190, Math.min(360, width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0))));
    if (panel === "context") setContextWidth((width) => Math.max(220, Math.min(380, width + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0))));
    if (panel === "editor") setEditorHeight((height) => Math.max(420, Math.min(820, height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0))));
  }
  function duplicateRequest(request: ApiRequest) {
    void act(() => api<ApiRequest>(`${base}/requests/${request.id}/duplicate`, "POST"), "Request duplicated.").then((copy) => { if (copy) openSavedRequest(copy); });
  }
  function manageRequest(request: ApiRequest) {
    openSavedRequest(request);
    setFocusRequestName(true);
  }
  async function confirmDeleteRequest() {
    const target = deleteTarget;
    if (!target?.id) return;
    const deleted = await act(() => api(`${base}/requests/${target.id}`, "DELETE"), "Request deleted.");
    if (deleted === undefined) return;
    setTabs((all) => all.map((item) => item.request.id === target.id ? { ...item, request: { ...item.request, id: undefined }, dirty: true } : item));
    setDeleteTarget(null);
  }
  function change(update: Partial<Draft>) {
    setTabs((all) =>
      all.map((t, i) => (i === active ? { ...t, ...update, dirty: true } : t)),
    );
  }
  function requestChange(update: Partial<ApiRequest>) {
    change({ request: { ...current.request, ...update } });
  }
  function editorContent() {
    return tab === "headers" ? current.headers : tab === "params" ? current.params : tab === "assertions" ? current.assertions : current.request.body || "";
  }
  function formatEditorContent() {
    try {
      const formatted = JSON.stringify(JSON.parse(editorContent()), null, 2);
      if (tab === "body") requestChange({ body: formatted });
      else if (tab === "headers") change({ headers: formatted });
      else if (tab === "params") change({ params: formatted });
      else change({ assertions: formatted });
      setEditorMessage("JSON formatted.");
    } catch { setEditorMessage("This editor does not contain valid JSON to format."); }
  }
  async function copyEditorContent() {
    try { await navigator.clipboard.writeText(editorContent()); setEditorMessage("Editor content copied."); }
    catch { setEditorMessage("Clipboard access is unavailable in this browser."); }
  }
  function payload(): ApiRequest {
    const assertions: Assertion[] = JSON.parse(current.assertions);
    if (!Array.isArray(assertions))
      throw new Error("Assertions must be a JSON array.");
    if (current.request.body_mode === "json" && current.request.body?.trim()) {
      try { JSON.parse(current.request.body); } catch { throw new Error("The JSON request body is invalid. Fix it before sending."); }
    }
    return {
      ...current.request,
      body: current.request.body_mode === "none" ? null : current.request.body,
      headers: map(current.headers),
      query_params: map(current.params),
      assertions,
    };
  }
  async function save() {
    const saved = await act(async () => {
      const data = payload();
      return api<ApiRequest>(
        `${base}/requests${data.id ? `/${data.id}` : ""}`,
        data.id ? "PUT" : "POST",
        data,
      );
    }, "Request saved.");
    if (saved)
      setTabs((all) =>
        all.map((t, i) => (i === active ? { ...draft(saved), key: t.key } : t)),
      );
  }
  function beginExecution(key: string) {
    const id = crypto.randomUUID();
    controllers.current[key]?.abort();
    const controller = new AbortController();
    controllers.current[key] = controller;
    setResponses((previous) => { const next = { ...previous }; delete next[key]; return next; });
    setExecutions((previous) => ({ ...previous, [key]: { id, phase: "running" } }));
    return { id, controller };
  }
  async function connectCompanion() {
    setCompanionBusy(true);
    setCompanionMessage("");
    try {
      const response = await fetch("http://127.0.0.1:8102/status", {
        headers: { Authorization: `Bearer ${companionToken}` }, cache: "no-store", credentials: "omit",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message || `Companion returned ${response.status}.`);
      setCompanionConnected(true);
      setCompanionMessage(json.data?.allow_localhost ? "Connected · localhost APIs are authorized." : "Connected · public HTTPS APIs only.");
    } catch (error) {
      setCompanionConnected(false);
      setCompanionMessage((error as Error).message || "Could not reach the local companion.");
    } finally { setCompanionBusy(false); }
  }
  async function performLocal(data: ApiRequest, localSecrets: Record<string, string>, key: string, id: string, controller: AbortController, file: File | null, fileField: string) {
    const environment = environments.find((item) => item.id === environmentId);
    const variables: Record<string, string> = {};
    for (const variable of environment?.variables || []) {
      variables[variable.key] = variable.is_secret ? localSecrets[variable.key] ?? "" : variable.value ?? "";
    }
    const sourceText = JSON.stringify(data);
    const needed = (environment?.variables || []).filter((variable) => variable.is_secret && sourceText.includes(`{{${variable.key}}}`));
    const absent = needed.filter((variable) => !variables[variable.key]);
    if (absent.length) throw new Error(`Enter local values for: ${absent.map((variable) => variable.key).join(", ")}.`);
    const request = { ...data };
    delete request.id;
    const url = new URL(expand(request.url, variables));
    for (const [name, value] of Object.entries(request.query_params)) url.searchParams.set(name, expand(value, variables));
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, expand(value, variables)]));
    const auth = request.auth_config || {};
    if (request.auth_type === "bearer") headers.Authorization = `Bearer ${expand(auth.token || "", variables)}`;
    if (request.auth_type === "basic") headers.Authorization = `Basic ${encodeBase64(`${expand(auth.username || "", variables)}:${expand(auth.password || "", variables)}`)}`;
    if (request.auth_type === "api_key") {
      const value = expand(auth.value || "", variables);
      if (auth.in === "query") url.searchParams.set(auth.key || "", value);
      else headers[auth.key || "X-API-Key"] = value;
    }
    let body = expand(request.body || "", variables);
    let body_base64: string | undefined;
    if (request.body_mode === "multipart") {
      const multipart = await multipartBody(body, file, fileField, variables, 1048576);
      body_base64 = multipart.body_base64;
      headers["Content-Type"] = multipart.content_type;
      body = "";
    }
    if (request.body_mode === "json" && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
    if (request.body_mode === "urlencoded" && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const rawResult = await fetch("http://127.0.0.1:8102/run", {
      method: "POST", headers: { Authorization: `Bearer ${companionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ execution_id: id, method: request.method, url: url.toString(), headers, body, body_base64, timeout_ms: request.timeout_ms || 15000 }),
      cache: "no-store", credentials: "omit", signal: controller.signal,
    });
    const response = await rawResult.json().catch(() => ({}));
    if (!rawResult.ok) throw new Error(response.message || `Local companion returned ${rawResult.status}.`);
    const targetResponse = response.data;
    const secrets = needed.map((variable) => variables[variable.key]);
    if (request.auth_type === "bearer") secrets.push(expand(auth.token || "", variables));
    if (request.auth_type === "basic") secrets.push(expand(auth.username || "", variables), expand(auth.password || "", variables));
    if (request.auth_type === "api_key") secrets.push(expand(auth.value || "", variables));
    const safeResponse = redactLocalResponse(targetResponse, secrets);
    const localAssertions = evaluateLocalAssertions(request.assertions, targetResponse, variables).map((result) => redactLocalResponse({ body: JSON.stringify(result), headers: {} }, secrets)).map((result) => JSON.parse(result.body) as Assertion);
    const reportRequest = {
      ...request, id: data.id, url: request.url.split("?")[0], headers: {}, query_params: {}, body: "",
      assertions: request.assertions.map(({ type, path }) => ({ type, path, expected: null })),
    };
    const report = { execution_id: id, environment_id: environmentId || null, request: reportRequest, response: safeResponse, assertion_results: localAssertions };
    const run = await api<Run>(`${base}/runs/local`, "POST", report, { signal: controller.signal });
    if (controller.signal.aborted || controllers.current[key] !== controller) return;
    setResponses((previous) => ({ ...previous, [key]: run }));
    setExecutions((previous) => ({ ...previous, [key]: { id, phase: run.error_code === "TIMEOUT" ? "timeout" : run.error_code ? "network_error" : run.outcome === "passed" ? "success" : run.status && (run.status < 200 || run.status >= 300) ? "http_error" : "assertion_error" } }));
  }
  async function send() {
    const key = current.key;
    const id = crypto.randomUUID();
    let controller: AbortController | undefined;
    setResponses((previous) => { const next = { ...previous }; delete next[key]; return next; });
    setExecutions((previous) => ({ ...previous, [key]: { id, phase: "validating", message: "Checking request configuration…" } }));
    try {
      const data = payload();
      if (executionMode === "local") {
        if (!companionConnected || !companionToken) throw new Error("Connect the local companion before running locally.");
        const used = (environments.find((item) => item.id === environmentId)?.variables || []).filter((variable) => variable.is_secret && JSON.stringify(data).includes(`{{${variable.key}}}`));
        const missing = used.filter((variable) => !secretValues[variable.key]);
        if (missing.length) { setExecutions((previous) => ({ ...previous, [key]: { id, phase: "idle", message: "Enter the requested environment secrets to continue." } })); setPendingLocal({ data, keys: missing.map((variable) => variable.key), key, id }); return; }
        controller = beginExecution(key).controller;
        await performLocal(data, secretValues, key, id, controller, selectedFile, selectedFileField);
      } else {
        controller = beginExecution(key).controller;
        let cloudPayload: ApiRequest & { execution_id: string; saved_request_id?: number; environment_id: number | null; body_base64?: string } = { ...data, execution_id: id, saved_request_id: data.id, environment_id: environmentId || null };
        if (data.body_mode === "multipart") {
          const multipart = await multipartBody(data.body || "", selectedFile, selectedFileField, undefined, 131072);
          cloudPayload = { ...cloudPayload, body_base64: multipart.body_base64, headers: { ...data.headers, "Content-Type": multipart.content_type } };
        }
        const run = await api<Run>(`${base}/execute`, "POST", cloudPayload, {signal:controller.signal});
        if (controller.signal.aborted || controllers.current[key] !== controller) return;
        setResponses(previous => ({...previous, [key]:run}));
        setExecutions(previous => ({...previous, [key]:{id, phase:run.error_code === "TIMEOUT" ? "timeout" : run.error_code ? "network_error" : run.outcome === "passed" ? "success" : run.status && (run.status < 200 || run.status >= 300) ? "http_error" : "assertion_error"}}));
      }
    } catch(error) {
      if (controller && controllers.current[key] !== controller) return;
      setCompanionMessage(executionMode === "local" ? (error as Error).message : companionMessage);
      setExecutions(previous => ({...previous, [key]: {id, phase:controller?.signal.aborted ? "cancelled" : !controller ? "validation_error" : error instanceof ApiError && [403,422].includes(error.status) ? "blocked" : "network_error", message:controller?.signal.aborted ? "Stopped waiting for this execution." : (error as Error).message}}));
    }
  }
  function cancel() {
    const id = executions[current.key]?.id;
    if (executionMode === "local" && id && companionConnected) {
      void fetch(`http://127.0.0.1:8102/executions/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${companionToken}` }, cache: "no-store", credentials: "omit" }).catch(() => controllers.current[current.key]?.abort());
      return;
    }
    controllers.current[current.key]?.abort();
  }
  async function resumeLocal() {
    if (!pendingLocal) return;
    if (pendingLocal.keys.some((key) => !secretValues[key])) {
      setCompanionMessage("Enter a value for every requested secret environment variable.");
      return;
    }
    const pending = pendingLocal;
    setPendingLocal(null);
    const { controller } = beginExecution(pending.key);
    try {
      await performLocal(pending.data, secretValues, pending.key, pending.id, controller, uploadFiles[pending.key] || null, uploadFields[pending.key] || "file");
    } catch (error) {
      if (controllers.current[pending.key] !== controller) return;
      setExecutions((previous) => ({ ...previous, [pending.key]: { id: pending.id, phase: controller.signal.aborted ? "cancelled" : "network_error", message: controller.signal.aborted ? "Stopped waiting for this execution." : (error as Error).message } }));
      setCompanionMessage((error as Error).message);
    } finally { setSecretValues({}); }
  }
  useEffect(() => {
    const activeControllers = controllers.current;
    return () => { Object.values(activeControllers).forEach(controller => controller.abort()); };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["Enter", "s"].includes(e.key)) {
        e.preventDefault();
        document
          .getElementById(e.key === "Enter" ? "send-request" : "save-request")
          ?.click();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Requests</div>
          <h1>
            Request Studio<span className="title-dot">.</span>
          </h1>
          <p>Configure a request, run it and inspect the response.</p>
        </div>
        <div className="heading-actions">
          <Button variant="secondary" aria-label={explorerOpen ? "Hide collection explorer" : "Show collection explorer"} aria-pressed={explorerOpen} onClick={() => { setExplorerOpen((open) => !open); if (compactLayout) setContextOpen(false); }}>
            <FolderOpen size={15} /> {explorerOpen ? "Hide explorer" : "Collections"}
          </Button>
          <Button variant="secondary" aria-pressed={contextOpen} onClick={() => { setContextOpen((open) => !open); if (compactLayout) setExplorerOpen(false); }}>
            {contextOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            {contextOpen ? "Hide context" : "Show context"}
          </Button>
          <select
            aria-label="Open saved request"
            value=""
            onChange={(e) => {
              const r = requests.find((r) => r.id === Number(e.target.value));
              if (r) openSavedRequest(r);
            }}
          >
            <option value="">Open saved request</option>
            {requests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.method} · {r.name}
              </option>
            ))}
          </select>
          <Button
            id="save-request"
            variant="secondary"
            disabled={busy || sending || !canEdit}
            onClick={save}
          >
            <Save size={15} /> Save request
          </Button>
        </div>
      </div>
      <div className="execution-mode-toggle" role="group" aria-label="Execution location">
        <span className="execution-mode-label">Execute through</span>
        <div className="execution-mode-segment">
          <Button aria-pressed={executionMode === "local"} disabled={anySending} title={anySending ? "Wait for running requests before changing execution mode." : undefined} variant={executionMode === "local" ? "primary" : "secondary"} onClick={() => setExecutionMode("local")}><ShieldCheck size={15} /> Local</Button>
          <Button aria-pressed={executionMode === "cloud"} disabled={anySending} title={anySending ? "Wait for running requests before changing execution mode." : undefined} variant={executionMode === "cloud" ? "primary" : "secondary"} onClick={() => setExecutionMode("cloud")}><Globe2 size={15} /> Cloud</Button>
        </div>
        <span className={`execution-mode-status ${executionMode === "local" ? companionConnected ? "connected" : "warning" : ""}`}><i />{executionMode === "local" ? companionConnected ? "Companion connected" : "Companion not connected" : "Approved destinations only"}</span>
      </div>
      {executionMode === "local" && <Panel className="local-companion-panel">
        <div>
          <strong>Private local companion</strong>
          <p>It listens on this computer only. The browser sends requests directly to it; the session token stays in this tab and is not saved.</p>
          <code>npm run companion -- --origin &quot;{uiOrigin}&quot; --allow-localhost{["127.0.0.1", "localhost"].includes(new URL(uiOrigin).hostname) ? "" : " --allow-cloud-origin"}</code>
          <small>Run the command in a project terminal. Local HTTP requests are enabled only with the explicit flag shown above.</small>
        </div>
        <div className="local-pair-controls">
          <Field label="This session’s companion token">
            <input type="password" autoComplete="off" value={companionToken} onChange={(event) => { setCompanionToken(event.target.value); setCompanionConnected(false); }} placeholder="Paste the token printed in your terminal" />
          </Field>
          <div className="form-actions">
            <Button onClick={connectCompanion} disabled={companionBusy || !companionToken}>{companionBusy ? "Connecting…" : "Connect"}</Button>
            {companionConnected && <Button variant="secondary" onClick={() => { setCompanionToken(""); setCompanionConnected(false); setCompanionMessage(""); }}>Disconnect</Button>}
          </div>
          {companionMessage && <p className={companionConnected ? "local-connected" : "local-pair-error"} role="status">{companionMessage}</p>}
        </div>
      </Panel>}
      <div className={`studio-layout${contextOpen ? "" : " context-closed"}${explorerOpen ? "" : " explorer-closed"}${compactLayout ? " is-compact" : ""}`} style={{ "--studio-explorer-width": `${explorerWidth}px`, "--studio-context-width": `${contextWidth}px`, "--studio-editor-height": `${editorHeight}px` } as React.CSSProperties}>
        {compactLayout && (explorerOpen || contextOpen) && <button type="button" className="studio-drawer-scrim" aria-label="Close Studio panels" onClick={() => { setExplorerOpen(false); setContextOpen(false); }} />}
        {explorerOpen && <aside className={`studio-collections${compactLayout ? " drawer-open" : ""}`} aria-label="Collections">
          <RequestTree collections={collections} folders={folders} requests={requests} openRequest={openSavedRequest} activeRequestId={current.request.id} duplicateRequest={duplicateRequest} manageRequest={manageRequest} deleteRequest={setDeleteTarget} closeExplorer={() => setExplorerOpen(false)} canEdit={canEdit} hasMoreResources={hasMoreStudioResources} loadingMoreResources={loadingStudioResources} loadMoreResources={loadMoreStudioResources} />
        </aside>}
        {explorerOpen && !compactLayout && <div className="studio-resizer" role="separator" aria-label="Resize collection explorer" aria-orientation="vertical" aria-valuemin={190} aria-valuemax={360} aria-valuenow={explorerWidth} tabIndex={0} onPointerDown={(event) => startResize("explorer", event)} onKeyDown={(event) => resizeByKeyboard("explorer", event)}><GripVertical size={15} /></div>}
        <div className="studio-main">
          <Panel className="request-panel">
            <div className="request-tabs">
              {tabs.map((t, i) => (
                <div key={t.key} className={active === i ? "active" : ""}>
                  <button onClick={() => setActive(i)}>
                    <span
                      className={`method-text ${t.request.method.toLowerCase()}`}
                    >
                      {t.request.method}
                    </span>
                    {t.request.name}
                    {t.dirty && <i />}
                  </button>
                  {tabs.length > 1 && (
                    <button
                      aria-label={`Close ${t.request.name}`}
                      onClick={() => {
                        if (t.dirty) setClosing(i);
                        else closeTab(i);
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button
                className="icon-button"
                aria-label="New request tab"
                onClick={() => {
                  setTabs([...tabs, draft(blankRequest())]);
                  setActive(tabs.length);
                }}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="request-toolbar">
              <select
                aria-label="HTTP method"
                className="method-select"
                value={current.request.method}
                onChange={(e) => requestChange({ method: e.target.value })}
              >
                {[
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "HEAD",
                  "OPTIONS",
                ].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                aria-label="Request URL"
                className="url-input mono"
                value={current.request.url}
                onChange={(e) => requestChange({ url: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
              <Button
                id="send-request"
                aria-busy={sending}
                onClick={send}
                disabled={busy || sending || !canEdit}
              >
                {sending ? <LoaderCircle className="studio-spinner" size={15} /> : <Send size={15} />}
                {execution?.phase === "validating" ? "Validating…" : sending ? "Sending…" : "Send"}
                <kbd>↵</kbd>
              </Button>
              {sending && <Button variant="secondary" onClick={cancel}>{executionMode === "local" ? "Cancel request" : "Stop waiting"}</Button>}
            </div>
            <div className="request-meta">
              <Field label="Request name">
                <input
                  aria-label="Request name"
                  value={current.request.name}
                  onChange={(e) => requestChange({ name: e.target.value })}
                />
              </Field>
              <Field label="Collection">
                <select
                  value={current.request.collection_id || ""}
                  onChange={(e) =>
                    requestChange({
                      collection_id: Number(e.target.value) || null,
                      folder_id: null,
                    })
                  }
                >
                  <option value="">Unfiled</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Folder">
                <select
                  value={current.request.folder_id || ""}
                  onChange={(e) =>
                    requestChange({ folder_id: Number(e.target.value) || null })
                  }
                >
                  <option value="">No folder</option>
                  {folders
                    .filter(
                      (f) => f.collection_id === current.request.collection_id,
                    )
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="editor-tabs">
              {["params", "headers", "auth", "body", "settings", "assertions"].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "selected" : ""}
                  onClick={() => setTab(t)}
                >
                  {t === "params"
                    ? "Query params"
                    : t[0].toUpperCase() + t.slice(1)}
                  {t === "headers" && (
                    <span>
                      {Object.keys(current.request.headers || {}).length}
                    </span>
                  )}
                  {t === "assertions" && (
                    <span>{current.request.assertions.length}</span>
                  )}
                </button>
              ))}
              {tab === "body" && <select aria-label="Body format" value={current.request.body_mode || "raw"} onChange={(event) => { const body_mode = event.target.value as ApiRequest["body_mode"]; requestChange({ body_mode, ...(body_mode === "none" ? { body: null } : {}) }); }}>
                <option value="none">None</option><option value="json">JSON</option><option value="raw">Raw text</option><option value="urlencoded">URL encoded</option><option value="multipart">Multipart</option>
              </select>}
              {tab === "settings" && <span className="editor-format">Execution options</span>}
              {tab !== "body" && tab !== "settings" && <span className="editor-format">{tab === "assertions" ? "JSON" : "Request data"}</span>}
              {!['auth', 'settings'].includes(tab) && !(tab === "body" && current.request.body_mode === "none") && <div className="studio-editor-actions"><button type="button" aria-label="Format editor JSON" onClick={formatEditorContent} disabled={tab === "body" && !["json", "multipart"].includes(current.request.body_mode || "raw")}>Format</button><button type="button" aria-label="Copy editor content" onClick={() => void copyEditorContent()}>Copy</button></div>}
            </div>
            <div className="editor-hint">
              {tab === "params"
                ? 'Query values are URL encoded automatically. Example: {"userId": "1"}'
                : tab === "headers"
                  ? 'Use environment variables for secrets. Example: {"Authorization": "Bearer {{token}}"}'
                : tab === "auth"
                  ? "Authentication secrets must reference an encrypted environment variable, such as {{token}}."
                  : tab === "settings"
                    ? "Timeouts apply to cloud and local runs. Cloud timeouts are capped at 15 seconds."
                    : tab === "assertions"
                    ? "Checks: status, duration_lt, json_equals, json_exists, header_contains, body_contains. JSON paths use dot notation."
                    : current.request.body_mode === "none" ? "This method will be sent without a request body." : current.request.body_mode === "multipart" ? "Enter text fields as a JSON object. Attach a file below; the selected file is used for this send only." : current.request.body_mode === "json" ? "JSON request body. Use {{variable}} to insert an environment value." : current.request.body_mode === "urlencoded" ? "Enter URL-encoded fields, one key=value pair per line." : "Plain text request body. Use {{variable}} to insert an environment value."}
            </div>
            {tab === "auth" ? <div className="request-settings-grid">
              <Field label="Authentication">
                <select aria-label="Authentication type" value={current.request.auth_type || "none"} onChange={(event) => requestChange({ auth_type: event.target.value as ApiRequest["auth_type"], auth_config: {} })}>
                  <option value="none">No authentication</option><option value="bearer">Bearer token</option><option value="basic">Basic authentication</option><option value="api_key">API key</option>
                </select>
              </Field>
              {current.request.auth_type === "bearer" && <Field label="Token variable"><input aria-label="Bearer token variable" value={current.request.auth_config?.token || ""} onChange={(event) => requestChange({ auth_config: { ...(current.request.auth_config || {}), token: event.target.value } })} placeholder="{{token}}" /></Field>}
              {current.request.auth_type === "basic" && <>
                <Field label="Username variable"><input aria-label="Basic username variable" value={current.request.auth_config?.username || ""} onChange={(event) => requestChange({ auth_config: { ...(current.request.auth_config || {}), username: event.target.value } })} placeholder="{{username}}" /></Field>
                <Field label="Password variable"><input aria-label="Basic password variable" value={current.request.auth_config?.password || ""} onChange={(event) => requestChange({ auth_config: { ...(current.request.auth_config || {}), password: event.target.value } })} placeholder="{{password}}" /></Field>
              </>}
              {current.request.auth_type === "api_key" && <>
                <Field label="Key name"><input aria-label="API key name" value={current.request.auth_config?.key || "X-API-Key"} onChange={(event) => requestChange({ auth_config: { ...(current.request.auth_config || {}), key: event.target.value } })} /></Field>
                <Field label="Key value variable"><input aria-label="API key value variable" value={current.request.auth_config?.value || ""} onChange={(event) => requestChange({ auth_config: { ...(current.request.auth_config || {}), value: event.target.value } })} placeholder="{{api_key}}" /></Field>
                <Field label="Send key in"><select aria-label="API key placement" value={current.request.auth_config?.in || "header"} onChange={(event) => requestChange({ auth_config: { ...(current.request.auth_config || {}), in: event.target.value } })}><option value="header">Header</option><option value="query">Query string</option></select></Field>
              </>}
              <p className="small muted">Credential values are saved as variable references only. Create their values in Environments.</p>
            </div> : tab === "settings" ? <div className="request-settings-grid">
              <Field label={`Request timeout · ${current.request.timeout_ms || 15000} ms`}><input aria-label="Request timeout" type="range" min="100" max="60000" step="500" value={current.request.timeout_ms || 15000} onChange={(event) => requestChange({ timeout_ms: Number(event.target.value) })} /></Field>
              <label className="pin-setting"><input type="checkbox" checked={!!current.request.pinned} onChange={(event) => requestChange({ pinned: event.target.checked })} /> Pin this request in the collection tree</label>
              <p className="small muted">The local companion supports up to 60 seconds. Cloud execution remains limited to 15 seconds by the isolated executor.</p>
            </div> : tab === "body" && current.request.body_mode === "none" ? <div className="studio-body-none"><span><Braces size={20} /></span><strong>No request body</strong><p>Select JSON, Raw text, URL encoded, or Multipart to add a body.</p></div> : <Editor
              key={current.key + tab}
              value={
                tab === "headers"
                  ? current.headers
                  : tab === "params"
                    ? current.params
                    : tab === "assertions"
                      ? current.assertions
                      : current.request.body || ""
              }
              onChange={(value) =>
                tab === "body"
                  ? requestChange({ body: value })
                  : change(
                      tab === "headers"
                        ? { headers: value }
                        : tab === "params"
                          ? { params: value }
                          : { assertions: value },
                    )
              }
              extensions={tab === "body" && !["json", "multipart"].includes(current.request.body_mode || "raw") ? [] : [json()]}
              theme={editorTheme}
              minHeight="190px"
              maxHeight="390px"
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />}
            {editorMessage && <p className="studio-editor-message" role="status">{editorMessage}</p>}
            {tab === "body" && current.request.body_mode === "multipart" && <div className="multipart-upload-fields">
              <Field label="File field name"><input aria-label="Multipart file field name" value={selectedFileField} onChange={(event) => setUploadFields((previous) => ({ ...previous, [current.key]: event.target.value }))} placeholder="file" /></Field>
              <Field label={`Attach a file · ${executionMode === "cloud" ? "128 KiB cloud limit" : "1 MiB local limit"}`}><input aria-label="Multipart file upload" type="file" onChange={(event) => setUploadFiles((previous) => ({ ...previous, [current.key]: event.target.files?.[0] || null }))} /></Field>
              {selectedFile && <div className="multipart-selected-file"><span>{selectedFile.name} · {(selectedFile.size / 1024).toFixed(1)} KiB</span><button type="button" className="subtle-link" onClick={() => setUploadFiles((previous) => ({ ...previous, [current.key]: null }))}>Remove file</button></div>}
            </div>}
            <div className="editor-footer">
              <span>
                <ShieldCheck size={13} /> {executionMode === "local" ? "Local companion · loopback only" : "Operator-approved HTTPS destinations"}
              </span>
              <span>
                {current.dirty ? "Unsaved changes" : "All changes saved"}
              </span>
            </div>
          </Panel>
          {!compactLayout && <div className="studio-resizer studio-resizer-horizontal" role="separator" aria-label="Resize request editor and response panels" aria-orientation="horizontal" aria-valuemin={420} aria-valuemax={820} aria-valuenow={editorHeight} tabIndex={0} onPointerDown={(event) => startResize("editor", event)} onKeyDown={(event) => resizeByKeyboard("editor", event)}><GripVertical size={15} /></div>}
          <ResponseInspector run={response} execution={execution} />
        </div>
        {contextOpen && !compactLayout && <div className="studio-resizer" role="separator" aria-label="Resize request context panel" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={380} aria-valuenow={contextWidth} tabIndex={0} onPointerDown={(event) => startResize("context", event)} onKeyDown={(event) => resizeByKeyboard("context", event)}><GripVertical size={15} /></div>}
        {contextOpen && <aside className={`studio-aside${compactLayout ? " drawer-open" : ""}`} aria-label="Request context">
          {compactLayout && <div className="studio-context-drawer-title"><strong>Request context</strong><button type="button" className="studio-drawer-close" aria-label="Close request context" onClick={() => setContextOpen(false)}><X size={16} /></button></div>}
          <Panel>
            <div className="panel-title">
              <Globe2 size={17} />
              <h3>Environment</h3>
            </div>
            <select
              aria-label="Execution environment"
              value={environmentId}
              onChange={(e) => setEnvironmentId(Number(e.target.value))}
            >
              <option value={0}>No environment</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <p className="small muted">
              Variables are resolved securely when you send a request.
            </p>
            <div className="variable-preview">
              {environments
                .find((e) => e.id === environmentId)
                ?.variables.map((v) => (
                  <div key={v.key}>
                    <code>{v.key}</code>
                    <span>{v.is_secret ? "••••••••" : v.value}</span>
                  </div>
                ))}
            </div>
          </Panel>
          <Panel className="studio-context-details">
            <div className="panel-title"><Braces size={17} /><h3>Request details</h3></div>
            <dl>
              <div><dt>Method</dt><dd><span className={`method-text ${current.request.method.toLowerCase()}`}>{current.request.method}</span></dd></div>
              <div><dt>Body</dt><dd>{current.request.body_mode === "multipart" ? "Multipart" : current.request.body_mode === "urlencoded" ? "URL encoded" : current.request.body_mode === "json" ? "JSON" : current.request.body ? "Raw" : "None"}</dd></div>
              <div><dt>Assertions</dt><dd>{current.request.assertions.length} configured{response?.assertions ? ` · ${response.assertions.filter((item) => item.passed).length} passed` : ""}</dd></div>
              <div><dt>Last execution</dt><dd>{execution?.phase.replaceAll("_", " ") || "Not run"}</dd></div>
              <div className="context-url"><dt>URL</dt><dd title={current.request.url}>{current.request.url || "No URL configured"}</dd></div>
            </dl>
          </Panel>
          <Panel className="studio-context-security">
            <div className="panel-title"><ShieldCheck size={17} /><h3>Execution security</h3></div>
            <p>{executionMode === "local" ? companionConnected ? "Requests are sent to the paired loopback companion on this device." : "Connect the loopback companion before sending requests locally." : "Cloud execution allows only operator-approved HTTPS destinations."}</p>
            <span className={`security-state ${executionMode === "local" && companionConnected ? "connected" : ""}`}><i />{executionMode === "local" ? companionConnected ? "Local session connected" : "Local session required" : "Destination policy active"}</span>
          </Panel>
          <Panel className="tips-panel">
            <span className="tip-icon">
              <Braces size={22} />
            </span>
            <h3>Response assertions</h3>
            <p>
              Add assertions to validate status codes, JSON values, headers, and
              response time on every run.
            </p>
            <button onClick={() => setTab("assertions")}>
              Write your first assertion <ChevronDown size={14} />
            </button>
          </Panel>
          <div className="keyboard-hints">
            <span>
              Send request <kbd>Ctrl ↵</kbd>
            </span>
            <span>
              Save request <kbd>Ctrl S</kbd>
            </span>
            <span>
              Find a request <kbd>Ctrl K</kbd>
            </span>
          </div>
        </aside>}
      </div>
      {closing !== null && (
        <Dialog title="Discard unsaved changes?" close={() => setClosing(null)}>
          <p className="muted">
            Changes to {tabs[closing]?.request.name} have not been saved.
          </p>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setClosing(null)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => closeTab(closing)}>
              Discard changes
            </Button>
          </div>
        </Dialog>
      )}
      {deleteTarget && <Dialog title="Delete saved request?" close={() => setDeleteTarget(null)}>
        <p className="muted">This permanently removes “{deleteTarget.name}” from this workspace. If it is open in a tab, that tab will stay available as an unsaved copy.</p>
        <div className="form-actions"><Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void confirmDeleteRequest()}>{busy ? "Deleting…" : "Delete request"}</Button></div>
      </Dialog>}
      {pendingLocal && <Dialog title="Enter local environment secrets" close={() => { setPendingLocal(null); setSecretValues({}); }}>
        <p className="muted">These values stay in this browser session and are sent only to the local companion. They are not included in cloud history.</p>
        <form onSubmit={(event) => { event.preventDefault(); void resumeLocal(); }}>
          {pendingLocal.keys.map((key) => <Field key={key} label={key} hint="Value is cleared after this execution.">
            <input type="password" autoComplete="new-password" value={secretValues[key] || ""} onChange={(event) => setSecretValues((previous) => ({ ...previous, [key]: event.target.value }))} />
          </Field>)}
          {companionMessage && <p className="local-pair-error" role="alert">{companionMessage}</p>}
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => { setPendingLocal(null); setSecretValues({}); }}>Cancel</Button><Button type="submit">Run locally</Button></div>
        </form>
      </Dialog>}
    </>
  );
}
