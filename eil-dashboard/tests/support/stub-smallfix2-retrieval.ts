/*
 * src/lib/repository-retrieval.ts and src/lib/repository-memory.ts for tests
 * of a question's retrieval: the real modules, which also note in
 * globalThis.__smallfix2Sequence when the in-memory ranking runs and when the
 * search by meaning starts and settles. A search by meaning fails as an
 * unreachable index does while globalThis.__smallfix2SemanticFails is set.
 */
import * as retrieval from "../../src/lib/repository-retrieval";
import * as memory from "../../src/lib/repository-memory";

declare global {
  // eslint-disable-next-line no-var
  var __smallfix2Sequence: string[] | undefined;
  // eslint-disable-next-line no-var
  var __smallfix2SemanticFails: boolean | undefined;
}

const note = (event: string) => void (globalThis.__smallfix2Sequence ??= []).push(event);

export function rankRepositoryEvidence(...args: Parameters<typeof retrieval.rankRepositoryEvidence>) {
  note("rank");
  return retrieval.rankRepositoryEvidence(...args);
}

export const fuseSemanticRanks = retrieval.fuseSemanticRanks;
export const validateInlinePaperCitations = retrieval.validateInlinePaperCitations;

export async function semanticPaperRanking(...args: Parameters<typeof memory.semanticPaperRanking>) {
  note("semantic search started");
  try {
    if (globalThis.__smallfix2SemanticFails) throw new Error("The search index could not be reached.");
    return await memory.semanticPaperRanking(...args);
  } finally {
    note("semantic search settled");
  }
}

export const syncRepositoryMemory = memory.syncRepositoryMemory;
export const SEMANTIC_PAPER_LIMIT = memory.SEMANTIC_PAPER_LIMIT;
export const SEMANTIC_PAPER_SQL = memory.SEMANTIC_PAPER_SQL;
export const INDEXED_PAPERS_SQL = memory.INDEXED_PAPERS_SQL;
export type { RepositoryRetrievalCandidate, RepositoryRetrievalDocument, CitationValidationResult } from "../../src/lib/repository-retrieval";
export type { RepositoryMemoryScope, SemanticPaperRanking } from "../../src/lib/repository-memory";
