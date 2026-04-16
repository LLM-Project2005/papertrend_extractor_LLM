import { TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { generateMockData } from "@/lib/mockData";
import type { PaperFullRow, TrackRow, TrendRow } from "@/types/database";

export interface CorpusCitation {
  paperId: number;
  title: string;
  year: string;
  href: string;
  reason: string;
}

export interface CorpusPaper {
  paper_id: number;
  year: string;
  title: string;
  abstract_claims: string;
  methods: string;
  results: string;
  conclusion: string;
  raw_text: string;
  topics: string[];
  keywords: string[];
  tracksSingle: string[];
  tracksMulti: string[];
  score: number;
}

function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
}

function scoreTextMatch(text: string, token: string, weight: number): number {
  return text.includes(token) ? weight : 0;
}

function extractTracks(row: TrackRow | undefined): string[] {
  if (!row) {
    return [];
  }

  return TRACK_COLS.filter((track) => {
    const field = track.toLowerCase() as "el" | "eli" | "lae" | "other";
    return row[field] === 1;
  }).map((track) => `${track} - ${TRACK_NAMES[track as TrackKey]}`);
}

function buildPaperHref(paperId: number): string {
  return `/workspace/papers?paperId=${paperId}`;
}

function buildCorpusResponse(
  papersInput: PaperFullRow[],
  trends: TrendRow[],
  singleRows: TrackRow[],
  multiRows: TrackRow[],
  question: string
): {
  papers: CorpusPaper[];
  citations: CorpusCitation[];
} {
  const tracksSingle = new Map<number, TrackRow>(
    singleRows.map((row) => [row.paper_id, row])
  );
  const tracksMulti = new Map<number, TrackRow>(
    multiRows.map((row) => [row.paper_id, row])
  );

  const trendGroups = new Map<number, { topics: Set<string>; keywords: Set<string> }>();
  trends.forEach((row) => {
    const entry = trendGroups.get(row.paper_id) ?? {
      topics: new Set<string>(),
      keywords: new Set<string>(),
    };
    entry.topics.add(row.topic);
    entry.keywords.add(row.keyword);
    trendGroups.set(row.paper_id, entry);
  });

  const tokens = tokenize(question);
  const papers = papersInput
    .map((paper) => {
      const trendGroup = trendGroups.get(paper.paper_id);
      const candidate = {
        paper_id: paper.paper_id,
        year: paper.year,
        title: paper.title,
        abstract_claims: paper.abstract_claims ?? paper.abstract ?? "",
        methods: paper.methods ?? "",
        results: paper.results ?? "",
        conclusion: paper.conclusion ?? "",
        raw_text: paper.raw_text ?? "",
        topics: [...(trendGroup?.topics ?? new Set<string>())],
        keywords: [...(trendGroup?.keywords ?? new Set<string>())],
        tracksSingle: extractTracks(tracksSingle.get(paper.paper_id)),
        tracksMulti: extractTracks(tracksMulti.get(paper.paper_id)),
      };

      return {
        ...candidate,
        score: scorePaper(question, tokens, candidate),
      };
    })
    .filter((paper) => paper.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  return {
    papers,
    citations: papers.map((paper) => ({
      paperId: paper.paper_id,
      title: paper.title,
      year: paper.year,
      href: buildPaperHref(paper.paper_id),
      reason: [
        paper.keywords.slice(0, 3).join(", "),
        paper.topics.slice(0, 2).join(", "),
      ]
        .filter(Boolean)
        .join(" | "),
    })),
  };
}

function buildMockCorpusResponse(question: string): {
  papers: CorpusPaper[];
  citations: CorpusCitation[];
} {
  const mock = generateMockData();
  const uniquePaperIds = [...new Set(mock.trends.map((row) => row.paper_id))];

  const mockPapersFull: PaperFullRow[] = uniquePaperIds.map((paperId) => {
    const paperRows = mock.trends.filter((row) => row.paper_id === paperId);
    const firstRow = paperRows[0];
    const topicSummary = [...new Set(paperRows.map((row) => row.topic))].join(", ");
    const keywordSummary = [...new Set(paperRows.map((row) => row.keyword))].join(", ");
    const evidence = paperRows
      .map((row) => row.evidence)
      .filter(Boolean)
      .slice(0, 4)
      .join(" ");
    const abstractClaims =
      evidence ||
      `This preview paper focuses on ${topicSummary || "research trends"} with keywords such as ${keywordSummary || "None"}.`;

    return {
      paper_id: paperId,
      year: firstRow?.year ?? "Unknown",
      title: firstRow?.title ?? `Mock paper ${paperId}`,
      abstract: abstractClaims,
      abstract_claims: abstractClaims,
      methods: "Preview dataset generated from mock workspace trends.",
      results: `Representative topics: ${topicSummary || "None"}. Representative keywords: ${keywordSummary || "None"}.`,
      conclusion:
        "This is temporary preview data used while the live analysis backend is unavailable.",
      raw_text: [firstRow?.title, topicSummary, keywordSummary, evidence]
        .filter(Boolean)
        .join(" "),
    };
  });

  return buildCorpusResponse(
    mockPapersFull,
    mock.trends,
    mock.tracksSingle,
    mock.tracksMulti,
    question
  );
}

function scorePaper(
  question: string,
  tokens: string[],
  paper: Omit<CorpusPaper, "score">
): number {
  const titleText = paper.title.toLowerCase();
  const keywordText = paper.keywords.join(" ").toLowerCase();
  const topicText = paper.topics.join(" ").toLowerCase();
  const trackText = [...paper.tracksSingle, ...paper.tracksMulti].join(" ").toLowerCase();
  const sectionText = [
    paper.abstract_claims,
    paper.methods,
    paper.results,
    paper.conclusion,
    paper.raw_text.slice(0, 4000),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;

  tokens.forEach((token) => {
    score += scoreTextMatch(titleText, token, 8);
    score += scoreTextMatch(keywordText, token, 6);
    score += scoreTextMatch(topicText, token, 5);
    score += scoreTextMatch(trackText, token, 4);
    score += scoreTextMatch(sectionText, token, 2);
  });

  if (question.toLowerCase().includes(paper.year)) {
    score += 2;
  }

  return score;
}

export async function retrieveCorpusPapers(
  question: string,
  ownerUserId?: string | null,
  folderId?: string | null,
  projectId?: string | null,
  selectedRunIds: string[] = []
): Promise<{
  papers: CorpusPaper[];
  citations: CorpusCitation[];
}> {
  try {
    if (!ownerUserId) {
      return buildMockCorpusResponse(question);
    }

    const supabase = getSupabaseAdmin();
    let papersQuery = supabase
      .from("papers_full")
      .select("*")
      .eq("owner_user_id", ownerUserId);

    if (folderId && folderId !== "all") {
      papersQuery = papersQuery.eq("folder_id", folderId);
    } else if (projectId) {
      const { data: folders, error: foldersError } = await supabase
        .from("research_folders")
        .select("id")
        .eq("owner_user_id", ownerUserId)
        .eq("project_id", projectId);

      if (foldersError) {
        throw new Error(foldersError.message);
      }

      const folderIds = (folders ?? [])
        .map((row) => String((row as { id?: string | null }).id ?? ""))
        .filter(Boolean);

      if (folderIds.length === 0) {
        return { papers: [], citations: [] };
      }

      papersQuery = papersQuery.in("folder_id", folderIds);
    }

    const normalizedRunIds = selectedRunIds.filter(Boolean);
    if (normalizedRunIds.length > 0) {
      papersQuery = papersQuery.in("ingestion_run_id", normalizedRunIds);
    }

    const papersResult = await papersQuery;

    if (papersResult.error) {
      throw new Error(`Failed to load papers_full: ${papersResult.error.message}`);
    }

    const papersData = (papersResult.data ?? []) as PaperFullRow[];
    const paperIds = papersData.map((paper) => paper.paper_id).filter(Boolean);
    if (paperIds.length === 0) {
      return { papers: [], citations: [] };
    }

    const [trendsResult, singleResult, multiResult] = await Promise.all([
      supabase
        .from("trends_flat")
        .select("*")
        .eq("owner_user_id", ownerUserId)
        .in("paper_id", paperIds),
      supabase
        .from("tracks_single_flat")
        .select("*")
        .eq("owner_user_id", ownerUserId)
        .in("paper_id", paperIds),
      supabase
        .from("tracks_multi_flat")
        .select("*")
        .eq("owner_user_id", ownerUserId)
        .in("paper_id", paperIds),
    ]);

    if (trendsResult.error) {
      throw new Error(`Failed to load trends_flat: ${trendsResult.error.message}`);
    }
    if (singleResult.error) {
      throw new Error(`Failed to load tracks_single_flat: ${singleResult.error.message}`);
    }
    if (multiResult.error) {
      throw new Error(`Failed to load tracks_multi_flat: ${multiResult.error.message}`);
    }

    const response = buildCorpusResponse(
      papersData,
      (trendsResult.data ?? []) as TrendRow[],
      (singleResult.data ?? []) as TrackRow[],
      (multiResult.data ?? []) as TrackRow[],
      question
    );

    if (response.papers.length > 0) {
      return response;
    }
    return { papers: [], citations: [] };
  } catch {
    if (ownerUserId) {
      return { papers: [], citations: [] };
    }
  }

  return buildMockCorpusResponse(question);
}

export function buildGroundedContext(papers: CorpusPaper[]): string {
  return papers
    .map(
      (paper) =>
        [
          `[Paper ${paper.paper_id}] ${paper.title} (${paper.year})`,
          `Single-label tracks: ${paper.tracksSingle.join(", ") || "None"}`,
          `Multi-label tracks: ${paper.tracksMulti.join(", ") || "None"}`,
          `Topics: ${paper.topics.join(", ") || "None"}`,
          `Keywords: ${paper.keywords.join(", ") || "None"}`,
          `Abstract/claims: ${paper.abstract_claims || "None"}`,
          `Methods: ${paper.methods || "None"}`,
          `Results: ${paper.results || "None"}`,
          `Conclusion: ${paper.conclusion || "None"}`,
        ].join("\n")
    )
    .join("\n\n");
}

export function buildDeterministicGroundedAnswer(
  question: string,
  papers: CorpusPaper[]
): string {
  const topPaper = papers[0];
  const lines = [
    `I found ${papers.length} relevant paper${papers.length === 1 ? "" : "s"} in the workspace corpus for "${question}".`,
    "",
    `The strongest match is [Paper ${topPaper.paper_id}] ${topPaper.title} (${topPaper.year}).`,
  ];

  if (topPaper.topics.length > 0) {
    lines.push(`Main topics: ${topPaper.topics.join(", ")}.`);
  }
  if (topPaper.keywords.length > 0) {
    lines.push(`Key terms: ${topPaper.keywords.slice(0, 6).join(", ")}.`);
  }
  if (topPaper.abstract_claims) {
    lines.push(`Abstract/claims: ${topPaper.abstract_claims}`);
  }
  if (topPaper.results) {
    lines.push(`Results: ${topPaper.results}`);
  }
  if (papers.length > 1) {
    lines.push(
      `Other useful matches: ${papers
        .slice(1)
        .map((paper) => `[Paper ${paper.paper_id}] ${paper.title}`)
        .join("; ")}.`
    );
  }

  return lines.join("\n");
}
