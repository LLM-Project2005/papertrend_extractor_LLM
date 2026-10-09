/*
 * Thinking effort (2026-10-10): one slider from Low to Max in place of the
 * Standard / Deep switch, and Max's thinking shown as a line in the
 * conversation rather than a research card.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { EFFORT_SETTINGS, STEP_BUDGETS } from "../src/lib/repository-chat";
import { CHAT_EFFORTS, normalizeEffort } from "../src/lib/chat-effort";
import { EFFORT_LEVELS, isEffortLevel } from "../src/components/chat/ThinkingEffort";
import { thinkingDuration, thinkingIsRunning, thinkingNow, thoughtLine } from "../src/components/chat/ThinkingTrace";
import type { DeepResearchSessionRecord } from "../src/types/research";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("medium is the answer as it was; low does less and high more", () => {
  assert.deepEqual(CHAT_EFFORTS, ["low", "medium", "high"]);
  assert.equal(normalizeEffort(undefined), "medium");
  assert.equal(normalizeEffort("max"), "medium", "Max is the research engine, not an answer setting");
  const { low, medium, high } = EFFORT_SETTINGS;
  // The settings before efforts existed, kept for Medium.
  assert.deepEqual([medium.focusedSources, medium.rerank, medium.candidates], [10, 24, 48]);
  assert.equal(medium.synthesis, STEP_BUDGETS.synthesis);
  assert.equal(medium.widenSearch, true);
  assert.equal(medium.alwaysAudit, false);
  for (const key of ["focusedSources", "rerank", "candidates"] as const) {
    assert.ok(low[key] < medium[key] && medium[key] < high[key], key);
  }
  assert.equal(low.widenSearch, false, "Low does not search a second time");
  assert.equal(low.synthesis.reasoningEffort, "low");
  assert.equal(high.synthesis.reasoningEffort, "high");
  assert.ok(high.synthesis.maxTokens > medium.synthesis.maxTokens, "room for the longer reasoning, which counts against max_tokens");
  assert.equal(high.alwaysAudit, true, "High checks every answer's claims");
});

test("the effort reaches the answer, its cache key and a queued job", () => {
  const chat = source("../src/lib/repository-chat.ts");
  assert.match(chat, /`effort:\$\{normalizeEffort\(input\.effort\)\}`/, "an answer at one effort is not served for another");
  assert.match(chat, /const canExpand = EFFORT_SETTINGS\[effort\]\.widenSearch && expansionIsPossible/);
  assert.match(chat, /if \(skipBlocker === null && !EFFORT_SETTINGS\[effort\]\.alwaysAudit\)/);
  assert.match(source("../src/app/api/chat/route.ts"), /effort: z\.enum\(CHAT_EFFORTS\)\.optional\(\)/);
  assert.match(source("../src/lib/repository-chat-jobs.ts"), /effort: input\.effort \?\? "medium"/);
  assert.match(source("../src/app/api/chat/jobs/process/route.ts"), /effort: normalizeEffort\(plan\.effort\)/);
});

test("the slider runs Low, Medium, High, Max, and conversations mix them", () => {
  assert.deepEqual(EFFORT_LEVELS.map((level) => level.value), ["low", "medium", "high", "max"]);
  assert.ok(EFFORT_LEVELS.every((level) => level.hint.length > 20), "each level says what it does");
  assert.equal(isEffortLevel("max"), true);
  assert.equal(isEffortLevel("deep"), false);
  const client = source("../src/components/chat/ChatClient.tsx");
  assert.doesNotMatch(client, /role="radiogroup"\s+aria-label="Thinking effort"/, "the Standard / Deep switch is gone");
  assert.doesNotMatch(client, /\{!chartModeEnabled \? \(\s*<div\s+role="radiogroup"/, "no longer hidden in Chart mode");
  assert.match(client, /<ThinkingEffort\s+value=\{effort\}/);
  // A question continues its conversation whatever effort asked the last one.
  assert.doesNotMatch(client, /threadId: activeThread\?\.mode === "normal" \? activeThread\.id : undefined/);
  assert.doesNotMatch(client, /threadId: activeThread\?\.mode === "deep_research" \? activeThread\.id : undefined/);
  assert.equal(client.match(/effort: requestEffort,/g)?.length, 3, "every ordinary question sends its effort");
});

function session(overrides: Partial<DeepResearchSessionRecord>): DeepResearchSessionRecord {
  return { id: "s1", thread_id: "t1", status: "processing", prompt: "q", requires_analysis: false, pending_run_count: 0, steps: [], ...overrides };
}

test("Max thinks in a line: what it is doing now, and how long it took", () => {
  assert.equal(thinkingDuration(4_200), "4s");
  assert.equal(thinkingDuration(80_000), "1m 20s");
  assert.equal(thinkingIsRunning(session({ status: "processing" })), true);
  assert.equal(thinkingIsRunning(session({ status: "completed" })), false);
  assert.equal(thinkingNow(session({ status: "planned" })), "Working out how to answer");
  assert.equal(
    thinkingNow(session({ steps: [{ id: "a", session_id: "s1", position: 1, title: "Read the papers on feedback", status: "processing" }] })),
    "Read the papers on feedback"
  );
  assert.equal(
    thoughtLine({ durationMs: 42_000, questions: [{}, {}, {}], papersSearched: 7, audit: { checked: 32 }, auditRan: true }),
    "Thought for 42s · 3 parts · 7 papers read · 32 claims checked"
  );
  assert.equal(thoughtLine({ durationMs: 9_000, questions: [{}], papersSearched: 1, auditRan: false }), "Thought for 9s · 1 paper read");
});

test("a Max answer is drawn as an answer, without the research card", () => {
  const client = source("../src/components/chat/ChatClient.tsx");
  assert.match(client, /\{deepSession && researchV2 \? \(\s*thinkingIsRunning\(deepSession\)/, "a v2 run shows its thinking line, not the card");
  assert.match(client, /answerFromEngine\(message\) \? \(\s*<ThoughtSummary/);
  assert.match(client, /\(message\.kind !== "deep_research_report" \|\| answerFromEngine\(message\)\) && isFinishedAnswer\(message\)/, "with the answer's own Copy and Download");
  const writer = source("../src/lib/deep-research/write.ts");
  assert.match(writer, /You answer a researcher's question thoroughly, as a reply in a chat/);
  assert.match(writer, /never call the answer a report/);
});
