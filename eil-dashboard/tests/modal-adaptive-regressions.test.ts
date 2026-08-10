import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync(
  new URL("../src/components/ui/Modal.tsx", import.meta.url),
  "utf8"
);
const dashboardSource = readFileSync(
  new URL("../src/components/DashboardClient.tsx", import.meta.url),
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

test("adaptive charts initialize when an empty year selection represents all years", () => {
  assert.doesNotMatch(
    dashboardSource,
    /!isAdaptiveTab \|\| !data \|\| selectedYears\.length === 0/
  );
  assert.match(dashboardSource, /planState\?\.plan \?\? adaptiveFallbackPlan/);
});
