/**
 * The chat's question bank (evals/chat-question-bank.json, docs/36), run on a
 * live repository the way the chat route runs a question: runRepositoryChat,
 * answered inline, chat or Chart mode.
 *
 * Every model and embedding reply is cached on disk, keyed by its exact
 * request, so a re-run after a change pays only for the calls the change
 * touched. Live calls stop at BUDGET_USD. PLAN_ONLY=1 runs only the planners
 * (about $0.0003 a question): which step each question goes to, and for a chart
 * what it will read. Each answer is checked for its route, the facts it must
 * state and its language; reading the answers is still the real judgement.
 *
 *   OWNER_USER_ID=... PROJECT_ID=... DATABASE_URL=... OPENAI_API_KEY=... OPENAI_BASE_URL=... \
 *   DATABASE_PROVIDER=cloud-sql BUDGET_USD=0.05 IDS=C01,C02,K04 OUT=results.json \
 *   npx tsx scripts/evaluate-chat-questions.ts
 *
 * Optional: EFFORT (overrides each question's), PLAN_ONLY=1, CACHE_DIR
 * (default .chat-eval-cache), BANK (default evals/chat-question-bank.json).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Item {
  id: string;
  category: string;
  prompt: string;
  effort?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  expect?: { ops?: string[]; facts?: string[]; lang?: "Thai" | "English"; kind?: string; notes?: string };
}

interface Call { cached: boolean; usd: number; firstUsd: number; task: string; ms: number }

const MODEL = process.env.CHAT_EVAL_MODEL ?? "openai/gpt-6-luna-20260922";

/** A fetch that answers repeated model and embedding requests from disk and refuses live ones past the budget. */
function installCache(dir: string, budget: number) {
  mkdirSync(dir, { recursive: true });
  const calls: Call[] = [];
  const live = () => calls.filter((call) => !call.cached).reduce((sum, call) => sum + call.usd, 0);
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (!href.includes("/chat/completions") && !href.includes("/embeddings")) return original(url, init);
    const body = String(init?.body ?? "");
    const path = href.replace(/^https?:\/\/[^/]+/, "");
    const file = join(dir, `${createHash("sha256").update(`${path}\n${body}`).digest("hex")}.json`);
    const task = (() => { try { return String(JSON.parse(body).messages?.[0]?.content ?? "embedding").slice(0, 40); } catch { return "?"; } })();
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf-8"));
      calls.push({ cached: true, usd: 0, firstUsd: Number(saved.body?.usage?.cost ?? 0), task, ms: Number(saved.ms ?? 0) });
      return new Response(JSON.stringify(saved.body), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (live() >= budget) throw new Error(`budget ${budget} reached at ${live().toFixed(4)}`);
    const started = Date.now();
    const response = await original(url, init);
    const text = await response.text();
    if (response.ok) {
      try {
        const parsed = JSON.parse(text);
        if (parsed?.choices || parsed?.data) writeFileSync(file, JSON.stringify({ ms: Date.now() - started, body: parsed }));
        const usd = Number(parsed?.usage?.cost ?? 0);
        calls.push({ cached: false, usd, firstUsd: usd, task, ms: Date.now() - started });
      } catch {
        /* not JSON: passed through */
      }
    }
    return new Response(text, { status: response.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, live };
}

/** The automatic checks: the route taken, the facts stated, the language. */
function check(item: Item, operations: string[], answer: string): string[] {
  const flags: string[] = [];
  const expect = item.expect ?? {};
  if (expect.ops?.length && !expect.ops.includes(operations[0] ?? "")) flags.push(`route ${operations.join("+")}`);
  for (const fact of expect.facts ?? []) if (!new RegExp(fact, "i").test(answer)) flags.push(`missing /${fact}/`);
  if (expect.lang) {
    const thai = (answer.match(/[฀-๿]/g) ?? []).length / Math.max(1, (answer.match(/[A-Za-z฀-๿]/g) ?? []).length);
    if (expect.lang === "Thai" ? thai < 0.3 : thai > 0.1) flags.push(`not in ${expect.lang}`);
  }
  if (/could not finish this answer/i.test(answer)) flags.push("fallback");
  return flags;
}

async function main() {
  const owner = process.env.OWNER_USER_ID;
  const project = process.env.PROJECT_ID;
  const budget = Number(process.env.BUDGET_USD ?? "0");
  if (!owner || !project || !(budget > 0) || !process.env.OUT) throw new Error("OWNER_USER_ID, PROJECT_ID, BUDGET_USD and OUT are required.");
  const cache = installCache(process.env.CACHE_DIR ?? ".chat-eval-cache", budget);
  const bank = JSON.parse(readFileSync(process.env.BANK ?? "evals/chat-question-bank.json", "utf-8")) as { chat: Item[]; chart: Item[]; bench?: Item[] };
  const items = new Map<string, Item & { mode: "chat" | "chart" }>([
    ...[...bank.chat, ...(bank.bench ?? [])].map((item) => [item.id, { ...item, mode: "chat" as const }] as const),
    ...bank.chart.map((item) => [item.id, { ...item, mode: "chart" as const }] as const),
  ]);
  const chat = await import("../src/lib/repository-chat");
  const planOnly = process.env.PLAN_ONLY === "1";
  const results: Array<Record<string, unknown>> = [];
  const save = () => writeFileSync(process.env.OUT!, JSON.stringify({ planOnly, liveUsd: cache.live(), results }, null, 1));
  let context: Awaited<ReturnType<typeof chat.loadRepositoryContext>> | null = null;
  for (const id of (process.env.IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
    const item = items.get(id);
    if (!item) { results.push({ id, error: "unknown id" }); continue; }
    if (cache.live() >= budget) { results.push({ id, skipped: `budget reached at ${cache.live().toFixed(4)}` }); break; }
    const effort = (process.env.EFFORT || item.effort || "medium") as "low" | "medium" | "high";
    const input = {
      ownerUserId: owner, projectId: project, prompt: item.prompt, effort, model: MODEL, bypassAsyncJob: true,
      forceChart: item.mode === "chart", history: [...(item.history ?? []), { role: "user" as const, content: item.prompt }],
    };
    const before = cache.calls.length;
    const started = Date.now();
    try {
      if (planOnly) {
        context ??= await chat.loadRepositoryContext({ ownerUserId: owner, projectId: project, prompt: "plan" });
        const execution = await chat.planRepositoryExecution(input, context);
        const flags = item.expect?.ops?.length && !item.expect.ops.includes(execution.operations[0]) ? [`route ${execution.operations.join("+")}`] : [];
        results.push({ id, category: item.category, operations: execution.operations, refinedQuestion: execution.refinedQuestion, flags });
      } else {
        const result = await chat.runRepositoryChat(input);
        const operations = result.execution?.operations ?? [];
        const mine = cache.calls.slice(before);
        results.push({
          id, mode: item.mode, category: item.category, effort, prompt: item.prompt,
          seconds: Math.round((Date.now() - started) / 100) / 10,
          answerUsd: Math.round(mine.reduce((sum, call) => sum + call.firstUsd, 0) * 1e6) / 1e6,
          liveUsd: Math.round(mine.filter((call) => !call.cached).reduce((sum, call) => sum + call.usd, 0) * 1e6) / 1e6,
          operations,
          flags: check(item, operations, result.answer),
          limitations: result.limitations ?? [],
          citations: result.citations.length,
          charts: result.charts.map((chart) => ({ type: chart.chartType, metric: chart.metric, title: chart.title, rows: Array.isArray(chart.data) ? chart.data.length : 0 })),
          answer: result.answer,
        });
      }
    } catch (error) {
      results.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
    save();
    const last = results[results.length - 1];
    console.log(`${id} ${Array.isArray(last.flags) && last.flags.length ? `FLAGS ${last.flags.join("; ")}` : last.error ? `ERROR ${last.error}` : "ok"} (live $${cache.live().toFixed(4)})`);
  }
  save();
  process.exit(0);
}

void main();
