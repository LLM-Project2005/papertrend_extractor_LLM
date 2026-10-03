/*
 * What the chat page draws, rendered rather than read (docs/32, long-term
 * health): the markdown the answer checks call supported, a deep research
 * report, the empty page and its composer, and the questions a reader can
 * click. Sign-in, the workspace state, the theme and Next's router are swapped
 * for what each test sets (tests/support/stub-auditfix-*.ts, used as they
 * are); ChatIntro is the real one, with the props the page gave it kept
 * (stub-chatanswer-intro.ts). The components run as written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/chat/ChatIntro.tsx", support("stub-chatanswer-intro.ts"));
(globalThis as { React?: typeof React }).React = React;

const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };

/** The chat page as a signed-in reader first sees it, in an open repository. */
async function chatPage() {
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = {
    currentProject: PROJECT,
    hasActiveProject: true,
    selectedProjectId: PROJECT.id,
    allProjects: [PROJECT],
    selectedYears: [],
    selectedTracks: [],
    searchQuery: "",
  };
  globalThis.__chatAnswerIntroProps = undefined;
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  return renderToStaticMarkup(createElement(ChatClient));
}

/** Visible text, tags removed. */
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

/**
 * What a component returns, called inside a real render so its hooks work,
 * through any component that only wraps another.
 */
function returned<P>(component: (props: P) => ReactNode, props: P): ReactNode {
  let tree: ReactNode = null;
  function Capture() {
    let node = component(props);
    while (isValidElement(node) && typeof node.type === "function") {
      node = (node.type as (inner: unknown) => ReactNode)(node.props);
    }
    tree = node;
    return null;
  }
  renderToStaticMarkup(createElement(Capture));
  return tree;
}

/** The buttons in an element tree, with their text and click handler. */
function buttons(node: ReactNode): Array<{ text: string; onClick?: () => void }> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; onClick?: () => void };
  const inner = buttons(props.children);
  if (node.type !== "button") return inner;
  const label = ([] as ReactNode[]).concat(props.children).filter((child) => typeof child === "string").join("");
  return [{ text: label, onClick: props.onClick }, ...inner];
}

/* --------------------------------------------------------------- the renderer */

test("every construct the answer checks call supported is drawn by the renderer, not leaked as punctuation", async () => {
  // If these drift, the checks pass answers the renderer then leaks at readers.
  const { unsupportedMarkdown } = await import("../src/lib/answer-rendering");
  const { renderRichMessage } = await import("../src/components/chat/AnswerBody");
  const answer = [
    "## Direct answer",
    "",
    "The study reported **significant** gains, described as *moderate* and ~~small~~ by the authors.",
    "",
    "- A bullet with `inline code`",
    "- A [link](https://example.com) that resolves",
    "",
    "> A quoted line",
    "",
    "1. First",
    "2. Second",
    "",
    "| Paper | Year |",
    "| --- | --- |",
    "| A | 2016 |",
  ].join("\n");
  assert.deepEqual(unsupportedMarkdown(answer), [], "the checks call all of this supported");

  const html = renderToStaticMarkup(createElement("div", null, renderRichMessage(answer, "t", "assistant", [])));
  assert.match(html, /<h3[^>]*>Direct answer<\/h3>/);
  assert.match(html, /<strong[^>]*>significant<\/strong>/);
  assert.match(html, /<em[^>]*>moderate<\/em>/);
  assert.match(html, /<s[^>]*>small<\/s>/);
  assert.match(html, /<code[^>]*>inline code<\/code>/);
  assert.match(html, /<a [^>]*href="https:\/\/example\.com"[^>]*>link<\/a>/);
  assert.match(html, /<blockquote[^>]*>[\s\S]*A quoted line[\s\S]*<\/blockquote>/);
  assert.match(html, /<ol[^>]*>[\s\S]*First[\s\S]*Second[\s\S]*<\/ol>/);
  assert.match(html, /<ul[^>]*>[\s\S]*A bullet with[\s\S]*<\/ul>/);
  assert.match(html, /<th[^>]*>Paper<\/th>[\s\S]*<td[^>]*>2016<\/td>/);
  const text = visible(html);
  for (const markup of ["##", "**", "~~", "`", "](", "| --- |", "> A quoted", "*moderate*"]) {
    assert.ok(!text.includes(markup), `"${markup}" reached the reader: ${text}`);
  }
});

test("a deep research report is drawn like an answer, with its citations as numbered sources", async () => {
  // It was printed as plain text: "# Research Report" and "**bold**" showed as typed.
  const { markCitations, citationLabel } = await import("../src/lib/answer-citations");
  const { renderRichMessage } = await import("../src/components/chat/AnswerBody");
  const paper = { paperId: "12", title: "Peer feedback in second-language writing", year: "2021", href: "/workspace/papers/12" };
  const report = [
    "# Research Report",
    "",
    `Peer feedback **improved** revision quality (${citationLabel(paper)}).`,
    "",
    "## Findings",
    "",
    "- Students revised more often",
  ].join("\n");
  const marked = markCitations(report, [paper]);
  assert.deepEqual(marked.sources.map((source) => [source.number, source.title]), [[1, paper.title]]);
  const html = renderToStaticMarkup(createElement("div", null, renderRichMessage(marked.text, "fullscreen-report", "assistant", marked.sources)));
  assert.match(html, /<h[1-6][^>]*>Research Report<\/h[1-6]>/);
  assert.match(html, /<h[1-6][^>]*>Findings<\/h[1-6]>/);
  assert.match(html, /<strong[^>]*>improved<\/strong>/);
  assert.match(html, /<button[^>]*>1<\/button>/, "the citation is a numbered marker");
  assert.match(html, /<ul[^>]*><li[^>]*>(?:<span[^>]*><\/span>)?<span>Students revised more often<\/span><\/li><\/ul>/);
  const text = visible(html);
  assert.ok(!/#|\*\*|\[\[cite:/.test(text), `markup reached the reader: ${text}`);
  assert.ok(!text.includes(`(${citationLabel(paper)})`), "the inline citation is replaced by its number");
});

/* --------------------------------------------------------------- the empty page */

test("the empty chat page teaches the page rather than asking where to begin", async () => {
  const { CAPABILITIES } = await import("../src/lib/chat-guidance");
  const html = await chatPage();
  const text = visible(html);
  assert.ok(!text.includes("Where should we begin?"), "the bare heading is gone");
  assert.match(text, /Ask your papers/);
  const props = globalThis.__chatAnswerIntroProps;
  assert.ok(props, "the page shows the intro");
  assert.equal(props.examples.length, 3);
  for (const example of props.examples) assert.ok(text.includes(example.text), `example not shown: ${example.text}`);
  for (const capability of CAPABILITIES) assert.ok(text.includes(capability.label), `capability not shown: ${capability.label}`);
  assert.match(text, /What it cannot answer/);
});

test("the composer says what a question will search, and claims no count it does not have", async () => {
  // It passed a hardcoded zero, so it claimed "0 papers" for every scope until
  // an answer came back. Before the count arrives it names the scope alone.
  const html = await chatPage();
  const composer = /<p data-testid="composer-scope"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(composer, "the composer states its scope");
  assert.equal(visible(composer[1]).trim(), "Searching Assessment studies repository");
  assert.equal(globalThis.__chatAnswerIntroProps?.eligiblePaperCount, null, "the intro is not handed an invented count either");
});

test("an example the reader clicks is sent as their question", async () => {
  await chatPage();
  const props = globalThis.__chatAnswerIntroProps!;

  // Each example is a button that asks its own text.
  const asked: string[] = [];
  const intro = returned((await import("../src/components/chat/ChatIntro")).ChatIntro, { ...props, onAsk: (question: string) => void asked.push(question) });
  const examples = buttons(intro).filter((button) => props.examples.some((example) => example.text === button.text));
  assert.equal(examples.length, 3);
  examples.forEach((button) => button.onClick?.());
  assert.deepEqual(asked, props.examples.map((example) => example.text));

  // And the page sends what was clicked, not the empty draft.
  const original = globalThis.fetch;
  let sent!: (request: { url: string; init: RequestInit }) => void;
  const request = new Promise<{ url: string; init: RequestInit }>((resolve) => (sent = resolve));
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ answer: "Three papers." }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    props.onAsk(props.examples[0].text);
    const { url, init } = await request;
    assert.equal(url, "/api/chat");
    assert.equal(init.method, "POST");
    assert.equal(JSON.parse(String(init.body)).message, props.examples[0].text);
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer reader-token");
  } finally {
    globalThis.fetch = original;
  }
});

test("a follow-up suggestion is a button that asks it, and no suggestions draw nothing", async () => {
  const { FollowUpSuggestions } = await import("../src/components/chat/ChatIntro");
  const suggestions = ["What sample sizes did the intervention studies use?", "How do the other 36 papers approach this?"];
  const asked: string[] = [];
  const tree = returned(FollowUpSuggestions, { suggestions, onAsk: (question: string) => void asked.push(question) });
  const shown = buttons(tree);
  assert.deepEqual(shown.map((button) => button.text), suggestions);
  shown.forEach((button) => button.onClick?.());
  assert.deepEqual(asked, suggestions);
  assert.equal(renderToStaticMarkup(createElement(FollowUpSuggestions, { suggestions: [], onAsk: () => undefined })), "");
});
