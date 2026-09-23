import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { describeRunFailure } from "../src/lib/ingestion-status";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

/** The exact text a reader met under "Analysis failed" on the pilot. */
const REAL_TRANSPORT_FAILURE =
  "Timeout of 90.0s exceeded, last exception: HTTPSConnectionPool(host='storage.googleapis.com', " +
  "port=443): Max retries exceeded with url: /download/storage/v1/b/papertrend-uploads/o/...";

test("a transport exception is not what a reader is shown", () => {
  const shown = describeRunFailure(REAL_TRANSPORT_FAILURE);
  assert.equal(shown.includes("HTTPSConnectionPool"), false);
  assert.equal(shown.includes("port=443"), false);
  assert.equal(shown.includes("Max retries"), false);
  assert.match(shown, /took too long to download/);
  assert.match(shown, /again/, "a reader needs to know what to do next");
});

test("the worker's own sentences are left exactly as written", () => {
  // These already say what happened, in words. Rewriting them would lose
  // information for no gain.
  for (const message of [
    "No extractable text was found in the PDF.",
    "The model returned an empty response.",
    "The ingestion run no longer exists.",
    "The queued run is missing its storage path.",
  ]) {
    assert.equal(describeRunFailure(message), message);
  }
});

test("a failure with no message still says something", () => {
  for (const empty of [null, undefined, "", "   "]) {
    assert.match(describeRunFailure(empty), /worker stopped/);
  }
});

test("other library noise gets a plain sentence too", () => {
  const shown = describeRunFailure("SSLError(MaxRetryError(HTTPSConnectionPool(host='x', port=443)))");
  assert.equal(/SSLError|HTTPSConnectionPool/.test(shown), false);
  assert.match(shown, /network or storage error|took too long/);
});

test("the original is still shown to whoever is diagnosing", () => {
  // Translating the leading line is right; discarding the text would leave
  // nobody able to work out what actually happened. The status card prints the
  // original under the plain sentence.
  const card = read("src/components/workspace/AnalysisStatusCard.tsx");
  assert.match(card, /\{run\.error_message\}/, "the status card still prints the original");
});

test("a failed paper explains itself where the papers are", () => {
  // The History page used to be the only place an older failure said why. With
  // it gone, the paper in the library carries the reason - the full sentence on
  // hover in the list view, where the line truncates.
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /describeRunFailure\(run\.error_message\)/);
  assert.match(library, /title=\{item\.subtitle\}/);
});
