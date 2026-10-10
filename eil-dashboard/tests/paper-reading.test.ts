/*
 * How much of each paper an answer reads (paper-reading.ts): whole papers when
 * they fit the effort's budget, else a fair share of each - its abstract and the
 * passages that bear on the question, in reading order - never its references.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { READING_BUDGET, paperParts, readPapers, type ReadablePaper } from "../src/lib/paper-reading";
import { withoutOpeningLabel } from "../src/lib/answer-rendering";
import { composeAnswerSection } from "../src/lib/repository-chat";

function filler(topic: string, sentences: number): string {
  return Array.from({ length: sentences }, (_, index) => `This sentence ${index + 1} is about ${topic} and nothing else of note.`).join(" ");
}

function article(id: string, body: { methods?: string; results?: string } = {}): ReadablePaper {
  const content = [
    "A Study of Something",
    "",
    "Abstract",
    "We studied pronunciation of English plosives by Thai learners and found long-lag voice onset time.",
    "",
    "1. Introduction",
    filler("background reading", 40),
    "",
    "2. Methods",
    body.methods ?? `Forty-nine seventh-grade students read a word list. ${filler("procedure", 30)}`,
    "",
    "3. Results",
    body.results ?? `Voiceless plosives had a mean VOT of 62 ms. ${filler("outcomes", 30)}`,
    "",
    "4. Conclusion",
    "Teachers should model aspiration explicitly.",
    "",
    "References",
    "Lisker, L., & Abramson, A. S. (1964). A cross-language study of voicing in initial stops. Word, 20(3), 384-422.",
  ].join("\n");
  return {
    paperId: id,
    title: `Paper ${id}`,
    year: "2025",
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    content,
    contentSource: "full_text",
  };
}

test("a paper is laid out by its sections as printed, without its references", () => {
  const parts = paperParts(article("1"));
  assert.deepEqual(parts.map((part) => part.label), ["Title page", "Abstract", "1. Introduction", "2. Methods", "3. Results", "4. Conclusion"]);
  assert.ok(parts.every((part) => !/Lisker/.test(part.text)), "the reference list is not read");
});

test("a paper without full text is read from its four stored parts", () => {
  const stored: ReadablePaper = { ...article("2"), content: "", contentSource: "extracted_sections", abstract: "An abstract.", methods: "", results: "Gains.", conclusion: "" };
  assert.deepEqual(paperParts(stored), [
    { label: "Abstract", text: "An abstract." },
    { label: "Results", text: "Gains." },
  ]);
});

test("papers that fit the budget are read whole", () => {
  const readings = readPapers([article("1"), article("2")], ["voice onset time"], READING_BUDGET.medium);
  assert.ok(readings.every((reading) => reading.whole));
  assert.match(readings[0].text, /### 2\. Methods\nForty-nine seventh-grade students/);
  assert.match(readings[0].text, /### 4\. Conclusion\nTeachers should model aspiration explicitly\./);
});

test("over budget, each paper keeps its abstract and the passages that answer the question, in reading order", () => {
  const papers = [article("1"), article("2"), article("3")];
  const budget = 3_000;
  const readings = readPapers(papers, ["mean VOT of voiceless plosives"], budget);
  const total = readings.reduce((sum, reading) => sum + reading.text.length, 0);
  assert.ok(total <= budget + 600, `about the budget, not ${total}`);
  for (const reading of readings) {
    assert.equal(reading.whole, false);
    assert.match(reading.text, /### Abstract\nWe studied pronunciation/);
    assert.match(reading.text, /mean VOT of 62 ms/, "the passage that answers the question is read");
    assert.ok(reading.text.indexOf("### Abstract") < reading.text.indexOf("### 3. Results"), "in reading order");
    assert.match(reading.text, /\[…\]/, "left-out text is marked");
  }
});

test("a short paper is read whole and leaves its share to a long one", () => {
  const short: ReadablePaper = { ...article("s"), content: "Abstract\nShort.\n\nMethods\nA survey.\n\nResults\nGains.\n\nConclusion\nDone." };
  const long = article("l", { results: `Voiceless plosives had a mean VOT of 62 ms. ${filler("outcomes", 400)}` });
  const readings = readPapers([short, long], ["outcomes"], 8_000);
  assert.equal(readings[0].whole, true);
  assert.equal(readings[1].whole, false);
  assert.ok(readings[1].text.length > 6_000, "the long paper gets what the short one did not need");
});

test("a heading that only labels the opening is dropped", () => {
  assert.equal(withoutOpeningLabel("## Direct answer\n\nThe studies differ."), "The studies differ.");
  assert.equal(withoutOpeningLabel("## Summary:\nGains."), "Gains.");
  assert.equal(withoutOpeningLabel("## Methods by theme\n\nThe studies differ."), "## Methods by theme\n\nThe studies differ.");
  assert.equal(withoutOpeningLabel("## Direct answer"), "## Direct answer", "nothing is left to show otherwise");
});

test("in a reply of several parts, the first part is the answer and needs no label", () => {
  assert.equal(composeAnswerSection("What the papers say", "The papers agree.", 2, 0), "The papers agree.");
  assert.equal(composeAnswerSection("The chart", "Most use surveys.", 2, 1), "## The chart\n\nMost use surveys.");
});
