import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUDIT_EVIDENCE_CHARS,
  auditEvidence,
  corpusCountsEvidence,
  CORRECTED_ANSWER_LIMITATION,
  decideFromAudit,
  FaithfulnessSchema,
  GroundedAnswerSchema,
  LANGUAGE_LIMITATION,
  resolveQaAudit,
  UNCHECKED_ANSWER_LIMITATION,
  UNVERIFIED_ANSWER_LIMITATION,
} from "../src/lib/repository-chat";

/** No chat answer skips the fact-check (docs/32, 2.2). */

test("the audit sees the evidence a repository-wide answer was written from", () => {
  // Found on the pilot: the whole audit prompt was cut at 24,000 characters,
  // draft first, so most batch findings of a 41-paper synthesis never reached
  // the auditor, and it judged the answer unsupported.
  const findings = "x".repeat(40_000);
  assert.equal(auditEvidence(findings, "exhaustive"), findings, "a repository's findings fit whole");
  const cut = auditEvidence("y".repeat(AUDIT_EVIDENCE_CHARS.focused + 500), "focused");
  assert.ok(cut.startsWith("y".repeat(AUDIT_EVIDENCE_CHARS.focused)));
  assert.match(cut, /\[Evidence shortened here: judge only claims about the evidence shown/);
  const source = readFileSync(new URL("../src/lib/repository-chat.ts", import.meta.url), "utf8");
  const audit = source.slice(source.indexOf("async function checkFaithfulness("), source.indexOf("export const UNCHECKED_ANSWER_LIMITATION"));
  assert.match(audit, /auditEvidence\(input\.evidenceText, input\.scopeMode\)/);
  assert.doesNotMatch(audit, /\.slice\(0, 24_000\)/);
  // Grounding and coverage are judged apart: leaving something out is not an unsupported claim.
  assert.match(audit, /A claim is never unsupported because the draft leaves something out\./);
  assert.match(audit, /need not name each paper, nor be longer than the reader asked for/);
});

test("a repository-wide answer and its audit see the counted figures", () => {
  // Found on the pilot: "which topics come up most often" was answered from
  // model-written batch summaries, and the audit could not confirm a ranking.
  const counts = corpusCountsEvidence({
    papers: Array.from({ length: 41 }) as never,
    topicCounts: [{ label: "Academic writing", paperCount: 9, mentions: 30 }, { label: "Assessment", paperCount: 1, mentions: 2 }],
    keywordCounts: [{ label: "feedback", paperCount: 4, mentions: 9 }],
  });
  assert.match(counts, /^## Counted across all 41 papers in scope/);
  assert.match(counts, /- Academic writing: 9 papers\n- Assessment: 1 paper\n/);
  assert.match(counts, /Keywords:\n- feedback: 4 papers/);
  const source = readFileSync(new URL("../src/lib/repository-chat.ts", import.meta.url), "utf8");
  const corpus = source.slice(source.indexOf("async function aggregateCorpusResult("));
  assert.match(corpus, /`Eligible papers: \$\{context\.papers\.length\}`, countsEvidence, "Use these counts for any claim about how often or how many/);
  assert.match(corpus, /evidenceText: \[countsEvidence, \.\.\.summaries\]\.join/);
  // An answer of counts names no paper; with the counts in evidence it is not failed for that.
  assert.match(corpus, /formatConstraint: formatConstraintInstruction\(input\.prompt\),\s*countsBacked: true,/);
  assert.match(source, /validation\.citedPaperIds\.length > 0 \|\| input\.countsBacked === true\)/);
});

test("a corpus-wide audit that names many papers is read, not rejected", () => {
  // Found on the pilot: the audit of a 41-paper synthesis listed 30 cited ids,
  // the schema allowed 12, and every corpus answer went out unchecked.
  const ids = Array.from({ length: 30 }, (_, index) => `10000000000000000${String(index).padStart(2, "0")}`);
  const audit = FaithfulnessSchema.safeParse({
    supported: true, answersIntent: true, completeForRequest: true, languageMatched: true,
    correctedAnswer: "", citedPaperIds: ids, confidence: 0.8, reason: "",
  });
  assert.equal(audit.success, true);
  assert.equal(audit.success && audit.data.citedPaperIds.length, 12);
  const answer = GroundedAnswerSchema.safeParse({ answer: "Across the papers [Paper 1]...", citedPaperIds: ids, limitations: [] });
  assert.equal(answer.success, true, "an answer citing many papers is not thrown away either");
  // A string or nothing still reads as a list.
  const single = FaithfulnessSchema.safeParse({ supported: "yes", answersIntent: "true", completeForRequest: false, languageMatched: true, citedPaperIds: "42" });
  assert.equal(single.success && single.data.citedPaperIds.join(), "42");
});

const ALLOWED = ["101", "102"];
const DRAFT = "Teachers in both studies used peer feedback to improve writing accuracy over one semester of instruction [Paper 101].";
const CORRECTED = "Teachers in one study used peer feedback, and writing accuracy improved over one semester of instruction [Paper 102].";
const base = { answer: CORRECTED, valid: false, grounded: true, incomplete: false, languageMatched: true, auditRan: true, reason: "" };

test("every verdict ends in a checked answer, a marked one, or the fallback", () => {
  const cases: Array<[string, Parameters<typeof resolveQaAudit>[0], ReturnType<typeof resolveQaAudit>]> = [
    ["approved", { checked: { ...base, valid: true }, draft: DRAFT, draftNeedsRepair: false, allowedIds: ALLOWED },
      { kind: "answer", answer: CORRECTED, limitations: [] }],
    ["grounded, incomplete", { checked: { ...base, incomplete: true, reason: "sample sizes are missing" }, draft: DRAFT, draftNeedsRepair: false, allowedIds: ALLOWED },
      { kind: "answer", answer: CORRECTED, limitations: ["This answer may not cover the full request: sample sizes are missing"] }],
    ["grounded, wrong language", { checked: { ...base, languageMatched: false }, draft: DRAFT, draftNeedsRepair: false, allowedIds: ALLOWED },
      { kind: "answer", answer: CORRECTED, limitations: [LANGUAGE_LIMITATION] }],
    ["ungrounded, with a sound correction", { checked: { ...base, grounded: false }, draft: DRAFT, draftNeedsRepair: false, allowedIds: ALLOWED },
      { kind: "answer", answer: CORRECTED, limitations: [CORRECTED_ANSWER_LIMITATION] }],
    ["ungrounded, correction cites a paper out of scope", { checked: { ...base, grounded: false, answer: CORRECTED.replace("102", "999") }, draft: DRAFT, draftNeedsRepair: false, allowedIds: ALLOWED },
      { kind: "answer", answer: DRAFT, limitations: [UNVERIFIED_ANSWER_LIMITATION] }],
    // Previously matched no branch and shipped the draft with no warning.
    ["ungrounded, no correction, draft looks sound", { checked: { ...base, grounded: false, answer: DRAFT }, draft: DRAFT, draftNeedsRepair: false, allowedIds: ALLOWED },
      { kind: "answer", answer: DRAFT, limitations: [UNVERIFIED_ANSWER_LIMITATION] }],
    ["ungrounded, no correction, draft needs repair", { checked: { ...base, grounded: false, answer: DRAFT }, draft: DRAFT, draftNeedsRepair: true, allowedIds: ALLOWED },
      { kind: "fallback" }],
    // Previously counted as "grounded" and shipped the unchecked draft silently.
    ["audit failed, draft sound", { checked: { ...base, answer: DRAFT, auditRan: false }, draft: DRAFT, draftNeedsRepair: false, allowedIds: ALLOWED },
      { kind: "answer", answer: DRAFT, limitations: [UNCHECKED_ANSWER_LIMITATION] }],
    ["audit failed, draft needs repair", { checked: { ...base, answer: DRAFT, auditRan: false }, draft: DRAFT, draftNeedsRepair: true, allowedIds: ALLOWED },
      { kind: "fallback" }],
  ];
  for (const [name, input, expected] of cases) assert.deepEqual(resolveQaAudit(input), expected, name);
});

test("an unmarked answer only ever comes from a passed check", () => {
  for (const valid of [true, false]) for (const grounded of [true, false]) for (const incomplete of [true, false])
    for (const auditRan of [true, false]) for (const draftNeedsRepair of [true, false]) for (const answer of [DRAFT, CORRECTED, ""]) {
      const outcome = resolveQaAudit({
        checked: { ...base, valid: valid && grounded, grounded, incomplete, auditRan, answer },
        draft: DRAFT, draftNeedsRepair, allowedIds: ALLOWED,
      });
      if (outcome.kind === "answer" && outcome.limitations.length === 0) {
        assert.ok(auditRan && grounded, `unmarked without a pass: ${JSON.stringify({ valid, grounded, incomplete, auditRan, draftNeedsRepair })}`);
      }
      if (outcome.kind === "answer") assert.ok(outcome.answer.trim(), "never an empty answer");
    }
});

test("the corpus path says so when its check did not run", () => {
  const decision = decideFromAudit({ valid: false, grounded: true, incomplete: false, reason: "", auditRan: false });
  assert.equal(decision.useCorrected, false);
  assert.match(decision.limitations[0], /could not be checked/);
  // Unchanged when the audit ran.
  assert.deepEqual(decideFromAudit({ valid: true, grounded: true, incomplete: false, reason: "" }), { useCorrected: true, limitations: [] });
});

test("the question-answering path uses the decision, and the audit reports when it did not run", () => {
  const source = readFileSync(new URL("../src/lib/repository-chat.ts", import.meta.url), "utf8");
  assert.match(source, /const outcome = resolveQaAudit\(\{ checked, draft: answer, draftNeedsRepair, allowedIds \}\);/);
  assert.doesNotMatch(source, /\} else if \(checked\.grounded\) \{/, "the old branch chain is gone");
  const audit = source.slice(source.indexOf("async function checkFaithfulness("), source.indexOf("export const UNCHECKED_ANSWER_LIMITATION"));
  assert.equal((audit.match(/auditRan: false/g) ?? []).length, 2, "an unreadable and a failed audit");
  assert.equal((audit.match(/auditRan: true/g) ?? []).length, 1);
});
