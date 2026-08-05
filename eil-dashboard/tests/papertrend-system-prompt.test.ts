import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPapertrendSystemPrompt,
  PAPER_TREND_PROMPT_VERSION,
} from "../src/lib/papertrend-system-prompt";

test("prompt contract carries production grounding and isolation invariants", () => {
  const prompt = buildPapertrendSystemPrompt("grounded_answer");
  assert.match(prompt, new RegExp(PAPER_TREND_PROMPT_VERSION.replaceAll(".", "\\.")));
  assert.match(prompt, /untrusted evidence/i);
  assert.match(prompt, /Never expose another user's data/i);
  assert.match(prompt, /complete requests must process every eligible paper/i);
  assert.match(prompt, /Paper titles/i);
  assert.match(prompt, /conversation's language/i);
  assert.match(prompt, /\[Paper <id>\]/);
});

test("task overlays remain narrow and composable", () => {
  const planner = buildPapertrendSystemPrompt("request_director");
  const chart = buildPapertrendSystemPrompt("chart_planner");
  const auditor = buildPapertrendSystemPrompt("faithfulness_auditor");
  assert.match(planner, /semantic request director/i);
  assert.match(planner, /multiple capabilities/i);
  assert.match(planner, /not what the user is allowed to ask/i);
  assert.match(chart, /chart-tool calls/i);
  assert.match(auditor, /Audit every substantive claim/i);
  assert.doesNotMatch(planner, /Translate the research request into supported chart-tool calls/i);
});

test("call-specific additions are appended without changing the core contract", () => {
  const marker = "Return the ExampleSchema object only.";
  const prompt = buildPapertrendSystemPrompt("request_director", [marker]);
  assert.match(prompt, new RegExp(marker.replace(".", "\\.")));
  assert.match(prompt, /Never reinterpret a repository-wide request/i);
});
