/*
 * src/lib/dashboard-data-server.ts for the dashboard route's tests: when a
 * test sets globalThis.__bootsecDashboardServerData, that is what the loader
 * returns, as the server holds it; otherwise the real loader runs. Everything
 * else is the real module.
 */
import { loadDashboardDataServer as loadReal } from "../../src/lib/dashboard-data-server";
import type { DashboardData } from "../../src/types/database";

export * from "../../src/lib/dashboard-data-server";

declare global {
  // eslint-disable-next-line no-var
  var __bootsecDashboardServerData: DashboardData | undefined;
}

export async function loadDashboardDataServer(...args: Parameters<typeof loadReal>): Promise<DashboardData> {
  return globalThis.__bootsecDashboardServerData ?? loadReal(...args);
}
