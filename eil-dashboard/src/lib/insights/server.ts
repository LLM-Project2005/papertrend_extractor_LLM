/*
 * Server side of the Adaptive insights: loads the selection, the per-paper
 * profile the analysis stored, and the cached plan.
 *
 * Every query is owner-scoped. The profile tables are read in three batched
 * queries for the whole selection; nothing here calls a model.
 */
import { createHash } from "crypto";
import { loadDashboardDataServer } from "@/lib/dashboard-data-server";
import { filterDashboardData } from "@/lib/dashboard-filters";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { getDatabaseProvider } from "@/lib/server-env";
import { buildInsightCorpus, type InsightCorpus, type PaperProfile } from "@/lib/insights/corpus";
import { buildInsightReport } from "@/lib/insights/engine";
import { INSIGHTS_PROMPT_VERSION, type InsightContext } from "@/lib/insights/plan";
import type { InsightPlan, InsightReport } from "@/lib/insights/types";
import type { PaperId } from "@/types/database";

export interface InsightRequest {
  ownerUserId: string;
  projectId: string;
  selectedYears: string[];
  selectedTracks: string[];
  searchQuery: string;
  fresh?: boolean;
}

export async function loadPaperProfiles(ownerUserId: string, paperIds: PaperId[]): Promise<Map<PaperId, PaperProfile>> {
  const profiles = new Map<PaperId, PaperProfile>();
  if (paperIds.length === 0 || getDatabaseProvider() !== "cloud-sql") return profiles;
  const ids = paperIds.map(String);
  const profileOf = (id: string) => {
    const existing = profiles.get(id);
    if (existing) return existing;
    const created: PaperProfile = { aims: [], contributions: [], authorKeywords: [] };
    profiles.set(id, created);
    return created;
  };
  await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const [typologies, facets, authorKeywords, duplicates, years] = await Promise.all([
      client.query<{ paper_id: string; number: number; name: string }>(
        `SELECT paper_id::text, primary_group_number AS number, primary_group_name AS name
         FROM public.paper_research_typologies WHERE owner_user_id = $1 AND paper_id = ANY($2::bigint[])`,
        [ownerUserId, ids]
      ),
      client.query<{ paper_id: string; facet_type: string; label: string }>(
        `SELECT paper_id::text, facet_type, label
         FROM public.paper_analysis_facets WHERE owner_user_id = $1 AND paper_id = ANY($2::bigint[])`,
        [ownerUserId, ids]
      ),
      client.query<{ paper_id: string; keyword: string }>(
        `SELECT paper_id::text, keyword
         FROM public.paper_author_keywords WHERE owner_user_id = $1 AND paper_id = ANY($2::bigint[])
         ORDER BY paper_id, position`,
        [ownerUserId, ids]
      ),
      client.query<{ paper_id: string; duplicate_of: string | null }>(
        `SELECT pc.paper_id::text, ir.input_payload->'duplicate_of'->>'paper_id' AS duplicate_of
         FROM public.paper_content pc
         JOIN public.ingestion_runs ir ON ir.id = pc.ingestion_run_id AND ir.owner_user_id = $1
         WHERE pc.owner_user_id = $1 AND pc.paper_id = ANY($2::bigint[])
           AND jsonb_typeof(ir.input_payload->'duplicate_of') = 'object'`,
        [ownerUserId, ids]
      ),
      client.query<{ paper_id: string; year_confidence: string | null }>(
        `SELECT id::text AS paper_id, year_confidence::text
         FROM public.papers WHERE owner_user_id = $1 AND id = ANY($2::bigint[])`,
        [ownerUserId, ids]
      ),
    ]);

    // The typology has had two sets of group names (EIL and General) over the
    // same four numbered groups; a repository that changed profile has both.
    // Name each group by the label most of its papers carry.
    const names = new Map<number, Map<string, number>>();
    for (const row of typologies.rows) {
      const counts = names.get(row.number) ?? new Map<string, number>();
      counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
      names.set(row.number, counts);
    }
    const nameOf = (number: number) =>
      [...(names.get(number)?.entries() ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    for (const row of typologies.rows) profileOf(row.paper_id).typology = nameOf(row.number);
    for (const row of facets.rows) {
      const profile = profileOf(row.paper_id);
      (row.facet_type === "objective_verb" ? profile.aims! : profile.contributions!).push(row.label);
    }
    for (const row of authorKeywords.rows) profileOf(row.paper_id).authorKeywords!.push(row.keyword);
    for (const row of duplicates.rows) if (row.duplicate_of) profileOf(row.paper_id).duplicateOf = row.duplicate_of;
    for (const row of years.rows) {
      const value = row.year_confidence === null ? null : Number(row.year_confidence);
      if (value !== null && Number.isFinite(value)) profileOf(row.paper_id).yearConfidence = value;
    }
  });
  return profiles;
}

async function loadContext(ownerUserId: string, projectId: string, categories: string[]): Promise<InsightContext> {
  if (getDatabaseProvider() !== "cloud-sql") return { categories };
  const project = await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query<{ name: string | null; domain: string | null; display_name: string | null }>(
      `SELECT name, analysis_profile->>'domain' AS domain, analysis_profile->>'displayName' AS display_name
       FROM public.workspace_projects WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
      [projectId, ownerUserId]
    )
  );
  const row = project.rows[0];
  return {
    repositoryName: row?.name ?? null,
    domain: (row?.domain || row?.display_name || "").slice(0, 200) || null,
    categories,
  };
}

function describeSelection(years: string[], categories: string[], search: string, allYears: string[]): string {
  const parts: string[] = [];
  const chosen = years.filter((year) => allYears.includes(year)).sort();
  if (chosen.length > 0 && chosen.length < allYears.length) {
    parts.push(chosen.length === 1 ? `the year ${chosen[0]}` : `years ${chosen[0]}–${chosen[chosen.length - 1]}`);
  }
  if (categories.length) parts.push(`categories: ${categories.join(", ")}`);
  if (search.trim()) parts.push(`papers matching "${search.trim().slice(0, 80)}"`);
  return parts.length ? parts.join("; ") : "the whole repository";
}

export interface BuiltInsights {
  report: InsightReport;
  context: InsightContext;
  corpus: InsightCorpus;
  /** Changes whenever the selected papers or anything computed from them does. */
  dataHash: string;
  /** Changes with the set of papers selected. */
  filterHash: string;
}

export async function buildInsightsForRequest(request: InsightRequest): Promise<BuiltInsights> {
  const data = await loadDashboardDataServer(request.ownerUserId, [], request.projectId, "live", { fresh: request.fresh });
  const filtered = filterDashboardData(data, request.selectedYears, request.selectedTracks, request.searchQuery);
  const paperIds = [...new Set(filtered.trends.map((row) => row.paper_id))];
  const profiles = await loadPaperProfiles(request.ownerUserId, paperIds).catch((error) => {
    // The insights that need profiles drop out; the rest still stand.
    console.warn("insight_profiles_unavailable", error instanceof Error ? error.message : String(error));
    return new Map<PaperId, PaperProfile>();
  });
  const corpus = buildInsightCorpus({ ...filtered, classificationEnabled: data.classificationEnabled }, profiles);
  const report = buildInsightReport(corpus);

  const allYears = [...new Set(data.trends.map((row) => row.year))];
  const categoryLabels = [
    ...new Set(
      (filtered.categoryAssignments ?? [])
        .filter((row) => row.assignment_type === "single")
        .map((row) => row.category_label)
        .filter(Boolean)
    ),
  ];
  const selectedLabels = (data.categoryAssignments ?? [])
    .filter((row) => request.selectedTracks.includes(row.category_key))
    .map((row) => row.category_label);
  const allCategoryKeys = new Set((data.categoryAssignments ?? []).map((row) => row.category_key));
  const narrowed = request.selectedTracks.filter((key) => allCategoryKeys.has(key));
  const context: InsightContext = await loadContext(
    request.ownerUserId,
    request.projectId,
    data.classificationEnabled === false ? [] : categoryLabels
  ).catch(() => ({ categories: categoryLabels }));
  context.selection = describeSelection(
    request.selectedYears,
    narrowed.length > 0 && narrowed.length < allCategoryKeys.size ? [...new Set(selectedLabels)] : [],
    request.searchQuery,
    allYears
  );

  const dataHash = createHash("sha256")
    .update(JSON.stringify(report))
    .update(JSON.stringify(context))
    .digest("hex")
    .slice(0, 32);
  // Keyed by the papers selected, not by how the filters were spelled: the
  // dashboard's default category selection and no selection pick the same
  // papers, and must find the same write-up.
  const filterHash = createHash("sha256")
    .update(JSON.stringify(corpus.papers.map((paper) => String(paper.id)).sort()))
    .digest("hex")
    .slice(0, 24);
  return { report, context, corpus, dataHash, filterHash };
}

/* ------------------------------------------------------------- the cache */

function cacheKey(projectId: string, filterHash: string): string {
  return `insights:${projectId}:${filterHash}`;
}

function cacheVersion(dataHash: string): string {
  return `${INSIGHTS_PROMPT_VERSION}:${dataHash}`;
}

/** A written plan for exactly these papers and this prompt, or null. */
export async function readCachedPlan(ownerUserId: string, built: BuiltInsights, projectId: string): Promise<InsightPlan | null> {
  if (getDatabaseProvider() !== "cloud-sql") return null;
  const result = await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query<{ payload: { plan?: InsightPlan } }>(
      `SELECT payload FROM public.workspace_analytics_cache
       WHERE owner_user_id = $1 AND scope_type = 'custom' AND scope_key = $2 AND version_hash = $3
       LIMIT 1`,
      [ownerUserId, cacheKey(projectId, built.filterHash), cacheVersion(built.dataHash)]
    )
  );
  const plan = result.rows[0]?.payload?.plan;
  return plan && Array.isArray(plan.cards) ? plan : null;
}

export async function writeCachedPlan(ownerUserId: string, built: BuiltInsights, projectId: string, plan: InsightPlan): Promise<void> {
  if (getDatabaseProvider() !== "cloud-sql") return;
  await withCloudSqlOwnerTransaction(ownerUserId, (client) =>
    client.query(
      `INSERT INTO public.workspace_analytics_cache (owner_user_id, scope_type, scope_key, version_hash, payload, updated_at)
       VALUES ($1, 'custom', $2, $3, $4::jsonb, now())
       ON CONFLICT (owner_user_id, scope_type, scope_key)
       DO UPDATE SET version_hash = EXCLUDED.version_hash, payload = EXCLUDED.payload, updated_at = now()`,
      [ownerUserId, cacheKey(projectId, built.filterHash), cacheVersion(built.dataHash), JSON.stringify({ plan })]
    )
  );
}
