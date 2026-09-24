/**
 * Groups a repository's topics into research themes by what they are about.
 *
 * Why this exists. Every paper's topics are named by the analysis pipeline using
 * that paper alone, so two papers on the same subject reliably come back with two
 * different labels - the same study uploaded twice came back with none in common.
 * On the real 39-paper test corpus that produced 120 topics, 119 of which
 * belonged to exactly one paper, so every chart on the dashboard could only draw
 * a flat row of ones.
 *
 * A reconciliation step used to exist (corpus-topic-cache.ts), but it reads only
 * from Supabase and has been bypassed since the move to Cloud SQL, and even when
 * it ran it merged only identical wording.
 *
 * How it groups, and why this way. Measured on that corpus (docs/28): grouping
 * by embedding similarity merged unlike topics however it was tuned -
 * pronunciation with grammar, oracy with writing - because nearly every label in
 * one field shares "assessment", "framework" and "EFL". A language model reading
 * the labels and their keywords groups by what is studied instead, but a single
 * call is partly chance: two calls on the same topics agreed on under half of
 * their pairings, and three of six single calls broke a pair that is not a
 * matter of taste. So several calls are made and only the merges most of them
 * agree on survive. Both consensus groupings measured kept every must-merge pair
 * together and every look-alike pair apart, with no theme judged unrelated.
 *
 * When. A grouping takes seconds per call, so it never runs inside a dashboard
 * read: the read applies what is stored, and the open dashboard asks for new
 * topics to be grouped in a request of its own. A topic seen for the
 * first time - a new paper's - is filed under the existing themes, the way a
 * researcher files a new paper, so the themes a reader has learnt do not
 * reshuffle. The whole repository is regrouped once it has grown by a quarter,
 * because filed topics inherit whatever the earlier grouping could see: filing
 * five held-back papers kept every look-alike apart but missed two true pairs,
 * both because the grouping made without those papers had split a focus.
 *
 * Everything in this file is pure: prompts, parsing, agreement, the store's
 * shape and applying it. Model calls, the database and the job live in
 * topic-theme-service.ts.
 */
import type { CorpusTopicFamily, PaperId, TrendRow } from "@/types/database";

/* ------------------------------------------------------------------ tuning */

/**
 * No theme may hold more than this share of the repository's papers.
 *
 * The guard against lumping. A theme covering most of the corpus answers no
 * question a researcher has, however similar its members look.
 */
export const DEFAULT_MAX_THEME_SHARE = 0.3;

/** Independent groupings asked for; a merge needs most of them. */
export const CONSENSUS_RUNS = 3;

/**
 * How often two topics must share a theme across the runs to stay together.
 * Just under two of three, so that two agreeing runs are enough.
 */
export const CONSENSUS_AGREEMENT = 0.6;

/**
 * New topics beyond this share of the repository are regrouped whole rather
 * than filed one by one - at that point the existing themes describe too little
 * of what is there. The floor keeps a small repository from regrouping on every
 * paper.
 */
export const INCREMENTAL_LIMIT_SHARE = 0.4;
export const INCREMENTAL_LIMIT_FLOOR = 8;

/**
 * Regroup whole once the repository has this many times the topics it had then.
 * At three calls per regrouping (about $0.03 for 120 topics) this costs roughly
 * $0.003 per paper added, for groupings that see the whole repository.
 */
export const REGROUP_GROWTH = 1.25;

/** Bumped when the stored shape or the method changes, so old stores are rebuilt. */
export const THEME_STORE_VERSION = 1;

/* -------------------------------------------------------------- the items */

export interface TopicItem {
  /** Identity: the label folded for case and spacing. */
  key: string;
  /** The label as it is most often written. */
  label: string;
  /** The keywords its papers use under it, most used first. */
  keywords: string[];
  paperIds: Set<PaperId>;
}

export function normalizeTopicKey(label: string): string {
  return String(label ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * One item per distinct topic, whatever the casing.
 *
 * Grouped on the paper's own label (`raw_topic` when a row has already been
 * themed), so grouping twice cannot compound.
 */
export function collectTopicItems(trends: TrendRow[]): TopicItem[] {
  const byKey = new Map<
    string,
    { spellings: Map<string, number>; paperIds: Set<PaperId>; keywords: Map<string, number> }
  >();
  for (const row of trends) {
    const original = String(row.raw_topic ?? row.topic ?? "").trim();
    const key = normalizeTopicKey(original);
    if (!key) continue;
    const entry = byKey.get(key) ?? {
      spellings: new Map<string, number>(),
      paperIds: new Set<PaperId>(),
      keywords: new Map<string, number>(),
    };
    entry.spellings.set(original, (entry.spellings.get(original) ?? 0) + 1);
    entry.paperIds.add(row.paper_id);
    const keyword = String(row.keyword ?? "").trim();
    if (keyword) {
      entry.keywords.set(keyword, (entry.keywords.get(keyword) ?? 0) + Math.max(1, row.keyword_frequency || 1));
    }
    byKey.set(key, entry);
  }

  return [...byKey.entries()]
    .map(([key, entry]) => ({
      key,
      // The most used spelling; on a tie, the capitalised one a reader expects
      // ("Mixed Methods", not "mixed methods"), then alphabetical.
      label: [...entry.spellings.entries()].sort(
        (a, b) =>
          b[1] - a[1] ||
          Number(/^[A-Z]/.test(b[0])) - Number(/^[A-Z]/.test(a[0])) ||
          a[0].localeCompare(b[0])
      )[0][0],
      keywords: [...entry.keywords.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([keyword]) => keyword),
      paperIds: entry.paperIds,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/* ------------------------------------------------ grouping by a model */

/**
 * What a theme is about: the subject a study investigates, or how it was done.
 *
 * Measured on the 39-paper corpus: the two largest themes were "Mixed Methods
 * Research Methodology" (8 papers) and "Assessment Instruments and Elicitation
 * Methods" (6). Ranked with the subjects, they would head every topic chart
 * while saying nothing about what anyone studied.
 */
export type ThemeKind = "topic" | "method";

export interface ThemeGroup {
  name: string;
  kind: ThemeKind;
  /** Indices into the items the grouping was asked about. */
  members: number[];
}

export interface GroupingMessage {
  role: "system" | "user";
  content: string;
}

const GROUPING_SYSTEM =
  "You organise the topics extracted from one collection of research papers into research themes, " +
  "the way a researcher would organise a literature review of that collection. You reply with JSON only.";

/**
 * Each rule is here because a measured grouping broke without it (docs/28).
 * The second one, for instance: "L2 Phonological Acquisition" and "L2
 * Morphosyntactic Acquisition" both list L1 transfer among their keywords, and
 * were merged by every method tried until the rule said what a focus is.
 */
const GROUPING_RULES = [
  "Put topics in the same theme only when they share a research focus: the same phenomenon, skill, intervention or method being studied. Sharing words such as \"assessment\", \"framework\", \"pedagogy\", \"learners\", \"EFL\" or \"Thai\" is not enough on its own.",
  "The focus is WHAT is studied, not a theory or lens the studies share. Two topics that both explain something by L1 transfer, or both take a sociocultural view, are different themes when what they explain differs (pronunciation is not grammar).",
  "Each theme has ONE focus that every member is about. If a group needs \"and\" to cover two different focuses, it is two themes.",
  "Topics about how a study was carried out (research design, mixed methods, questionnaires, experimental tasks, statistics) go in method themes of their own, never in a subject theme. A method theme is one method (for example mixed-methods design, corpus analysis, a psycholinguistic experiment), not a collection of every method.",
  "A topic that fits a theme only loosely stays in a theme of its own. Leaving a topic alone is better than stretching a theme to hold it.",
  "Name each theme in 2 to 6 words of Title Case, in the field's own wording: the one focus its members share, true of every member.",
  "Mark each theme's kind: \"method\" when it is about how studies were carried out, otherwise \"topic\".",
  "Every topic number appears in exactly one theme.",
];

function topicText(item: TopicItem): string {
  return item.keywords.length > 0 ? `${item.label} - keywords: ${item.keywords.join(", ")}` : item.label;
}

/**
 * Asks for a partition of the topics into themes.
 *
 * `previousNames` are the themes the repository already showed, if any; a
 * regrouping reuses them where they still fit, so a reader does not meet a new
 * name for an unchanged idea every time the corpus grows.
 */
export function groupingMessages(items: TopicItem[], previousNames: string[] = []): GroupingMessage[] {
  const continuity =
    previousNames.length > 0
      ? `\nThis repository already shows these theme names. Where one still fits a theme, reuse it exactly:\n${previousNames
          .map((name) => `- ${name}`)
          .join("\n")}\n`
      : "";
  return [
    { role: "system", content: GROUPING_SYSTEM },
    {
      role: "user",
      content:
        `Rules:\n${GROUPING_RULES.map((rule, i) => `${i + 1}. ${rule}`).join("\n")}\n` +
        continuity +
        `\nTopics (number. label - the keywords its papers use):\n${items
          .map((item, index) => `${index + 1}. ${topicText(item)}`)
          .join("\n")}\n\n` +
        `Reply with JSON only: {"themes":[{"name":"...","kind":"topic","topics":[1,2]}]}`,
    },
  ];
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanThemeName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Turns a model's reply into a partition that is valid by construction.
 *
 * The model is not trusted to follow its own rules. A topic it assigns twice
 * keeps its first theme; a number that names no topic is ignored; a topic it
 * forgets stands alone under its own label, so nothing a paper said is ever
 * dropped from the dashboard; two themes given the same name are one theme,
 * because the charts would draw them as one anyway. A reply that places fewer
 * than half the topics is treated as a failure rather than patched, since at
 * that point the patching would be doing the grouping.
 *
 * A theme of one topic keeps that topic's own label. The model renames them
 * when asked for names - "Multimodal Literacy and Writing" came back as
 * "Multimodal Narrative Writing" - and with nothing to summarise, a new name can
 * only drift from what the paper said.
 */
export function parseGrouping(text: string | null | undefined, items: TopicItem[]): ThemeGroup[] | null {
  const parsed = extractJsonObject(String(text ?? "")) as { themes?: unknown } | null;
  const themes = Array.isArray(parsed?.themes) ? (parsed!.themes as Array<Record<string, unknown>>) : null;
  if (!themes) return null;

  const owner = new Array<number>(items.length).fill(-1);
  const groups: ThemeGroup[] = [];
  const groupByName = new Map<string, number>();
  let placed = 0;

  for (const theme of themes) {
    const name = cleanThemeName(theme?.name);
    const numbers = Array.isArray(theme?.topics) ? (theme.topics as unknown[]) : [];
    const members: number[] = [];
    for (const value of numbers) {
      const index = Number(value) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= items.length || owner[index] >= 0) continue;
      if (members.includes(index)) continue;
      members.push(index);
    }
    if (members.length === 0) continue;
    const fallbackName = name || items[members[0]].label;
    const kind: ThemeKind = theme?.kind === "method" ? "method" : "topic";
    const nameKey = normalizeTopicKey(fallbackName);
    let groupIndex = groupByName.get(nameKey);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groups.push({ name: fallbackName, kind, members: [] });
      groupByName.set(nameKey, groupIndex);
    }
    for (const index of members) {
      owner[index] = groupIndex;
      groups[groupIndex].members.push(index);
      placed += 1;
    }
  }

  if (placed < Math.ceil(items.length / 2)) return null;

  items.forEach((item, index) => {
    if (owner[index] >= 0) return;
    const nameKey = normalizeTopicKey(item.label);
    const existing = groupByName.get(nameKey);
    if (existing !== undefined) {
      groups[existing].members.push(index);
    } else {
      groupByName.set(nameKey, groups.length);
      groups.push({ name: item.label, kind: "topic", members: [index] });
    }
    owner[index] = groupByName.get(nameKey)!;
  });

  for (const group of groups) {
    group.members.sort((a, b) => a - b);
    if (group.members.length === 1) group.name = items[group.members[0]].label;
  }
  return groups;
}

/* ------------------------------------------------ agreeing on a grouping */

export interface ClusterOptions {
  threshold: number;
  maxThemeShare?: number;
  /** Papers in the whole repository, for the share guard. */
  totalPapers?: number;
}

/**
 * Average-linkage agglomerative clustering over a similarity matrix.
 *
 * Repeatedly merges the two most alike groups while they are at least
 * `threshold` alike on average, and never lets a merge produce a group holding
 * more than `maxThemeShare` of the repository's papers. Returns groups of item
 * indices. Pure and deterministic: ties break by index.
 *
 * Average rather than single linkage on purpose. Single linkage chains: A
 * resembles B, B resembles C, and suddenly assessment and pronunciation are one
 * theme because each resembles "Thai EFL learners" a little.
 */
export function clusterBySimilarity(items: TopicItem[], similarity: number[][], options: ClusterOptions): number[][] {
  const maxShare = options.maxThemeShare ?? DEFAULT_MAX_THEME_SHARE;
  const totalPapers = options.totalPapers ?? new Set(items.flatMap((item) => [...item.paperIds])).size;
  // The cap is at least two papers, or a repository of three could never merge.
  const paperCap = Math.max(2, Math.floor(maxShare * totalPapers));

  const n = items.length;
  const groups: Array<{ members: number[]; papers: Set<PaperId> } | null> = items.map((item, index) => ({
    members: [index],
    papers: new Set(item.paperIds),
  }));
  // A copy, because the Lance-Williams updates below rewrite it.
  const sim: number[][] = similarity.map((row) => [...row]);

  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let best = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const gi = groups[i];
      if (!gi) continue;
      for (let j = i + 1; j < n; j += 1) {
        const gj = groups[j];
        if (!gj) continue;
        const value = sim[i][j];
        if (value < options.threshold || value <= best) continue;
        // The share guard is a property of the union, so it is checked for each
        // candidate rather than once.
        if (new Set([...gi.papers, ...gj.papers]).size > paperCap) continue;
        best = value;
        bestI = i;
        bestJ = j;
      }
    }
    if (bestI < 0) break;

    const a = groups[bestI]!;
    const b = groups[bestJ]!;
    for (let k = 0; k < n; k += 1) {
      if (k === bestI || k === bestJ || !groups[k]) continue;
      const merged = (a.members.length * sim[bestI][k] + b.members.length * sim[bestJ][k]) / (a.members.length + b.members.length);
      sim[bestI][k] = merged;
      sim[k][bestI] = merged;
    }
    groups[bestI] = {
      members: [...a.members, ...b.members].sort((x, y) => x - y),
      papers: new Set([...a.papers, ...b.papers]),
    };
    groups[bestJ] = null;
  }

  return groups
    .filter((group): group is { members: number[]; papers: Set<PaperId> } => Boolean(group))
    .map((group) => group.members);
}

/**
 * Keeps only the merges that most of several independent groupings make.
 *
 * Topics that most runs put together are grouped by average linkage over how
 * often they were; a merge only one run made does not survive. Each theme takes
 * the name of the run theme that matches it best, and no two themes share a
 * name - the charts group by name, so two themes with one name would be drawn as
 * one and the split made here would silently undo itself.
 */
export function consensusGroups(
  runs: ThemeGroup[][],
  items: TopicItem[],
  options: { agreement?: number; maxThemeShare?: number; totalPapers?: number } = {}
): ThemeGroup[] {
  const n = items.length;
  const together: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const run of runs) {
    for (const group of run) {
      for (const a of group.members) for (const b of group.members) together[a][b] += 1 / runs.length;
    }
  }
  for (let i = 0; i < n; i += 1) together[i][i] = 1;

  const clusters = clusterBySimilarity(items, together, {
    threshold: options.agreement ?? CONSENSUS_AGREEMENT,
    maxThemeShare: options.maxThemeShare,
    totalPapers: options.totalPapers,
  });

  const candidates = runs.flat();
  const kindOf = (members: number[]): ThemeKind => {
    const votes = candidates.filter((group) => members.some((index) => group.members.includes(index)));
    return votes.filter((group) => group.kind === "method").length > votes.length / 2 ? "method" : "topic";
  };
  // Largest first, so the themes a reader sees most get first claim on a name.
  const order = clusters
    .map((members, c) => ({ members, c }))
    .sort((a, b) => b.members.length - a.members.length || a.c - b.c);
  const used = new Set(
    clusters.filter((members) => members.length === 1).map((members) => normalizeTopicKey(items[members[0]].label))
  );
  const named = new Map<number, ThemeGroup>();
  for (const { members, c } of order) {
    if (members.length === 1) {
      named.set(c, { name: items[members[0]].label, kind: kindOf(members), members });
      continue;
    }
    const set = new Set(members);
    const ranked = candidates
      .map((group) => {
        const shared = group.members.filter((index) => set.has(index)).length;
        return { group, score: shared / (members.length + group.members.length - shared) };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.group.name.localeCompare(b.group.name));
    const pick = ranked.find((entry) => !used.has(normalizeTopicKey(entry.group.name)));
    const fallback = members
      .map((index) => items[index].label)
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
      .find((label) => !used.has(normalizeTopicKey(label)));
    const name = pick?.group.name ?? fallback ?? items[members[0]].label;
    used.add(normalizeTopicKey(name));
    named.set(c, { name, kind: pick?.group.kind ?? kindOf(members), members });
  }
  return clusters.map((_, c) => named.get(c)!);
}

/* ------------------------------------------------ filing new topics */

export interface StoredTheme {
  name: string;
  kind: ThemeKind;
}

/**
 * Asks where each new topic belongs among the themes the repository has.
 *
 * The same rules as grouping, applied to one topic at a time against themes
 * that already exist - which is how a researcher files a new paper, and why a
 * new paper does not reshuffle what the reader has learnt.
 */
export function assignmentMessages(
  themes: Array<StoredTheme & { examples: string[] }>,
  newItems: TopicItem[]
): GroupingMessage[] {
  return [
    { role: "system", content: GROUPING_SYSTEM },
    {
      role: "user",
      content:
        `A repository's topics are already grouped into the themes below. New papers have added new topics.\n\n` +
        `Rules:\n${GROUPING_RULES.slice(0, 5)
          .map((rule, i) => `${i + 1}. ${rule}`)
          .join("\n")}\n\n` +
        `Themes (number. name: some of the topics already in it):\n${themes
          .map((theme, t) => `${t + 1}. ${theme.name}: ${theme.examples.join("; ")}`)
          .join("\n")}\n\n` +
        `New topics:\n${newItems.map((item, i) => `N${i + 1}. ${topicText(item)}`).join("\n")}\n\n` +
        `For each new topic give the number of the theme whose focus it shares, or null if none does.\n` +
        `Reply with JSON only: {"assignments":[{"topic":"N1","theme":3}]}`,
    },
  ];
}

/** One reply's answer per new topic: a theme index, or null for none. Null if unreadable. */
export function parseAssignment(
  text: string | null | undefined,
  themeCount: number,
  newCount: number
): Array<number | null> | null {
  const parsed = extractJsonObject(String(text ?? "")) as { assignments?: unknown } | null;
  if (!Array.isArray(parsed?.assignments)) return null;
  const out = new Array<number | null>(newCount).fill(null);
  for (const entry of parsed!.assignments as Array<Record<string, unknown>>) {
    const topic = Number(String(entry?.topic ?? "").replace(/^N/i, "")) - 1;
    if (!Number.isInteger(topic) || topic < 0 || topic >= newCount) continue;
    const theme = entry?.theme === null || entry?.theme === undefined ? NaN : Number(entry.theme) - 1;
    out[topic] = Number.isInteger(theme) && theme >= 0 && theme < themeCount ? theme : null;
  }
  return out;
}

/** A new topic joins a theme only when most replies chose that same theme. */
export function consensusAssignment(votes: Array<Array<number | null>>, newCount: number): Array<number | null> {
  return Array.from({ length: newCount }, (_, topic) => {
    const counts = new Map<number, number>();
    for (const vote of votes) {
      const theme = vote[topic];
      if (theme !== null && theme !== undefined) counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
    for (const [theme, count] of counts) if (count > votes.length / 2) return theme;
    return null;
  });
}

/* ------------------------------------------------------------ the store */

/** What is kept per repository: the themes, and which theme each topic is in. */
export interface ThemeStore {
  version: typeof THEME_STORE_VERSION;
  themes: StoredTheme[];
  /** Normalised topic -> index into `themes`. */
  assignments: Record<string, number>;
  groupedAt: string | null;
  /** Topics the repository had when it was last grouped whole. */
  fullGroupingTopics: number;
  model?: string | null;
  /** A grouping job was requested at this time and has not finished. */
  pendingSince?: string | null;
  /** The last grouping job failed at this time. */
  failedAt?: string | null;
  /** Failures in a row, for backing off. */
  failures?: number;
}

/** A stored payload, if it is one this version can use. */
export function readThemeStore(payload: unknown): ThemeStore | null {
  const value = payload as Partial<ThemeStore> | null;
  if (!value || typeof value !== "object" || value.version !== THEME_STORE_VERSION) return null;
  if (!Array.isArray(value.themes) || !value.assignments || typeof value.assignments !== "object") return null;
  return {
    version: THEME_STORE_VERSION,
    themes: value.themes
      .filter((theme) => theme && typeof theme.name === "string" && theme.name.trim())
      .map((theme) => ({ name: theme.name, kind: theme.kind === "method" ? "method" : "topic" })),
    assignments: value.assignments as Record<string, number>,
    groupedAt: typeof value.groupedAt === "string" ? value.groupedAt : null,
    fullGroupingTopics: Number(value.fullGroupingTopics) || 0,
    model: typeof value.model === "string" ? value.model : null,
    pendingSince: typeof value.pendingSince === "string" ? value.pendingSince : null,
    failedAt: typeof value.failedAt === "string" ? value.failedAt : null,
    failures: Number(value.failures) || 0,
  };
}

/** The stored themes that still have topics here, and the topics no theme holds yet. */
export function groupsFromStore(items: TopicItem[], store: ThemeStore | null): { groups: ThemeGroup[]; unknown: number[] } {
  const members = new Map<number, number[]>();
  const unknown: number[] = [];
  items.forEach((item, index) => {
    const theme = store?.assignments[item.key];
    if (store && Number.isInteger(theme) && theme! >= 0 && theme! < store.themes.length) {
      members.set(theme!, [...(members.get(theme!) ?? []), index]);
    } else {
      unknown.push(index);
    }
  });
  const groups = [...members.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([theme, indices]) => ({ name: store!.themes[theme].name, kind: store!.themes[theme].kind, members: indices }));
  return { groups, unknown };
}

/** What a grouping job should do: nothing, file the new topics, or regroup whole. */
export function planThemeUpdate(items: TopicItem[], store: ThemeStore | null): "none" | "incremental" | "full" {
  if (items.length === 0) return "none";
  if (!store || store.themes.length === 0) return "full";
  const { unknown } = groupsFromStore(items, store);
  if (unknown.length > Math.max(INCREMENTAL_LIMIT_FLOOR, INCREMENTAL_LIMIT_SHARE * items.length)) return "full";
  if (store.fullGroupingTopics > 0 && items.length >= REGROUP_GROWTH * store.fullGroupingTopics) return "full";
  return unknown.length > 0 ? "incremental" : "none";
}

export function storeFromGroups(
  items: TopicItem[],
  groups: ThemeGroup[],
  options: { now: string; model?: string | null; fullGroupingTopics: number }
): ThemeStore {
  const assignments: Record<string, number> = {};
  const themes: StoredTheme[] = [];
  for (const group of groups) {
    if (group.members.length === 0) continue;
    for (const index of group.members) assignments[items[index].key] = themes.length;
    themes.push({ name: group.name, kind: group.kind });
  }
  return {
    version: THEME_STORE_VERSION,
    themes,
    assignments,
    groupedAt: options.now,
    fullGroupingTopics: options.fullGroupingTopics,
    model: options.model ?? null,
    pendingSince: null,
    failedAt: null,
    failures: 0,
  };
}

/**
 * Adds themes formed among new topics that fit none of the existing ones.
 *
 * Measured: filing five held-back papers left a Global Englishes paper's two
 * Global Englishes topics standing apart, because no such theme existed yet.
 * Ten papers on a new subject would have shown as ten scattered topics until the
 * next full regrouping. `leftoverGroups` is a grouping of just those topics,
 * indexed into `leftovers`; a theme named like one that exists joins it.
 */
export function addLeftoverGroups(
  groups: ThemeGroup[],
  leftovers: number[],
  leftoverGroups: ThemeGroup[]
): ThemeGroup[] {
  const next = groups.map((group) => ({ ...group, members: [...group.members] }));
  const byName = new Map(next.map((group, g) => [normalizeTopicKey(group.name), g]));
  for (const group of leftoverGroups) {
    const members = group.members.map((i) => leftovers[i]).filter((index) => index !== undefined);
    if (members.length === 0) continue;
    const existing = byName.get(normalizeTopicKey(group.name));
    if (existing !== undefined) {
      next[existing].members.push(...members);
      next[existing].members.sort((a, b) => a - b);
      continue;
    }
    byName.set(normalizeTopicKey(group.name), next.length);
    next.push({ name: group.name, kind: group.kind, members: [...members].sort((a, b) => a - b) });
  }
  return next;
}

/**
 * Files new topics into existing groups: a chosen theme, or a theme of its own.
 *
 * A new topic whose label is already a theme's name joins it without asking,
 * since the charts would draw them as one bar anyway.
 */
export function extendGroups(
  items: TopicItem[],
  groups: ThemeGroup[],
  unknown: number[],
  choices: Array<number | null>
): ThemeGroup[] {
  const next = groups.map((group) => ({ ...group, members: [...group.members] }));
  const byName = new Map(next.map((group, g) => [normalizeTopicKey(group.name), g]));
  unknown.forEach((index, i) => {
    const same = byName.get(items[index].key);
    const chosen = choices[i];
    const target = same ?? (chosen !== null && chosen !== undefined && chosen < groups.length ? chosen : undefined);
    if (target !== undefined) {
      next[target].members.push(index);
      return;
    }
    byName.set(items[index].key, next.length);
    next.push({ name: items[index].label, kind: "topic", members: [index] });
  });
  for (const group of next) group.members.sort((a, b) => a - b);
  return next;
}

/* --------------------------------------------------- from groups to themes */

export interface ThemeResult {
  families: CorpusTopicFamily[];
  /** Normalised raw topic -> theme name. */
  themeByTopicKey: Map<string, string>;
  /** Normalised raw topic -> the kind of its theme. */
  kindByTopicKey: Map<string, ThemeKind>;
}

export function buildNamedThemes(trends: TrendRow[], items: TopicItem[], groups: ThemeGroup[]): ThemeResult {
  const themeByTopicKey = new Map<string, string>();
  const kindByTopicKey = new Map<string, ThemeKind>();
  for (const group of groups) {
    for (const index of group.members) {
      themeByTopicKey.set(items[index].key, group.name);
      kindByTopicKey.set(items[index].key, group.kind);
    }
  }

  const rowsByKey = new Map<string, TrendRow[]>();
  for (const row of trends) {
    const key = normalizeTopicKey(String(row.raw_topic ?? row.topic ?? ""));
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }

  const families = groups
    .filter((group) => group.members.length > 0)
    .map((group): CorpusTopicFamily => {
      const rows = group.members.flatMap((index) => rowsByKey.get(items[index].key) ?? []);
      const keywordTotals = new Map<string, number>();
      for (const row of rows) {
        const keyword = String(row.keyword ?? "").trim();
        if (keyword) keywordTotals.set(keyword, (keywordTotals.get(keyword) ?? 0) + Math.max(1, row.keyword_frequency || 1));
      }
      const rankedKeywords = [...keywordTotals.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([keyword]) => keyword);
      return {
        id: "",
        canonicalTopic: group.name,
        aliases: group.members.map((index) => items[index].label).sort((a, b) => a.localeCompare(b)),
        representativeKeywords: rankedKeywords.slice(0, 6),
        relatedKeywords: rankedKeywords,
        matchedTerms: group.members.map((index) => items[index].label),
        evidenceSnippets: [...new Set(rows.map((row) => String(row.evidence ?? "").trim()).filter(Boolean))].slice(0, 6),
        paperIds: [...new Set(rows.map((row) => row.paper_id))],
        folderIds: [...new Set(rows.map((row) => row.folder_id).filter((value): value is string => Boolean(value)))],
        years: [...new Set(rows.map((row) => row.year))].sort(),
        totalKeywordFrequency: rows.reduce((sum, row) => sum + Math.max(0, row.keyword_frequency || 0), 0),
        kind: group.kind,
      };
    });

  families.sort(
    (a, b) =>
      b.paperIds.length - a.paperIds.length ||
      b.totalKeywordFrequency - a.totalKeywordFrequency ||
      a.canonicalTopic.localeCompare(b.canonicalTopic)
  );
  families.forEach((family, index) => {
    family.id = `theme-${index + 1}`;
  });
  return { families, themeByTopicKey, kindByTopicKey };
}

/**
 * Rewrites each row's topic to its theme and keeps the original in `raw_topic`.
 *
 * Every tab that reads `row.topic` - Overview, Trend, Keyword Explorer, the
 * adaptive planner - therefore groups the same way, from one source, without
 * each implementing grouping of its own. Nothing stored is changed: the paper's
 * own label is always recoverable from `raw_topic`.
 */
export function applyThemes(
  trends: TrendRow[],
  themeByTopicKey: Map<string, string>,
  kindByTopicKey: Map<string, ThemeKind> = new Map()
): TrendRow[] {
  return trends.map((row) => {
    const raw = String(row.raw_topic ?? row.topic ?? "");
    const key = normalizeTopicKey(raw);
    const theme = themeByTopicKey.get(key);
    const topic_kind = kindByTopicKey.get(key) ?? "topic";
    return theme ? { ...row, topic: theme, raw_topic: raw, topic_kind } : { ...row, raw_topic: raw, topic_kind };
  });
}

/**
 * What a dashboard read does: applies the stored grouping to the rows in view.
 *
 * A topic the store has not seen yet stands alone under its own label until the
 * job files it, so a new paper is visible at once and grouped moments later.
 */
export function applyThemeStore(
  trends: TrendRow[],
  store: ThemeStore | null
): { trends: TrendRow[]; families: CorpusTopicFamily[]; unknownTopics: number } {
  const items = collectTopicItems(trends);
  const { groups, unknown } = groupsFromStore(items, store);
  const all = extendGroups(items, groups, unknown, unknown.map(() => null));
  const { families, themeByTopicKey, kindByTopicKey } = buildNamedThemes(trends, items, all);
  return { trends: applyThemes(trends, themeByTopicKey, kindByTopicKey), families, unknownTopics: unknown.length };
}

/* ------------------------------------------------- measuring a grouping */

export interface ThemeMetrics {
  papers: number;
  topics: number;
  themes: number;
  /** Share of themes that belong to exactly one paper. */
  singletonRate: number;
  /** Share of papers held by the largest theme. */
  largestThemeShare: number;
  /** Share of papers that sit in at least one theme shared with another paper. */
  papersInSharedThemes: number;
}

export function measureThemes(families: CorpusTopicFamily[], totalPapers: number): ThemeMetrics {
  const singles = families.filter((family) => family.paperIds.length <= 1).length;
  const largest = Math.max(0, ...families.map((family) => family.paperIds.length));
  const shared = new Set(
    families.filter((family) => family.paperIds.length >= 2).flatMap((family) => family.paperIds)
  );
  return {
    papers: totalPapers,
    topics: families.reduce((sum, family) => sum + family.aliases.length, 0),
    themes: families.length,
    singletonRate: families.length === 0 ? 0 : singles / families.length,
    largestThemeShare: totalPapers === 0 ? 0 : largest / totalPapers,
    papersInSharedThemes: totalPapers === 0 ? 0 : shared.size / totalPapers,
  };
}
