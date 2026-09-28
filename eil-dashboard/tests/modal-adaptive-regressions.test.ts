import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync(
  new URL("../src/components/ui/Modal.tsx", import.meta.url),
  "utf8"
);
const paperModalSource = readFileSync(
  new URL("../src/components/workspace/PaperAnalysisExplorerModal.tsx", import.meta.url),
  "utf8"
);

test("shared modals portal to the document body so transformed ancestors cannot offset them", () => {
  assert.match(modalSource, /createPortal\(/);
  assert.match(modalSource, /document\.body/);
  assert.match(modalSource, /fixed inset-0/);
});

test("paper explorer tabs use an opaque sticky surface without content gaps", () => {
  assert.match(paperModalSource, /sticky top-0 z-20/);
  assert.match(paperModalSource, /dark:bg-\[\#030303\]/);
  assert.doesNotMatch(paperModalSource, /dark:bg-\[\#030303\]\/95/);
});

test("the paper window resolves its PDF address once, without cancelling itself", () => {
  // The effect depended on its own loading flag and on a resolver the parent
  // recreates every render. Setting the flag re-ran it, the cleanup cancelled
  // the request in flight, and the viewer stayed on "Loading the PDF…".
  assert.match(paperModalSource, /resolvePreviewRef\.current = onResolvePreviewUrl;/);
  assert.match(paperModalSource, /\}, \[run\.id, previewAttempt\]\);/);
  assert.doesNotMatch(paperModalSource, /previewLoading/);
});

test("a link to a paper's tab opens on that tab", () => {
  // The window reset itself to Overview whenever the paper changed - on mount
  // too - so /workspace/library?paper=...&tab=evidence opened on Overview.
  assert.match(paperModalSource, /setActiveTab\(initialTabRef\.current \?\? "overview"\);/);
  assert.doesNotMatch(paperModalSource, /setActiveTab\("overview"\);/);
});
