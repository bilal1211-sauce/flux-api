"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Activity,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  FilePlus2,
  Folder,
  FolderOpen,
  Globe2,
  LockKeyhole,
  PanelLeftOpen,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, apiPage, when } from "@/lib/api";
import type {
  ApiRequest,
  Collection,
  Environment,
  Folder as FolderType,
  Monitor,
  Variable,
} from "@/lib/types";
import type { ModuleProps } from "./console";
import { Badge, Button, DeleteButton, Dialog, Empty, Field, Panel } from "./ui";
import {
  getStudioMemory,
  selectStudioEnvironment,
  updateStudioRequest,
} from "@/lib/drafts";

type CollectionSort = "default" | "name" | "method" | "updated_at";

export function Collections(p: ModuleProps) {
  const [collection, setCollection] = useState<number | null>(null);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [collectionEdit, setCollectionEdit] = useState<Partial<Collection> | null>(null);
  const [folderEdit, setFolderEdit] = useState<Partial<FolderType> | null>(null);
  const [requestEdit, setRequestEdit] = useState<ApiRequest | null>(null);
  const [query, setQuery] = useState("");
  const [treeQuery, setTreeQuery] = useState("");
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("all");
  const [sort, setSort] = useState<CollectionSort>("default");
  const [drawer, setDrawer] = useState(false);
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const [openCollections, setOpenCollections] = useState<Record<number, boolean>>({});
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams();
  if (collection !== null) params.set("collection_id", String(collection));
  if (folderId !== null) params.set("folder_id", String(folderId));
  if (search) params.set("search", search);
  if (sort !== "default") params.set("sort", sort);
  const path = p.base + "/requests" + (params.size ? "?" + params.toString() : "");
  const list = useInfiniteQuery({
    queryKey: [p.base, "requests", "collections", collection, folderId, search, sort],
    queryFn: ({ pageParam, signal }) => apiPage<ApiRequest>(path, Number(pageParam), 100, { signal }),
    initialPageParam: 1,
    getNextPageParam: (page) => page.meta && page.meta.current_page < page.meta.last_page ? page.meta.current_page + 1 : undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.data) || [];
  const meta = list.data?.pages[0]?.meta;
  const counts = meta?.collection_counts || {};
  const shown = rows.filter((row) => method === "all" || row.method.toUpperCase() === method);
  const activeCollection = p.collections.find((item) => item.id === collection);
  const activeFolder = p.folders.find((item) => item.id === folderId);
  const folderParentOptions = (() => {
    const excluded = new Set<number>(folderEdit?.id ? [folderEdit.id] : []);
    let frontier = [...excluded];
    while (frontier.length) {
      frontier = p.folders.filter((item) => frontier.includes(item.parent_id || 0) && !excluded.has(item.id)).map((item) => item.id);
      frontier.forEach((id) => excluded.add(id));
    }
    return p.folders.filter((item) => item.collection_id === folderEdit?.collection_id && !excluded.has(item.id));
  })();
  const canMove = sort === "default" && !search && !list.hasNextPage;
  function selectCollection(id: number | null) {
    setCollection(id); setFolderId(null);
    if (window.innerWidth <= 820) setDrawer(false);
  }
  async function moveRequest(request: ApiRequest, direction: -1 | 1) {
    const siblings = rows.filter((item) => item.collection_id === request.collection_id && (item.folder_id || null) === (request.folder_id || null) && !!item.pinned === !!request.pinned).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0));
    const index = siblings.findIndex((item) => item.id === request.id);
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    await p.act(() => api(p.base + "/requests/order", "PATCH", { collection_id: request.collection_id, folder_id: request.folder_id, pinned: !!request.pinned, ids: siblings.map((item) => item.id) }), "Request order saved.");
  }
  function requestRow(request: ApiRequest): ReactNode {
    const siblings = rows.filter((item) => item.collection_id === request.collection_id && (item.folder_id || null) === (request.folder_id || null) && !!item.pinned === !!request.pinned).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0));
    const index = siblings.findIndex((item) => item.id === request.id);
    return <article className="flux-request-row" key={request.id}>
      <Link className="flux-request-open" href="/studio" aria-label={"Open " + request.name + " in API Studio"} onClick={() => sessionStorage.setItem("apiforge-open-request", String(request.id))}>
        <span className={"flux-method " + request.method.toLowerCase()}>{request.method}</span>
        <span className="flux-request-label"><strong>{request.name}</strong><code title={request.url}>{request.url}</code></span><span className="flux-request-updated">{when(request.updated_at)}</span><ArrowUpRight size={15} />
      </Link>
      <div className="flux-row-actions">
        <button className="icon-button" aria-label={"Rename or move " + request.name} disabled={!p.canEdit} onClick={() => setRequestEdit({ ...request, assertions: [...request.assertions] })}><Edit3 size={14} /></button>
        <button className="icon-button" aria-label={"Duplicate " + request.name} disabled={!p.canEdit} onClick={() => void p.act(() => api(p.base + "/requests/" + request.id + "/duplicate", "POST"), "Request duplicated.")}><Copy size={14} /></button>
        <button className="icon-button" aria-label={"Move " + request.name + " up"} disabled={!p.canEdit || !canMove || index <= 0} onClick={() => void moveRequest(request, -1)}><ArrowUp size={13} /></button>
        <button className="icon-button" aria-label={"Move " + request.name + " down"} disabled={!p.canEdit || !canMove || index >= siblings.length - 1} onClick={() => void moveRequest(request, 1)}><ArrowDown size={13} /></button>
        <DeleteButton name={request.name} disabled={!p.canEdit} remove={() => p.act(() => api(p.base + "/requests/" + request.id, "DELETE"), "Request deleted.")} />
      </div>
    </article>;
  }
  function folderTree(cid: number, parent: number | null, depth = 0): ReactNode {
    return p.folders.filter((item) => item.collection_id === cid && (item.parent_id || null) === parent)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id).map((item) => {
        const children = p.folders.some((child) => child.parent_id === item.id);
        const isOpen = opened[item.id] !== false;
        const count = rows.filter((request) => {
          let id = request.folder_id;
          while (id) { if (id === item.id) return true; id = p.folders.find((entry) => entry.id === id)?.parent_id || null; }
          return false;
        }).length;
        return <div className="flux-tree-folder" key={item.id}>
          <div className={"flux-tree-folder-row " + (folderId === item.id ? "selected" : "")} style={{ paddingInlineStart: (10 + depth * 15) + "px" }}>
            <button className="flux-tree-pick" onClick={() => { setCollection(cid); setFolderId(item.id); if (window.innerWidth <= 820) setDrawer(false); }}><Folder size={14} /><span>{item.name}</span><small>{count}</small></button>
            <div className="flux-tree-tools">
              {children && <button className="icon-button" aria-label={(isOpen ? "Collapse " : "Expand ") + item.name} onClick={() => setOpened({ ...opened, [item.id]: !isOpen })}>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>}
              <button className="icon-button" aria-label={"Create subfolder in " + item.name} disabled={!p.canEdit} onClick={() => setFolderEdit({ collection_id: cid, parent_id: item.id, name: "" })}><Plus size={13} /></button>
              <button className="icon-button" aria-label={"Edit folder " + item.name} disabled={!p.canEdit} onClick={() => setFolderEdit(item)}><Edit3 size={13} /></button>
              <DeleteButton name={item.name} disabled={!p.canEdit} remove={() => p.act(() => api(p.base + "/folders/" + item.id, "DELETE"), "Folder deleted.")} />
            </div>
          </div>
          {isOpen && folderTree(cid, item.id, depth + 1)}
        </div>;
      });
  }
  function requestGroups(cid: number): ReactNode {
    const rootRows = shown.filter((request) => request.collection_id === cid && !request.folder_id);
    const groups = (parent: number | null): ReactNode => p.folders.filter((item) => item.collection_id === cid && (item.parent_id || null) === parent).map((item) => {
      const own = shown.filter((request) => request.folder_id === item.id);
      const childrenHaveRows = shown.some((request) => {
        let id = request.folder_id;
        while (id) { if (id === item.id) return true; id = p.folders.find((entry) => entry.id === id)?.parent_id || null; }
        return false;
      });
      if (search && !childrenHaveRows) return null;
      return <section className="flux-request-folder-group" key={item.id}><header><Folder size={14} /><strong>{item.name}</strong><span>{own.length} requests</span></header>{own.map(requestRow)}{groups(item.id)}{!own.length && !p.folders.some((child) => child.parent_id === item.id) && <p className="flux-folder-empty">No requests in this folder yet.</p>}</section>;
    });
    return <>{rootRows.map(requestRow)}{groups(null)}</>;
  }

  return <div className="flux-resource-page flux-collections-page">
    {drawer && <button className="flux-resource-scrim" aria-label="Close collection explorer" onClick={() => setDrawer(false)} />}
    <aside className={"flux-collection-explorer " + (drawer ? "drawer-open" : "")} aria-label="Collection explorer">
      <div className="flux-explorer-header"><div><span className="flux-overline">Workspace</span><strong>Collections</strong></div><button className="icon-button flux-explorer-close" aria-label="Close collection explorer" onClick={() => setDrawer(false)}><X size={16} /></button><button className="icon-button" aria-label="Create collection" disabled={!p.canEdit} onClick={() => setCollectionEdit({ name: "", description: "" })}><Plus size={16} /></button></div>
      <label className="flux-tree-search"><Search size={14} /><input aria-label="Search collections and folders" placeholder="Search collections…" value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} /></label>
      <nav className="flux-collection-nav">
        <button className={"flux-tree-collection " + (collection === null ? "selected" : "")} onClick={() => selectCollection(null)}><FolderOpen size={16} /><span>All requests</span><small>{meta?.collection_counts ? Object.values(counts).reduce((sum, item) => sum + item, 0) : "…"}</small></button>
        {p.collections.filter((item) => !treeQuery || item.name.toLowerCase().includes(treeQuery.toLowerCase()) || p.folders.some((f) => f.collection_id === item.id && f.name.toLowerCase().includes(treeQuery.toLowerCase()))).map((item) => <div className="flux-collection-node" key={item.id}>
          <div className={"flux-tree-collection " + (collection === item.id && folderId === null ? "selected" : "")}><button onClick={() => selectCollection(item.id)}><Folder size={16} /><span>{item.name}</span><small>{counts[String(item.id)] ?? 0}</small></button><div className="flux-tree-tools">{p.folders.some((folder) => folder.collection_id === item.id && !folder.parent_id) && <button className="icon-button" aria-label={(openCollections[item.id] === false ? "Expand " : "Collapse ") + item.name} onClick={() => setOpenCollections({ ...openCollections, [item.id]: openCollections[item.id] === false })}>{openCollections[item.id] === false ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>}<button className="icon-button" aria-label={"Create folder in " + item.name} disabled={!p.canEdit} onClick={() => setFolderEdit({ collection_id: item.id, parent_id: null, name: "" })}><Plus size={13} /></button><button className="icon-button" aria-label={"Edit " + item.name} disabled={!p.canEdit} onClick={() => setCollectionEdit(item)}><Edit3 size={13} /></button></div></div>
          {openCollections[item.id] !== false && folderTree(item.id, null)}
        </div>)}
      </nav>
      <div className="flux-explorer-footer">{p.collections.length} collections · {meta?.collection_counts ? Object.values(counts).reduce((sum, item) => sum + item, 0) : 0} requests</div>
    </aside>
    <main className="flux-collection-main">
      <div className="flux-module-heading"><div className="flux-module-title"><button className="icon-button flux-open-explorer" aria-label="Open collection explorer" onClick={() => setDrawer(true)}><PanelLeftOpen size={17} /></button><div><span className="flux-overline">Request library</span><h1>{activeFolder?.name || activeCollection?.name || "All requests"}</h1><p>{activeCollection?.description || "Organize saved API requests and folders."}</p></div></div>
        <div className="flux-module-actions">{collection !== null && <Button variant="secondary" disabled={!p.canEdit} onClick={() => setFolderEdit({ collection_id: collection, parent_id: folderId, name: "" })}><Plus size={14} /> Folder</Button>}{activeCollection && <Button variant="secondary" disabled={!p.canEdit} onClick={() => setCollectionEdit(activeCollection)}><Edit3 size={14} /> Edit collection</Button>}<Link href="/studio" className="button primary" onClick={() => sessionStorage.removeItem("apiforge-open-request")}><FilePlus2 size={15} /> New request</Link><Button variant="secondary" disabled={!p.canEdit} onClick={() => setCollectionEdit({ name: "", description: "" })}><Plus size={14} /> Collection</Button></div>
      </div>
      <Panel className="flux-requests-panel">
        <div className="flux-requests-toolbar"><div className="flux-request-count"><strong>{list.isPending ? "Loading requests…" : (meta?.total || 0) + " requests"}</strong>{meta && <span>Page {meta.current_page} of {meta.last_page}</span>}</div>
          <div className="flux-request-filters"><label className="flux-filter-search"><Search size={14} /><input aria-label="Filter requests" placeholder="Search name or URL…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="flux-select-filter"><select aria-label="Filter by method" value={method} onChange={(event) => setMethod(event.target.value)}><option value="all">All methods</option>{["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="flux-select-filter"><select aria-label="Sort requests" value={sort} onChange={(event) => setSort(event.target.value as CollectionSort)}><option value="default">Manual order</option><option value="name">Name</option><option value="method">Method</option><option value="updated_at">Recently updated</option></select></label></div>
        </div>
        {list.isError && <div className="flux-resource-error" role="alert">{(list.error as Error).message}<Button variant="secondary" onClick={() => void list.refetch()}>Try again</Button></div>}
        {list.isPending && <div className="flux-resource-loading" role="status">Loading saved requests…</div>}
        {!list.isPending && !shown.length && !list.hasNextPage && <Empty title={query || method !== "all" ? "No matching requests" : "No requests here yet"} text={query || method !== "all" ? "Adjust the search or method filter." : "Create a request in API Studio and save it to a collection."}><Link href="/studio" className="button secondary" onClick={() => sessionStorage.removeItem("apiforge-open-request")}><FilePlus2 size={14} /> Create request</Link></Empty>}
        {shown.length > 0 && <div className="flux-request-groups">{folderId !== null ? shown.map(requestRow) : collection !== null ? requestGroups(collection) : <>{p.collections.map((item) => {
          const groupRows = shown.filter((request) => request.collection_id === item.id);
          if (!groupRows.length && !p.folders.some((f) => f.collection_id === item.id)) return null;
          return <section className="flux-collection-group" key={item.id}><header><Folder size={14} /><strong>{item.name}</strong><span>{counts[String(item.id)] ?? groupRows.length} requests</span></header>{requestGroups(item.id)}</section>;
        })}{shown.filter((request) => !request.collection_id).map(requestRow)}</>}</div>}
        {list.hasNextPage && <div className="flux-load-more"><span>{rows.length} loaded of {meta?.total || 0}</span><Button variant="secondary" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Loading…" : "Load more requests"}</Button></div>}
      </Panel>
    </main>
    {collectionEdit && <Dialog title={collectionEdit.id ? "Edit collection" : "New collection"} close={() => setCollectionEdit(null)}><form onSubmit={async (event) => {
      event.preventDefault();
      const saved = await p.act(() => api<Collection>(p.base + "/collections" + (collectionEdit.id ? "/" + collectionEdit.id : ""), collectionEdit.id ? "PUT" : "POST", collectionEdit), "Collection saved.");
      if (saved) { setCollectionEdit(null); setCollection(saved.id); setFolderId(null); }
    }}><Field label="Name"><input required autoFocus maxLength={150} value={collectionEdit.name || ""} onChange={(event) => setCollectionEdit({ ...collectionEdit, name: event.target.value })} /></Field><Field label="Description"><textarea value={collectionEdit.description || ""} onChange={(event) => setCollectionEdit({ ...collectionEdit, description: event.target.value })} /></Field><div className="form-actions">{collectionEdit.id && <DeleteButton name={collectionEdit.name || "collection"} disabled={!p.canEdit} remove={async () => { await p.act(() => api(p.base + "/collections/" + collectionEdit.id, "DELETE"), "Collection deleted."); setCollectionEdit(null); setCollection(null); setFolderId(null); }} />}<Button disabled={!p.canEdit || p.busy}>Save collection</Button></div></form></Dialog>}
    {folderEdit && <Dialog title={folderEdit.id ? "Edit folder" : "New folder"} close={() => setFolderEdit(null)}><form onSubmit={async (event) => {
      event.preventDefault();
      const saved = await p.act(() => api<FolderType>(p.base + "/folders" + (folderEdit.id ? "/" + folderEdit.id : ""), folderEdit.id ? "PUT" : "POST", folderEdit), "Folder saved.");
      if (saved) { setFolderEdit(null); setCollection(saved.collection_id); setFolderId(saved.id); setOpenCollections((value) => ({ ...value, [saved.collection_id]: true })); if (saved.parent_id) setOpened((value) => ({ ...value, [saved.parent_id!]: true })); }
    }}><Field label="Folder name"><input required autoFocus maxLength={100} value={folderEdit.name || ""} onChange={(event) => setFolderEdit({ ...folderEdit, name: event.target.value })} /></Field><Field label="Parent folder"><select value={folderEdit.parent_id || ""} onChange={(event) => setFolderEdit({ ...folderEdit, parent_id: Number(event.target.value) || null })}><option value="">Collection root</option>{folderParentOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="form-actions"><Button disabled={!p.canEdit || p.busy}>Save folder</Button></div></form></Dialog>}
    {requestEdit && <Dialog title="Rename or move request" close={() => setRequestEdit(null)}><form onSubmit={async (event) => {
      event.preventDefault();
      const payload = { ...requestEdit, collection_id: requestEdit.collection_id || null, folder_id: requestEdit.folder_id || null };
      const saved = await p.act(() => api<ApiRequest>(p.base + "/requests/" + requestEdit.id, "PUT", payload), "Request updated.");
      if (saved) { updateStudioRequest(p.base, saved); setRequestEdit(null); }
    }}><Field label="Request name"><input required autoFocus value={requestEdit.name} onChange={(event) => setRequestEdit({ ...requestEdit, name: event.target.value })} /></Field><Field label="Collection"><select value={requestEdit.collection_id || ""} onChange={(event) => setRequestEdit({ ...requestEdit, collection_id: Number(event.target.value) || null, folder_id: null })}><option value="">Unassigned</option>{p.collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Folder"><select value={requestEdit.folder_id || ""} onChange={(event) => setRequestEdit({ ...requestEdit, folder_id: Number(event.target.value) || null })}><option value="">Collection root</option>{p.folders.filter((item) => item.collection_id === requestEdit.collection_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="form-actions"><Button variant="secondary" type="button" onClick={() => setRequestEdit(null)}>Cancel</Button><Button disabled={!p.canEdit || p.busy}>Save request</Button></div></form></Dialog>}
  </div>;
}

type EnvironmentDraft = { id?: number; name: string; variables: Variable[] };

export function Environments(p: ModuleProps) {
  const defaultId = getStudioMemory(p.base)?.environmentId || p.environments[0]?.id || 0;
  const [selectedId, setSelectedId] = useState<number | null>(defaultId || null);
  const [activeId, setActiveId] = useState(defaultId);
  const [editing, setEditing] = useState<EnvironmentDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [secretsNotCopied, setSecretsNotCopied] = useState(0);
  const selected = p.environments.find((item) => item.id === selectedId) || null;
  const dirty = !!editing && (!editing.id || JSON.stringify(editing) !== baseline);
  const monitorsUsing = selected ? p.monitors.filter((item) => item.environment_id === selected.id) : [];
  function edit(value: EnvironmentDraft) { setEditing(value); setBaseline(JSON.stringify(value)); setErrors({}); setSecretsNotCopied(0); }
  function change(value: EnvironmentDraft) { setEditing(value); setErrors({}); }
  function cancel() { if (dirty && !window.confirm("Discard unsaved environment changes?")) return; setEditing(null); }
  function choose(id: number) { if (dirty && !window.confirm("Discard unsaved environment changes?")) return; setEditing(null); setSelectedId(id); }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const next: Record<string, string> = {};
    if (!editing.name.trim()) next.name = "Enter an environment name.";
    const keys = editing.variables.map((item) => item.key.trim());
    editing.variables.forEach((item, index) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.key.trim())) next["key-" + index] = "Use a valid variable name.";
      else if (keys.indexOf(item.key.trim()) !== index) next["key-" + index] = "Variable names must be unique.";
      if (!editing.id && item.is_secret && !item.value) next["value-" + index] = "Enter a secret value before saving this environment.";
      const original = selected?.variables.find((value) => value.key === item.key);
      if (original?.is_secret && !item.is_secret && item.value === null) next["value-" + index] = "Enter a replacement before making this public.";
    });
    if (editing.variables.length > 100) next.variables = "Limit environments to 100 variables.";
    if (Object.keys(next).length) { setErrors(next); return; }
    const saved = await p.act(() => api<Environment>(p.base + "/environments" + (editing.id ? "/" + editing.id : ""), editing.id ? "PUT" : "POST", { name: editing.name.trim(), variables: editing.variables }), "Environment saved.");
    if (saved) { setSelectedId(saved.id); setEditing(null); }
  }
  function duplicate(environment: Environment) {
    edit({ name: environment.name + " copy", variables: environment.variables.filter((item) => !item.is_secret).map((item) => ({ ...item })) });
    setSecretsNotCopied(environment.variables.filter((item) => item.is_secret).length);
  }
  async function remove() {
    if (!selected) return;
    let removed = false;
    await p.act(async () => { await api(p.base + "/environments/" + selected.id, "DELETE"); removed = true; }, "Environment deleted.");
    if (removed) { const next = p.environments.find((item) => item.id !== selected.id); setSelectedId(next?.id || null); if (activeId === selected.id) { const id = next?.id || 0; setActiveId(id); selectStudioEnvironment(p.base, id); } }
  }
  function applyToStudio(id: number) { selectStudioEnvironment(p.base, id); setActiveId(id); }
  return <div className="flux-resource-page flux-environments-page">
    <div className="flux-module-heading"><div><span className="flux-overline">Workspace configuration</span><h1>Environments</h1><p>Manage the values used by API Studio, local runs and monitors.</p></div><div className="flux-module-actions"><Button disabled={!p.canEdit} onClick={() => edit({ name: "", variables: [] })}><Plus size={15} /> New environment</Button></div></div>
    <div className="flux-security-note"><Shield size={17} /><span><strong>Secret values stay hidden.</strong> The API never returns encrypted secrets. Leave a saved secret blank to keep it, or enter a replacement.</span></div>
    <div className="flux-environment-layout">
      <aside className="flux-environment-nav" aria-label="Environment list"><div className="flux-environment-nav-title"><strong>Environments</strong><span>{p.environments.length}</span></div>
        {p.environments.map((item) => <button key={item.id} className={"flux-environment-link " + (selectedId === item.id ? "selected" : "")} aria-current={selectedId === item.id ? "page" : undefined} onClick={() => choose(item.id)}><span className="flux-env-icon"><Globe2 size={16} /></span><span className="flux-env-link-copy"><strong>{item.name}</strong><small>{item.variables.length} variables · {item.variables.filter((variable) => variable.is_secret).length} secrets</small></span>{activeId === item.id && <Badge tone="violet">Studio</Badge>}</button>)}
        {!p.environments.length && <div className="flux-env-nav-empty">No environments yet.</div>}
      </aside>
      <main className="flux-environment-main">
        {!selected && !editing && <Panel className="flux-env-empty"><Empty title="Create your first environment" text="Keep separate values for development, staging and production." /><Button disabled={!p.canEdit} onClick={() => edit({ name: "", variables: [] })}><Plus size={14} /> New environment</Button></Panel>}
        {selected && !editing && <Panel className="flux-env-detail">
          <div className="flux-env-detail-heading"><div><span className="flux-overline">Environment</span><h2>{selected.name}</h2><p>{selected.variables.length} variables · {selected.variables.filter((item) => item.is_secret).length} secrets</p></div><div className="flux-module-actions">
            {activeId !== selected.id && <Link href="/studio" className="button secondary" onClick={() => applyToStudio(selected.id)}>Use in API Studio <ArrowUpRight size={14} /></Link>}
            <Button variant="secondary" disabled={!p.canEdit} onClick={() => edit({ ...selected, variables: selected.variables.map((item) => ({ ...item })) })}><Edit3 size={14} /> Edit</Button>
            <Button variant="secondary" disabled={!p.canEdit} onClick={() => duplicate(selected)}><Copy size={14} /> Duplicate</Button>
            <DeleteButton name={selected.name} disabled={!p.canEdit || monitorsUsing.length > 0} remove={remove} />
          </div></div>
          {monitorsUsing.length > 0 && <p className="flux-env-protection">Assigned to {monitorsUsing.length} monitor{monitorsUsing.length === 1 ? "" : "s"}. Reassign them before deleting this environment.</p>}
          <div className="flux-env-table-wrap"><table className="flux-variable-table"><thead><tr><th>Variable</th><th>Value</th><th>Type</th></tr></thead><tbody>{selected.variables.map((item) => <tr key={item.key}><th scope="row"><code>{item.key}</code></th><td>{item.is_secret ? <span className="flux-secret-masked"><LockKeyhole size={13} />••••••••••••</span> : <code className="flux-public-value">{item.value || "Empty"}</code>}</td><td><span className={"flux-classification " + (item.is_secret ? "secret" : "public")}>{item.is_secret ? <><LockKeyhole size={12} /> Secret</> : <><Check size={12} /> Public</>}</span></td></tr>)}</tbody></table>{!selected.variables.length && <div className="flux-empty-variables"><p>No variables configured.</p><Button variant="secondary" disabled={!p.canEdit} onClick={() => edit({ ...selected, variables: [] })}><Plus size={14} /> Add variable</Button></div>}</div>
          <div className="flux-env-detail-footer"><span>Selected for Studio: <strong>{activeId === selected.id ? "Yes" : "No"}</strong></span></div>
        </Panel>}
        {editing && <Panel className="flux-env-editor-panel"><form onSubmit={save}>
          <div className="flux-env-editor-heading"><div><span className="flux-overline">{editing.id ? "Edit configuration" : "New configuration"}</span><h2>{editing.name || "New environment"}</h2><p>Save or cancel to apply variable changes.</p></div>{dirty && <Badge tone="amber">Unsaved changes</Badge>}</div>
          <Field label="Environment name"><input required maxLength={100} value={editing.name} onChange={(event) => change({ ...editing, name: event.target.value })} /></Field>{errors.name && <p className="flux-field-error" role="alert">{errors.name}</p>}
          <div className="flux-variable-editor-head"><div><h3>Variables</h3><p>Use <code>{"{{variable_name}}"}</code> in requests.</p></div><Button type="button" variant="secondary" disabled={!p.canEdit || editing.variables.length >= 100} onClick={() => change({ ...editing, variables: [...editing.variables, { key: "", value: "", is_secret: false }] })}><Plus size={14} /> Add variable</Button></div>
          {errors.variables && <p className="flux-field-error" role="alert">{errors.variables}</p>}
          <div className="flux-variable-editor">{editing.variables.map((item, index) => <div className="flux-variable-edit-row" key={index}>
            <Field label="Variable name"><input required pattern="[A-Za-z_][A-Za-z0-9_]*" value={item.key} onChange={(event) => change({ ...editing, variables: editing.variables.map((value, position) => position === index ? { ...value, key: event.target.value } : value) })} /></Field>
            <Field label="Value" hint={item.is_secret && item.value === null ? "Saved value hidden. Leave blank to keep it." : undefined}><input type={item.is_secret ? "password" : "text"} autoComplete="new-password" value={item.value ?? ""} placeholder={item.is_secret && item.value === null ? "Saved secret · enter to replace" : "Value"} onChange={(event) => change({ ...editing, variables: editing.variables.map((value, position) => position === index ? { ...value, value: event.target.value } : value) })} /></Field>
            <label className="flux-secret-toggle"><input type="checkbox" checked={item.is_secret} onChange={(event) => change({ ...editing, variables: editing.variables.map((value, position) => position === index ? { ...value, is_secret: event.target.checked } : value) })} /><span><LockKeyhole size={13} /> Secret</span></label>
            <button className="icon-button danger-text" type="button" aria-label={"Remove variable " + (item.key || index + 1)} onClick={() => change({ ...editing, variables: editing.variables.filter((_, position) => position !== index) })}><X size={15} /></button>
            {errors["key-" + index] && <p className="flux-field-error flux-variable-error" role="alert">{errors["key-" + index]}</p>}{errors["value-" + index] && <p className="flux-field-error flux-variable-error" role="alert">{errors["value-" + index]}</p>}
          </div>)}
          {!editing.variables.length && <div className="flux-empty-variables"><p>No variables yet. Add a base URL or credential.</p></div>}</div>
          {!editing.id && secretsNotCopied > 0 && <p className="flux-secret-copy-note"><LockKeyhole size={13} /> {secretsNotCopied} encrypted secret{secretsNotCopied === 1 ? " was" : "s were"} omitted from this duplicate. Add replacement variables before saving if requests use them.</p>}
          <div className="flux-env-editor-actions"><Button type="button" variant="secondary" onClick={cancel}>Cancel</Button><Button disabled={!p.canEdit || p.busy || (!dirty && !!editing.id)}><Check size={14} /> Save environment</Button></div>
        </form></Panel>}
      </main>
    </div>
  </div>;
}
export function Monitoring(p: ModuleProps) {
  type EditMonitor = Partial<Monitor> & { failure_threshold: number };
  const [editing, setEditing] = useState<EditMonitor | null>(null);
  useEffect(() => {
    const monitorId = new URLSearchParams(window.location.search).get(
      "monitor",
    );
    if (!monitorId) return;
    document
      .getElementById(`monitor-${monitorId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [p.monitors]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Endpoint monitoring</span>
          <h1>
            Monitors<span className="title-dot">.</span>
          </h1>
          <p>Your endpoints, checked around the clock.</p>
        </div>
        <Button
          disabled={!p.canEdit || !p.requests.length}
          onClick={() =>
            setEditing({
              name: "",
              api_request_id: p.requests[0]?.id,
              environment_id: p.environments[0]?.id || null,
              interval_minutes: 5,
              enabled: true,
              failure_threshold: 2,
            })
          }
        >
          <Plus size={16} /> Create monitor
        </Button>
      </div>
      <div className="monitor-summary">
        <span>
          <span className="status-dot" />{" "}
          {p.monitors.filter((m) => m.enabled).length} active
        </span>
        <span>{p.monitors.filter((m) => !m.enabled).length} paused</span>
        <span>
          <ShieldCheck size={14} /> Approved destinations only
        </span>
      </div>
      <div className="monitor-grid">
        {p.monitors.map((m) => (
          <Panel key={m.id} id={`monitor-${m.id}`} className="monitor-card">
            <div className="panel-heading">
              <div className="monitor-icon">
                <Activity size={21} />
              </div>
              <Badge
                tone={
                  !m.enabled
                    ? "neutral"
                    : m.last_outcome === "passed"
                      ? "mint"
                      : m.last_outcome === "failed"
                        ? "red"
                        : "violet"
                }
              >
                {!m.enabled
                  ? "Paused"
                  : m.last_outcome === "passed"
                    ? "Healthy"
                    : m.last_outcome === "failed"
                      ? "Failing"
                      : "Awaiting check"}
              </Badge>
            </div>
            <div className="monitor-title">
              <h2>{m.name}</h2>
              <code>
                {p.requests.find((r) => r.id === m.api_request_id)?.url}
              </code>
            </div>
            <div className="monitor-details">
              <span>
                Check interval<strong>{m.interval_minutes} min</strong>
              </span>
              <span>
                Last checked<strong>{when(m.last_run_at)}</strong>
              </span>
              <span>
                Consecutive failures<strong>{m.consecutive_failures}</strong>
              </span>
              <span>
                Alert threshold
                <strong>{m.alert_rule?.failure_threshold ?? 2} failures</strong>
              </span>
            </div>
            <div className="monitor-actions">
              <Button
                disabled={p.busy || !p.canEdit}
                variant="secondary"
                onClick={() =>
                  p.act(
                    () => api(`${p.base}/monitors/${m.id}/check`, "POST"),
                    "Monitor check completed.",
                  )
                }
              >
                Check now <ArrowUpRight size={14} />
              </Button>
              <button
                className="icon-button"
                aria-label={`Edit ${m.name}`}
                disabled={!p.canEdit}
                onClick={() =>
                  setEditing({
                    ...m,
                    failure_threshold: m.alert_rule?.failure_threshold ?? 2,
                  })
                }
              >
                <Edit3 size={15} />
              </button>
              <DeleteButton
                name={m.name}
                disabled={!p.canEdit}
                remove={() =>
                  p.act(
                    () => api(`${p.base}/monitors/${m.id}`, "DELETE"),
                    "Monitor deleted.",
                  )
                }
              />
            </div>
          </Panel>
        ))}
      </div>
      {!p.monitors.length && (
        <Panel>
          <Empty
            title="No monitors configured"
            text="Choose a saved request, set an interval, and let FluxAPI keep checking it."
          />
        </Panel>
      )}
      {editing && (
        <Dialog
          title={editing.id ? "Edit monitor" : "Create monitor"}
          close={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const saved = await p.act(
                () =>
                  api(
                    `${p.base}/monitors${editing.id ? `/${editing.id}` : ""}`,
                    editing.id ? "PUT" : "POST",
                    editing,
                  ),
                "Monitor saved.",
              );
              if (saved) setEditing(null);
            }}
          >
            <Field label="Monitor name">
              <input
                required
                autoFocus
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </Field>
            <Field label="Saved request">
              <select
                required
                value={editing.api_request_id}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    api_request_id: Number(e.target.value),
                  })
                }
              >
                {p.requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.method} · {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Environment">
              <select
                value={editing.environment_id || 0}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    environment_id: Number(e.target.value) || null,
                  })
                }
              >
                <option value={0}>No environment</option>
                {p.environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Interval (minutes)">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  required
                  value={editing.interval_minutes}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      interval_minutes: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Failures before alert">
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={editing.failure_threshold}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      failure_threshold: Number(e.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) =>
                  setEditing({ ...editing, enabled: e.target.checked })
                }
              />{" "}
              Enable scheduled checks
            </label>
            <div className="form-actions">
              <Button disabled={p.busy}>Save monitor</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
