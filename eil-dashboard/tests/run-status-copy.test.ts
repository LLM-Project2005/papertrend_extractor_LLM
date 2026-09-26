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

test("terse worker messages get the sentence a reader needs", () => {
  // "Extraction produced no usable text for 3f2c...pdf" named the internal run
  // id in place of the file, and "Canceled by user." did not say what to do.
  const cases: Array<[string, RegExp]> = [
    ["Canceled by user.", /Try again/],
    ["Extraction produced no usable text for 3f2c9a1e-0000-4000-8000-000000000000.pdf.", /No readable text/],
    ["Critical extraction failure: cannot open broken document", /could not be read/],
    ["Upload did not produce a storage path; this run cannot be processed.", /Add the PDF again/],
    ["Direct upload failed before queueing.", /did not reach storage/],
  ];
  for (const [raw, expected] of cases) {
    const shown = describeRunFailure(raw);
    assert.match(shown, expected, raw);
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(shown), false, "no internal id reaches the reader");
  }
});

test("a failed paper is shown stopping where it stopped, not at Upload", () => {
  // The worker writes the stage "failed", which is not one of the ten steps,
  // so the card fell back to step 1 for every failure.
  const card = read("src/components/workspace/AnalysisStatusCard.tsx");
  assert.match(card, /if \(run\.status === "failed"\) return failedStageIndex\(run\);/);
  const helper = card.slice(card.indexOf("function failedStageIndex"));
  assert.match(helper, /upload\|storage path/, "an upload failure still stops at Upload");
  assert.match(helper, /readCompletedGraphNodes\(run\)/, "otherwise the furthest finished step decides");
});
