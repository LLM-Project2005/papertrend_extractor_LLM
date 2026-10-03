/*
 * What a reader is told when a paper's analysis fails: the plain sentence, and
 * the progress card drawn as the server sends it, with the original message
 * and the step the paper stopped at.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describeRunFailure } from "../src/lib/ingestion-status";
import type { IngestionRunRow } from "../src/types/database";

(globalThis as { React?: typeof React }).React = React;

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

/* ------------------------------------------------------- the progress card */

function failedRun(errorMessage: string | null, completedNodes: string[] = []): IngestionRunRow {
  const at = new Date(Date.now() - 60_000).toISOString();
  return {
    id: "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51",
    source_type: "upload",
    status: "failed",
    source_filename: "paper.pdf",
    display_name: "Peer feedback in EFL writing",
    error_message: errorMessage,
    created_at: at,
    updated_at: at,
    input_payload: { progress_stage: "failed", analysis_metrics: { completed_graph_nodes: completedNodes } },
  } as IngestionRunRow;
}

async function trayCard(run: IngestionRunRow) {
  const { default: AnalysisStatusCard } = await import("../src/components/workspace/AnalysisStatusCard");
  return renderToStaticMarkup(createElement(AnalysisStatusCard, { runs: [run], compact: true }));
}

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const visible = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

/** Each step the card lists, as "Label: state". */
async function steps(run: IngestionRunRow): Promise<string[]> {
  const html = await trayCard(run);
  const list = /<ol aria-label="Analysis steps">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";
  return [...list.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((item) => {
    const words = [...item[0].matchAll(/<span class="[^"]*text-(?:\[13px\]|xs)[^"]*">([^<]+)<\/span>/g)].map((match) => match[1]);
    return words.join(": ");
  });
}

const STEPS = ["Upload", "Queued", "Prepare", "Read text", "Sections", "Metadata", "Keywords", "Classify", "Save", "Done"];
const stoppedAt = (label: string) =>
  STEPS.map((step, index) => `${step}: ${index < STEPS.indexOf(label) ? "Done" : step === label ? "Stopped here" : "Waiting"}`);

test("the original is still shown to whoever is diagnosing", async () => {
  // Translating the leading line is right; discarding the text would leave
  // nobody able to work out what actually happened.
  const shown = visible(await trayCard(failedRun(REAL_TRANSPORT_FAILURE)));
  assert.ok(shown.includes(describeRunFailure(REAL_TRANSPORT_FAILURE)), "the plain sentence");
  assert.ok(shown.includes(REAL_TRANSPORT_FAILURE), "and under it the original");
  // A worker sentence that needed no translating is printed once.
  const plain = "No extractable text was found in the PDF.";
  assert.equal(visible(await trayCard(failedRun(plain))).split(plain).length - 1, 1);
});

// The Library's line for a failed paper is run in small-fixes-behaviour-library.test.ts.

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

test("a failed paper is shown stopping where it stopped, not at Upload", async () => {
  // The worker writes the stage "failed", which is not one of the ten steps,
  // so the card fell back to step 1 for every failure.
  assert.deepEqual(await steps(failedRun("Upload did not produce a storage path; this run cannot be processed.")), stoppedAt("Upload"));
  assert.deepEqual(await steps(failedRun("Could not download the file from Cloud Storage.")), stoppedAt("Prepare"));
  assert.deepEqual(await steps(failedRun("Canceled by user.")), stoppedAt("Queued"), "canceled before it started");
  // Otherwise the furthest finished step decides.
  const read = ["extract", "clean", "translate", "segment", "metadata", "extract_author_keywords"];
  assert.deepEqual(await steps(failedRun("The model returned an empty response.", read)), stoppedAt("Keywords"));
  assert.deepEqual(await steps(failedRun("The model returned an empty response.")), stoppedAt("Read text"), "nothing finished");
});

test(
  "a download that timed out is shown stopping at Prepare, though the bucket's name says uploads",
  async () => {
    assert.deepEqual(await steps(failedRun(REAL_TRANSPORT_FAILURE)), stoppedAt("Prepare"));
  }
);
