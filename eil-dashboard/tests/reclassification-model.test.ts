import assert from "node:assert/strict";
import test from "node:test";
import { getOpenAIConfig } from "../src/lib/server-env";

test("reclassification uses the worker's classification model on OpenRouter", () => {
  const saved = { ...process.env };
  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    delete process.env.MODEL_TASK_TRACK_CLASSIFICATION;
    delete process.env.OPENAI_MODEL;
    assert.equal(getOpenAIConfig("TRACK_CLASSIFICATION")?.model, "google/gemini-2.5-flash-lite");
    // An explicit task setting still wins.
    process.env.MODEL_TASK_TRACK_CLASSIFICATION = "some/other-model";
    assert.equal(getOpenAIConfig("TRACK_CLASSIFICATION")?.model, "some/other-model");
    // Other tasks, and other gateways, keep their old defaults.
    delete process.env.MODEL_TASK_TRACK_CLASSIFICATION;
    assert.equal(getOpenAIConfig("CHAT")?.model, "gpt-4.1-mini");
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    assert.equal(getOpenAIConfig("TRACK_CLASSIFICATION")?.model, "gpt-4.1-mini");
  } finally {
    process.env = saved;
  }
});
