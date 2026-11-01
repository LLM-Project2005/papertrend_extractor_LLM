/*
 * The 2026-11-01 motion pass, and the free graph without its square wall.
 * The owner asked for all seven motion items (panels that popped open, chat
 * answers arriving in one frame, the Table's cell panel and filling cells, the
 * free graph's camera, thumbnails, skeletons turning into content) and for the
 * free graph's papers to settle in a round cloud that can reach any distance.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the free graph has no wall: nothing clamps a paper, and an even pull makes the cloud round", () => {
  const graph = read("src/components/workspace/ForceDirectedSemanticGraph.tsx");
  assert.doesNotMatch(graph, /GRAPH_BOUNDS/);
  assert.doesNotMatch(graph, /node\.(x|y|fx|fy) = clamp\(/);
  assert.match(graph, /\.force\("pullX", forceX<ForceNode>\(500\)\.strength\(0\.08\)\)/);
  assert.match(graph, /\.force\("pullY", forceY<ForceNode>\(400\)\.strength\(0\.08\)\)/);
  // The settled layout is framed once, unless the reader moved the view first.
  assert.match(graph, /simulation\.on\("end", fitWhenSettled\);/);
  assert.match(graph, /if \(!viewMovedRef\.current\) glideTo\(fittedView\(nodesRef\.current\)\);/);
  assert.match(graph, /onClick=\{\(\) => glideTo\(fittedView\(nodesRef\.current\)\)\}/);
  assert.match(graph, /clamp\(current\.width \* factor, 360, WIDEST_VIEW\)/);
});

test("Fit frames every paper with room for labels, never closer than the default view", async () => {
  const { fittedView } = await import("../src/components/workspace/ForceDirectedSemanticGraph");
  const ratio = 670 / 890;
  // A 99-paper cloud, about 2,000 across.
  const wide = fittedView([{ x: -500, y: -600 }, { x: 1500, y: 1400 }, { x: 500, y: 400 }]);
  const near = 1e-6;
  assert.ok(wide.x <= -500 - 110 + near && wide.x + wide.width >= 1500 + 110 - near, "every paper across");
  assert.ok(wide.y <= -600 - 110 + near && wide.y + wide.height >= 1400 + 110 - near, "every paper down");
  assert.ok(Math.abs(wide.height / wide.width - ratio) < 1e-9, "the map's own shape");
  // Centred across, and centred down in the part below the map's toolbar (its top tenth).
  assert.ok(Math.abs(wide.x + wide.width / 2 - 500) < 1e-9, "centred across");
  assert.ok(Math.abs(wide.y + wide.height * 0.1 + (wide.height * 0.9) / 2 - 400) < 1e-9, "centred below the toolbar");
  assert.ok(wide.y + wide.height * 0.1 <= -600 - 110 + near, "no paper under the toolbar");
  // A handful of papers is not blown up.
  const small = fittedView([{ x: 480, y: 390 }, { x: 520, y: 410 }]);
  assert.equal(small.width, 890);
  assert.deepEqual(fittedView([]), { x: 55, y: 65, width: 890, height: 670 });
});

test("panels that popped open now grow from their button or slide from their edge", () => {
  assert.match(read("src/components/chat/UsageMeter.tsx"), /"top-11 origin-top-right" : "bottom-11 origin-bottom-right"[^`]*motion-safe:animate-scale-in/);
  assert.match(read("src/components/chat/ThinkingEffort.tsx"), /origin-bottom-right [^"]*motion-safe:animate-scale-in"/);
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /env\(safe-area-inset-top\)\)\] shadow-overlay motion-safe:animate-drawer-in"/);
  assert.match(chat, /max-lg:motion-safe:animate-drawer-in-right lg:static/);
  const drop = read("src/components/workspace/PdfDropTarget.tsx");
  assert.match(drop, /backdrop-blur-\[2px\] motion-safe:animate-fade-in"/);
  assert.match(drop, /shadow-overlay motion-safe:animate-scale-in"/);
  const cell = read("src/components/table/CellPanel.tsx");
  assert.equal((cell.match(/motion-safe:animate-rise-in/g) ?? []).length, 2, "phones: up from the bottom");
  assert.equal((cell.match(/sm:motion-safe:animate-panel-in-right/g) ?? []).length, 2, "wider: in from the right");
  const config = read("tailwind.config.ts");
  assert.match(config, /"drawer-in-right": "drawer-in-right 280ms cubic-bezier\(0\.16, 1, 0\.3, 1\) both"/);
  assert.match(config, /"panel-in-right": "panel-in-right 280ms cubic-bezier\(0\.16, 1, 0\.3, 1\) both"/);
});

test("only an answer that has just arrived rises in, never a transcript as it opens", () => {
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /if \(loading\) shownBeforeAskRef\.current = new Set\(messages\.map\(\(message\) => message\.id\)\);/);
  // Cleared on a new chat and on opening another conversation.
  assert.match(chat, /loadedThreadIdRef\.current = null;\s+shownBeforeAskRef\.current = null;/);
  assert.match(chat, /deepSessionSignatureRef\.current = \"\";\s+setMessages\(\[\]\);\s+shownBeforeAskRef\.current = null;/);
  assert.match(chat, /shownBeforeAskRef\.current && !shownBeforeAskRef\.current\.has\(message\.id\) \? "answer-arrive" : ""/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.answer-arrive \[data-testid="assistant-message"\] > div > \* \{\s*animation: answer-rise 320ms var\(--ease-out-expo\) both;/);
  assert.match(css, /\.answer-arrive > :not\(\[data-testid="assistant-message"\]\) \{ animation-delay: 200ms; \}/);
  // Under reduced motion every delay is zero and every animation instant.
  assert.match(css, /animation-duration: 0\.01ms !important;\s+animation-iteration-count: 1 !important;\s+animation-delay: 0ms !important;/);
});

test("a table cell read during a fill fades in; cells already there do not move", () => {
  const table = read("src/components/table/PaperTableClient.tsx");
  assert.match(table, /const \[arrived\] = useState\(filling\);/);
  assert.match(table, /className=\{arrived \? `\$\{className \?\? ""\} cell-arrive` : className\}/);
  assert.equal((table.match(/<CellButton\s+filling=\{reading\}/g) ?? []).length, 2);
  assert.match(read("src/app/globals.css"), /\.cell-arrive \{\s*animation: cell-arrive 1100ms var\(--ease-out-expo\) both;/);
});

test("thumbnails, the Library, the Dashboard and the chat list fade in where their placeholders were", () => {
  assert.match(read("src/components/workspace/PdfThumbnail.tsx"), /ring-black\/5 motion-safe:animate-fade-in/);
  const library = read("src/components/admin/AdminImportClient.tsx");
  assert.match(library, /items-center justify-center px-6 py-12 text-center motion-safe:animate-fade-in"/);
  assert.match(library, /<div className="px-4 py-4 motion-safe:animate-fade-in sm:px-6">/);
  assert.match(library, /<div className="space-y-8 px-4 py-5 motion-safe:animate-fade-in sm:px-6">/);
  assert.match(read("src/components/DashboardClient.tsx"), /max-w-\[1500px\] space-y-6 pt-2 motion-safe:animate-fade-in sm:pt-4"/);
  assert.match(read("src/components/chat/ChatClient.tsx"), /group relative rounded-lg px-2 motion-safe:animate-fade-in/);
});
