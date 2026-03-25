import { generateMockData } from "@/lib/mockData";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { DashboardData, TrackRow, TrendRow } from "@/types/database";

function mapTrackRow(row: Record<string, unknown>): TrackRow {
  return {
    paper_id: Number(row.paper_id),
    year: String(row.year),
    title: String(row.title),
    el: Number(row.el),
    eli: Number(row.eli),
    lae: Number(row.lae),
    other: Number(row.other),
  };
}

export async function loadDashboardDataServer(): Promise<DashboardData> {
  try {
    const supabase = getSupabaseAdmin();
    const [trendsResult, singleResult, multiResult] = await Promise.all([
      supabase.from("trends_flat").select("*"),
      supabase.from("tracks_single_flat").select("*"),
      supabase.from("tracks_multi_flat").select("*"),
    ]);

    if (trendsResult.error) {
      throw new Error(trendsResult.error.message);
    }
    if (singleResult.error) {
      throw new Error(singleResult.error.message);
    }
    if (multiResult.error) {
      throw new Error(multiResult.error.message);
    }

    const trends: TrendRow[] = (trendsResult.data ?? []).map(
      (row: Record<string, unknown>) => ({
        paper_id: Number(row.paper_id),
        year: String(row.year),
        title: String(row.title),
        topic: String(row.topic),
        keyword: String(row.keyword),
        keyword_frequency: Number(row.keyword_frequency),
        evidence: String(row.evidence ?? ""),
      })
    );

    if (trends.length === 0) {
      return generateMockData();
    }

    return {
      trends,
      tracksSingle: (singleResult.data ?? []).map(mapTrackRow),
      tracksMulti: (multiResult.data ?? []).map(mapTrackRow),
      useMock: false,
    };
  } catch {
    return generateMockData();
  }
}
