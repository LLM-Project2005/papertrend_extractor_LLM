/*
 * One paper window for the whole workspace (docs/32), run rather than read:
 * the workspace layout is rendered, the window's provider and the Library run
 * through stub-uia11y-hooks.ts against the stand-in document, address and
 * fetch of stub-uia11y-dom.ts, and the route that finds a paper's Library file
 * runs against PGlite (route-harness.ts). Sign-in, the workspace and Next's
 * router are the tests/support/stub-auditfix-*.ts ones.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement, type Context, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { libraryPaperHref, parsePaperHref, readPaperTab, type PaperTarget } from "../src/lib/paper-address";
import { paperIdFromRunId } from "../src/lib/paper-id";
import type { IngestionRunRow, RunAnalysisDetail } from "../src/types/database";
import { routeHarness, stubModule } from "./support/route-harness";
import { FakeEvent, dispatch, installDom, settle, type FakeDocument, type FakeWindow } from "./support/stub-uia11y-dom";
import { elements, mount, only, textOf, type FoundElement } from "./support/stub-uia11y-hooks";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/workspace/WorkspaceShell.tsx", support("stub-uia11y-shell.ts"));
(globalThis as { React?: typeof React }).React = React;

const SIGNED_IN = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };

const RUN = {
  id: "run-1",
  source_type: "upload",
  status: "succeeded",
  source_filename: "peer-feedback.pdf",
  display_name: "Peer feedback in writing",
  is_favorite: false,
  input_payload: { project_id: PROJECT.id },
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z",
} as unknown as IngestionRunRow;

const DETAIL: RunAnalysisDetail = {
  available: true,
  paper_id: "42",
  title: "Peer feedback in second language writing",
  year: "2021",
  topics: ["Writing"],
  keywords: [],
  concepts: [],
  facets: [],
  tracksSingle: [],
  tracksMulti: [],
};

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

test("the paper window is there for every workspace page and the shell around it", async () => {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixPathname = "/workspace/dashboard";
  const { default: WorkspaceLayout } = await import("../src/app/workspace/layout");
  const html = renderToStaticMarkup(createElement(WorkspaceLayout, null, createElement("p", null, "The page itself")));
  assert.equal(html, '<div data-paper-viewer="present"><p>The page itself</p></div>');
});

interface Viewer {
  openPaper: (target: PaperTarget) => void;
}

/** The workspace's paper window at `href`, with the server answering as `respond` does. */
async function paperWindow(href: string, respond: FakeWindow["respond"]) {
  const dom = installDom(href);
  dom.window.respond = respond;
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixPathname = new URL(href).pathname;
  globalThis.__auditfixNavigations = [];
  const { PaperViewerProvider } = await import("../src/components/workspace/PaperViewerProvider");
  const provider = mount(PaperViewerProvider, { children: "The page" as ReactNode });
  const providerElement = () => elements(provider.tree).find((found) => typeof (found.props.value as Viewer | undefined)?.openPaper === "function")!;
  return {
    dom,
    provider,
    viewer: () => providerElement().props.value as Viewer,
    /** The context the window is offered through, for what sits inside it. */
    context: providerElement().type as Context<unknown>,
    /** The open paper's window, if one is open. */
    explorer: () => elements(provider.tree).find((found) => (found.props.run as IngestionRunRow | undefined)?.id !== undefined),
    done() {
      provider.unmount();
      dom.restore();
    },
  };
}

const serve = (url: string) => {
  if (url === "/api/workspace/library/resolve?paperId=42") return { body: { runId: "run-1" } };
  if (url === "/api/workspace/library/run-1/analysis") return { body: { run: RUN, analysis: DETAIL } };
  return { status: 404, body: {} };
};

const call = (found: FoundElement | undefined, name: string, ...args: unknown[]) => (found?.props[name] as (...values: unknown[]) => unknown)(...args);

test("opening a paper puts it in the address beside the page's own, and Back closes it", async () => {
  const paper = await paperWindow("https://papertrend.test/workspace/dashboard?tab=trends", serve);
  try {
    paper.viewer().openPaper({ paperId: "42" });
    await settle();
    assert.deepEqual(paper.dom.window.requests.map((request) => request.url), ["/api/workspace/library/resolve?paperId=42", "/api/workspace/library/run-1/analysis"]);
    assert.ok(paper.dom.window.requests.every((request) => request.init?.headers?.Authorization === "Bearer reader-token"), "signed in");
    const explorer = paper.explorer();
    assert.ok(explorer, "the window is open over the page");
    assert.equal(explorer.props.initialTab, "overview");
    assert.deepEqual(explorer.props.detail, DETAIL);
    // Its own address, beside the dashboard's ?tab=; opening pushed an entry.
    assert.deepEqual(paper.dom.window.historyLog, [{ how: "push", href: "/workspace/dashboard?tab=trends&paper=run-1" }]);
    call(explorer, "onTabChange", "evidence");
    assert.deepEqual(paper.dom.window.historyLog.at(-1), { how: "replace", href: "/workspace/dashboard?tab=trends&paper=run-1&paperTab=evidence" });
    // Closing steps back out of the entry, so Back does not reopen it.
    call(paper.explorer(), "onClose");
    assert.deepEqual(paper.dom.window.historyLog.at(-1), { how: "back" });
    assert.equal(paper.dom.window.location.search, "?tab=trends");
    assert.equal(paper.explorer(), undefined, "closed");

    // Back after opening, rather than the close button, closes it too.
    paper.viewer().openPaper({ runId: "run-1" });
    await settle();
    assert.ok(paper.explorer());
    paper.dom.window.history.back();
    assert.equal(paper.explorer(), undefined, "Back closes the window");
  } finally {
    paper.done();
  }
});

test("an address with ?paper= opens the window, as a copied link or Forward does", async () => {
  const paper = await paperWindow("https://papertrend.test/workspace/home?paper=run-1&paperTab=evidence", serve);
  try {
    await settle();
    assert.equal(paper.explorer()?.props.initialTab, "evidence");
    assert.deepEqual(paper.dom.window.historyLog, [], "already in the address; nothing pushed");
    call(paper.explorer(), "onClose");
    assert.equal(paper.explorer(), undefined);
    assert.equal(paper.dom.window.location.search, "", "a window opened from the address takes itself out of it");
    // Forward to an entry with the paper in it.
    paper.dom.window.history.pushState(null, "", "/workspace/home?paper=run-1&paperTab=topics");
    dispatch(new FakeEvent("popstate"));
    await settle();
    assert.equal(paper.explorer()?.props.initialTab, "topics");
  } finally {
    paper.done();
  }
});

test("on the Library a paper opens in the Library's own window", async () => {
  const paper = await paperWindow("https://papertrend.test/workspace/library", serve);
  try {
    paper.viewer().openPaper({ runId: "run-1", tab: "evidence" });
    await settle();
    assert.deepEqual(globalThis.__auditfixNavigations, ["/workspace/library?paper=run-1&tab=evidence"]);
    assert.deepEqual(paper.dom.window.requests, [], "the Library loads it, with its file list");
    assert.equal(paper.explorer(), undefined);
  } finally {
    paper.done();
  }
});

test("a paper no longer in the Library says so, in place", async () => {
  const paper = await paperWindow("https://papertrend.test/workspace/chat", serve);
  try {
    paper.viewer().openPaper({ paperId: "7" });
    await settle();
    const dialog = textOf(paper.provider.tree as ReactNode);
    assert.match(dialog, /The paper could not be opened/);
    assert.match(dialog, /This paper is not in your Library any more\. It may be in Trash\./);
    assert.deepEqual(paper.dom.window.historyLog, [], "nothing in the address for a paper that did not open");
  } finally {
    paper.done();
  }
});

test("the window offers every action the Library's does, and the same report", async () => {
  const paper = await paperWindow("https://papertrend.test/workspace/dashboard", serve);
  let windowReport: string;
  try {
    paper.viewer().openPaper({ runId: "run-1" });
    await settle();
    const explorer = paper.explorer();
    for (const prop of ["onResolvePreviewUrl", "onOpenInNewTab", "onDownload", "onDownloadReport", "onToggleFavorite", "onRename", "onCorrect", "onOpenDashboard"]) {
      assert.equal(typeof explorer?.props[prop], "function", prop);
    }
    await call(explorer, "onDownloadReport");
    const link = downloadLink(paper.dom.document);
    assert.ok(link?.downloaded, "a file was handed over");
    assert.equal(link.download, "Peer feedback in second language writing - pipeline-analysis.md");
    windowReport = await link.downloaded.text();
  } finally {
    paper.done();
  }

  // The Library's own menu gives the same report for the same paper.
  const dom = installDom(`https://papertrend.test/workspace/library?repo=${PROJECT.id}`);
  try {
    dom.window.respond = (url) =>
      url.startsWith("/api/workspace/library?includeTrashed=false")
        ? { body: { runs: [RUN] } }
        : url === "/api/workspace/library/run-1/analysis"
          ? { body: { run: RUN, analysis: DETAIL } }
          : { status: 404, body: {} };
    globalThis.__auditfixAuth = SIGNED_IN;
    globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT] };
    globalThis.__auditfixSearch = `repo=${PROJECT.id}`;
    const { default: Library } = await import("../src/components/admin/AdminImportClient");
    const library = mount(Library, {});
    await settle();
    call(only(library.tree, { "aria-label": "Open actions for Peer feedback in writing" }), "onClick", {
      currentTarget: { getBoundingClientRect: () => ({ top: 100, bottom: 130, left: 100, right: 130, width: 30, height: 30 }) },
    });
    const download = elements(library.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).includes("Download analysis report"));
    await call(download, "onClick");
    await settle();
    const link = downloadLink(dom.document);
    assert.ok(link?.downloaded);
    assert.equal(await link.downloaded.text(), windowReport, "one report, whichever window it came from");
    const { buildAnalysisMarkdown } = await import("../src/lib/paper-report");
    assert.equal(windowReport, buildAnalysisMarkdown(RUN, DETAIL));
    library.unmount();
  } finally {
    globalThis.__auditfixSearch = undefined;
    dom.restore();
  }
});

/** The last link a page made to hand over a file. */
function downloadLink(document: FakeDocument) {
  return document.created.filter((element) => element.tagName === "A").at(-1);
}

test("a link to a paper is still a link", async () => {
  const { default: PaperLink, openInPlace } = await import("../src/components/workspace/PaperLink");
  const opened: PaperTarget[] = [];
  const viewer = { openPaper: (target: PaperTarget) => opened.push(target) };
  const paper = await paperWindow("https://papertrend.test/workspace/home", serve);
  const context = paper.context;
  paper.done();

  const link = (props: { paper: PaperTarget | string; onClick?: (event: FakeEvent) => void }, withViewer = true) =>
    only(mount(PaperLink as never, { ...props, children: "Open" }, withViewer ? new Map([[context, viewer]]) : new Map()).tree as ReactNode, { children: "Open" });
  const press = (found: FoundElement, init: ConstructorParameters<typeof FakeEvent>[1] = {}) => {
    const event = new FakeEvent("click", init);
    call(found, "onClick", event);
    return event;
  };

  const plain = link({ paper: { runId: "run-1", tab: "evidence" } });
  assert.equal(plain.type, "a");
  assert.equal(plain.props.href, "/workspace/library?paper=run-1&tab=evidence", "the real address, for a new tab");
  assert.equal(press(plain).defaultPrevented, true);
  assert.deepEqual(opened, [{ runId: "run-1", tab: "evidence" }], "a plain click opens it in place");

  // A middle click or Ctrl/Cmd/Shift/Alt-click follows the address, to a new tab or window.
  for (const init of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
    assert.equal(openInPlace(new FakeEvent("click", init) as never), false, JSON.stringify(init));
    assert.equal(press(plain, init).defaultPrevented, false, JSON.stringify(init));
  }
  assert.equal(opened.length, 1);

  const address = link({ paper: "/workspace/library?paperId=42&tab=evidence" });
  assert.equal(address.props.href, "/workspace/library?paperId=42&tab=evidence");
  press(address);
  assert.deepEqual(opened.at(-1), { runId: null, paperId: "42", tab: "evidence" }, "a Library address is read back into the paper");

  const handled = link({ paper: { runId: "run-1" }, onClick: (event) => event.preventDefault() });
  press(handled);
  assert.equal(opened.length, 2, "a click its own handler took is left alone");
  const notAPaper = link({ paper: "/docs" });
  assert.equal(press(notAPaper).defaultPrevented, false, "an address that names no paper is just followed");
  const outside = link({ paper: { runId: "run-1" } }, false);
  assert.equal(press(outside).defaultPrevented, false, "outside the workspace it is a plain link");
  assert.equal(opened.length, 2);
});

test("finding a paper's Library file is signed in, owner-scoped and skips Trash", async () => {
  const { db, signIn, request } = await routeHarness();
  const { GET } = await import("../src/app/api/workspace/library/resolve/route");
  const OWNER = "00000000-0000-4000-8000-0000000000b1";
  const OTHER = "00000000-0000-4000-8000-0000000000b2";
  const original = "a1000000-0000-4000-8000-000000000001";
  const copy = "a2000000-0000-4000-8000-000000000002";
  const owner = await signIn(OWNER);
  const other = await signIn(OTHER);
  await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, source_type, status) VALUES ($1, $2, 'upload', 'succeeded')`, [original, OWNER]);
  const paperId = paperIdFromRunId(original);
  const resolve = async (headers: Record<string, string>, id: string) => {
    const response = await GET(request(`/api/workspace/library/resolve?paperId=${encodeURIComponent(id)}`, { headers }));
    return { status: response.status, body: (await response.json()) as { runId?: string; error?: string } };
  };

  assert.equal((await resolve({}, paperId)).status, 401, "signed out");
  assert.deepEqual(await resolve(owner, paperId), { status: 200, body: { runId: original } });
  assert.equal((await resolve(other, paperId)).status, 404, "another reader's paper is not found");
  for (const bad of ["abc", "1 OR 1=1", "-5", "123456789012345678901", ""]) {
    assert.equal((await resolve(owner, bad)).status, 400, `only a number reaches the query: ${bad}`);
  }

  await db.query(`UPDATE ingestion_runs SET trashed_at = now() WHERE id = $1`, [original]);
  assert.equal((await resolve(owner, paperId)).status, 404, "a paper in Trash is not opened");
  await db.query(`INSERT INTO ingestion_runs (id, owner_user_id, source_type, status, copied_from_run_id) VALUES ($1, $2, 'upload', 'succeeded', $3)`, [copy, OWNER, original]);
  assert.deepEqual(await resolve(owner, paperId), { status: 200, body: { runId: copy } }, "its Library copy opens in its place");
});
