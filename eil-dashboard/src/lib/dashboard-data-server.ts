import { generateMockData } from "@/lib/mockData";
import { normalizePaperId, paperIdFromRunId, paperLookupKey } from "@/lib/paper-id";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  filterTopicFamiliesByPaperIds,
  loadOrBuildProjectCorpusTopicCache,
} from "@/lib/corpus-topic-cache";
import type {
  DashboardData,
  DashboardDataMode,
  PaperId,
  TrackRow,
  TrendRow,
} from "@/types/database";

const DASHBOARD_SERVER_CACHE_TTL_MS = 15_000;

type DashboardServerCacheEntry = {
  timestamp: number;
  data: DashboardData;
};

const dashboardServerCache = new Map<string, DashboardServerCacheEntry>();
const dashboardServerInFlight = new Map<string, Promise<DashboardData>>();

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
    topicFamilies: [],
    useMock: false,
    diagnostics: null,
  };
}

function describeScope(
  folderIds?: string[] | null,
  projectId?: string | null
): string {
  if (folderIds && folderIds.length === 1) {
    return "selected folder";
  }
  if (folderIds && folderIds.length > 1) {
    return "selected folders";
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
    data.tracksMulti.length > 0 ||
    (data.topicFamilies?.length ?? 0) > 0
  );
}

function normalizeRequestedFolderIds(
  folderSelection?: string[] | string | null
): string[] | null {
  if (Array.isArray(folderSelection)) {
    const normalized = [...new Set(folderSelection.map((value) => String(value || "").trim()).filter(Boolean))];
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof folderSelection === "string") {
    const trimmed = folderSelection.trim();
    if (!trimmed || trimmed === "all") {
      return null;
    }
    return [trimmed];
  }

  return null;
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
    topicFamilies: [],
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
  const paperIds = metadata.map((paper) => paper.paper_id);
  const metadataByPaperId = new Map(metadata.map((paper) => [paper.paper_id, paper]));

  const [keywordsResult, singleResult, multiResult] = await Promise.all([
    supabase
      .from("paper_keywords")
      .select("paper_id,folder_id,topic,keyword,keyword_frequency,evidence")
      .eq("owner_user_id", ownerUserId)
      .in("paper_id", paperIds),
    supabase
      .from("paper_tracks_single")
      .select("paper_id,folder_id,el,eli,lae,other")
      .eq("owner_user_id", ownerUserId)
      .in("paper_id", paperIds),
    supabase
      .from("paper_tracks_multi")
      .select("paper_id,folder_id,el,eli,lae,other")
      .eq("owner_user_id", ownerUserId)
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

  const keywordsByPaperId = new Map<PaperId, Record<string, unknown>[]>();
  ((keywordsResult.data ?? []) as Record<string, unknown>[]).forEach((row) => {
    const paperId = normalizePaperId(row.paper_id);
    if (!paperId) {
      return;
    }
    const list = keywordsByPaperId.get(paperId) ?? [];
    list.push(row);
    keywordsByPaperId.set(paperId, list);
  });

  const singleByPaperId = new Map<PaperId, Record<string, unknown>>();
  ((singleResult.data ?? []) as Record<string, unknown>[]).forEach((row) => {
    const paperId = normalizePaperId(row.paper_id);
    if (paperId && !singleByPaperId.has(paperId)) {
      singleByPaperId.set(paperId, row);
    }
  });

  const multiByPaperId = new Map<PaperId, Record<string, unknown>>();
  ((multiResult.data ?? []) as Record<string, unknown>[]).forEach((row) => {
    const paperId = normalizePaperId(row.paper_id);
    if (paperId && !multiByPaperId.has(paperId)) {
      multiByPaperId.set(paperId, row);
    }
  });

  const trends: TrendRow[] = metadata.flatMap((paper) =>
    (keywordsByPaperId.get(paper.paper_id) ?? [])
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

  const tracksSingle: TrackRow[] = metadata.flatMap((paper) =>
    singleByPaperId.get(paper.paper_id)
      ? [
          {
            paper_id: paper.paper_id,
            folder_id:
              typeof singleByPaperId.get(paper.paper_id)?.folder_id === "string"
                ? (singleByPaperId.get(paper.paper_id)?.folder_id as string)
                : paper.folder_id,
            year: paper.year,
            title: paper.title,
            el: Number(singleByPaperId.get(paper.paper_id)?.el ?? 0),
            eli: Number(singleByPaperId.get(paper.paper_id)?.eli ?? 0),
            lae: Number(singleByPaperId.get(paper.paper_id)?.lae ?? 0),
            other: Number(singleByPaperId.get(paper.paper_id)?.other ?? 0),
          },
        ]
      : []
  );

  const tracksMulti: TrackRow[] = metadata.flatMap((paper) =>
    multiByPaperId.get(paper.paper_id)
      ? [
          {
            paper_id: paper.paper_id,
            folder_id:
              typeof multiByPaperId.get(paper.paper_id)?.folder_id === "string"
                ? (multiByPaperId.get(paper.paper_id)?.folder_id as string)
                : paper.folder_id,
            year: paper.year,
            title: paper.title,
            el: Number(multiByPaperId.get(paper.paper_id)?.el ?? 0),
            eli: Number(multiByPaperId.get(paper.paper_id)?.eli ?? 0),
            lae: Number(multiByPaperId.get(paper.paper_id)?.lae ?? 0),
            other: Number(multiByPaperId.get(paper.paper_id)?.other ?? 0),
          },
        ]
      : []
  );

  return {
    trends,
    tracksSingle,
    tracksMulti,
    topicFamilies: [],
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
    topicFamilies:
      (preferred.topicFamilies?.length ?? 0) > 0
        ? preferred.topicFamilies
        : fallback.topicFamilies ?? [],
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

async function loadTrackTableData(
  ownerUserId: string,
  metadata: PaperMetadata[]
): Promise<Pick<DashboardData, "tracksSingle" | "tracksMulti">> {
  if (metadata.length === 0) {
    return { tracksSingle: [], tracksMulti: [] };
  }

  const supabase = getSupabaseAdmin();
  const metadataByPaperId = new Map(metadata.map((paper) => [paper.paper_id, paper]));
  const paperIds = metadata.map((paper) => paper.paper_id);

  const [singleResult, multiResult] = await Promise.all([
    supabase
      .from("paper_tracks_single")
      .select("paper_id,folder_id,el,eli,lae,other")
      .eq("owner_user_id", ownerUserId)
      .in("paper_id", paperIds),
    supabase
      .from("paper_tracks_multi")
      .select("paper_id,folder_id,el,eli,lae,other")
      .eq("owner_user_id", ownerUserId)
      .in("paper_id", paperIds),
  ]);

  if (singleResult.error) {
    throw new Error(singleResult.error.message);
  }
  if (multiResult.error) {
    throw new Error(multiResult.error.message);
  }

  const mapRows = (rows: Record<string, unknown>[]) =>
    rows.flatMap((row) => {
      const paperId = normalizePaperId(row.paper_id);
      const paper = paperId ? metadataByPaperId.get(paperId) : null;
      if (!paper) {
        return [];
      }

      return [
        {
          paper_id: paper.paper_id,
          folder_id:
            typeof row.folder_id === "string" ? row.folder_id : paper.folder_id,
          year: paper.year,
          title: paper.title,
          el: Number(row.el ?? 0),
          eli: Number(row.eli ?? 0),
          lae: Number(row.lae ?? 0),
          other: Number(row.other ?? 0),
        },
      ];
    });

  return {
    tracksSingle: mapRows((singleResult.data ?? []) as Record<string, unknown>[]),
    tracksMulti: mapRows((multiResult.data ?? []) as Record<string, unknown>[]),
  };
}

async function loadProjectScopedDashboardData(
  ownerUserId: string,
  projectId: string,
  requestedFolderIds: string[] | null
): Promise<DashboardData> {
  const projectCache = await loadOrBuildProjectCorpusTopicCache(ownerUserId, projectId);
  const activeFolderIds =
    requestedFolderIds && requestedFolderIds.length > 0
      ? requestedFolderIds
      : projectCache.projectFolderIds;
  const activeFolderIdSet = new Set(activeFolderIds);

  const trends = projectCache.cache.trends.filter((row) => {
    if (activeFolderIdSet.size === 0) {
      return true;
    }
    return row.folder_id ? activeFolderIdSet.has(row.folder_id) : false;
  });
  const allowedPaperIds = new Set(trends.map((row) => row.paper_id));
  const topicFamilies = filterTopicFamiliesByPaperIds(
    projectCache.topicFamilies,
    allowedPaperIds
  ).filter((family) =>
    activeFolderIdSet.size === 0
      ? true
      : family.folderIds.some((folderId) => activeFolderIdSet.has(folderId))
  );

  const metadataMap = new Map<PaperId, PaperMetadata>();
  trends.forEach((row) => {
    if (!metadataMap.has(row.paper_id)) {
      metadataMap.set(row.paper_id, {
        paper_id: row.paper_id,
        folder_id: row.folder_id ?? null,
        year: row.year,
        title: row.title,
        ingestion_run_id: null,
      });
    }
  });
  const metadata = [...metadataMap.values()];
  const preferredTrackData = await loadViewData(ownerUserId, [...allowedPaperIds], metadata);
  const trackFallback = await loadTrackTableData(ownerUserId, metadata);

  return {
    trends,
    tracksSingle:
      preferredTrackData?.tracksSingle.length
        ? preferredTrackData.tracksSingle
        : trackFallback.tracksSingle,
    tracksMulti:
      preferredTrackData?.tracksMulti.length
        ? preferredTrackData.tracksMulti
        : trackFallback.tracksMulti,
    topicFamilies,
    useMock: false,
    diagnostics: null,
  };
}

async function loadProjectScopedDashboardFallbackData(
  ownerUserId: string,
  projectId: string,
  requestedFolderIds: string[] | null
): Promise<DashboardData> {
  const scopedFolderIds =
    requestedFolderIds && requestedFolderIds.length > 0
      ? requestedFolderIds
      : await resolveScopedFolderIds(ownerUserId, null, projectId);
  const scopedRunIds = await resolveScopedRunIds(
    ownerUserId,
    scopedFolderIds,
    projectId
  );
  return loadScopedDashboardData(ownerUserId, scopedRunIds);
}

async function loadDashboardDataServerUncached(
  ownerUserId?: string | null,
  folderSelection?: string[] | string | null,
  projectId?: string | null,
  mode: DashboardDataMode = "auto"
): Promise<DashboardData> {
  const requestedFolderIds = normalizeRequestedFolderIds(folderSelection);
  const scopeDescription = describeScope(requestedFolderIds, projectId);

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

    const scopedData =
      projectId && projectId !== "all"
        ? await (async () => {
            try {
              return await loadProjectScopedDashboardData(
                ownerUserId,
                projectId,
                requestedFolderIds
              );
            } catch {
              return loadProjectScopedDashboardFallbackData(
                ownerUserId,
                projectId,
                requestedFolderIds
              );
            }
          })()
        : await (async () => {
            const scopedFolderIds =
              requestedFolderIds && requestedFolderIds.length > 0
                ? requestedFolderIds
                : await resolveScopedFolderIds(
                    ownerUserId,
                    null,
                    projectId
                  );
            const scopedRunIds = await resolveScopedRunIds(
              ownerUserId,
              scopedFolderIds,
              projectId
            );
            return loadScopedDashboardData(ownerUserId, scopedRunIds);
          })();

    if (hasAnyDashboardRows(scopedData)) {
      return withDiagnostics(scopedData, {
        dataSource: "scoped",
        recoveredFromLegacyScope: false,
        scopeDescription,
      });
    }

    if (mode === "auto" && ((requestedFolderIds?.length ?? 0) > 0 || projectId)) {
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
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to assemble live dashboard data.";
    return mode === "live" || Boolean(ownerUserId)
      ? withDiagnostics(emptyDashboardData(), {
          dataSource: "empty",
          recoveredFromLegacyScope: false,
          scopeDescription,
          errorMessage,
        })
      : withDiagnostics(generateMockData(), {
          dataSource: "mock",
          recoveredFromLegacyScope: false,
          scopeDescription: "preview data",
          errorMessage,
        });
  }
}

export async function loadDashboardDataServer(
  ownerUserId?: string | null,
  folderSelection?: string[] | string | null,
  projectId?: string | null,
  mode: DashboardDataMode = "auto"
): Promise<DashboardData> {
  const normalizedFolderIds = normalizeRequestedFolderIds(folderSelection) ?? [];
  const cacheKey = JSON.stringify({
    ownerUserId: ownerUserId ?? null,
    projectId: projectId ?? null,
    mode,
    folderIds: normalizedFolderIds,
  });

  const cached = dashboardServerCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DASHBOARD_SERVER_CACHE_TTL_MS) {
    return cached.data;
  }

  const inFlight = dashboardServerInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const work = loadDashboardDataServerUncached(
    ownerUserId,
    normalizedFolderIds,
    projectId,
    mode
  )
    .then((data) => {
      dashboardServerCache.set(cacheKey, {
        timestamp: Date.now(),
        data,
      });
      return data;
    })
    .finally(() => {
      dashboardServerInFlight.delete(cacheKey);
    });

  dashboardServerInFlight.set(cacheKey, work);
  return work;
}
