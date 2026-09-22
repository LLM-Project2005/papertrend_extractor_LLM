import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CITATION_TITLE_MAX,
  FOLD_THRESHOLD_CHARS,
  citationLabel,
  foldPoint,
  markCitations,
} from "../src/lib/answer-citations";
import {
  ANSWER_BODY_CLASS,
  ANSWER_BODY_FONT_PX,
  ANSWER_BODY_LINE_PX,
  MIN_THAI_LINE_HEIGHT_RATIO,
  answerLineHeightRatio,
  metaLineHeightRatio,
  metaSmLineHeightRatio,
} from "../src/lib/answer-typography";

function client(): string {
  return readFileSync(
    new URL("../src/components/chat/ChatClient.tsx", import.meta.url),
    "utf8"
  );
}

const READING = {
  paperId: "12",
  title: "Effects of Personal Intelligence Reading Instruction",
  year: "2016",
  href: "/workspace/papers/12",
};
const AUTONOMY = {
  paperId: "7",
  title: "Enhancing Learner Autonomy amongst Young EFL Learners in a Rural Area",
  year: "2017",
  href: "/workspace/papers/7",
};

/* ------------------------------------------------------------------ the label */

test("the label matches what the server writes into an answer", () => {
  assert.equal(citationLabel(READING), "Effects of Personal Intelligence Reading Instruction, 2016");
});

test("a long title is shortened with an ellipsis, not cut mid-word run", () => {
  const label = citationLabel(AUTONOMY);
  assert.ok(label.length <= CITATION_TITLE_MAX + ", 2017".length);
  assert.match(label, /…, 2017$/);
});

test("a paper with no usable year carries none", () => {
  assert.equal(citationLabel({ title: "Untitled study", year: "Unknown" }), "Untitled study");
  assert.equal(citationLabel({ title: "Untitled study", year: null }), "Untitled study");
});

test("an empty title still produces something a reader can see", () => {
  assert.equal(citationLabel({ title: "   ", year: "2016" }), "Untitled paper, 2016");
});

test("the server writes labels through this same function", () => {
  // Matching is by exact string, so a divergence of one character would leave
  // the parenthetical in place with no footnote and no error anywhere.
  const server = readFileSync(
    new URL("../src/lib/repository-chat.ts", import.meta.url),
    "utf8"
  );
  assert.match(server, /import \{ citationLabel \} from "@\/lib\/answer-citations"/);
  assert.equal(
    /function citationLabel\s*\(/.test(server),
    false,
    "the server must not keep its own copy of the label"
  );
});

/* ------------------------------------------------------------------ the markers */

test("a single citation becomes a numbered marker", () => {
  const answer = `The study reported gains (${citationLabel(READING)}).`;
  const { text, sources } = markCitations(answer, [READING]);
  assert.equal(text, "The study reported gains [[cite:1]].");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].number, 1);
  assert.equal(sources[0].title, READING.title);
});

test("two citations in one parenthetical become one marker naming both", () => {
  const answer = `Both agree (${citationLabel(READING)}; ${citationLabel(AUTONOMY)}).`;
  const { text, sources } = markCitations(answer, [READING, AUTONOMY]);
  assert.equal(text, "Both agree [[cite:1,2]].");
  assert.equal(sources.length, 2);
});

test("the same paper cited twice keeps one number", () => {
  const label = citationLabel(READING);
  const answer = `First (${label}). Then again (${label}).`;
  const { text, sources } = markCitations(answer, [READING]);
  assert.equal(text, "First [[cite:1]]. Then again [[cite:1]].");
  assert.equal(sources.length, 1);
});

test("numbering follows the order the reader meets them", () => {
  // Retrieval order is not reading order, and the reader only sees the latter.
  const answer = `A (${citationLabel(AUTONOMY)}) then B (${citationLabel(READING)}).`;
  const { sources } = markCitations(answer, [READING, AUTONOMY]);
  assert.equal(sources[0].paperId, AUTONOMY.paperId);
  assert.equal(sources[1].paperId, READING.paperId);
});

test("ordinary parentheses are left alone", () => {
  const answer = "The gain was small (about four points) overall.";
  const { text, sources } = markCitations(answer, [READING]);
  assert.equal(text, answer);
  assert.deepEqual(sources, []);
});

test("a parenthetical naming an uncited paper is left as written", () => {
  // Better to show the reader the title than to swallow it into nothing.
  const answer = "The study reported gains (Some Other Paper, 1999).";
  assert.equal(markCitations(answer, [READING]).text, answer);
});

test("an answer with no citations passes through untouched", () => {
  assert.deepEqual(markCitations("Plain text.", []), { text: "Plain text.", sources: [] });
  assert.equal(markCitations("", [READING]).text, "");
});

test("a title containing regex characters does not break the match", () => {
  const tricky = { paperId: "9", title: "Reading (L2) + Writing [a study]", year: "2018", href: "/x" };
  const answer = `Found (${citationLabel(tricky)}).`;
  assert.equal(markCitations(answer, [tricky]).text, "Found [[cite:1]].");
});

test("a title that is a prefix of another matches the right paper", () => {
  const short = { paperId: "1", title: "Reading instruction", year: "2016", href: "/a" };
  const long = { paperId: "2", title: "Reading instruction and feedback", year: "2016", href: "/b" };
  const answer = `A (${citationLabel(long)}).`;
  const { sources } = markCitations(answer, [short, long]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].paperId, "2");
});

/* --------------------------------------------------------------------- the fold */

test("a short answer is never folded", () => {
  assert.equal(foldPoint("Short answer."), null);
  assert.equal(foldPoint("x".repeat(FOLD_THRESHOLD_CHARS)), null);
});

test("a long answer folds, leaving the opening visible", () => {
  const answer = `${"Sentence one. ".repeat(400)}`;
  const cut = foldPoint(answer);
  assert.ok(cut !== null);
  assert.ok(cut! > 0 && cut! < answer.length, "the fold must hide something and show something");
});

test("the fold prefers a paragraph break so it does not split a thought", () => {
  const head = "A".repeat(900);
  const answer = `${head}\n\n${"tail ".repeat(500)}`;
  assert.equal(foldPoint(answer), head.length);
});

test("the fold falls back to a sentence end when there is no paragraph break", () => {
  const answer = `${"word ".repeat(150)}. ${"more ".repeat(500)}`;
  const cut = foldPoint(answer);
  assert.ok(cut !== null);
  assert.equal(answer[cut! - 1], ".");
});

test("the visible part is never collapsed to almost nothing", () => {
  // A paragraph break in the first few characters must not win, or the reader
  // sees one line and a Show more button.
  const answer = `Intro.\n\n${"body ".repeat(1000)}`;
  const cut = foldPoint(answer);
  assert.ok(cut !== null && cut! > 100, `fold cut at ${cut}, which shows almost nothing`);
});

test("the direct answer is always on the visible side of the fold", () => {
  // The opening 200 characters are what directness is judged on, so the fold
  // must never hide them.
  const answer = `${"The five papers study English teaching. ".repeat(100)}`;
  const cut = foldPoint(answer);
  assert.ok(cut !== null && cut! >= 200);
});

/* --------------------------------------------------------------- the typography */

test("the answer body clears the Thai line-height floor", () => {
  // Thai stacks vowels and tone marks above and below the base character, so a
  // line height that suits Latin text crowds it.
  assert.ok(
    answerLineHeightRatio() >= MIN_THAI_LINE_HEIGHT_RATIO,
    `ratio ${answerLineHeightRatio()} is below ${MIN_THAI_LINE_HEIGHT_RATIO}`
  );
  assert.equal(ANSWER_BODY_FONT_PX, 15);
  assert.equal(ANSWER_BODY_LINE_PX, 32);
});

test("answer text is allowed to wrap rather than widen its column", () => {
  // Thai has no spaces between words, and a long Latin run - a URL, a DOI -
  // has no break opportunity at all.
  assert.match(ANSWER_BODY_CLASS, /break-words/);
});

test("the chat page uses the shared body class rather than its own spacing", () => {
  const source = client();
  assert.match(source, /ANSWER_BODY_CLASS/);
  assert.equal(
    /leading-7/.test(source),
    false,
    "leading-7 is below the Thai floor and must not be used for text"
  );
});

test("text that can carry Thai clears the floor; fixed English chrome need not", () => {
  // The first version of this test banned every tight line height on the page
  // and failed on "Sources: 3 total" and an empty-state line - fixed English
  // copy that no Thai ever reaches. The rule is about content, not spelling.
  assert.ok(metaLineHeightRatio() >= MIN_THAI_LINE_HEIGHT_RATIO);
  assert.ok(metaSmLineHeightRatio() >= MIN_THAI_LINE_HEIGHT_RATIO);

  const source = client();
  const contentSlots = [
    "{citation.reason}",
    "{deepSession.plan_summary}",
    "{stepBody}",
    "{item.snippet}",
  ];
  // A regex, not a string: these files are CRLF on this machine.
  const lines = source.split(/\r?\n/);
  for (const slot of contentSlots) {
    const index = lines.findIndex((line) => line.includes(slot));
    assert.ok(index > 0, `${slot} not found`);
    const className = [lines[index - 1], lines[index]].join(" ");
    assert.ok(
      /ANSWER_META_CLASS|ANSWER_META_SM_CLASS|ANSWER_BODY_CLASS/.test(className),
      `${slot} renders model or paper text but does not use a shared class: ${className.trim().slice(0, 110)}`
    );
  }
});

/* --------------------------------------------------- the marker reaches the page */

test("the renderer draws the marker rather than printing it", () => {
  const source = client();
  assert.match(source, /token\.startsWith\("\[\[cite:"\)/);
  assert.match(source, /function CitationMarker/);
});

test("the marker opens its source on keyboard focus, not only on hover", () => {
  const source = client();
  const marker = source.slice(source.indexOf("function CitationMarker"));
  assert.match(marker.slice(0, 2600), /group-focus-within:block/);
  assert.match(marker.slice(0, 2600), /aria-label=/);
});

test("the fold is offered only when there is something folded", () => {
  const source = client();
  const answer = source.slice(source.indexOf("function AssistantAnswer"));
  assert.match(answer.slice(0, 2600), /cut !== null \? \(/);
  assert.match(answer.slice(0, 2600), /aria-expanded=\{expanded\}/);
});
