import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_SKIP_CONFIDENCE, auditCanBeSkipped } from "../src/lib/repository-chat";

/** A well-formed answer: direct opening, structure, emphasis, a citation. */
const CLEAN_ANSWER = [
  "The reading assessment study found that structured feedback improved revision quality.",
  "## What it measured",
  "- **Revision quality** across two drafts [Paper 12]",
  "- **Learner confidence**, self-reported [Paper 12]",
].join("\n\n");

const OK_VALIDATION = {
  invalidPaperIds: [],
  citedPaperIds: ["12"],
  hasSubstantiveText: true,
};

function input(overrides: Partial<Parameters<typeof auditCanBeSkipped>[0]> = {}) {
  return {
    parsedCleanly: true,
    confidence: 0.9,
    answer: CLEAN_ANSWER,
    validation: OK_VALIDATION,
    ...overrides,
  };
}

test("a clean, confident, well-cited answer skips the audit", () => {
  // The audit costs 7.9 of 28.0 seconds of model time on a live question.
  assert.equal(auditCanBeSkipped(input()), true);
});

test("a raw-text fallback is always audited", () => {
  // Structured parsing failed, so the answer never met the output contract.
  assert.equal(auditCanBeSkipped(input({ parsedCleanly: false })), false);
});

test("a low-confidence answer is always audited", () => {
  assert.equal(auditCanBeSkipped(input({ confidence: AUDIT_SKIP_CONFIDENCE - 0.01 })), false);
  assert.equal(auditCanBeSkipped(input({ confidence: AUDIT_SKIP_CONFIDENCE })), true);
});

test("an invalid citation is always audited", () => {
  assert.equal(
    auditCanBeSkipped(input({ validation: { ...OK_VALIDATION, invalidPaperIds: ["999"] } })),
    false
  );
});

test("substantive text with no citation is always audited", () => {
  assert.equal(
    auditCanBeSkipped(input({ validation: { ...OK_VALIDATION, citedPaperIds: [] } })),
    false
  );
});

test("a refusal with no citations may still skip", () => {
  // "No paper about X exists here" has nothing to cite and nothing to repair.
  const refusal = "No paper about quantum cryptography appears in this repository.";
  assert.equal(
    auditCanBeSkipped(
      input({
        answer: refusal,
        validation: { invalidPaperIds: [], citedPaperIds: [], hasSubstantiveText: false },
      })
    ),
    true
  );
});

test("an unreadable answer is always audited", () => {
  // A wall of text is exactly what the audit exists to reshape.
  const wall = "This study examined teacher attitudes in Thai classrooms. ".repeat(20);
  assert.equal(auditCanBeSkipped(input({ answer: wall })), false);
});

test("an answer with no emphasis or structure is always audited", () => {
  const flat = [
    "The papers all study English teaching. ".repeat(12),
    "They differ in method. ".repeat(12),
  ].join("\n\n");
  assert.equal(auditCanBeSkipped(input({ answer: flat })), false);
});

test("every condition must hold, not merely most of them", () => {
  // Each single defect on its own is enough to require the audit.
  const defects = [
    { parsedCleanly: false },
    { confidence: 0.4 },
    { validation: { ...OK_VALIDATION, invalidPaperIds: ["x"] } },
    { answer: "word ".repeat(400) },
  ];
  for (const defect of defects) {
    assert.equal(auditCanBeSkipped(input(defect)), false, `should audit: ${JSON.stringify(defect)}`);
  }
});

test("the skip threshold is documented as a constant, not a magic number", () => {
  assert.ok(AUDIT_SKIP_CONFIDENCE > 0.5 && AUDIT_SKIP_CONFIDENCE <= 1);
});
