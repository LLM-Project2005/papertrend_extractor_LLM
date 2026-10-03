import assert from "node:assert/strict";
import test from "node:test";
import { applyCachedIndexes, type RepositoryPaper } from "../src/lib/repository-chat";

/** A question's repository load uses the stored word index before computing one (docs/32, 3.1). */

function paper(paperId: string, content: string, contentHash: string): RepositoryPaper {
  return {
    paperId, runId: `run-${paperId}`, folderId: "f", title: paperId, year: "2024",
    abstract: "", methods: "", results: "", conclusion: "",
    content, contentHash, contentSource: "full_text",
    totalWords: 0, termCounts: {}, topics: new Map(), keywords: new Map(),
  };
}

test("an unchanged paper takes its stored index; a changed one is indexed again and saved", () => {
  const cachedPaper = paper("1", "the stored text is not read again", "hash-1");
  const changedPaper = paper("2", "feedback feedback writing", "hash-2-new");
  const missingPaper = paper("3", "assessment", "hash-3");
  const stale = applyCachedIndexes(
    [cachedPaper, changedPaper, missingPaper],
    new Map([
      ["1", { paper_id: "1", content_hash: "hash-1", total_words: 7, term_counts: { stored: 7 } }],
      ["2", { paper_id: "2", content_hash: "hash-2-old", total_words: 1, term_counts: { old: 1 } }],
    ] as never)
  );
  assert.deepEqual(cachedPaper.termCounts, { stored: 7 }, "the stored counts, not the text's");
  assert.equal(cachedPaper.totalWords, 7);
  assert.deepEqual(stale.map((item) => item.paperId), ["2", "3"]);
  assert.equal(changedPaper.termCounts.feedback, 2, "a changed paper is counted from its text");
  assert.equal(changedPaper.totalWords, 3);
  assert.equal(missingPaper.totalWords, 1);
});

// That a question's load reads the stored index first, builds only the stale
// ones and writes nothing else runs in small-fixes2-behaviour-retrieval.test.ts.
