/*
 * Charts of what the papers themselves report (Chart mode, 2026-10-10).
 *
 * Chart mode drew how papers divide by theme, method or year (chat-chart.ts),
 * how long they are, and how often a word appears. Asked what the papers
 * report - how many people took part in each study, where the studies were
 * done, the scores a paper's table gives - it said the papers' data could not
 * answer, or drew a keyword chart instead. Now one planning call chooses
 * between the dashboard's views and reading the papers. Reading asks the
 * answer model for one value per paper with the sentence it comes from; code
 * keeps a value only when that sentence is in the paper and the number is in
 * that sentence, and computes the chart and every number in the reply.
 */
import { z } from "zod";
import type { ChatEffort } from "@/lib/chat-effort";
import { askGuide, askTool, parseAskQuery, type AskDimension, type AskQuery } from "@/lib/insights/ask";
import { MIN_PAPERS } from "@/lib/insights/stats";
import { createChatCompletionResult } from "@/lib/openai";
import { paperParts, readPapers, type ReadablePaper } from "@/lib/paper-reading";

export const READ_KINDS = ["values", "paper_table", "length", "sections", "terms", "keywords"] as const;
export type ReadKind = (typeof READ_KINDS)[number];

const CHART_TYPES = ["bar", "line", "pie", "table"] as const;
export type ReadChartType = (typeof CHART_TYPES)[number];

/** What to read from the papers for a chart. */
export interface ReadPlan {
  kind: ReadKind;
  title: string;
  chart: ReadChartType;
  /** values: the one value each paper reports; paper_table: what the figures are. */
  field: string;
  valueType: "number" | "category";
  unit: string;
  groupBy: "paper" | "year";
  /** paper_table: the figures drawn side by side ("Pre-test", "Post-test"). */
  series: string[];
  /** terms: the words or phrases counted. */
  terms: string[];
  /** Phrases a passage that reports it would contain, to find it in a long paper. */
  search: string[];
}

export type ChartPlan = { tool: "build_view"; query: AskQuery } | { tool: "read_papers"; read: ReadPlan };

/** A paper as the chart reads it. */
export type ChartPaper = ReadablePaper;

/** Where one charted value comes from, shown under the chart. */
export interface ChartSource {
  paperId: string;
  title: string;
  year: string;
  /** The value as charted, with its unit: "49 participants", "Thailand". */
  value: string;
  /** The paper's own words, as printed. */
  quote: string;
  note?: string;
}

/** A chart computed from what was read, before it is put in the chat's chart shape. */
export interface ReadChart {
  /** The reply's opening, in English; every number in it is computed. */
  lead: string;
  chart: {
    chartType: ReadChartType;
    title: string;
    yKeys: string[];
    data: Array<Record<string, string | number>>;
  } | null;
  sources: ChartSource[];
  limitations: string[];
  /** Papers that gave a charted value, for the answer's citations. */
  citedPaperIds: string[];
}

type Complete = typeof createChatCompletionResult;

export function readPapersTool() {
  return {
    type: "function",
    function: {
      name: "read_papers",
      description:
        "Chart something read from the papers' own text: a value each paper reports, figures from a paper's tables or results, how long the papers are, the words in each section, or how often words appear.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: [...READ_KINDS],
            description:
              "values: one value each paper reports (participants, sample size, a score, an effect size, a duration, a country, an instrument, a statistical test). " +
              "paper_table: several figures from one to three papers' tables or results. length: how long each paper is. sections: the words in each section. " +
              "terms: how often given words or phrases appear. keywords: how often a paper's own keywords appear.",
          },
          title: { type: "string", description: "The chart's title in English, at most 12 words." },
          chart: { type: "string", enum: [...CHART_TYPES], description: "The chart the question asks for; else bar, or line for values over years or ordered time points. pie only for parts of a whole." },
          field: {
            type: "string",
            description:
              "values: precisely what the one value per paper is, in English, e.g. 'total number of participants' or 'country where the study was conducted'. paper_table: what the figures are, e.g. 'mean pre-test and post-test scores by group'. Else empty.",
          },
          value_type: { type: "string", enum: ["number", "category"], description: "values: number for a count or measurement; category for a name or a kind." },
          unit: { type: "string", description: "The unit of a number in English, e.g. 'participants' or 'weeks'; or empty." },
          group_by: { type: "string", enum: ["paper", "year"], description: "values with numbers: one bar per paper, or the median for each year." },
          series: { type: "array", items: { type: "string" }, maxItems: 4, description: "paper_table: short names of the figures drawn side by side, e.g. ['Pre-test', 'Post-test']; or empty." },
          terms: { type: "array", items: { type: "string" }, maxItems: 6, description: "terms: the words or phrases to count, as the question gives them; or empty." },
          search: { type: "array", items: { type: "string" }, maxItems: 4, description: "values and paper_table: short phrases a passage reporting it would contain, e.g. 'participants', 'students were', 'sample'." },
        },
        required: ["kind", "title", "chart", "field", "value_type", "unit", "group_by", "series", "terms", "search"],
      },
    },
  };
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function parseReadPlan(raw: unknown): ReadPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = READ_KINDS.find((entry) => entry === value.kind);
  if (!kind) return null;
  const list = (entry: unknown, max: number) =>
    Array.isArray(entry) ? [...new Set(entry.map((item) => clean(item, 80)).filter(Boolean))].slice(0, max) : [];
  // The field is read inside a sentence ("12 of 30 papers state …"): "Main results" becomes "main results"; "VOT" stays.
  const field = clean(value.field, 160).replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase());
  const terms = list(value.terms, 6);
  if ((kind === "values" || kind === "paper_table") && !field) return null;
  if (kind === "terms" && terms.length === 0) return null;
  return {
    kind,
    title: clean(value.title, 120),
    chart: CHART_TYPES.find((entry) => entry === value.chart) ?? "bar",
    field,
    valueType: value.value_type === "category" ? "category" : "number",
    unit: clean(value.unit, 40),
    groupBy: value.group_by === "year" ? "year" : "paper",
    series: list(value.series, 4),
    terms,
    search: list(value.search, 4),
  };
}

export function chartPlanMessages(input: {
  question: string;
  scopeLabel: string;
  papers: Array<{ title: string; year: string }>;
  /** The dashboard's values, when there are enough papers for its views. */
  vocabulary: Record<AskDimension, string[]> | null;
}) {
  const views = input.vocabulary !== null;
  return [
    {
      role: "system" as const,
      content:
        "You plan one chart that answers a researcher's question about the academic papers in scope, by calling one tool. " +
        (views
          ? "build_view counts papers by what their analysis recorded: theme, method, research area, contribution, kind of study, aim and year. "
          : "") +
        "read_papers reads the papers' own text: a value each paper reports, a paper's own figures, their length, their sections, or how often words appear. " +
        "You never write a number; code computes the chart.",
    },
    {
      role: "user" as const,
      content: [
        ...(views
          ? [
              "Use build_view whenever the question is about themes, methods, kinds of study, aims, contributions, research areas or years: it covers every paper at once. How to fill it:",
              ...askGuide(),
              `Values present: ${JSON.stringify(input.vocabulary)}`,
              "",
              "Use read_papers for what the papers state in their text, which build_view does not have:",
            ]
          : [`Only read_papers is available: the other views need at least ${MIN_PAPERS} papers. How to fill it:`]),
        "- 'How many participants did each study have?' -> kind values, field 'total number of participants', value_type number, unit 'participants', group_by paper, search ['participants', 'students', 'sample'].",
        "- 'Have sample sizes grown over the years?' -> kind values, field 'total number of participants', value_type number, group_by year, chart line.",
        "- 'Where were the studies conducted?' -> kind values, field 'country where the study was conducted', value_type category.",
        "- 'Which statistical tests do the papers use?' -> kind values, field 'statistical tests used', value_type category.",
        "- 'How long did each intervention last?' -> kind values, field 'length of the intervention', value_type number, unit 'weeks'.",
        "- 'Chart the pre-test and post-test scores in <a paper>' -> kind paper_table, field 'mean pre-test and post-test scores by group', series ['Pre-test', 'Post-test'].",
        "- 'How long is each paper?' -> kind length. 'Words in each section' -> kind sections.",
        "- 'How often do the papers mention motivation and anxiety?' -> kind terms, terms ['motivation', 'anxiety'].",
        ...(views ? [] : ["- 'Which keywords does it use most?', or a chart request with no subject -> kind keywords."]),
        "paper_table reads one to three papers' own figures: use it when the question is about figures inside a paper and names it, or when at most three papers are in scope.",
        "The question may be in any language; write the title and field in English.",
        `Scope: ${input.scopeLabel}, ${input.papers.length} paper${input.papers.length === 1 ? "" : "s"}.`,
        `Papers: ${JSON.stringify(input.papers.slice(0, 40).map((paper) => `${paper.title.slice(0, 140)} (${paper.year || "Unknown"})`))}`,
        `Question: ${input.question}`,
      ].join("\n"),
    },
  ];
}

/**
 * One call that turns a chart request into a dashboard view or a reading of
 * the papers. Null when the model gives nothing usable, so the caller can fall
 * back to the dashboard's own view.
 */
export async function planChart(input: Parameters<typeof chartPlanMessages>[0] & { complete?: Complete }): Promise<ChartPlan | null> {
  const complete = input.complete ?? createChatCompletionResult;
  const tools = input.vocabulary ? [askTool(), readPapersTool()] : [readPapersTool()];
  try {
    const result = await complete(chartPlanMessages(input), 0, undefined, "CHAT_CHART_PLAN", {
      maxTokens: 3_000,
      reasoningEffort: "low",
      tools,
      toolChoice: tools.length === 1 ? { type: "function", function: { name: "read_papers" } } : "required",
      parallelToolCalls: false,
      timeoutMs: 30_000,
    });
    if (!result) return null;
    const call = result.toolCalls.find((entry) => entry.function?.name === "build_view" || entry.function?.name === "read_papers");
    let name = call?.function?.name;
    let args: unknown;
    try {
      args = JSON.parse(call?.function?.arguments ?? result.content ?? "null");
    } catch {
      return null;
    }
    // A model that answers in the message rather than a tool call: {tool, arguments}, or the arguments alone.
    if (!call && args && typeof args === "object") {
      const value = args as Record<string, unknown>;
      if (typeof value.tool === "string") {
        name = value.tool;
        args = value.arguments;
      } else {
        name = "kind" in value ? "read_papers" : "build_view";
      }
    }
    if (name === "build_view") {
      const query = input.vocabulary ? parseAskQuery(args) : null;
      return query ? { tool: "build_view", query } : null;
    }
    const read = parseReadPlan(args);
    return read ? { tool: "read_papers", read } : null;
  } catch (error) {
    console.warn("chat_chart_plan_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Checking what the model read against the paper.

const THAI_DIGITS = /[๐-๙]/g;

function folded(text: string): string {
  return text
    .normalize("NFKC")
    .replace(THAI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .toLowerCase()
    // A word broken over a line in the PDF: "partici-\npants".
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2");
}

/** Words and numbers, without punctuation: "1,200", "3.45" and "forty" are one word each. */
export function wordsOf(text: string): string[] {
  return folded(text).match(/[\p{L}\p{M}\p{N}]+(?:[.,]\p{N}+)*/gu) ?? [];
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function numericValue(word: string): number | null {
  if (!/^\p{N}+(?:[.,]\p{N}+)*$/u.test(word)) return null;
  const plain = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(word) ? word.replace(/,/g, "") : word.replace(/,/g, ".");
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

interface NumberWord {
  value: number;
  /** Word positions [start, end). */
  start: number;
  end: number;
}

/** The numbers in a run of words, written in digits or in English words ("forty-nine"). */
export function numbersIn(words: string[]): NumberWord[] {
  const found: NumberWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const digits = numericValue(words[index]);
    if (digits !== null) {
      found.push({ value: digits, start: index, end: index + 1 });
      continue;
    }
    if (UNITS[words[index]] === undefined && TENS[words[index]] === undefined) continue;
    let total = 0;
    let current = 0;
    let end = index;
    while (end < words.length) {
      const word = words[end];
      if (UNITS[word] !== undefined) current += UNITS[word];
      else if (TENS[word] !== undefined) current += TENS[word];
      else if (word === "hundred" && current > 0) current *= 100;
      else if (word === "thousand" && current > 0) {
        total += current * 1000;
        current = 0;
      } else if (word === "and" && /^(?:hundred|thousand)$/.test(words[end - 1] ?? "") && (UNITS[words[end + 1]] !== undefined || TENS[words[end + 1]] !== undefined)) {
        // "one hundred and twenty"
      } else break;
      end += 1;
    }
    found.push({ value: total + current, start: index, end });
    index = end - 1;
  }
  return found;
}

/** A paper's text prepared once for every check against it. */
export interface CheckableText {
  joined: string;
  trigrams: Set<string> | null;
  words: string[];
  numbers: Set<number> | null;
}

export function checkable(text: string): CheckableText {
  const words = wordsOf(text);
  return { joined: ` ${words.join(" ")} `, trigrams: null, words, numbers: null };
}

function trigramsOf(words: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index + 2 < words.length; index += 1) out.push(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);
  return out;
}

/**
 * Whether a quote is in the paper: word for word once punctuation and case are
 * set aside, each part of a quote cut with "…" on its own; or, for a quote with
 * a slip in it, four in five of its three-word runs. A quote stitched from far
 * apart, or a sentence the paper does not contain, fails.
 */
export function quoteInText(quote: string, text: CheckableText): boolean {
  const parts = quote
    .split(/\[?(?:…|\.\.\.)\]?/)
    .map((part) => wordsOf(part))
    .filter((words) => words.length > 0);
  const words = parts.flat();
  if (words.join(" ").length < 12) return false;
  if (parts.every((part) => text.joined.includes(` ${part.join(" ")} `))) return true;
  if (words.length < 6) return false;
  text.trigrams ??= new Set(trigramsOf(text.words));
  const own = parts.flatMap(trigramsOf);
  return own.length > 0 && own.filter((gram) => text.trigrams!.has(gram)).length / own.length >= 0.8;
}

/**
 * Whether a number is printed in the quote, next to the same word as in the
 * paper: "49 students" must be in the paper, not just a 49 somewhere in it.
 */
export function numberInQuote(value: number, quote: string, text: CheckableText): boolean {
  const words = wordsOf(quote);
  for (const token of numbersIn(words)) {
    if (Math.abs(token.value - value) > Math.max(1e-9, Math.abs(value) * 1e-9)) continue;
    const span = words.slice(token.start, token.end);
    const before = token.start > 0 ? [words[token.start - 1], ...span] : null;
    const after = token.end < words.length ? [...span, words[token.end]] : null;
    if ([before, after].some((run) => run && text.joined.includes(` ${run.join(" ")} `))) return true;
  }
  return false;
}

/** Whether a number is printed anywhere in the paper. */
export function numberInPaper(value: number, text: CheckableText): boolean {
  text.numbers ??= new Set(numbersIn(text.words).map((token) => token.value));
  return text.numbers.has(value);
}

// ---------------------------------------------------------------------------
// Reading one value from each paper.

/** Characters of each paper read for one value, by effort: the parts that bear on it, or the whole paper when it fits. */
const VALUE_READING: Record<ChatEffort, number> = { low: 5_000, medium: 12_000, high: 30_000 };
/** Papers read for one chart, by effort; more are said to be left out. */
const VALUE_PAPERS: Record<ChatEffort, number> = { low: 30, medium: 60, high: 120 };
const BATCH_CHARS = 72_000;
const CONCURRENCY = 8;

// Lenient on purpose: on the test repository the model wrote null for the
// fields that did not apply ("values": null beside a number), and a strict
// schema threw away whole batches of six papers that had been read correctly.
const ExtractedItemSchema = z.object({
  paperId: z.coerce.string(),
  reported: z.union([z.boolean(), z.string()]).transform((value) => value === true || value === "true"),
  number: z.union([z.number(), z.string()]).nullish(),
  parts: z.array(z.unknown()).nullish(),
  values: z.array(z.unknown()).nullish(),
  quote: z.string().nullish(),
  note: z.string().nullish(),
});
const ExtractedBatchSchema = z.object({ items: z.array(z.unknown()) });
type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

/** A reply's JSON object, or null; never throws. */
function jsonObjectIn(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface ReportedValue {
  paper: ChartPaper;
  number: number | null;
  /** The names counted: each paper's own answers, put in shared groups when there were many. */
  values: string[];
  /** The paper's own answers, as read, when they were grouped. */
  named?: string[];
  quote: string;
  note: string;
}

export interface ValueReading {
  found: ReportedValue[];
  /** Papers whose text, as read, does not state it. */
  notStated: ChartPaper[];
  /** Values whose sentence, or whose number, is not in the paper. */
  unverified: ChartPaper[];
  /** Papers whose answer could not be read (a failed call). */
  failed: ChartPaper[];
  /** Of the papers read, how many were read in part. */
  readInPart: number;
  /** Papers in scope beyond what this effort reads. */
  skipped: number;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.replace(/\s/g, "").match(/-?\d+(?:,\d{3})*(?:\.\d+)?/);
  return match ? numericValue(match[0].replace(/^-/, "")) : null;
}

function extractionSystem(plan: ReadPlan): string {
  return [
    "You read academic papers and report one fact from each, exactly as the paper states it.",
    `The fact: ${plan.field}${plan.unit ? ` (in ${plan.unit})` : ""}.`,
    "For each paper give: reported (false when the text given does not state it); quote (the sentence that states it, copied word for word from the paper's text, at most 300 characters; use … to leave out words inside it); note (a few words when the value needs qualifying, e.g. 'two groups of 24 and 25' or 'pilot study only', else empty).",
    plan.valueType === "number"
      ? "number: the one number the paper states for the whole study (the total, not one group's), as digits. If the paper gives only parts - two groups, three schools - give each part in parts and their total in number, and quote the sentence with the parts. Never estimate a number the paper does not state."
      : "values: one to four short names in English, as a researcher would label them (a country by its common English name, a test by its usual name). Several only when the paper itself has several.",
    "Each paper's text says whether it is the whole paper or excerpts; read all of it before deciding a paper does not state the fact.",
    'Return JSON only: {"items":[{"paperId","reported","number","parts","values","quote","note"}]} with every paperId given exactly once.',
  ].join(" ");
}

/** Checks one paper's answer against its text; the value, or why it was not kept. */
export function checkReportedValue(
  item: ExtractedItem,
  paper: ChartPaper,
  text: CheckableText,
  valueType: ReadPlan["valueType"]
): ReportedValue | "not_stated" | "unverified" {
  if (!item.reported) return "not_stated";
  const quote = clean(item.quote, 400);
  if (!quote || !quoteInText(quote, text)) return "unverified";
  const note = clean(item.note, 120);
  if (valueType === "category") {
    const values = [...new Map((item.values ?? []).map((value) => clean(value, 60)).filter(Boolean).map((value) => [value.toLowerCase(), value])).values()].slice(0, 4);
    return values.length > 0 ? { paper, number: null, values, quote, note } : "not_stated";
  }
  const number = toNumber(item.number);
  if (number === null) return "not_stated";
  if (numberInQuote(number, quote, text)) return { paper, number, values: [], quote, note };
  // A total the paper gives only in parts: each part printed, and they add up.
  const parts = (item.parts ?? []).slice(0, 12).map(toNumber).filter((part): part is number => part !== null);
  const sum = parts.reduce((total, part) => total + part, 0);
  if (parts.length >= 2 && Math.abs(sum - number) < 1e-9 && parts.every((part) => numberInQuote(part, quote, text))) {
    return { paper, number, values: [], quote, note: note || `the total of ${parts.join(" and ")}` };
  }
  return "unverified";
}

function paperText(paper: ChartPaper): string {
  return [paper.title, ...paperParts(paper).map((part) => part.text)].join("\n\n");
}

async function readValueBatch(
  papers: ChartPaper[],
  plan: ReadPlan,
  question: string,
  effort: ChatEffort,
  complete: Complete,
  model?: string
): Promise<Map<string, ExtractedItem> | null> {
  const readings = readPapers(papers, [plan.field, ...plan.search, question], VALUE_READING[effort] * papers.length);
  const request = JSON.stringify({
    question,
    fact: plan.field,
    unit: plan.unit,
    papers: papers.map((paper, index) => ({
      paperId: paper.paperId,
      title: paper.title,
      year: paper.year,
      read: readings[index].whole ? "the whole paper" : "excerpts; […] marks text left out",
      text: readings[index].text,
    })),
  });
  const system = extractionSystem(plan);
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await complete(
        attempt === 0
          ? [{ role: "system", content: system }, { role: "user", content: request }]
          : [
              { role: "system", content: system },
              { role: "user", content: request },
              { role: "assistant", content: raw.slice(0, 6_000) },
              { role: "user", content: "That was not valid. Reply with the JSON object only, with every paperId exactly once." },
            ],
        0,
        model,
        "CHAT_CHART_EXTRACT",
        { maxTokens: 2_500 + papers.length * 350, reasoningEffort: effort === "high" ? "medium" : "low", jsonObject: true, timeoutMs: 90_000 }
      );
      raw = result?.content?.trim() ?? "";
      const parsed = ExtractedBatchSchema.safeParse(jsonObjectIn(raw));
      if (parsed.success) {
        const known = new Set(papers.map((paper) => paper.paperId));
        // One malformed item costs that paper, not its batch.
        const items = parsed.data.items
          .map((item) => ExtractedItemSchema.safeParse(item))
          .flatMap((item) => (item.success && known.has(item.data.paperId) ? [item.data] : []));
        return new Map(items.map((item) => [item.paperId, item]));
      }
      // What went wrong, never what the papers say.
      console.warn("chat_chart_extract_unparsed", { attempt, replyChars: raw.length, issues: parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}:${issue.code}`) });
    } catch (error) {
      console.warn("chat_chart_extract_failed", { attempt, message: error instanceof Error ? error.message : "unknown_error" });
    }
  }
  return null;
}

/** Reads one value from every paper in scope, in batches, and keeps only what checks out. */
export async function readValues(input: {
  papers: ChartPaper[];
  plan: ReadPlan;
  question: string;
  effort: ChatEffort;
  model?: string;
  complete?: Complete;
}): Promise<ValueReading> {
  const complete = input.complete ?? createChatCompletionResult;
  const papers = input.papers.slice(0, VALUE_PAPERS[input.effort]);
  const size = Math.max(1, Math.min(8, Math.floor(BATCH_CHARS / VALUE_READING[input.effort])));
  const batches: ChartPaper[][] = [];
  for (let start = 0; start < papers.length; start += size) batches.push(papers.slice(start, start + size));
  const answers: Array<Map<string, ExtractedItem> | null> = [];
  for (let start = 0; start < batches.length; start += CONCURRENCY) {
    const wave = batches.slice(start, start + CONCURRENCY);
    answers.push(...(await Promise.all(wave.map((batch) => readValueBatch(batch, input.plan, input.question, input.effort, complete, input.model)))));
  }
  const outcome: ValueReading = { found: [], notStated: [], unverified: [], failed: [], readInPart: 0, skipped: input.papers.length - papers.length };
  const budget = VALUE_READING[input.effort];
  batches.forEach((batch, index) => {
    const answer = answers[index];
    for (const paper of batch) {
      if (paperParts(paper).reduce((sum, part) => sum + part.label.length + part.text.length + 6, 0) > budget) outcome.readInPart += 1;
      const item = answer?.get(paper.paperId);
      if (!answer) {
        outcome.failed.push(paper);
        continue;
      }
      if (!item) {
        outcome.notStated.push(paper);
        continue;
      }
      const checked = checkReportedValue(item, paper, checkable(paperText(paper)), input.plan.valueType);
      if (checked === "not_stated") outcome.notStated.push(paper);
      else if (checked === "unverified") outcome.unverified.push(paper);
      else outcome.found.push(checked);
    }
  });
  if (input.plan.valueType === "category") await groupNames(outcome.found, input.plan, input.question, complete, input.model);
  return outcome;
}

/** Above this many different answers, they are put in shared groups before counting. */
const GROUP_ABOVE = 8;
const MAX_GROUPS = 12;

/**
 * Puts the papers' own answers in shared groups, so a chart counts studies
 * that used interviews rather than "Interview", "Interviews" and
 * "Semi-structured interview" one paper each (85 different answers on the
 * test repository). Papers are read in batches, each naming things its own
 * way. One small call sees only the names; an answer it leaves out, or a
 * name it invents, keeps the paper's own word.
 */
async function groupNames(found: ReportedValue[], plan: ReadPlan, question: string, complete: Complete, model?: string): Promise<void> {
  const counts = new Map<string, { name: string; papers: number }>();
  for (const value of found) {
    for (const name of value.values) {
      const entry = counts.get(name.toLowerCase()) ?? { name, papers: 0 };
      entry.papers += 1;
      counts.set(name.toLowerCase(), entry);
    }
  }
  if (counts.size <= GROUP_ABOVE) return;
  let groups: Map<string, string> | null = null;
  try {
    const result = await complete(
      [
        {
          role: "system",
          content:
            `You group the answers papers gave to one question into at most ${MAX_GROUPS} categories for a chart. ` +
            "Each category has a short general label in English, as a researcher would chart it: 'Interview' for 'Semi-structured interview' and 'Interviews'. " +
            "Keep different kinds of thing apart; use 'Other' only for answers that fit no category. Every answer goes in exactly one category, copied exactly. " +
            'Return JSON only: {"groups":[{"label","members":[answers]}]}.',
        },
        { role: "user", content: JSON.stringify({ question, fact: plan.field, answers: [...counts.values()].map((entry) => `${entry.name} (${entry.papers})`) }) },
      ],
      0,
      model,
      "CHAT_CHART_EXTRACT",
      { maxTokens: 4_000, reasoningEffort: "low", jsonObject: true, timeoutMs: 45_000 }
    );
    const parsed = z
      .object({ groups: z.array(z.object({ label: z.unknown(), members: z.array(z.unknown()) })) })
      .safeParse(jsonObjectIn(result?.content ?? ""));
    if (parsed.success) {
      groups = new Map();
      for (const group of parsed.data.groups.slice(0, MAX_GROUPS + 1)) {
        const label = clean(group.label, 60);
        if (!label) continue;
        for (const member of group.members) {
          // The model may keep the paper count it was shown: "Interview (4)".
          const key = clean(member, 80).replace(/\s*\(\d+\)$/, "").toLowerCase();
          if (counts.has(key) && !groups.has(key)) groups.set(key, label);
        }
      }
    }
  } catch (error) {
    console.warn("chat_chart_group_failed", { message: error instanceof Error ? error.message : "unknown_error" });
  }
  if (!groups || groups.size === 0) return;
  for (const value of found) {
    const grouped = [...new Set(value.values.map((name) => groups!.get(name.toLowerCase()) ?? name))];
    value.named = value.values;
    value.values = grouped;
  }
}

// ---------------------------------------------------------------------------
// The chart and its reply, computed.

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function shortTitle(title: string, max = 60): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function capitalised(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Bar labels that are told apart: the same short title twice gets its year, then a number. */
function distinctLabels(papers: ChartPaper[]): string[] {
  const seen = new Map<string, number>();
  return papers.map((paper) => {
    let label = shortTitle(paper.title, 48);
    if (papers.filter((other) => shortTitle(other.title, 48) === label).length > 1) label = `${label} (${paper.year || "n.d."})`;
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return count > 1 ? `${label} #${count}` : label;
  });
}

function readingLimitations(reading: ValueReading, field: string): string[] {
  const out: string[] = [];
  if (reading.notStated.length > 0) {
    const names = reading.notStated.slice(0, 4).map((paper) => `“${shortTitle(paper.title, 50)}”`);
    const more = reading.notStated.length - names.length;
    out.push(
      `${plural(reading.notStated.length, "paper")} ${reading.notStated.length === 1 ? "does" : "do"} not state ${field} in the text read: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}.` +
        (reading.readInPart > 0 ? " Long papers were read in part, so it may be stated where they were not read; a higher effort reads more of each." : "")
    );
  }
  if (reading.unverified.length > 0) {
    out.push(`${plural(reading.unverified.length, "value")} could not be found word for word in ${reading.unverified.length === 1 ? "its paper" : "their papers"} and ${reading.unverified.length === 1 ? "was" : "were"} left out.`);
  }
  if (reading.failed.length > 0) out.push(`${plural(reading.failed.length, "paper")} could not be read just now and ${reading.failed.length === 1 ? "is" : "are"} not in the chart.`);
  if (reading.skipped > 0) out.push(`This effort reads the first ${reading.found.length + reading.notStated.length + reading.unverified.length + reading.failed.length} papers in scope; ${plural(reading.skipped, "paper")} ${reading.skipped === 1 ? "was" : "were"} not read. A higher effort reads more.`);
  return out;
}

function sourceOf(value: ReportedValue, plan: ReadPlan): ChartSource {
  // A grouped answer shows the paper's own words; its bar shows the group.
  const shown = value.number !== null ? `${formatNumber(value.number)}${plan.unit ? ` ${plan.unit}` : ""}` : (value.named ?? value.values).join(", ");
  return { paperId: value.paper.paperId, title: value.paper.title, year: value.paper.year, value: shown, quote: value.quote, ...(value.note ? { note: value.note } : {}) };
}

/** The chart and reply for one value per paper. */
export function valueChart(reading: ValueReading, plan: ReadPlan): ReadChart {
  const read = reading.found.length + reading.notStated.length + reading.unverified.length;
  const limitations = readingLimitations(reading, plan.field);
  const title = plan.title || capitalised(plan.field);
  if (reading.found.length === 0) {
    return {
      lead: read === 0
        ? `None of the papers could be read for ${plan.field} just now. Try again in a moment.`
        : `None of the ${plural(read, "paper")} read states ${plan.field} in a way that could be checked against its text, so there is nothing to chart.`,
      chart: null,
      sources: [],
      limitations: limitations.filter((line) => !/do(?:es)? not state/.test(line)),
      citedPaperIds: [],
    };
  }
  const sources = reading.found.map((value) => sourceOf(value, plan));
  const citedPaperIds = reading.found.map((value) => value.paper.paperId);
  const stating = `**${reading.found.length} of ${read} papers** state ${plan.field}.`;

  if (plan.valueType === "category") {
    const counts = new Map<string, { label: string; papers: Set<string> }>();
    for (const value of reading.found) {
      for (const name of value.values) {
        const key = name.toLowerCase();
        const entry = counts.get(key) ?? { label: name, papers: new Set<string>() };
        entry.papers.add(value.paper.paperId);
        counts.set(key, entry);
      }
    }
    const ranked = [...counts.values()].sort((a, b) => b.papers.size - a.papers.size || a.label.localeCompare(b.label));
    const shown = ranked.slice(0, 15);
    const [first, second, third] = ranked;
    const rest = [second, third].filter(Boolean).map((entry) => `${entry.label} (${entry.papers.size})`);
    const lead =
      first.papers.size === 1
        ? `${stating} Each answer comes from one paper only: ${ranked.slice(0, 5).map((entry) => entry.label).join(", ")}${ranked.length > 5 ? ` and ${ranked.length - 5} more` : ""}.`
        : `${stating} **${first.label}** is the most common (${plural(first.papers.size, "paper")})${rest.length ? `, then ${rest.join(" and ")}` : ""}.`;
    if (ranked.length > shown.length) limitations.push(`The chart shows the ${shown.length} most common of ${ranked.length} answers; the rest appear in one paper each.`);
    return {
      lead,
      chart: {
        chartType: plan.chart === "pie" || plan.chart === "table" ? plan.chart : "bar",
        title,
        yKeys: ["Papers"],
        data: shown.map((entry) => ({ label: entry.label, Papers: entry.papers.size })),
      },
      sources,
      limitations,
      citedPaperIds,
    };
  }

  const numbers = reading.found.map((value) => value.number as number);
  const unit = plan.unit ? ` ${plan.unit}` : "";
  const valueKey = capitalised(plan.unit || "value");
  if (plan.groupBy === "year") {
    const byYear = new Map<string, number[]>();
    for (const value of reading.found) {
      if (!/^\d{4}$/.test(value.paper.year)) continue;
      byYear.set(value.paper.year, [...(byYear.get(value.paper.year) ?? []), value.number as number]);
    }
    const years = [...byYear.keys()].sort();
    if (years.length >= 2) {
      const key = `Median ${plan.unit || "value"}`;
      const dated = years.reduce((sum, year) => sum + byYear.get(year)!.length, 0);
      const undated = reading.found.length - dated;
      if (undated > 0) limitations.push(`${plural(undated, "paper")} without a year ${undated === 1 ? "is" : "are"} left out of the chart.`);
      // Earlier papers against later ones, cut at the year that halves them most
      // evenly: one year's median is often one study.
      let cut = 0;
      let before = 0;
      let best = Infinity;
      for (let index = 0, running = 0; index < years.length - 1; index += 1) {
        running += byYear.get(years[index])!.length;
        if (Math.abs(running - dated / 2) < best) {
          best = Math.abs(running - dated / 2);
          cut = index;
          before = running;
        }
      }
      const earlier = years.slice(0, cut + 1).flatMap((year) => byYear.get(year)!);
      const later = years.slice(cut + 1).flatMap((year) => byYear.get(year)!);
      const span = (from: string, to: string) => (from === to ? from : `${from}–${to}`);
      return {
        lead:
          `${stating} Papers from ${span(years[0], years[cut])} (${before}) have a median of **${formatNumber(median(earlier))}**${unit}; ` +
          `papers from ${span(years[cut + 1], years[years.length - 1])} (${dated - before}), **${formatNumber(median(later))}**${unit}.` +
          (dated < 12 ? " With this few papers, one study moves a median." : ""),
        chart: {
          chartType: plan.chart === "bar" || plan.chart === "table" ? plan.chart : "line",
          title,
          yKeys: [key],
          data: years.map((year) => ({ label: year, [key]: median(byYear.get(year)!) })),
        },
        sources,
        limitations,
        citedPaperIds,
      };
    }
  }
  const order = [...reading.found].sort((a, b) => (b.number as number) - (a.number as number));
  const labels = distinctLabels(order.map((value) => value.paper));
  const highest = order[0];
  const lowest = order[order.length - 1];
  const lead =
    order.length === 1
      ? `Only **one of ${read} papers** states ${plan.field}: **${formatNumber(highest.number as number)}**${unit} in “${shortTitle(highest.paper.title)}”.`
      : `${stating} It ranges from **${formatNumber(lowest.number as number)}**${unit} in “${shortTitle(lowest.paper.title)}” to **${formatNumber(highest.number as number)}**${unit} in “${shortTitle(highest.paper.title)}”, with a median of **${formatNumber(median(numbers))}**${unit}.`;
  return {
    lead,
    chart: {
      chartType: plan.chart === "table" ? "table" : "bar",
      title,
      yKeys: [valueKey],
      data: order.map((value, index) => ({ label: labels[index], [valueKey]: value.number as number })),
    },
    sources,
    limitations,
    citedPaperIds,
  };
}

// ---------------------------------------------------------------------------
// A paper's own figures.

/** Papers whose own figures one chart reads. */
export const FIGURE_PAPERS = 3;
const FIGURE_READING = 150_000;

const FigureRowSchema = z.object({
  paperId: z.coerce.string(),
  label: z.unknown(),
  values: z.array(z.unknown()),
  quote: z.string().nullish(),
});
const FigureSchema = z.object({ series: z.array(z.unknown()).nullish(), rows: z.array(z.unknown()) });

/** Reads the figures a request asks for from one to three papers' tables and results, keeping rows whose every number is printed in the paper. */
export async function readFigures(input: {
  papers: ChartPaper[];
  plan: ReadPlan;
  question: string;
  effort: ChatEffort;
  model?: string;
  complete?: Complete;
}): Promise<ReadChart> {
  const complete = input.complete ?? createChatCompletionResult;
  const papers = input.papers.slice(0, FIGURE_PAPERS);
  const plan = input.plan;
  const readings = readPapers(papers, [plan.field, ...plan.series, ...plan.search, input.question], FIGURE_READING);
  const system = [
    "You copy figures from academic papers' tables and results into a chart.",
    `The figures: ${plan.field}.${plan.series.length ? ` Suggested series: ${plan.series.join(", ")}.` : ""}`,
    'Return JSON only: {"series":[up to 4 short names],"rows":[{"paperId","label","values":[one number or null per series, in order],"quote":"the sentence or table row the numbers are printed in, copied word for word"}]}, at most 24 rows.',
    "When the request does not say which figures, take the paper's main quantitative result: the table or figures that answer its research question, such as scores by group or time point.",
    "Use the paper's own row labels: a group, a test, a time point, an item. Every number must be printed in the paper exactly as you give it; never compute, round or convert one. Return no rows only when the paper prints no such figures at all.",
  ].join(" ");
  let parsed: z.infer<typeof FigureSchema> | null = null;
  try {
    const result = await complete(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            papers: papers.map((paper, index) => ({ paperId: paper.paperId, title: paper.title, year: paper.year, text: readings[index].text })),
          }),
        },
      ],
      0,
      input.model,
      "CHAT_CHART_EXTRACT",
      { maxTokens: 6_000, reasoningEffort: input.effort === "high" ? "medium" : "low", jsonObject: true, timeoutMs: 90_000 }
    );
    const checked = FigureSchema.safeParse(jsonObjectIn(result?.content?.trim() ?? ""));
    if (checked.success) parsed = checked.data;
    else console.warn("chat_chart_figures_unparsed", { issues: checked.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}:${issue.code}`) });
  } catch (error) {
    console.warn("chat_chart_figures_failed", { message: error instanceof Error ? error.message : "unknown_error" });
  }
  const names = papers.map((paper) => `“${shortTitle(paper.title)}”`).join(" and ");
  if (!parsed) {
    return { lead: `The figures in ${names} could not be read just now. Try again in a moment.`, chart: null, sources: [], limitations: [], citedPaperIds: [] };
  }
  const series = [...new Set((parsed.series ?? []).map((name) => clean(name, 40)).filter(Boolean))].slice(0, 4);
  const keys = series.length > 0 ? series : [capitalised(plan.unit || "value")];
  const byId = new Map(papers.map((paper) => [paper.paperId, paper]));
  const texts = new Map(papers.map((paper) => [paper.paperId, checkable(paperText(paper))]));
  const data: Array<Record<string, string | number>> = [];
  const sources: ChartSource[] = [];
  let dropped = 0;
  for (const item of parsed.rows.slice(0, 24)) {
    const checked = FigureRowSchema.safeParse(item);
    if (!checked.success) continue;
    const row = checked.data;
    const paper = byId.get(row.paperId);
    const text = texts.get(row.paperId);
    const label = clean(row.label, 60);
    if (!paper || !text || !label) continue;
    const values = keys.map((_, index) => toNumber(row.values[index]));
    if (values.every((value) => value === null) || values.some((value) => value !== null && !numberInPaper(value, text))) {
      dropped += 1;
      continue;
    }
    const shownLabel = papers.length > 1 ? `${label} (${shortTitle(paper.title, 24)})` : label;
    const entry: Record<string, string | number> = { label: shownLabel };
    keys.forEach((key, index) => {
      if (values[index] !== null) entry[key] = values[index] as number;
    });
    data.push(entry);
    const quote = clean(row.quote, 400);
    sources.push({
      paperId: paper.paperId,
      title: paper.title,
      year: paper.year,
      value: `${shownLabel}: ${keys.map((key, index) => (values[index] === null ? null : `${key} ${formatNumber(values[index] as number)}`)).filter(Boolean).join(", ")}`,
      quote: quote && quoteInText(quote, text) ? quote : "",
    });
  }
  const limitations = dropped > 0 ? [`${plural(dropped, "row")} ${dropped === 1 ? "was" : "were"} left out because a number in ${dropped === 1 ? "it" : "them"} is not printed in the paper.`] : [];
  if (input.papers.length > papers.length) limitations.push(`Figures are read from at most ${FIGURE_PAPERS} papers at a time; ${plural(input.papers.length - papers.length, "paper")} ${input.papers.length - papers.length === 1 ? "was" : "were"} not read.`);
  if (data.length === 0) {
    // Tables printed as images reach the text without their numbers (the test repository's dynamic assessment paper).
    return {
      lead: `I could not find ${plan.field} in the text of ${names}. A table printed as an image is not read as text, so its numbers may be missing from what could be read.`,
      chart: null,
      sources: [],
      limitations,
      citedPaperIds: [],
    };
  }
  // The first series is what the figures measure; a second is often its spread (SD), whose highest value says little.
  const highlights = keys.slice(0, 1).flatMap((key) => {
    const rows = data.filter((row) => typeof row[key] === "number");
    if (rows.length < 2) return [];
    const top = rows.reduce((best, row) => ((row[key] as number) > (best[key] as number) ? row : best));
    return [`the highest ${key} is **${formatNumber(top[key] as number)}** (${top.label})`];
  });
  return {
    lead: `${capitalised(plan.field)}, as ${names} ${papers.length === 1 ? "prints them" : "print them"}: ${plural(data.length, "row")}${highlights.length ? `; ${highlights[0]}` : ""}.`,
    chart: { chartType: plan.chart === "pie" ? "bar" : plan.chart, title: plan.title || capitalised(plan.field), yKeys: keys, data },
    sources,
    limitations,
    citedPaperIds: [...new Set(sources.map((source) => source.paperId))],
  };
}
