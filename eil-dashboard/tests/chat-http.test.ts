import assert from "node:assert/strict";
import test from "node:test";
import { readChatResponse } from "../src/lib/chat-http";

test("chat gateway timeouts produce an actionable message without parsing HTML", async () => {
  const response = new Response("<html>Gateway Timeout</html>", {
    status: 504,
    headers: { "content-type": "text/html" },
  });

  await assert.rejects(
    () => readChatResponse(response),
    /longer than the public gateway allows.*background reports continue/i
  );
});

test("chat errors preserve structured server messages", async () => {
  const response = Response.json({ error: "Repository scope is unavailable." }, { status: 503 });
  await assert.rejects(() => readChatResponse(response), /Repository scope is unavailable/);
});

test("502 gateway responses use the same recoverable timeout guidance", async () => {
  const response = new Response("upstream unavailable", { status: 502 });
  await assert.rejects(() => readChatResponse(response), /public gateway allows/);
});

test("successful chat JSON is returned unchanged", async () => {
  const response = Response.json({ answer: "Grounded answer" });
  assert.deepEqual(await readChatResponse(response), { answer: "Grounded answer" });
});
