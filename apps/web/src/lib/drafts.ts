import type { ApiRequest, Run } from "./types";
export type Draft = {
  key: string;
  request: ApiRequest;
  headers: string;
  params: string;
  assertions: string;
  dirty: boolean;
};
export type StudioMemory = {
  tabs: Draft[];
  active: number;
  tab: string;
  environmentId: number;
  responses: Record<string, Run>;
  opened: number | null;
};
const workspaces = new Map<string, StudioMemory>();
export function getStudioMemory(workspace: string): StudioMemory | undefined {
  return typeof window === "undefined" ? undefined : workspaces.get(workspace);
}
export function rememberStudio(workspace: string, memory: StudioMemory): void {
  if (typeof window !== "undefined") workspaces.set(workspace, memory);
}
export function updateStudioRequest(workspace: string, request: ApiRequest): void {
  if (typeof window === "undefined") return;
  const memory = workspaces.get(workspace);
  if (!memory) return;
  workspaces.set(workspace, {
    ...memory,
    tabs: memory.tabs.map((tab) =>
      tab.request.id === request.id
        ? {
            ...tab,
            request: {
              ...tab.request,
              name: request.name,
              collection_id: request.collection_id,
              folder_id: request.folder_id,
              updated_at: request.updated_at,
            },
          }
        : tab,
    ),
  });
}
export function selectStudioEnvironment(workspace: string, environmentId: number): void {
  if (typeof window === "undefined") return;
  const memory = workspaces.get(workspace);
  if (memory) workspaces.set(workspace, { ...memory, environmentId });
  sessionStorage.setItem("apiforge-environment-" + workspace, String(environmentId));
}
export function hasUnsavedDrafts(): boolean {
  return Array.from(workspaces.values()).some((memory) =>
    memory.tabs.some((tab) => tab.dirty),
  );
}
export function clearDrafts(): void {
  workspaces.clear();
}
