import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function extractTrackLabels(row: Record<string, unknown> | null): string[] {
  if (!row) {
    return [];
  }

  return TRACK_COLS.filter((track) => {
    const field = track.toLowerCase() as "el" | "eli" | "lae" | "other";
    return Number(row[field] ?? 0) === 1;
  }).map((track) => `${track} - ${TRACK_NAMES[track as TrackKey]}`);
}

function coerceJsonStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
      }
    } catch {
      return [trimmed];
    }
    return [trimmed];
  }
  return [];
}

async function resolveRelatedRunIds(
  ownerUserId: string,
  runId: string
): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const resolved = new Set<string>([runId]);
  let currentRunId = runId;

  for (let hop = 0; hop < 5; hop += 1) {
    const { data, error } = await supabase
      .from("ingestion_runs")
      .select("copied_from_run_id")
      .eq("owner_user_id", ownerUserId)
      .eq("id", currentRunId)
      .maybeSingle();

    if (error || !data?.copied_from_run_id) {
      break;
    }

    const nextRunId = String(data.copied_from_run_id);
    if (!nextRunId || resolved.has(nextRunId)) {
      break;
    }

    resolved.add(nextRunId);
    currentRunId = nextRunId;
  }

  return [...resolved];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { runId } = await params;
    const supabase = getSupabaseAdmin();
    const relatedRunIds = await resolveRelatedRunIds(user.id, runId);

    const { data: run, error: runError } = await supabase
      .from("ingestion_runs")
      .select("*")
      .eq("owner_user_id", user.id)
      .eq("id", runId)
      .maybeSingle();

    if (runError || !run) {
      throw new Error(runError?.message ?? "Library file not found.");
    }

    const { data: papers, error: papersError } = await supabase
      .from("papers_full")
      .select(
        "paper_id,title,year,abstract_claims,methods,results,conclusion,source_filename,ingestion_run_id"
      )
      .eq("owner_user_id", user.id)
      .in("ingestion_run_id", relatedRunIds);

    if (papersError) {
      throw new Error(papersError.message);
    }

    const orderedPapers = (papers ?? []).sort((left, right) => {
      const leftIndex = relatedRunIds.indexOf(String(left.ingestion_run_id ?? ""));
      const rightIndex = relatedRunIds.indexOf(String(right.ingestion_run_id ?? ""));
      return leftIndex - rightIndex;
    });

    const paper = orderedPapers[0];
    if (!paper) {
      return NextResponse.json({
        run,
        analysis: {
          available: false,
          topics: [],
          keywords: [],
          concepts: [],
          facets: [],
          tracksSingle: [],
          tracksMulti: [],
        },
      });
    }

    const paperId = Number(paper.paper_id ?? 0);
    const [trendsResult, keywordsResult, conceptsResult, facetsResult, singleResult, multiResult] = await Promise.all([
      supabase
        .from("trends_flat")
        .select("topic,keyword,keyword_frequency,evidence")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId),
      supabase
        .from("paper_keywords")
        .select("topic,keyword,keyword_frequency,evidence")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId),
      supabase
        .from("paper_keyword_concepts")
        .select(
          "concept_label,matched_terms,related_keywords,total_frequency,first_evidence,evidence_snippets"
        )
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId),
      supabase
        .from("paper_analysis_facets")
        .select("facet_type,label,evidence")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId),
      supabase
        .from("tracks_single_flat")
        .select("el,eli,lae,other")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId)
        .maybeSingle(),
      supabase
        .from("tracks_multi_flat")
        .select("el,eli,lae,other")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId)
        .maybeSingle(),
    ]);

    if (trendsResult.error) {
      throw new Error(trendsResult.error.message);
    }
    if (keywordsResult.error) {
      throw new Error(keywordsResult.error.message);
    }
    if (conceptsResult.error) {
      throw new Error(conceptsResult.error.message);
    }
    if (facetsResult.error) {
      throw new Error(facetsResult.error.message);
    }
    if (singleResult.error) {
      throw new Error(singleResult.error.message);
    }
    if (multiResult.error) {
      throw new Error(multiResult.error.message);
    }

    const trendKeywordRows = (trendsResult.data ?? []) as Array<{
      topic?: string | null;
      keyword?: string | null;
      keyword_frequency?: number | null;
      evidence?: string | null;
    }>;
    const canonicalKeywordRows = (keywordsResult.data ?? []) as Array<{
      topic?: string | null;
      keyword?: string | null;
      keyword_frequency?: number | null;
      evidence?: string | null;
    }>;
    const keywordRows = (trendKeywordRows.length > 0 ? trendKeywordRows : canonicalKeywordRows)
      .map((row) => ({
        keyword: String(row.keyword ?? ""),
        topic: String(row.topic ?? ""),
        frequency: Number(row.keyword_frequency ?? 0),
        evidence: String(row.evidence ?? ""),
      }))
      .filter((row) => row.keyword || row.topic || row.evidence);
    const conceptRows = ((conceptsResult.data ?? []) as Array<{
      concept_label?: string | null;
      matched_terms?: unknown;
      related_keywords?: unknown;
      total_frequency?: number | null;
      first_evidence?: string | null;
      evidence_snippets?: unknown;
    }>).map((row) => ({
      label: String(row.concept_label ?? ""),
      matchedTerms: coerceJsonStringList(row.matched_terms),
      relatedKeywords: coerceJsonStringList(row.related_keywords),
      totalFrequency: Number(row.total_frequency ?? 0),
      firstEvidence: String(row.first_evidence ?? ""),
      evidenceSnippets: coerceJsonStringList(row.evidence_snippets),
    })).filter((row) => row.label);
    const facetRows = ((facetsResult.data ?? []) as Array<{
      facet_type?: string | null;
      label?: string | null;
      evidence?: string | null;
    }>).map((row) => ({
      facetType: String(row.facet_type ?? ""),
      label: String(row.label ?? ""),
      evidence: String(row.evidence ?? ""),
    })).filter((row) => row.label);

    const topics = [
      ...new Set([
        ...conceptRows.map((row) => row.label).filter(Boolean),
        ...keywordRows.map((row) => row.topic).filter(Boolean),
      ]),
    ];

    return NextResponse.json({
      run,
      analysis: {
        available: true,
        paper_id: paperId,
        title: String(paper.title ?? ""),
        year: String(paper.year ?? ""),
        abstract_claims: paper.abstract_claims ?? null,
        methods: paper.methods ?? null,
        results: paper.results ?? null,
        conclusion: paper.conclusion ?? null,
        source_filename: paper.source_filename ?? null,
        ingestion_run_id: paper.ingestion_run_id ?? null,
        topics,
        keywords: keywordRows,
        concepts: conceptRows,
        facets: facetRows,
        tracksSingle: extractTrackLabels(
          (singleResult.data as Record<string, unknown> | null) ?? null
        ),
        tracksMulti: extractTrackLabels(
          (multiResult.data as Record<string, unknown> | null) ?? null
        ),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load analysis details.",
      },
      { status: 500 }
    );
  }
}
