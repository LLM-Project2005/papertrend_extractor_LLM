/*
 * src/hooks/useData.ts for render tests: no fetch. The dashboard data a page
 * receives is globalThis.__auditfixDashboardData (by default, still loading).
 */
declare global {
  // eslint-disable-next-line no-var
  var __auditfixDashboardData: { data: unknown; loading: boolean } | undefined;
}

export function useDashboardData() {
  const state = globalThis.__auditfixDashboardData ?? { data: null, loading: true };
  return { allYears: [] as string[], ...state, refreshing: false, refresh: async () => state.data };
}

/** The paper window's read of a repository's rows (useData.ts): none here, so topics carry no theme colour. */
export function useRepositoryTrends() {
  return null;
}
