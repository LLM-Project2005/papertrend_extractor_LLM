/*
 * The smaller findings of the site audit, each fixed where it was found
 * (docs/32, 2.11). What can run outside a browser runs in
 * audit-fixes-behaviour-*.test.ts; each check left here as text says why it
 * needs a browser or the chat page's providers.
 */
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
import { ORDINAL_RAMP } from "../src/lib/chart-palette";
import { isInAppBrowser } from "../src/lib/auth/in-app-browser";
import { friendlyAuthError } from "../src/lib/auth/auth-errors";
import { runsInProgress } from "../src/lib/run-polling";

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

test("the sign-in panel keeps the invite code only through the stored copy", () => {
  // The panel reads and saves the code in an effect and clears it on submit, which a static render never runs.
  const panel = read("src/components/auth/AuthPanel.tsx");
  assert.match(panel, /readPendingInvite\(\)/);
  assert.match(panel, /savePendingInvite\(/);
  assert.match(panel, /clearPendingInvite\(\)/);
  assert.doesNotMatch(panel, /sessionStorage/);
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
  // The notice shows once an effect has read the user agent, which a static render never runs.
  assert.match(read("src/components/auth/AuthPanel.tsx"), /\{inAppBrowser \? \(\s*<p role="note"[^>]*>\s*\{IN_APP_BROWSER_NOTICE\}/);
});

// AUTH-8: reset only for an account that exists.
test("a password reset is not offered while creating an account", () => {
  // Sign-up is reached by a click, which a static render never makes; the sign-in form's reset button is rendered in audit-fixes-behaviour-auth.
  assert.match(read("src/components/auth/AuthPanel.tsx"), /passwordMode === "signin" \? \(\s*<button[\s\S]{0,200}handlePasswordReset/);
});

// SHELL-4: sign-in returns to the full address.
test("sign-in returns to the page with its query", () => {
  // The shell sends a signed-out reader to sign in from an effect, which a static render never runs.
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /encodeURIComponent\(`\$\{pathname \|\| "\/workspace\/home"\}\$\{window\.location\.search\}`\)/);
});

// SHELL-10: Home's figures follow the papers as they finish.
test("Home reloads its figures as each followed paper finishes, and on Try again", () => {
  // An effect and a click handler, which a static render never runs; the Try again button is rendered in audit-fixes-behaviour-workspace.
  const home = read("src/components/workspace/WorkspaceHomeClient.tsx");
  assert.match(home, /if \(finishedRunCount > finishedRunCountRef\.current\) void refreshDashboardData\(\)/);
  assert.match(home, /onClick=\{\(\) => void refreshDashboardData\(\)\}[\s\S]{0,120}Try again/);
});

// SHELL-7: search shows what the Library shows.
test("global search names papers and statuses as the Library does", () => {
  // Paper results appear only once the palette is opened and has fetched them, in a browser.
  const search = read("src/components/workspace/WorkspaceGlobalSearch.tsx");
  assert.match(search, /import \{ getRunDisplayTitle, getRunStatusLabel \} from "@\/lib\/ingestion-status"/);
  assert.match(search, /searchText: \[titleOf\(run\), run\.source_filename \?\? "", getRunStatusLabel\(run\)\]\.join\(" "\)/);
});

test("search lists each action once and hands the typed words to the Library", () => {
  // The actions live inside the palette, shown once it is opened, and choosing one is a click.
  const hrefsOf = (source: string, start: string) => {
    const block = source.slice(source.indexOf(start), source.indexOf("\n];", source.indexOf(start)));
    return [...block.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  };
  const actions = hrefsOf(read("src/components/workspace/WorkspaceGlobalSearch.tsx"), "const ACTION_ITEMS");
  const pages = hrefsOf(read("src/components/workspace/WorkspaceShell.tsx"), "const SEARCH_PAGE_ITEMS");
  assert.ok(actions.length >= 1 && pages.length >= 6);
  assert.deepEqual(actions.filter((href) => pages.includes(href)), [], "an action with a page's address is listed twice");
  const search = read("src/components/workspace/WorkspaceGlobalSearch.tsx");
  assert.match(search, /router\.push\(`\/workspace\/library\?q=\$\{encodeURIComponent\(normalizedQuery\)\}`\)/);
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
  // ChatClient needs the auth and workspace providers and a browser to draw a conversation.
  assert.match(read("src/components/chat/ChatClient.tsx"), /previewConversationSources\(numberAnswerSources\(message\.content, message\.citations\), 5\)/);
});

// CHAT-8: phones and tablets can manage their chats, and the tray leaves the composer free.
test("below the large breakpoint the chat list is a drawer with every action", () => {
  // ChatClient needs the auth and workspace providers and a browser: the drawer opens on a click, its chats load in an effect, and Escape is a key handler.
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
  // The composer is ChatClient's, measured with a ResizeObserver in an effect, and where the tray lands is layout; all need a browser.
  // That the tray is drawn in the dock and card these rules move is rendered in audit-fixes-behaviour-workspace.
  assert.match(read("src/components/chat/ChatClient.tsx"), /<div ref=\{composerAreaRef\} className="flex-none/);
  assert.match(read("src/lib/composer-offset.ts"), /root\.style\.setProperty\(COMPOSER_OFFSET_VAR,/);
  assert.match(read("src/lib/composer-offset.ts"), /root\.style\.removeProperty\(COMPOSER_OFFSET_VAR\)/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.tray-dock \{\s*bottom: calc\(max\(0\.75rem, env\(safe-area-inset-bottom\)\) \+ var\(--chat-composer-offset, 0px\)\);/);
  assert.match(css, /bottom: calc\(1\.25rem \+ var\(--chat-composer-offset, 0px\)\);/);
  // Open, it stops below the headers (on a phone it covered the chat list button).
  assert.match(css, /\.tray-card \{\s*max-height: min\(72dvh, 600px, calc\(100dvh - var\(--chat-composer-offset, 0px\) - 9rem\)\);/);
});

// CHAT-10: an arriving answer is announced; opening a conversation is not.
test("screen readers hear that an answer arrived", () => {
  // ChatClient needs the auth and workspace providers and a browser; the announcement and the scrolling happen in effects.
  const client = read("src/components/chat/ChatClient.tsx");
  assert.match(client, /const announcedAnswerRef = useRef<string \| null>\(""\);/);
  assert.match(client, /setAnswerAnnouncement\(`Answer ready/);
  const switchBlock = client.slice(client.indexOf("if (loadedThreadIdRef.current !== threadId) {"));
  assert.match(switchBlock.slice(0, 300), /announcedAnswerRef\.current = null;/);
  // The live region sits outside the transcript: inside it, it stood out
  // below the section and the phone page scrolled to it (found on the pilot).
  const region = client.indexOf("{answerAnnouncement}");
  assert.ok(region > 0 && region < client.indexOf("ref={scrollContainerRef}"), "announcer before the transcript");
  assert.doesNotMatch(client, /scrollAnchorRef\.current\?\.scrollIntoView/);
  assert.match(client, /box\?\.scrollTo\(\{\s*top: box\.scrollHeight,/);
});

// DASH-6: tooltips readable in dark mode; stacked trends capped.
test("chart tooltips are themed for light and dark, and stacked trends stop at eight series", () => {
  assert.equal(tooltipTheme(true).contentStyle.backgroundColor, "#1f1f1f");
  assert.equal(tooltipTheme(false).contentStyle.backgroundColor, "#ffffff");
  assert.notEqual(tooltipTheme(true).itemStyle.color, tooltipTheme(false).itemStyle.color);
  assert.equal(MAX_STACKED_SERIES, 8);
});

// DASH-7: papers in progress are counted where they belong.
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
  // The dashboard reloads from an effect as each paper finishes, which a static render never runs.
  assert.match(read("src/components/DashboardClient.tsx"), /if \(papersFinished > papersFinishedRef\.current\) void refresh\(\);/);
});

// DASH-8: one colour per value; labels by default only on a readable map.
test("the semantic map gives each category its own colour, and years an ordered ramp", () => {
  const points = Array.from({ length: 12 }, (_, index) => ({
    clusterId: 0,
    categories: [`Category ${String(index).padStart(2, "0")}`],
    year: String(2010 + index),
    track: null,
  }));
  // Categories by position from the checked eight (3.4): no two of the first eight share one.
  const byCategory = colorScale(points.slice(0, 8), "category");
  assert.equal(new Set(byCategory.values()).size, 8, "eight categories, eight colours");
  assert.equal(byCategory.get("Category 00"), TOPIC_PALETTE[0]);
  // Years are ordered: a single-hue ramp from earliest (lightest) to latest, Unknown grey.
  const byYear = colorScale([...points, { clusterId: 0, categories: [], year: "", track: null }], "year");
  assert.deepEqual([...byYear.keys()].slice(0, 2), ["2010", "2011"]);
  assert.equal([...byYear.keys()].at(-1), "Unknown");
  assert.equal(byYear.get("2010"), ORDINAL_RAMP[0]);
  assert.equal(byYear.get("2021"), ORDINAL_RAMP[ORDINAL_RAMP.length - 1]);
  assert.equal(byYear.get("Unknown"), FALLBACK_POINT_COLOR);
  assert.equal(pointColor(points[3], "year", byYear), byYear.get("2013"));
  assert.equal(pointColor(points[3], "year", new Map()), FALLBACK_POINT_COLOR);
  assert.equal(showLabelsByDefault(LABELS_BY_DEFAULT_MAX, null), true);
  assert.equal(showLabelsByDefault(LABELS_BY_DEFAULT_MAX + 1, null), false);
  assert.equal(showLabelsByDefault(500, true), true);
  // RepositorySemanticMap loads its map with fetch in an effect and draws it with React Flow, so it needs a browser.
  assert.doesNotMatch(read("src/components/workspace/RepositorySemanticMap.tsx"), /function hashColor/);
});

// LIB-7: the Library's filters and columns describe what is there.
test("the Library offers only filters that can match and a useful column", () => {
  // The type menu opens on a click and the columns appear once the papers load in an effect; both need a browser.
  const library = read("src/components/admin/AdminImportClient.tsx");
  const options = library.slice(library.indexOf("const TYPE_OPTIONS"), library.indexOf("];", library.indexOf("const TYPE_OPTIONS")));
  assert.match(options, /"all"/);
  assert.match(options, /"pdf"/);
  assert.doesNotMatch(options, /"image"|"document"|"other"/);
  assert.doesNotMatch(library, /<div>Owner<\/div>/);
  assert.match(library, /<div>Year<\/div>/);
  assert.doesNotMatch(library, /ownerLabel: "me"/);
});
