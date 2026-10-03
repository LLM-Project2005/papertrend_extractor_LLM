/*
 * src/hooks/useData.ts for render tests that must see whether a page asks for
 * the dashboard's data at all: each call is counted in
 * globalThis.__bootsecDashboardDataCalls, and the data a page receives is
 * globalThis.__bootsecDashboardData (by default, still loading). No fetch.
 */
declare global {
  // eslint-disable-next-line no-var
  var __bootsecDashboardDataCalls: number | undefined;
  // eslint-disable-next-line no-var
  var __bootsecDashboardData: { data: unknown; loading: boolean } | undefined;
}

export function useDashboardData() {
  globalThis.__bootsecDashboardDataCalls = (globalThis.__bootsecDashboardDataCalls ?? 0) + 1;
  const state = globalThis.__bootsecDashboardData ?? { data: null, loading: true };
  return { allYears: [] as string[], ...state, refreshing: false, refresh: async () => state.data };
}
