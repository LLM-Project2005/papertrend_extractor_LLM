import { generateMockData } from "@/lib/mockData";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { DashboardData, TrackRow, TrendRow } from "@/types/database";

function mapTrackRow(row: Record<string, unknown>): TrackRow {
  return {
    paper_id: Number(row.paper_id),
    folder_id: typeof row.folder_id === "string" ? row.folder_id : null,
    year: String(row.year),
    title: String(row.title),
    el: Number(row.el),
    eli: Number(row.eli),
    lae: Number(row.lae),
    other: Number(row.other),
  };
}

function emptyDashboardData(): DashboardData {
  return {
    trends: [],
    tracksSingle: [],
    tracksMulti: [],
    useMock: false,
  };
}

export async function loadDashboardDataServer(
  ownerUserId?: string | null,
  folderId?: string | null
): Promise<DashboardData> {
  try {
    if (!ownerUserId) {
      return generateMockData();
    }

    const supabase = getSupabaseAdmin();
    let trendsQuery = supabase
      .from("trends_flat")
      .select("*")
      .eq("owner_user_id", ownerUserId);
    let singleQuery = supabase
      .from("tracks_single_flat")
      .select("*")
      .eq("owner_user_id", ownerUserId);
    let multiQuery = supabase
      .from("tracks_multi_flat")
      .select("*")
      .eq("owner_user_id", ownerUserId);

    if (folderId && folderId !== "all") {
      trendsQuery = trendsQuery.eq("folder_id", folderId);
      singleQuery = singleQuery.eq("folder_id", folderId);
      multiQuery = multiQuery.eq("folder_id", folderId);
    }

    const [trendsResult, singleResult, multiResult] = await Promise.all([
      trendsQuery,
      singleQuery,
      multiQuery,
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
        folder_id: typeof row.folder_id === "string" ? row.folder_id : null,
        year: String(row.year),
        title: String(row.title),
        topic: String(row.topic),
        keyword: String(row.keyword),
        keyword_frequency: Number(row.keyword_frequency),
        evidence: String(row.evidence ?? ""),
      })
    );

    return {
      trends,
      tracksSingle: (singleResult.data ?? []).map(mapTrackRow),
      tracksMulti: (multiResult.data ?? []).map(mapTrackRow),
      useMock: false,
    };
  } catch {
    return ownerUserId ? emptyDashboardData() : generateMockData();
  }
}
