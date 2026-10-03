/*
 * src/hooks/useData.ts for the site UI render tests: no fetch. The data a
 * page receives is globalThis.__siteuiDashboardData (by default, still
 * loading), and the options each call asked with are recorded in
 * globalThis.__siteuiDashboardRequests.
 */
declare global {
  // eslint-disable-next-line no-var
  var __siteuiDashboardData: { data: unknown; loading: boolean; allYears?: string[] } | undefined;
  // eslint-disable-next-line no-var
  var __siteuiDashboardRequests: Array<Record<string, unknown>> | undefined;
}

export function useDashboardData(_folderId?: unknown, _folderIds?: unknown, options: Record<string, unknown> = {}) {
  (globalThis.__siteuiDashboardRequests ??= []).push(options);
  const state = globalThis.__siteuiDashboardData ?? { data: null, loading: true };
  return { allYears: [] as string[], ...state, refreshing: false, refresh: async () => state.data };
}
