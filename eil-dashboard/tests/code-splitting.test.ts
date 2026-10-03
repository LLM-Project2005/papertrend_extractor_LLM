import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Heavy parts load when used (docs/32, 3.3). Measured First Load JS: landing
 * 222 -> 140 kB, chat 409 -> 202 kB, dashboard 454 -> 269 kB. These checks keep
 * the pieces that did it from quietly coming back to every page. Which module a
 * page imports, and how, is the build's shape rather than behaviour, so most
 * of them read the source.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the public pages carry no workspace state, Supabase client or graph styles", () => {
  const root = read("src/app/layout.tsx");
  assert.doesNotMatch(root, /WorkspaceProvider/);
  assert.doesNotMatch(root, /@xyflow\/react/);
  assert.match(read("src/app/workspace/layout.tsx"), /<WorkspaceProvider>/);
  assert.match(read("src/app/workspaces/layout.tsx"), /<WorkspaceProvider>/);
  assert.match(read("src/components/workspace/RepositorySemanticMap.tsx"), /import "@xyflow\/react\/dist\/style\.css";/);
  const auth = read("src/components/auth/AuthProvider.tsx");
  assert.doesNotMatch(auth, /import \{ supabase \} from "@\/lib\/supabase"/);
  assert.match(auth, /supabaseClient \?\?= import\("@\/lib\/supabase"\)/);
});

test("charts, tabs and the paper window load when they are needed", () => {
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.doesNotMatch(chat, /from "recharts"/, "the chat page's own code has no charts");
  assert.match(chat, /dynamic\(\(\) => import\("@\/components\/chat\/ChatChartCard"\)/);
  assert.match(chat, /dynamic\(\(\) => import\("@\/components\/chat\/ChatInsightCard"\)/);
  const dashboard = read("src/components/DashboardClient.tsx");
  for (const tab of ["tabs/TrendAnalysis", "tabs/TrackAnalysis", "tabs/KeywordExplorer", "dashboard/InsightsTab", "workspace/RepositorySemanticMap"]) {
    assert.match(dashboard, new RegExp(`dynamic\\(\\(\\) => import\\("@/components/${tab}"\\)`), tab);
  }
  assert.match(read("src/components/workspace/PaperViewerProvider.tsx"), /dynamic\(\(\) => import\("@\/components\/workspace\/PaperAnalysisExplorerModal"\)/);
});

test("icons carry only the weights the app draws", async () => {
  const icons = read("src/components/ui/Icons.tsx");
  assert.doesNotMatch(icons, /@phosphor-icons\/react/);
  const glyphCalls = icons.match(/= (?:\/\*#__PURE__\*\/ )?glyph\(/g) ?? [];
  assert.ok(glyphCalls.length > 80);
  assert.ok(glyphCalls.every((call) => call.includes("__PURE__")), "every icon export can be dropped when unused");
  const glyphs = await import("../src/components/ui/icon-glyphs");
  const weights = new Set(Object.values(glyphs).flatMap((glyph) => Object.keys(glyph as object)));
  assert.deepEqual([...weights].sort(), ["bold", "fill", "regular"]);
});

test("a visited dashboard tab stays mounted, and keeps still while hidden (DASH-9)", () => {
  // That only the opening tab is drawn, and an unvisited one is not, is drawn
  // in boot-security-behaviour-render.test.ts. Kept as text: what happens after
  // a tab switch needs a second render of the same page, which a static render
  // cannot make.
  const dashboard = read("src/components/DashboardClient.tsx");
  assert.match(dashboard, /<div hidden=\{!active\}>\s*<FrozenWhileHidden node=\{active \? children : lastShown\.current\} \/>/);
  assert.match(dashboard, /const FrozenWhileHidden = memo\(/);
  for (const key of ["overview", "trend_analysis", "track_analysis", "keyword_explorer", "semantic_map", "adaptive"]) {
    assert.match(dashboard, new RegExp(`<TabPanel active=\\{currentTabKey === "${key}"\\} visited=\\{visitedTabs\\.has\\("${key}"\\)\\}>`), key);
  }
});
