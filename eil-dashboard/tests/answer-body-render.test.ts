import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantAnswer, renderRichMessage } from "../src/components/chat/AnswerBody";
import { citationLabel } from "../src/lib/answer-citations";

/**
 * These render the real components rather than matching patterns in their
 * source. A source match proves the code was written; only rendering proves
 * React produces the elements a reader needs.
 */

function renderBody(markdown: string, sources: Parameters<typeof renderRichMessage>[3] = []): string {
  return renderToStaticMarkup(
    createElement("div", null, renderRichMessage(markdown, "t", "assistant", sources))
  );
}

function renderAnswer(content: string, citations: Parameters<typeof AssistantAnswer>[0]["citations"] = []): string {
  return renderToStaticMarkup(createElement(AssistantAnswer, { content, messageId: "m1", citations }));
}

const PAPER = {
  paperId: "12",
  title: "Effects of Personal Intelligence Reading Instruction",
  year: "2016",
  href: "/workspace/papers/12",
};

/* ------------------------------------------------------------ block rendering */

test("a heading becomes a heading element", () => {
  const html = renderBody("## Direct answer\n\nThe study reported gains.");
  assert.match(html, /<h3[^>]*>Direct answer<\/h3>/);
  assert.match(html, /<p[^>]*>The study reported gains\.<\/p>/);
});

test("a table becomes a table with matching cells", () => {
  const html = renderBody(["| Paper | Year |", "| --- | --- |", "| A | 2016 |"].join("\n"));
  assert.match(html, /<table/);
  assert.match(html, /<th[^>]*>Paper<\/th>/);
  assert.match(html, /<td[^>]*>2016<\/td>/);
});

test("bullets and numbers become lists, not runs of text", () => {
  assert.match(renderBody("- one\n- two"), /<ul[^>]*>[\s\S]*<li/);
  assert.match(renderBody("1. one\n2. two"), /<ol[^>]*>[\s\S]*<li/);
});

test("a fenced block becomes a code block, not prose", () => {
  const html = renderBody("```python\nprint(1)\n```");
  assert.match(html, /<pre[^>]*>[\s\S]*<code>print\(1\)<\/code>/);
});

test("a blockquote becomes a blockquote", () => {
  assert.match(renderBody("> quoted line"), /<blockquote/);
});

/* ----------------------------------------------------------- inline rendering */

test("emphasis renders as elements rather than punctuation", () => {
  const html = renderBody("A **bold**, an *italic*, a ~~struck~~ and `code`.");
  assert.match(html, /<strong[^>]*>bold<\/strong>/);
  assert.match(html, /<em[^>]*>italic<\/em>/);
  assert.match(html, /<s[^>]*>struck<\/s>/);
  assert.match(html, /<code[^>]*>code<\/code>/);
  // The asterisks themselves must not survive into the reader's view.
  assert.equal(/\*\*bold/.test(html), false);
  assert.equal(/~~struck/.test(html), false);
});

test("a link opens safely in a new tab", () => {
  const html = renderBody("See [the site](https://example.com).");
  assert.match(html, /<a [^>]*href="https:\/\/example\.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
});

/* ---------------------------------------------------------------- the markers */

test("a citation renders as a numbered marker with its source attached", () => {
  const html = renderAnswer(`The study reported gains (${citationLabel(PAPER)}).`, [PAPER]);
  // The reader sees the number, not the 50-character title, inside the sentence.
  assert.match(html, /<button[^>]*>1<\/button>/);
  assert.match(html, /aria-label="Source: Effects of Personal Intelligence Reading Instruction \(2016\)"/);
  // The full title is still present, in the card rather than the sentence.
  assert.match(html, /role="tooltip"/);
  assert.match(html, /Effects of Personal Intelligence Reading Instruction/);
  assert.equal(
    html.includes("(Effects of Personal Intelligence Reading Instruction, 2016)"),
    false,
    "the inline parenthetical must be replaced, not merely supplemented"
  );
});

test("the source card opens on focus as well as hover", () => {
  const html = renderAnswer(`Gains (${citationLabel(PAPER)}).`, [PAPER]);
  assert.match(html, /group-focus-within:block/);
  assert.match(html, /group-hover:block/);
});

test("an answer with no citations renders no markers", () => {
  const html = renderAnswer("The repository holds five papers.", []);
  assert.equal(/role="tooltip"/.test(html), false);
  assert.match(html, /five papers/);
});

test("the internal marker never reaches the reader as text", () => {
  const html = renderAnswer(`Gains (${citationLabel(PAPER)}).`, [PAPER]);
  assert.equal(html.includes("[[cite:"), false);
});

/* ------------------------------------------------------------------- the fold */

test("a short answer renders with no fold control", () => {
  const html = renderAnswer("A short answer about five papers.", []);
  assert.equal(/Show more/.test(html), false);
});

test("a long answer folds and offers to show the rest", () => {
  const long = "The five papers study English teaching in Thai classrooms. ".repeat(80);
  const html = renderAnswer(long, []);
  assert.match(html, /Show more/);
  assert.match(html, /aria-expanded="false"/);
  // Something is hidden, and the opening is not.
  assert.match(html, /The five papers study English teaching/);
  assert.ok(html.length < long.length, "the folded view must be shorter than the answer");
});

test("the fold says how much is hidden rather than just 'more'", () => {
  const long = "Sentence about the corpus. ".repeat(200);
  const html = renderAnswer(long, []);
  assert.match(html, /Show more \([\d,]+ more characters\)/);
});

/* -------------------------------------------------------------- the typography */

test("answer prose carries the Thai-safe line height and wrapping", () => {
  const html = renderBody("ผลการศึกษาพบว่าการให้ข้อมูลย้อนกลับช่วยพัฒนาการเขียนของผู้เรียน");
  assert.match(html, /leading-8/);
  assert.match(html, /break-words/);
});

test("Thai renders as text, not as escaped or mangled output", () => {
  const thai = "คลังนี้มีงานวิจัย 5 เรื่อง";
  const html = renderBody(thai);
  assert.match(html, new RegExp(thai));
});

test("a table cell can wrap rather than widening the table", () => {
  const html = renderBody(["| Paper | Year |", "| --- | --- |", "| A | 2016 |"].join("\n"));
  assert.match(html, /break-words/);
});

/* --------------------------------------------------------------- mixed content */

test("a whole realistic answer renders every part", () => {
  const answer = [
    `The five papers study English teaching in Thai classrooms (${citationLabel(PAPER)}).`,
    "",
    "## What they measured",
    "",
    "- **Reading comprehension** across two drafts",
    "- **Learner autonomy** in a rural setting",
    "",
    "| Paper | Year |",
    "| --- | --- |",
    "| A | 2016 |",
  ].join("\n");
  const html = renderAnswer(answer, [PAPER]);
  assert.match(html, /<h3[^>]*>What they measured<\/h3>/);
  assert.match(html, /<ul/);
  assert.match(html, /<table/);
  assert.match(html, /<button[^>]*>1<\/button>/);
  assert.equal(html.includes("[[cite:"), false);
});
