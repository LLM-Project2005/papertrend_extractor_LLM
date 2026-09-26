/**
 * Photographs real workspace screens for the marketing pages, in light and dark,
 * at twice the pixel density so text stays sharp on a high-DPI display.
 *
 *   UI_BASE_URL=https://...pilot... UI_PROJECT_ID=<repository> \
 *   UI_TEST_EMAIL=... UI_TEST_PASSWORD=... npx tsx scripts/capture-marketing-shots.ts
 *
 * The account comes from the environment only and is never written anywhere.
 * PNGs land in UI_OUT_DIR; scripts/optimize-marketing-shots.py turns them into
 * the WebP files under public/marketing that the pages reference.
 *
 * UI_SHOTS limits the run to a comma-separated list of shot names.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UI_BASE_URL ?? "";
const OUT = process.env.UI_OUT_DIR ?? "./marketing-shots";
const PROJECT = process.env.UI_PROJECT_ID ?? "";
const ONLY = (process.env.UI_SHOTS ?? "").split(",").map((name) => name.trim()).filter(Boolean);
const THEMES = (process.env.UI_THEMES ?? "light,dark").split(",");

type Shot = {
  name: string;
  route: string;
  /** Runs after the page settles, before the photograph. */
  prepare?: (page: Page) => Promise<void>;
  /** Photograph one element instead of the viewport. */
  element?: string;
  settleMs?: number;
  viewport?: { width: number; height: number };
};

async function openRepository(page: Page) {
  const name = process.env.UI_REPOSITORY_NAME ?? "testtest";
  await page.locator("main button", { hasText: name }).first().click();
  await page.waitForTimeout(6000);
}

async function openPaper(page: Page) {
  await openRepository(page);
  const title = process.env.UI_PAPER_TITLE ?? "An Investigation of Vocabulary Size";
  await page.locator("main button", { hasText: title }).first().click();
  await page.waitForTimeout(6000);
}

async function openThread(page: Page) {
  const title = process.env.UI_THREAD_TITLE ?? "How is dynamic assessment used";
  await page.locator("button", { hasText: title }).first().click();
  await page.waitForTimeout(7000);
}

const SHOTS: Shot[] = [
  { name: "dashboard", route: "/workspace/dashboard", settleMs: 12000 },
  { name: "dashboard-trends", route: "/workspace/dashboard?tab=trend_analysis", settleMs: 12000 },
  { name: "dashboard-keywords", route: "/workspace/dashboard?tab=keyword_explorer", settleMs: 12000 },
  { name: "dashboard-categories", route: "/workspace/dashboard?tab=track_analysis", settleMs: 12000 },
  { name: "home", route: "/workspace/home", settleMs: 9000 },
  { name: "library", route: "/workspace/library", settleMs: 9000 },
  { name: "settings-analysis", route: "/workspace/settings?section=analysis", settleMs: 7000 },
  { name: "library-papers", route: "/workspace/library", settleMs: 8000, prepare: openRepository },
  { name: "chat", route: "/workspace/chat", settleMs: 7000, prepare: openThread },
  { name: "paper", route: "/workspace/library", settleMs: 8000, prepare: openPaper },
];

async function signIn(page: Page) {
  const email = process.env.UI_TEST_EMAIL ?? "";
  const password = process.env.UI_TEST_PASSWORD ?? "";
  if (!email || !password) throw new Error("UI_TEST_EMAIL and UI_TEST_PASSWORD are required.");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  for (let i = 0; i < 40 && page.url().includes("/login"); i += 1) await page.waitForTimeout(1000);
}

async function main() {
  if (!BASE) throw new Error("UI_BASE_URL is required.");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme === "dark" ? "dark" : "light",
    });
    await context.addInitScript(`try { localStorage.setItem("papertrend_theme", ${JSON.stringify(theme)}); } catch (e) {}`);
    if (PROJECT) {
      await context.addInitScript(`try { localStorage.setItem("papertrend_workspace_project_v1", ${JSON.stringify(PROJECT)}); } catch (e) {}`);
    }
    const page = await context.newPage();
    await signIn(page);
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.includes(shot.name)) continue;
      if (shot.viewport) await page.setViewportSize(shot.viewport);
      await page.goto(`${BASE}${shot.route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(shot.settleMs ?? 8000);
      if (shot.prepare) await shot.prepare(page);
      // The corner analysis pill is not part of any screen being shown.
      await page.addStyleTag({ content: "[aria-label^='Open analysis progress']{display:none!important}" });
      const path = join(OUT, `${shot.name}-${theme}.png`);
      if (shot.element && (await page.locator(shot.element).count()) > 0) {
        await page.locator(shot.element).first().screenshot({ path });
      } else {
        await page.screenshot({ path });
      }
      console.log(`${theme} ${shot.name}: ${path}`);
      if (shot.viewport) await page.setViewportSize({ width: 1440, height: 900 });
    }
    await context.close();
  }
  await browser.close();
}

void main();
