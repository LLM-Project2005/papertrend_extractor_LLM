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
  play?: (page: Page) => Promise<void>;
};

const SCENES: Scene[] = [
  {
    name: "dashboard-trends",
    route: "/workspace/dashboard?tab=trend_analysis",
    settleMs: 7000,
    play: async (page) => {
      await page.mouse.move(900, 700);
      const bars = page.locator(".recharts-bar-rectangle");
      for (const index of [6, 14, 22]) {
        if ((await bars.count()) > index) await pointAt(page, bars.nth(index), 24);
        await wait(page, 900);
      }
      await clickOn(page, page.locator('nav[aria-label="Tabs"] button', { hasText: "Overview" }));
      await wait(page, 2600);
      const overviewBars = page.locator(".recharts-bar-rectangle");
      if ((await overviewBars.count()) > 2) await pointAt(page, overviewBars.nth(2), 24);
      await wait(page, 1400);
      await clickOn(page, page.locator('nav[aria-label="Tabs"] button', { hasText: "Category Analysis" }));
      await wait(page, 2600);
      await clickOn(page, page.locator('nav[aria-label="Tabs"] button', { hasText: "Trend Analysis" }));
      await wait(page, 1800);
    },
  },
  {
    name: "paper",
    route: "/workspace/library",
    settleMs: 3000,
    prepare: async (page) => {
      await openRepository(page);
      await page.locator("main button", { hasText: STAR_TITLE }).first().click();
      await wait(page, 4000);
    },
    play: async (page) => {
      await openRepository(page);
      await page.mouse.move(720, 460);
      await clickOn(page, page.locator("main button", { hasText: STAR_TITLE }).first());
      await wait(page, 2600);
      await clickOn(page, page.locator('[role="dialog"] button', { hasText: "Keywords" }).first());
      await wait(page, 2200);
      await clickOn(page, page.locator('[role="dialog"] button', { hasText: "Evidence" }).first());
      await page.locator(".pdf-evidence-mark").first().waitFor({ timeout: 20000 }).catch(() => undefined);
      await wait(page, 2600);
      const second = page.locator('[role="dialog"] button[aria-pressed]', { hasText: "seawall" }).first();
      if (await second.count()) {
        await clickOn(page, second);
        await wait(page, 3000);
      }
    },
  },
  {
    name: "chat",
    route: "/workspace/chat",
    settleMs: 4500,
    prepare: async (page) => {
      await page.locator("button", { hasText: QUESTION }).first().click();
      await wait(page, 3500);
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
  { name: "dashboard-categories", route: "/workspace/dashboard?tab=track_analysis", settleMs: 7000 },
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
    ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=30,scale=1920:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-movflags", "+faststart", "-an", output],
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
