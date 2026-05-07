export const ANALYSIS_SESSION_STORAGE_KEY = "papertrend_analysis_session_v1";
export const WORKSPACE_FOLDER_STORAGE_KEY = "papertrend_workspace_folder_v2";
export const WORKSPACE_FILTERS_STORAGE_KEY = "papertrend_workspace_filters_v1";
export const WORKSPACE_ORGANIZATION_STORAGE_KEY = "papertrend_workspace_org_v1";
export const WORKSPACE_PROJECT_STORAGE_KEY = "papertrend_workspace_project_v1";
export const WORKSPACE_LAST_ROUTE_STORAGE_KEY = "papertrend_workspace_last_route_v1";

export function persistWorkspaceRoute(route: string) {
  if (typeof window === "undefined" || !route.startsWith("/workspace")) {
    return;
  }

  window.localStorage.setItem(WORKSPACE_LAST_ROUTE_STORAGE_KEY, route);
}

export function getStoredWorkspaceRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const selectedProjectId = window.localStorage.getItem(WORKSPACE_PROJECT_STORAGE_KEY);
  if (!selectedProjectId) {
    return null;
  }

  const route = window.localStorage.getItem(WORKSPACE_LAST_ROUTE_STORAGE_KEY);
  if (route && route.startsWith("/workspace")) {
    return route;
  }

  return "/workspace/home";
}
