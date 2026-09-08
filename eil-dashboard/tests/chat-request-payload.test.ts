import assert from "node:assert/strict";
import test from "node:test";
import { normalizeChatRequestPayload } from "../src/lib/chat-request-payload";

test("chat requests retain the newest 24 valid messages within the server limit", () => {
  const messages = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index}`,
  }));
  const payload = normalizeChatRequestPayload({ messages });
  const normalized = payload.messages as Array<{ role: string; content: string }>;
  assert.equal(normalized.length, 24);
  assert.equal(normalized[0]?.content, "message-6");
  assert.equal(normalized.at(-1)?.content, "message-29");
});

test("chat requests compact long context without dropping its beginning or conclusion", () => {
  const content = `BEGIN-${"x".repeat(15_000)}-END`;
  const payload = normalizeChatRequestPayload({ messages: [{ role: "assistant", content }] });
  const normalized = payload.messages as Array<{ content: string }>;
  assert.equal(normalized[0]?.content.length, 12_000);
  assert.ok(normalized[0]?.content.startsWith("BEGIN-"));
  assert.ok(normalized[0]?.content.endsWith("-END"));
  const direct = normalizeChatRequestPayload({ message: content });
  assert.equal(String(direct.message).length, 12_000);
});

test("large semantic-map selections keep full run scope while bounding attachment metadata", () => {
  const runIds = Array.from({ length: 50 }, (_, index) => `run-${index}`);
  const attachments = runIds.map((runId) => ({ name: runId, runId }));
  const payload = normalizeChatRequestPayload({
    attachments,
    selectedRunIds: runIds,
    knowledgeScope: { kind: "selected_papers", runIds },
  });
  assert.equal((payload.attachments as unknown[]).length, 10);
  assert.equal((payload.selectedRunIds as unknown[]).length, 50);
  assert.equal(((payload.knowledgeScope as { runIds: unknown[] }).runIds).length, 50);
});
