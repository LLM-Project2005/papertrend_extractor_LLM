/**
 * Chart mode's planner on the chart question bank (evals/chart-question-bank.json,
 * docs/38): for each request, the plan Chart mode makes - which view of the
 * papers, or what to read from them - checked against the plan it should get.
 *
 * The papers are the synthetic collections the chart tests use
 * (tests/support/chart-corpora.ts), so no repository is read and the run can
 * be repeated anywhere. Each view planned is also run through the engine, to
 * show the chart a reader would get. Every model reply is cached on disk,
 * keyed by its exact request, so a re-run pays only for what changed; live
 * calls stop at BUDGET_USD.
 *
 *   OPENAI_API_KEY=... OPENAI_BASE_URL=https://openrouter.ai/api/v1 BUDGET_USD=0.20 OUT=plans.json \
 *   npx tsx scripts/evaluate-chart-planner.ts
 *
 * Optional: IDS (a comma-separated list), CACHE_DIR (default .chart-eval-cache).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildInsightCorpus, type InsightCorpus } from "../src/lib/insights/corpus";
import { askVocabulary, normalizeQuery, runAskQuery } from "../src/lib/insights/ask";
import { MIN_PAPERS } from "../src/lib/insights/stats";
import { planChart, type ChartPlan } from "../src/lib/chart-reading";
import { SHAPES, corpusInput } from "../tests/support/chart-corpora";

interface Expect {
  tool: "build_view" | "read_papers";
  rows?: string[];
  columns?: Array<string | null>;
  measure?: string[];
  focus?: string[];
  about?: boolean;
  answerable?: boolean;
  kind?: string[];
  value_type?: string;
  group_by?: string;
  /** Another plan that is also right. */
  or?: Partial<Expect>;
}

interface Item {
  id: string;
  scope: string;
  category: string;
  prompt: string;
  restated?: string;
  expect: Expect;
}

const SCOPES: Record<string, string> = {
  one: "one paper",
  two: "two papers",
  six: "six papers (the EIL",
  test: "thirty-six",
  thai: "forty papers, Thai",
  big: "1,500 papers",
};

/** A fetch that answers repeated model requests from disk and refuses live ones past the budget (as evaluate-chat-questions.ts). */
function installCache(dir: string, budget: number) {
  mkdirSync(dir, { recursive: true });
  let live = 0;
  let calls = 0;
  let cached = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (!href.includes("/chat/completions")) return original(url, init);
    const body = String(init?.body ?? "");
    const file = join(dir, `${createHash("sha256").update(`${href.replace(/^https?:\/\/[^/]+/, "")}\n${body}`).digest("hex")}.json`);
    calls += 1;
    if (existsSync(file)) {
      cached += 1;
      return new Response(readFileSync(file, "utf-8"), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (live >= budget) throw new Error(`budget ${budget} reached at ${live.toFixed(4)}`);
    const response = await original(url, init);
    const text = await response.text();
    if (response.ok) {
      try {
        const parsed = JSON.parse(text);
        if (parsed?.choices) writeFileSync(file, text);
        live += Number(parsed?.usage?.cost ?? 0);
      } catch {
        /* passed through */
      }
    }
    return new Response(text, { status: response.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { live: () => live, calls: () => calls, cached: () => cached };
}

function corpusFor(scope: string): InsightCorpus {
  const shape = SHAPES.find((entry) => entry.name.startsWith(SCOPES[scope] ?? scope));
  if (!shape) throw new Error(`unknown scope ${scope}`);
  const { input, profiles } = corpusInput(shape);
  return buildInsightCorpus(input, profiles);
}

/** What is wrong with a plan, against what was expected; empty when it is right. */
export function judge(plan: ChartPlan | null, expect: Expect): string[] {
  if (!plan) return ["no plan"];
  const wrong: string[] = [];
  if (plan.tool !== expect.tool) return [`${plan.tool} instead of ${expect.tool}`];
  if (plan.tool === "build_view") {
    // Judged as the engine runs it (normalizeQuery): a grid of one column is a narrowing.
    const query = normalizeQuery(plan.query);
    if (expect.answerable === false) return query.answerable ? ["answered what it should decline"] : [];
    if (!query.answerable) return [`declined: ${query.reason ?? ""}`];
    if (expect.rows && !expect.rows.includes(query.rows)) wrong.push(`rows ${query.rows}`);
    if (expect.columns && !expect.columns.includes(query.columns ?? null)) wrong.push(`columns ${query.columns ?? "none"}`);
    if (expect.measure && !expect.measure.includes(query.measure)) wrong.push(`measure ${query.measure}`);
    if (expect.focus && !(query.focus && expect.focus.includes(query.focus.dimension))) wrong.push(`focus ${query.focus?.dimension ?? "none"}`);
    if (expect.about && !query.about?.length) wrong.push("the value asked about is missing");
  } else {
    const read = plan.read;
    if (expect.kind && !expect.kind.includes(read.kind)) wrong.push(`kind ${read.kind}`);
    if (expect.value_type && read.kind === "values" && read.valueType !== expect.value_type) wrong.push(`value type ${read.valueType}`);
    if (expect.group_by && read.groupBy !== expect.group_by) wrong.push(`group by ${read.groupBy}`);
    if (expect.about && !read.about) wrong.push("no subset named");
  }
  return wrong;
}

async function main() {
  const budget = Number(process.env.BUDGET_USD ?? "0");
  if (!(budget > 0) || !process.env.OUT || !process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY, BUDGET_USD and OUT are required.");
  const cache = installCache(process.env.CACHE_DIR ?? ".chart-eval-cache", budget);
  const bank = JSON.parse(readFileSync("evals/chart-question-bank.json", "utf-8")) as { items: Item[] };
  const wanted = new Set((process.env.IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  const items = bank.items.filter((item) => wanted.size === 0 || wanted.has(item.id));
  const corpora = new Map<string, InsightCorpus>();
  const results: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (cache.live() >= budget) {
      results.push({ id: item.id, skipped: "budget" });
      continue;
    }
    const corpus = corpora.get(item.scope) ?? corpusFor(item.scope);
    corpora.set(item.scope, corpus);
    const question = item.restated ? `${item.prompt}\n(Restated with the conversation: ${item.restated})` : item.prompt;
    const started = Date.now();
    const plan = await planChart({
      question,
      scopeLabel: `the ${corpus.papers.length === 1 ? "paper" : `${corpus.papers.length} papers`} selected`,
      papers: corpus.papers.map((paper) => ({ title: paper.title, year: paper.year === null ? "" : String(paper.year) })),
      vocabulary: corpus.papers.length >= MIN_PAPERS ? askVocabulary(corpus) : null,
    });
    let wrong = judge(plan, item.expect);
    if (wrong.length && item.expect.or) {
      const alternative = judge(plan, { ...item.expect, ...item.expect.or } as Expect);
      if (alternative.length === 0) wrong = [];
    }
    // The chart a reader would get from a planned view.
    let chart: Record<string, unknown> | undefined;
    if (plan?.tool === "build_view") {
      const answer = runAskQuery(corpus, plan.query);
      chart = "insight" in answer ? { kind: answer.insight.chart.kind, title: answer.insight.question, takeaway: answer.insight.takeaway } : { unanswerable: answer.unanswerable };
    }
    results.push({ id: item.id, category: item.category, prompt: item.prompt, ok: wrong.length === 0, wrong, plan, chart, ms: Date.now() - started });
    process.stdout.write(`${item.id} ${wrong.length === 0 ? "ok" : `WRONG ${wrong.join("; ")}`}\n`);
  }
  const passed = results.filter((result) => result.ok).length;
  writeFileSync(process.env.OUT, JSON.stringify({ passed, total: results.length, liveUsd: cache.live(), calls: cache.calls(), cached: cache.cached(), results }, null, 1));
  console.log(`${passed}/${results.length} plans right; live spend $${cache.live().toFixed(4)} (${cache.calls() - cache.cached()} live calls, ${cache.cached()} cached)`);
}

if (process.argv[1]?.includes("evaluate-chart-planner")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
