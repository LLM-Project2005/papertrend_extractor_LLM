/*
 * GPT-6.1 Sol beside GPT-6 Luna (2026-10-22): the allowance counts each
 * model's tokens at its price over Luna's, a Sol request is checked against
 * what is left before it starts, Max with Sol has Luna read and Sol write,
 * the meter says what is left, and the site's month is watched at 80%.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LUNA_MODEL, SOL_MODEL, allowanceUnits, usageMultiplier, usageWeights } from "../src/lib/model-prices";
import {
  CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  allowanceRefusal,
  chatModelDescription,
  requestsLeft,
  resolveChatModel,
  typicalUsage,
} from "../src/lib/chat-models";
import { recordAiTokenUsage, withAiTokenUsageTracking } from "../src/lib/ai-token-usage";
import { costOfCall } from "../src/lib/answer-cost";
import { monthlyBudgetState, monthlyBudgetUsd, noteMonthlyBudget, resetSpendCache, utcMonthStart } from "../src/lib/spend-limits";
import { sessionWriterModel } from "../src/lib/deep-research/types";

void React;

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* ------------------------------------------------ the price table and the allowance */

test("Sol counts twenty Luna tokens for input, output and cache writes, and ten for cached input", () => {
  assert.deepEqual(usageWeights(LUNA_MODEL), { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 });
  assert.deepEqual(usageWeights(SOL_MODEL), { input: 20, output: 20, cacheRead: 10, cacheWrite: 20 });
  assert.deepEqual(usageWeights("openai/gpt-6.1-sol"), usageWeights(SOL_MODEL), "the undated name too");
  assert.equal(usageMultiplier(SOL_MODEL), 20);
  assert.equal(usageMultiplier(LUNA_MODEL), 1);
  // A model with no cache price is charged plain input for cached tokens.
  assert.equal(usageWeights("google/gemini-3.7-flash").cacheRead, usageWeights("google/gemini-3.7-flash").input);
  // An unknown model counts as an expensive one, never as a cheap one.
  assert.ok(usageWeights("vendor/unknown-model").input >= 20);
});

test("Luna's allowance is counted exactly as before; Sol's by kind of token", () => {
  const luna = { model: LUNA_MODEL, promptTokens: 55_000, completionTokens: 1_200, cachedTokens: 54_000 };
  assert.equal(allowanceUnits([luna]), 56_200, "Luna: prompt plus completion, cached or not");
  // 1,000 plain x20 + 54,000 cached x10 + 1,200 out x20.
  assert.equal(allowanceUnits([{ ...luna, model: SOL_MODEL }]), 20_000 + 540_000 + 24_000);
  // 5,000 written to the cache x20 + 2,000 plain x20 + 300 out x20.
  assert.equal(allowanceUnits([{ model: SOL_MODEL, promptTokens: 7_000, completionTokens: 300, cacheWriteTokens: 5_000 }]), 146_000);
  // Without the provider's cache split every prompt token is plain input: twenty, never less than it cost.
  assert.equal(allowanceUnits([{ model: SOL_MODEL, promptTokens: 55_000, completionTokens: 1_200 }]), 1_124_000);
  // Several models in one answer add up.
  assert.equal(allowanceUnits([luna, { model: SOL_MODEL, promptTokens: 100, completionTokens: 0 }]), 56_200 + 2_000);
});

test("a call's cache split is recorded from the provider's usage, and only when it gave one", async () => {
  await withAiTokenUsageTracking(async (usage) => {
    recordAiTokenUsage({ prompt_tokens: 56_050, completion_tokens: 1_359, prompt_tokens_details: { cached_tokens: 54_405, cache_write_tokens: 0 }, cost: 0.0139 }, SOL_MODEL);
    recordAiTokenUsage({ prompt_tokens: 55_093, completion_tokens: 1_188, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 54_405 } }, SOL_MODEL);
    recordAiTokenUsage({ prompt_tokens: 1_202, completion_tokens: 293 }, LUNA_MODEL);
    assert.deepEqual(usage.byModel, [
      { model: SOL_MODEL, promptTokens: 111_143, completionTokens: 2_547, cachedTokens: 54_405, cacheWriteTokens: 54_405 },
      { model: LUNA_MODEL, promptTokens: 1_202, completionTokens: 293 },
    ]);
  });
});

test("the dollar estimate reads the same table", () => {
  assert.equal(costOfCall(SOL_MODEL, 1_000_000, 100_000), 3);
  assert.equal(costOfCall(LUNA_MODEL, 1_000_000, 100_000), 0.15);
});

test("a spend row's units are the weighted allowance, from the model of every call", () => {
  const guards = read("src/lib/security-guards.ts");
  assert.match(guards, /const units = Math\.max\(1, usage\.byModel\?\.length \? allowanceUnits\(usage\.byModel\) : usage\.totalTokens\);/);
  assert.match(read("src/lib/spend-limits.ts"), /\.\.\.\(cached > 0 \? \{ cached_tokens: cached \} : \{\}\)/);
});

/* ------------------------------------------------ the models a reader can choose */

test("a request may name Luna or Sol; anything else is answered by Luna", () => {
  assert.deepEqual(CHAT_MODELS.map((model) => model.value), [LUNA_MODEL, SOL_MODEL]);
  assert.equal(DEFAULT_CHAT_MODEL, LUNA_MODEL);
  assert.equal(resolveChatModel(SOL_MODEL), SOL_MODEL);
  for (const named of [undefined, null, "", "openai/gpt-6.1-sol", "openai/gpt-6-astra", "anthropic/some-costly-model"]) {
    assert.equal(resolveChatModel(named), LUNA_MODEL, String(named));
  }
  assert.equal(chatModelDescription(LUNA_MODEL), "By OpenAI.");
  assert.equal(chatModelDescription(SOL_MODEL), "By OpenAI. About 20x usage.");
});

test("what a request usually uses: Luna's medians, twenty times for Sol, and Max with Sol writing only", () => {
  assert.equal(typicalUsage(LUNA_MODEL, "medium"), 35_000);
  assert.equal(typicalUsage(SOL_MODEL, "medium"), 700_000);
  assert.equal(typicalUsage(SOL_MODEL, "high"), 1_900_000);
  assert.equal(typicalUsage(LUNA_MODEL, "max"), 200_000);
  assert.equal(typicalUsage(SOL_MODEL, "max"), 200_000 + 17_500 * 19, "Luna reads, Sol writes");
  assert.equal(requestsLeft(LUNA_MODEL, "medium", 1_000_000), 28);
  assert.equal(requestsLeft(SOL_MODEL, "medium", 1_000_000), 1);
  assert.equal(requestsLeft(SOL_MODEL, "medium", 600_000), 0);
});

test("a Sol request that what is left will not cover is refused before it starts, and says why", () => {
  const day = { limit: 1_000_000, exempt: false };
  assert.equal(allowanceRefusal({ ...day, model: LUNA_MODEL, kind: "high", used: 999_000 }), null, "Luna keeps the old rule");
  assert.equal(allowanceRefusal({ ...day, model: SOL_MODEL, kind: "medium", used: 0 }), null);
  assert.equal(allowanceRefusal({ ...day, model: SOL_MODEL, kind: "medium", used: 0, exempt: true }), null, "admins are not limited");
  const short = allowanceRefusal({ ...day, model: SOL_MODEL, kind: "medium", used: 600_000 });
  assert.match(short ?? "", /^An answer at Medium with GPT-6\.1 Sol usually uses about 70% of a day's AI allowance \(GPT-6\.1 Sol counts about 20 times GPT-6 Luna\), and 40% is left today\./);
  assert.match(short ?? "", /Ask with GPT-6 Luna, choose a lower effort, or try again after the allowance resets at midnight UTC \(7:00 in Thailand\)\./);
  const never = allowanceRefusal({ ...day, model: SOL_MODEL, kind: "high", used: 0 });
  assert.match(never ?? "", /^An answer at High with GPT-6\.1 Sol usually uses about 190% of a day's AI allowance .*so it can't fit in one day\. Choose a lower effort, or ask with GPT-6 Luna\.$/);
  assert.match(allowanceRefusal({ ...day, model: SOL_MODEL, kind: "max", used: 700_000 }) ?? "", /^A Max answer written by GPT-6\.1 Sol usually uses about 53%/);
  const chart = allowanceRefusal({ ...day, model: SOL_MODEL, kind: "chart", used: 900_000 }) ?? "";
  assert.match(chart, /^A chart with GPT-6\.1 Sol/);
  assert.doesNotMatch(chart, /lower effort/, "a chart counts the same at any effort");
});

test("review fixes: pins wait only for the account's profile, a refused re-ask gives the answer back, a failed step keeps the paper", () => {
  assert.match(read("src/components/workspace/WorkspaceProvider.tsx"), /setProfileFromAccount\(Boolean\(authProfile\)\);/);
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /const previousMessages = messages;\n\s+setMessages\(nextMessages\);/);
  assert.match(client, /if \(nextError instanceof Error && nextError.name === "AbortError"\) return;\n\s+setMessages\(previousMessages\);/);
  const provider = read("src/components/workspace/PaperViewerProvider.tsx");
  assert.match(provider, /if \(keep\) stepFailureRef\.current = message;\n\s+else \{\n\s+setRun\(null\);/);
  assert.match(provider, /index: current\.index, notice: `That paper could not be opened\. \$\{failure\}`/);
  const drop = read("src/components/workspace/PdfDropTarget.tsx");
  assert.match(drop, /if \(!carriesFiles\(event\.dataTransfer\) \|\| event\.defaultPrevented\) return;\n\s+event\.preventDefault\(\);\n\s+if \(!accepting\(\)\) return;/, "a drop beside a dialog does not open the file");
  assert.match(read("src/components/workspace/workspaces/ProjectIndexClient.tsx"), /limit=500&page=\$\{page\}/);
});

test("the chat checks the allowance before the question is saved, and Max hands the model to its writer", () => {
  const route = read("src/app/api/chat/route.ts");
  const normal = route.slice(route.indexOf("async function normalChat"));
  const check = normal.indexOf("await assertModelAllowance(ownerUserId, selectedModel");
  assert.ok(check > 0 && check < normal.indexOf("chatRepository.createThread"), "before a thread or a message is written");
  assert.match(route, /model: resolveChatModel\(body\.model\),\n\s+threadId: body\.threadId,/);
  assert.doesNotMatch(route, /TOOL_CAPABLE_CHAT_MODELS/);
  const actions = read("src/lib/deep-research/actions.ts");
  assert.match(actions, /model: body\.model && body\.model !== DEFAULT_CHAT_MODEL \? body\.model : null,/);
  assert.match(actions, /await assertModelAllowance\(ownerUserId, sessionWriterModel\(session\) \?\? CHAT_MODEL, "max"\);\n\s+await assertAndRecordAiUsage\(ownerUserId, "deep_research"/, "one Max unit, after the allowance check");
  const run = read("src/lib/deep-research/run.ts");
  assert.match(run, /const record = paper \? await readPaper\(\{ question: readerQuestion, plan, paper, whole: chosen\?\.whole !== false \}\)/, "reading takes no reader model: Luna reads");
  assert.equal(run.match(/^\s+model,$/gm)?.length, 2, "the writer and its corrections take the session's model");
});

test("a run's writer is the model saved with its plan; none is Luna", () => {
  const write = (model: unknown) => ({ steps: [{ tool_name: "dr2_read", input_payload: {} }, { tool_name: "dr2_write", input_payload: { engine: "x", model } }] });
  assert.equal(sessionWriterModel(write(SOL_MODEL)), SOL_MODEL);
  assert.equal(sessionWriterModel(write(null)), null);
  assert.equal(sessionWriterModel(null), null);
});

test("the composer offers both models with what Sol counts, and Max and Ask again carry the choice", () => {
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /const MODEL_OPTIONS = CHAT_MODELS\.map\(\(model\) => \(\{/);
  assert.match(client, /description: chatModelDescription\(model\.value\)/);
  assert.match(client, /action: "plan",\n\s+\/\/ A model dearer than GPT-6 Luna writes the answer; Luna still reads the papers\.\n\s+model: selectedModel,/);
  assert.match(client, /setEffort\("max"\);\n\s+setSelectedModel\(choice\.model\);/);
  assert.match(client, /At Max, GPT-6 Luna reads the papers and \$\{chatModelLabel\(selectedModel\)\} writes the answer\./);
  assert.match(read("src/components/chat/ThinkingEffort.tsx"), /\{note \? <p className="mt-2 px-1 text-xs leading-5 text-body">\{note\}<\/p> : null\}/);
});

test("Ask again lists both models once there are two", async () => {
  const { default: AskAgainMenu } = await import("../src/components/chat/AskAgainMenu");
  const models = CHAT_MODELS.map((model) => ({ value: model.value, label: model.label }));
  const html = renderToStaticMarkup(createElement(AskAgainMenu, { models, model: LUNA_MODEL, onAsk: () => undefined, defaultOpen: true }));
  assert.match(html, />Model</);
  assert.match(html, />GPT-6 Luna</);
  assert.match(html, />GPT-6\.1 Sol</);
});

/* ------------------------------------------------ the meter */

test("the meter says what is left, and about how many answers that is on each model", async () => {
  const { UsagePanel, percentLeft } = await import("../src/components/chat/UsageMeter");
  const usage = {
    exempt: false,
    tokens: { used: 270_000, limit: 1_000_000 },
    messages: { used: 12, limit: 100 },
    deepResearch: { used: 1, limit: 10 },
    webSearches: { used: 0, limit: 40 },
    resetsAt: "2026-10-23T00:00:00.000Z",
  };
  assert.equal(percentLeft(usage.tokens), 73);
  const html = renderToStaticMarkup(createElement(UsagePanel, { usage, resets: "7:00" }));
  assert.match(html, />73% left</);
  assert.match(html, /Counted in GPT-6 Luna tokens: 270,000 of 1,000,000 used\. GPT-6\.1 Sol counts about 20 times as much\./);
  assert.match(html, /20 answers at Medium with GPT-6 Luna/);
  assert.match(html, /1 answer at Medium with GPT-6\.1 Sol/);
  assert.match(html, /88 of 100 left/);
  assert.match(html, /9 of 10 left/);
  assert.doesNotMatch(html, /Whole site this month/, "only admins see the site's month");
  const admin = renderToStaticMarkup(
    createElement(UsagePanel, { usage: { ...usage, exempt: true, account: { monthUsd: 82.5, budgetUsd: 100, share: 0.825 } }, resets: "7:00" })
  );
  assert.match(admin, /Whole site this month/);
  assert.match(admin, /\$82\.50 of \$100/);
  assert.match(admin, /text-amber-700/, "amber from 80%");
  assert.match(admin, /12 used/);
});

/* ------------------------------------------------ the month */

test("the monthly budget: its default, its month, and one warning an hour from 80%", async () => {
  assert.equal(monthlyBudgetUsd({}), 100);
  assert.equal(monthlyBudgetUsd({ AI_MONTHLY_BUDGET_USD: "300" }), 300);
  assert.equal(utcMonthStart(new Date("2026-11-01T06:59:00+07:00")), "2026-10-01T00:00:00.000Z");
  assert.equal(utcMonthStart(new Date("2026-11-01T07:00:00+07:00")), "2026-11-01T00:00:00.000Z");
  assert.deepEqual(monthlyBudgetState(79.994, 100), { monthUsd: 79.99, budgetUsd: 100, share: 0.79994 });

  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (name: unknown) => void warnings.push(String(name));
  try {
    resetSpendCache();
    const saved = process.env.AI_MONTHLY_BUDGET_USD;
    delete process.env.AI_MONTHLY_BUDGET_USD;
    assert.equal((await noteMonthlyBudget(new Date(), async () => 79))?.share, 0.79);
    assert.deepEqual(warnings, [], "under 80%: quiet");
    await noteMonthlyBudget(new Date(), async () => 81);
    await noteMonthlyBudget(new Date(), async () => 85);
    assert.deepEqual(warnings, ["ai_monthly_budget_80"], "once an hour");
    assert.equal(await noteMonthlyBudget(new Date(), async () => { throw new Error("down"); }), null, "an unreadable month refuses nothing");
    if (saved !== undefined) process.env.AI_MONTHLY_BUDGET_USD = saved;
  } finally {
    console.warn = original;
    resetSpendCache();
  }
  const monitoring = readFileSync(new URL("../../scripts/ops/apply_monitoring.py", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(monitoring, /"papertrend_ai_monthly_budget_80"/);
  assert.match(monitoring, /AI spend at 80% of the monthly budget/);
  assert.match(read("src/lib/security-guards.ts"), /if \(!refusal\) \{\n\s+\/\/ The monthly budget is watched here too, where spending starts \(ten-minute cache\)\.\n\s+await noteMonthlyBudget\(\);/);
});
