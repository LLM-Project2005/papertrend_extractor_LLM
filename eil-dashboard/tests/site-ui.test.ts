/*
 * The site's theme, copy, docs and dead-code fixes. The pre-paint theme
 * script is run in tests/site-ui-behaviour-theme.test.ts and the pages are
 * rendered in tests/site-ui-behaviour.test.ts; what is left here is the
 * published copy and docs data, the stylesheet, files that must stay gone,
 * and one pin on an effect a server render never runs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { valuePillars } from "../src/components/marketing/marketing-content";
import { docsPages, popularDocsPages } from "../src/lib/docs-content";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

function exists(relative: string): boolean {
  return existsSync(new URL(`../${relative}`, import.meta.url));
}

/* ------------------------------------------------- the theme, before first paint */

test("the browser is told which palette to paint its own furniture in", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /:root \{[\s\S]*?color-scheme: light;/);
  assert.match(css, /\.dark \{\s*color-scheme: dark;\s*\}/);
});

/* ------------------------------------------------------------ honesty of copy */

test("no build note ships as a reason to choose the product", () => {
  // "Static marketing pages with client-only auth CTA" was the fourth value
  // pillar on the public landing page.
  assert.equal(valuePillars.some((pillar) => /client-only auth CTA/.test(pillar)), false, "an implementation detail must not be sold to visitors");
  assert.ok(valuePillars.includes("Per-file queue status and stalled-queue recovery"));
});

test("every value pillar is something a reader could verify", () => {
  assert.equal(valuePillars.length, 4);
  for (const pillar of valuePillars) {
    assert.equal(/static|client-only|CTA|SSR|bundle|deploy/i.test(pillar), false, `"${pillar}" describes the build, not the product`);
  }
});

/* ------------------------------------------------------- docs navigation */

test("documentation search takes its query from the address", () => {
  // Without this the tags would link to an empty search box. It is read in an
  // effect, which a server render never runs; that the page draws without the
  // search-params hook is rendered in site-ui-behaviour.test.ts.
  const search = read("src/components/docs/DocsSearchClient.tsx");
  assert.match(search, /new URLSearchParams\(window\.location\.search\)\.get\("q"\)/);
});

test("the popular documentation list is a shortlist, not the whole shelf", () => {
  // Nine of thirteen pages carried popular: true - 69%, so the label curated
  // nothing, and the same pages were listed again grouped immediately below.
  const popular = popularDocsPages.length;
  const pages = docsPages.length;
  assert.ok(popular > 0, "the shortlist should not be empty");
  assert.ok(popular <= Math.ceil(pages / 3), `${popular} of ${pages} pages flagged popular is not a shortlist`);
});

/* ------------------------------------------------------------- dead source */

test("components that nothing renders are not kept", () => {
  // 864 lines across six components with no static, dynamic or lazy reference
  // anywhere - orphans of routes that were later turned into redirect() shims.
  // They do not reach the browser, but they mislead every maintainer who greps.
  for (const orphan of [
    "src/components/auth/AuthStatus.tsx",
    "src/components/dashboard/PlannedDashboardSection.tsx",
    "src/components/PrimaryNavigation.tsx",
    "src/components/workspace/StartWorkspaceClient.tsx",
    "src/components/workspace/WorkspaceEmptyState.tsx",
    "src/components/workspace/WorkspacePapersClient.tsx",
  ]) {
    assert.equal(exists(orphan), false, `${orphan} is unreferenced and should be gone`);
  }
});
