import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_PROGRESS_STAGES,
  chatProgressActive,
  chatProgressLabel,
  encodeErrorFrame,
  encodeProgressFrame,
  encodeResultFrame,
  reportChatProgress,
  runWithChatProgress,
  type ChatProgressEvent,
} from "../src/lib/chat-progress";
import { readChatStream } from "../src/lib/chat-http";

function sseResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

test("progress reporting is a no-op when nobody is listening", () => {
  assert.equal(chatProgressActive(), false);
  // Must not throw outside a progress scope.
  assert.doesNotThrow(() => reportChatProgress("planning"));
});

test("reported stages reach the sink in order", async () => {
  const seen: ChatProgressEvent[] = [];
  await runWithChatProgress((event) => seen.push(event), async () => {
    assert.equal(chatProgressActive(), true);
    reportChatProgress("planning");
    reportChatProgress("retrieving");
    reportChatProgress("reading_evidence", "3 papers");
  });
  assert.deepEqual(seen.map((event) => event.stage), ["planning", "retrieving", "reading_evidence"]);
  assert.equal(seen[2].detail, "3 papers");
  assert.ok(seen.every((event) => event.label.length > 0));
});

test("a failing sink never breaks the work it describes", async () => {
  const value = await runWithChatProgress(
    () => {
      throw new Error("sink exploded");
    },
    async () => {
      reportChatProgress("synthesizing");
      return "answer";
    }
  );
  assert.equal(value, "answer");
});

test("every stage has a human-readable label", () => {
  for (const stage of CHAT_PROGRESS_STAGES) {
    const label = chatProgressLabel(stage);
    assert.ok(label && label.length > 3, `stage ${stage} needs a label`);
    // Labels are shown to readers, so they must not leak identifiers.
    assert.doesNotMatch(label, /_/);
  }
});

test("frames are valid Server-Sent Events", () => {
  const frame = encodeProgressFrame({ stage: "planning", label: "Understanding your question", at: 1 });
  assert.match(frame, /^event: progress\n/);
  assert.match(frame, /\n\n$/);
  assert.match(encodeResultFrame({ answer: "x" }), /^event: result\n/);
  assert.match(encodeErrorFrame("nope", 500), /^event: error\n/);
});

test("the client reads progress then the final result", async () => {
  const updates: string[] = [];
  const payload = await readChatStream<{ answer?: string; error?: string }>(
    sseResponse([
      ": open\n\n",
      encodeProgressFrame({ stage: "planning", label: "Understanding your question", at: 1 }),
      encodeProgressFrame({ stage: "retrieving", label: "Searching your papers", at: 2 }),
      encodeResultFrame({ answer: "The grounded answer." }),
    ]),
    (update) => updates.push(update.label)
  );
  assert.deepEqual(updates, ["Understanding your question", "Searching your papers"]);
  assert.equal(payload.answer, "The grounded answer.");
});

test("frames split across chunk boundaries are reassembled", async () => {
  const full = encodeResultFrame({ answer: "Split across chunks." });
  const cut = Math.floor(full.length / 2);
  const payload = await readChatStream<{ answer?: string; error?: string }>(
    sseResponse([full.slice(0, cut), full.slice(cut)]),
    () => undefined
  );
  assert.equal(payload.answer, "Split across chunks.");
});

test("an error frame becomes a thrown error", async () => {
  await assert.rejects(
    () => readChatStream(sseResponse([encodeErrorFrame("Quota exceeded.", 429)]), () => undefined),
    /Quota exceeded\./
  );
});

test("a stream that ends without a result is reported, not silently empty", async () => {
  await assert.rejects(
    () => readChatStream(sseResponse([": open\n\n"]), () => undefined),
    /unreadable response/
  );
});

test("a gateway timeout keeps its dedicated message", async () => {
  await assert.rejects(
    () => readChatStream(sseResponse([], 504), () => undefined),
    /public gateway allows/
  );
});

test("malformed frames are skipped rather than aborting the stream", async () => {
  const payload = await readChatStream<{ answer?: string; error?: string }>(
    sseResponse([
      "event: progress\ndata: {not json\n\n",
      encodeResultFrame({ answer: "Survived." }),
    ]),
    () => undefined
  );
  assert.equal(payload.answer, "Survived.");
});
