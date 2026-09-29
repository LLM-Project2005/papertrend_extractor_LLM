import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { libraryPaperHref, parsePaperHref, readPaperTab } from "../src/lib/paper-address";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a paper's address is read and written one way", () => {
  assert.deepEqual(parsePaperHref("/workspace/library?paperId=123"), { runId: null, paperId: "123", tab: undefined });
  assert.deepEqual(parsePaperHref("/workspace/library?paperId=123&tab=evidence"), { runId: null, paperId: "123", tab: "evidence" });
  assert.deepEqual(parsePaperHref("/workspace/library?runId=abc"), { runId: "abc", paperId: null, tab: undefined }, "the older form");
  assert.deepEqual(parsePaperHref("/workspace/library?paper=abc&tab=nonsense"), { runId: "abc", paperId: null, tab: "overview" });
  for (const other of ["/workspace/library", "/workspace/dashboard?paperId=1", "https://example.org/workspace/library?paperId=1", "/workspace/libraryx?paperId=1", "", null]) {
    assert.equal(parsePaperHref(other), null, String(other));
  }
  assert.equal(libraryPaperHref({ paperId: "123" }), "/workspace/library?paperId=123");
  assert.equal(libraryPaperHref({ runId: "abc", tab: "evidence" }), "/workspace/library?paper=abc&tab=evidence");
  assert.deepEqual(parsePaperHref(libraryPaperHref({ runId: "abc", tab: "topics" })), { runId: "abc", paperId: null, tab: "topics" });
  assert.equal(readPaperTab("preview"), "preview");
  assert.equal(readPaperTab(null), "overview");
});

test("the paper window opens over every workspace page", () => {
  assert.match(read("src/app/workspace/layout.tsx"), /<PaperViewerProvider>\s*<WorkspaceShell>\{children\}<\/WorkspaceShell>\s*<\/PaperViewerProvider>/);
  const provider = read("src/components/workspace/PaperViewerProvider.tsx");
  // Its own address, beside the dashboard's ?tab=.
  assert.match(provider, /PAPER_PARAM, PAPER_TAB_PARAM/);
  assert.match(read("src/lib/paper-address.ts"), /export const PAPER_TAB_PARAM = "paperTab";/);
  // Back closes it: opening pushed an entry, closing steps back out of it.
  assert.match(provider, /if \(pushedRef\.current\) \{[\s\S]*?window\.history\.back\(\);/);
  assert.match(provider, /window\.addEventListener\("popstate", sync\)/);
  // The Library keeps its own window and file list.
  assert.match(provider, /if \(isLibraryPath\(window\.location\.pathname\)\) \{\s*router\.push\(libraryPaperHref\(target\)\);/);
  // Every action the Library's window has.
  for (const prop of ["onResolvePreviewUrl", "onOpenInNewTab", "onDownload", "onDownloadReport", "onToggleFavorite", "onRename", "onCorrect", "onOpenDashboard"]) {
    assert.match(provider, new RegExp(`${prop}=\\{`), prop);
  }
});

test("every place that names a paper opens it in place", () => {
  const dashboard = read("src/components/DashboardClient.tsx");
  assert.match(dashboard, /paperViewer\.openPaper\(\{ paperId: String\(paper\.paperId\) \}\);\s*return;/, "the drilldown list stays underneath");
  for (const file of ["src/components/tabs/KeywordExplorer.tsx", "src/components/tabs/Overview.tsx", "src/components/workspace/WorkspaceHomeClient.tsx", "src/components/chat/AnswerBody.tsx", "src/components/chat/ChatClient.tsx"]) {
    const src = read(file);
    assert.match(src, /<PaperLink\s/, `${file} uses PaperLink`);
    assert.doesNotMatch(src, /<Link\s+href=\{`\/workspace\/library\?(paperId|runId)=/, `${file} still links away to the Library`);
  }
  assert.match(read("src/components/workspace/RepositorySemanticMap.tsx"), /if \(paperViewer\) paperViewer\.openPaper\(\{ runId: focusedPoint\.runId \}\);/);
  // A paper still processing opens in the Library, which shows its progress.
  assert.match(read("src/components/workspace/WorkspaceGlobalSearch.tsx"), /if \(run\.status === "succeeded" && paperViewer\) \{\s*paperViewer\.openPaper\(\{ runId: run\.id \}\);/);
  assert.match(read("src/components/workspace/WorkspaceHomeClient.tsx"), /paper=\{run\.status === "succeeded" \? \{ runId: run\.id \} :/);
});

test("a link to a paper is still a link", () => {
  const link = read("src/components/workspace/PaperLink.tsx");
  // A middle click or Ctrl/Cmd-click follows the address, to a new tab.
  assert.match(link, /return event\.button === 0 && !event\.metaKey && !event\.ctrlKey && !event\.shiftKey && !event\.altKey;/);
  assert.match(link, /href=\{href\}/);
  assert.match(link, /if \(event\.defaultPrevented \|\| !viewer \|\| !resolved \|\| !openInPlace\(event\)\) return;/);
});

test("finding a paper's Library file is signed in, owner-scoped and skips Trash", () => {
  const route = read("src/app/api/workspace/library/resolve/route.ts");
  assert.match(route, /if \(!user\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/);
  assert.match(route, /if \(!\/\^\\d\{1,20\}\$\/\.test\(paperId\)\)/, "only a number reaches the query");
  assert.match(route, /WHERE owner_user_id = \$1\s+AND trashed_at IS NULL/);
  assert.match(route, /withCloudSqlOwnerTransaction\(user\.id,/);
});

test("the Library's report helpers are shared, not copied", () => {
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /import \{ buildAnalysisMarkdown, sanitizeFilenamePart, triggerTextDownload \} from "@\/lib\/paper-report";/);
  assert.doesNotMatch(library, /function buildAnalysisMarkdown\(/);
  assert.match(read("src/components/workspace/PaperViewerProvider.tsx"), /buildAnalysisMarkdown\(run, detail\)/);
});
