import assert from "node:assert/strict";
import test from "node:test";
import {
  ANSWER_FORMAT_RULES,
  MAX_PARAGRAPH_CHARS,
  countBold,
  countBullets,
  countHeadings,
  countTableRows,
  isReadable,
  readabilityInstruction,
  readabilityIssues,
} from "../src/lib/answer-readability";

const SENTENCE = "This study examined teacher attitudes toward communicative English teaching in Thai classrooms. ";

function wall(chars: number): string {
  return SENTENCE.repeat(Math.ceil(chars / SENTENCE.length)).slice(0, chars);
}

test("a single wall of text is flagged", () => {
  // Live regression: a 2,812-character corpus summary arrived as one paragraph.
  const issues = readabilityIssues(wall(2_812));
  assert.ok(issues.some((issue) => issue.kind === "long_paragraph"));
  assert.ok(issues.some((issue) => issue.kind === "no_structure"));
});

test("a long answer with no bullets, headings or table is flagged", () => {
  const answer = [wall(500), wall(500)].join("\n\n");
  const issues = readabilityIssues(answer);
  assert.ok(issues.some((issue) => issue.kind === "no_structure"));
});

test("a long answer with no emphasis is flagged", () => {
  // Live regression: an 11,970-character topic answer contained no bold at all.
  const answer = ["## Findings", wall(600), wall(500), "- one", "- two", "- three"].join("\n\n");
  const issues = readabilityIssues(answer);
  assert.ok(issues.some((issue) => issue.kind === "no_emphasis"));
});

test("a well-shaped answer raises no issues", () => {
  const answer = [
    "The five papers all study English language teaching in Thai classrooms.",
    "## What they examined",
    "- **Reading assessment** in two of the papers",
    "- **Learner autonomy** in a rural setting",
    "- **Pronunciation rhythm** and its effect on comprehensibility",
    "The strongest shared finding is that **context-sensitive instruction** matters more than method choice.",
  ].join("\n\n");
  assert.deepEqual(readabilityIssues(answer), []);
  assert.equal(isReadable(answer), true);
});

test("short answers are never forced to add structure", () => {
  const short = "No paper about quantum cryptography appears in this repository.";
  assert.deepEqual(readabilityIssues(short), []);
  assert.equal(isReadable(short), true);
});

test("a long table or bullet block is not mistaken for a wall of text", () => {
  const rows = Array.from({ length: 40 }, (_, index) => `| Paper ${index} | ${index * 100} |`);
  const answer = ["## Word count per paper", "| Paper | Words |", "| --- | ---: |", ...rows].join("\n");
  const issues = readabilityIssues(answer);
  assert.ok(!issues.some((issue) => issue.kind === "long_paragraph"), "table rows are scannable");
  assert.ok(!issues.some((issue) => issue.kind === "no_structure"), "a table is structure");
});

test("a heading line is never counted as an overlong paragraph", () => {
  const answer = `## ${"A very long heading ".repeat(50)}`;
  assert.ok(!readabilityIssues(answer).some((issue) => issue.kind === "long_paragraph"));
});

test("the paragraph threshold is applied at the boundary", () => {
  const under = wall(MAX_PARAGRAPH_CHARS - 1);
  const over = wall(MAX_PARAGRAPH_CHARS + 1);
  assert.ok(!readabilityIssues(under).some((issue) => issue.kind === "long_paragraph"));
  assert.ok(readabilityIssues(over).some((issue) => issue.kind === "long_paragraph"));
});

test("counters recognise each structural element", () => {
  const answer = [
    "## Heading",
    "- bullet one",
    "1. numbered one",
    "| a | b |",
    "Some **bold** text and **more bold**.",
  ].join("\n");
  assert.equal(countHeadings(answer), 1);
  assert.equal(countBullets(answer), 2);
  assert.equal(countTableRows(answer), 1);
  assert.equal(countBold(answer), 2);
});

test("the rewrite instruction names each problem concretely", () => {
  const instruction = readabilityInstruction(readabilityIssues(wall(2_500)));
  assert.match(instruction, /hard to read/);
  assert.match(instruction, /exceed 700 characters/);
  assert.match(instruction, /without changing any claim, citation or number/);
});

test("no instruction is produced for a readable answer", () => {
  assert.equal(readabilityInstruction([]), "");
});

test("the house style names the rules an answer is judged against", () => {
  assert.match(ANSWER_FORMAT_RULES, /direct answer/i);
  assert.match(ANSWER_FORMAT_RULES, /bulleted list/i);
  assert.match(ANSWER_FORMAT_RULES, /table/i);
  assert.match(ANSWER_FORMAT_RULES, /Bold/);
  assert.match(ANSWER_FORMAT_RULES, new RegExp(String(MAX_PARAGRAPH_CHARS)));
});

test("Thai answers are held to the same shape rules", () => {
  const thaiWall = "การศึกษานี้มุ่งเน้นการใช้ภาษาอังกฤษเป็นภาษานานาชาติในห้องเรียนไทย ".repeat(30);
  const issues = readabilityIssues(thaiWall);
  assert.ok(issues.some((issue) => issue.kind === "long_paragraph"));
});

test("empty input is handled without issues", () => {
  assert.deepEqual(readabilityIssues(""), []);
  assert.deepEqual(readabilityIssues("   "), []);
});
