/*
 * Checking every paper against a question's condition (paper-screening.ts,
 * docs/36): the model's labels map back to papers, a sentence the paper does
 * not contain is dropped, a batch that fails is reported, and papers keep
 * their order. No model is called: the reply is scripted.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { screenMessages, screenPapers, SCREEN_CHARS } from "../src/lib/paper-screening";
import { asksForPaperLength } from "../src/lib/repository-chat";
import type { ReadablePaper } from "../src/lib/paper-reading";

function paper(index: number, body: string): ReadablePaper {
  return {
    paperId: `p${index}`,
    title: `Study ${index}`,
    year: String(2010 + index),
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    content: body,
    contentSource: "full_text",
  };
}

const PAPERS = [
  paper(1, "This study used a one-group pretest-posttest design with 24 students in grade 10."),
  paper(2, "A questionnaire survey of 97 teachers was conducted across one district."),
  paper(3, "The study employed a pretest and a posttest with 35 undergraduates over 12 weeks."),
];

type Complete = NonNullable<Parameters<typeof screenPapers>[0]["complete"]>;
const reply = (content: unknown, calls: unknown[][] = []): Complete =>
  (async (...args: unknown[]) => {
    calls.push(args);
    return { content: typeof content === "string" ? content : JSON.stringify(content), annotations: [], toolCalls: [], model: "test" };
  }) as unknown as Complete;

test("every paper is checked and each match comes back to its paper, in order, with its sentence only if the paper has it", async () => {
  const calls: unknown[][] = [];
  const result = await screenPapers({
    papers: PAPERS,
    question: "Which studies used a pretest-posttest design?",
    condition: "used a pretest-posttest design",
    answerLanguage: "English",
    complete: reply({
      matches: [
        { paper: "P3", detail: "Pretest and posttest, 35 undergraduates, 12 weeks", quote: "The study employed a pretest and a posttest with 35 undergraduates over 12 weeks." },
        { paper: "[P1]", detail: "One-group pretest-posttest, 24 students", quote: "This study used a randomised controlled trial with 400 pupils." },
        { paper: "P9", detail: "not a paper in the batch", quote: "" },
        { paper: "P3", detail: "a second time", quote: "" },
      ],
    }, calls),
  });
  assert.equal(calls.length, 1, "three papers are one call");
  assert.equal(calls[0][3], "CHAT_SCREEN");
  assert.deepEqual(result.matches.map((match) => match.paperId), ["p1", "p3"], "in the papers' order, each once, unknown labels dropped");
  assert.equal(result.matches[0].quote, "", "a sentence the paper does not contain is dropped");
  assert.match(result.matches[1].quote, /35 undergraduates/);
  assert.equal(result.screened, 3);
  assert.deepEqual(result.failed, []);
  const sent = String((calls[0][0] as Array<{ content: string }>)[1].content);
  for (const study of PAPERS) assert.ok(sent.includes(study.title), "each paper is in the request");
  assert.ok(!sent.includes("p1"), "no database id reaches the model");
});

test("a batch that cannot be read is reported, not treated as no match", async () => {
  const many = Array.from({ length: 14 }, (_, index) => paper(index + 1, `Paper ${index + 1} text about assessment.`));
  let call = 0;
  const complete = (async () => {
    call += 1;
    return { content: call === 1 ? "not json at all" : JSON.stringify({ matches: [{ paper: "P1", detail: "about assessment", quote: "" }] }), annotations: [], toolCalls: [] };
  }) as unknown as Complete;
  const result = await screenPapers({ papers: many, question: "Which are about assessment?", condition: "about assessment", answerLanguage: "English", complete });
  assert.equal(call, 2, "twelve papers to a call");
  assert.equal(result.failed.length, 12, "the unreadable batch's papers are reported");
  assert.deepEqual(result.matches.map((match) => match.paperId), ["p13"]);
});

test("the request is short per paper and asks for the reader's language", () => {
  const messages = screenMessages({
    question: "งานวิจัยใดบ้างที่ใช้แบบสอบถาม",
    condition: "ใช้แบบสอบถาม",
    answerLanguage: "Thai",
    papers: [{ label: "P1", title: "Study 1", year: "2020", text: "x".repeat(10) }],
  });
  assert.match(messages[0].content, /Write each detail in Thai/);
  assert.match(messages[0].content, /never through a study it cites/);
  assert.ok(SCREEN_CHARS <= 5_000, "a short share of each paper keeps the check cheap");
});

test("a question about a paper's length is counted, not read", () => {
  for (const question of ["Which paper is the longest?", "Which is the shortest paper?", "Which papers have the most words?", "งานวิจัยเรื่องไหนยาวที่สุด"]) {
    assert.ok(asksForPaperLength(question), question);
  }
  for (const question of ["Which study had the largest sample?", "Which intervention lasted the longest?", "What is the longest-running study design?"]) {
    assert.ok(!asksForPaperLength(question), question);
  }
});

test("a match whose short read did not give what the question asks is read again, longer, for that detail only", async () => {
  const long = paper(4, `${"Background on writing instruction. ".repeat(400)}The participants were 20 Grade 11 students, taught for eight weeks.`);
  const requests: string[] = [];
  const complete = (async (messages: Array<{ content: string }>) => {
    requests.push(messages[1].content);
    const content = requests.length === 1
      ? { matches: [{ paper: "P1", detail: "not in the part read", quote: "" }, { paper: "P2", detail: "35 students; 12 weeks", quote: "" }] }
      : { details: [{ paper: "P1", detail: "20 Grade 11 students; eight weeks" }] };
    return { content: JSON.stringify(content), annotations: [], toolCalls: [] };
  }) as unknown as Complete;
  const result = await screenPapers({
    papers: [long, PAPERS[2]],
    question: "Make a table of the writing studies with their participants and duration.",
    condition: "writing intervention studies",
    answerLanguage: "English",
    complete,
  });
  assert.equal(requests.length, 2, "one more call, for the thin detail");
  assert.ok(!requests[1].includes("Study 3"), "a paper whose detail was given is not read again");
  assert.ok(requests[1].includes("20 Grade 11 students"), "the longer read reaches the passage");
  assert.deepEqual(result.matches.map((match) => match.detail), ["20 Grade 11 students; eight weeks", "35 students; 12 weeks"]);
});

test("a word that names what to count is not itself counted, unless the reader quoted it", async () => {
  const { countableTerms } = await import("../src/lib/repository-chat");
  assert.deepEqual(countableTerms(["keywords"], "Show the top keywords."), []);
  assert.deepEqual(countableTerms(["Terms", "motivation", " "], "Which terms appear, and how often does motivation?"), ["motivation"]);
  assert.deepEqual(countableTerms(["keywords"], "How often does the word 'keywords' appear?"), ["keywords"]);
});

test("a detail that repeats the paper's title loses it, whole or cut short", async () => {
  const { withoutTitle } = await import("../src/lib/paper-screening");
  const title = "Effects of Integrated Performance Assessment Modules on English Speaking Ability of Thai EFL Undergraduate Students";
  assert.equal(withoutTitle("Effects of Integrated Performance Assessment Modules on English Speaking Ability of Thai", title), "", "only the title, cut short");
  assert.equal(withoutTitle(`${title} — used a one-group pretest-posttest design.`, title), "used a one-group pretest-posttest design.");
  assert.equal(withoutTitle("Used a one-group pretest-posttest design with 33 students.", title), "Used a one-group pretest-posttest design with 33 students.");
  assert.equal(withoutTitle("Effects were large (r = .62).", title), "Effects were large (r = .62).", "a detail that only starts like the title keeps its words");
});
