export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type PageMeta = { current_page: number; last_page: number; per_page: number; total: number; collection_counts?: Record<string, number> };
type ApiEnvelope<T> = { data: T; meta?: PageMeta };
export type ApiPage<T> = { data: T[]; meta?: PageMeta };

async function apiEnvelope<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options?: { signal?: AbortSignal },
): Promise<ApiEnvelope<T>> {
  const res = await fetch(`/api/gateway/${path}`, {
    method,
    signal: options?.signal,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res
    .json()
    .catch(() => ({ message: "The API returned an invalid response." }));
  if (!res.ok) {
    if (
      res.status === 401 &&
      !path.startsWith("auth/") &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("apiforge:unauthorized"));
    const details = Object.values(json.errors ?? {})
      .flat()
      .join(" ");
    throw new ApiError(
      details || json.message || "The request failed.",
      res.status,
    );
  }
  if (method !== "GET" && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("apiforge:mutation", { detail: { path, method } }),
    );
  }
  return json as ApiEnvelope<T>;
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options?: { signal?: AbortSignal },
): Promise<T> {
  return (await apiEnvelope<T>(path, method, body, options)).data;
}

export async function apiPage<T>(path: string, page = 1, perPage = 100, options?: { signal?: AbortSignal }): Promise<ApiPage<T>> {
  const separator = path.includes("?") ? "&" : "?";
  return apiEnvelope<T[]>(`${path}${separator}page=${page}&per_page=${perPage}`, "GET", undefined, options);
}

export async function apiPages<T>(path: string): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const first = await apiEnvelope<T[]>(`${path}${separator}page=1&per_page=100`);
  if (!Array.isArray(first.data)) throw new ApiError("The resource list response was invalid.", 502);
  const rows = [...first.data];
  const lastPage = Math.max(1, first.meta?.last_page ?? 1);
  for (let start = 2; start <= lastPage; start += 4) {
    const pages = await Promise.all(Array.from({ length: Math.min(4, lastPage - start + 1) }, (_, index) =>
      apiEnvelope<T[]>(`${path}${separator}page=${start + index}&per_page=100`),
    ));
    for (const result of pages) {
      if (!Array.isArray(result.data)) throw new ApiError("The resource list response was invalid.", 502);
      rows.push(...result.data);
    }
  }
  return rows;
}

export function when(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not checked yet";
}
export const blankRequest = () => ({
  name: "Untitled request",
  method: "GET",
  url: "https://jsonplaceholder.typicode.com/posts/1",
  collection_id: null,
  folder_id: null,
  headers: {},
  query_params: {},
  body: "",
  assertions: [{ type: "status", expected: 200 }],
  body_mode: "none" as const,
  auth_type: "none" as const,
  auth_config: {},
  timeout_ms: 15000,
  pinned: false,
  sort_order: 0,
});
