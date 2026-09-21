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

test("the two bookkeeping steps run on the fast model", () => {
  // Measured on the pilot these cost ~3.2s each and produce nothing a reader
  // ever sees, nor anything that decides what the answer is grounded in.
  for (const task of ["CHAT_EXECUTION_PLAN", "CHAT_EVIDENCE_SUFFICIENCY"]) {
    assert.equal(route(task), DEFAULT_FAST_MODEL, task);
  }
});

test("reranking stays on the primary model even though it only emits JSON", () => {
  // The regression this encodes: on the 38-paper repository the fast model
  // returned the full source limit of ten papers on 10 of 10 questions, never
  // narrowing the field, while the primary model narrowed to one paper on 5 of
  // 12. A reranker that returns everything is not ranking, and what it waves
  // through becomes the evidence the answer is built from.
  assert.equal(route("CHAT_RERANK"), PRIMARY);
  assert.equal(isStructuralTask("CHAT_RERANK"), false);
});

test("the plan repair pass follows the plan it repairs", () => {
  assert.equal(route("CHAT_EXECUTION_PLAN_REPAIR"), DEFAULT_FAST_MODEL);
});

test("the two steps a reader sees keep the primary model", () => {
  // Answer quality is measured on these; routing must not touch them.
  assert.equal(route("CHAT_SYNTHESIS"), PRIMARY);
  assert.equal(route("CHAT_FAITHFULNESS"), PRIMARY);
});

test("no step that chooses or writes the answer is ever routed", () => {
  // One list, so adding a task to STRUCTURAL_TASKS cannot quietly demote a step
  // that decides what the answer says.
  for (const task of ["CHAT_RERANK", "CHAT_SYNTHESIS", "CHAT_FAITHFULNESS"]) {
    assert.equal(route(task), PRIMARY, task);
  }
});

test("an unknown or unnamed task is never rerouted", () => {
  assert.equal(route("SOME_OTHER_TASK"), PRIMARY);
  assert.equal(route(undefined), PRIMARY);
});

test("a non-OpenRouter deployment is left alone", () => {
  // The fast model is named in OpenRouter's namespace and means nothing to
  // another provider, so sending it there would break every structural step.
  assert.equal(route("CHAT_EVIDENCE_SUFFICIENCY", { usesOpenRouter: false }), PRIMARY);
});

test("switching off is honoured for the steps that do route", () => {
  assert.equal(route("CHAT_EXECUTION_PLAN", { fastModel: null }), PRIMARY);
});

test("routing can be switched off without a code change", () => {
  assert.equal(fastModelSetting("off"), null);
  assert.equal(fastModelSetting("OFF"), null);
  assert.equal(route("CHAT_EVIDENCE_SUFFICIENCY", { fastModel: null }), PRIMARY);
});

test("an unset variable still routes, and a set one is honoured", () => {
  assert.equal(fastModelSetting(undefined), DEFAULT_FAST_MODEL);
  assert.equal(fastModelSetting("   "), DEFAULT_FAST_MODEL);
  assert.equal(fastModelSetting("  vendor/other-fast  "), "vendor/other-fast");
});

test("switching routing off with no caller model falls through to the config default", () => {
  assert.equal(
    modelForTask({ taskName: "CHAT_EXECUTION_PLAN", requestedModel: "  ", usesOpenRouter: true, fastModel: null }),
    undefined
  );
});

test("structural membership is stated once, not duplicated per call site", () => {
  assert.equal(isStructuralTask("CHAT_EVIDENCE_SUFFICIENCY"), true);
  assert.equal(isStructuralTask("CHAT_SYNTHESIS"), false);
  assert.equal(isStructuralTask(undefined), false);
});

test("every structural task name matches a real call site", () => {
  // A renamed task would silently stop routing and quietly cost seconds again.
  const chat = readFileSync(new URL("../src/lib/repository-chat.ts", import.meta.url), "utf8");
  for (const task of ["CHAT_EXECUTION_PLAN", "CHAT_EVIDENCE_SUFFICIENCY"]) {
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
