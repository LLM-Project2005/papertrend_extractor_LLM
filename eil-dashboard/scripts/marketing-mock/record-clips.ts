/*
 * Records the front page's product clips, and retakes the still screenshots,
 * from the real app with the invented collection in harness.ts.
 *
 *   UI_BASE_URL=https://<pilot> UI_TEST_EMAIL=... UI_TEST_PASSWORD=... \
 *   FFMPEG_PATH=/path/to/ffmpeg UI_OUT_DIR=./out npx tsx scripts/marketing-mock/record-clips.ts
 *
 * UI_MODE=clips (default) writes <name>-<theme>.mp4; UI_MODE=shots writes the
 * still <name>-<theme>.png files that scripts/optimize-marketing-shots.py turns
 * into public/marketing/*.webp. UI_ONLY=chat,paper limits the run.
 *
 * Frames come from Chrome's screencast at the rate the page changes and are
 * re-timed to a steady 30 frames a second when encoded.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { CURSOR_SCRIPT, installMockApi, loadFixtures } from "./harness";

const BASE = process.env.UI_BASE_URL ?? "";
const OUT = process.env.UI_OUT_DIR ?? "./marketing-clips";
const MODE = process.env.UI_MODE ?? "clips";
const THEMES = (process.env.UI_THEMES ?? "light,dark").split(",");
const ONLY = (process.env.UI_ONLY ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

const fixtures = loadFixtures();
const REPOSITORY = "Coastal Adaptation Review";
const STAR_TITLE: string = fixtures.star.title;
const QUESTION = "Do mangroves or seawalls reduce flood damage more?";

const wait = (page: Page, ms: number) => page.waitForTimeout(ms);

async function pointAt(page: Page, target: Locator, steps = 28) {
  const box = await target.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
}

/**
 * The centres of the chart's tallest stacked columns, left to right. Passed
 * as a string: tsx would wrap named functions in a helper the page lacks.
 */
async function tallestColumns(page: Page, count: number): Promise<Array<{ x: number; y: number }>> {
  return page.evaluate(`(() => {
    const columns = new Map();
    for (const bar of document.querySelectorAll(".recharts-bar-rectangle")) {
      const r = bar.getBoundingClientRect();
      if (r.height < 2 || r.width < 2) continue;
      const key = Math.round(r.x + r.width / 2);
      const column = columns.get(key) || { x: key, top: r.top, bottom: r.bottom };
      column.top = Math.min(column.top, r.top);
      column.bottom = Math.max(column.bottom, r.bottom);
      columns.set(key, column);
    }
    return [...columns.values()]
      .sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top))
      .slice(0, ${count})
      .sort((a, b) => a.x - b.x)
      .map((c) => ({ x: c.x, y: (c.top + c.bottom) / 2 }));
  })()`);
}

/** A wheel scroll in small steps, so the recording shows it glide. */
async function scrollBy(page: Page, deltaY: number, steps = 14) {
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, deltaY / steps);
    await wait(page, 28);
  }
}

async function clickOn(page: Page, target: Locator) {
  await pointAt(page, target);
  await wait(page, 180);
  await target.click();
}

async function openRepository(page: Page) {
  await page.goto(`${BASE}/workspace/library`, { waitUntil: "domcontentloaded" });
  await wait(page, 4500);
  await page.locator("main button", { hasText: REPOSITORY }).first().click();
  await wait(page, 2500);
}

type Scene = {
  name: string;
  route: string;
  settleMs?: number;
  /** For stills: what to do before the photograph. For clips: the scene itself. */
  prepare?: (page: Page) => Promise<void>;
  /** For clips: what happens before recording starts. */
  setup?: (page: Page) => Promise<void>;
  play?: (page: Page) => Promise<void>;
  /** For clips: the part of the 1440x900 page to keep, in CSS pixels. */
  crop?: { x: number; y: number; width: number; height: number };
};

const PARKED = { x: 1250, y: 250 };

/** The paper dialog: 1180 wide, centred, 92vh tall (the still crops the same). */
const PAPER_DIALOG = { x: 130, y: 36, width: 1180, height: 828 };

async function openStarPaper(page: Page) {
  await openRepository(page);
  await page.locator("main button", { hasText: STAR_TITLE }).first().click();
  await wait(page, 4000);
}

/**
 * Scrolls the dialog's own body, smoothly, by deltaY - or, with "viewer",
 * until the PDF viewer's top sits `margin` pixels below the body's top.
 * Returns the distance moved. A wheel over the PDF would scroll the viewer
 * inside it instead, so the body is found and scrolled directly.
 */
async function scrollDialog(page: Page, deltaY: number | "viewer", margin = 64): Promise<number> {
  const moved = await page.evaluate(`(() => {
    const canvas = document.querySelector('[role="dialog"] canvas');
    const scrollers = [];
    for (let el = canvas && canvas.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) scrollers.push(el);
    }
    const viewer = scrollers[0];
    const body = scrollers[1];
    if (!viewer || !body) return 0;
    const wanted = ${JSON.stringify(deltaY)};
    const delta = wanted === "viewer"
      ? Math.round(viewer.getBoundingClientRect().top - body.getBoundingClientRect().top - ${margin})
      : wanted;
    const before = body.scrollTop;
    body.scrollBy({ top: delta, behavior: "smooth" });
    return Math.max(0, Math.min(body.scrollHeight - body.clientHeight, before + delta)) - before;
  })()`);
  await wait(page, 800);
  return Number(moved) || 0;
}

const SCENES: Scene[] = [
  {
    name: "dashboard-trends",
    route: "/workspace/dashboard?tab=area_analysis",
    settleMs: 7000,
    play: async (page) => {
      // The pointer starts and ends over the summary text, off the chart, so
      // no tooltip is open where the loop joins.
      await page.mouse.move(PARKED.x, PARKED.y);
      // The tallest years, left to right: an empty year's tooltip is all zeros.
      for (const column of await tallestColumns(page, 3)) {
        await page.mouse.move(column.x, column.y, { steps: 24 });
        await wait(page, 1100);
      }
      await clickOn(page, page.locator('nav[aria-label="Tabs"] button', { hasText: "Semantic Map" }));
      await wait(page, 3200);
      await clickOn(page, page.locator('nav[aria-label="Tabs"] button', { hasText: "Keyword Explorer" }));
      await wait(page, 2600);
      await clickOn(page, page.locator('nav[aria-label="Tabs"] button', { hasText: "Area Analysis" }));
      // Long enough for the bars to finish growing, so the loop's last frame
      // is its first.
      await page.mouse.move(PARKED.x, PARKED.y, { steps: 20 });
      await wait(page, 2800);
    },
  },
  {
    name: "paper",
    route: "/workspace/library",
    settleMs: 3000,
    // The still shows the dialog alone (optimize-marketing-shots.py crops it),
    // so the clip opens on the dialog and is cropped to the same box.
    crop: PAPER_DIALOG,
    prepare: openStarPaper,
    setup: async (page) => {
      await openStarPaper(page);
      await page.mouse.move(PARKED.x - 200, PARKED.y + 60);
    },
    play: async (page) => {
      await wait(page, 1000);
      await clickOn(page, page.locator('[role="dialog"] button', { hasText: "Keywords" }).first());
      await wait(page, 2200);
      await clickOn(page, page.locator('[role="dialog"] button', { hasText: "Evidence" }).first());
      await page.locator(".pdf-evidence-mark").first().waitFor({ timeout: 20000 }).catch(() => undefined);
      await wait(page, 1200);
      // The PDF sits under the claim's text; bring it up, keeping the claim
      // list beside it in view (a click on a hidden row would jump the page).
      const lift = await scrollDialog(page, "viewer", 250);
      await wait(page, 2400);
      // A claim from another page (Methods, on page 1): the viewer turns back
      // to it and marks it.
      const next = page.locator('[role="dialog"] button[aria-pressed]', { hasText: "household survey" }).first();
      if (await next.count()) {
        await clickOn(page, next);
        await wait(page, 600);
        await page.locator(".pdf-evidence-mark").first().waitFor({ timeout: 15000 }).catch(() => undefined);
        await wait(page, 3000);
      }
      // Back to where the loop starts: the top of the Overview.
      if (lift) {
        await scrollDialog(page, -lift);
        await wait(page, 400);
      }
      await clickOn(page, page.locator('[role="dialog"] button', { hasText: "Overview" }).first());
      await page.mouse.move(PARKED.x - 200, PARKED.y + 60, { steps: 20 });
      await wait(page, 1600);
    },
  },
  {
    name: "chat",
    route: "/workspace/chat",
    settleMs: 4500,
    prepare: async (page) => {
      await page.locator("button", { hasText: QUESTION }).first().click();
      await wait(page, 3500);
      // The thread opens on its last line; the still shows the question and
      // the answer's opening.
      await page.mouse.move(820, 420);
      await page.mouse.wheel(0, -4000);
      await wait(page, 800);
    },
    play: async (page) => {
      const composer = page.locator('textarea[aria-label="Message"]');
      await pointAt(page, composer);
      await composer.click();
      await wait(page, 400);
      await page.keyboard.type(QUESTION, { delay: 42 });
      await wait(page, 500);
      await page.keyboard.press("Enter");
      await page.locator('button[aria-label^="Source:"]').first().waitFor({ timeout: 20000 }).catch(() => undefined);
      await wait(page, 1400);
      // The thread lands on the end of the answer. Scroll back so its opening
      // and first source sit mid-screen, where the source card has room.
      const citation = page.locator('button[aria-label^="Source:"]').first();
      const box = await citation.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 120, box.y + 140, { steps: 20 });
        await scrollBy(page, box.y - 470);
        await wait(page, 700);
        await clickOn(page, citation);
        await wait(page, 3000);
      }
    },
  },
  { name: "dashboard", route: "/workspace/dashboard", settleMs: 7000 },
  { name: "dashboard-keywords", route: "/workspace/dashboard?tab=keyword_explorer", settleMs: 7000 },
  {
    name: "dashboard-categories",
    route: "/workspace/dashboard?tab=area_analysis",
    settleMs: 7000,
    // Research areas are the second half of Area Analysis.
    prepare: async (page) => {
      await page.locator("h2", { hasText: "Research areas" }).first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, -24);
      await wait(page, 1500);
    },
  },
  { name: "home", route: "/workspace/home", settleMs: 6000 },
  { name: "library", route: "/workspace/library", settleMs: 5000 },
  { name: "library-papers", route: "/workspace/library", settleMs: 3000, prepare: openRepository },
  { name: "settings-analysis", route: "/workspace/settings?section=analysis", settleMs: 5000 },
];

async function signIn(page: Page) {
  const email = process.env.UI_TEST_EMAIL ?? "";
  const password = process.env.UI_TEST_PASSWORD ?? "";
  if (!email || !password) throw new Error("UI_TEST_EMAIL and UI_TEST_PASSWORD are required.");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(page, 2000);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  for (let i = 0; i < 40 && page.url().includes("/login"); i += 1) await wait(page, 1000);
}

/** The scene's crop as a filter, in fractions so any frame size works. */
function cropFilter(scene: Scene): string {
  if (!scene.crop) return "";
  const { x, y, width, height } = scene.crop;
  return `crop=iw*${width / 1440}:ih*${height / 900}:iw*${x / 1440}:ih*${y / 900},`;
}

async function recordClip(context: BrowserContext, page: Page, scene: Scene, theme: string) {
  const frameDir = join(OUT, `frames-${scene.name}-${theme}`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const frames: Array<{ file: string; at: number }> = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", async (frame: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
    const file = join(frameDir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(frame.data, "base64"));
    frames.push({ file, at: frame.metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
  });
  if (scene.setup) await scene.setup(page);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
  await wait(page, 500);
  await scene.play!(page);
  await wait(page, 600);
  await cdp.send("Page.stopScreencast");
  if (frames.length < 2) throw new Error(`No frames for ${scene.name}`);

  // The screencast sends a frame only when the page changes; each frame is
  // held until the next one arrived, then the whole is re-timed to 30 fps.
  const list = frames
    .map((frame, index) => {
      const next = frames[index + 1];
      const duration = next ? Math.max(1 / 60, next.at - frame.at) : 0.5;
      return `file '${frame.file.replace(/\\/g, "/")}'\nduration ${duration.toFixed(4)}`;
    })
    .join("\n");
  const listFile = join(frameDir, "frames.txt");
  writeFileSync(listFile, `${list}\nfile '${frames[frames.length - 1].file.replace(/\\/g, "/")}'\n`);
  const output = join(OUT, `${scene.name}-${theme}.mp4`);
  const result = spawnSync(
    FFMPEG,
    ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `fps=30,${cropFilter(scene)}scale=1920:-2:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-movflags", "+faststart", "-an", output],
    { stdio: "pipe" }
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${scene.name}: ${result.stderr.toString().slice(-600)}`);
  rmSync(frameDir, { recursive: true, force: true });
  console.log(`${theme} ${scene.name}: ${output} (${frames.length} frames)`);
}

async function main() {
  if (!BASE) throw new Error("UI_BASE_URL is required.");
  mkdirSync(OUT, { recursive: true });
  const unknown = new Set<string>();
  const browser = await chromium.launch();
  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme === "dark" ? "dark" : "light",
    });
    await context.addInitScript(`try { localStorage.setItem("papertrend_theme", ${JSON.stringify(theme)}); localStorage.setItem("papertrend_workspace_project_v1", ${JSON.stringify(fixtures.main_project_id)}); } catch (e) {}`);
    if (MODE === "clips") await context.addInitScript(CURSOR_SCRIPT);
    await installMockApi(context, fixtures, { onUnknown: (method, path) => unknown.add(`${method} ${path}`) });
    const page = await context.newPage();
    await signIn(page);
    for (const scene of SCENES) {
      if (ONLY.length && !ONLY.includes(scene.name)) continue;
      if (MODE === "clips" && !scene.play) continue;
      await page.goto(`${BASE}${scene.route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await wait(page, scene.settleMs ?? 5000);
      await page.addStyleTag({ content: "[aria-label^='Open analysis progress']{display:none!important}" });
      if (MODE === "clips") {
        await recordClip(context, page, scene, theme);
      } else {
        if (scene.prepare) await scene.prepare(page);
        await page.addStyleTag({ content: "[aria-label^='Open analysis progress']{display:none!important}" });
        const path = join(OUT, `${scene.name}-${theme}.png`);
        await page.screenshot({ path });
        console.log(`${theme} ${scene.name}: ${path}`);
      }
    }
    await context.close();
  }
  await browser.close();
  if (unknown.size) console.log("Requests the mock refused:", [...unknown].join(", "));
}

void main();
