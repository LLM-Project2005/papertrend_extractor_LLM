import { generateMockData } from "@/lib/mockData";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  DashboardData,
  DashboardDataMode,
  TrackRow,
  TrendRow,
} from "@/types/database";

function mapTrackRow(row: Record<string, unknown>): TrackRow {
  return {
    paper_id: Number(row.paper_id),
    folder_id: typeof row.folder_id === "string" ? row.folder_id : null,
    year: String(row.year),
    title: String(row.title),
    el: Number(row.el ?? 0),
    eli: Number(row.eli ?? 0),
    lae: Number(row.lae ?? 0),
    other: Number(row.other ?? 0),
  };
}

function mapTrendRow(row: Record<string, unknown>): TrendRow {
  return {
    paper_id: Number(row.paper_id),
    folder_id: typeof row.folder_id === "string" ? row.folder_id : null,
    year: String(row.year),
    title: String(row.title),
    topic: String(row.topic),
    keyword: String(row.keyword),
    keyword_frequency: Number(row.keyword_frequency ?? 0),
    evidence: String(row.evidence ?? ""),
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

async function resolveScopedFolderIds(
  ownerUserId: string,
  folderId?: string | null,
  projectId?: string | null
): Promise<string[] | null> {
  if (folderId && folderId !== "all") {
    return [folderId];
  }

  if (!projectId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("research_folders")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .map((row) => String((row as { id?: string | null }).id ?? ""))
    .filter(Boolean);
}

function applyFolderScope<T>(
  query: T,
  scopedFolderIds: string[] | null,
  projectId?: string | null
) {
  if (scopedFolderIds && scopedFolderIds.length > 0) {
    return (query as { in: (column: string, values: string[]) => T }).in(
      "folder_id",
      scopedFolderIds
    );
  }

  if (projectId) {
    return null;
  }

  return query;
}

async function loadViewData(
  ownerUserId: string,
  scopedFolderIds: string[] | null,
  projectId?: string | null
): Promise<DashboardData | null> {
  const supabase = getSupabaseAdmin();

  const trendsQuery = supabase
    .from("trends_flat")
    .select("*")
    .eq("owner_user_id", ownerUserId);
  const singleQuery = supabase
    .from("tracks_single_flat")
    .select("*")
    .eq("owner_user_id", ownerUserId);
  const multiQuery = supabase
    .from("tracks_multi_flat")
    .select("*")
    .eq("owner_user_id", ownerUserId);

  const scopedTrendsQuery = applyFolderScope(trendsQuery, scopedFolderIds, projectId);
  const scopedSingleQuery = applyFolderScope(singleQuery, scopedFolderIds, projectId);
  const scopedMultiQuery = applyFolderScope(multiQuery, scopedFolderIds, projectId);

  if (!scopedTrendsQuery || !scopedSingleQuery || !scopedMultiQuery) {
    return emptyDashboardData();
  }

  const [trendsResult, singleResult, multiResult] = await Promise.all([
    scopedTrendsQuery,
    scopedSingleQuery,
    scopedMultiQuery,
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

  return {
    trends: (trendsResult.data ?? []).map((row) => mapTrendRow(row as Record<string, unknown>)),
    tracksSingle: (singleResult.data ?? []).map((row) =>
      mapTrackRow(row as Record<string, unknown>)
    ),
    tracksMulti: (multiResult.data ?? []).map((row) =>
      mapTrackRow(row as Record<string, unknown>)
    ),
    useMock: false,
  };
}

async function loadTableData(
  ownerUserId: string,
  scopedFolderIds: string[] | null,
  projectId?: string | null
): Promise<DashboardData> {
  const supabase = getSupabaseAdmin();
  const papersQuery = supabase
    .from("papers")
    .select("id,folder_id,year,title")
    .eq("owner_user_id", ownerUserId);

  const scopedPapersQuery = applyFolderScope(papersQuery, scopedFolderIds, projectId);
  if (!scopedPapersQuery) {
    return emptyDashboardData();
  }

  const { data: papers, error: papersError } = await scopedPapersQuery;
  if (papersError) {
    throw new Error(papersError.message);
  }

  const paperRows = (papers ?? []) as Array<{
    id?: number | null;
    folder_id?: string | null;
    year?: string | null;
    title?: string | null;
  }>;
  const paperIds = paperRows
    .map((paper) => Number(paper.id ?? 0))
    .filter((paperId) => Number.isFinite(paperId) && paperId > 0);

  if (paperIds.length === 0) {
    return emptyDashboardData();
  }

  const paperLookup = new Map(
    paperRows.map((paper) => [
      Number(paper.id ?? 0),
      {
        folder_id: typeof paper.folder_id === "string" ? paper.folder_id : null,
        year: String(paper.year ?? "Unknown"),
        title: String(paper.title ?? "Untitled paper"),
      },
    ])
  );

  const [keywordsResult, singleResult, multiResult] = await Promise.all([
    supabase
      .from("paper_keywords")
      .select("paper_id,folder_id,topic,keyword,keyword_frequency,evidence")
      .in("paper_id", paperIds),
    supabase
      .from("paper_tracks_single")
      .select("paper_id,folder_id,el,eli,lae,other")
      .in("paper_id", paperIds),
    supabase
      .from("paper_tracks_multi")
      .select("paper_id,folder_id,el,eli,lae,other")
      .in("paper_id", paperIds),
  ]);

  if (keywordsResult.error) {
    throw new Error(keywordsResult.error.message);
  }
  if (singleResult.error) {
    throw new Error(singleResult.error.message);
  }
  if (multiResult.error) {
    throw new Error(multiResult.error.message);
  }

  const trends: TrendRow[] = ((keywordsResult.data ?? []) as Record<string, unknown>[])
    .map<TrendRow | null>((row) => {
      const paperId = Number(row.paper_id ?? 0);
      const paper = paperLookup.get(paperId);
      if (!paper) {
        return null;
      }

      return {
        paper_id: paperId,
        folder_id:
          typeof row.folder_id === "string" ? row.folder_id : paper.folder_id,
        year: paper.year,
        title: paper.title,
        topic: String(row.topic ?? "Unclassified"),
        keyword: String(row.keyword ?? ""),
        keyword_frequency: Number(row.keyword_frequency ?? 0),
        evidence: String(row.evidence ?? ""),
      };
    })
    .filter((row): row is TrendRow => Boolean(row));

  const mapTrackRows = (rows: Record<string, unknown>[]) =>
    rows
      .map<TrackRow | null>((row) => {
        const paperId = Number(row.paper_id ?? 0);
        const paper = paperLookup.get(paperId);
        if (!paper) {
          return null;
        }

        return {
          paper_id: paperId,
          folder_id:
            typeof row.folder_id === "string" ? row.folder_id : paper.folder_id,
          year: paper.year,
          title: paper.title,
          el: Number(row.el ?? 0),
          eli: Number(row.eli ?? 0),
          lae: Number(row.lae ?? 0),
          other: Number(row.other ?? 0),
        };
      })
      .filter((row): row is TrackRow => Boolean(row));

  return {
    trends,
    tracksSingle: mapTrackRows((singleResult.data ?? []) as Record<string, unknown>[]),
    tracksMulti: mapTrackRows((multiResult.data ?? []) as Record<string, unknown>[]),
    useMock: false,
  };
}

function mergeDashboardSources(
  preferred: DashboardData | null,
  fallback: DashboardData
): DashboardData {
  if (!preferred) {
    return fallback;
  }

  return {
    trends: preferred.trends.length > 0 ? preferred.trends : fallback.trends,
    tracksSingle:
      preferred.tracksSingle.length > 0
        ? preferred.tracksSingle
        : fallback.tracksSingle,
    tracksMulti:
      preferred.tracksMulti.length > 0 ? preferred.tracksMulti : fallback.tracksMulti,
    useMock: false,
  };
}

export async function loadDashboardDataServer(
  ownerUserId?: string | null,
  folderId?: string | null,
  projectId?: string | null,
  mode: DashboardDataMode = "auto"
): Promise<DashboardData> {
  if (mode === "mock") {
    return generateMockData();
  }

  try {
    if (!ownerUserId) {
      return generateMockData();
    }

    const scopedFolderIds = await resolveScopedFolderIds(
      ownerUserId,
      folderId,
      projectId
    );
    const preferred = await loadViewData(ownerUserId, scopedFolderIds, projectId);
    const fallback = await loadTableData(ownerUserId, scopedFolderIds, projectId);
    return mergeDashboardSources(preferred, fallback);
  } catch {
    return mode === "live" ? emptyDashboardData() : generateMockData();
  }
}
