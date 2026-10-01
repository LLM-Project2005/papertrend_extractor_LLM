import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeLatestMessages } from "../src/lib/chat-transcript";

/** Chat stays where the reader is (docs/32, 2.7). */

const chat = readFileSync(new URL("../src/components/chat/ChatClient.tsx", import.meta.url), "utf8");
const message = (id: string, content = id, metadata: unknown = null) => ({ id, content, kind: "message", metadata });

test("a progress poll keeps the earlier messages and changes nothing when nothing changed", () => {
  const current = [message("e1"), message("e2"), message("m1"), message("m2")];
  // The latest page starts at m1: e1 and e2 came from "Load earlier messages".
  const merged = mergeLatestMessages(current, [message("m1"), message("m2"), message("m3")]);
  assert.deepEqual(merged.map((item) => item.id), ["e1", "e2", "m1", "m2", "m3"]);
  const same = [message("e1"), message("m1")];
  assert.equal(mergeLatestMessages(same, [message("m1")]), same, "the same array: no re-render");
  assert.notEqual(mergeLatestMessages(same, [message("m1", "edited")]), same, "a changed message is taken");
  assert.notEqual(mergeLatestMessages(same, [message("m1", "m1", { status: "done" })]), same, "so is changed metadata");
  // An optimistic local copy is replaced by the saved message.
  assert.deepEqual(mergeLatestMessages([message("m1"), message("local-abc")], [message("m1"), message("m2")]).map((item) => item.id), ["m1", "m2"]);
  assert.equal(mergeLatestMessages(same, []), same);
});

test("new content is followed only by a reader at the bottom, or one who just asked", () => {
  const effect = chat.slice(chat.indexOf("// Follow new content only for a reader already at the bottom"), chat.indexOf("const handleTranscriptScroll"));
  assert.match(effect, /if \(!forceScrollRef\.current && !nearBottomRef\.current\) return;/);
  assert.match(chat, /box\.scrollHeight - box\.scrollTop - box\.clientHeight < NEAR_BOTTOM_PX/);
  assert.match(chat, /ref=\{scrollContainerRef\}\s+onScroll=\{handleTranscriptScroll\}/);
  for (const sender of ["async function handleSubmit(", "async function askQuestion("]) {
    const body = chat.slice(chat.indexOf(sender), chat.indexOf("\n  }\n", chat.indexOf(sender)));
    assert.match(body, /forceScrollRef\.current = true;/, sender);
  }
  // Opening another conversation goes to its newest message.
  assert.match(chat, /loadedThreadIdRef\.current = threadId;\s*forceScrollRef\.current = true;/);
});

test("loading earlier messages keeps the reading position", () => {
  const load = chat.slice(chat.indexOf("const loadEarlierMessages = useCallback("), chat.indexOf("const loadLibraryRuns = useCallback("));
  assert.ok(load.indexOf("preservedScrollRef.current = { height: box.scrollHeight, top: box.scrollTop }") < load.indexOf("setMessages((current) =>"), "measured before the messages change");
  assert.match(chat, /box\.scrollTop = preserved\.top \+ \(box\.scrollHeight - preserved\.height\);/);
  assert.match(chat, /useLayoutEffect\(\(\) => \{\s*const preserved = preservedScrollRef\.current;/, "restored before paint");
});

test("the research poll is quiet, and progress sits where the reader is", () => {
  const detail = chat.slice(chat.indexOf("const loadThreadDetail = useCallback("), chat.indexOf("const loadChatSearchDetails"));
  const background = detail.slice(detail.indexOf("if (options.background) {"), detail.indexOf("} else {", detail.indexOf("if (options.background) {")));
  assert.match(background, /setMessages\(\(current\) => mergeLatestMessages\(current, latest\)\)/);
  assert.doesNotMatch(background, /setHasEarlierMessages|oldestMessageAtRef/, "what can still be loaded is left alone");
  assert.match(background, /if \(sessionSignature !== deepSessionSignatureRef\.current\)/);
  assert.match(detail, /if \(loadedThreadIdRef\.current !== threadId\) return;/, "an answer for another conversation is dropped");
  assert.match(chat, /\}, \[activeThreadId, canPersist, deepSessionRunning, loadThreadDetail\]\);/);
  const card = chat.indexOf("Research progress and the report sit after the conversation");
  assert.ok(card > chat.indexOf("Load earlier messages"), "the research card follows the transcript");
  assert.ok(card < chat.indexOf("<div ref={scrollAnchorRef} />"));
});
