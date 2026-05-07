import { createHash } from "crypto";
import { createChatCompletion } from "@/lib/openai";
import { normalizePaperId } from "@/lib/paper-id";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { CorpusTopicFamily, PaperId, TrendRow } from "@/types/database";
import type {
  WorkspaceCorpusTopicFamilyCache,
  WorkspaceProjectCorpusTopicCache,
} from "@/types/workspace";

type PaperMetadata = {
  paperId: PaperId;
  folderId: string | null;
  year: string;
  title: string;
  ingestionRunId: string | null;
};

type ConceptSourceRow = {
  paper_id: unknown;
  folder_id?: unknown;
  concept_label?: unknown;
  matched_terms?: unknown;
  related_keywords?: unknown;
  total_frequency?: unknown;
  first_evidence?: unknown;
  evidence_snippets?: unknown;
};

type KeywordSourceRow = {
  paper_id: unknown;
  folder_id?: unknown;
  topic?: unknown;
  keyword?: unknown;
  keyword_frequency?: unknown;
  evidence?: unknown;
};

type WorkspaceProfileRecord = {
  workspace_profile?: Record<string, unknown> | null;
};

type ConceptEntry = {
  index: number;
  paperId: PaperId;
  folderId: string | null;
  year: string;
  title: string;
  conceptLabel: string;
  aliases: string[];
  matchedTerms: string[];
  relatedKeywords: string[];
  totalFrequency: number;
  evidenceSnippets: string[];
  firstEvidence: string;
  exactKeys: string[];
  sortedWordKeys: string[];
  exactAcronyms: string[];
  generatedAcronyms: string[];
};

type UnionFind = {
  parent: number[];
  find: (value: number) => number;
  union: (left: number, right: number) => void;
};

type FamilyPairCandidate = {
  left: WorkspaceCorpusTopicFamilyCache;
  right: WorkspaceCorpusTopicFamilyCache;
  score: number;
  reasons: string[];
};

type FamilyMergeDecision = {
  merge: boolean;
  confidence: number;
  canonicalTopic?: string;
  reason?: string;
};

const TOPIC_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const LLM_TOPIC_MERGE_MIN_SCORE = 0.38;
const LLM_TOPIC_MERGE_MAX_SCORE = 0.82;
const LLM_TOPIC_MERGE_APPROVAL_CONFIDENCE = 0.82;
const LLM_TOPIC_MERGE_MAX_CANDIDATES = 10;
const LLM_TOPIC_MERGE_PRIMARY_TRUST_CONFIDENCE = 0.88;
const LLM_TOPIC_MERGE_PRIMARY_TRUST_CONFIDENCE_WHEN_MERGING = 0.9;
const LLM_TOPIC_MERGE_BORDERLINE_SCORE_MIN = 0.5;
const LLM_TOPIC_MERGE_BORDERLINE_SCORE_MAX = 0.72;
const LLM_TOPIC_MERGE_BORDERLINE_TRUST_CONFIDENCE = 0.94;

function llmTopicMergeEnabled(): boolean {
  const value = (process.env.ENABLE_TOPIC_CACHE_LLM_MERGE ?? "true").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function topicMergePrimaryModel(): string | undefined {
  const value =
    process.env.TOPIC_CACHE_LLM_PRIMARY_MODEL ??
    process.env.MODEL_TASK_TOPIC_GROUPING_PRIMARY ??
    process.env.MODEL_TASK_TOPIC_GROUPING_SMALL;
  const model = value?.trim();
  return model ? model : undefined;
}

function topicMergeSecondaryModel(primaryModel?: string): string | undefined {
  const enabledValue = (process.env.ENABLE_TOPIC_CACHE_LLM_SECONDARY ?? "true")
    .trim()
    .toLowerCase();
  const enabled = ["1", "true", "yes", "on"].includes(enabledValue);
  if (!enabled) {
    return undefined;
  }

  const value =
    process.env.TOPIC_CACHE_LLM_SECONDARY_MODEL ??
    process.env.MODEL_TASK_TOPIC_GROUPING_SECONDARY ??
    process.env.MODEL_TASK_TOPIC_GROUPING_LARGE ??
    process.env.MODEL_TASK_TOPIC_GROUPING_FALLBACK;
  const model = value?.trim();
  if (!model) {
    return undefined;
  }
  if (primaryModel && model === primaryModel) {
    return undefined;
  }
  return model;
}

function isGenericTopicLabel(value: string): boolean {
  const normalized = normalizeTopicText(value);
  return !normalized || normalized === "unclassified" || normalized === "other";
}

function normalizeValueSet(values: string[]): Set<string> {
  return new Set(values.map((value) => normalizeTopicText(value)).filter(Boolean));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  left.forEach((value) => {
    if (right.has(value)) {
      intersection += 1;
    }
  });
  if (intersection === 0) {
    return 0;
  }
  return intersection / (left.size + right.size - intersection);
}

function familyPairScore(
  left: WorkspaceCorpusTopicFamilyCache,
  right: WorkspaceCorpusTopicFamilyCache
): FamilyPairCandidate {
  const aliasScore = jaccard(normalizeValueSet(left.aliases), normalizeValueSet(right.aliases));
  const keywordScore = jaccard(
    normalizeValueSet([...left.representativeKeywords, ...left.relatedKeywords]),
    normalizeValueSet([...right.representativeKeywords, ...right.relatedKeywords])
  );
  const matchedTermsScore = jaccard(
    normalizeValueSet(left.matchedTerms),
    normalizeValueSet(right.matchedTerms)
  );
  const acronymLeft = new Set(
    [...left.aliases, left.canonicalTopic]
      .map((alias) => normalizeTopicText(alias).replace(/\s+/g, ""))
      .filter((alias) => /^[a-z]{2,8}$/.test(alias))
  );
  const acronymRight = new Set(
    [...right.aliases, right.canonicalTopic]
      .map((alias) => normalizeTopicText(alias).replace(/\s+/g, ""))
      .filter((alias) => /^[a-z]{2,8}$/.test(alias))
  );
  const acronymScore = jaccard(acronymLeft, acronymRight);
  const paperScore = jaccard(new Set(left.paperIds), new Set(right.paperIds));

  let score =
    aliasScore * 0.42 +
    keywordScore * 0.24 +
    matchedTermsScore * 0.18 +
    acronymScore * 0.10 +
    paperScore * 0.06;

  if (isGenericTopicLabel(left.canonicalTopic) || isGenericTopicLabel(right.canonicalTopic)) {
    score -= 0.08;
  }

  const reasons: string[] = [];
  if (aliasScore > 0.3) reasons.push(`alias_overlap=${aliasScore.toFixed(2)}`);
  if (keywordScore > 0.3) reasons.push(`keyword_overlap=${keywordScore.toFixed(2)}`);
  if (matchedTermsScore > 0.25) reasons.push(`matched_terms_overlap=${matchedTermsScore.toFixed(2)}`);
  if (acronymScore > 0) reasons.push(`acronym_overlap=${acronymScore.toFixed(2)}`);
  if (paperScore > 0) reasons.push(`paper_overlap=${paperScore.toFixed(2)}`);

  return {
    left,
    right,
    score: Math.max(0, Math.min(1, score)),
    reasons,
  };
}

function safeParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fenced?.[1]) return null;
    try {
      const parsed = JSON.parse(fenced[1].trim());
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

async function adjudicateFamilyMergeWithLlm(
  candidate: FamilyPairCandidate
): Promise<FamilyMergeDecision | null> {
  const systemPrompt = [
    "You are a strict ontology merge adjudicator for research-topic families.",
    "Goal: prevent incorrect merges.",
    "Rules:",
    "1) Only merge if both families clearly refer to the same underlying concept.",
    "2) Reject merge if similarity is generic, contextual, or only weakly related.",
    "3) Acronym-only evidence is insufficient unless expanded aliases strongly align.",
    "4) Prefer false-negative over false-positive (when uncertain, do NOT merge).",
    "5) Return only valid JSON and no extra text.",
    "JSON schema:",
    '{"merge": boolean, "confidence": number, "canonicalTopic": string, "reason": string}',
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      deterministicScore: Number(candidate.score.toFixed(3)),
      deterministicSignals: candidate.reasons,
      familyA: {
        canonicalTopic: candidate.left.canonicalTopic,
        aliases: candidate.left.aliases.slice(0, 14),
        representativeKeywords: candidate.left.representativeKeywords.slice(0, 12),
        matchedTerms: candidate.left.matchedTerms.slice(0, 12),
        paperCount: candidate.left.paperIds.length,
        years: candidate.left.years,
      },
      familyB: {
        canonicalTopic: candidate.right.canonicalTopic,
        aliases: candidate.right.aliases.slice(0, 14),
        representativeKeywords: candidate.right.representativeKeywords.slice(0, 12),
        matchedTerms: candidate.right.matchedTerms.slice(0, 12),
        paperCount: candidate.right.paperIds.length,
        years: candidate.right.years,
      },
    },
    null,
    2
  );

  const promptMessages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  const parseDecision = (rawText: string | null): FamilyMergeDecision | null => {
    if (!rawText) return null;
    const parsed = safeParseJsonObject(rawText);
    if (!parsed) return null;

    const confidence = Number(parsed.confidence ?? 0);
    if (!Number.isFinite(confidence)) {
      return null;
    }

    const canonicalTopic =
      typeof parsed.canonicalTopic === "string" ? parsed.canonicalTopic.trim() : undefined;
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : undefined;
    return {
      merge: Boolean(parsed.merge),
      confidence: Math.max(0, Math.min(1, confidence)),
      canonicalTopic,
      reason,
    };
  };

  const shouldEscalateToSecondary = (decision: FamilyMergeDecision | null): boolean => {
    if (!decision) {
      return true;
    }

    if (
      candidate.score >= LLM_TOPIC_MERGE_BORDERLINE_SCORE_MIN &&
      candidate.score <= LLM_TOPIC_MERGE_BORDERLINE_SCORE_MAX &&
      decision.confidence < LLM_TOPIC_MERGE_BORDERLINE_TRUST_CONFIDENCE
    ) {
      return true;
    }

    if (
      decision.merge &&
      decision.confidence < LLM_TOPIC_MERGE_PRIMARY_TRUST_CONFIDENCE_WHEN_MERGING
    ) {
      return true;
    }

    return decision.confidence < LLM_TOPIC_MERGE_PRIMARY_TRUST_CONFIDENCE;
  };

  const primaryModel = topicMergePrimaryModel();
  const secondaryModel = topicMergeSecondaryModel(primaryModel);

  const primaryRaw = await createChatCompletion(
    promptMessages,
    0,
    primaryModel,
    "TOPIC_GROUPING"
  );
  const primaryDecision = parseDecision(primaryRaw);
  if (!secondaryModel || !shouldEscalateToSecondary(primaryDecision)) {
    return primaryDecision;
  }

  const secondaryRaw = await createChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    0,
    secondaryModel,
    "TOPIC_GROUPING"
  );
  return parseDecision(secondaryRaw) ?? primaryDecision;
}

function mergeFamilyGroup(
  families: WorkspaceCorpusTopicFamilyCache[],
  canonicalOverride?: string
): WorkspaceCorpusTopicFamilyCache {
  const aliases = [...new Set(families.flatMap((family) => family.aliases).filter(Boolean))];
  const canonicalTopic =
    canonicalOverride?.trim() || chooseCanonicalTopicLabel(aliases.length ? aliases : families.map((family) => family.canonicalTopic));
  return {
    id: families[0]?.id || `corpus-topic-${Date.now()}`,
    canonicalTopic,
    aliases: [...new Set([canonicalTopic, ...aliases])],
    representativeKeywords: [
      ...new Set(families.flatMap((family) => family.representativeKeywords).filter(Boolean)),
    ].slice(0, 16),
    relatedKeywords: [
      ...new Set(families.flatMap((family) => family.relatedKeywords).filter(Boolean)),
    ].slice(0, 24),
    matchedTerms: [
      ...new Set(families.flatMap((family) => family.matchedTerms).filter(Boolean)),
    ].slice(0, 24),
    evidenceSnippets: [
      ...new Set(families.flatMap((family) => family.evidenceSnippets).filter(Boolean)),
    ].slice(0, 8),
    paperIds: [...new Set(families.flatMap((family) => family.paperIds))],
    folderIds: [...new Set(families.flatMap((family) => family.folderIds))],
    years: [...new Set(families.flatMap((family) => family.years))].sort(),
    totalKeywordFrequency: families.reduce(
      (sum, family) => sum + Number(family.totalKeywordFrequency || 0),
      0
    ),
  };
}

async function applyLlmFamilyMerges(
  families: WorkspaceCorpusTopicFamilyCache[]
): Promise<{
  families: WorkspaceCorpusTopicFamilyCache[];
  familyIdRemap: Map<string, string>;
}> {
  const familyIdRemap = new Map<string, string>();
  families.forEach((family) => familyIdRemap.set(family.id, family.id));

  if (!llmTopicMergeEnabled() || families.length < 2) {
    return { families, familyIdRemap };
  }

  const pairCandidates: FamilyPairCandidate[] = [];
  for (let leftIndex = 0; leftIndex < families.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < families.length; rightIndex += 1) {
      const candidate = familyPairScore(families[leftIndex], families[rightIndex]);
      if (
        candidate.score >= LLM_TOPIC_MERGE_MIN_SCORE &&
        candidate.score <= LLM_TOPIC_MERGE_MAX_SCORE
      ) {
        pairCandidates.push(candidate);
      }
    }
  }

  const adjudicationQueue = pairCandidates
    .sort((left, right) => right.score - left.score)
    .slice(0, LLM_TOPIC_MERGE_MAX_CANDIDATES);

  if (adjudicationQueue.length === 0) {
    return { families, familyIdRemap };
  }

  const familyUnion = createUnionFind(families.length);
  const familyIndexById = new Map(families.map((family, index) => [family.id, index]));
  const canonicalOverrides = new Map<string, string>();

  for (const candidate of adjudicationQueue) {
    try {
      const decision = await adjudicateFamilyMergeWithLlm(candidate);
      if (
        !decision?.merge ||
        !Number.isFinite(decision.confidence) ||
        decision.confidence < LLM_TOPIC_MERGE_APPROVAL_CONFIDENCE
      ) {
        continue;
      }

      const leftIndex = familyIndexById.get(candidate.left.id);
      const rightIndex = familyIndexById.get(candidate.right.id);
      if (typeof leftIndex !== "number" || typeof rightIndex !== "number") {
        continue;
      }
      familyUnion.union(leftIndex, rightIndex);
      const root = familyUnion.find(leftIndex);
      if (decision.canonicalTopic) {
        canonicalOverrides.set(String(root), decision.canonicalTopic);
      }
    } catch {
      continue;
    }
  }

  const groups = new Map<number, WorkspaceCorpusTopicFamilyCache[]>();
  families.forEach((family, index) => {
    const root = familyUnion.find(index);
    const list = groups.get(root) ?? [];
    list.push(family);
    groups.set(root, list);
  });

  if (groups.size === families.length) {
    return { families, familyIdRemap };
  }

  const mergedFamilies: WorkspaceCorpusTopicFamilyCache[] = [];
  groups.forEach((groupFamilies, root) => {
    const merged = mergeFamilyGroup(groupFamilies, canonicalOverrides.get(String(root)));
    mergedFamilies.push(merged);
    groupFamilies.forEach((family) => {
      familyIdRemap.set(family.id, merged.id);
    });
  });

  return { families: mergedFamilies, familyIdRemap };
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => coerceString(item)).filter(Boolean))];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      return coerceStringList(parsed);
    } catch {
      return [trimmed];
    }
  }

  return [];
}

function normalizeTopicText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(token: string): string {
  const normalized = normalizeTopicText(token);
  if (normalized.length > 4 && normalized.endsWith("ies")) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.length > 4 && normalized.endsWith("ses")) {
    return normalized.slice(0, -2);
  }
  if (normalized.length > 3 && normalized.endsWith("s") && !normalized.endsWith("ss")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function tokenizeContentWords(value: string): string[] {
  return normalizeTopicText(value)
    .split(" ")
    .map((token) => normalizeToken(token))
    .filter((token) => token && !TOPIC_STOPWORDS.has(token));
}

function buildGeneratedAcronym(value: string): string {
  const tokens = tokenizeContentWords(value);
  if (tokens.length < 2) {
    return "";
  }
  return tokens.map((token) => token[0]).join("");
}

function buildEntryAliases(label: string, matchedTerms: string[], relatedKeywords: string[]) {
  return [...new Set([label, ...matchedTerms, ...relatedKeywords].filter(Boolean))];
}

function buildConceptEntry(
  row: ConceptSourceRow,
  index: number,
  metadataByPaperId: Map<PaperId, PaperMetadata>
): ConceptEntry | null {
  const paperId = normalizePaperId(row.paper_id);
  if (!paperId) {
    return null;
  }

  const metadata = metadataByPaperId.get(paperId);
  if (!metadata) {
    return null;
  }

  const conceptLabel = coerceString(row.concept_label);
  if (!conceptLabel) {
    return null;
  }

  const matchedTerms = coerceStringList(row.matched_terms);
  const relatedKeywords = coerceStringList(row.related_keywords);
  const aliases = buildEntryAliases(conceptLabel, matchedTerms, relatedKeywords);
  const evidenceSnippets = coerceStringList(row.evidence_snippets);
  const firstEvidence = coerceString(row.first_evidence);

  const exactKeys = [...new Set(aliases.map((alias) => normalizeTopicText(alias)).filter(Boolean))];
  const sortedWordKeys = [
    ...new Set(
      aliases
        .map((alias) => tokenizeContentWords(alias))
        .filter((tokens) => tokens.length > 1)
        .map((tokens) => tokens.sort().join(" "))
        .filter(Boolean)
    ),
  ];
  const exactAcronyms = [
    ...new Set(
      aliases
        .map((alias) => normalizeTopicText(alias).replace(/\s+/g, ""))
        .filter((alias) => /^[a-z]{2,8}$/.test(alias))
    ),
  ];
  const generatedAcronyms = [
    ...new Set(aliases.map((alias) => buildGeneratedAcronym(alias)).filter(Boolean)),
  ];

  return {
    index,
    paperId,
    folderId: metadata.folderId,
    year: metadata.year,
    title: metadata.title,
    conceptLabel,
    aliases,
    matchedTerms,
    relatedKeywords,
    totalFrequency: Number(row.total_frequency ?? 0),
    evidenceSnippets,
    firstEvidence,
    exactKeys,
    sortedWordKeys,
    exactAcronyms,
    generatedAcronyms,
  };
}

function createUnionFind(size: number): UnionFind {
  const parent = Array.from({ length: size }, (_, index) => index);

  function find(value: number): number {
    if (parent[value] !== value) {
      parent[value] = find(parent[value]);
    }
    return parent[value];
  }

  function union(left: number, right: number) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  }

  return { parent, find, union };
}

function chooseCanonicalTopicLabel(aliases: string[]): string {
  const scored = aliases
    .map((alias) => {
      const tokens = tokenizeContentWords(alias);
      const normalized = normalizeTopicText(alias);
      const isAcronym = /^[A-Z]{2,8}$/.test(alias.trim()) || /^[a-z]{2,8}$/.test(normalized);
      const score =
        (tokens.length > 1 ? 6 : 0) +
        (normalized.length >= 18 ? 4 : 0) +
        (normalized.length >= 10 ? 2 : 0) +
        (isAcronym ? -4 : 0);
      return { alias: alias.trim(), score, length: alias.trim().length };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.length - left.length;
    });

  return scored[0]?.alias || aliases[0] || "Unclassified";
}

function buildSourceSignature(
  papers: PaperMetadata[],
  concepts: ConceptSourceRow[],
  keywords: KeywordSourceRow[]
): string {
  const hash = createHash("sha1");
  const stablePapers = [...papers]
    .sort((left, right) => left.paperId.localeCompare(right.paperId))
    .map((paper) => ({
      paperId: paper.paperId,
      folderId: paper.folderId,
      year: paper.year,
      title: paper.title,
      ingestionRunId: paper.ingestionRunId,
    }));
  const stableConcepts = [...concepts]
    .map((row) => ({
      paperId: normalizePaperId(row.paper_id),
      folderId: coerceString(row.folder_id) || null,
      conceptLabel: coerceString(row.concept_label),
      matchedTerms: coerceStringList(row.matched_terms).sort(),
      relatedKeywords: coerceStringList(row.related_keywords).sort(),
      totalFrequency: Number(row.total_frequency ?? 0),
      firstEvidence: coerceString(row.first_evidence),
      evidenceSnippets: coerceStringList(row.evidence_snippets).sort(),
    }))
    .sort((left, right) =>
      `${left.paperId}:${left.conceptLabel}`.localeCompare(
        `${right.paperId}:${right.conceptLabel}`
      )
    );
  const stableKeywords = [...keywords]
    .map((row) => ({
      paperId: normalizePaperId(row.paper_id),
      folderId: coerceString(row.folder_id) || null,
      topic: coerceString(row.topic),
      keyword: coerceString(row.keyword),
      keywordFrequency: Number(row.keyword_frequency ?? 0),
      evidence: coerceString(row.evidence),
    }))
    .sort((left, right) =>
      `${left.paperId}:${left.topic}:${left.keyword}`.localeCompare(
        `${right.paperId}:${right.topic}:${right.keyword}`
      )
    );

  hash.update(JSON.stringify(stablePapers));
  hash.update(JSON.stringify(stableConcepts));
  hash.update(JSON.stringify(stableKeywords));
  return hash.digest("hex");
}

async function loadProjectFolderIds(ownerUserId: string, projectId: string): Promise<string[]> {
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
    .map((row) => coerceString((row as { id?: unknown }).id))
    .filter(Boolean);
}

async function loadProjectPapers(
  ownerUserId: string,
  projectFolderIds: string[]
): Promise<PaperMetadata[]> {
  if (projectFolderIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data: runRows, error: runError } = await supabase
    .from("ingestion_runs")
    .select("id,folder_id")
    .eq("owner_user_id", ownerUserId)
    .in("folder_id", projectFolderIds);

  if (runError) {
    throw new Error(runError.message);
  }

  const runIds = (runRows ?? [])
    .map((row) => coerceString((row as { id?: unknown }).id))
    .filter(Boolean);
  const runFolderById = new Map(
    (runRows ?? []).map((row) => {
      const typedRow = row as { id?: unknown; folder_id?: unknown };
      return [
        coerceString(typedRow.id),
        coerceString(typedRow.folder_id) || null,
      ] as const;
    })
  );
  if (runIds.length === 0) {
    return [];
  }

  const { data: paperRows, error: paperError } = await supabase
    .from("papers_full")
    .select("paper_id,folder_id,year,title,ingestion_run_id")
    .eq("owner_user_id", ownerUserId)
    .in("ingestion_run_id", runIds);

  if (paperError) {
    throw new Error(paperError.message);
  }

  const unique = new Map<PaperId, PaperMetadata>();
  for (const row of (paperRows ?? []) as Array<Record<string, unknown>>) {
    const paperId = normalizePaperId(row.paper_id);
    if (!paperId) {
      continue;
    }
    unique.set(paperId, {
      paperId,
      folderId:
        coerceString(row.folder_id) ||
        runFolderById.get(coerceString(row.ingestion_run_id)) ||
        null,
      year: coerceString(row.year) || "Unknown",
      title: coerceString(row.title) || "Untitled paper",
      ingestionRunId: coerceString(row.ingestion_run_id) || null,
    });
  }

  return [...unique.values()];
}

async function loadProjectConceptSourceRows(
  ownerUserId: string,
  paperIds: PaperId[]
): Promise<ConceptSourceRow[]> {
  if (paperIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("paper_keyword_concepts")
    .select(
      "paper_id,folder_id,concept_label,matched_terms,related_keywords,total_frequency,first_evidence,evidence_snippets"
    )
    .eq("owner_user_id", ownerUserId)
    .in("paper_id", paperIds);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ConceptSourceRow[];
}

async function loadProjectKeywordSourceRows(
  ownerUserId: string,
  paperIds: PaperId[]
): Promise<KeywordSourceRow[]> {
  if (paperIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("paper_keywords")
    .select("paper_id,folder_id,topic,keyword,keyword_frequency,evidence")
    .eq("owner_user_id", ownerUserId)
    .in("paper_id", paperIds);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as KeywordSourceRow[];
}

async function loadWorkspaceProfileRecord(ownerUserId: string): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("workspace_profile")
    .eq("id", ownerUserId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return ((data as WorkspaceProfileRecord | null)?.workspace_profile ?? {}) as Record<
    string,
    unknown
  >;
}

async function persistProjectCorpusTopicCache(
  ownerUserId: string,
  projectId: string,
  cache: WorkspaceProjectCorpusTopicCache
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const currentWorkspaceProfile = await loadWorkspaceProfileRecord(ownerUserId);
  const existingCache =
    currentWorkspaceProfile.projectCorpusTopicCacheByProject &&
    typeof currentWorkspaceProfile.projectCorpusTopicCacheByProject === "object"
      ? (currentWorkspaceProfile.projectCorpusTopicCacheByProject as Record<
          string,
          WorkspaceProjectCorpusTopicCache
        >)
      : {};

  const { error } = await supabase
    .from("user_profiles")
    .update({
      workspace_profile: {
        ...currentWorkspaceProfile,
        projectCorpusTopicCacheByProject: {
          ...existingCache,
          [projectId]: cache,
        },
      },
    })
    .eq("id", ownerUserId);

  if (error) {
    throw new Error(error.message);
  }
}

function rehydrateTopicFamilies(
  families: WorkspaceCorpusTopicFamilyCache[]
): CorpusTopicFamily[] {
  return families.map((family) => ({
    id: family.id,
    canonicalTopic: family.canonicalTopic,
    aliases: family.aliases,
    representativeKeywords: family.representativeKeywords,
    relatedKeywords: family.relatedKeywords,
    matchedTerms: family.matchedTerms,
    evidenceSnippets: family.evidenceSnippets,
    paperIds: family.paperIds,
    folderIds: family.folderIds,
    years: family.years,
    totalKeywordFrequency: family.totalKeywordFrequency,
  }));
}

async function buildCorpusTopicCache(
  papers: PaperMetadata[],
  concepts: ConceptSourceRow[],
  keywords: KeywordSourceRow[]
): Promise<WorkspaceProjectCorpusTopicCache> {
  const metadataByPaperId = new Map(papers.map((paper) => [paper.paperId, paper]));
  const conceptEntries = concepts
    .map((row, index) => buildConceptEntry(row, index, metadataByPaperId))
    .filter((entry): entry is ConceptEntry => Boolean(entry));
  const unionFind = createUnionFind(conceptEntries.length);

  const exactKeyMap = new Map<string, number[]>();
  const sortedWordMap = new Map<string, number[]>();
  const exactAcronymMap = new Map<string, number[]>();
  const generatedAcronymMap = new Map<string, number[]>();

  conceptEntries.forEach((entry) => {
    entry.exactKeys.forEach((key) => {
      const list = exactKeyMap.get(key) ?? [];
      list.push(entry.index);
      exactKeyMap.set(key, list);
    });
    entry.sortedWordKeys.forEach((key) => {
      const list = sortedWordMap.get(key) ?? [];
      list.push(entry.index);
      sortedWordMap.set(key, list);
    });
    entry.exactAcronyms.forEach((key) => {
      const list = exactAcronymMap.get(key) ?? [];
      list.push(entry.index);
      exactAcronymMap.set(key, list);
    });
    entry.generatedAcronyms.forEach((key) => {
      const list = generatedAcronymMap.get(key) ?? [];
      list.push(entry.index);
      generatedAcronymMap.set(key, list);
    });
  });

  const unionGroup = (indices: number[]) => {
    const [first, ...rest] = indices;
    if (typeof first !== "number") {
      return;
    }
    rest.forEach((index) => unionFind.union(first, index));
  };

  exactKeyMap.forEach((indices) => {
    if (indices.length > 1) {
      unionGroup(indices);
    }
  });
  sortedWordMap.forEach((indices) => {
    if (indices.length > 1) {
      unionGroup(indices);
    }
  });
  exactAcronymMap.forEach((indices, acronym) => {
    const generated = generatedAcronymMap.get(acronym) ?? [];
    if (indices.length > 0 && generated.length > 0) {
      unionGroup([...indices, ...generated]);
    }
  });

  const groupedEntries = new Map<number, ConceptEntry[]>();
  conceptEntries.forEach((entry) => {
    const root = unionFind.find(entry.index);
    const list = groupedEntries.get(root) ?? [];
    list.push(entry);
    groupedEntries.set(root, list);
  });

  const familyByRoot = new Map<number, WorkspaceCorpusTopicFamilyCache>();
  const familyLookupByPaperAndAlias = new Map<string, string>();

  groupedEntries.forEach((entries, rootIndex) => {
    const aliases = [...new Set(entries.flatMap((entry) => entry.aliases).filter(Boolean))];
    const canonicalTopic = chooseCanonicalTopicLabel(aliases);
    const familyId = `corpus-topic-${rootIndex + 1}`;
    const relatedKeywords = [
      ...new Set(entries.flatMap((entry) => entry.relatedKeywords).filter(Boolean)),
    ];
    const matchedTerms = [
      ...new Set(entries.flatMap((entry) => entry.matchedTerms).filter(Boolean)),
    ];
    const evidenceSnippets = [
      ...new Set(
        entries
          .flatMap((entry) => [entry.firstEvidence, ...entry.evidenceSnippets])
          .filter(Boolean)
      ),
    ].slice(0, 8);
    const paperIds = [...new Set(entries.map((entry) => entry.paperId))];
    const folderIds = [
      ...new Set(entries.map((entry) => entry.folderId).filter((value): value is string => Boolean(value))),
    ];
    const years = [...new Set(entries.map((entry) => entry.year))].sort();

    const family: WorkspaceCorpusTopicFamilyCache = {
      id: familyId,
      canonicalTopic,
      aliases,
      representativeKeywords: [],
      relatedKeywords,
      matchedTerms,
      evidenceSnippets,
      paperIds,
      folderIds,
      years,
      totalKeywordFrequency: entries.reduce(
        (sum, entry) => sum + Math.max(entry.totalFrequency, 0),
        0
      ),
    };

    entries.forEach((entry) => {
      entry.aliases.forEach((alias) => {
        const normalizedAlias = normalizeTopicText(alias);
        if (normalizedAlias) {
          familyLookupByPaperAndAlias.set(`${entry.paperId}::${normalizedAlias}`, familyId);
        }
      });
      familyLookupByPaperAndAlias.set(
        `${entry.paperId}::${normalizeTopicText(entry.conceptLabel)}`,
        familyId
      );
    });

    familyByRoot.set(rootIndex, family);
  });

  const familyById = new Map(
    [...familyByRoot.values()].map((family) => [family.id, { ...family }])
  );
  const keywordTotalsByFamily = new Map<string, Map<string, number>>();
  const trendRows: Array<{ familyId: string; row: TrendRow }> = [];

  keywords.forEach((row) => {
    const paperId = normalizePaperId(row.paper_id);
    const metadata = paperId ? metadataByPaperId.get(paperId) : null;
    if (!paperId || !metadata) {
      return;
    }

    const rawTopic = coerceString(row.topic) || "Unclassified";
    const keyword = coerceString(row.keyword);
    if (!keyword) {
      return;
    }

    const normalizedTopic = normalizeTopicText(rawTopic);
    const normalizedKeyword = normalizeTopicText(keyword);
    const familyId =
      familyLookupByPaperAndAlias.get(`${paperId}::${normalizedTopic}`) ??
      familyLookupByPaperAndAlias.get(`${paperId}::${normalizedKeyword}`) ??
      `solo::${paperId}::${normalizedTopic || normalizedKeyword}`;

    if (!familyById.has(familyId)) {
      familyById.set(familyId, {
        id: familyId,
        canonicalTopic: rawTopic,
        aliases: [rawTopic],
        representativeKeywords: [],
        relatedKeywords: [keyword],
        matchedTerms: [],
        evidenceSnippets: coerceString(row.evidence) ? [coerceString(row.evidence)] : [],
        paperIds: [paperId],
        folderIds: metadata.folderId ? [metadata.folderId] : [],
        years: [metadata.year],
        totalKeywordFrequency: 0,
      });
    }

    const family = familyById.get(familyId)!;
    family.paperIds = [...new Set([...family.paperIds, paperId])];
    family.folderIds = [
      ...new Set([
        ...family.folderIds,
        ...(metadata.folderId ? [metadata.folderId] : []),
      ]),
    ];
    family.years = [...new Set([...family.years, metadata.year])].sort();
    family.totalKeywordFrequency += Number(row.keyword_frequency ?? 0);
    family.relatedKeywords = [...new Set([...family.relatedKeywords, keyword])];
    if (coerceString(row.evidence)) {
      family.evidenceSnippets = [
        ...new Set([...family.evidenceSnippets, coerceString(row.evidence)]),
      ].slice(0, 8);
    }

    const keywordTotals = keywordTotalsByFamily.get(familyId) ?? new Map<string, number>();
    keywordTotals.set(
      keyword,
      (keywordTotals.get(keyword) ?? 0) + Number(row.keyword_frequency ?? 0)
    );
    keywordTotalsByFamily.set(familyId, keywordTotals);

    trendRows.push({
      familyId,
      row: {
        paper_id: paperId,
        folder_id: metadata.folderId,
        year: metadata.year,
        title: metadata.title,
        topic: family.canonicalTopic,
        raw_topic: rawTopic,
        keyword,
        keyword_frequency: Number(row.keyword_frequency ?? 0),
        evidence: coerceString(row.evidence),
      },
    });
  });

  const normalizedFamilies = [...familyById.values()]
    .map((family) => {
      const keywordTotals = keywordTotalsByFamily.get(family.id) ?? new Map<string, number>();
      const representativeKeywords = [...keywordTotals.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([keyword]) => keyword);

      return {
        ...family,
        aliases: [...new Set([family.canonicalTopic, ...family.aliases])],
        representativeKeywords,
        relatedKeywords: [...new Set(family.relatedKeywords)].slice(0, 16),
        matchedTerms: [...new Set(family.matchedTerms)].slice(0, 16),
        paperIds: [...new Set(family.paperIds)],
        folderIds: [...new Set(family.folderIds)],
        years: [...new Set(family.years)].sort(),
      };
    })
    .sort((left, right) => {
      if (right.paperIds.length !== left.paperIds.length) {
        return right.paperIds.length - left.paperIds.length;
      }
      return right.totalKeywordFrequency - left.totalKeywordFrequency;
    });

  const llmMerged = await applyLlmFamilyMerges(normalizedFamilies);
  const familyByMergedId = new Map(llmMerged.families.map((family) => [family.id, family]));
  const mergedKeywordTotals = new Map<string, Map<string, number>>();

  keywordTotalsByFamily.forEach((totals, oldFamilyId) => {
    const mergedFamilyId = llmMerged.familyIdRemap.get(oldFamilyId) ?? oldFamilyId;
    const mergedTotals = mergedKeywordTotals.get(mergedFamilyId) ?? new Map<string, number>();
    totals.forEach((value, keyword) => {
      mergedTotals.set(keyword, (mergedTotals.get(keyword) ?? 0) + value);
    });
    mergedKeywordTotals.set(mergedFamilyId, mergedTotals);
  });

  const families = [...familyByMergedId.values()]
    .map((family) => {
      const keywordTotals = mergedKeywordTotals.get(family.id) ?? new Map<string, number>();
      const representativeKeywords = [...keywordTotals.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([keyword]) => keyword);
      return {
        ...family,
        representativeKeywords,
      };
    })
    .sort((left, right) => {
      if (right.paperIds.length !== left.paperIds.length) {
        return right.paperIds.length - left.paperIds.length;
      }
      return right.totalKeywordFrequency - left.totalKeywordFrequency;
    });

  const trends: TrendRow[] = trendRows.map(({ familyId, row }) => {
    const mergedFamilyId = llmMerged.familyIdRemap.get(familyId) ?? familyId;
    const family = familyByMergedId.get(mergedFamilyId);
    return {
      ...row,
      topic: family?.canonicalTopic || row.topic,
    };
  });

  return {
    sourceSignature: buildSourceSignature(papers, concepts, keywords),
    generatedAt: new Date().toISOString(),
    familyCount: families.length,
    trendCount: trends.length,
    families,
    trends,
  };
}

async function loadPersistedProjectCorpusTopicCache(
  ownerUserId: string,
  projectId: string
): Promise<WorkspaceProjectCorpusTopicCache | null> {
  const workspaceProfile = await loadWorkspaceProfileRecord(ownerUserId);
  const allCaches =
    workspaceProfile.projectCorpusTopicCacheByProject &&
    typeof workspaceProfile.projectCorpusTopicCacheByProject === "object"
      ? (workspaceProfile.projectCorpusTopicCacheByProject as Record<
          string,
          WorkspaceProjectCorpusTopicCache
        >)
      : null;
  return allCaches?.[projectId] ?? null;
}

export async function loadOrBuildProjectCorpusTopicCache(
  ownerUserId: string,
  projectId: string
): Promise<{
  cache: WorkspaceProjectCorpusTopicCache;
  topicFamilies: CorpusTopicFamily[];
  projectFolderIds: string[];
  paperIds: PaperId[];
}> {
  const projectFolderIds = await loadProjectFolderIds(ownerUserId, projectId);
  const papers = await loadProjectPapers(ownerUserId, projectFolderIds);
  const paperIds = papers.map((paper) => paper.paperId);
  const [concepts, keywords, persistedCache] = await Promise.all([
    loadProjectConceptSourceRows(ownerUserId, paperIds),
    loadProjectKeywordSourceRows(ownerUserId, paperIds),
    loadPersistedProjectCorpusTopicCache(ownerUserId, projectId),
  ]);

  const nextSignature = buildSourceSignature(papers, concepts, keywords);
  const cache =
    persistedCache && persistedCache.sourceSignature === nextSignature
      ? persistedCache
      : await buildCorpusTopicCache(papers, concepts, keywords);

  if (!persistedCache || persistedCache.sourceSignature !== cache.sourceSignature) {
    await persistProjectCorpusTopicCache(ownerUserId, projectId, cache);
  }

  return {
    cache,
    topicFamilies: rehydrateTopicFamilies(cache.families),
    projectFolderIds,
    paperIds,
  };
}

export function filterTopicFamiliesByPaperIds(
  topicFamilies: CorpusTopicFamily[],
  allowedPaperIds: Set<PaperId>
): CorpusTopicFamily[] {
  if (allowedPaperIds.size === 0) {
    return [];
  }

  return topicFamilies
    .map((family) => {
      const scopedPaperIds = family.paperIds.filter((paperId) =>
        allowedPaperIds.has(paperId)
      );
      if (scopedPaperIds.length === 0) {
        return null;
      }

      return {
        ...family,
        paperIds: scopedPaperIds,
      };
    })
    .filter((family): family is CorpusTopicFamily => Boolean(family));
}
