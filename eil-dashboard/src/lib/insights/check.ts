/*
 * Every number a model writes must be one of the computed facts.
 *
 * The previous planner's reasons never cited a number, because nothing the
 * model was given matched what the page drew. Now the model is shown each
 * insight's facts and may quote them, so this checks that it did quote them:
 * any number in a title or takeaway that is not a fact of that insight (or of
 * the selection as a whole) sends the text back to the computed sentence.
 *
 * Numbers inside names are not claims - "L2 Reading Comprehension", a paper
 * titled "... in 2019" - so every label the insight draws, and anything in
 * quotation marks, is removed before numbers are read.
 */
import type { Insight, InsightFact, InsightReport } from "@/lib/insights/types";

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
/** Words that claim a ratio. "One" is left out: it is as often a pronoun as a count. */
const RATIO_WORDS: Record<string, number> = {
  twice: 2, double: 2, doubled: 2, doubles: 2, triple: 3, tripled: 3, triples: 3, halved: 0.5,
  quadrupled: 4,
};

export interface NumberClaim {
  raw: string;
  value: number;
  /** "half" is its own kind: "half of the papers" is about 50%, loosely. */
  kind: "percent" | "plain" | "ratio" | "half";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractClaims(text: string, labels: string[]): NumberClaim[] {
  let rest = ` ${text} `;
  for (const label of [...new Set(labels)].filter((label) => /\d/.test(label)).sort((a, b) => b.length - a.length)) {
    rest = rest.replace(new RegExp(escapeRegExp(label), "gi"), " ");
  }
  rest = rest.replace(/[“"‘][^”"’]*[”"’]/g, " ");
  // "2011–2021" is a period, read as its two years.
  rest = rest.replace(/(\d{4})\s*[–-]\s*(\d{4})/g, "$1 and $2");
  const claims: NumberClaim[] = [];
  for (const match of rest.matchAll(/(\d+(?:\.\d+)?)\s*(%|percent\b|per cent\b)?(\s*times\b)?/gi)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    claims.push({ raw: match[0].trim(), value, kind: match[2] ? "percent" : match[3] ? "ratio" : "plain" });
  }
  for (const match of rest.toLowerCase().matchAll(/\b([a-z]+)\b(\s*(?:%|percent\b|per cent\b))?(\s*times\b)?/g)) {
    const word = match[1];
    if (word in NUMBER_WORDS) {
      claims.push({ raw: match[0].trim(), value: NUMBER_WORDS[word], kind: match[2] ? "percent" : match[3] ? "ratio" : "plain" });
    } else if (word in RATIO_WORDS) {
      claims.push({ raw: word, value: RATIO_WORDS[word], kind: "ratio" });
    }
  }
  // "The later half" names a period; "half of them" and "by half" are claims.
  for (const match of rest.toLowerCase().matchAll(/\bhalf (?:of|as)\b|\bby half\b/g)) {
    claims.push({ raw: match[0], value: 0.5, kind: "half" });
  }
  return claims;
}

function claimMatches(claim: NumberClaim, facts: InsightFact[]): boolean {
  return facts.some((fact) => {
    switch (claim.kind) {
      case "half":
        return (fact.unit === "percent" && fact.value >= 45 && fact.value <= 55) || (fact.unit === "ratio" && fact.value >= 0.45 && fact.value <= 0.55);
      case "percent":
        return fact.unit === "percent" && Math.abs(fact.value - claim.value) <= 1;
      case "ratio":
        return (
          (fact.unit === "ratio" && Math.abs(fact.value - claim.value) <= Math.max(0.1, fact.value * 0.1)) ||
          // "three times" of a count, as in "three times in the corpus".
          (fact.unit !== "ratio" && fact.unit !== "percent" && fact.value === claim.value)
        );
      default:
        if (fact.unit === "ratio") return Math.abs(fact.value - claim.value) < 0.05;
        return fact.value === claim.value;
    }
  });
}

/** The numbers in `text` that no fact backs; empty when the text is sound. */
export function unbackedClaims(text: string, facts: InsightFact[], labels: string[]): NumberClaim[] {
  return extractClaims(text, labels).filter((claim) => !claimMatches(claim, facts));
}

/** Every name an insight draws, so digits inside names are not read as claims. */
export function insightLabels(insight: Insight): string[] {
  const chart = insight.chart;
  const labels: string[] = [];
  switch (chart.kind) {
    case "bars":
      chart.rows.forEach((row) => labels.push(row.label));
      break;
    case "pairs":
      chart.rows.forEach((row) => labels.push(row.a, row.b));
      break;
    case "matrix":
      labels.push(...chart.rows, ...chart.cols);
      break;
    case "compare":
      labels.push(chart.leftLabel, chart.rightLabel);
      chart.rows.forEach((row) => labels.push(row.label, row.group ?? ""));
      break;
    case "lifecycles":
      chart.rows.forEach((row) => labels.push(row.label));
      break;
    case "list":
      chart.rows.forEach((row) => labels.push(row.title));
      break;
  }
  return labels.filter(Boolean);
}

/** Facts true of the whole selection, which any sentence may use. */
export function corpusFacts(report: InsightReport): InsightFact[] {
  const { summary } = report;
  const facts: InsightFact[] = [
    { id: "corpus_papers", value: summary.papers, unit: "papers", text: "papers in the selection" },
    { id: "corpus_dated", value: summary.datedPapers, unit: "papers", text: "papers with a publication year" },
    { id: "corpus_shared_themes", value: summary.sharedThemes, unit: "themes", text: "themes shared by 2 or more papers" },
  ];
  if (summary.firstYear) facts.push({ id: "corpus_first_year", value: Number(summary.firstYear), unit: "year", text: "earliest publication year" });
  if (summary.lastYear) facts.push({ id: "corpus_last_year", value: Number(summary.lastYear), unit: "year", text: "latest publication year" });
  if (summary.duplicatesCountedOnce) {
    facts.push({ id: "corpus_duplicates", value: summary.duplicatesCountedOnce, unit: "papers", text: "likely duplicate uploads counted once" });
  }
  return facts;
}

/** Years named in an insight's own labels and fact wording ("from 2011–2021"). */
export function yearsMentioned(insight: Insight): InsightFact[] {
  const text = [insight.basis, ...insight.facts.map((fact) => fact.text), ...insightLabels(insight)].join(" ");
  return [...new Set(text.match(/\b(19|20)\d{2}\b/g) ?? [])].map((year) => ({
    id: `year_${year}`,
    value: Number(year),
    unit: "year" as const,
    text: "a year the insight names",
  }));
}

export function allowedFacts(insight: Insight, report: InsightReport): InsightFact[] {
  return [...insight.facts, ...yearsMentioned(insight), ...corpusFacts(report)];
}
