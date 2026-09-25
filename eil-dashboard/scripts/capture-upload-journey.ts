/**
 * Walks the upload journey the way a reader does and photographs each step:
 * Home, the upload dialog (empty and with a file chosen), the library, a
 * paper's analysis view, and the progress card while a paper is analysed.
 *
 * Credentials come from UI_TEST_EMAIL / UI_TEST_PASSWORD and are never
 * written anywhere. Nothing is uploaded unless UI_UPLOAD_FILE is set, and then
 * only that one file (about one cent of model use).
 *
 *   UI_BASE_URL=https://...pilot... UI_PROJECT_ID=... npx tsx scripts/capture-upload-journey.ts
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UI_BASE_URL ?? "https://papertrend.web.app";
const OUT = process.env.UI_OUT_DIR ?? "./ui-journey";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
const PROJECT_ID = process.env.UI_PROJECT_ID ?? "";
const UPLOAD_FILE = process.env.UI_UPLOAD_FILE ?? "";
const PAPER_TITLE = process.env.UI_PAPER_TITLE ?? "";
const PROJECT_NAME = process.env.UI_PROJECT_NAME ?? "";
const VIEWPORTS = (process.env.UI_VIEWPORTS ?? "desktop,mobile").split(",");
const SIZES: Record<string, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

type Note = { step: string; viewport: string; problems: string[] };
const notes: Note[] = [];

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  for (let i = 0; i < 40 && page.url().includes("/login"); i += 1) await page.waitForTimeout(1000);
  if (PROJECT_ID) {
    await page.evaluate(`window.localStorage.setItem("papertrend_workspace_project_v1", ${JSON.stringify(PROJECT_ID)})`);
  }
}

async function shot(page: Page, viewport: string, step: string) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) found.push(`page scrolls sideways (${doc.scrollWidth}px > ${window.innerWidth}px)`);
    const text = document.body.innerText;
    for (const word of ["Debug", "debug", "undefined", "NaN", "[object Object]", "Supabase", "connector is planned"]) {
      if (text.includes(word)) found.push(`visible text contains "${word}"`);
    }
    return found;
  });
  notes.push({ step, viewport, problems });
  await page.screenshot({ path: join(OUT, `${viewport}-${step}.png`), fullPage: true });
}

async function clickByText(page: Page, pattern: RegExp): Promise<boolean> {
  const target = page.getByRole("button", { name: pattern }).first();
  if (await target.count()) {
    await target.click();
    return true;
  }
  const link = page.getByRole("link", { name: pattern }).first();
  if (await link.count()) {
    await link.click();
    return true;
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: SIZES[viewport], colorScheme: "light" });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
    });
    await login(page);

    await page.goto(`${BASE}/workspace/home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    await shot(page, viewport, "01-home");

    const opened = await clickByText(page, /add papers|upload|analy[sz]e/i);
    await page.waitForTimeout(1500);
    await shot(page, viewport, opened ? "02-upload-dialog" : "02-no-upload-button");

    if (UPLOAD_FILE && viewport === VIEWPORTS[0]) {
      await page.locator('input[type="file"]').first().setInputFiles(UPLOAD_FILE);
      await page.waitForTimeout(800);
      await shot(page, viewport, "03-file-chosen");
      await clickByText(page, /^analyze \d+ paper/i);
      for (let i = 0; i < 60 && !(await page.getByText(/being analyzed/i).count()); i += 1) await page.waitForTimeout(1000);
      await shot(page, viewport, "04-after-upload");
      await clickByText(page, /follow progress/i);
      await page.waitForTimeout(6000);
      await shot(page, viewport, "05-progress");
    } else if (opened) {
      await page.keyboard.press("Escape");
    }

    await page.goto(`${BASE}/workspace/library`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    await shot(page, viewport, "06-library");

    if (PROJECT_NAME) {
      const card = page.locator("main button", { hasText: PROJECT_NAME }).first();
      if (await card.count()) {
        await card.click();
        await page.waitForTimeout(5000);
        await shot(page, viewport, "06b-repository");
        if (await clickByText(page, /^new$/i)) {
          await page.waitForTimeout(600);
          await clickByText(page, /^add papers$/i);
          await page.waitForTimeout(1200);
          await shot(page, viewport, "06d-library-add-papers");
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }
      }
    }

    if (PAPER_TITLE) {
      const paper = page.locator("main", { hasText: PAPER_TITLE }).getByText(PAPER_TITLE, { exact: false }).first();
      if (await paper.count()) {
        await paper.click();
        await page.waitForTimeout(1500);
        await shot(page, viewport, "06c-paper-selected");
        await paper.dblclick().catch(() => undefined);
        await page.waitForTimeout(6000);
        await shot(page, viewport, "07-paper-view");
      }
    }
    notes.push({ step: "console", viewport, problems: consoleErrors.slice(0, 10) });
    await context.close();
  }
  await browser.close();
  writeFileSync(join(OUT, "notes.json"), JSON.stringify(notes, null, 2));
  for (const note of notes) {
    console.log(`${note.viewport} ${note.step}: ${note.problems.length ? note.problems.join(" | ") : "ok"}`);
  }
}

void main();
