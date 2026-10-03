import assert from "node:assert/strict";
import test from "node:test";
import { expansionIsPossible } from "../src/lib/repository-chat";

test("expansion is impossible once every scoped paper is selected", () => {
  // A focused question has a source limit of 10, so a repository of ten or
  // fewer papers already holds everything expansion could reach.
  assert.equal(expansionIsPossible(["1", "2", "3", "4", "5"], 5), false);
});

test("expansion is possible while papers remain unselected", () => {
  assert.equal(expansionIsPossible(["1", "2"], 5), true);
});

test("duplicate selections do not fake full coverage", () => {
  // Five entries, three distinct: two papers are still unreached.
  assert.equal(expansionIsPossible(["1", "1", "2", "2", "3"], 5), true);
});

test("an empty selection over a non-empty scope can always expand", () => {
  assert.equal(expansionIsPossible([], 5), true);
});

test("an empty scope cannot expand", () => {
  assert.equal(expansionIsPossible([], 0), false);
});

test("selecting more ids than the scope never claims expansion is possible", () => {
  assert.equal(expansionIsPossible(["1", "2", "3"], 2), false);
});

// That the search by meaning overlaps the ranking, that its failure leaves the
// ranking standing, and that the sufficiency decision is recorded runs in
// small-fixes2-behaviour-retrieval.test.ts.
