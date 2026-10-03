/*
 * src/lib/repository-text.ts for tests of a question's repository load: the
 * real module, which also records in globalThis.__smallfix2Indexed each text
 * a word index is built from.
 */
import * as text from "../../src/lib/repository-text";

declare global {
  // eslint-disable-next-line no-var
  var __smallfix2Indexed: string[] | undefined;
}

export const normalizeRepositoryText = text.normalizeRepositoryText;
export const tokenizeRepositoryText = text.tokenizeRepositoryText;
export const containsThaiScript = text.containsThaiScript;
export const countTermInRepositoryText = text.countTermInRepositoryText;
export const splitTextPassages = text.splitTextPassages;

export function buildRepositoryTermCounts(value: string) {
  (globalThis.__smallfix2Indexed ??= []).push(value);
  return text.buildRepositoryTermCounts(value);
}
