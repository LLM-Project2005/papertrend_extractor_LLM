import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DIRECT_ANSWER_WINDOW,
  brokenTables,
  emptySections,
  leadsWithDirectAnswer,
  leakedJson,
  renderingIssues,
  rendersCleanly,
  unclosedCodeFence,
  unsupportedMarkdown,
} from "../src/lib/answer-rendering";

function client(): string {
  return readFileSync(
    new URL("../src/components/chat/ChatClient.tsx", import.meta.url),
    "utf8"
  );
}

/* ---------------------------------------------------------------- leaked JSON */

test("an answer that begins as JSON is caught", () => {
  assert.equal(leakedJson('{"answer": "text", "confidence": 0.8}').length, 1);
  assert.equal(leakedJson('[{"paperId": "3"}]').length > 0, true);
});

test("a response object embedded mid-answer is caught", () => {
  const answer = 'The study found improvement.\n\n{"answer": "...", "confidence": 0.4}';
  assert.equal(leakedJson(answer).length, 1);
});

test("ordinary prose with braces is not mistaken for JSON", () => {
  // A brace in prose, or a set in mathematical notation, is not leaked output.
  assert.deepEqual(leakedJson("The set {a, b} was sampled."), []);
  assert.deepEqual(leakedJson("Scores improved (see note {1})."), []);
});

test("JSON shown deliberately inside a code block is allowed", () => {
  const answer = 'Here is the shape:\n\n```json\n{"answer": "x"}\n```\n\nThat is the format.';
  assert.deepEqual(leakedJson(answer), []);
});

/* -------------------------------------------------------- unsupported markdown */

test("markdown the renderer cannot draw is caught", () => {
  const cases: Array<[string, string]> = [
    ["![figure](https://example.com/a.png)", "image"],
    ["text\n\n---\n\nmore", "horizontal-rule"],
    ["- top\n    - nested", "nested-list"],
    ["- [x] done", "task-list"],
    ["<div>hello</div>", "html-tag"],
    ["See [the paper](/workspace/papers/3).", "non-http-link"],
    ["##Heading with no space", "heading-without-space"],
    ["The study [Paper 12] reported gains.", "unreplaced-paper-marker"],
  ];
  for (const [answer, kind] of cases) {
    const issues = unsupportedMarkdown(answer);
    assert.ok(
      issues.some((issue) => issue.detail === kind),
      `${kind} not caught in ${JSON.stringify(answer)}`
    );
  }
});

test("markdown the renderer does draw is left alone", () => {
  const answer = [
    "## Direct answer",
    "",
    "The study reported **significant** gains, described as *moderate* by the authors.",
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
  assert.deepEqual(unsupportedMarkdown(answer), []);
  assert.equal(rendersCleanly(answer), true);
});

test("a dash used as punctuation is not read as a horizontal rule", () => {
  assert.deepEqual(unsupportedMarkdown("The result - a small gain - held."), []);
});

test("unsupported markdown inside a code block is allowed", () => {
  const answer = "Example:\n\n```md\n![img](https://x/y.png)\n- [ ] todo\n```\n\nThat is the syntax.";
  assert.deepEqual(unsupportedMarkdown(answer), []);
});

/* ---------------------------------------------------------------- broken tables */

test("a row with the wrong number of cells is caught", () => {
  const answer = ["| Paper | Year |", "| --- | --- |", "| A | 2016 |", "| B |"].join("\n");
  const issues = brokenTables(answer);
  assert.equal(issues.length, 1);
  assert.match(issues[0].detail, /row has 1 cells, header has 2/);
});

test("a separator that does not match the header is caught", () => {
  const answer = ["| Paper | Year | Method |", "| --- | --- |", "| A | 2016 | Survey |"].join("\n");
  assert.ok(brokenTables(answer).some((issue) => /separator/.test(issue.detail)));
});

test("a well-formed table passes, including alignment markers", () => {
  const answer = ["| Paper | Year |", "| :--- | ---: |", "| A | 2016 |", "| B | 2017 |"].join("\n");
  assert.deepEqual(brokenTables(answer), []);
});

test("two tables in one answer are both checked", () => {
  const answer = [
    "| A | B |", "| --- | --- |", "| 1 | 2 |",
    "",
    "| C | D |", "| --- | --- |", "| 3 |",
  ].join("\n");
  assert.equal(brokenTables(answer).length, 1);
});

test("a line with a pipe that is not a table is ignored", () => {
  assert.deepEqual(brokenTables("Throughput was measured in bits | second."), []);
});

/* --------------------------------------------------------------- empty sections */

test("a heading followed by another heading is caught", () => {
  // The exact defect found in the live suite: "## Document analysis" then
  // "## Direct answer", so the reader meets a label and then another label.
  const issues = emptySections("## Document analysis\n\n## Direct answer\n\nThe papers use five approaches.");
  assert.equal(issues.length, 1);
  assert.match(issues[0].sample, /Document analysis/);
});

test("a heading with content under it passes", () => {
  assert.deepEqual(
    emptySections("## Direct answer\n\nThe papers use five approaches.\n\n## Detail\n\nMore."),
    []
  );
});

test("a heading in a code block is not read as a heading", () => {
  assert.deepEqual(emptySections("```md\n## One\n## Two\n```"), []);
});

/* ------------------------------------------------------------------ code fences */

test("a fence that never closes is caught", () => {
  assert.equal(unclosedCodeFence("Here:\n\n```\ncode goes on forever").length, 1);
});

test("balanced fences pass", () => {
  assert.deepEqual(unclosedCodeFence("Here:\n\n```\ncode\n```\n\nDone."), []);
});

/* -------------------------------------------------------------------- directness */

test("an answer that opens with the answer passes", () => {
  const answer = "**Test 2 repository** contains **7 total files**: **5 successfully analyzed papers**.";
  assert.equal(leadsWithDirectAnswer(answer).ok, true);
});

test("a heading before the answer does not count against it", () => {
  // A label then the answer is fine; the reader still meets the answer at once.
  const answer = "## Direct answer\n\nThe studies mainly sampled Thai learners in educational settings.";
  assert.equal(leadsWithDirectAnswer(answer).ok, true);
});

test("preamble that defers the answer is caught", () => {
  const cases = [
    "Sure! I can help with that. The papers are...",
    "Let me look at the repository and see what the papers say about this.",
    "To answer your question, I will first describe the corpus and then the findings.",
    "The following sections describe what the papers report about reading.",
    "This answer will cover the methods used across the five papers in scope.",
  ];
  for (const answer of cases) {
    const result = leadsWithDirectAnswer(answer);
    assert.equal(result.ok, false, `not caught: ${answer}`);
    assert.equal(result.reason, "preamble");
  }
});

test("an answer with almost no opening content is caught", () => {
  assert.equal(leadsWithDirectAnswer("## Summary\n\nYes.").ok, false);
  assert.equal(leadsWithDirectAnswer("").ok, false);
});

test("naming the source is not preamble when it carries the answer", () => {
  // "According to X, the result was Y" answers the question in the same breath.
  assert.equal(
    leadsWithDirectAnswer("According to the reading study, structured feedback improved revision quality across two drafts.").ok,
    true
  );
});

test("a Thai answer is judged by the same rule", () => {
  const thai = "คลังนี้มีงานวิจัย 5 เรื่อง โดยภาพรวมมุ่งศึกษาการเรียนการสอนภาษาอังกฤษในบริบทไทย";
  assert.equal(leadsWithDirectAnswer(thai).ok, true);
});

test("the window a reader should not have to get past is stated once", () => {
  assert.equal(DIRECT_ANSWER_WINDOW, 200);
});

/* --------------------------------------------------- the renderer matches the list */

test("every construct the checks call supported is implemented by the renderer", () => {
  // If these drift, the checks pass answers the renderer then leaks at readers.
  const source = client();
  assert.match(source, /token\.startsWith\("\*\*"\)/, "bold");
  assert.match(source, /<em key=/, "italic");
  assert.match(source, /<s key=/, "strikethrough");
  assert.match(source, /<code$/m, "inline code");
  assert.match(source, /isMarkdownTable/, "tables");
  assert.match(source, /<blockquote/, "blockquote");
});

test("the renderer draws italics and strikethrough, so they are not leaked markup", () => {
  // Both were previously unimplemented, so `*word*` reached the reader as
  // asterisks. They are now drawn, which is why they are absent from the
  // unsupported list.
  assert.deepEqual(unsupportedMarkdown("A *moderate* and ~~small~~ effect."), []);
});

/* ---------------------------------------------------------- the whole-answer view */

test("a clean answer reports no issues at all", () => {
  const answer = [
    "The five papers study English teaching in Thai classrooms.",
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
  assert.deepEqual(renderingIssues(answer), []);
});

test("an answer with several faults reports each of them", () => {
  const answer = [
    "## One",
    "## Two",
    "<b>bold</b>",
    "| A | B |",
    "| --- | --- |",
    "| 1 |",
  ].join("\n");
  const kinds = new Set(renderingIssues(answer).map((issue) => issue.kind));
  assert.ok(kinds.has("empty-section"));
  assert.ok(kinds.has("unsupported-markdown"));
  assert.ok(kinds.has("broken-table"));
});
