import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CORRECTED_ANSWER_LIMITATION,
  decideFromAudit,
  LANGUAGE_LIMITATION,
  resolveQaAudit,
  UNCHECKED_ANSWER_LIMITATION,
  UNVERIFIED_ANSWER_LIMITATION,
} from "../src/lib/repository-chat";

/** No chat answer skips the fact-check (docs/32, 2.2). */

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
