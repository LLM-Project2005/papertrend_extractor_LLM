/*
 * The chat page, run (docs/32, long-term health): ChatClient through
 * stub-uia11y-hooks.ts against the stand-in document, timers and fetch of
 * stub-uia11y-dom.ts, with the stub-auditfix-* sign-in, workspace, theme and
 * router. The pieces it hands a citation, an answer or the research sources
 * to are rendered with react-dom/server, as written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ANSWER_BODY_CLASS, ANSWER_META_CLASS, ANSWER_META_SM_CLASS } from "../src/lib/answer-typography";
import type { WorkspaceMessageRecord } from "../src/types/research";
import { stubModule } from "./support/route-harness";
import { installDom, settle, type FakeResponse } from "./support/stub-uia11y-dom";
import { elements, mount, textOf, type FoundElement } from "./support/stub-uia11y-hooks";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
(globalThis as { React?: typeof React }).React = React;

const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };
const THREAD = { id: "thread-1", mode: "chat", title: "Peer feedback" };
const PAPER = { paperId: "12", title: "Peer feedback in writing", year: "2021", href: "/workspace/library?paperId=12", reason: "ผู้เรียน reported gains in accuracy." };
const HOSTILE = { paperId: "Web 1", title: "A hostile page", year: "Web", href: "javascript:alert(document.cookie)", reason: "", sourceType: "web" as const };

function record(id: string, role: "user" | "assistant", minute: number, content: string, fields: Partial<WorkspaceMessageRecord> = {}): WorkspaceMessageRecord {
  return { id, thread_id: THREAD.id, role, message_kind: "chat", content, created_at: `2026-09-01T00:${String(minute).padStart(2, "0")}:00Z`, ...fields };
}

const ANSWERED = [
  record("m1", "user", 1, "What helps writing?"),
  record("m2", "assistant", 2, `Peer feedback helped (${PAPER.title}, ${PAPER.year}).`, {
    citations: [PAPER, HOSTILE],
    metadata: { repositoryLimitations: ["Only 2 of 41 papers report effect sizes."] },
  }),
];

const click = (found: FoundElement | undefined) => {
  assert.ok(found, "the control is on the page");
  (found.props.onClick as () => void)();
};
const byLabel = (tree: ReactNode, label: string) => elements(tree).find((found) => found.props["aria-label"] === label);
const button = (tree: ReactNode, text: string) => elements(tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).includes(text));
const named = (tree: ReactNode, name: string) => elements(tree).filter((found) => typeof found.type === "function" && (found.type as { name?: string }).name === name);
const render = (found: FoundElement) => renderToStaticMarkup(createElement(found.type as (props: Record<string, unknown>) => ReactNode, found.props as Record<string, unknown>));
/** The host element whose text is exactly `text`. */
const holding = (tree: ReactNode, text: string) => elements(tree).find((found) => typeof found.type === "string" && textOf(found.props.children as ReactNode) === text);

/** The chat page with Peer feedback open; `respond` answers the conversation's own requests. */
async function openConversation(respond: (url: string, init?: { method?: string; body?: string }) => FakeResponse | undefined) {
  const dom = installDom("https://papertrend.test/workspace/chat");
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT], selectedYears: [], selectedTracks: [], searchQuery: "" };
  globalThis.__auditfixPathname = "/workspace/chat";
  dom.window.respond = (url, init) => {
    if (url.startsWith("/api/chat/threads?limit=")) return { body: { threads: [THREAD] } };
    return respond(url, init) ?? { status: 404, body: {} };
  };
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  const chat = mount(ChatClient, {});
  await settle();
  click(elements(chat.tree).find((found) => found.type === "button" && !found.props["aria-label"] && textOf(found.props.children as ReactNode).trim() === THREAD.title));
  await settle();
  return {
    dom,
    chat,
    done() {
      chat.unmount();
      dom.restore();
    },
  };
}

test("every cited link on the chat page is checked: a script address never reaches an href", async () => {
  const page = await openConversation((url) => (url === "/api/chat/threads/thread-1" ? { body: { thread: THREAD, messages: ANSWERED } } : undefined));
  try {
    const under = named(page.chat.tree, "CitationLink").map(render);
    assert.equal(under.length, 2);
    assert.match(under[0], /href="\/workspace\/library\?paperId=12"/);
    assert.match(under[1], /<a [^>]*href="#"/);
    // The sources panel lists them again, in full.
    click(byLabel(page.chat.tree, "Open conversation menu"));
    click(button(page.chat.tree, "Sources"));
    const panel = named(page.chat.tree, "CitationLink").filter((found) => !found.props.compact).map(render);
    assert.equal(panel.length, 2);
    for (const html of [...under, ...panel]) assert.doesNotMatch(html, /javascript:/i);
  } finally {
    page.done();
  }

  // The markers in an answer: a paper opens on its evidence, a web page as itself, each checked first.
  const { CitationMarker } = await import("../src/components/chat/AnswerBody");
  const sources = [
    { number: 1, paperId: "12", title: PAPER.title, year: PAPER.year, href: "javascript:alert(1)" },
    { number: 2, paperId: "Web 1", title: "A web page", year: "Web", href: "javascript:alert(2)" },
    { number: 3, paperId: "13", title: "Reading fluency", year: "2019", href: "/workspace/library?paperId=13" },
  ];
  const dom = installDom();
  try {
    const marker = mount(CitationMarker, { numbers: [1, 2, 3], sources });
    click(elements(marker.tree).find((found) => found.type === "button"));
    const links = elements(marker.tree).filter((found) => typeof found.props.href === "string" || typeof found.props.paper === "string");
    assert.deepEqual(links.map((found) => found.props.href ?? found.props.paper), ["#", "#", "/workspace/library?paperId=13&tab=evidence"]);
    marker.unmount();
  } finally {
    dom.restore();
  }
});

test("a finished deep research report lists its sources with checked links", async () => {
  const report = "Peer feedback improves accuracy [Paper 12].";
  const page = await openConversation((url) =>
    url === "/api/chat/threads/thread-1"
      ? {
          body: {
            thread: { ...THREAD, mode: "deep_research" },
            messages: [record("q", "user", 1, "Peer feedback"), record("r", "assistant", 2, report, { message_kind: "deep_research_report", citations: [{ ...PAPER, href: "javascript:alert(1)" }] })],
            deepResearchSession: { id: "session-1", thread_id: THREAD.id, status: "completed", prompt: "Peer feedback", final_report: report, requires_analysis: false, pending_run_count: 0, steps: [] },
          },
        }
      : undefined
  );
  try {
    click(button(page.chat.tree, "Full view"));
    const [sources] = named(page.chat.tree, "ResearchSources");
    assert.ok(sources, "the report's sources are listed");
    const html = render(sources);
    assert.match(html, /<a [^>]*href="#"[^>]*>Peer feedback in writing<\/a>/);
    assert.doesNotMatch(html, /javascript:/i);
  } finally {
    page.done();
  }
});

test("text that can carry Thai is set in the shared classes that clear the line-height floor", async () => {
  const plan = "แผน: read the methods of every paper on feedback.";
  const stepBody = "ขั้นตอนนี้ found twelve studies of peer feedback.";
  const snippet = "ผู้เรียน improved in accuracy after two rounds.";
  const page = await openConversation((url) =>
    url === "/api/chat/threads/thread-1"
      ? {
          body: {
            thread: { ...THREAD, mode: "deep_research" },
            messages: ANSWERED,
            deepResearchSession: {
              id: "session-1", thread_id: THREAD.id, status: "processing", prompt: "Peer feedback", plan_summary: plan, requires_analysis: false, pending_run_count: 0,
              steps: [{
                id: "step-1", session_id: "session-1", step_order: 1, status: "completed", title: "Read the methods", description: "Read the methods",
                output_payload: { summary: stepBody, raw: { evidenceItems: [{ paperId: "12", title: PAPER.title, snippet, section: "results", relevance_score: 0.9 }] } },
              }],
            },
          },
        }
      : undefined
  );
  try {
    const classOf = (text: string) => String(holding(page.chat.tree, text)?.props.className ?? `(${text} not drawn)`);
    assert.ok(classOf(plan).includes(ANSWER_META_SM_CLASS), classOf(plan));
    assert.ok(classOf(stepBody).includes(ANSWER_META_SM_CLASS), classOf(stepBody));
    assert.ok(classOf(snippet).includes(ANSWER_META_CLASS), classOf(snippet));
    // A citation's reason, in the sources panel.
    click(byLabel(page.chat.tree, "Open conversation menu"));
    click(button(page.chat.tree, "Sources"));
    const [full] = named(page.chat.tree, "CitationLink").filter((found) => !found.props.compact);
    assert.match(render(full), new RegExp(`<span class="[^"]*${ANSWER_META_CLASS}[^"]*">${PAPER.reason}</span>`));

    // The answer itself is set in the body class, and nothing on the page sets 15px text on a 28px line.
    const [answer] = named(page.chat.tree, "AssistantAnswer");
    const answerHtml = render(answer);
    assert.ok(answerHtml.includes(`class="${ANSWER_BODY_CLASS}`), answerHtml.slice(0, 200));
    const classes = [
      ...elements(page.chat.tree).map((found) => found.props.className).filter((value): value is string => typeof value === "string"),
      ...[...answerHtml.matchAll(/class="([^"]*)"/g)].map((match) => match[1]),
    ];
    assert.deepEqual(classes.filter((value) => /(^| )leading-7( |$)/.test(value) && !/(^| )text-sm( |$)/.test(value)), []);
  } finally {
    page.done();
  }
});

test("the chat page's menus take the ink focus ring, not the faint hairline one", async () => {
  const page = await openConversation((url) => (url === "/api/chat/threads/thread-1" ? { body: { thread: THREAD, messages: ANSWERED } } : undefined));
  try {
    const rings = new Set<string>();
    const collect = () => {
      for (const found of elements(page.chat.tree)) {
        for (const ring of String(found.props.className ?? "").match(/focus-visible:ring-(?!2\b|inset\b|offset)[a-z][a-z0-9-]*(\/\d+)?/g) ?? []) rings.add(ring);
      }
    };
    for (const label of ["Open conversation menu", "Options for Peer feedback", "Open attachment and tool menu"]) {
      click(byLabel(page.chat.tree, label));
      collect();
      click(byLabel(page.chat.tree, label));
    }
    assert.ok(rings.has("focus-visible:ring-ink/70"), [...rings].join(", "));
    assert.deepEqual([...rings].filter((ring) => /hairline/.test(ring)), []);
  } finally {
    page.done();
  }
});

test("a finished answer copies with its references; one still being written has no actions", async () => {
  const messages = [
    ...ANSWERED,
    record("m3", "user", 3, "Which methods?"),
    record("m4", "assistant", 4, "Analyzing the selected Papertrend knowledge scope in the background...", {
      message_kind: "status",
      metadata: { repositoryJobStatus: "processing", repositoryJobId: "job-1" },
    }),
  ];
  const page = await openConversation((url) => (url === "/api/chat/threads/thread-1" ? { body: { thread: THREAD, messages } } : undefined));
  try {
    const actions = named(page.chat.tree, "MarkdownActions");
    assert.equal(actions.length, 1, "only the finished answer");
    assert.equal(actions[0].props.fileName, "what-helps-writing.md");
    const markdown = (actions[0].props.markdown as () => string)();
    assert.match(markdown, /^Peer feedback helped \[1\]\./);
    assert.match(markdown, /\*\*Limitations:\*\*\n\n- Only 2 of 41 papers report effect sizes\./);
    assert.match(markdown, /## Sources\n\n1\. Peer feedback in writing \(2021\)\.\n$/);
  } finally {
    page.done();
  }
});

test("the conversation menu exports every page of the conversation, not only the one on screen", async () => {
  const earlier = [record("e1", "user", 1, "What do the papers say about reading?"), record("e2", "assistant", 2, "Reading gains were reported.")];
  const latest = [record("m1", "user", 3, "What helps writing?"), { ...ANSWERED[1], created_at: "2026-09-01T00:04:00Z" }];
  const page = await openConversation((url) => {
    if (url === "/api/chat/threads/thread-1") return { body: { thread: THREAD, messages: latest, hasEarlierMessages: true } };
    if (url === `/api/chat/threads/thread-1?before=${encodeURIComponent(latest[0].created_at!)}`) return { body: { thread: THREAD, messages: earlier, hasEarlierMessages: false } };
    return undefined;
  });
  try {
    click(byLabel(page.chat.tree, "Open conversation menu"));
    click(button(page.chat.tree, "Export conversation (.md)"));
    await settle();
    const pages = page.dom.window.requests.filter((request) => request.url.startsWith("/api/chat/threads/thread-1")).slice(-2);
    assert.deepEqual(pages.map((request) => request.url), ["/api/chat/threads/thread-1", `/api/chat/threads/thread-1?before=${encodeURIComponent(latest[0].created_at!)}`]);
    assert.equal(pages[1].init?.headers?.Authorization, "Bearer reader-token");
    const file = page.dom.document.created.find((element) => element.download.endsWith(".md"));
    assert.equal(file?.download, "peer-feedback.md");
    const text = await file!.downloaded!.text();
    const order = ["What do the papers say about reading?", "Reading gains were reported.", "What helps writing?", "Peer feedback helped [1]."].map((line) => text.indexOf(line));
    assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), `${order.join(", ")}\n${text}`);
    assert.equal((text.match(/## Sources/g) ?? []).length, 1);
  } finally {
    page.done();
  }
});
