/*
 * The navigation, papers and chat round of 2026-10-21: Previous and Next in
 * the paper window, the Dashboard's remembered tab, the browser tab's title,
 * Ctrl/Cmd+K and the "?" list, PDFs dropped on a page, the analysis status
 * in the title, "Ask again", pinned chats saved with the account, the
 * repository list's counts, and Home's "Continue where you left off".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { paperSequence, paperKey, type PaperTarget } from "../src/lib/paper-address";
import { analysisInProgress, composeTabTitle, countRuns, doneNotice, doneStatus, pageNameOf, progressStatus } from "../src/lib/tab-title";
import { MAX_RECENT_PAPERS, parseRecentPapers, runProjectId, withOpenedPaper, type RecentPaper } from "../src/lib/recent-papers";
import { repositoryPaperStats } from "../src/lib/repository-paper-counts";

void React;

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/* ------------------------------------------------ Previous and Next */

test("a paper's list has each paper once, and its place in it; nothing to step through is no list", () => {
  const list: PaperTarget[] = [{ paperId: "1" }, { runId: "r2" }, { paperId: "1", tab: "preview", quote: "cited twice" }, { paperId: "3" }];
  assert.deepEqual(paperSequence({ runId: "r2" }, list), { items: [{ paperId: "1" }, { runId: "r2" }, { paperId: "3" }], index: 1 });
  assert.equal(paperSequence({ paperId: "9" }, list), null, "a paper not in the list");
  assert.equal(paperSequence({ paperId: "1" }, [{ paperId: "1" }]), null, "one paper");
  assert.equal(paperSequence({ paperId: "1" }, [{ paperId: "1" }, { paperId: "1" }]), null, "one paper, twice");
  assert.equal(paperSequence({ paperId: "1" }, undefined), null);
  assert.equal(paperKey({ runId: "r", paperId: "p" }), "run:r", "a run names the paper first");
  assert.equal(paperKey({}), null);
});

test("the arrow keys step only when they would do nothing else", async () => {
  const { stepFromKey } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const key = (keyName: string, init: Partial<KeyboardEvent> = {}, target: unknown = null) =>
    stepFromKey({ key: keyName, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: target as EventTarget, ...init });
  assert.equal(key("ArrowLeft"), -1);
  assert.equal(key("ArrowRight"), 1);
  assert.equal(key("ArrowUp"), null);
  assert.equal(key("ArrowLeft", { altKey: true }), null, "Alt+Left is the browser's Back");
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey"] as const) assert.equal(key("ArrowRight", { [modifier]: true }), null, modifier);
  const inside = (selector: string) => ({ closest: (query: string) => (query.split(",").map((part) => part.trim()).includes(selector) ? {} : null) });
  for (const selector of ["input", "textarea", "select", '[role="slider"]', '[role="tablist"]', '[role="menu"]']) {
    assert.equal(key("ArrowRight", {}, inside(selector)), null, `not inside ${selector}`);
  }
  assert.equal(key("ArrowRight", {}, inside("p")), 1, "anywhere else in the window");
});

test("the window shows the paper's place in its list, with Previous and Next", async () => {
  const { PaperExplorerPanel } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const idle = async () => undefined;
  const draw = (stepper: unknown) =>
    renderToStaticMarkup(
      createElement(PaperExplorerPanel, {
        run: { id: "r1", status: "succeeded", source_type: "upload", display_name: "Peer feedback", created_at: "2026-10-01", updated_at: "2026-10-01" } as never,
        detail: null,
        loading: true,
        error: null,
        onClose: () => undefined,
        onResolvePreviewUrl: async () => null,
        onOpenInNewTab: idle,
        onDownload: idle,
        onDownloadReport: idle,
        onToggleFavorite: idle,
        onRename: idle,
        onOpenDashboard: () => undefined,
        stepper: stepper as never,
        headingId: "paper-heading",
      })
    );
  const first = draw({ position: 1, total: 12, onPrevious: null, onNext: () => undefined });
  assert.match(first, />1 of 12</);
  assert.match(first, /<button[^>]*disabled=""[^>]*aria-label="Previous paper"/, "nothing before the first");
  assert.doesNotMatch(first, /<button[^>]*disabled=""[^>]*aria-label="Next paper"/);
  assert.match(first, /id="paper-heading"/, "the heading keeps the id that names the dialog");
  assert.doesNotMatch(draw(null), /Previous paper/, "a paper opened on its own has no list");
  assert.doesNotMatch(draw({ position: 1, total: 1, onPrevious: null, onNext: null }), /Previous paper/);
});

test("a link finds the papers listed with it, in order", async () => {
  const { listedPapers } = await import("../src/components/workspace/PaperLink");
  const anchors = ["/workspace/library?paperId=1", "https://example.org/not-a-paper", "/workspace/library?paper=r2&tab=evidence"].map((href) => ({ getAttribute: () => href }));
  const list = { querySelectorAll: (query: string) => (query === "a[data-paper-link]" ? anchors : []) };
  const link = { closest: (query: string) => (query === "[data-paper-list]" ? list : null) };
  assert.deepEqual(listedPapers(link as never), [{ runId: null, paperId: "1", tab: undefined }, { runId: "r2", paperId: null, tab: "evidence" }]);
  assert.equal(listedPapers({ closest: () => null } as never), undefined, "a link in no list");
  assert.equal(listedPapers(undefined), undefined);
});

test("lists of papers are marked, and the paper windows step through them", () => {
  for (const [path, count] of [
    ["src/components/chat/ChatClient.tsx", 3],
    ["src/components/chat/ChatChartCard.tsx", 1],
    ["src/components/chat/ChatInsightCard.tsx", 1],
    ["src/components/tabs/KeywordExplorer.tsx", 1],
    ["src/components/workspace/WorkspaceHomeClient.tsx", 1],
  ] as const) {
    assert.equal(read(path).match(/data-paper-list=""/g)?.length, count, path);
  }
  assert.match(read("src/components/workspace/PaperLink.tsx"), /data-paper-link=""/);
  assert.match(read("src/components/DashboardClient.tsx"), /sequence: drilldownPapers\.map/);
  assert.match(read("src/components/workspace/WorkspaceGlobalSearch.tsx"), /sequence: shownPapersRef\.current/);
  const provider = read("src/components/workspace/PaperViewerProvider.tsx");
  assert.match(provider, /pushedRef\.current \? "replace" : "push"/);
  assert.match(provider, /load\(target, true\)/, "a step keeps the paper on screen until the next arrives");
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /navigated && !legacyLink && !stepped/, "a step in the Library replaces the address too");
  assert.match(library, /steppableRuns = useMemo/);
});

/* ------------------------------------------------ the Dashboard's tab */

test("the Dashboard opens on the tab the reader left, unless the address names one", () => {
  const dashboard = read("src/components/DashboardClient.tsx");
  assert.match(dashboard, /return readRememberedTab\(\) \?\? DEFAULT_TAB;/);
  assert.match(dashboard, /rememberTab\(currentTabKey\);/);
  assert.match(dashboard, /TAB_DEFINITIONS\.some\(\(tab\) => tab\.key === value\)/, "a stored tab that no longer exists is ignored");
});

/* ------------------------------------------------ the tab's title */

test("the title names the page, then the repository, after the analysis status", () => {
  assert.equal(pageNameOf("Dashboard | Papertrend"), "Dashboard");
  assert.equal(pageNameOf("Papertrend"), "");
  assert.equal(composeTabTitle("Dashboard | Papertrend", { repository: "testtest" }), "Dashboard · testtest | Papertrend");
  assert.equal(composeTabTitle("Chat | Papertrend", {}), "Chat | Papertrend", "a shared page keeps its name");
  assert.equal(composeTabTitle("Home | Papertrend", { status: "(3/5) Analyzing…", repository: "testtest" }), "(3/5) Analyzing… · Home · testtest | Papertrend");
  assert.equal(composeTabTitle("Papertrend", {}), "Papertrend");
});

test("the status counts finished papers, and says how the batch ended", () => {
  const runs = (statuses: string[]) => countRuns(statuses.map((status) => ({ status })));
  const going = runs(["succeeded", "succeeded", "failed", "processing", "queued"]);
  assert.equal(analysisInProgress(going), true);
  assert.equal(progressStatus(going), "(3/5) Analyzing…");
  assert.equal(doneStatus(going), null);
  assert.equal(doneStatus(runs(["succeeded", "succeeded"])), "✓ 2 papers ready");
  assert.equal(doneStatus(runs(["succeeded"])), "✓ 1 paper ready");
  assert.equal(doneStatus(runs(["succeeded", "failed"])), "✓ 1 ready, 1 failed");
  assert.equal(doneStatus(runs(["failed"])), "1 paper failed");
  assert.equal(doneStatus(runs(["canceled"])), null, "a canceled batch has nothing to announce");
  assert.equal(progressStatus(runs([])), null);
  assert.deepEqual(doneNotice(runs(["succeeded", "succeeded"]), "testtest"), { title: "2 papers are ready", body: "In testtest. Click to go back to Papertrend." });
  assert.deepEqual(doneNotice(runs(["succeeded"]), null), { title: "Your paper is ready", body: "Click to go back to Papertrend." });
  assert.equal(doneNotice(runs(["succeeded", "failed"]), "testtest")?.title, "1 of 2 papers analyzed");
});

test("pages about one repository name it in the title; shared pages do not", () => {
  for (const path of ["src/components/workspace/WorkspaceHomeClient.tsx", "src/components/DashboardClient.tsx", "src/components/admin/AdminImportClient.tsx"]) {
    assert.match(read(path), /useTabTitleRepository\(/, path);
  }
  assert.match(read("src/components/admin/AdminImportClient.tsx"), /useTabTitleRepository\(showTrash \? null : libraryProject\?\.name\)/, "the Library's own repository, not in Trash");
  for (const path of ["src/components/chat/ChatClient.tsx", "src/app/workspace/settings/page.tsx"]) {
    assert.doesNotMatch(read(path), /useTabTitleRepository/, path);
  }
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /<WorkspaceTabTitle runs=\{activeRuns\} \/>/);
  const title = read("src/components/workspace/WorkspaceTabTitle.tsx");
  assert.match(title, /new MutationObserver\(apply\)/, "a navigation's new title is added to as well");
  assert.match(title, /Notification\.permission !== "granted" \|\| !readNotifyChoice\(\)/, "a notification only when asked for");
  assert.match(read("src/components/workspace/AnalysisStatusCard.tsx"), /\{hasActiveRuns \? <NotifyWhenDoneToggle/);
});

/* ------------------------------------------------ keyboard */

test("Ctrl+K or ⌘K opens search, even from a field; ? lists the shortcuts", async () => {
  const { isSearchShortcut, isTypingTarget, ShortcutsList, shortcutGroups } = await import("../src/components/workspace/KeyboardShortcuts");
  const press = (key: string, init: Partial<KeyboardEvent> = {}) => isSearchShortcut({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
  assert.equal(press("k", { ctrlKey: true }), true);
  assert.equal(press("K", { metaKey: true }), true);
  assert.equal(press("k"), false);
  assert.equal(press("k", { ctrlKey: true, shiftKey: true }), false);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" } as never), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true } as never), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" } as never), false);
  assert.equal(isTypingTarget(null), false);

  const windows = renderToStaticMarkup(createElement(ShortcutsList, { mac: false }));
  assert.match(windows, />Ctrl<\/kbd>/);
  assert.match(renderToStaticMarkup(createElement(ShortcutsList, { mac: true })), />⌘<\/kbd>/);
  const keys = shortcutGroups(false).flatMap((group) => group.items.flatMap((item) => item.keys.flat()));
  // Each listed key is handled where the list says it is.
  const search = read("src/components/workspace/WorkspaceGlobalSearch.tsx");
  const sources: Record<string, string[]> = {
    "/": [search],
    K: [search],
    "?": [read("src/components/workspace/KeyboardShortcuts.tsx")],
    "←": [read("src/components/workspace/PaperAnalysisExplorerModal.tsx")],
    "↑": [search, read("src/components/workspace/RepositorySwitcher.tsx")],
    Home: [search, read("src/components/workspace/RepositorySwitcher.tsx")],
    Enter: [read("src/components/chat/ChatClient.tsx")],
  };
  const pattern: Record<string, RegExp> = {
    "/": /event\.key === "\/"/,
    K: /isSearchShortcut\(event\)/,
    "?": /event\.key !== "\?"/,
    "←": /"ArrowLeft"/,
    "↑": /"ArrowUp"/,
    Home: /"Home"/,
    Enter: /event\.key === "Enter" && !event\.shiftKey/,
  };
  for (const [key, files] of Object.entries(sources)) {
    assert.ok(keys.includes(key), `${key} is listed`);
    for (const file of files) assert.match(file, pattern[key], key);
  }
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /<KeyboardShortcuts \/>/);
  assert.match(shell, /<WorkspaceProfileMenu onShowShortcuts=\{openKeyboardShortcuts\} \/>/, "and from the account menu");
});

/* ------------------------------------------------ dropped PDFs */

test("only a drag with files in it counts, and each repository page takes one", async () => {
  const { carriesFiles } = await import("../src/components/workspace/PdfDropTarget");
  assert.equal(carriesFiles({ types: ["Files"] } as never), true);
  assert.equal(carriesFiles({ types: ["text/plain", "text/uri-list"] } as never), false, "text or a link dragged on the page");
  assert.equal(carriesFiles(null), false);
  for (const path of ["src/components/workspace/WorkspaceHomeClient.tsx", "src/components/DashboardClient.tsx", "src/components/admin/AdminImportClient.tsx"]) {
    const page = read(path);
    assert.match(page, /<PdfDropTarget/, path);
    assert.match(page, /initialFiles=\{droppedFiles\}/, path);
  }
  assert.match(read("src/components/admin/AdminImportClient.tsx"), /repositoryName=\{showTrash \? null : libraryProject\?\.name\}/, "not on the list of repositories or in Trash");
  const modal = read("src/components/workspace/AnalyzeFlowModal.tsx");
  assert.match(modal, /addedDropRef\.current === initialFiles/, "each drop is added once");
  assert.match(modal, /if \(!uploading\) selectPdfFiles\(initialFiles\)/, "through the same checks as a chosen file");
});

/* ------------------------------------------------ Ask again */

test("Ask again offers each effort, marks the answer's own, and keeps Max for the box", async () => {
  const { default: AskAgainMenu } = await import("../src/components/chat/AskAgainMenu");
  const models = [{ value: "openai/gpt-6-luna-20260922", label: "GPT-6 Luna" }];
  const closed = renderToStaticMarkup(createElement(AskAgainMenu, { models, model: models[0].value, onAsk: () => undefined }));
  assert.match(closed, /Ask again/);
  assert.match(closed, /aria-expanded="false"/);
  const open = renderToStaticMarkup(createElement(AskAgainMenu, { models, model: models[0].value, answeredAt: "medium", onAsk: () => undefined, defaultOpen: true }));
  assert.deepEqual([...open.matchAll(/data-effort="(\w+)"/g)].map((match) => match[1]), ["low", "medium", "high", "max"]);
  assert.match(open, /Medium<span[^>]*>· this answer/);
  assert.doesNotMatch(open, />Model</, "one model: no model to choose");
  assert.match(open, /Puts the question in the box at Max/);
  const chart = renderToStaticMarkup(createElement(AskAgainMenu, { models, model: models[0].value, maxUnavailable: true, onAsk: () => undefined, defaultOpen: true }));
  assert.match(chart, /data-effort="max" disabled=""/, "a chart goes up to High");
  const two = renderToStaticMarkup(
    createElement(AskAgainMenu, { models: [...models, { value: "other/model", label: "Other" }], model: models[0].value, onAsk: () => undefined, defaultOpen: true })
  );
  assert.match(two, />Model</);
  assert.match(two, /aria-pressed="true"[^>]*><span>GPT-6 Luna/);
});

test("Ask again sends the question again in its place, in the mode it was asked in", () => {
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /await resendUserMessage\(message, prompt\);/, "an edit goes the same way");
  assert.match(client, /editMessageId: message\.id\.startsWith\("local-"\) \? undefined : message\.id/);
  assert.match(client, /toolMode: askedToolMode\(question, answer\)/);
  assert.match(client, /if \(choice\.effort === "max"\) \{\s*setEffort\("max"\);\s*setSelectedModel\(choice\.model\);\s*focusComposerWithDraft\(question\.content\);/);
  assert.match(client, /message === visibleMessages\[visibleMessages\.length - 1\] && canPersist \? \(\s*<AskAgainMenu/, "only under the latest answer");
});

/* ------------------------------------------------ pinned chats */

test("pinned chats are saved with the account, once its profile is in hand", () => {
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /updateProfile\(\{ pinnedChatThreadIds: next\(pinnedThreadIds\)/);
  assert.match(client, /if \(!profileFromAccount\) return;/);
  assert.match(client, /window\.localStorage\.removeItem\(PINNED_THREADS_STORAGE_KEY\)/, "this browser's pins move into the account once");
  assert.doesNotMatch(client, /localStorage\.setItem\(\s*PINNED_THREADS_STORAGE_KEY/);
  const provider = read("src/components/workspace/WorkspaceProvider.tsx");
  assert.match(provider, /setProfileFromAccount\(Boolean\(authProfile\?\.workspace_profile\)\)/);
  assert.match(provider, /pinnedChatThreadIds: current\.pinnedChatThreadIds/, "resetting the research profile keeps the pins");
  assert.match(read("src/types/workspace.ts"), /pinnedChatThreadIds\?: string\[\];/);
});

/* ------------------------------------------------ the repository list */

test("each repository's count is its analysed papers, by its folder's repository", () => {
  const projects = [{ id: "p1" }, { id: "p2" }];
  const stats = repositoryPaperStats(
    projects,
    [
      { status: "succeeded", input_payload: { project_id: "p1" } },
      { status: "succeeded", folder_id: "f2", input_payload: { project_id: "p1" } },
      { status: "failed", input_payload: { project_id: "p1" } },
      { status: "processing", input_payload: { project_id: "p2" } },
      { status: "canceled", input_payload: { project_id: "p2" } },
      { status: "succeeded", trashed_at: "2026-10-01", input_payload: { project_id: "p2" } },
      { status: "succeeded", input_payload: { project_id: "elsewhere" } },
    ],
    new Map([["f2", "p2"]])
  );
  assert.deepEqual(
    { p1: stats.get("p1"), p2: stats.get("p2") },
    { p1: { papers: 1, inProgress: 0, failed: 1, latest: null }, p2: { papers: 1, inProgress: 1, failed: 0, latest: null } }
  );
  const page = read("src/components/workspace/workspaces/ProjectIndexClient.tsx");
  assert.match(page, /aria-current=\{open \? "true" : undefined\}/);
  assert.match(page, /Open now/);
});

/* ------------------------------------------------ continue where you left off */

test("the last papers opened are kept newest first, once each, and read back safely", () => {
  const at = (runId: string, projectId: string | null = "p1"): RecentPaper => ({ runId, title: `Paper ${runId}`, projectId, openedAt: "2026-10-21T00:00:00.000Z" });
  let list: RecentPaper[] = [];
  for (const id of ["a", "b", "a"]) list = withOpenedPaper(list, at(id));
  assert.deepEqual(list.map((item) => item.runId), ["a", "b"]);
  for (let index = 0; index < 20; index += 1) list = withOpenedPaper(list, at(`x${index}`));
  assert.equal(list.length, MAX_RECENT_PAPERS);
  assert.deepEqual(parseRecentPapers("not json"), []);
  assert.deepEqual(parseRecentPapers(JSON.stringify([{ runId: 1 }, at("ok", null)])), [at("ok", null)]);
  assert.equal(runProjectId({ folder_id: "f1", input_payload: { project_id: "p1" } }, new Map([["f1", "p2"]])), "p2", "a folder's repository first");
  assert.equal(runProjectId({ folder_id: "gone", input_payload: { project_id: "p1" } }, new Map()), "p1");
});

test("Home continues the last chat and the last paper; the chat opens a conversation by its address", () => {
  const home = read("src/components/workspace/WorkspaceHomeClient.tsx");
  assert.match(home, /<ContinueRow chat=\{lastChat\} paper=\{lastPaper\} \/>/);
  assert.match(home, /\/api\/chat\/threads\?limit=1/);
  assert.match(home, /paper\.projectId === currentProject\?\.id/, "this repository's paper");
  assert.match(home, /href=\{`\/workspace\/chat\?thread=\$\{encodeURIComponent\(chat\.id\)\}`\}/);
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /params\.get\("thread"\)/);
  assert.match(client, /void refreshThreads\(linked\);/);
  for (const path of ["src/components/workspace/PaperViewerProvider.tsx", "src/components/admin/AdminImportClient.tsx"]) {
    assert.match(read(path), /rememberOpenedPaper\(/, path);
  }
});
