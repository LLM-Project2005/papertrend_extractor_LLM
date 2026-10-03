import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownActions from "../src/components/chat/MarkdownActions";
import { citationLabel } from "../src/lib/answer-citations";
import { answerMarkdown, conversationMarkdown, isFinishedAnswer, markdownFileName, type ExportMessage } from "../src/lib/answer-export";

/** Every chat answer copies and downloads with its references; a conversation exports whole (docs/32, 4.2). */

const READING = { paperId: "12", title: "Effects of Reading Instruction", year: "2016", href: "/workspace/library?paperId=12" };
const WRITING = { paperId: "34", title: "Peer Feedback in EFL Writing", year: "2019", href: "/workspace/library?paperId=34" };
const WEB = { paperId: "Web 1", title: "Ministry guidance", year: "Web", href: "https://example.org/guidance", sourceType: "web" as const };
const cite = (paper: { title: string; year: string }) => `(${citationLabel(paper)})`;

test("an answer copies with its citations numbered, its sources listed and its limitations kept", () => {
  const content = `Reading gains were reported ${cite(READING)}. Feedback helped ${cite(WRITING)}; so did guidance ${cite(WEB)}.`;
  const markdown = answerMarkdown(content, [READING, WRITING, WEB], {
    repositoryLimitations: ["Only 2 of 41 papers report effect sizes."],
    charts: [{ title: "Papers per year" }],
  });
  assert.match(markdown, /^Reading gains were reported \[1\]\. Feedback helped \[2\]; so did guidance \[3\]\./);
  assert.match(markdown, /_Chart in the app: Papers per year_/);
  assert.match(markdown, /\*\*Limitations:\*\*\n\n- Only 2 of 41 papers report effect sizes\./);
  assert.match(
    markdown,
    /## Sources\n\n1\. Effects of Reading Instruction \(2016\)\.\n2\. Peer Feedback in EFL Writing \(2019\)\.\n3\. Ministry guidance\. https:\/\/example\.org\/guidance\n$/
  );
});

test("an 18-digit paper id stored as a number still finds its citation (read from the link)", () => {
  const id = "654436454321652795";
  const paper = { paperId: Number(id), title: "A paper with a long id", year: "2020", href: `/workspace/library?paperId=${id}` };
  const markdown = answerMarkdown(`A finding [Paper ${id}].`, [paper]);
  assert.match(markdown, /^A finding \[1\]\./);
  assert.match(markdown, /1\. A paper with a long id \(2020\)\./);
});

test("a conversation exports in order, with one source list numbered across it", () => {
  const messages: ExportMessage[] = [
    { role: "user", content: "What do the papers say about reading?", citations: [], metadata: { attachments: [{ name: "notes.pdf" }] } },
    { role: "assistant", kind: "chat", content: `Gains were reported ${cite(READING)}.`, citations: [READING] },
    { role: "assistant", kind: "status", content: "Working on it…", citations: [] },
    { role: "user", content: "And writing?", citations: [] },
    {
      role: "assistant",
      kind: "chat",
      content: `Feedback helped ${cite(WRITING)}, as with reading ${cite(READING)}.`,
      citations: [WRITING, READING],
    },
    { role: "assistant", kind: "deep_research_report", content: `## Findings\n\nGuidance agrees ${cite(WEB)}.`, citations: [WEB] },
  ];
  const markdown = conversationMarkdown({ title: "Reading and writing", messages, exportedAt: new Date("2026-10-02T09:00:00Z") });
  assert.match(markdown, /^# Reading and writing\n\nExported from Papertrend on 2026-10-02\./);
  assert.match(markdown, /## You\n\nWhat do the papers say about reading\?\n\n_Attached: notes\.pdf_/);
  assert.match(markdown, /## Papertrend\n\nGains were reported \[1\]\./);
  assert.match(markdown, /Feedback helped \[2\], as with reading \[1\]\./, "a source cited again keeps its number");
  assert.match(markdown, /## Deep research report\n\n## Findings\n\nGuidance agrees \[3\]\./);
  assert.doesNotMatch(markdown, /Working on it/, "status messages are not part of the conversation");
  assert.equal((markdown.match(/## Sources/g) ?? []).length, 1);
  assert.match(markdown, /## Sources\n\n1\. Effects of Reading Instruction \(2016\)\.\n2\. Peer Feedback in EFL Writing \(2019\)\.\n3\. Ministry guidance\. https:\/\/example\.org\/guidance\n$/);
  // Questions come before their answers.
  assert.ok(markdown.indexOf("And writing?") < markdown.indexOf("Feedback helped"));
});

test("file names keep Thai and drop punctuation", () => {
  assert.equal(markdownFileName("What do the papers say about reading?"), "what-do-the-papers-say-about-reading.md");
  assert.equal(markdownFileName("การอ่าน: ผลการวิจัย"), "การอ่าน-ผลการวิจัย.md");
  assert.equal(markdownFileName("???", "papertrend-answer"), "papertrend-answer.md");
});

test("the actions render as two labelled buttons", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownActions, { markdown: () => "x", fileName: "a.md", copyLabel: "Copy", label: "Answer actions", compact: true })
  );
  assert.match(html, /role="group" aria-label="Answer actions"/);
  assert.equal((html.match(/<button type="button"/g) ?? []).length, 2);
  assert.match(html, />Copy<\/span>/);
  assert.match(html, /Download \(\.md\)/);
});

test("only a finished answer has the actions; a background answer still being written does not", () => {
  const pending = { kind: "status", content: "Analyzing the selected Papertrend knowledge scope in the background...", metadata: { repositoryJobStatus: "processing" } };
  assert.equal(isFinishedAnswer(pending), false);
  assert.equal(isFinishedAnswer({ ...pending, kind: "chat" }), false, "a running job, whatever its kind");
  assert.equal(isFinishedAnswer({ ...pending, kind: "chat", metadata: { repositoryJobStatus: "queued" } }), false);
  assert.equal(isFinishedAnswer({ kind: "chat", content: "Most papers are quasi-experimental.", metadata: { repositoryJobStatus: "succeeded" } }), true);
  assert.equal(isFinishedAnswer({ kind: "chat", content: "An answer.", metadata: null }), true);
  assert.equal(isFinishedAnswer({ kind: "deep_research_report", content: "# Report", metadata: {} }), true);
  assert.equal(isFinishedAnswer({ kind: "deep_research_plan", content: "1. Gather", metadata: {} }), false);
  assert.equal(isFinishedAnswer({ kind: "chat", content: "   ", metadata: {} }), false);
  const markdown = conversationMarkdown({
    title: "Methods",
    exportedAt: new Date("2026-10-02T00:00:00Z"),
    messages: [
      { role: "user", content: "Which methods?", citations: [] },
      { role: "assistant", ...pending, citations: [] },
    ],
  });
  assert.doesNotMatch(markdown, /in the background/, "nor is it exported");
  assert.match(markdown, /## You\n\nWhich methods\?/);
});

// That the chat page gives every finished answer these actions, and exports a
// conversation's every page from its menu, runs in small-fixes2-behaviour-chat.test.ts.
