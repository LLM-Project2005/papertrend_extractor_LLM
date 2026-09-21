import assert from "node:assert/strict";
import test from "node:test";
import { decideFromAudit } from "../src/lib/repository-chat";

const APPROVED = { valid: true, grounded: true, incomplete: false, reason: "" };
const INCOMPLETE = { valid: false, grounded: true, incomplete: true, reason: "sample sizes are missing" };
const UNGROUNDED = { valid: false, grounded: false, incomplete: false, reason: "claims are not in the evidence" };

test("an approved audit presents the corrected answer with no warning", () => {
  const decision = decideFromAudit(APPROVED);
  assert.equal(decision.useCorrected, true);
  assert.deepEqual(decision.limitations, []);
});

test("a grounded but incomplete audit keeps the answer and names the gap", () => {
  const decision = decideFromAudit(INCOMPLETE);
  assert.equal(decision.useCorrected, true);
  assert.equal(decision.limitations.length, 1);
  assert.match(decision.limitations[0], /sample sizes are missing/);
});

test("an incomplete audit without a reason still warns", () => {
  const decision = decideFromAudit({ ...INCOMPLETE, reason: "" });
  assert.equal(decision.useCorrected, true);
  assert.match(decision.limitations[0], /may not cover every part/);
});

test("an ungrounded audit is never silently accepted", () => {
  // The corpus path previously used `review.valid ? review.answer : answer`,
  // which shipped a draft the auditor had judged ungrounded with no warning.
  const decision = decideFromAudit(UNGROUNDED);
  assert.equal(decision.useCorrected, false);
  assert.equal(decision.limitations.length, 1);
  assert.match(decision.limitations[0], /could not be verified/);
  assert.match(decision.limitations[0], /unconfirmed/);
});

test("an ungrounded verdict always produces a warning, whatever else it says", () => {
  for (const incomplete of [true, false]) {
    for (const reason of ["", "some reason"]) {
      const decision = decideFromAudit({ valid: false, grounded: false, incomplete, reason });
      assert.ok(
        decision.limitations.some((item) => /could not be verified/.test(item)),
        `ungrounded must warn (incomplete=${incomplete}, reason=${reason || "none"})`
      );
    }
  }
});

test("a valid verdict is never downgraded by an incomplete flag", () => {
  // valid implies the auditor was satisfied; incomplete should not contradict it.
  const decision = decideFromAudit({ valid: true, grounded: true, incomplete: true, reason: "x" });
  assert.equal(decision.useCorrected, true);
  assert.deepEqual(decision.limitations, []);
});

test("every decision is presentable: it either warns or approves", () => {
  for (const review of [APPROVED, INCOMPLETE, UNGROUNDED]) {
    const decision = decideFromAudit(review);
    const approved = decision.useCorrected && decision.limitations.length === 0;
    const warned = decision.limitations.length > 0;
    assert.ok(approved || warned, "a decision must approve cleanly or carry a warning");
  }
});
