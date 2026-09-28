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
}

const DIMENSION_NOUN: Record<AskDimension, string> = {
  theme: "theme",
  method: "method",
  category: "category",
  contribution: "contribution",
  study_type: "kind of study",
  aim: "aim",
  year: "year",
};

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

export type AskResult = { insight: Insight } | { unanswerable: string };

/** Runs a checked query. Every number in the answer is computed here. */
export function runAskQuery(corpus: InsightCorpus, query: AskQuery): AskResult {
  if (!query.answerable) return { unanswerable: query.reason?.slice(0, 240) || "These papers cannot answer that question." };
  if (!ASK_DIMENSIONS.includes(query.rows)) return { unanswerable: "That question needs data these papers do not have." };
  const columns = query.columns && ASK_DIMENSIONS.includes(query.columns) && query.columns !== query.rows ? query.columns : null;

  let papers = corpus.papers;
  let focusText = "";
  if (query.focus && ASK_DIMENSIONS.includes(query.focus.dimension)) {
    const values = resolveValues(corpus, query.focus.dimension, query.focus.values ?? []);
    if (values.length === 0) return { unanswerable: `None of the selected papers has the ${DIMENSION_NOUN[query.focus.dimension]} you asked about.` };
    papers = papers.filter((paper) => valuesOf(paper, query.focus!.dimension).some((value) => values.includes(value)));
    focusText = values.join(" or ");
  }
  const N = papers.length;
  const scope = focusText ? `the ${N} papers on ${focusText}` : `the ${N} papers selected`;
  if (N < MIN_PAPERS) {
    return { unanswerable: `Only ${N === 1 ? "one paper" : `${N} papers`} ${focusText ? `are on ${focusText}` : "are selected"}; an answer needs at least ${MIN_PAPERS}.` };
  }
  // The title is built here from the query, so no model wording reaches the page.
  const noun = (dimension: AskDimension) => (dimension === "study_type" ? "kinds of study" : `${DIMENSION_NOUN[dimension]}s`);
  const within = focusText ? ` among papers on ${focusText}` : "";
  const title = (
    query.measure === "change" && query.rows !== "year"
      ? `How the ${noun(query.rows)} changed${within}`
      : columns
        ? `${noun(query.rows).replace(/^./, (c) => c.toUpperCase())} by ${DIMENSION_NOUN[columns]}${within}`
        : `${noun(query.rows).replace(/^./, (c) => c.toUpperCase())}${within}`
  ).slice(0, 120);
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
      return { unanswerable: `The ${focusText ? `papers on ${focusText}` : "selected papers"} span too few dated years to compare early and late.` };
    }
    const shifts = labelShifts(papers, (paper) => valuesOf(paper, query.rows));
    const tags = new Map([
      ...shifts.emerging.map((shift) => [shift.topic, "gaining"] as const),
      ...shifts.declining.map((shift) => [shift.topic, "losing"] as const),
    ]);
    const early = new Set(split.early.map((paper) => paper.id));
    const late = new Set(split.late.map((paper) => paper.id));
    const index = [...indexBy([...split.early, ...split.late], (paper) => valuesOf(paper, query.rows)).entries()]
      .filter(([, ids]) => ids.size >= 2)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, 10);
    if (index.length === 0) return { unanswerable: `No ${DIMENSION_NOUN[query.rows]} appears in 2 or more of ${scope}.` };
    const rows = index.map(([label, ids]) => ({
      label,
      left: percent(intersectionSize(ids, early), split.early.length),
      right: percent(intersectionSize(ids, late), split.late.length),
      tag: tags.get(label),
      paperIds: [...ids],
    }));
    const lead = [...rows].sort((a, b) => Math.abs(b.right - b.left) - Math.abs(a.right - a.left))[0];
    const moved = rows.filter((row) => row.tag);
    const facts = [
      fact("early_papers", split.early.length, "papers", `papers from ${split.earlyLabel}`),
      fact("late_papers", split.late.length, "papers", `papers from ${split.lateLabel}`),
      fact("lead_early_share", lead.left, "percent", `share of ${split.earlyLabel} papers with ${lead.label}`),
      fact("lead_late_share", lead.right, "percent", `share of ${split.lateLabel} papers with ${lead.label}`),
    ];
    const verdict = lead.tag
      ? `a shift that holds with any one paper removed`
      : `too small a change to count as a shift with this few papers`;
    return {
      insight: {
        ...base,
        family: "change",
        chart: { kind: "compare", leftLabel: split.earlyLabel, rightLabel: split.lateLabel, unit: "percent", rows },
        facts,
        takeaway: `Among ${scope}, the biggest change is ${lead.label}: ${lead.left}% of papers in ${split.earlyLabel}, ${lead.right}% in ${split.lateLabel} - ${verdict}.${moved.length > 1 ? ` ${moved.length} ${DIMENSION_NOUN[query.rows]}s pass the shift rules.` : ""}`,
        paperIds: uniqueIds(rows.flatMap((row) => row.paperIds)),
        basis: `The ${N} papers split where they best halve (${split.early.length} and ${split.late.length}). "Gaining" and "losing" follow the Trend tab's rules: at least ${MIN_PAPERS} papers, and a change that survives removing any one.`,
      },
    };
  }

  // A cross of two dimensions.
  if (columns) {
    const rowIndex = [...indexBy(papers, (paper) => valuesOf(paper, query.rows)).entries()]
      .filter(([, ids]) => ids.size >= 2)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, query.rows === "year" ? 20 : 8);
    const colIndex = [...indexBy(papers, (paper) => valuesOf(paper, columns)).entries()]
      .filter(([, ids]) => ids.size >= 2)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, columns === "year" ? 12 : 6);
    if (query.rows === "year") rowIndex.sort((a, b) => a[0].localeCompare(b[0]));
    if (columns === "year") colIndex.sort((a, b) => a[0].localeCompare(b[0]));
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
        },
        facts,
        takeaway,
        paperIds: uniqueIds(paperIds.flat(2)),
        basis: `Papers per pair of values among ${scope}. Outlined: at least ${MIN_PAPERS} papers and 1.5 times chance, even with one fewer.`,
      },
    };
  }

  // One dimension: how the papers divide.
  const index = [...indexBy(papers, (paper) => valuesOf(paper, query.rows)).entries()]
    .sort((a, b) => (query.rows === "year" ? a[0].localeCompare(b[0]) : b[1].size - a[1].size || a[0].localeCompare(b[0])))
    .slice(0, query.rows === "year" ? 40 : 12);
  if (index.length === 0) return { unanswerable: `None of ${scope} has a ${DIMENSION_NOUN[query.rows]} recorded.` };
  const top = [...index].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
  return {
    insight: {
      ...base,
      chart: {
        kind: "bars",
        valueLabel: "Papers",
        unit: "papers",
        rows: index.map(([label, ids]) => ({ label, value: ids.size, detail: `${percent(ids.size, N)}% of ${scope}`, paperIds: [...ids] as PaperId[] })),
      },
      facts: [
        fact("scope", N, "papers", scope),
        fact("top", top[1].size, "papers", `papers with ${top[0]}`),
        fact("top_share", percent(top[1].size, N), "percent", `share of ${scope} with ${top[0]}`),
        fact("values", index.length, "count", `different values of ${DIMENSION_NOUN[query.rows]}`),
      ],
      takeaway: `Among ${scope}, the most common ${DIMENSION_NOUN[query.rows]} is ${top[0]}, in ${top[1].size} (${percent(top[1].size, N)}%).`,
      paperIds: uniqueIds(index.flatMap(([, ids]) => [...ids])),
      basis: `Papers per ${DIMENSION_NOUN[query.rows]} among ${scope}; a paper can count under more than one.`,
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
          focus: {
            type: "object",
            description: "Only when the question names particular values; leave out otherwise.",
            properties: {
              dimension: { type: "string", enum: [...ASK_DIMENSIONS] },
              values: { type: "array", items: { type: "string" }, maxItems: 6, description: "Values exactly as listed in the prompt." },
            },
            required: ["dimension", "values"],
          },
        },
        required: ["answerable", "title", "measure", "rows"],
      },
    },
  };
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
        "Dimensions: theme (what a paper studies), method (how it was done), category, contribution (what it produces), study_type, aim (its objective verb), year.",
        "Use measure 'change' for questions about growth, decline or trends; 'papers' otherwise. Use columns to cross two dimensions ('which methods for which themes'). Use focus to narrow to named values the question mentions, choosing only from the values listed.",
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
  const focusRaw = value.focus && typeof value.focus === "object" ? (value.focus as Record<string, unknown>) : null;
  const focusDimension = focusRaw ? dimension(focusRaw.dimension) : null;
  return {
    answerable: value.answerable !== false,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    title: typeof value.title === "string" ? value.title : "",
    measure: value.measure === "change" ? "change" : "papers",
    rows: rows ?? "theme",
    columns: dimension(value.columns),
    focus:
      focusRaw && focusDimension && Array.isArray(focusRaw.values)
        ? { dimension: focusDimension, values: focusRaw.values.filter((entry): entry is string => typeof entry === "string").slice(0, 6) }
        : null,
  };
}
