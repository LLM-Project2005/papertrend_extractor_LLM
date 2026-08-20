import { createHash } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { getDatabaseProvider } from "@/lib/server-env";
import type { DashboardData, PaperId, TrackRow } from "@/types/database";

const DASHBOARD_SUMMARY_CACHE_VERSION = 1;
const TOP_SUMMARY_LIMIT = 50;

type SummaryCountRow = {
  label: string;
  paperCount: number;
  rowCount: number;
  totalFrequency?: number;
};

export type DashboardSummaryScope = {
  ownerUserId: string;
  projectId?: string | null;
  folderIds?: string[] | null;
};

export type DashboardSummaryCachePayload = {
  summaryVersion: number;
  generatedAt: string;
  scope: {
    type: "workspace" | "project" | "folder" | "custom";
    key: string;
    projectId: string | null;
    folderIds: string[];
  };
  paperCount: number;
  trendRowCount: number;
  trackSingleRowCount: number;
  trackMultiRowCount: number;
  topicFamilyCount: number;
  byYear: SummaryCountRow[];
  byTrackSingle: SummaryCountRow[];
  byTrackMulti: SummaryCountRow[];
  byTopic: SummaryCountRow[];
  byKeyword: SummaryCountRow[];
};

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function normalizeFolderIds(folderIds?: string[] | null): string[] {
  return [...new Set((folderIds ?? []).map((id) => id.trim()).filter(Boolean))].sort();
}

function resolveSummaryScope(scope: DashboardSummaryScope): DashboardSummaryCachePayload["scope"] {
  const folderIds = normalizeFolderIds(scope.folderIds);
  const projectId = scope.projectId && scope.projectId !== "all" ? scope.projectId : null;

  if (folderIds.length === 1) {
    return {
      type: "folder",
      key: folderIds[0],
      projectId,
      folderIds,
    };
  }

  if (folderIds.length > 1) {
    return {
      type: "custom",
      key: stableHash({ projectId, folderIds }),
      projectId,
      folderIds,
    };
  }

  if (projectId) {
    return {
      type: "project",
      key: projectId,
      projectId,
      folderIds,
    };
  }

  return {
    type: "workspace",
    key: "all",
    projectId: null,
    folderIds,
  };
}

function sortedCountRows(
  rows: Map<string, { papers: Set<PaperId>; rowCount: number; totalFrequency: number }>,
  limit = TOP_SUMMARY_LIMIT
): SummaryCountRow[] {
  return [...rows.entries()]
    .map(([label, value]) => ({
      label,
      paperCount: value.papers.size,
      rowCount: value.rowCount,
      totalFrequency: value.totalFrequency,
    }))
    .sort(
      (a, b) =>
        b.paperCount - a.paperCount ||
        (b.totalFrequency ?? 0) - (a.totalFrequency ?? 0) ||
        a.label.localeCompare(b.label)
    )
    .slice(0, limit);
}

function addCount(
  rows: Map<string, { papers: Set<PaperId>; rowCount: number; totalFrequency: number }>,
  label: string,
  paperId: PaperId,
  frequency = 1
) {
  const normalizedLabel = label.trim() || "Unknown";
  const current =
    rows.get(normalizedLabel) ?? { papers: new Set<PaperId>(), rowCount: 0, totalFrequency: 0 };
  current.papers.add(paperId);
  current.rowCount += 1;
  current.totalFrequency += Math.max(Number(frequency || 0), 0);
  rows.set(normalizedLabel, current);
}

function addTrackCounts(
  rows: Map<string, { papers: Set<PaperId>; rowCount: number; totalFrequency: number }>,
  trackRows: TrackRow[]
) {
  for (const row of trackRows) {
  if (row.el > 0) addCount(rows, "Category 1", row.paper_id);
  if (row.eli > 0) addCount(rows, "Category 2", row.paper_id);
  if (row.lae > 0) addCount(rows, "Category 3", row.paper_id);
  if (row.other > 0) addCount(rows, "Other / Unclassified", row.paper_id);
  }
}

export function buildDashboardSummaryPayload(
  data: DashboardData,
  scope: DashboardSummaryScope
): DashboardSummaryCachePayload {
  const resolvedScope = resolveSummaryScope(scope);
  const paperIds = new Set<PaperId>();
  const byYear = new Map<string, { papers: Set<PaperId>; rowCount: number; totalFrequency: number }>();
  const byTrackSingle = new Map<string, { papers: Set<PaperId>; rowCount: number; totalFrequency: number }>();
  const byTrackMulti = new Map<string, { papers: Set<PaperId>; rowCount: number; totalFrequency: number }>();
  const byTopic = new Map<string, { papers: Set<PaperId>; rowCount: number; totalFrequency: number }>();
  const byKeyword = new Map<string, { papers: Set<PaperId>; rowCount: number; totalFrequency: number }>();

  for (const row of data.tracksSingle) {
    paperIds.add(row.paper_id);
    addCount(byYear, row.year || "Unknown", row.paper_id);
  }

  for (const row of data.trends) {
    paperIds.add(row.paper_id);
    addCount(byYear, row.year || "Unknown", row.paper_id);
    addCount(byTopic, row.topic || "Unclassified", row.paper_id, row.keyword_frequency);
    addCount(byKeyword, row.keyword || "Unknown keyword", row.paper_id, row.keyword_frequency);
  }

  for (const family of data.topicFamilies ?? []) {
    for (const paperId of family.paperIds) {
      paperIds.add(paperId);
    }
  }

  addTrackCounts(byTrackSingle, data.tracksSingle);
  addTrackCounts(byTrackMulti, data.tracksMulti);

  return {
    summaryVersion: DASHBOARD_SUMMARY_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    scope: resolvedScope,
    paperCount: paperIds.size,
    trendRowCount: data.trends.length,
    trackSingleRowCount: data.tracksSingle.length,
    trackMultiRowCount: data.tracksMulti.length,
    topicFamilyCount: data.topicFamilies?.length ?? 0,
    byYear: sortedCountRows(byYear),
    byTrackSingle: sortedCountRows(byTrackSingle),
    byTrackMulti: sortedCountRows(byTrackMulti),
    byTopic: sortedCountRows(byTopic),
    byKeyword: sortedCountRows(byKeyword),
  };
}

export function buildDashboardSummaryVersionHash(payload: DashboardSummaryCachePayload): string {
  return stableHash({
    version: payload.summaryVersion,
    paperCount: payload.paperCount,
    trendRowCount: payload.trendRowCount,
    trackSingleRowCount: payload.trackSingleRowCount,
    trackMultiRowCount: payload.trackMultiRowCount,
    topicFamilyCount: payload.topicFamilyCount,
    byYear: payload.byYear,
    byTrackSingle: payload.byTrackSingle,
    byTrackMulti: payload.byTrackMulti,
    byTopic: payload.byTopic,
    byKeyword: payload.byKeyword,
  });
}

export async function materializeDashboardSummaryCache(
  data: DashboardData,
  scope: DashboardSummaryScope
): Promise<void> {
  if (!scope.ownerUserId || data.useMock) {
    return;
  }

  const payload = buildDashboardSummaryPayload(data, scope);
  if (getDatabaseProvider() === "cloud-sql") {
    await withCloudSqlOwnerTransaction(scope.ownerUserId, (client) =>
      client.query(
        `
          INSERT INTO public.workspace_analytics_cache (
            owner_user_id, scope_type, scope_key, version_hash, payload, updated_at
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
          ON CONFLICT (owner_user_id, scope_type, scope_key)
          DO UPDATE SET
            version_hash = EXCLUDED.version_hash,
            payload = EXCLUDED.payload,
            updated_at = NOW()
        `,
        [
          scope.ownerUserId,
          payload.scope.type,
          payload.scope.key,
          buildDashboardSummaryVersionHash(payload),
          JSON.stringify(payload),
        ]
      )
    );
    return;
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("workspace_analytics_cache")
    .upsert(
      {
        owner_user_id: scope.ownerUserId,
        scope_type: payload.scope.type,
        scope_key: payload.scope.key,
        version_hash: buildDashboardSummaryVersionHash(payload),
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_user_id,scope_type,scope_key" }
    );

  if (error) {
    console.warn("dashboard summary cache write skipped", error.message);
  }
}

export async function loadDashboardSummaryCache(
  scope: DashboardSummaryScope
): Promise<DashboardSummaryCachePayload | null> {
  if (!scope.ownerUserId) {
    return null;
  }

  const resolvedScope = resolveSummaryScope(scope);
  if (getDatabaseProvider() === "cloud-sql") {
    return withCloudSqlOwnerTransaction(scope.ownerUserId, async (client) => {
      const result = await client.query<{ payload: DashboardSummaryCachePayload }>(
        `
          SELECT payload
          FROM public.workspace_analytics_cache
          WHERE owner_user_id = $1
            AND scope_type = $2
            AND scope_key = $3
          LIMIT 1
        `,
        [scope.ownerUserId, resolvedScope.type, resolvedScope.key]
      );
      return result.rows[0]?.payload ?? null;
    });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("workspace_analytics_cache")
    .select("payload")
    .eq("owner_user_id", scope.ownerUserId)
    .eq("scope_type", resolvedScope.type)
    .eq("scope_key", resolvedScope.key)
    .maybeSingle();

  if (error) {
    console.warn("dashboard summary cache read skipped", error.message);
    return null;
  }

  return (data?.payload ?? null) as DashboardSummaryCachePayload | null;
}
