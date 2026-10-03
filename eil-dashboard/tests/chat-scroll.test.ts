import assert from "node:assert/strict";
import test from "node:test";
import React, { type ReactNode } from "react";
import { mergeLatestMessages } from "../src/lib/chat-transcript";
import type { WorkspaceMessageRecord } from "../src/types/research";
import { stubModule } from "./support/route-harness";
import { FakeElement, installDom, settle } from "./support/stub-uia11y-dom";
import { elements, mount, textOf, type FoundElement } from "./support/stub-uia11y-hooks";

/**
 * Chat stays where the reader is (docs/32, 2.7). The chat page runs through
 * stub-uia11y-hooks.ts against the stand-in document, timers and fetch of
 * stub-uia11y-dom.ts; its transcript is a stand-in box whose content grows by
 * 400px a message. Sign-in, the workspace, the theme and Next's router are the
 * tests/support/stub-auditfix-*.ts ones.
 */

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
(globalThis as { React?: typeof React }).React = React;

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

const SIGNED_IN = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "token" } };
const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };
const MESSAGE_PX = 400;

function record(id: string, role: "user" | "assistant", minute: number): WorkspaceMessageRecord {
  return { id, thread_id: "thread-1", role, message_kind: "chat", content: `Message ${id}`, created_at: `2026-09-01T00:${String(minute).padStart(2, "0")}:00Z` } as WorkspaceMessageRecord;
}

const RUNNING = { id: "session-1", thread_id: "thread-1", status: "processing", prompt: "Peer feedback", requires_analysis: false, pending_run_count: 0, steps: [] };

/** What the transcript says: its text, and the answers it hands to be drawn. */
const said = (tree: ReactNode) => [textOf(tree), ...elements(tree).map((found) => found.props.content).filter((content) => typeof content === "string")].join(" | ");

/** The messages drawn in a tree: one section each. */
const messagesIn = (tree: ReactNode) => elements(tree).filter((found) => found.type === "section" && !found.props.className);

/**
 * The chat page with one conversation open, its transcript a stand-in box
 * 200px tall. `detail` is what the server says the conversation holds, read
 * again on every request.
 */
async function openConversation(detail: () => Record<string, unknown>, earlier: WorkspaceMessageRecord[] = []) {
  const dom = installDom("https://papertrend.test/workspace/chat");
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT], selectedYears: [], selectedTracks: [], searchQuery: "" };
  globalThis.__auditfixPathname = "/workspace/chat";
  dom.window.respond = (url) => {
    if (url.startsWith("/api/chat/threads?limit=")) return { body: { threads: [{ id: "thread-1", mode: "chat", title: "Peer feedback" }, { id: "thread-2", mode: "chat", title: "Reading fluency" }] } };
    if (url === "/api/chat/threads/thread-1") return { body: detail() };
    if (url.startsWith("/api/chat/threads/thread-1?before=")) return { body: { thread: detail().thread, messages: earlier, hasEarlierMessages: false } };
    if (url === "/api/chat/threads/thread-2") return { body: { thread: { id: "thread-2", mode: "chat", title: "Reading fluency" }, messages: [record("other", "assistant", 1)] } };
    return { status: 404, body: {} };
  };
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  const chat = mount(ChatClient, {});
  const transcript = elements(chat.tree).find((found) => typeof found.props.onScroll === "function" && found.props.ref)!;
  assert.ok(transcript, "the transcript scrolls itself");
  const box = new FakeElement("DIV");
  box.clientHeight = 200;
  Object.defineProperty(box, "scrollHeight", { get: () => MESSAGE_PX * messagesIn(chat.tree).length });
  (transcript.props.ref as { current: unknown }).current = box;
  await settle();
  const threadRow = (title: string) => elements(chat.tree).find((found) => found.type === "button" && !found.props["aria-label"] && textOf(found.props.children as ReactNode).trim() === title);
  click(threadRow("Peer feedback"));
  await settle();
  return {
    dom,
    chat,
    box,
    threadRow,
    /** The reader scrolls the transcript to `top`. */
    scrollTo(top: number) {
      box.scrollTop = top;
      (elements(chat.tree).find((found) => typeof found.props.onScroll === "function")!.props.onScroll as () => void)();
    },
    done() {
      chat.unmount();
      dom.restore();
    },
  };
}

const click = (found: FoundElement | undefined) => (found?.props.onClick as () => void)();

test("new content is followed only by a reader at the bottom, or one who just asked", async () => {
  let messages = [record("m1", "user", 1), record("m2", "assistant", 2)];
  const chat = await openConversation(() => ({ thread: { id: "thread-1", mode: "deep_research", title: "Peer feedback" }, messages, deepResearchSession: RUNNING }));
  try {
    assert.equal(messagesIn(chat.chat.tree).length, 2);
    assert.equal(chat.box.scrolls.at(-1)?.top, 800, "opening a conversation goes to its newest message");

    // The research poll brings a message while the reader is reading higher up.
    chat.scrollTo(0);
    const scrolls = chat.box.scrolls.length;
    messages = [...messages, record("m3", "assistant", 3)];
    chat.dom.window.advance(5000);
    await settle();
    assert.equal(messagesIn(chat.chat.tree).length, 3, "the poll brought it");
    assert.equal(chat.box.scrolls.length, scrolls, "a reader who scrolled up is left where they are");
    assert.equal(chat.box.scrollTop, 0);

    // Back at the bottom, the next one is followed.
    chat.scrollTo(chat.box.scrollHeight - chat.box.clientHeight);
    messages = [...messages, record("m4", "assistant", 4)];
    chat.dom.window.advance(5000);
    await settle();
    assert.equal(chat.box.scrolls.at(-1)?.top, 1600);

    // Asking something goes to the bottom wherever the reader was.
    chat.scrollTo(0);
    const before = chat.box.scrolls.length;
    (elements(chat.chat.tree).find((found) => found.props["aria-label"] === "Message")!.props.onChange as (event: unknown) => void)({ target: { value: "And for speaking?" } });
    const form = elements(chat.chat.tree).find((found) => found.type === "form" && elements(found.props.children as ReactNode).some((inner) => inner.props["aria-label"] === "Message"))!;
    void (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    await settle();
    assert.ok(chat.box.scrolls.length > before, "the question just asked is followed");
  } finally {
    chat.done();
  }
});

test("loading earlier messages keeps the reading position", async () => {
  const chat = await openConversation(
    () => ({ thread: { id: "thread-1", mode: "chat", title: "Peer feedback" }, messages: [record("m1", "user", 3), record("m2", "assistant", 4)], hasEarlierMessages: true }),
    [record("e1", "user", 1), record("e2", "assistant", 2)]
  );
  try {
    chat.scrollTo(300);
    const scrolls = chat.box.scrolls.length;
    click(elements(chat.chat.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode) === "Load earlier messages"));
    await settle();
    assert.equal(messagesIn(chat.chat.tree).length, 4, "the earlier messages are on top");
    assert.equal(chat.box.scrollTop, 300 + 2 * MESSAGE_PX, "the messages the reader was reading stay in front of them");
    assert.equal(chat.box.scrolls.length, scrolls, "and nothing scrolls to the bottom");
  } finally {
    chat.done();
  }
});

test("the research poll is quiet, and progress sits where the reader is", async () => {
  let messages = [record("m1", "user", 3), record("m2", "assistant", 4)];
  const chat = await openConversation(
    () => ({ thread: { id: "thread-1", mode: "deep_research", title: "Peer feedback" }, messages, hasEarlierMessages: true, deepResearchSession: RUNNING }),
    [record("e1", "user", 1), record("e2", "assistant", 2)]
  );
  try {
    const loadEarlier = () => elements(chat.chat.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode) === "Load earlier messages");
    // The card follows the transcript, before the bottom it scrolls to.
    const order = elements(chat.chat.tree);
    const card = order.findIndex((found) => found.type === "section" && String(found.props.className).includes("max-w-[1040px]"));
    const lastMessage = order.lastIndexOf(messagesIn(chat.chat.tree).at(-1)!);
    const anchor = order.findIndex((found) => Object.keys(found.props).join() === "ref");
    assert.ok(lastMessage < card && card < anchor, `message ${lastMessage}, card ${card}, bottom ${anchor}`);

    click(loadEarlier());
    await settle();
    const requests = chat.dom.window.requests.length;
    messages = [...messages, record("m3", "assistant", 5)];
    chat.dom.window.advance(5000);
    await settle();
    assert.equal(chat.dom.window.requests.length, requests + 1, "one quiet request");
    assert.deepEqual(messagesIn(chat.chat.tree).length, 5, "the earlier messages stay, and the new one is added");
    assert.ok(said(chat.chat.tree).includes("Message e1"));
    assert.equal(loadEarlier(), undefined, "what can still be loaded is left as loading earlier found it");

    // An answer for a conversation the reader has left, arriving after they left, is dropped.
    messages = [...messages, record("late", "assistant", 6)];
    const respond = chat.dom.window.respond;
    let release = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    chat.dom.window.respond = (url, init) => (url === "/api/chat/threads/thread-1" ? { ...respond(url, init), after: slow } : respond(url, init));
    chat.dom.window.advance(5000);
    click(chat.threadRow("Reading fluency"));
    await settle();
    release();
    await settle();
    const shown = said(chat.chat.tree);
    assert.ok(shown.includes("Message other"), "the conversation opened");
    assert.ok(!shown.includes("Message late") && !shown.includes("Message m1"), "nothing from the one left behind");
  } finally {
    chat.done();
  }
});
