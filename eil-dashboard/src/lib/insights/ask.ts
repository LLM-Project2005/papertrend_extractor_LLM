/*
 * "Ask about these papers" (docs/30, phase 4).
 *
 * A reader's question is turned by a model into a query over a fixed menu -
 * which dimension to count, optionally against another, optionally narrowed to
 * some named themes or methods - and code runs the query. The model never
 * sees a number and never writes one: the answer's numbers and its sentence
 * are computed here, like every other insight.
 */
import type { PaperId } from "@/types/database";
import { indexBy, intersection, intersectionSize, type CorpusPaper, type InsightCorpus } from "@/lib/insights/corpus";
import { MIN_PAPERS, halves, labelShifts, lift, liftWithOneFewer, percent, uniqueIds } from "@/lib/insights/stats";
import type { Insight, InsightFact } from "@/lib/insights/types";

export const ASK_DIMENSIONS = ["theme", "method", "category", "contribution", "study_type", "aim", "year"] as const;
export type AskDimension = (typeof ASK_DIMENSIONS)[number];

export interface AskQuery {
  answerable: boolean;
  /** Why not, in a sentence the page can show, when unanswerable. */
  reason?: string;
  /** The question restated as a title, at most about 12 words. */
  title: string;
  measure: "papers" | "change";
  rows: AskDimension;
  columns?: AskDimension | null;
  /** Keep only papers with any of these values of one dimension. */
  focus?: { dimension: AskDimension; values: string[] } | null;
  /** Values of `rows` the question is about ("mixed methods" in "is mixed methods more common…"). */
  about?: string[];
}

const DIMENSION_PLURAL: Record<AskDimension, string> = {
  theme: "themes",
  method: "methods",
  category: "research areas",
  contribution: "contributions",
  study_type: "kinds of study",
  aim: "aims",
  year: "years",
};

/** A paper has at most one of these, so its counts add up to the papers. */
const SINGLE_VALUED: ReadonlySet<AskDimension> = new Set(["category", "study_type", "year"]);

const DIMENSION_NOUN: Record<AskDimension, string> = {
  theme: "theme",
  method: "method",
  category: "research area",
  contribution: "contribution",
  study_type: "kind of study",
  aim: "aim",
  year: "year",
};

/**
 * Narrowed papers at least this many are drawn against all those selected.
 * With fewer, a share is one or two papers ("50% here" of 2), so only the
 * counts are drawn.
 */
export const COMPARE_MIN = 8;

/** "Papers on writing", "Papers using interviews", "Papers in Assessment". */
function focusPhrase(dimension: AskDimension, subject: string): string {
  if (dimension === "method") return `Papers using ${subject}`;
  if (dimension === "category") return `Papers in ${subject}`;
  if (dimension === "study_type") return `${subject} papers`;
  if (dimension === "year") return `Papers from ${subject}`;
  if (dimension === "aim") return `Papers that ${subject}`;
  if (dimension === "contribution") return `Papers contributing ${subject}`;
  return `Papers on ${subject}`;
}

export function valuesOf(paper: CorpusPaper, dimension: AskDimension): string[] {
  switch (dimension) {
    case "theme":
      return [...paper.themes];
    case "method":
      return [...paper.methods];
    case "category":
      return paper.category ? [paper.category] : [];
    case "contribution":
      return [...paper.contributions];
    case "study_type":
      return paper.typology ? [paper.typology] : [];
    case "aim":
      return [...paper.aims];
    case "year":
      return paper.year === null ? [] : [String(paper.year)];
  }
}

/** Every value each dimension takes in these papers, for the model to choose from. */
export function askVocabulary(corpus: InsightCorpus, limit = 40): Record<AskDimension, string[]> {
  const vocabulary = {} as Record<AskDimension, string[]>;
  for (const dimension of ASK_DIMENSIONS) {
    if (dimension === "year") {
      vocabulary.year = [];
      continue;
    }
    vocabulary[dimension] = [...indexBy(corpus.papers, (paper) => valuesOf(paper, dimension)).entries()]
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([value]) => value);
  }
  return vocabulary;
}

function fact(id: string, value: number, unit: InsightFact["unit"], text: string): InsightFact {
  return { id, value, unit, text };
}

/** Matches a model's value to one the papers have, forgiving case and spacing. */
function resolveValues(corpus: InsightCorpus, dimension: AskDimension, wanted: string[]): string[] {
  const known = new Map<string, string>();
  for (const paper of corpus.papers) for (const value of valuesOf(paper, dimension)) known.set(value.toLowerCase().replace(/\s+/g, " ").trim(), value);
  return [...new Set(wanted.map((value) => known.get(value.toLowerCase().replace(/\s+/g, " ").trim())).filter((value): value is string => Boolean(value)))];
}

/**
 * Every year from the first dated paper to the last, empty ones included, so
 * a gap reads as a gap rather than being squeezed out of the axis. The most
 * recent `max` years when the span is longer.
 */
function yearSpan(index: Map<string, Set<PaperId>>, max: number): Array<[string, Set<PaperId>]> {
  const years = [...index.keys()].map(Number).filter(Number.isFinite);
  if (years.length === 0) return [];
  const last = Math.max(...years);
  const first = Math.max(Math.min(...years), last - max + 1);
  const span: Array<[string, Set<PaperId>]> = [];
  for (let year = first; year <= last; year += 1) span.push([String(year), index.get(String(year)) ?? new Set()]);
  return span;
}

export type AskResult = { insight: Insight } | { unanswerable: string };

/**
 * What a planned view means, whatever shape the model gave it. Both were
 * planned for questions in the chart question bank (docs/38):
 *  - One subject on the columns' dimension is a narrowing, not a grid of one
 *    column: "which years had papers on Global Englishes" drew years by theme.
 *  - A change among papers that all have the value asked about is that
 *    value's own change: "is interest in dynamic assessment declining" drew
 *    dynamic assessment at 100% of the dynamic assessment papers, before and after.
 */
export function normalizeQuery(query: AskQuery): AskQuery {
  let next = query;
  if (next.focus && next.columns && next.columns === next.focus.dimension && next.focus.values.length === 1) next = { ...next, columns: null };
  if (next.measure === "change" && next.focus && next.focus.dimension === next.rows) {
    next = { ...next, about: next.about?.length ? next.about : next.focus.values.slice(0, 3), focus: null };
  }
  return next;
}

function listOf(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "papers on writing", "papers using interviews": the narrowed papers in a sentence. */
function among(dimension: AskDimension, subject: string): string {
  return focusPhrase(dimension, subject).replace(/^./, (c) => c.toLowerCase());
}

/** Runs a checked query. Every number in the answer is computed here. */
export function runAskQuery(corpus: InsightCorpus, asked: AskQuery): AskResult {
  const query = normalizeQuery(asked);
  if (!query.answerable) return { unanswerable: query.reason?.slice(0, 240) || "These papers cannot answer that question." };
  if (!ASK_DIMENSIONS.includes(query.rows)) return { unanswerable: "That question needs data these papers do not have." };
  const columns = query.columns && ASK_DIMENSIONS.includes(query.columns) && query.columns !== query.rows ? query.columns : null;

  let papers = corpus.papers;
  let focusText = "";
  /** The subject in a title, where three long names would not fit. */
  let focusShort = "";
  // A subject named on the columns' dimension ("methods in writing and reading
  // papers", drawn as method by theme) picks those columns: narrowing the
  // papers to it instead would draw every other theme those papers also have.
  let colPick: string[] | null = null;
  let narrowedBy: { dimension: AskDimension; values: string[] } | null = null;
  if (query.focus && ASK_DIMENSIONS.includes(query.focus.dimension)) {
    const values = resolveValues(corpus, query.focus.dimension, query.focus.values ?? []);
    if (values.length === 0) return { unanswerable: `None of the selected papers has the ${DIMENSION_NOUN[query.focus.dimension]} you asked about.` };
    if (query.focus.dimension === columns) colPick = values;
    else {
      papers = papers.filter((paper) => valuesOf(paper, query.focus!.dimension).some((value) => values.includes(value)));
      focusText = values.length > 2 ? `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}` : values.join(" or ");
      focusShort = values.length > 2 ? `${values[0]} and ${values.length - 1} related ${DIMENSION_PLURAL[query.focus.dimension]}` : focusText;
      narrowedBy = { dimension: query.focus.dimension, values };
    }
  }
  // Two or more values of the rows named to compare ("writing compared with
  // reading") are the rows drawn; one is highlighted among all of them.
  const compared = resolveValues(corpus, query.rows, query.about ?? []);
  const rowPick = compared.length >= 2 ? compared : null;
  const picked = (entries: Array<[string, Set<PaperId>]>, pick: string[] | null) =>
    pick ? entries.filter(([label]) => pick.includes(label)) : entries;
  // Papers without a readable year are left out of anything drawn by year.
  const usesYear = query.rows === "year" || columns === "year" || query.measure === "change";
  const undated = usesYear ? papers.filter((paper) => paper.year === null).length : 0;
  const undatedNote = undated > 0 ? ` ${undated === 1 ? "One paper has" : `${undated} papers have`} no readable year and ${undated === 1 ? "is" : "are"} left out of the years.` : "";
  const N = papers.length;
  const scope =
    N === 1
      ? `the one ${focusText && narrowedBy ? among(narrowedBy.dimension, focusText).replace(/papers/, "paper") : "paper selected"}`
      : focusText && narrowedBy
        ? `the ${N} ${among(narrowedBy.dimension, focusText)}`
        : `the ${N} papers selected`;
  const Scope = scope.replace(/^./, (c) => c.toUpperCase());
  // A count of one or two papers is a fact, drawn as squares; a grid or a
  // change over time is a pattern, and needs at least MIN_PAPERS behind it.
  if (N === 0) return { unanswerable: focusText ? `None of the selected papers has ${focusText}.` : "No analysed papers are selected." };
  if (N < MIN_PAPERS && (query.measure === "change" || columns)) {
    return { unanswerable: `Only ${N === 1 ? "one of the selected papers has" : `${N} of the selected papers have`} ${focusText || "an analysis"}; a pattern across papers needs at least ${MIN_PAPERS}.` };
  }
  // The title is built here from the query, so no model wording reaches the page.
  const noun = (dimension: AskDimension) => DIMENSION_PLURAL[dimension];
  const within = focusShort && narrowedBy ? ` among ${among(narrowedBy.dimension, focusShort)}` : "";
  const alongside = narrowedBy?.dimension === query.rows && !columns && query.measure !== "change" && !(query.about ?? []).length;
  const title = (
    query.measure === "change" && query.rows !== "year"
      ? `How the ${noun(query.rows)} changed${within}`
      : columns
        ? `${noun(query.rows).replace(/^./, (c) => c.toUpperCase())} by ${DIMENSION_NOUN[columns]}${within}`
        : query.rows === "year"
          ? `Papers per year${within}`
          : alongside
            ? `Other ${noun(query.rows)} in ${among(narrowedBy!.dimension, focusShort)}`
            : `Papers by ${DIMENSION_NOUN[query.rows]}${within}`
  ).slice(0, 140);
  const base = {
    id: "ask",
    family: "composition" as const,
    question: title,
    view: { measure: "asked", rows: query.rows, cols: columns ?? undefined },
    score: 1,
  };

  // Change over time: early against late shares of each value.
  if (query.measure === "change" && query.rows !== "year") {
    const split = halves(papers);
    if (!split || split.early.length < MIN_PAPERS || split.late.length < MIN_PAPERS) {
      return { unanswerable: `The ${focusText && narrowedBy ? among(narrowedBy.dimension, focusText) : "selected papers"} span too few dated years to compare early and late.` };
    }
    const shifts = labelShifts(papers, (paper) => valuesOf(paper, query.rows));
    const tags = new Map([
      ...shifts.emerging.map((shift) => [shift.topic, "gaining"] as const),
      ...shifts.declining.map((shift) => [shift.topic, "losing"] as const),
    ]);
    const early = new Set(split.early.map((paper) => paper.id));
    const late = new Set(split.late.map((paper) => paper.id));
    const index = picked([...indexBy([...split.early, ...split.late], (paper) => valuesOf(paper, query.rows)).entries()], rowPick)
      .filter(([, ids]) => ids.size >= (rowPick ? 1 : 2))
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, 10);
    if (index.length === 0) return { unanswerable: `No ${DIMENSION_NOUN[query.rows]} appears in 2 or more of ${scope}.` };
    const rows = index.map(([label, ids]) => {
      const leftCount = intersectionSize(ids, early);
      const rightCount = intersectionSize(ids, late);
      return {
        label,
        left: percent(leftCount, split.early.length),
        right: percent(rightCount, split.late.length),
        leftCount,
        rightCount,
        leftOf: split.early.length,
        rightOf: split.late.length,
        tag: tags.get(label),
        paperIds: [...ids],
      };
    });
    const asked = resolveValues(corpus, query.rows, query.about ?? [])[0];
    const lead = rows.find((row) => row.label === asked) ?? [...rows].sort((a, b) => Math.abs(b.right - b.left) - Math.abs(a.right - a.left))[0];
    // The value asked about may be too rare to draw: say so, rather than
    // answering about a different one as if it had been asked.
    const askedCount = asked ? papers.filter((paper) => valuesOf(paper, query.rows).includes(asked)).length : 0;
    const askedMissing = asked && lead.label !== asked
      ? `${asked} is in ${askedCount === 0 ? "none" : askedCount === 1 ? "only one" : `only ${askedCount}`} of ${scope}, too few to show a change. `
      : "";
    const moved = rows.filter((row) => row.tag);
    const facts = [
      fact("early_papers", split.early.length, "papers", `papers from ${split.earlyLabel}`),
      fact("late_papers", split.late.length, "papers", `papers from ${split.lateLabel}`),
      fact("lead_early_share", lead.left, "percent", `share of ${split.earlyLabel} papers with ${lead.label}`),
      fact("lead_late_share", lead.right, "percent", `share of ${split.lateLabel} papers with ${lead.label}`),
      fact("moved", moved.length, "count", `${DIMENSION_PLURAL[query.rows]} that pass the shift rules`),
    ];
    const verdict = lead.tag
      ? `a shift that holds with any one paper removed`
      : `too small a change to count as a shift with this few papers`;
    return {
      insight: {
        ...base,
        family: "change",
        chart: { kind: "compare", leftLabel: split.earlyLabel, rightLabel: split.lateLabel, unit: "percent", sequence: "time", rows },
        facts,
        takeaway: `${askedMissing}Among ${scope}, ${lead.label === asked ? "" : "the biggest change is "}${lead.label}${lead.label === asked ? " went" : ""}: ${lead.left}% of papers in ${split.earlyLabel}, ${lead.right}% in ${split.lateLabel} - ${verdict}.${moved.length > 1 ? ` ${moved.length} ${DIMENSION_PLURAL[query.rows]} pass the shift rules.` : ""}`,
        paperIds: uniqueIds(rows.flatMap((row) => row.paperIds)),
        population: { papers: N, label: scope },
        basis: `The ${N} papers split where they best halve (${split.early.length} and ${split.late.length}). "Gaining" and "losing" follow the Trend tab's rules: at least ${MIN_PAPERS} papers, and a change that survives removing any one.${undatedNote}`,
      },
    };
  }

  // A cross of two dimensions.
  if (columns) {
    const rowIndex = query.rows === "year"
      ? yearSpan(indexBy(papers, (paper) => valuesOf(paper, "year")), 20)
      : picked([...indexBy(papers, (paper) => valuesOf(paper, query.rows)).entries()], rowPick)
          .filter(([, ids]) => ids.size >= (rowPick ? 1 : 2))
          .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
          .slice(0, 8);
    const colIndex = columns === "year"
      ? yearSpan(indexBy(papers, (paper) => valuesOf(paper, "year")), 12)
      : picked([...indexBy(papers, (paper) => valuesOf(paper, columns)).entries()], colPick)
          .filter(([, ids]) => ids.size >= (colPick ? 1 : 2))
          .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
          .slice(0, 6);
    if (rowIndex.length < 1 || colIndex.length < 1) return { unanswerable: `Too few of ${scope} share a ${DIMENSION_NOUN[query.rows]} and a ${DIMENSION_NOUN[columns]} to compare.` };
    const values = rowIndex.map(([, rowIds]) => colIndex.map(([, colIds]) => intersectionSize(rowIds, colIds)));
    const paperIds = rowIndex.map(([, rowIds]) => colIndex.map(([, colIds]) => intersection(rowIds, colIds)));
    const marks: Array<[number, number, "strong" | "absent"]> = [];
    let strongest: { r: number; c: number; count: number; share: number; overall: number } | null = null;
    rowIndex.forEach(([, rowIds], r) =>
      colIndex.forEach(([, colIds], c) => {
        const count = values[r][c];
        const l = lift(count, rowIds.size, colIds.size, N);
        if (count >= MIN_PAPERS && l >= 1.5 && liftWithOneFewer(count, rowIds.size, colIds.size, N) >= 1.2) {
          marks.push([r, c, "strong"]);
          const candidate = { r, c, count, share: percent(count, rowIds.size), overall: percent(colIds.size, N) };
          if (!strongest || count * l > strongest.count * (strongest.share / Math.max(strongest.overall, 1))) strongest = candidate;
        }
      })
    );
    const facts: InsightFact[] = [fact("scope", N, "papers", scope)];
    let takeaway: string;
    const s = strongest as { r: number; c: number; count: number; share: number; overall: number } | null;
    if (s) {
      const [rowName, rowIds] = rowIndex[s.r];
      const [colName] = colIndex[s.c];
      facts.push(
        fact("strong_count", s.count, "papers", `papers with both ${rowName} and ${colName}`),
        fact("strong_row", rowIds.size, "papers", `papers with ${rowName}`),
        fact("strong_share", s.share, "percent", `share of ${rowName} papers with ${colName}`),
        fact("strong_overall", s.overall, "percent", `share of ${scope} with ${colName}`)
      );
      takeaway = `Among ${scope}, ${s.share}% of those with ${rowName} also have ${colName} (${s.count} of ${rowIds.size}), against ${s.overall}% overall.`;
    } else {
      const total = values.flat().reduce((sum, value) => sum + value, 0);
      facts.push(fact("cells", total, "count", "paper links drawn in the grid"));
      takeaway = `No ${DIMENSION_NOUN[query.rows]} and ${DIMENSION_NOUN[columns]} go together in at least ${MIN_PAPERS} of ${scope} more often than chance; the grid shows how they are spread.`;
    }
    return {
      insight: {
        ...base,
        family: "relationship",
        chart: {
          kind: "matrix",
          rowLabel: DIMENSION_NOUN[query.rows].replace(/^./, (c) => c.toUpperCase()),
          colLabel: DIMENSION_NOUN[columns].replace(/^./, (c) => c.toUpperCase()),
          rows: rowIndex.map(([name]) => name),
          cols: colIndex.map(([name]) => name),
          values,
          marks,
          paperIds,
          rowTotals: rowIndex.map(([, rowIds]) => rowIds.size),
        },
        facts,
        takeaway,
        paperIds: uniqueIds(paperIds.flat(2)),
        population: { papers: N, label: scope },
        basis: `Papers per pair of values among ${scope}. Outlined: at least ${MIN_PAPERS} papers and 1.5 times chance, even with one fewer.${undatedNote}`,
      },
    };
  }

  // One dimension: how the papers divide - against all selected papers when narrowed.
  const overall = indexBy(corpus.papers, (paper) => valuesOf(paper, query.rows));
  const total = corpus.papers.length;
  // Papers narrowed to a theme all have it (or one of those named), so "which
  // themes appear alongside assessment" draws the others, not the subject.
  const subject = narrowedBy && narrowedBy.dimension === query.rows && !rowPick && !(query.about ?? []).length ? narrowedBy.values : [];
  const index = query.rows === "year"
    ? yearSpan(indexBy(papers, (paper) => valuesOf(paper, "year")), 40)
    : picked([...indexBy(papers, (paper) => valuesOf(paper, query.rows)).entries()], rowPick)
        .filter(([label]) => !subject.includes(label))
        .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
        .slice(0, 12);
  const about = resolveValues(corpus, query.rows, query.about ?? [])[0] ?? null;
  // The narrowed papers are drawn against all those selected when there are
  // enough of them for a share to mean something, or when the question is
  // that comparison ("is mixed methods more common in writing papers?"). The
  // old chart drew the count and printed both shares in grey under it ("25%
  // here · 17% of all papers", 2026-10-20).
  const comparing = Boolean(focusText) && query.rows !== "year" && N < total && N >= MIN_PAPERS && (N >= COMPARE_MIN || Boolean(about));
  const facts: InsightFact[] = [fact("scope", N, "papers", scope), fact("total", total, "papers", "papers selected")];
  const shareHere = (value: string) => percent(index.find(([label]) => label === value)?.[1].size ?? 0, N);
  const shareOverall = (value: string) => percent(overall.get(value)?.size ?? 0, total);
  const population = { papers: N, label: scope };
  const allIds = uniqueIds(index.flatMap(([, ids]) => [...ids]));
  const counted = SINGLE_VALUED.has(query.rows) ? "" : "; a paper can count under more than one";
  const leftOut = subject.length ? `; the ${DIMENSION_PLURAL[query.rows]} asked about are left out, since every paper here has one` : "";
  let takeaway: string;
  if (rowPick) {
    const parts = rowPick.map((value, i) => {
      const count = index.find(([label]) => label === value)?.[1].size ?? 0;
      facts.push(fact(`compared_${i}`, count, "papers", `${scope} with ${value}`), fact(`compared_share_${i}`, shareHere(value), "percent", `share of ${scope} with ${value}`));
      return `${value}${i === 0 ? " appears" : ""} in ${count} (${shareHere(value)}%)`;
    });
    takeaway = `Among ${scope}, ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
  } else if (about) {
    const count = index.find(([label]) => label === about)?.[1].size ?? 0;
    facts.push(
      fact("about_count", count, "papers", `${scope} with ${about}`),
      fact("about_share", shareHere(about), "percent", `share of ${scope} with ${about}`),
      fact("about_overall", shareOverall(about), "percent", `share of all selected papers with ${about}`)
    );
    takeaway = N === 1
      ? `${Scope} ${count === 0 ? "does not have" : "has"} ${about}.`
      : comparing
      ? count === 0
        ? `None of ${scope} has ${about}, against ${shareOverall(about)}% of all ${total} papers selected.`
        : `${about} appears in ${count} of ${scope} (${shareHere(about)}%), against ${shareOverall(about)}% of all ${total} papers selected.`
      : count === 0
        ? `None of ${scope} has ${about}.`
        : `${about} appears in ${count} of ${scope} (${shareHere(about)}%).`;
  } else {
    if (index.length === 0) {
      return {
        unanswerable: subject.length
          ? `The ${N} ${among(narrowedBy!.dimension, focusText)} have no other ${DIMENSION_NOUN[query.rows]} recorded.`
          : `None of ${scope} has a ${DIMENSION_NOUN[query.rows]} recorded.`,
      };
    }
    const top = [...index].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
    facts.push(
      fact("top", top[1].size, "papers", `papers with ${top[0]}`),
      fact("top_share", shareHere(top[0]), "percent", `share of ${scope} with ${top[0]}`),
      fact("top_overall", shareOverall(top[0]), "percent", `share of all selected papers with ${top[0]}`)
    );
    // Values tied at the top are named together rather than one picked by spelling.
    const tied = index.filter(([, ids]) => ids.size === top[1].size).map(([label]) => label);
    const dated = index.filter(([, ids]) => ids.size > 0);
    takeaway = query.rows === "year"
      ? `${scope.replace(/^./, (c) => c.toUpperCase())} run from ${dated[0][0]} to ${dated[dated.length - 1][0]}; ${tied.length > 1 ? `${tied.slice(0, -1).join(", ")} and ${tied[tied.length - 1]} have the most, ${top[1].size} each` : `${top[0]} has the most, ${top[1].size}`}${focusText ? "" : ` (${shareHere(top[0])}%)`}.`
      : tied.length > 1
        ? `Among ${scope}, the most common ${subject.length ? "other " : ""}${DIMENSION_PLURAL[query.rows]} are ${tied.slice(0, -1).join(", ")} and ${tied[tied.length - 1]}, in ${top[1].size} each (${shareHere(top[0])}%).`
        : `Among ${scope}, the most common ${subject.length ? "other " : ""}${DIMENSION_NOUN[query.rows]} is ${top[0]}, in ${top[1].size} (${shareHere(top[0])}%)${comparing ? `, against ${shareOverall(top[0])}% of all ${total} papers selected` : ""}.`;
  }

  // Every value the same - seven themes in one paper each - is no chart: the
  // bars would all be one length and say nothing (docs/38). A table says which
  // papers have which, and the sentence says none stands out.
  const sizes = index.map(([, ids]) => ids.size);
  if (query.rows !== "year" && index.length >= 2 && new Set(sizes).size === 1 && !rowPick && !about) {
    const titleOf = new Map(papers.map((paper) => [paper.id, paper.title]));
    const each = sizes[0];
    facts.push(fact("each", each, "papers", `papers with each ${DIMENSION_NOUN[query.rows]}`), fact("values", index.length, "count", `${DIMENSION_PLURAL[query.rows]} found`));
    return {
      insight: {
        ...base,
        chart: {
          kind: "table",
          columns: [
            { key: "value", label: DIMENSION_NOUN[query.rows].replace(/^./, (c) => c.toUpperCase()) },
            { key: "papers", label: each === 1 ? "Paper" : "Papers" },
          ],
          rows: index.map(([label, ids]) => ({ key: label, cells: { value: label, papers: [...ids].map((id) => titleOf.get(id) ?? "Untitled paper") }, paperIds: [...ids] })),
        },
        facts,
        takeaway:
          N === 1
            ? `${Scope} records ${index.length} ${subject.length ? "other " : ""}${DIMENSION_PLURAL[query.rows]}: ${listOf(index.map(([label]) => label))}.`
            : `Each of the ${index.length} ${subject.length ? "other " : ""}${DIMENSION_PLURAL[query.rows]} appears in ${each === 1 ? "just one" : each} of ${scope}, so none stands out.`,
        paperIds: allIds,
        population,
        ...(about ? { mentions: [about] } : {}),
        basis: `The ${DIMENSION_PLURAL[query.rows]} recorded for ${scope}${counted}${leftOut}.${undatedNote}`,
      },
    };
  }

  // One value only is a number, not a one-bar chart.
  if (query.rows !== "year" && index.length === 1 && !rowPick) {
    const [label, ids] = index[0];
    return {
      insight: {
        ...base,
        chart: {
          kind: "stat",
          value: `${ids.size} of ${N}`,
          label: `${N === 1 ? "paper" : "papers"} with ${label}`,
          detail: `The only ${subject.length ? "other " : ""}${DIMENSION_NOUN[query.rows]} recorded for ${scope}.`,
        },
        facts,
        takeaway: N === 1 && !about ? `${Scope} records one ${DIMENSION_NOUN[query.rows]}: ${label}.` : takeaway,
        paperIds: allIds,
        population,
        ...(about ? { mentions: [about] } : {}),
        basis: `The ${DIMENSION_PLURAL[query.rows]} recorded for ${scope}${leftOut}.${undatedNote}`,
      },
    };
  }

  if (comparing) {
    return {
      insight: {
        ...base,
        chart: {
          kind: "compare",
          leftLabel: focusPhrase(narrowedBy?.dimension ?? "theme", focusShort),
          rightLabel: "All papers selected",
          unit: "percent",
          sequence: "contrast",
          // The value asked about first, even when none of the narrowed papers has it.
          rows: [
            ...(about && !index.some(([label]) => label === about) ? [[about, new Set<PaperId>()] as [string, Set<PaperId>]] : []),
            ...index,
          ]
            .sort(([a], [b]) => Number(b === about) - Number(a === about))
            .map(([label, ids]) => {
              const all = overall.get(label)?.size ?? 0;
              return { label, left: percent(ids.size, N), right: percent(all, total), leftCount: ids.size, rightCount: all, leftOf: N, rightOf: total, paperIds: [...ids], ...(label === about ? { asked: true } : {}) };
            }),
        },
        facts,
        takeaway,
        paperIds: allIds,
        population,
        ...(about ? { mentions: [about] } : {}),
        basis: `The share of ${scope} with each ${DIMENSION_NOUN[query.rows]}, beside its share of all ${total} papers selected${counted}${leftOut}.${undatedNote}`,
      },
    };
  }

  const emphasis = rowPick ?? (about ? [about] : []);
  return {
    insight: {
      ...base,
      chart: {
        kind: "bars",
        valueLabel: "Papers",
        unit: "papers",
        rows: index.map(([label, ids]) => ({ label, value: ids.size, paperIds: [...ids] as PaperId[] })),
        ...(query.rows === "year" ? { layout: "columns" as const } : {}),
        // Values compared by name are all drawn in the accent: the reader asked for each.
        ...(emphasis.length ? { emphasis } : {}),
      },
      facts,
      takeaway,
      paperIds: allIds,
      population,
      ...(about ? { mentions: [about] } : {}),
      basis: `Papers per ${DIMENSION_NOUN[query.rows]} among ${scope}${query.rows === "year" ? "; years with no papers are shown as empty" : counted}${leftOut}.${undatedNote}`,
    },
  };
}

/* ----------------------------------------------------------- the model's part */

export function askTool() {
  return {
    type: "function",
    function: {
      name: "build_view",
      description: "Turn the reader's question into one view of the selected papers.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          answerable: { type: "boolean", description: "False when the papers' data cannot answer it (for example it asks about authors, citations, countries or results)." },
          reason: { type: "string", description: "When unanswerable: why, in one sentence." },
          title: { type: "string", description: "The question restated as a short title." },
          measure: { type: "string", enum: ["papers", "change"], description: "papers: how the papers divide; change: how shares moved between the earlier and later papers." },
          rows: { type: "string", enum: [...ASK_DIMENSIONS] },
          columns: { type: "string", enum: [...ASK_DIMENSIONS, "none"], description: "A second dimension to cross with rows, or none." },
          focus_dimension: { type: "string", enum: [...ASK_DIMENSIONS, "none"], description: "The dimension of the papers the question narrows to, or none." },
          focus_values: { type: "array", items: { type: "string" }, maxItems: 8, description: "Values of focus_dimension, exactly as listed; every listed value that matches the subject named." },
          about_values: { type: "array", items: { type: "string" }, maxItems: 3, description: "Values of rows the question asks about, exactly as listed: one it asks about, or two or three it compares; or empty." },
        },
        required: ["answerable", "title", "measure", "rows", "columns", "focus_dimension", "focus_values", "about_values"],
      },
    },
  };
}

/** How to fill build_view: its dimensions, measures and worked examples. Chart mode's planner shows it too. */
export function askGuide(): string[] {
  return [
    "Dimensions: theme (what a paper studies), method (how it was done), category, contribution (what it produces), study_type, aim (its objective verb), year.",
    "Use measure 'change' for questions about growth, decline or trends; 'papers' otherwise. Use columns to cross two dimensions. When the question names a subject ('writing papers', 'assessment research'), narrow to it: focus_dimension is where the subject is listed, and focus_values is every listed value that matches it. When it asks about one value of rows ('is mixed methods more common…'), put that value in about_values.",
    "Examples:",
    "- 'Which methods are used for which themes?' -> rows theme, columns method, focus_dimension none.",
    "- 'Is mixed-methods research more common in writing papers?' -> rows method, focus_dimension theme, focus_values [every theme naming writing], about_values [the mixed-methods method].",
    "- 'What do the papers on assessment set out to produce?' -> rows contribution, focus_dimension theme, focus_values [every theme naming assessment or testing].",
    "- 'How has the use of interviews changed?' -> measure change, rows method, about_values [the interview method].",
    "- 'How many papers were published each year?' -> rows year.",
    "- 'How have the themes changed over time?' -> measure change, rows theme.",
    "- 'How many papers study writing compared with reading?' -> rows theme, about_values [the writing theme, the reading theme].",
    "- 'Compare the methods used in writing papers and reading papers' -> rows method, columns theme, focus_dimension theme, focus_values [every theme naming writing or reading].",
    "- 'Which themes appear alongside assessment?' -> rows theme, focus_dimension theme, focus_values [every theme naming assessment].",
    "- 'How do the categories change over the years?' -> rows year, columns category.",
    "The question may be in any language, or ask for a chart without saying which; choose the view that best answers it.",
  ];
}

export function askMessages(question: string, vocabulary: Record<AskDimension, string[]>, selection: string) {
  return [
    {
      role: "system" as const,
      content:
        "You translate a researcher's question about a collection of academic papers into one view of the data, by calling build_view. " +
        "You do not answer the question or write any number; code computes the view.",
    },
    {
      role: "user" as const,
      content: [
        ...askGuide(),
        "If the question needs anything else - authors, citations, countries, findings, sample sizes, quality - set answerable to false and say why.",
        `Selection: ${selection}.`,
        `Values present: ${JSON.stringify(vocabulary)}`,
        `Question: ${question}`,
      ].join("\n"),
    },
  ];
}

export function parseAskQuery(raw: unknown): AskQuery | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const dimension = (entry: unknown): AskDimension | null =>
    typeof entry === "string" && (ASK_DIMENSIONS as readonly string[]).includes(entry) ? (entry as AskDimension) : null;
  const rows = dimension(value.rows);
  if (value.answerable !== false && !rows) return null;
  const focusRaw = value.focus && typeof value.focus === "object"
    ? (value.focus as Record<string, unknown>)
    : { dimension: value.focus_dimension, values: value.focus_values };
  const focusDimension = dimension(focusRaw.dimension);
  const strings = (entry: unknown) => (Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : []);
  return {
    answerable: value.answerable !== false,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    title: typeof value.title === "string" ? value.title : "",
    measure: value.measure === "change" ? "change" : "papers",
    rows: rows ?? "theme",
    columns: dimension(value.columns),
    focus: focusDimension && strings(focusRaw.values).length ? { dimension: focusDimension, values: strings(focusRaw.values).slice(0, 8) } : null,
    about: strings(value.about_values).slice(0, 3),
  };
}
