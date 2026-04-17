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

async function resolveScopedPaperIds(
  ownerUserId: string,
  scopedFolderIds: string[] | null,
  projectId?: string | null
): Promise<number[] | null> {
  if (!scopedFolderIds && !projectId) {
    return null;
  }

  if (projectId && (!scopedFolderIds || scopedFolderIds.length === 0)) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data: runs, error: runsError } = await supabase
    .from("ingestion_runs")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .in("folder_id", scopedFolderIds ?? []);

  if (runsError) {
    throw new Error(runsError.message);
  }

  const runIds = (runs ?? [])
    .map((row) => String((row as { id?: string | null }).id ?? ""))
    .filter(Boolean);
  if (runIds.length === 0) {
    return [];
  }

  const { data: papers, error: papersError } = await supabase
    .from("papers_full")
    .select("paper_id")
    .eq("owner_user_id", ownerUserId)
    .in("ingestion_run_id", runIds);

  if (papersError) {
    throw new Error(papersError.message);
  }

  return [...new Set(
    (papers ?? [])
      .map((row) => Number((row as { paper_id?: number | null }).paper_id ?? 0))
      .filter((paperId) => Number.isFinite(paperId) && paperId > 0)
  )];
}

async function loadViewData(
  ownerUserId: string,
  scopedPaperIds: number[] | null,
  projectId?: string | null
): Promise<DashboardData | null> {
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

  if (scopedPaperIds) {
    if (scopedPaperIds.length === 0) {
      return emptyDashboardData();
    }
    trendsQuery = trendsQuery.in("paper_id", scopedPaperIds);
    singleQuery = singleQuery.in("paper_id", scopedPaperIds);
    multiQuery = multiQuery.in("paper_id", scopedPaperIds);
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
  scopedPaperIds: number[] | null,
  projectId?: string | null
): Promise<DashboardData> {
  const supabase = getSupabaseAdmin();
  let papersQuery = supabase
    .from("papers")
    .select("id,folder_id,year,title")
    .eq("owner_user_id", ownerUserId);

  if (scopedPaperIds) {
    if (scopedPaperIds.length === 0) {
      return emptyDashboardData();
    }
    papersQuery = papersQuery.in("id", scopedPaperIds);
  } else if (projectId) {
    return emptyDashboardData();
  }

  const { data: papers, error: papersError } = await papersQuery;
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
    const scopedPaperIds = await resolveScopedPaperIds(
      ownerUserId,
      scopedFolderIds,
      projectId
    );
    const preferred = await loadViewData(ownerUserId, scopedPaperIds, projectId);
    const fallback = await loadTableData(ownerUserId, scopedPaperIds, projectId);
    return mergeDashboardSources(preferred, fallback);
  } catch {
    return mode === "live" ? emptyDashboardData() : generateMockData();
  }
}
