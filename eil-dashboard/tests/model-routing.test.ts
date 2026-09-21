import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FAST_MODEL,
  fastModelSetting,
  isStructuralTask,
  modelForTask,
} from "../src/lib/model-routing";

const PRIMARY = "openai/gpt-5.6-luna-20260709";

function route(taskName: string | undefined, overrides: Partial<Parameters<typeof modelForTask>[0]> = {}) {
  return modelForTask({
    taskName,
    requestedModel: PRIMARY,
    usesOpenRouter: true,
    fastModel: DEFAULT_FAST_MODEL,
    ...overrides,
  });
}

test("the three JSON-only steps run on the fast model", () => {
  // Measured on the pilot these cost ~3.2s, ~4.2s and ~3.2s of model time and
  // produce nothing a reader ever sees.
  for (const task of ["CHAT_EXECUTION_PLAN", "CHAT_RERANK", "CHAT_EVIDENCE_SUFFICIENCY"]) {
    assert.equal(route(task), DEFAULT_FAST_MODEL, task);
  }
});

test("the plan repair pass follows the plan it repairs", () => {
  assert.equal(route("CHAT_EXECUTION_PLAN_REPAIR"), DEFAULT_FAST_MODEL);
});

test("the two steps a reader sees keep the primary model", () => {
  // Answer quality is measured on these; routing must not touch them.
  assert.equal(route("CHAT_SYNTHESIS"), PRIMARY);
  assert.equal(route("CHAT_FAITHFULNESS"), PRIMARY);
});

test("an unknown or unnamed task is never rerouted", () => {
  assert.equal(route("SOME_OTHER_TASK"), PRIMARY);
  assert.equal(route(undefined), PRIMARY);
});

test("a non-OpenRouter deployment is left alone", () => {
  // The fast model is named in OpenRouter's namespace and means nothing to
  // another provider, so sending it there would break every structural step.
  assert.equal(route("CHAT_RERANK", { usesOpenRouter: false }), PRIMARY);
});

test("routing can be switched off without a code change", () => {
  assert.equal(fastModelSetting("off"), null);
  assert.equal(fastModelSetting("OFF"), null);
  assert.equal(route("CHAT_RERANK", { fastModel: null }), PRIMARY);
});

test("an unset variable still routes, and a set one is honoured", () => {
  assert.equal(fastModelSetting(undefined), DEFAULT_FAST_MODEL);
  assert.equal(fastModelSetting("   "), DEFAULT_FAST_MODEL);
  assert.equal(fastModelSetting("  vendor/other-fast  "), "vendor/other-fast");
});

test("switching routing off with no caller model falls through to the config default", () => {
  assert.equal(
    modelForTask({ taskName: "CHAT_RERANK", requestedModel: "  ", usesOpenRouter: true, fastModel: null }),
    undefined
  );
});

test("structural membership is stated once, not duplicated per call site", () => {
  assert.equal(isStructuralTask("CHAT_RERANK"), true);
  assert.equal(isStructuralTask("CHAT_SYNTHESIS"), false);
  assert.equal(isStructuralTask(undefined), false);
});

test("every structural task name matches a real call site", () => {
  // A renamed task would silently stop routing and quietly cost seconds again.
  const chat = readFileSync(new URL("../src/lib/repository-chat.ts", import.meta.url), "utf8");
  for (const task of ["CHAT_EXECUTION_PLAN", "CHAT_RERANK", "CHAT_EVIDENCE_SUFFICIENCY"]) {
    assert.ok(chat.includes(`"${task}"`), `${task} has no call site`);
  }
});

test("the helper routes rather than passing the caller's model straight through", () => {
  const helper = readFileSync(new URL("../src/lib/openai.ts", import.meta.url), "utf8");
  assert.match(helper, /modelForTask\(\{ taskName, requestedModel: modelOverride, usesOpenRouter \}\)/);
  assert.match(helper, /model: routedModel \|\| config\.model/);
});

test("latency is attributed to the model that served the call", () => {
  const helper = readFileSync(new URL("../src/lib/openai.ts", import.meta.url), "utf8");
  // Without this, a routing change could not be confirmed from the logs.
  assert.match(helper, /recordModelCallLatency\(taskName, performance\.now\(\) - startedAt, "ok", String\(requestBody\.model\)\)/);
});
