import assert from "node:assert/strict";
import test from "node:test";
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

// That the chat really calls its steps by these names runs in small-fixes2-behaviour-retrieval.test.ts.

/** The model each call asked the provider for, with `status` as the provider's answer. */
async function modelsSent(env: Record<string, string>, work: (openai: typeof import("../src/lib/openai")) => Promise<unknown>, status = 200) {
  const saved = Object.fromEntries(["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "CHAT_FAST_MODEL", ...Object.keys(env)].map((key) => [key, process.env[key]]));
  for (const key of ["OPENAI_BASE_URL", "OPENAI_MODEL", "CHAT_FAST_MODEL"]) delete process.env[key];
  Object.assign(process.env, { OPENAI_API_KEY: "test-key", ...env });
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_url: string, init: { body?: string } = {}) => {
    sent.push(JSON.parse(init.body ?? "{}").model);
    return status === 200
      ? new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
      : new Response("refused", { status });
  }) as typeof fetch;
  try {
    await work(await import("../src/lib/openai"));
    return sent;
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const OPENROUTER = { OPENAI_BASE_URL: "https://openrouter.ai/api/v1", OPENAI_MODEL: "vendor/configured-default" };
const ask = (task?: string, model?: string) => (openai: typeof import("../src/lib/openai")) => openai.createChatCompletion([{ role: "user", content: "x" }], 0, model, task);

test("the helper routes rather than passing the caller's model straight through", async () => {
  assert.deepEqual(await modelsSent(OPENROUTER, ask("CHAT_EXECUTION_PLAN", PRIMARY)), [DEFAULT_FAST_MODEL]);
  assert.deepEqual(await modelsSent(OPENROUTER, ask("CHAT_SYNTHESIS", PRIMARY)), [PRIMARY]);
  assert.deepEqual(await modelsSent(OPENROUTER, ask("SOME_OTHER_TASK")), ["vendor/configured-default"], "no caller model: the configured one");
  assert.deepEqual(await modelsSent({ ...OPENROUTER, CHAT_FAST_MODEL: "off" }, ask("CHAT_EXECUTION_PLAN", PRIMARY)), [PRIMARY]);
  assert.deepEqual(await modelsSent({ OPENAI_MODEL: "gpt-configured" }, ask("CHAT_EXECUTION_PLAN", PRIMARY)), [PRIMARY], "not OpenRouter: left alone");
});

test("latency is attributed to the model that served the call", async () => {
  // Without this, a routing change could not be confirmed from the logs.
  const { runWithModelLatency } = await import("../src/lib/model-latency");
  const timed = async (status: number) => {
    let timings: Array<{ task: string; outcome: string; model?: string }> = [];
    await modelsSent(OPENROUTER, async (openai) => {
      timings = (await runWithModelLatency(() => ask("CHAT_EVIDENCE_SUFFICIENCY", PRIMARY)(openai).catch(() => null))).timings;
    }, status);
    return timings.map(({ task, outcome, model }) => ({ task, outcome, model }));
  };
  assert.deepEqual(await timed(200), [{ task: "CHAT_EVIDENCE_SUFFICIENCY", outcome: "ok", model: DEFAULT_FAST_MODEL }]);
  assert.deepEqual(await timed(400), [{ task: "CHAT_EVIDENCE_SUFFICIENCY", outcome: "failed", model: DEFAULT_FAST_MODEL }]);
});
