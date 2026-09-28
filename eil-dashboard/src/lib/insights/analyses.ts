/*
 * Each function asks one question of the selected papers and returns an
 * insight only when the papers can answer it: at least MIN_PAPERS behind every
 * claim, and associations that survive taking one paper away. None of them
 * repeats a chart a fixed tab draws (see fixed-views.ts).
 */
import type { PaperId } from "@/types/database";
import { yearAxis } from "@/lib/dashboard-analytics";
import { indexBy, intersection, intersectionSize, type CorpusPaper, type InsightCorpus } from "@/lib/insights/corpus";
import {
  MIN_PAPERS,
  clamp01,
  expectedDistinct,
  halves,
  labelShifts,
  lift,
  liftWithOneFewer,
  percent,
  round1,
  uniqueIds,
} from "@/lib/insights/stats";
import type { CompareRow, Insight, InsightFact, LifecycleRow } from "@/lib/insights/types";

function fact(id: string, value: number, unit: InsightFact["unit"], text: string): InsightFact {
  return { id, value, unit, text };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function times(value: number): string {
  return `${round1(value)} times`;
}

/**
 * Words two theme names share, ignoring the ones most names use ("language",
 * "learning"). Two themes that share one - "Genre-Based Writing Instruction"
 * and "Academic Writing" - are usually a part and its whole, so their meeting
 * says little.
 */
const ABBREVIATIONS: Record<string, string> = {
  l1: "first language",
  l2: "second language",
  efl: "english foreign language",
  esl: "english second language",
  eil: "english international language",
  elt: "english language teaching",
  sla: "second language acquisition",
  clil: "content language integrated learning",
};

function sharesDistinctiveWord(a: string, b: string, allNames: string[]): boolean {
  const words = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .flatMap((word) => (ABBREVIATIONS[word] ?? word).split(" "))
        .filter((word) => word.length >= 4)
    );
  const frequency = new Map<string, number>();
  for (const name of allNames) for (const word of words(name)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  // Common: used by at least 3 names, or a fifth of them in a long list.
  const common = Math.max(3, Math.ceil(allNames.length * 0.2));
  const bWords = words(b);
  return [...words(a)].some((word) => bWords.has(word) && (frequency.get(word) ?? 0) < common);
}

function sizeOrder(index: Map<string, Set<PaperId>>, minimum = MIN_PAPERS): Array<[string, Set<PaperId>]> {
  return [...index.entries()]
    .filter(([, ids]) => ids.size >= minimum)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
}

/* ------------------------------------------------ themes studied together */

export function themePairs(corpus: InsightCorpus): Insight | null {
  const N = corpus.papers.length;
  if (N < 8) return null;
  const themes = sizeOrder(indexBy(corpus.papers, (paper) => paper.themes));
  const names = themes.map(([name]) => name);
  const pairs: Array<{ a: string; b: string; together: number; lift: number; aPapers: number; bPapers: number; paperIds: PaperId[]; related: boolean }> = [];
  for (let i = 0; i < themes.length; i += 1) {
    for (let j = i + 1; j < themes.length; j += 1) {
      const [nameI, idsI] = themes[i];
      const [nameJ, idsJ] = themes[j];
      const together = intersectionSize(idsI, idsJ);
      if (together < MIN_PAPERS) continue;
      const l = lift(together, idsI.size, idsJ.size, N);
      if (l < 1.5 || liftWithOneFewer(together, idsI.size, idsJ.size, N) < 1.2) continue;
      // The smaller theme first, so "x% of the papers on A also cover B" is the striking share.
      const [a, aIds, b, bIds] = idsI.size <= idsJ.size ? [nameI, idsI, nameJ, idsJ] : [nameJ, idsJ, nameI, idsI];
      const nested = together === aIds.size;
      const sameFamily = sharesDistinctiveWord(a, b, names);
      // A part and its whole: every paper on the narrower theme is on the
      // broader one, and the names say they are the same subject.
      if (nested && sameFamily) continue;
      pairs.push({ a, b, together, lift: l, aPapers: aIds.size, bPapers: bIds.size, paperIds: intersection(aIds, bIds), related: nested || sameFamily });
    }
  }
  if (pairs.length === 0) return null;
  const weight = (pair: (typeof pairs)[number]) => pair.together * Math.log2(pair.lift) * (pair.related ? 0.4 : 1);
  pairs.sort((x, y) => weight(y) - weight(x) || x.a.localeCompare(y.a));
  const shown = pairs.slice(0, 6).map(({ related: _related, ...pair }) => pair);
  const facts: InsightFact[] = [];
  shown.slice(0, 3).forEach((pair, index) => {
    const k = index + 1;
    facts.push(
      fact(`pair${k}_together`, pair.together, "papers", `papers on both ${pair.a} and ${pair.b}`),
      fact(`pair${k}_share`, percent(pair.together, pair.aPapers), "percent", `share of the papers on ${pair.a} that also cover ${pair.b}`),
      fact(`pair${k}_lift`, round1(pair.lift), "ratio", `how many times as often ${pair.a} and ${pair.b} meet as their sizes predict`),
      fact(`pair${k}_a`, pair.aPapers, "papers", `papers on ${pair.a}`),
      fact(`pair${k}_b`, pair.bPapers, "papers", `papers on ${pair.b}`)
    );
  });
  const top = shown[0];
  const nested = top.together === top.aPapers;
  const effect = clamp01(Math.log2(top.lift) / 2.5) * (pairs[0].related ? 0.5 : 1);
  const support = clamp01(top.together / 6);
  return {
    id: "theme_pairs",
    family: "relationship",
    question: "Which themes are studied together?",
    view: { measure: "co-occurrence lift", rows: "theme pair" },
    chart: { kind: "pairs", rows: shown },
    facts,
    takeaway: `${top.a} and ${top.b} meet in ${top.together} papers, ${times(top.lift)} as often as their sizes predict: ${percent(top.together, top.aPapers)}% of the ${top.aPapers} papers on ${top.a} also cover ${top.b}.`,
    score: Math.min(pairs[0].related ? 0.45 : 1, 0.3 + 0.4 * effect + 0.3 * support),
    paperIds: uniqueIds(shown.flatMap((pair) => pair.paperIds)),
    basis: `Pairs of themes that share at least ${MIN_PAPERS} papers and meet at least 1.5 times as often as chance, even with one fewer shared paper.`,
    caution: nested
      ? `Every paper on ${top.a} is also on ${top.b}, so ${top.a} may simply be a part of ${top.b} rather than a separate subject studied alongside it.`
      : undefined,
  };
}

/* ------------------------------------------------- methods for each theme */

export function methodsByTheme(corpus: InsightCorpus): Insight | null {
  const N = corpus.papers.length;
  if (N < 8) return null;
  const methodIndex = indexBy(corpus.papers, (paper) => paper.methods);
  const themeIndex = indexBy(corpus.papers, (paper) => paper.themes);
  const methods = sizeOrder(methodIndex).slice(0, 6);
  if (methods.length < 2) return null;
  // Themes that meet at least one of these methods, largest first.
  const themes = sizeOrder(themeIndex)
    .filter(([, ids]) => methods.some(([, methodIds]) => intersectionSize(ids, methodIds) > 0))
    .slice(0, 8);
  if (themes.length < 2) return null;

  const values = themes.map(([, themeIds]) => methods.map(([, methodIds]) => intersectionSize(themeIds, methodIds)));
  const paperIds = themes.map(([, themeIds]) => methods.map(([, methodIds]) => intersection(themeIds, methodIds)));
  const marks: Array<[number, number, "strong" | "absent"]> = [];
  let strongest: { t: number; m: number; count: number; lift: number } | null = null;
  let absent: { t: number; m: number; expected: number } | null = null;
  themes.forEach(([, themeIds], t) => {
    methods.forEach(([, methodIds], m) => {
      const count = values[t][m];
      const l = lift(count, themeIds.size, methodIds.size, N);
      if (count >= MIN_PAPERS && l >= 1.5 && liftWithOneFewer(count, themeIds.size, methodIds.size, N) >= 1.2) {
        marks.push([t, m, "strong"]);
        if (!strongest || count * l > strongest.count * strongest.lift) strongest = { t, m, count, lift: l };
      }
      const expected = (themeIds.size * methodIds.size) / N;
      if (count === 0 && expected >= 2.5) {
        marks.push([t, m, "absent"]);
        if (!absent || expected > absent.expected) absent = { t, m, expected };
      }
    });
  });

  const facts: InsightFact[] = [];
  let takeaway: string;
  const s = strongest as { t: number; m: number; count: number; lift: number } | null;
  const z = absent as { t: number; m: number; expected: number } | null;
  if (s) {
    const [theme, themeIds] = themes[s.t];
    const [method, methodIds] = methods[s.m];
    facts.push(
      fact("strong_count", s.count, "papers", `papers on ${theme} that use ${method}`),
      fact("strong_theme", themeIds.size, "papers", `papers on ${theme}`),
      fact("strong_share", percent(s.count, themeIds.size), "percent", `share of papers on ${theme} that use ${method}`),
      fact("strong_overall", percent(methodIds.size, N), "percent", `share of all selected papers that use ${method}`)
    );
    takeaway = `${method} is used in ${percent(s.count, themeIds.size)}% of the papers on ${theme} (${s.count} of ${themeIds.size}), against ${percent(methodIds.size, N)}% of all the papers selected.`;
  } else {
    const [method, methodIds] = methods[0];
    facts.push(fact("top_method", methodIds.size, "papers", `papers that use ${method}, the most used method`));
    takeaway = `${method} is the most used method, in ${methodIds.size} papers; the grid shows which themes it serves.`;
  }
  if (z) {
    const [theme, themeIds] = themes[z.t];
    const [method, methodIds] = methods[z.m];
    facts.push(
      fact("absent_theme", themeIds.size, "papers", `papers on ${theme}, none of which uses ${method}`),
      fact("absent_method", methodIds.size, "papers", `papers that use ${method} overall`)
    );
    takeaway += ` None of the ${themeIds.size} papers on ${theme} uses ${method}, although ${methodIds.size} papers use it.`;
  }
  const marksScore = clamp01((s ? 0.5 : 0) + (z ? 0.3 : 0) + marks.length * 0.05);
  return {
    id: "methods_by_theme",
    family: "relationship",
    question: "Which methods are used to study which themes?",
    view: { measure: "papers", rows: "theme", cols: "method" },
    chart: {
      kind: "matrix",
      rowLabel: "Theme",
      colLabel: "Method",
      rows: themes.map(([name]) => name),
      cols: methods.map(([name]) => name),
      values,
      marks,
      paperIds,
    },
    facts,
    takeaway,
    score: 0.25 + 0.55 * marksScore,
    paperIds: uniqueIds(paperIds.flat(2)),
    basis: `Papers per theme and method. Marked cells: a pairing in at least ${MIN_PAPERS} papers and 1.5 times chance, or none where about 3 were expected.`,
  };
}

/* ---------------------------------------------- papers that bridge themes */

export function bridgePapers(corpus: InsightCorpus): Insight | null {
  const N = corpus.papers.length;
  if (N < 10) return null;
  const index = indexBy(corpus.papers, (paper) => paper.themes);
  // Only themes big enough that meeting once is fewer than their sizes predict.
  const established = new Map(sizeOrder(index, Math.max(4, MIN_PAPERS)));
  const found: Array<{ paper: CorpusPaper; a: string; b: string; aPapers: number; bPapers: number; expected: number }> = [];
  for (const paper of corpus.papers) {
    const own = [...paper.themes].filter((theme) => established.has(theme));
    let best: { a: string; b: string; aPapers: number; bPapers: number; expected: number } | null = null;
    for (let i = 0; i < own.length; i += 1) {
      for (let j = i + 1; j < own.length; j += 1) {
        const aIds = established.get(own[i])!;
        const bIds = established.get(own[j])!;
        if (intersectionSize(aIds, bIds) !== 1) continue;
        const expected = (aIds.size * bIds.size) / N;
        if (expected < 1.2) continue;
        const candidate = aIds.size >= bIds.size
          ? { a: own[i], b: own[j], aPapers: aIds.size, bPapers: bIds.size, expected }
          : { a: own[j], b: own[i], aPapers: bIds.size, bPapers: aIds.size, expected };
        if (!best || candidate.expected > best.expected) best = candidate;
      }
    }
    if (best) found.push({ paper, ...best });
  }
  if (found.length === 0) return null;
  found.sort((x, y) => y.expected - x.expected || x.paper.title.localeCompare(y.paper.title));
  const shown = found.slice(0, 4);
  const top = shown[0];
  return {
    id: "bridge_papers",
    family: "gap",
    question: "Which papers connect themes that are otherwise studied apart?",
    view: { measure: "unique pairing", rows: "paper" },
    chart: {
      kind: "list",
      rows: shown.map((entry) => ({
        title: entry.paper.title,
        detail: `The only paper on both ${entry.a} (${entry.aPapers} papers) and ${entry.b} (${entry.bPapers} papers).`,
        paperIds: [entry.paper.id],
      })),
    },
    facts: [
      fact("bridges", found.length, "papers", "papers that alone join two large themes"),
      fact("top_a", top.aPapers, "papers", `papers on ${top.a}`),
      fact("top_b", top.bPapers, "papers", `papers on ${top.b}`),
    ],
    takeaway: `${top.a} (${top.aPapers} papers) and ${top.b} (${top.bPapers} papers) meet in only one paper: "${top.paper.title}".`,
    score: 0.25 + 0.3 * clamp01((top.expected - 1) / 2) + 0.05 * clamp01(found.length / 4),
    paperIds: shown.map((entry) => entry.paper.id),
    basis: "Themes with at least 4 papers, large enough to be expected to meet more than once, that meet in exactly one paper.",
  };
}

/* -------------------------------------------- what marks out each category */

export function categorySignatures(corpus: InsightCorpus): Insight | null {
  if (!corpus.classificationEnabled) return null;
  const N = corpus.papers.length;
  const categories = sizeOrder(indexBy(corpus.papers, (paper) => (paper.category ? [paper.category] : [])));
  if (categories.length < 2 || N < 10) return null;
  const themes = sizeOrder(indexBy(corpus.papers, (paper) => paper.themes));
  const rows: Array<CompareRow & { gap: number; inside: number; outside: number; count: number; size: number }> = [];
  for (const [category, catIds] of categories.slice(0, 4)) {
    const rest = N - catIds.size;
    if (rest < MIN_PAPERS) continue;
    const candidates: typeof rows = [];
    for (const [theme, themeIds] of themes) {
      const count = intersectionSize(catIds, themeIds);
      if (count < MIN_PAPERS) continue;
      const inside = count / catIds.size;
      const outside = (themeIds.size - count) / rest;
      const insideWithoutOne = (count - 1) / (catIds.size - 1);
      if (inside < 1.5 * outside || insideWithoutOne < 1.2 * outside) continue;
      candidates.push({
        label: theme,
        group: category,
        left: percent(count, catIds.size),
        right: percent(themeIds.size - count, rest),
        paperIds: intersection(catIds, themeIds),
        gap: inside - outside,
        inside,
        outside,
        count,
        size: catIds.size,
      });
    }
    candidates.sort((x, y) => y.gap - x.gap || x.label.localeCompare(y.label));
    rows.push(...candidates.slice(0, 2));
  }
  if (rows.length === 0) return null;
  const facts: InsightFact[] = [];
  rows.slice(0, 4).forEach((row, index) => {
    const k = index + 1;
    facts.push(
      fact(`sig${k}_inside`, row.left, "percent", `share of ${row.group} papers on ${row.label}`),
      fact(`sig${k}_outside`, row.right, "percent", `share of the other papers on ${row.label}`),
      fact(`sig${k}_count`, row.count, "papers", `${row.group} papers on ${row.label}`),
      fact(`sig${k}_size`, row.size, "papers", `papers in ${row.group}`)
    );
  });
  const [first] = rows;
  const second = rows.find((row) => row.group !== first.group);
  let takeaway = `${first.label} marks out ${first.group}: ${first.left}% of its ${first.size} papers are on it, against ${first.right}% of the rest.`;
  if (second) takeaway += ` For ${second.group} it is ${second.label} (${second.left}% against ${second.right}%).`;
  return {
    id: "category_signatures",
    family: "composition",
    question: "What sets each category apart?",
    view: { measure: "share in vs outside category", rows: "theme", cols: "category" },
    chart: { kind: "compare", leftLabel: "In the category", rightLabel: "In the other papers", unit: "percent", rows: rows.map(({ label, group, left, right, paperIds }) => ({ label, group, left, right, paperIds })) },
    facts,
    takeaway,
    score: 0.35 + 0.4 * clamp01(first.gap / 0.4) + 0.15 * clamp01(first.count / 6),
    paperIds: uniqueIds(rows.flatMap((row) => row.paperIds)),
    basis: `Themes in at least ${MIN_PAPERS} of a category's papers, and at least 1.5 times as common there as in the other papers, even with one paper removed.`,
  };
}

/* ---------------------------------------------- when each theme appears */

export function themeLifecycles(corpus: InsightCorpus): Insight | null {
  const dated = corpus.papers.filter((paper) => paper.year !== null).sort((a, b) => (a.year as number) - (b.year as number));
  const distinctYears = [...new Set(dated.map((paper) => paper.year as number))];
  if (dated.length < 12 || distinctYears.length < 4) return null;
  const firstYear = dated[0].year as number;
  const lastYear = dated[dated.length - 1].year as number;
  if (lastYear - firstYear < 4) return null;
  // The recent third and the earliest third, by papers rather than by years.
  const lateStart = dated[Math.floor((dated.length * 2) / 3)].year as number;
  const earlyEnd = dated[Math.floor(dated.length / 3)].year as number;
  const split = halves(dated);
  if (!split || lateStart <= firstYear) return null;
  const lateShare = split.late.length / dated.length;
  const axis = yearAxis(dated.map((paper) => String(paper.year))).years;

  const rows: LifecycleRow[] = [];
  for (const [theme, ids] of indexBy(dated, (paper) => paper.themes)) {
    if (ids.size < MIN_PAPERS) continue;
    const years = dated.filter((paper) => ids.has(paper.id)).map((paper) => paper.year as number);
    const first = Math.min(...years);
    const last = Math.max(...years);
    const spread = new Set(years).size;
    const inLateHalf = years.filter((year) => split.late.some((paper) => paper.year === year)).length;
    let status: LifecycleRow["status"] | null = null;
    if (first >= lateStart) status = "new";
    else if (last < (split.late[0]?.year ?? Infinity) && ids.size * lateShare >= 1.5 && inLateHalf === 0) status = "fading";
    else if (first <= earlyEnd && last >= lateStart && spread >= 3) status = "enduring";
    else {
      const peak = Math.max(...years.map((year) => years.filter((other) => other === year || other === year + 1).length));
      const corpusPeak = dated.filter((paper) => years.includes(paper.year as number)).length;
      if (peak / years.length >= 0.7 && corpusPeak / dated.length < 0.5) status = "burst";
    }
    if (!status) continue;
    rows.push({
      label: theme,
      status,
      first: String(first),
      last: String(last),
      papers: ids.size,
      series: axis.map((year) => years.filter((value) => String(value) === year).length),
      paperIds: [...ids],
    });
  }
  const order: Record<LifecycleRow["status"], number> = { new: 0, fading: 1, enduring: 2, burst: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.papers - a.papers || a.label.localeCompare(b.label));
  const fresh = rows.filter((row) => row.status === "new");
  const fading = rows.filter((row) => row.status === "fading");
  const enduring = rows.filter((row) => row.status === "enduring");
  if (fresh.length + fading.length === 0 && enduring.length < 2) return null;
  const shown = [...fresh.slice(0, 4), ...fading.slice(0, 3), ...enduring.slice(0, 3), ...rows.filter((row) => row.status === "burst").slice(0, 2)].slice(0, 10);

  const facts: InsightFact[] = [
    fact("late_start", lateStart, "year", "first year of the most recent third of the papers"),
    fact("new_count", fresh.length, "themes", `themes with at least ${MIN_PAPERS} papers, all from ${lateStart} on`),
    fact("fading_count", fading.length, "themes", "themes with no paper in the later half"),
    fact("enduring_count", enduring.length, "themes", "themes present from the earliest third to the latest"),
  ];
  const parts: string[] = [];
  if (fresh.length) {
    fresh.slice(0, 3).forEach((row, index) => {
      facts.push(
        fact(`new${index + 1}_first`, Number(row.first), "year", `first year with a paper on ${row.label}`),
        fact(`new${index + 1}_papers`, row.papers, "papers", `papers on ${row.label}`)
      );
    });
    const named = fresh.slice(0, 3).map((row) => `${row.label} (from ${row.first}, ${row.papers} papers)`);
    parts.push(`${fresh.length === 1 ? "One theme is" : `${fresh.length} themes are`} new in the most recent papers: ${listOf(named)}.`);
  }
  if (fading.length) {
    facts.push(fact("fading1_last", Number(fading[0].last), "year", `last year with a paper on ${fading[0].label}`));
    parts.push(`${fading[0].label} has no paper after ${fading[0].last}.`);
  }
  if (enduring.length) {
    const longest = [...enduring].sort((a, b) => b.series.filter(Boolean).length - a.series.filter(Boolean).length)[0];
    const yearsWith = longest.series.filter(Boolean).length;
    facts.push(fact("enduring1_years", yearsWith, "count", `different years with a paper on ${longest.label}`));
    parts.push(`${longest.label} runs through the whole period, in papers from ${yearsWith} different years.`);
  }
  return {
    id: "theme_lifecycles",
    family: "change",
    question: "Which themes are new, which endure, and which have faded?",
    view: { measure: "first and last appearance", rows: "theme" },
    chart: { kind: "lifecycles", years: axis, rows: shown },
    facts,
    takeaway: parts.join(" "),
    score: 0.3 + 0.25 * clamp01(fresh.length / 3) + 0.15 * clamp01(fading.length / 2) + 0.1 * clamp01(enduring.length / 3),
    paperIds: uniqueIds(shown.flatMap((row) => row.paperIds)),
    basis: `Themes with at least ${MIN_PAPERS} dated papers. New: every paper is in the most recent third; faded: none in the later half.`,
  };
}

/* --------------------------------------------- broadening or narrowing */

export function themeBreadth(corpus: InsightCorpus): Insight | null {
  const split = halves(corpus.papers);
  if (!split || split.early.length < 6 || split.late.length < 6) return null;
  const richness = (group: CorpusPaper[], k: number) => {
    const counts = [...indexBy(group, (paper) => paper.themes).values()].map((ids) => ids.size);
    return expectedDistinct(counts, group.length, k);
  };
  const compare = (early: CorpusPaper[], late: CorpusPaper[]) => {
    const k = Math.min(10, early.length, late.length);
    const e = richness(early, k);
    const l = richness(late, k);
    return { k, early: e, late: l, change: e > 0 ? (l - e) / e : 0 };
  };
  const whole = compare(split.early, split.late);
  if (whole.early <= 0) return null;
  const leaning = whole.change >= 0.2 ? 1 : whole.change <= -0.2 ? -1 : 0;
  // A paper with ten themes can tip a small period on its own; the change must
  // keep its direction, and most of its size, without any one paper.
  let holds = leaning !== 0;
  if (holds) {
    for (const [group, other, isEarly] of [
      [split.early, split.late, true],
      [split.late, split.early, false],
    ] as const) {
      for (let index = 0; index < group.length && holds; index += 1) {
        const reduced = group.filter((_, position) => position !== index);
        const again = isEarly ? compare(reduced, other) : compare(other, reduced);
        if (Math.sign(again.change) !== leaning || Math.abs(again.change) < 0.1) holds = false;
      }
    }
  }
  // A large difference that one paper can undo is no finding either way.
  if (leaning !== 0 && !holds) return null;
  const direction = leaning > 0 ? "broadened" : leaning < 0 ? "narrowed" : "steady";
  const { k } = whole;
  const early = Math.round(whole.early);
  const late = Math.round(whole.late);
  const topShare = (group: CorpusPaper[]) => {
    const top = sizeOrder(indexBy(group, (paper) => paper.themes), 1).slice(0, 3).map(([name]) => name);
    return percent(group.filter((paper) => top.some((theme) => paper.themes.has(theme))).length, group.length);
  };
  const facts: InsightFact[] = [
    fact("sample", k, "papers", "papers compared from each period"),
    fact("early_themes", early, "themes", `themes expected among ${k} papers from ${split.earlyLabel}`),
    fact("late_themes", late, "themes", `themes expected among ${k} papers from ${split.lateLabel}`),
    fact("change", Math.abs(percent(whole.late - whole.early, whole.early)), "percent", "size of the change between the periods"),
    fact("early_top3", topShare(split.early), "percent", `share of ${split.earlyLabel} papers in that period's 3 largest themes`),
    fact("late_top3", topShare(split.late), "percent", `share of ${split.lateLabel} papers in that period's 3 largest themes`),
  ];
  const takeaway =
    direction === "steady"
      ? `${k} papers from ${split.lateLabel} span about as many themes as ${k} from ${split.earlyLabel} (${late} against ${early}): the range of topics has held steady.`
      : `${k} papers from ${split.lateLabel} span about ${late} themes, against ${early} for ${k} from ${split.earlyLabel}: the range of topics has ${direction}.`;
  return {
    id: "theme_breadth",
    family: "change",
    question: "Is the range of topics broadening or narrowing?",
    view: { measure: "distinct themes per equal sample", rows: "period" },
    chart: {
      kind: "bars",
      valueLabel: `Themes among ${k} papers`,
      unit: "themes",
      rows: [
        { label: split.earlyLabel, value: early, detail: `${split.early.length} papers`, paperIds: split.early.map((paper) => paper.id) },
        { label: split.lateLabel, value: late, detail: `${split.late.length} papers`, paperIds: split.late.map((paper) => paper.id) },
      ],
    },
    facts,
    takeaway,
    score: direction === "steady" ? 0.15 : 0.35 + 0.3 * clamp01(Math.abs(whole.change) / 0.5),
    paperIds: [...split.early, ...split.late].map((paper) => paper.id),
    basis: `The expected number of different themes among ${k} papers drawn at random from each half of the dated papers, so the bigger period does not win by size. A change is claimed only if it holds with any one paper removed.`,
  };
}

/* ---------------------------------------------------- shifting shares */

function shiftInsight(
  corpus: InsightCorpus,
  options: {
    id: string;
    family: Insight["family"];
    question: string;
    labelsOf: (paper: CorpusPaper) => Iterable<string>;
    view: Insight["view"];
  }
): Insight | null {
  const split = halves(corpus.papers);
  const shifts = labelShifts(corpus.papers, options.labelsOf);
  if (!split || !shifts.periods) return null;
  const moved = [
    ...shifts.emerging.map((shift) => ({ shift, tag: "gaining" as const })),
    ...shifts.declining.map((shift) => ({ shift, tag: "losing" as const })),
  ];
  if (moved.length === 0) return null;
  const { earlyLabel, lateLabel, earlyPapers, latePapers } = shifts.periods;
  const earlyIds = new Set(split.early.map((paper) => paper.id));
  const lateIds = new Set(split.late.map((paper) => paper.id));
  const index = indexBy([...split.early, ...split.late], options.labelsOf);
  const tagOf = new Map(moved.map((entry) => [entry.shift.topic, entry.tag]));
  // The labels with enough papers to be judged, and every one that moved.
  const labels = [
    ...new Set([
      ...moved.map((entry) => entry.shift.topic),
      ...sizeOrder(index).map(([label]) => label),
    ]),
  ].slice(0, 8);
  if (labels.length < 2) return null;
  const rows: CompareRow[] = labels.map((label) => {
    const ids = index.get(label) ?? new Set<PaperId>();
    return {
      label,
      left: percent(intersectionSize(ids, earlyIds), earlyPapers),
      right: percent(intersectionSize(ids, lateIds), latePapers),
      tag: tagOf.get(label),
      paperIds: [...ids],
    };
  });
  const lead = [...moved].sort(
    (x, y) => Math.abs(y.shift.lateShare - y.shift.earlyShare) - Math.abs(x.shift.lateShare - x.shift.earlyShare)
  )[0];
  const earlyShare = percent(lead.shift.early, earlyPapers);
  const lateShare = percent(lead.shift.late, latePapers);
  const facts: InsightFact[] = [
    fact("early_papers", earlyPapers, "papers", `dated papers from ${earlyLabel}`),
    fact("late_papers", latePapers, "papers", `dated papers from ${lateLabel}`),
    fact("lead_early", lead.shift.early, "papers", `${earlyLabel} papers with ${lead.shift.topic}`),
    fact("lead_late", lead.shift.late, "papers", `${lateLabel} papers with ${lead.shift.topic}`),
    fact("lead_early_share", earlyShare, "percent", `share of ${earlyLabel} papers with ${lead.shift.topic}`),
    fact("lead_late_share", lateShare, "percent", `share of ${lateLabel} papers with ${lead.shift.topic}`),
  ];
  const others = moved
    .filter((entry) => entry !== lead)
    .slice(0, 2)
    .map((entry) => `${entry.shift.topic} is ${entry.tag} ground`);
  const verb = lead.tag === "gaining" ? "rose" : "fell";
  const takeaway = `${lead.shift.topic} ${verb} from ${lead.shift.early} of ${earlyPapers} papers in ${earlyLabel} (${earlyShare}%) to ${lead.shift.late} of ${latePapers} in ${lateLabel} (${lateShare}%).${others.length ? ` ${others.join("; ")}.` : ""}`;
  const size = Math.abs(lead.shift.lateShare - lead.shift.earlyShare);
  return {
    id: options.id,
    family: options.family,
    question: options.question,
    view: options.view,
    chart: { kind: "compare", leftLabel: earlyLabel, rightLabel: lateLabel, unit: "percent", rows },
    facts,
    takeaway,
    score: 0.35 + 0.45 * clamp01(size / 0.3) + 0.1 * clamp01(moved.length / 3),
    paperIds: uniqueIds(rows.flatMap((row) => row.paperIds)),
    basis: `The dated papers split where they best halve (${earlyPapers} and ${latePapers}). A change counts with at least ${MIN_PAPERS} papers, and only if it survives removing any one of them.`,
  };
}

export function methodShifts(corpus: InsightCorpus): Insight | null {
  return shiftInsight(corpus, {
    id: "method_shifts",
    family: "change",
    question: "Which ways of doing research are gaining or losing ground?",
    labelsOf: (paper) => paper.methods,
    view: { measure: "share early vs late", rows: "method" },
  });
}

export function categoryMixShift(corpus: InsightCorpus): Insight | null {
  if (!corpus.classificationEnabled) return null;
  return shiftInsight(corpus, {
    id: "category_mix_shift",
    family: "change",
    question: "How has the balance between categories shifted?",
    labelsOf: (paper) => (paper.category ? [paper.category] : []),
    view: { measure: "share early vs late", rows: "category" },
  });
}

/* ------------------------------------------------ what studies set out to do */

function coverage(corpus: InsightCorpus, has: (paper: CorpusPaper) => boolean): number {
  return corpus.papers.length ? corpus.papers.filter(has).length / corpus.papers.length : 0;
}

export function studyContributions(corpus: InsightCorpus): Insight | null {
  const N = corpus.papers.length;
  if (N < 8 || coverage(corpus, (paper) => paper.contributions.size > 0) < 0.6) return null;
  const kinds = sizeOrder(indexBy(corpus.papers, (paper) => paper.contributions), 2).slice(0, 8);
  if (kinds.length < 2) return null;
  const shifts = labelShifts(corpus.papers, (paper) => paper.contributions);
  const moved = [...shifts.emerging.map((shift) => ({ shift, tag: "gaining" })), ...shifts.declining.map((shift) => ({ shift, tag: "losing" }))];
  const [topName, topIds] = kinds[0];
  const facts: InsightFact[] = [
    fact("top_kind", topIds.size, "papers", `papers whose main contribution is ${topName}`),
    fact("top_kind_share", percent(topIds.size, N), "percent", `share of papers whose contribution is ${topName}`),
    fact("kinds", kinds.length, "count", "kinds of contribution found in at least 2 papers"),
  ];
  let takeaway = `The most common contribution is ${topName}, in ${topIds.size} of ${N} papers (${percent(topIds.size, N)}%).`;
  if (moved.length && shifts.periods) {
    const lead = moved[0];
    facts.push(
      fact("shift_early", lead.shift.early, "papers", `${shifts.periods.earlyLabel} papers contributing ${lead.shift.topic}`),
      fact("shift_late", lead.shift.late, "papers", `${shifts.periods.lateLabel} papers contributing ${lead.shift.topic}`),
      fact("shift_early_share", Math.round(lead.shift.earlyShare * 100), "percent", `share of ${shifts.periods.earlyLabel} papers contributing ${lead.shift.topic}`),
      fact("shift_late_share", Math.round(lead.shift.lateShare * 100), "percent", `share of ${shifts.periods.lateLabel} papers contributing ${lead.shift.topic}`)
    );
    const name = lead.shift.topic.charAt(0).toUpperCase() + lead.shift.topic.slice(1);
    takeaway += ` ${name} is ${lead.tag} ground: ${Math.round(lead.shift.earlyShare * 100)}% of papers in ${shifts.periods.earlyLabel}, ${Math.round(lead.shift.lateShare * 100)}% in ${shifts.periods.lateLabel}.`;
  }
  return {
    id: "study_contributions",
    family: "composition",
    question: "What do these studies set out to produce?",
    view: { measure: "papers", rows: "contribution type" },
    chart: {
      kind: "bars",
      valueLabel: "Papers",
      unit: "papers",
      rows: kinds.map(([name, ids]) => ({
        label: name.charAt(0).toUpperCase() + name.slice(1),
        value: ids.size,
        detail: `${percent(ids.size, N)}% of papers${moved.find((entry) => entry.shift.topic === name) ? ` · ${moved.find((entry) => entry.shift.topic === name)!.tag}` : ""}`,
        paperIds: [...ids],
      })),
    },
    facts,
    takeaway,
    score: 0.3 + (moved.length ? 0.35 : 0) + 0.1 * clamp01(kinds.length / 6),
    paperIds: uniqueIds(kinds.flatMap(([, ids]) => [...ids])),
    basis: "The contribution each paper's analysis recorded (a paper can have more than one).",
  };
}

export function studyTypes(corpus: InsightCorpus): Insight | null {
  const N = corpus.papers.length;
  if (N < 8 || coverage(corpus, (paper) => Boolean(paper.typology)) < 0.6) return null;
  const groups = sizeOrder(indexBy(corpus.papers, (paper) => (paper.typology ? [paper.typology] : [])), 1);
  if (groups.filter(([, ids]) => ids.size >= MIN_PAPERS).length < 2) return null;
  const themes = sizeOrder(indexBy(corpus.papers, (paper) => paper.themes));
  let strongest: { group: string; theme: string; count: number; groupSize: number; themeSize: number; lift: number } | null = null;
  for (const [group, groupIds] of groups) {
    if (groupIds.size < MIN_PAPERS) continue;
    for (const [theme, themeIds] of themes) {
      const count = intersectionSize(groupIds, themeIds);
      const l = lift(count, groupIds.size, themeIds.size, N);
      if (count < MIN_PAPERS || l < 1.5 || liftWithOneFewer(count, groupIds.size, themeIds.size, N) < 1.2) continue;
      if (!strongest || count * l > strongest.count * strongest.lift) strongest = { group, theme, count, groupSize: groupIds.size, themeSize: themeIds.size, lift: l };
    }
  }
  const [topName, topIds] = groups[0];
  const facts: InsightFact[] = [
    fact("top_type", topIds.size, "papers", `papers of the kind ${topName}`),
    fact("top_type_share", percent(topIds.size, N), "percent", `share of papers of the kind ${topName}`),
  ];
  let takeaway = `${topName} studies make up ${percent(topIds.size, N)}% of the papers (${topIds.size} of ${N}).`;
  const s = strongest as { group: string; theme: string; count: number; groupSize: number; themeSize: number; lift: number } | null;
  if (s) {
    facts.push(
      fact("assoc_count", s.count, "papers", `${s.group} papers on ${s.theme}`),
      fact("assoc_theme", s.themeSize, "papers", `papers on ${s.theme}`),
      fact("assoc_share", percent(s.count, s.themeSize), "percent", `share of papers on ${s.theme} that are ${s.group} studies`)
    );
    takeaway += ` Papers on ${s.theme} lean ${s.group}: ${s.count} of ${s.themeSize} (${percent(s.count, s.themeSize)}%).`;
  }
  return {
    id: "study_types",
    family: "composition",
    question: "What kinds of study are these?",
    view: { measure: "papers", rows: "research type" },
    chart: {
      kind: "bars",
      valueLabel: "Papers",
      unit: "papers",
      rows: groups.slice(0, 6).map(([name, ids]) => ({ label: name, value: ids.size, detail: `${percent(ids.size, N)}% of papers`, paperIds: [...ids] })),
    },
    facts,
    takeaway,
    score: 0.25 + (s ? 0.3 : 0),
    paperIds: uniqueIds(groups.flatMap(([, ids]) => [...ids])),
    basis: "The research type the analysis assigned each paper.",
  };
}

/* ------------------------------------------ what authors call their work */

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3);
}

export function authorKeywordGaps(corpus: InsightCorpus): Insight | null {
  const N = corpus.papers.length;
  if (N < 8 || coverage(corpus, (paper) => paper.authorKeywords.length > 0) < 0.5) return null;
  const byKeyword = new Map<string, { label: string; papers: CorpusPaper[] }>();
  for (const paper of corpus.papers) {
    for (const keyword of new Set(paper.authorKeywords.map((value) => value.toLowerCase()))) {
      const entry = byKeyword.get(keyword) ?? { label: paper.authorKeywords.find((value) => value.toLowerCase() === keyword) ?? keyword, papers: [] };
      entry.papers.push(paper);
      byKeyword.set(keyword, entry);
    }
  }
  const covered = (paper: CorpusPaper, keyword: string) => {
    const wanted = tokens(keyword);
    if (wanted.length === 0) return true;
    const have = new Set([...paper.terms, ...[...paper.themes].map((theme) => theme.toLowerCase())].flatMap(tokens));
    return wanted.filter((token) => have.has(token)).length / wanted.length >= 0.6;
  };
  const gaps = [...byKeyword.values()]
    .filter((entry) => entry.papers.length >= 2)
    .map((entry) => ({ ...entry, missing: entry.papers.filter((paper) => !covered(paper, entry.label)).length }))
    .filter((entry) => entry.missing / entry.papers.length > 0.5)
    .sort((a, b) => b.papers.length - a.papers.length || a.label.localeCompare(b.label));
  if (gaps.length === 0) return null;
  const top = gaps[0];
  return {
    id: "author_keyword_gaps",
    family: "gap",
    question: "What do authors call their work that the themes do not?",
    view: { measure: "papers", rows: "author keyword" },
    chart: {
      kind: "list",
      rows: gaps.slice(0, 6).map((entry) => ({
        title: entry.label,
        detail: `An author keyword in ${plural(entry.papers.length, "paper")}; no theme or topic of ${entry.papers.length === 1 ? "it" : "them"} names it.`,
        paperIds: entry.papers.map((paper) => paper.id),
      })),
    },
    facts: [
      fact("gap_count", gaps.length, "count", "author keywords used by 2 or more papers that no theme names"),
      fact("top_papers", top.papers.length, "papers", `papers whose authors list ${top.label}`),
    ],
    takeaway: `Authors of ${top.papers.length} papers list "${top.label}" as a keyword, but none of those papers' themes names it.`,
    score: 0.2 + 0.2 * clamp01((top.papers.length - 1) / 4),
    paperIds: uniqueIds(gaps.slice(0, 6).flatMap((entry) => entry.papers.map((paper) => paper.id))),
    basis: "Keywords the authors listed on at least 2 papers, compared with the themes and topics found in those papers.",
  };
}

export const ANALYSES = [
  themePairs,
  methodsByTheme,
  categorySignatures,
  themeLifecycles,
  methodShifts,
  categoryMixShift,
  themeBreadth,
  studyContributions,
  studyTypes,
  bridgePapers,
  authorKeywordGaps,
] as const;
