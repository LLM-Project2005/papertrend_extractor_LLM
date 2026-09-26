/**
 * Photographs a list of routes in light and dark, desktop and mobile, for a
 * design review. Signs in first when UI_TEST_EMAIL / UI_TEST_PASSWORD are set
 * (never written anywhere) so workspace pages render with real content.
 *
 *   UI_BASE_URL=https://... UI_ROUTES=/,/docs,/workspace/home npx tsx scripts/capture-pages.ts
 *
 * UI_THEMES (light,dark), UI_VIEWPORTS (desktop,mobile), UI_OUT_DIR,
 * UI_PROJECT_ID (the repository workspace pages open on), UI_FULL_PAGE (1).
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UI_BASE_URL ?? "https://papertrend.web.app";
const OUT = process.env.UI_OUT_DIR ?? "./ui-pages";
const ROUTES = (process.env.UI_ROUTES ?? "/").split(",").map((route) => route.trim()).filter(Boolean);
const THEMES = (process.env.UI_THEMES ?? "light,dark").split(",");
const VIEWPORTS = (process.env.UI_VIEWPORTS ?? "desktop,mobile").split(",");
const FULL_PAGE = (process.env.UI_FULL_PAGE ?? "1") === "1";
const SIZES: Record<string, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

type Note = { route: string; theme: string; viewport: string; problems: string[] };

function slug(route: string): string {
  return route === "/" ? "root" : route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "");
}

async function signIn(page: Page) {
  const email = process.env.UI_TEST_EMAIL ?? "";
  const password = process.env.UI_TEST_PASSWORD ?? "";
  if (!email || !password) return;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  for (let i = 0; i < 40 && page.url().includes("/login"); i += 1) await page.waitForTimeout(1000);
}

async function inspect(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) found.push(`page scrolls sideways (${doc.scrollWidth}px)`);
    const text = document.body.innerText;
    for (const word of ["undefined", "NaN", "[object Object]", "Lorem", "Research Signal Lab"]) {
      if (text.includes(word)) found.push(`visible text contains "${word}"`);
    }
    return found;
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const notes: Note[] = [];
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({ viewport: SIZES[viewport], colorScheme: theme === "dark" ? "dark" : "light" });
      await context.addInitScript(`try { localStorage.setItem("papertrend_theme", ${JSON.stringify(theme)}); } catch (e) {}`);
      const projectId = process.env.UI_PROJECT_ID;
      if (projectId) {
        await context.addInitScript(`try { localStorage.setItem("papertrend_workspace_project_v1", ${JSON.stringify(projectId)}); } catch (e) {}`);
      }
      const page = await context.newPage();
      await signIn(page);
      for (const route of ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(Number(process.env.UI_SETTLE_MS ?? 6000));
        notes.push({ route, theme, viewport, problems: await inspect(page) });
        await page.screenshot({ path: join(OUT, `${viewport}-${theme}-${slug(route)}.png`), fullPage: FULL_PAGE });
      }
      await context.close();
    }
  }
  await browser.close();
  writeFileSync(join(OUT, "notes.json"), JSON.stringify(notes, null, 2));
  for (const note of notes) {
    console.log(`${note.viewport} ${note.theme} ${note.route}: ${note.problems.length ? note.problems.join(" | ") : "ok"}`);
  }
}

void main();
