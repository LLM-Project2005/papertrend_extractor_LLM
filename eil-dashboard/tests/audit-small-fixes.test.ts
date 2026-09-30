import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tooltipTheme, MAX_STACKED_SERIES } from "../src/lib/chart-tooltip";
import { numberAnswerSources } from "../src/lib/conversation-sources";
import { parsePendingInvite, PENDING_INVITE_MAX_AGE_MS } from "../src/lib/pending-invite";
import {
  colorScale,
  FALLBACK_POINT_COLOR,
  LABELS_BY_DEFAULT_MAX,
  pointColor,
  showLabelsByDefault,
} from "../src/lib/semantic-map-colors";
import { TOPIC_PALETTE } from "../src/lib/constants";
import { CHAT_JOB_FAILED_MESSAGE, MAX_CHAT_JOB_ATTEMPTS } from "../src/lib/repository-chat-jobs";
import { isInAppBrowser } from "../src/lib/auth/in-app-browser";
import { friendlyAuthError } from "../src/lib/auth/auth-errors";
import { runsInProgress } from "../src/lib/run-polling";

/** The smaller findings of the site audit, each fixed where it was found (docs/32, 2.11). */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

// AUTH-2: the invite code survives the confirmation email opening a new tab.
test("a pending invite code is kept for a week, then forgotten", () => {
  const now = 1_800_000_000_000;
  const saved = (code: unknown, savedAt: unknown) => JSON.stringify({ code, savedAt });
  assert.equal(parsePendingInvite(saved("PT-ABCD-1234", now - 1000), now), "PT-ABCD-1234");
  assert.equal(parsePendingInvite(saved("PT-ABCD-1234", now - PENDING_INVITE_MAX_AGE_MS - 1), now), "");
  assert.equal(parsePendingInvite(saved("<script>", now), now), "");
  assert.equal(parsePendingInvite(saved("PT-ABCD", "yesterday"), now), "");
  assert.equal(parsePendingInvite("not json", now), "");
  assert.equal(parsePendingInvite(null, now), "");
});

test("the invite code lives in localStorage, not in one tab's sessionStorage", () => {
  const panel = read("src/components/auth/AuthPanel.tsx");
  assert.match(panel, /readPendingInvite\(\)/);
  assert.match(panel, /savePendingInvite\(/);
  assert.match(panel, /clearPendingInvite\(\)/);
  assert.doesNotMatch(panel, /sessionStorage/);
  assert.match(read("src/lib/pending-invite.ts"), /window\.localStorage\.setItem/);
});

// AUTH-2: an app's built-in browser blocks the Google and Facebook window; the reader is told why.
test("in-app browsers are recognised, ordinary browsers are not", () => {
  const inApp = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.8.0",
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0 Mobile Safari/537.36",
  ];
  const browsers = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5; rv:129.0) Gecko/20100101 Firefox/129.0",
  ];
  for (const agent of inApp) assert.equal(isInAppBrowser(agent), true, agent);
  for (const agent of browsers) assert.equal(isInAppBrowser(agent), false, agent);
  assert.equal(isInAppBrowser(undefined), false);
  assert.match(
    friendlyAuthError({ code: "auth/operation-not-supported-in-this-environment" }, "fallback"),
    /Open this page in Chrome or Safari/
  );
  assert.match(read("src/components/auth/AuthPanel.tsx"), /\{inAppBrowser \? \(\s*<p role="note"[^>]*>\s*\{IN_APP_BROWSER_NOTICE\}/);
});

// AUTH-8: waiting for the confirmation email is its own step; reset only for an account that exists.
test("the confirmation step replaces the sign-up form and offers a way back", () => {
  const panel = read("src/components/auth/AuthPanel.tsx");
  const early = panel.indexOf("if (awaitingConfirmation) {");
  const form = panel.indexOf('passwordMode === "signup" ? "Create your account" : title');
  assert.ok(early > 0 && early < form, "the waiting step returns before the form is drawn");
  assert.match(panel.slice(early, form), /Check your inbox/);
  assert.match(panel.slice(early, form), /Wrong address\? Start again/);
  assert.match(panel, /passwordMode === "signin" \? \(\s*<button[\s\S]{0,200}handlePasswordReset/);
  assert.match(read("src/lib/firebase-client.ts"), /sendPasswordResetEmail\(auth, email, \{ url: `\$\{window\.location\.origin\}\/login` \}\)/);
});

// SHELL-3 / SHELL-4: settings opens without a repository; sign-in returns to the full address.
test("settings needs no repository, and sign-in returns to the page with its query", () => {
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /const PROJECT_OPTIONAL_ROUTES = \["\/workspace\/settings"\]/);
  assert.match(shell, /encodeURIComponent\(`\$\{pathname \|\| "\/workspace\/home"\}\$\{window\.location\.search\}`\)/);
  assert.match(shell, /href: "\/workspace\/settings\?section=repository"/);
});

// SHELL-5: every workspace page names itself in the browser tab.
test("each workspace page has its own title", () => {
  for (const [page, title] of [["home", "Home"], ["library", "Library"], ["dashboard", "Dashboard"], ["chat", "Chat"], ["settings", "Settings"]]) {
    assert.match(read(`src/app/workspace/${page}/page.tsx`), new RegExp(`export const metadata: Metadata = \\{ title: "${title}" \\}`), page);
  }
});

// SHELL-10: a queued paper waiting its turn is not "stuck".
test("only a paper being analysed can be stuck", () => {
  const home = read("src/components/workspace/WorkspaceHomeClient.tsx");
  const body = home.slice(home.indexOf("function isRunStuck("), home.indexOf("function isRunStuck(") + 200);
  assert.match(body, /if \(run\.status !== "processing"\) \{/);
  assert.doesNotMatch(body, /"queued"/);
  assert.match(home, /if \(finishedRunCount > finishedRunCountRef\.current\) void refreshDashboardData\(\)/);
  assert.match(home, /onClick=\{\(\) => void refreshDashboardData\(\)\}[\s\S]{0,120}Try again/);
});

// SHELL-7: search shows what the Library shows.
test("global search names papers and statuses as the Library does", () => {
  const search = read("src/components/workspace/WorkspaceGlobalSearch.tsx");
  assert.match(search, /import \{ getRunDisplayTitle, getRunStatusLabel \} from "@\/lib\/ingestion-status"/);
  assert.match(search, /searchText: \[titleOf\(run\), run\.source_filename \?\? "", getRunStatusLabel\(run\)\]\.join\(" "\)/);
});

test("search lists each place once and hands the typed words to the Library", () => {
  const hrefsOf = (source: string, start: string) => {
    const block = source.slice(source.indexOf(start), source.indexOf("\n];", source.indexOf(start)));
    return [...block.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  };
  const actions = hrefsOf(read("src/components/workspace/WorkspaceGlobalSearch.tsx"), "const ACTION_ITEMS");
  const pages = hrefsOf(read("src/components/workspace/WorkspaceShell.tsx"), "const SEARCH_PAGE_ITEMS");
  assert.ok(actions.length >= 1 && pages.length >= 6);
  assert.deepEqual(actions.filter((href) => pages.includes(href)), [], "an action with a page's address is listed twice");
  assert.equal(new Set(pages).size, pages.length);
  const search = read("src/components/workspace/WorkspaceGlobalSearch.tsx");
  assert.match(search, /router\.push\(`\/workspace\/library\?q=\$\{encodeURIComponent\(normalizedQuery\)\}`\)/);
  assert.match(read("src/components/admin/AdminImportClient.tsx"), /searchParams\.get\("q"\)/);
});

// CHAT-4: a transient failure is retried; the reader never sees a raw error.
test("a chat job is retried on a transient failure and fails with a plain message", () => {
  assert.equal(MAX_CHAT_JOB_ATTEMPTS, 3);
  assert.match(CHAT_JOB_FAILED_MESSAGE, /Ask again/);
  const route = read("src/app/api/chat/jobs/process/route.ts");
  assert.match(route, /const refusal = error instanceof GuardError;/);
  assert.match(route, /request\.headers\.get\("x-cloudtasks-taskretrycount"\)/);
  assert.match(route, /if \(!refusal && attempt < MAX_CHAT_JOB_ATTEMPTS\) \{\s*await releaseRepositoryChatJob\(/);
  assert.match(route, /\{ ok: false, retry: true \}, \{ status: 503 \}/);
  // The final failure answers with success so Cloud Tasks stops retrying.
  assert.match(route, /await failRepositoryChatJob\(job\.ownerUserId, job\.id, error, refusal \? \(error as GuardError\)\.message : undefined\);\s*\/\/[^\n]*\n\s*return NextResponse\.json\(\{ ok: false \}\);/);
  const jobs = read("src/lib/repository-chat-jobs.ts");
  assert.match(jobs, /\[id, readerMessage\.slice\(0, 1_000\), ownerUserId\]/);
  assert.match(jobs, /repositoryLimitations: \[readerMessage\.slice\(0, 1_000\)\]/);
  assert.doesNotMatch(jobs, /\[id, message\.slice\(0, 1_000\), ownerUserId\]/);
});

// CHAT-5: a cached answer is only served for the same model and web setting, and only if it was clean.
test("the answer cache keys on model and web search, and keeps only clean answers", () => {
  const chat = read("src/lib/repository-chat.ts");
  assert.match(chat, /`model:\$\{input\.model \?\? ""\}`,\s*`web:\$\{input\.allowWeb \? 1 : 0\}`/);
  assert.match(chat, /const clean = \(result\.limitations \?\? \[\]\)\.length === 0;\s*if \(cacheable && clean && /);
  assert.match(chat, /execution: result\.execution \? structuredClone\(result\.execution\) : undefined/);
});

// CHAT-7: the source cards follow the numbers in the answer.
test("answer sources are numbered in the order the answer cites them", () => {
  const citations = [
    { paperId: "1", title: "Reading fluency", year: "2019", href: "/a" },
    { paperId: "2", title: "Learner autonomy", year: "2021", href: "/b" },
    { paperId: "3", title: "Never cited", year: "2020", href: "/c" },
  ];
  const numbered = numberAnswerSources("Autonomy helps (Learner autonomy, 2021), as does fluency (Reading fluency, 2019).", citations);
  assert.deepEqual(numbered.map((source) => [source.paperId, source.number]), [["2", 1], ["1", 2], ["3", undefined]]);
  assert.match(read("src/components/chat/ChatClient.tsx"), /previewConversationSources\(numberAnswerSources\(message\.content, message\.citations\), 5\)/);
});

// CHAT-8: phones and tablets can manage their chats, and the tray leaves the composer free.
test("below the large breakpoint the chat list is a drawer with every action", () => {
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /const chatListIsOverlay = useIsNarrow\(1024\);/);
  assert.match(client, /useDialogLayer\(chatListDrawer, chatListRef, \(\) => setChatListOpen\(false\)\);/);
  assert.match(client, /onClick=\{\(\) => setChatListOpen\(true\)\}\s*aria-haspopup="dialog"/);
  assert.match(client, /\.\.\.\(chatListDrawer \? \{ role: "dialog", "aria-modal": true, "aria-label": "Your chats" \} : \{\}\)/);
  // The drawer is the same list: pin, rename, delete and older chats.
  const aside = client.slice(client.indexOf("ref={chatListRef}"), client.indexOf("</aside>"));
  for (const action of ["togglePinnedThread(thread.id)", "renameThread(thread)", "deleteThread(thread)", "loadOlderThreads()"]) {
    assert.ok(aside.includes(action), action);
  }
  // Rename and delete ask in the page.
  assert.doesNotMatch(client, /window\.prompt\(|window\.confirm\(/);
  assert.match(client, /\{threadDialog\.kind === "rename" \? "Rename chat" : "Delete this chat\?"\}/);
  // A chat menu's Escape runs before the drawer's, so it closes the menu only.
  assert.match(client, /document\.addEventListener\("keydown", onKey\);\s*return \(\) => document\.removeEventListener\("keydown", onKey\);\s*\}, \[menuOpen, conversationMenuOpen, threadMenuId\]\);/);
  assert.match(read("src/components/ui/Modal.tsx"), /window\.addEventListener\("keydown", handleKeyDown\)/);
});

test("the analysis tray stands above the chat composer", () => {
  assert.match(read("src/components/chat/ChatClient.tsx"), /<div ref=\{composerAreaRef\} className="flex-none/);
  assert.match(read("src/lib/composer-offset.ts"), /root\.style\.setProperty\(COMPOSER_OFFSET_VAR,/);
  assert.match(read("src/lib/composer-offset.ts"), /root\.style\.removeProperty\(COMPOSER_OFFSET_VAR\)/);
  assert.match(read("src/components/workspace/WorkspaceShell.tsx"), /className="tray-dock pointer-events-none fixed/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.tray-dock \{\s*bottom: calc\(max\(0\.75rem, env\(safe-area-inset-bottom\)\) \+ var\(--chat-composer-offset, 0px\)\);/);
  assert.match(css, /bottom: calc\(1\.25rem \+ var\(--chat-composer-offset, 0px\)\);/);
});

// CHAT-10: an arriving answer is announced; opening a conversation is not.
test("screen readers hear that an answer arrived", () => {
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /const announcedAnswerRef = useRef<string \| null>\(""\);/);
  assert.match(client, /setAnswerAnnouncement\(`Answer ready/);
  const switchBlock = client.slice(client.indexOf("if (loadedThreadIdRef.current !== threadId) {"));
  assert.match(switchBlock.slice(0, 300), /announcedAnswerRef\.current = null;/);
});

// DASH-6: tooltips readable in dark mode; stacked trends capped.
test("chart tooltips follow the theme and trends stack at most eight series", () => {
  assert.equal(tooltipTheme(true).contentStyle.backgroundColor, "#1f1f1f");
  assert.equal(tooltipTheme(false).contentStyle.backgroundColor, "#ffffff");
  assert.notEqual(tooltipTheme(true).itemStyle.color, tooltipTheme(false).itemStyle.color);
  assert.equal(MAX_STACKED_SERIES, 8);
  for (const tab of ["TrendAnalysis", "KeywordExplorer", "TrackAnalysis"]) {
    assert.match(read(`src/components/tabs/${tab}.tsx`), /tooltipTheme\(/, tab);
  }
  assert.match(read("src/components/tabs/TrendAnalysis.tsx"), /MAX_STACKED_SERIES/);
});

// DASH-7: an empty repository says so; the tabs' empty messages only ever mean the filters.
test("an empty repository is not blamed on the filters", () => {
  const dashboard = read("src/components/DashboardClient.tsx");
  assert.match(dashboard, /const repositoryHasNoPapers = Boolean\(\s*data &&\s*!loading &&\s*!liveDataError &&/);
  assert.match(dashboard, /\{repositoryHasNoPapers && !isSemanticMapTab \? \(\s*<div[^>]*>\s*<h2[^>]*>No analysed papers yet<\/h2>/);
  assert.match(dashboard, /\{repositoryHasNoPapers && !isSemanticMapTab \? null : <>/);
  for (const tab of ["TrendAnalysis", "KeywordExplorer", "Overview"]) {
    const source = read(`src/components/tabs/${tab}.tsx`);
    assert.match(source, /No papers match the current filters\./, tab);
    assert.doesNotMatch(source, /No data for the selected filters/, tab);
  }
  assert.doesNotMatch(read("src/components/tabs/TrackAnalysis.tsx"), />No data</);
});

test("papers still being analysed are counted for their repository only", () => {
  const runs = [
    { status: "queued", input_payload: { project_id: "p1" } },
    { status: "processing", input_payload: { project_id: "p1" } },
    { status: "processing", input_payload: { project_id: "p2" } },
    { status: "succeeded", input_payload: { project_id: "p1" } },
    { status: "queued", input_payload: null },
  ];
  assert.equal(runsInProgress(runs, "p1"), 3);
  assert.equal(runsInProgress(runs, "p2"), 2);
  assert.equal(runsInProgress([], "p1"), 0);
  const dashboard = read("src/components/DashboardClient.tsx");
  assert.match(dashboard, /useContext\(AnalysisRunsContext\)\?\.runs/);
  assert.match(dashboard, /if \(papersFinished > papersFinishedRef\.current\) void refresh\(\);/);
  assert.match(dashboard, /being analysed\. The charts update as each one finishes\./);
});

// DASH-8: one colour per value; labels by default only on a readable map.
test("the semantic map gives each category or year its own colour", () => {
  const points = Array.from({ length: 12 }, (_, index) => ({
    clusterId: 0,
    categories: [`Category ${index}`],
    year: String(2010 + index),
    track: null,
  }));
  const byCategory = colorScale(points, "category");
  assert.equal(new Set(byCategory.values()).size, 12, "twelve categories, twelve colours");
  const byYear = colorScale([...points, { clusterId: 0, categories: [], year: "", track: null }], "year");
  assert.deepEqual([...byYear.keys()].slice(0, 2), ["2010", "2011"]);
  assert.equal([...byYear.keys()].at(-1), "Unknown");
  assert.equal(byYear.get("2010"), TOPIC_PALETTE[0]);
  assert.equal(pointColor(points[3], "year", byYear), byYear.get("2013"));
  assert.equal(pointColor(points[3], "year", new Map()), FALLBACK_POINT_COLOR);
  assert.equal(showLabelsByDefault(LABELS_BY_DEFAULT_MAX, null), true);
  assert.equal(showLabelsByDefault(LABELS_BY_DEFAULT_MAX + 1, null), false);
  assert.equal(showLabelsByDefault(500, true), true);
  assert.doesNotMatch(read("src/components/workspace/RepositorySemanticMap.tsx"), /function hashColor/);
});

// LIB-7: the Library's filters and columns describe what is there.
test("the Library offers only filters that can match and a useful column", () => {
  const library = read("src/components/admin/AdminImportClient.tsx");
  const options = library.slice(library.indexOf("const TYPE_OPTIONS"), library.indexOf("];", library.indexOf("const TYPE_OPTIONS")));
  assert.match(options, /"all"/);
  assert.match(options, /"pdf"/);
  assert.doesNotMatch(options, /"image"|"document"|"other"/);
  assert.doesNotMatch(library, /<div>Owner<\/div>/);
  assert.match(library, /<div>Year<\/div>/);
  assert.doesNotMatch(library, /ownerLabel: "me"/);
});
