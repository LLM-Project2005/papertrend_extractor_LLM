import type { DashboardData } from "@/types/database";

/*
 * What the dashboard route sends to the browser (audit DASH-5, docs/32 4.3).
 * The server-side loader is shared with chat, insights and concept search,
 * which read each topic family's evidence snippets; no browser code does
 * (Home reads a family's topic, papers and keyword total). Measured on the
 * 41-paper test repository, the snippets were 54 KB of a 521 KB payload.
 */
export function dashboardPayloadForBrowser(data: DashboardData): DashboardData {
  if (!data.topicFamilies?.length) return data;
  return { ...data, topicFamilies: data.topicFamilies.map((family) => ({ ...family, evidenceSnippets: [] })) };
}
