import { generateMockData } from "@/lib/mockData";
import { normalizePaperId, paperIdFromRunId, paperLookupKey } from "@/lib/paper-id";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  DashboardData,
  DashboardDataMode,
  PaperId,
  TrackRow,
  TrendRow,
} from "@/types/database";

type PaperMetadata = {
  paper_id: PaperId;
  folder_id: string | null;
  year: string;
  title: string;
  ingestion_run_id: string | null;
};

function withDiagnostics(
  data: DashboardData,
  diagnostics: NonNullable<DashboardData["diagnostics"]>
): DashboardData {
  return {
    ...data,
    diagnostics,
  };
}

function emptyDashboardData(): DashboardData {
  return {
    trends: [],
    tracksSingle: [],
    tracksMulti: [],
    useMock: false,
    diagnostics: null,
  };
}

function describeScope(folderId?: string | null, projectId?: string | null): string {
  if (folderId && folderId !== "all") {
    return "selected folder";
  }
  if (projectId && projectId !== "all") {
    return "selected project";
  }
  return "workspace";
}

function hasAnyDashboardRows(data: DashboardData | null): boolean {
  if (!data) {
    return false;
  }

  return (
    data.trends.length > 0 ||
    data.tracksSingle.length > 0 ||
    data.tracksMulti.length > 0
  );
}

function buildMetadataLookups(metadata: PaperMetadata[]) {
  return {
    byPaperId: new Map(metadata.map((row) => [row.paper_id, row])),
    byLookupKey: new Map(metadata.map((row) => [paperLookupKey(row), row])),
  };
}

function resolvePaperId(
  value: unknown,
  ingestionRunId?: string | null
): PaperId {
  return paperIdFromRunId(ingestionRunId) || normalizePaperId(value);
}

function resolveMetadataForRow(
  row: Record<string, unknown>,
  lookups: ReturnType<typeof buildMetadataLookups>
): PaperMetadata | null {
  const runId =
    typeof row.ingestion_run_id === "string" ? row.ingestion_run_id : null;
  const fromRun = paperIdFromRunId(runId);
  if (fromRun && lookups.byPaperId.has(fromRun)) {
    return lookups.byPaperId.get(fromRun) ?? null;
  }

  const lookupKey = paperLookupKey({
    folderId: typeof row.folder_id === "string" ? row.folder_id : null,
    year: String(row.year ?? ""),
    title: String(row.title ?? ""),
  });
  if (lookups.byLookupKey.has(lookupKey)) {
    return lookups.byLookupKey.get(lookupKey) ?? null;
  }

  const normalizedPaperId = normalizePaperId(row.paper_id);
  if (normalizedPaperId && lookups.byPaperId.has(normalizedPaperId)) {
    return lookups.byPaperId.get(normalizedPaperId) ?? null;
  }

  if (!normalizedPaperId) {
    return null;
  }

  return {
    paper_id: normalizedPaperId,
    folder_id: typeof row.folder_id === "string" ? row.folder_id : null,
    year: String(row.year ?? "Unknown"),
    title: String(row.title ?? "Untitled paper"),
    ingestion_run_id: runId,
  };
}

function mapTrackRow(
  row: Record<string, unknown>,
  lookups: ReturnType<typeof buildMetadataLookups>
): TrackRow | null {
  const metadata = resolveMetadataForRow(row, lookups);
  if (!metadata?.paper_id) {
    return null;
  }

  return {
    paper_id: metadata.paper_id,
    folder_id:
      typeof row.folder_id === "string" ? row.folder_id : metadata.folder_id,
    year: metadata.year,
    title: metadata.title,
    el: Number(row.el ?? 0),
    eli: Number(row.eli ?? 0),
    lae: Number(row.lae ?? 0),
    other: Number(row.other ?? 0),
  };
}

function mapTrendRow(
  row: Record<string, unknown>,
  lookups: ReturnType<typeof buildMetadataLookups>
): TrendRow | null {
  const metadata = resolveMetadataForRow(row, lookups);
  if (!metadata?.paper_id) {
    return null;
  }

  return {
    paper_id: metadata.paper_id,
    folder_id:
      typeof row.folder_id === "string" ? row.folder_id : metadata.folder_id,
    year: metadata.year,
    title: metadata.title,
    topic: String(row.topic ?? "Unclassified"),
    keyword: String(row.keyword ?? ""),
    keyword_frequency: Number(row.keyword_frequency ?? 0),
    evidence: String(row.evidence ?? ""),
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

async function resolveScopedRunIds(
  ownerUserId: string,
  scopedFolderIds: string[] | null,
  projectId?: string | null
): Promise<string[] | null> {
  if (!scopedFolderIds && !projectId) {
    return null;
  }

  if (projectId && (!scopedFolderIds || scopedFolderIds.length === 0)) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .in("folder_id", scopedFolderIds ?? []);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .map((row) => String((row as { id?: string | null }).id ?? ""))
    .filter(Boolean);
}

async function loadPaperMetadata(
  ownerUserId: string,
  scopedRunIds: string[] | null
): Promise<PaperMetadata[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("papers_full")
    .select("paper_id,folder_id,year,title,ingestion_run_id")
    .eq("owner_user_id", ownerUserId);

  if (scopedRunIds) {
    if (scopedRunIds.length === 0) {
      return [];
    }
    query = query.in("ingestion_run_id", scopedRunIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const unique = new Map<PaperId, PaperMetadata>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const ingestionRunId =
      typeof row.ingestion_run_id === "string" ? row.ingestion_run_id : null;
    const paperId = resolvePaperId(row.paper_id, ingestionRunId);
    if (!paperId) {
      continue;
    }

    unique.set(paperId, {
      paper_id: paperId,
      folder_id: typeof row.folder_id === "string" ? row.folder_id : null,
      year: String(row.year ?? "Unknown"),
      title: String(row.title ?? "Untitled paper"),
      ingestion_run_id: ingestionRunId,
    });
  }

  return [...unique.values()];
}

async function loadViewData(
  ownerUserId: string,
  scopedPaperIds: PaperId[] | null,
  metadata: PaperMetadata[]
): Promise<DashboardData | null> {
  const supabase = getSupabaseAdmin();
  const lookups = buildMetadataLookups(metadata);
  const scopedIdSet = scopedPaperIds ? new Set(scopedPaperIds) : null;

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

  const trends = ((trendsResult.data ?? []) as Record<string, unknown>[])
    .map((row) => mapTrendRow(row, lookups))
    .filter((row): row is TrendRow =>
      Boolean(row && (!scopedIdSet || scopedIdSet.has(row.paper_id)))
    );
  const tracksSingle = ((singleResult.data ?? []) as Record<string, unknown>[])
    .map((row) => mapTrackRow(row, lookups))
    .filter((row): row is TrackRow =>
      Boolean(row && (!scopedIdSet || scopedIdSet.has(row.paper_id)))
    );
  const tracksMulti = ((multiResult.data ?? []) as Record<string, unknown>[])
    .map((row) => mapTrackRow(row, lookups))
    .filter((row): row is TrackRow =>
      Boolean(row && (!scopedIdSet || scopedIdSet.has(row.paper_id)))
    );

  return {
    trends,
    tracksSingle,
    tracksMulti,
    useMock: false,
    diagnostics: null,
  };
}

async function loadTableData(
  ownerUserId: string,
  metadata: PaperMetadata[]
): Promise<DashboardData> {
  if (metadata.length === 0) {
    return emptyDashboardData();
  }

  const supabase = getSupabaseAdmin();
  const paperPayloads = await Promise.all(
    metadata.map(async (paper) => {
      const [keywordsResult, singleResult, multiResult] = await Promise.all([
        supabase
          .from("paper_keywords")
          .select("folder_id,topic,keyword,keyword_frequency,evidence")
          .eq("owner_user_id", ownerUserId)
          .eq("paper_id", paper.paper_id),
        supabase
          .from("paper_tracks_single")
          .select("folder_id,el,eli,lae,other")
          .eq("owner_user_id", ownerUserId)
          .eq("paper_id", paper.paper_id)
          .maybeSingle(),
        supabase
          .from("paper_tracks_multi")
          .select("folder_id,el,eli,lae,other")
          .eq("owner_user_id", ownerUserId)
          .eq("paper_id", paper.paper_id)
          .maybeSingle(),
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

      return {
        paper,
        keywords: (keywordsResult.data ?? []) as Record<string, unknown>[],
        trackSingle: (singleResult.data as Record<string, unknown> | null) ?? null,
        trackMulti: (multiResult.data as Record<string, unknown> | null) ?? null,
      };
    })
  );

  const trends: TrendRow[] = paperPayloads.flatMap(({ paper, keywords }) =>
    keywords
      .map((row) => ({
        paper_id: paper.paper_id,
        folder_id:
          typeof row.folder_id === "string" ? row.folder_id : paper.folder_id,
        year: paper.year,
        title: paper.title,
        topic: String(row.topic ?? "Unclassified"),
        keyword: String(row.keyword ?? ""),
        keyword_frequency: Number(row.keyword_frequency ?? 0),
        evidence: String(row.evidence ?? ""),
      }))
      .filter((row) => row.keyword)
  );

  const tracksSingle: TrackRow[] = paperPayloads.flatMap(({ paper, trackSingle }) =>
    trackSingle
      ? [
          {
            paper_id: paper.paper_id,
            folder_id:
              typeof trackSingle.folder_id === "string"
                ? trackSingle.folder_id
                : paper.folder_id,
            year: paper.year,
            title: paper.title,
            el: Number(trackSingle.el ?? 0),
            eli: Number(trackSingle.eli ?? 0),
            lae: Number(trackSingle.lae ?? 0),
            other: Number(trackSingle.other ?? 0),
          },
        ]
      : []
  );

  const tracksMulti: TrackRow[] = paperPayloads.flatMap(({ paper, trackMulti }) =>
    trackMulti
      ? [
          {
            paper_id: paper.paper_id,
            folder_id:
              typeof trackMulti.folder_id === "string"
                ? trackMulti.folder_id
                : paper.folder_id,
            year: paper.year,
            title: paper.title,
            el: Number(trackMulti.el ?? 0),
            eli: Number(trackMulti.eli ?? 0),
            lae: Number(trackMulti.lae ?? 0),
            other: Number(trackMulti.other ?? 0),
          },
        ]
      : []
  );

  return {
    trends,
    tracksSingle,
    tracksMulti,
    useMock: false,
    diagnostics: null,
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
    diagnostics: null,
  };
}

async function loadScopedDashboardData(
  ownerUserId: string,
  scopedRunIds: string[] | null
): Promise<DashboardData> {
  const metadata = await loadPaperMetadata(ownerUserId, scopedRunIds);
  const scopedPaperIds =
    scopedRunIds === null ? null : metadata.map((paper) => paper.paper_id);
  const preferred = await loadViewData(ownerUserId, scopedPaperIds, metadata);
  const fallback = await loadTableData(ownerUserId, metadata);
  return mergeDashboardSources(preferred, fallback);
}

export async function loadDashboardDataServer(
  ownerUserId?: string | null,
  folderId?: string | null,
  projectId?: string | null,
  mode: DashboardDataMode = "auto"
): Promise<DashboardData> {
  if (mode === "mock") {
    return withDiagnostics(generateMockData(), {
      dataSource: "mock",
      recoveredFromLegacyScope: false,
      scopeDescription: "preview data",
    });
  }

  try {
    if (!ownerUserId) {
      return withDiagnostics(generateMockData(), {
        dataSource: "mock",
        recoveredFromLegacyScope: false,
        scopeDescription: "preview data",
      });
    }

    const scopeDescription = describeScope(folderId, projectId);
    const scopedFolderIds = await resolveScopedFolderIds(
      ownerUserId,
      folderId,
      projectId
    );
    const scopedRunIds = await resolveScopedRunIds(
      ownerUserId,
      scopedFolderIds,
      projectId
    );
    const scopedData = await loadScopedDashboardData(ownerUserId, scopedRunIds);

    if (hasAnyDashboardRows(scopedData)) {
      return withDiagnostics(scopedData, {
        dataSource: "scoped",
        recoveredFromLegacyScope: false,
        scopeDescription,
      });
    }

    if (mode === "auto" && (folderId || projectId)) {
      const ownerWideData = await loadScopedDashboardData(ownerUserId, null);
      if (hasAnyDashboardRows(ownerWideData)) {
        return withDiagnostics(ownerWideData, {
          dataSource: "legacy_fallback",
          recoveredFromLegacyScope: true,
          scopeDescription,
        });
      }
    }

    return withDiagnostics(scopedData, {
      dataSource: "empty",
      recoveredFromLegacyScope: false,
      scopeDescription,
    });
  } catch {
    return mode === "live"
      ? withDiagnostics(emptyDashboardData(), {
          dataSource: "empty",
          recoveredFromLegacyScope: false,
          scopeDescription: describeScope(folderId, projectId),
        })
      : withDiagnostics(generateMockData(), {
          dataSource: "mock",
          recoveredFromLegacyScope: false,
          scopeDescription: "preview data",
        });
  }
}
