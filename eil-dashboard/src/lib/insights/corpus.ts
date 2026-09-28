/*
 * One record per paper in the selection, which every insight reads.
 *
 * Built from the same themed, filtered rows the fixed tabs draw, so a theme
 * here is the theme a reader sees there. Two things differ on purpose:
 *
 *  - A likely duplicate upload is counted once. The fixed tabs count both
 *    copies and say so; an insight that "5 papers" share a pairing must not
 *    rest on three studies.
 *  - Papers without a readable year stay in every count that is not about time,
 *    and are left out of every one that is.
 */
import { isDatedYear } from "@/lib/dated-year";
import { likelyDuplicatePapers } from "@/lib/dashboard-analytics";
import type { CategoryAssignmentRow, PaperId, TrackRow, TrendRow } from "@/types/database";
import { TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";

/** What the analysis stored about a paper beyond its topics. */
export interface PaperProfile {
  /** Research typology group, named consistently across pipeline versions. */
  typology?: string | null;
  /** Objective verbs ("investigate", "evaluate"), lowercase. */
  aims?: string[];
  /** Contribution types ("instrument development"), lowercase. */
  contributions?: string[];
  authorKeywords?: string[];
  /** The paper this upload repeats, when the pipeline found it by content. */
  duplicateOf?: PaperId | null;
  yearConfidence?: number | null;
}

export interface CorpusPaper {
  id: PaperId;
  title: string;
  /** Publication year, or null when none could be read. */
  year: number | null;
  themes: Set<string>;
  methods: Set<string>;
  /** Extracted keywords and raw topic labels, lowercase, for matching author keywords. */
  terms: Set<string>;
  /** Primary (single-label) category, by its label. */
  category: string | null;
  typology: string | null;
  aims: Set<string>;
  contributions: Set<string>;
  authorKeywords: string[];
  yearConfidence: number | null;
}

export interface InsightCorpus {
  papers: CorpusPaper[];
  /** Copies left out, each with the paper it repeats. */
  duplicates: Array<{ copy: PaperId; original: PaperId; title: string }>;
  classificationEnabled: boolean;
}

export interface CorpusInput {
  trends: TrendRow[];
  categoryAssignments?: CategoryAssignmentRow[];
  tracksSingle?: TrackRow[];
  classificationEnabled?: boolean;
  /** The repository's names for the legacy el/eli/lae/other slots. */
  trackLabels?: Partial<Record<TrackKey, string>>;
}

function clean(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function buildInsightCorpus(input: CorpusInput, profiles: Map<PaperId, PaperProfile> = new Map()): InsightCorpus {
  const classificationEnabled = input.classificationEnabled !== false;
  const byId = new Map<PaperId, CorpusPaper>();
  for (const row of input.trends) {
    const id = row.paper_id;
    let paper = byId.get(id);
    if (!paper) {
      const profile = profiles.get(id);
      paper = {
        id,
        title: clean(row.title) || "Untitled paper",
        year: isDatedYear(row.year) ? Number(row.year) : null,
        themes: new Set(),
        methods: new Set(),
        terms: new Set(),
        category: null,
        typology: profile?.typology ? clean(profile.typology) : null,
        aims: new Set((profile?.aims ?? []).map((aim) => clean(aim).toLowerCase()).filter(Boolean)),
        contributions: new Set((profile?.contributions ?? []).map((kind) => clean(kind).toLowerCase()).filter(Boolean)),
        authorKeywords: (profile?.authorKeywords ?? []).map(clean).filter(Boolean),
        yearConfidence: profile?.yearConfidence ?? (typeof row.year_confidence === "number" ? row.year_confidence : null),
      };
      byId.set(id, paper);
    }
    const topic = clean(row.topic);
    if (topic) (row.topic_kind === "method" ? paper.methods : paper.themes).add(topic);
    for (const term of [row.keyword, row.raw_topic, row.topic]) {
      const value = clean(term).toLowerCase();
      if (value) paper.terms.add(value);
    }
  }

  if (classificationEnabled) {
    const assignments = (input.categoryAssignments ?? []).filter((row) => row.assignment_type === "single");
    if (assignments.length > 0) {
      for (const row of assignments) {
        const paper = byId.get(row.paper_id);
        if (paper && !paper.category) paper.category = clean(row.category_label) || clean(row.category_key);
      }
    } else {
      // Papers classified before per-category assignments existed carry only
      // the four stored slots.
      for (const row of input.tracksSingle ?? []) {
        const paper = byId.get(row.paper_id);
        if (!paper || paper.category) continue;
        const slot = TRACK_COLS.find((track) => row[track.toLowerCase() as keyof TrackRow] === 1);
        if (slot && slot !== "Other") paper.category = input.trackLabels?.[slot] || TRACK_NAMES[slot];
      }
    }
  }

  // A copy is left out only when the paper it repeats is in view; otherwise it
  // is that study's only appearance in the selection.
  const duplicates: InsightCorpus["duplicates"] = [];
  const dropped = new Set<PaperId>();
  const byContent = [...profiles.entries()]
    .filter(([id, profile]) => profile.duplicateOf && byId.has(id) && byId.has(profile.duplicateOf))
    .map(([id, profile]) => ({ copy: id, original: profile.duplicateOf as PaperId }));
  const byTitle = likelyDuplicatePapers(input.trends).map((pair) => ({ copy: pair.paperId, original: pair.originalId }));
  for (const pair of [...byContent, ...byTitle]) {
    if (dropped.has(pair.copy) || dropped.has(pair.original) || pair.copy === pair.original) continue;
    dropped.add(pair.copy);
    duplicates.push({ ...pair, title: byId.get(pair.copy)?.title ?? "" });
  }

  const papers = [...byId.values()]
    .filter((paper) => !dropped.has(paper.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { papers, duplicates, classificationEnabled };
}

/** Papers per label, for any per-paper set of labels. */
export function indexBy(papers: CorpusPaper[], labelsOf: (paper: CorpusPaper) => Iterable<string>): Map<string, Set<PaperId>> {
  const index = new Map<string, Set<PaperId>>();
  for (const paper of papers) {
    for (const label of labelsOf(paper)) {
      if (!label) continue;
      const set = index.get(label) ?? new Set<PaperId>();
      set.add(paper.id);
      index.set(label, set);
    }
  }
  return index;
}

export function intersectionSize(a: Set<PaperId>, b: Set<PaperId>): number {
  let count = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const id of small) if (large.has(id)) count += 1;
  return count;
}

export function intersection(a: Set<PaperId>, b: Set<PaperId>): PaperId[] {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  return [...small].filter((id) => large.has(id));
}
