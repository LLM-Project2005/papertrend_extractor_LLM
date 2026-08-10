import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import { normalizePaperId, paperIdFromRunId } from "@/lib/paper-id";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getDatabaseProvider } from "@/lib/server-env";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";

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

function cleanSectionText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function looksWeakSection(sectionName: string, value: string): boolean {
  if (!value) {
    return true;
  }
  if (value.length < 120) {
    return true;
  }

  if (
    sectionName !== "abstract_claims" &&
    /^[a-z]/.test(value) &&
    !/^(this|the|we|our|in|participants|phase|data|results|findings|conclusion|project|three|two|one)\b/i.test(
      value
    )
  ) {
    return true;
  }

  return false;
}

function segmentByHeadings(text: string): Record<string, string> {
  const sectionPatterns: Array<[string, string[]]> = [
    ["abstract_claims", ["abstract", "summary"]],
    ["methods", ["methods", "methodology", "materials and methods", "research method"]],
    ["results", ["results", "findings", "results and discussion", "discussion"]],
    ["conclusion", ["conclusion", "conclusions", "implications", "closing remarks"]],
  ];

  const matches: Array<{ start: number; end: number; key: string }> = [];
  for (const [key, labels] of sectionPatterns) {
    const pattern = new RegExp(
      `^\\s*(?:#+\\s*)?(?:${labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*$`,
      "gim"
    );
    const match = pattern.exec(text);
    if (match) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        key,
      });
    }
  }

  matches.sort((left, right) => left.start - right.start);
  const sections: Record<string, string> = {};

  matches.forEach((match, index) => {
    const nextStart = matches[index + 1]?.start ?? text.length;
    sections[match.key] = cleanSectionText(text.slice(match.end, nextStart));
  });

  if (!sections.abstract_claims && text.length > 0) {
    sections.abstract_claims = cleanSectionText(text.slice(0, 1800));
  }
  if (!sections.conclusion && text.length > 1800) {
    sections.conclusion = cleanSectionText(text.slice(-1800));
  }

  return sections;
}

function resolveSectionValue(
  sectionName: "abstract_claims" | "methods" | "results" | "conclusion",
  primaryValue: unknown,
  fallbackSections: Record<string, string>,
  warnings: string[]
): string | null {
  const cleaned = cleanSectionText(primaryValue);
  if (!looksWeakSection(sectionName, cleaned)) {
    return cleaned;
  }

  const fallback = cleanSectionText(fallbackSections[sectionName] ?? "");
  if (fallback && !looksWeakSection(sectionName, fallback)) {
    warnings.push(
      `Recovered ${sectionName.replace(/_/g, " ")} from heading-based fallback because the stored section looked incomplete.`
    );
    return fallback;
  }

  return cleaned || fallback || null;
}

async function resolveRelatedRunIds(
  ownerUserId: string,
  runId: string
): Promise<string[]> {
  if (getDatabaseProvider() === "cloud-sql") {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const resolved = new Set<string>([runId]);
      let current = runId;
      for (let hop = 0; hop < 5; hop += 1) {
        const result = await client.query<{ copied_from_run_id: string | null }>(
          `SELECT copied_from_run_id FROM public.ingestion_runs WHERE owner_user_id=$1 AND id=$2`,
          [ownerUserId, current]
        );
        const next = result.rows[0]?.copied_from_run_id;
        if (!next || resolved.has(next)) break;
        resolved.add(next);
        current = next;
      }
      return [...resolved];
    });
  }
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
    const useCloudSql = getDatabaseProvider() === "cloud-sql";
    const supabase = useCloudSql ? null : getSupabaseAdmin();
    const relatedRunIds = await resolveRelatedRunIds(user.id, runId);

    const cloudBase = useCloudSql ? await withCloudSqlOwnerTransaction(user.id, async (client) => {
      const [runResult, paperResult] = await Promise.all([
        client.query<Record<string, unknown>>(`SELECT * FROM public.ingestion_runs WHERE owner_user_id=$1 AND id=$2`, [user.id, runId]),
        client.query<Record<string, unknown>>(
          `SELECT p.id::text AS paper_id,p.title,p.year,p.folder_id,c.ingestion_run_id,
           c.abstract_claims,c.methods,c.results,c.conclusion,c.raw_text,c.source_filename
           FROM public.paper_content c
           JOIN public.papers p ON p.id=c.paper_id AND p.owner_user_id=$1
           WHERE c.owner_user_id=$1 AND c.ingestion_run_id=ANY($2::uuid[])`,
          [user.id, relatedRunIds]
        ),
      ]);
      return { run: runResult.rows[0] ?? null, papers: paperResult.rows };
    }) : null;

    const runResult = useCloudSql ? { data: cloudBase?.run ?? null, error: null } : await supabase!
      .from("ingestion_runs")
      .select("*")
      .eq("owner_user_id", user.id)
      .eq("id", runId)
      .maybeSingle();
    const { data: run, error: runError } = runResult;

    if (runError || !run) {
      throw new Error(runError?.message ?? "Library file not found.");
    }

    const papersResult = useCloudSql ? { data: cloudBase?.papers ?? [], error: null } : await supabase!
      .from("papers_full")
      .select(
        "paper_id::text,title,year,abstract_claims,methods,results,conclusion,raw_text,source_filename,ingestion_run_id"
      )
      .eq("owner_user_id", user.id)
      .in("ingestion_run_id", relatedRunIds);
    const { data: papers, error: papersError } = papersResult;

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

    const paperId =
      normalizePaperId(paper.paper_id) ||
      paperIdFromRunId(String(paper.ingestion_run_id ?? "")) ||
      paperIdFromRunId(runId);

    const cloudDetails = useCloudSql ? await withCloudSqlOwnerTransaction(user.id, async (client) => {
      const query = (table: string, columns: string) => client.query<Record<string, unknown>>(
        `SELECT ${columns} FROM public.${table} WHERE owner_user_id=$1 AND paper_id=$2`, [user.id, paperId]
      );
      const [content, keywords, concepts, facets, single, multi] = await Promise.all([
        query("paper_content", "raw_text,abstract_claims,methods,results,conclusion,source_filename,ingestion_run_id"),
        query("paper_keywords", "topic,keyword,keyword_frequency,evidence"),
        query("paper_keyword_concepts", "concept_label,matched_terms,related_keywords,total_frequency,first_evidence,evidence_snippets"),
        query("paper_analysis_facets", "facet_type,label,evidence"),
        query("paper_tracks_single", "el,eli,lae,other"),
        query("paper_tracks_multi", "el,eli,lae,other"),
      ]);
      const wrap = (rows: Record<string, unknown>[], singleRow = false) => ({ data: singleRow ? rows[0] ?? null : rows, error: null });
      return [wrap(content.rows, true), wrap(keywords.rows), wrap(concepts.rows), wrap(facets.rows), wrap(single.rows, true), wrap(multi.rows, true), wrap([]), wrap([], true), wrap([], true)] as const;
    }) : null;

    const [
      paperContentResult,
      keywordsResult,
      conceptsResult,
      facetsResult,
      singleResult,
      multiResult,
      fallbackTrendKeywordsResult,
      fallbackSingleResult,
      fallbackMultiResult,
    ] = cloudDetails ?? await Promise.all([
      supabase!
        .from("paper_content")
        .select(
          "raw_text,abstract_claims,methods,results,conclusion,source_filename,ingestion_run_id"
        )
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId)
        .maybeSingle(),
      supabase!
        .from("paper_keywords")
        .select("topic,keyword,keyword_frequency,evidence")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId),
      supabase!
        .from("paper_keyword_concepts")
        .select(
          "concept_label,matched_terms,related_keywords,total_frequency,first_evidence,evidence_snippets"
        )
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId),
      supabase!
        .from("paper_analysis_facets")
        .select("facet_type,label,evidence")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId),
      supabase!
        .from("paper_tracks_single")
        .select("el,eli,lae,other")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId)
        .maybeSingle(),
      supabase!
        .from("paper_tracks_multi")
        .select("el,eli,lae,other")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId)
        .maybeSingle(),
      supabase!
        .from("trends_flat")
        .select("topic,keyword,keyword_frequency,evidence")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId),
      supabase!
        .from("tracks_single_flat")
        .select("el,eli,lae,other")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId)
        .maybeSingle(),
      supabase!
        .from("tracks_multi_flat")
        .select("el,eli,lae,other")
        .eq("owner_user_id", user.id)
        .eq("paper_id", paperId)
        .maybeSingle(),
    ]);

    for (const result of [
      paperContentResult,
      keywordsResult,
      conceptsResult,
      facetsResult,
      singleResult,
      multiResult,
      fallbackTrendKeywordsResult,
      fallbackSingleResult,
      fallbackMultiResult,
    ]) {
      if (result.error) {
        throw new Error(result.error.message);
      }
    }

    const warnings: string[] = [];
    const missingOutputs: string[] = [];

    const paperContent = (paperContentResult.data as Record<string, unknown> | null) ?? null;
    const rawText = cleanSectionText(
      paperContent?.raw_text ?? paper.raw_text ?? ""
    );
    const fallbackSections = rawText ? segmentByHeadings(rawText) : {};

    const abstractClaims = resolveSectionValue(
      "abstract_claims",
      paperContent?.abstract_claims ?? paper.abstract_claims,
      fallbackSections,
      warnings
    );
    const methods = resolveSectionValue(
      "methods",
      paperContent?.methods ?? paper.methods,
      fallbackSections,
      warnings
    );
    const results = resolveSectionValue(
      "results",
      paperContent?.results ?? paper.results,
      fallbackSections,
      warnings
    );
    const conclusion = resolveSectionValue(
      "conclusion",
      paperContent?.conclusion ?? paper.conclusion,
      fallbackSections,
      warnings
    );

    const canonicalKeywordRows = ((keywordsResult.data ?? []) as Array<{
      topic?: string | null;
      keyword?: string | null;
      keyword_frequency?: number | null;
      evidence?: string | null;
    }>)
      .map((row) => ({
        keyword: String(row.keyword ?? "").trim(),
        topic: String(row.topic ?? "").trim(),
        frequency: Number(row.keyword_frequency ?? 0),
        evidence: cleanSectionText(row.evidence ?? ""),
      }))
      .filter((row) => row.keyword);

    const fallbackKeywordRows = ((fallbackTrendKeywordsResult.data ?? []) as Array<{
      topic?: string | null;
      keyword?: string | null;
      keyword_frequency?: number | null;
      evidence?: string | null;
    }>)
      .map((row) => ({
        keyword: String(row.keyword ?? "").trim(),
        topic: String(row.topic ?? "").trim(),
        frequency: Number(row.keyword_frequency ?? 0),
        evidence: cleanSectionText(row.evidence ?? ""),
      }))
      .filter((row) => row.keyword);

    const keywords =
      canonicalKeywordRows.length > 0 ? canonicalKeywordRows : fallbackKeywordRows;
    const keywordDataSource =
      canonicalKeywordRows.length > 0
        ? "canonical"
        : fallbackKeywordRows.length > 0
          ? "keyword_view_fallback"
          : "missing";

    if (keywordDataSource === "keyword_view_fallback") {
      warnings.push(
        "Canonical keyword rows were missing, so the keyword list was recovered from the dashboard view."
      );
      missingOutputs.push("canonical_keywords");
    } else if (keywordDataSource === "missing") {
      warnings.push("No grounded keyword rows were stored for this paper.");
      missingOutputs.push("keywords");
    }

    const concepts = ((conceptsResult.data ?? []) as Array<{
      concept_label?: string | null;
      matched_terms?: unknown;
      related_keywords?: unknown;
      total_frequency?: number | null;
      first_evidence?: string | null;
      evidence_snippets?: unknown;
    }>)
      .map((row) => ({
        label: String(row.concept_label ?? "").trim(),
        matchedTerms: coerceJsonStringList(row.matched_terms),
        relatedKeywords: coerceJsonStringList(row.related_keywords),
        totalFrequency: Number(row.total_frequency ?? 0),
        firstEvidence: cleanSectionText(row.first_evidence ?? ""),
        evidenceSnippets: coerceJsonStringList(row.evidence_snippets).map(cleanSectionText),
      }))
      .filter((row) => row.label)
      .sort((left, right) => right.totalFrequency - left.totalFrequency);

    if (concepts.length === 0) {
      warnings.push("No canonical topic/concept groups were stored for this paper.");
      missingOutputs.push("concepts");
    }

    const facets = ((facetsResult.data ?? []) as Array<{
      facet_type?: string | null;
      label?: string | null;
      evidence?: string | null;
    }>)
      .map((row) => ({
        facetType: String(row.facet_type ?? "").trim(),
        label: String(row.label ?? "").trim(),
        evidence: cleanSectionText(row.evidence ?? ""),
      }))
      .filter((row) => row.label);

    if (facets.length === 0) {
      warnings.push("No analytical facets were stored for this paper.");
      missingOutputs.push("facets");
    }

    const tracksSingle = extractTrackLabels(
      ((singleResult.data as Record<string, unknown> | null) ??
        (fallbackSingleResult.data as Record<string, unknown> | null) ??
        null)
    );
    const tracksMulti = extractTrackLabels(
      ((multiResult.data as Record<string, unknown> | null) ??
        (fallbackMultiResult.data as Record<string, unknown> | null) ??
        null)
    );

    if (
      !singleResult.data &&
      fallbackSingleResult.data &&
      tracksSingle.length > 0
    ) {
      warnings.push(
        "Recovered the primary track label from the flattened dashboard view because the canonical row was missing."
      );
      missingOutputs.push("canonical_tracks_single");
    }
    if (
      !multiResult.data &&
      fallbackMultiResult.data &&
      tracksMulti.length > 0
    ) {
      warnings.push(
        "Recovered the cross-track label from the flattened dashboard view because the canonical row was missing."
      );
      missingOutputs.push("canonical_tracks_multi");
    }
    if (tracksSingle.length === 0) {
      warnings.push("No primary track label was stored for this paper.");
      missingOutputs.push("tracks_single");
    }
    if (tracksMulti.length === 0) {
      warnings.push("No cross-track label was stored for this paper.");
      missingOutputs.push("tracks_multi");
    }

    if (!abstractClaims) {
      warnings.push("No extracted abstract/claims text was available.");
      missingOutputs.push("abstract_claims");
    }
    if (!methods) {
      warnings.push("No extracted methods text was available.");
      missingOutputs.push("methods");
    }
    if (!results) {
      warnings.push("No extracted results text was available.");
      missingOutputs.push("results");
    }
    if (!conclusion) {
      warnings.push("No extracted conclusion text was available.");
      missingOutputs.push("conclusion");
    }

    const topics = [
      ...new Set([
        ...concepts.map((row) => row.label).filter(Boolean),
        ...keywords.map((row) => row.topic).filter(Boolean),
      ]),
    ];

    return NextResponse.json({
      run,
      analysis: {
        available: true,
        paper_id: paperId,
        title: String(paper.title ?? ""),
        year: String(paper.year ?? ""),
        raw_text: rawText || null,
        abstract_claims: abstractClaims,
        methods,
        results,
        conclusion,
        source_filename:
          paperContent?.source_filename ?? paper.source_filename ?? null,
        ingestion_run_id:
          paperContent?.ingestion_run_id ?? paper.ingestion_run_id ?? null,
        topics,
        keywords: keywords.sort((left, right) => right.frequency - left.frequency),
        concepts,
        facets,
        tracksSingle,
        tracksMulti,
        warnings: [...new Set(warnings)],
        diagnostics: {
          dataSource:
            keywordDataSource === "canonical" &&
            singleResult.data &&
            multiResult.data &&
            paperContent
              ? "canonical"
              : "canonical_with_recovery",
          missingOutputs: [...new Set(missingOutputs)],
        },
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
