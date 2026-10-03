/*
 * The site audit's workspace fixes (docs/32, 2.11), rendered rather than read:
 * the page titles, the shell's repository gate, its search pages and its
 * analysis tray, the Library's search from the address, and Home's papers
 * that need attention. Sign-in, the workspace state, the theme, the dashboard
 * data and Next's router are swapped for what each test sets
 * (tests/support/stub-auditfix-*.ts); the components run as written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IngestionRunRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/workspace/WorkspaceGlobalSearch.tsx", support("stub-auditfix-search.ts"));
stubModule("/src/hooks/useData.ts", support("stub-auditfix-dashboard-data.ts"));
(globalThis as { React?: typeof React }).React = React;

const SIGNED_IN = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "token" } };
const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies", description: null };

function run(id: string, status: IngestionRunRow["status"], minutesAgo: number, title: string): IngestionRunRow {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return { id, source_type: "upload", status, source_filename: `${id}.pdf`, display_name: title, created_at: at, updated_at: at };
}

async function shellAt(pathname: string, workspace: Record<string, unknown> = {}) {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixPathname = pathname;
  globalThis.__auditfixWorkspace = workspace;
  const { default: WorkspaceShell } = await import("../src/components/workspace/WorkspaceShell");
  return renderToStaticMarkup(createElement(WorkspaceShell, null, createElement("p", null, "The page itself")));
}

// SHELL-5: every workspace page names itself in the browser tab.
test("each workspace page has its own title", async () => {
  const titles: Record<string, unknown> = {};
  for (const page of ["home", "library", "dashboard", "chat", "settings"]) {
    titles[page] = (await import(`../src/app/workspace/${page}/page.tsx`)).metadata?.title;
  }
  assert.deepEqual(titles, { home: "Home", library: "Library", dashboard: "Dashboard", chat: "Chat", settings: "Settings" });
});

// SHELL-3: the account and admin pages need no repository.
test("settings open without a repository; the repository's pages ask for one first", async () => {
  const settings = await shellAt("/workspace/settings");
  assert.match(settings, /The page itself/);
  assert.doesNotMatch(settings, /Choose a repository/);
  for (const page of ["home", "library", "dashboard", "chat"]) {
    const html = await shellAt(`/workspace/${page}`);
    assert.match(html, /Choose a repository/, page);
    assert.doesNotMatch(html, /The page itself/, page);
  }
  assert.match(await shellAt("/workspace/home", { currentProject: PROJECT, hasActiveProject: true }), /The page itself/);
});

// SHELL-7: search lists each place once; settings opens on the repository's section.
test("search is handed each page once, and settings opens on the repository's section", async () => {
  globalThis.__auditfixSearchPages = undefined;
  await shellAt("/workspace/home", { currentProject: PROJECT, hasActiveProject: true });
  const pages: Array<{ label: string; href: string }> = globalThis.__auditfixSearchPages ?? [];
  const hrefs = pages.map((page) => page.href);
  assert.ok(hrefs.length >= 6, hrefs.join(", "));
  assert.equal(new Set(hrefs).size, hrefs.length, `a page listed twice: ${hrefs.join(", ")}`);
  assert.equal(pages.find((page) => page.label === "Settings")?.href, "/workspace/settings?section=repository");
  for (const href of ["/workspace/home", "/workspace/dashboard", "/workspace/chat", "/workspace/library"]) {
    assert.ok(hrefs.includes(href), href);
  }
});

test("the Library opens with the words search handed it already in its search box", async () => {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true };
  globalThis.__auditfixSearch = `q=${encodeURIComponent("reading fluency")}`;
  try {
    const { default: Library } = await import("../src/components/admin/AdminImportClient");
    assert.match(renderToStaticMarkup(createElement(Library)), /<input type="search"[^>]*value="reading fluency"/);
  } finally {
    globalThis.__auditfixSearch = undefined;
  }
});

// CHAT-8: the tray sits in the dock the stylesheet raises above the chat composer.
test("the analysis tray is drawn in the dock that stands above the chat composer", async () => {
  const followed = { runIds: ["r1"], minimized: false, folderJobId: null };
  const chat = await shellAt("/workspace/chat", { currentProject: PROJECT, hasActiveProject: true, analysisSession: followed });
  assert.match(chat, /<div class="tray-dock [^"]*\bfixed\b[^"]*">[\s\S]*Open analysis progress/);
  // Home shows the progress in the page, not in the tray.
  const home = await shellAt("/workspace/home", { currentProject: PROJECT, hasActiveProject: true, analysisSession: followed });
  assert.doesNotMatch(home, /tray-dock/);

  const { default: AnalysisStatusCard } = await import("../src/components/workspace/AnalysisStatusCard");
  const tray = renderToStaticMarkup(createElement(AnalysisStatusCard, { runs: [run("r1", "processing", 1, "Peer feedback")], compact: true }));
  assert.match(tray, /class="[^"]*\btray-card\b[^"]*"/, "the open tray takes the height rule that keeps it below the headers");
});

// SHELL-10: a queued paper waiting its turn is not "stuck".
test("on Home only a paper that stopped updating while analysed needs attention; a queued one is waiting", async () => {
  globalThis.__auditfixAuth = SIGNED_IN;
  const runs = [
    run("r-queued", "queued", 180, "Waiting its turn"),
    run("r-stalled", "processing", 180, "Stopped mid-analysis"),
    run("r-running", "processing", 2, "Being analysed now"),
  ];
  globalThis.__auditfixWorkspace = {
    currentProject: PROJECT,
    hasActiveProject: true,
    analysisSession: { runIds: runs.map((entry) => entry.id), minimized: true, folderJobId: null },
  };
  globalThis.__auditfixDashboardData = { data: null, loading: true };
  const { default: WorkspaceHomeClient } = await import("../src/components/workspace/WorkspaceHomeClient");
  const { AnalysisRunsContext } = await import("../src/components/workspace/AnalysisRunsContext");
  const home = renderToStaticMarkup(
    createElement(AnalysisRunsContext.Provider, { value: { runs, folderJob: null } as never }, createElement(WorkspaceHomeClient))
  );
  assert.match(home, /1 recent paper failed or stopped updating\./);
  const row = (title: string) => home.slice(home.indexOf(`title="${title}"`), home.indexOf("</li>", home.indexOf(`title="${title}"`)));
  assert.match(row("Stopped mid-analysis"), /Stopped updating[\s\S]*Needs attention/);
  assert.doesNotMatch(row("Waiting its turn"), /Needs attention|Stopped updating/);
  assert.match(row("Waiting its turn"), />Queued</);
  assert.doesNotMatch(row("Being analysed now"), /Needs attention/);
});

test("Home says when its results could not be loaded, and offers to try again", async () => {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true };
  globalThis.__auditfixDashboardData = {
    loading: false,
    data: { trends: [], tracksSingle: [], tracksMulti: [], useMock: false, diagnostics: { errorMessage: "the database did not answer" } },
  };
  const { default: WorkspaceHomeClient } = await import("../src/components/workspace/WorkspaceHomeClient");
  const { AnalysisRunsContext } = await import("../src/components/workspace/AnalysisRunsContext");
  const home = renderToStaticMarkup(
    createElement(AnalysisRunsContext.Provider, { value: { runs: [], folderJob: null } as never }, createElement(WorkspaceHomeClient))
  );
  assert.match(home, /could not be loaded just now \(the database did not answer\)\.[\s\S]{0,40}<button type="button"[^>]*>Try again<\/button>/);
});
