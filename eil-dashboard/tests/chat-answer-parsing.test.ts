import assert from "node:assert/strict";
import test from "node:test";
import { parseGroundedAnswer, parseFaithfulnessAudit, readableAnswerText } from "../src/lib/repository-chat";

test("a word confidence is accepted instead of failing the whole parse", () => {
  // Live regression: the model answered confidence "Moderate", both schemas
  // rejected it, and the raw JSON envelope was shown to the reader.
  const parsed = parseGroundedAnswer(
    JSON.stringify({ answer: "Grounded text.", confidence: "Moderate", citedPaperIds: ["1"] })
  );
  assert.ok(parsed, "a word confidence must still parse");
  assert.equal(parsed!.answer, "Grounded text.");
  assert.ok(parsed!.confidence > 0.5 && parsed!.confidence < 0.8);
});

test("confidence words map across the range", () => {
  const high = parseGroundedAnswer(JSON.stringify({ answer: "a", confidence: "high" }))!;
  const low = parseGroundedAnswer(JSON.stringify({ answer: "a", confidence: "low" }))!;
  assert.ok(high.confidence > low.confidence);
});

test("a numeric string and a percentage are both accepted", () => {
  assert.equal(parseGroundedAnswer(JSON.stringify({ answer: "a", confidence: "0.8" }))!.confidence, 0.8);
  assert.equal(parseGroundedAnswer(JSON.stringify({ answer: "a", confidence: "80" }))!.confidence, 0.8);
});

test("an unrecognised confidence falls back to neutral rather than failing", () => {
  const parsed = parseGroundedAnswer(JSON.stringify({ answer: "a", confidence: "banana" }));
  assert.ok(parsed);
  assert.equal(parsed!.confidence, 0.5);
});

test("limitations given as a sentence are accepted as a list", () => {
  const parsed = parseGroundedAnswer(
    JSON.stringify({ answer: "a", limitations: "Only partial evidence was available." })
  );
  assert.ok(parsed);
  assert.deepEqual(parsed!.limitations, ["Only partial evidence was available."]);
});

test("a missing answer is still rejected", () => {
  assert.equal(parseGroundedAnswer(JSON.stringify({ confidence: 0.9 })), null);
  assert.equal(parseGroundedAnswer("not json at all"), null);
});

test("the audit accepts string booleans without inverting them", () => {
  const yes = parseFaithfulnessAudit(
    JSON.stringify({ supported: "true", answersIntent: "true", completeForRequest: "true", languageMatched: "true" })
  );
  assert.ok(yes);
  assert.equal(yes!.supported, true);

  // The critical case: "false" must not become true.
  const no = parseFaithfulnessAudit(
    JSON.stringify({ supported: "false", answersIntent: "true", completeForRequest: "true", languageMatched: "true" })
  );
  assert.ok(no);
  assert.equal(no!.supported, false);
});

test("readable text is recovered from a JSON envelope", () => {
  assert.equal(
    readableAnswerText(JSON.stringify({ answer: "The real answer.", confidence: "Moderate" })),
    "The real answer."
  );
  assert.equal(
    readableAnswerText(JSON.stringify({ correctedAnswer: "The corrected answer." })),
    "The corrected answer."
  );
});

test("plain prose passes through untouched", () => {
  assert.equal(readableAnswerText("## Findings\n\nPlain markdown."), "## Findings\n\nPlain markdown.");
});

test("a JSON object with no readable field yields nothing rather than raw JSON", () => {
  assert.equal(readableAnswerText(JSON.stringify({ confidence: 0.5, citedPaperIds: ["1"] })), "");
  assert.equal(readableAnswerText(""), "");
});

test("a reader never sees a JSON envelope", () => {
  const leaked = readableAnswerText(
    '{"answer": "Clean prose.", "citedPaperIds": ["1"], "confidence": "Moderate"}'
  );
  assert.doesNotMatch(leaked, /citedPaperIds/);
  assert.doesNotMatch(leaked, /^\{/);
});
