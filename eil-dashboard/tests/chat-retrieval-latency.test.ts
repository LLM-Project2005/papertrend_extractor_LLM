import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { expansionIsPossible } from "../src/lib/repository-chat";

function source(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

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

test("the hybrid search starts before the in-memory ranking, not after", () => {
  // Both need only the queries and the scope, and the merge is order
  // independent, so the embedding round trip should overlap the tokenising.
  const chat = source("lib/repository-chat.ts");
  const promiseIndex = chat.indexOf("const persistentHitsPromise");
  const rankIndex = chat.indexOf("let candidates = rankRepositoryEvidence");
  const awaitIndex = chat.indexOf("await persistentHitsPromise");
  assert.ok(promiseIndex > 0, "hybrid search promise not found");
  assert.ok(promiseIndex < rankIndex, "hybrid search must start before ranking");
  assert.ok(rankIndex < awaitIndex, "hybrid search must be awaited after ranking");
});

test("a failed hybrid search still leaves lexical retrieval working", () => {
  const chat = source("lib/repository-chat.ts");
  // The promise carries its own catch, so a rejection cannot escape the overlap
  // and take the whole answer down with it.
  assert.match(chat, /\)\.catch\(\(\) => null\)/);
});

test("the sufficiency decision is recorded so the saving is verifiable", () => {
  const chat = source("lib/repository-chat.ts");
  assert.match(chat, /chat_sufficiency_decision/);
});
