/**
 * Walks the upload journey the way a reader does and photographs each step:
 * Home, the upload dialog, the progress that follows an upload, the library,
 * a repository, the Library's own "Add papers", and a paper's analysis view.
 *
 * Each photograph is checked for sideways scrolling, dialog content spilling
 * out of its dialog, a dialog button pushed out of view, and words a reader
 * should never meet ("Debug", "undefined", "Supabase", ...).
 *
 * Credentials come from UI_TEST_EMAIL / UI_TEST_PASSWORD and are never
 * written anywhere. Nothing is uploaded unless UI_UPLOAD_FILE is set, and then
 * only that one file (about one cent of model use). UI_DUPLICATE_FILE, a PDF
 * the account already has, is refused before upload and costs nothing.
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
const DUPLICATE_FILE = process.env.UI_DUPLICATE_FILE ?? "";
const PAPER_TITLE = process.env.UI_PAPER_TITLE ?? "";
const PROJECT_NAME = process.env.UI_PROJECT_NAME ?? "";
const ANALYSIS_WAIT_MS = Number(process.env.UI_ANALYSIS_WAIT_MS ?? 420000);
const VIEWPORTS = (process.env.UI_VIEWPORTS ?? "desktop,mobile").split(",");
const DASHBOARD_TABS = (process.env.UI_DASHBOARD_TABS ?? "").split(",").map((tab) => tab.trim()).filter(Boolean);
const SIZES: Record<string, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

type Note = { step: string; viewport: string; problems: string[]; facts?: string[] };
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
  const { problems, facts } = await page.evaluate(() => {
    const found: string[] = [];
    const seen: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) found.push(`page scrolls sideways (${doc.scrollWidth}px > ${window.innerWidth}px)`);
    // Page scroll width misses content clipped by a hidden overflow, so look for
    // anything that ends past the window, outside containers meant to scroll.
    // No named helper here: tsx wraps one in __name(), which the browser lacks.
    const offenders: string[] = [];
    for (const element of Array.from(document.querySelectorAll("main *"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.right <= window.innerWidth + 1) continue;
      let scrolls = false;
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === "auto" || overflow === "scroll") {
          scrolls = true;
          break;
        }
      }
      if (!scrolls) {
        const label = (element as HTMLElement).innerText?.trim().slice(0, 30) || element.tagName.toLowerCase();
        offenders.push(`${label} (+${Math.round(rect.right - window.innerWidth)}px)`);
        if (offenders.length >= 3) break;
      }
    }
    if (offenders.length) found.push(`content past the right edge: ${offenders.join(", ")}`);
    const text = document.body.innerText;
    for (const word of ["Debug", "debug", "undefined", "NaN", "[object Object]", "Supabase", "connector is planned", "Coming soon"]) {
      if (text.includes(word)) found.push(`visible text contains "${word}"`);
    }
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      const box = dialog.getBoundingClientRect();
      if (box.right > window.innerWidth + 1 || box.left < -1) found.push("dialog is wider than the window");
      for (const element of Array.from(dialog.querySelectorAll("*"))) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.right <= box.right + 1) continue;
        let scrolls = false;
        for (let node = element.parentElement; node && node !== dialog; node = node.parentElement) {
          const overflow = getComputedStyle(node).overflowX;
          if (overflow === "auto" || overflow === "scroll") {
            scrolls = true;
            break;
          }
        }
        if (!scrolls) {
          found.push(`dialog content spills out on the right (${element.tagName.toLowerCase()}, ${Math.round(rect.right - box.right)}px)`);
          break;
        }
      }
      const buttons = Array.from(dialog.querySelectorAll("button")).filter((button) => /^(analyze|follow progress|uploading)/i.test(button.innerText.trim()));
      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        if (rect.bottom > window.innerHeight + 1 || rect.top < 0) found.push(`"${button.innerText.trim()}" is outside the window`);
      }
      const heading = dialog.querySelector("h2");
      if (heading) seen.push(`dialog: ${heading.textContent?.trim()}`);
      const alert = dialog.querySelector('[role="alert"]');
      if (alert) seen.push(`alert: ${alert.textContent?.trim().slice(0, 200)}`);
    }
    return { problems: found, facts: seen };
  });
  notes.push({ step, viewport, problems, facts });
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

async function waitForText(page: Page, pattern: RegExp, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 2000) {
    if (await page.getByText(pattern).count()) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const viewport of VIEWPORTS) {
    const uploadHere = Boolean(UPLOAD_FILE) && viewport === VIEWPORTS[0];
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

    const opened = await clickByText(page, /^add papers$/i);
    await page.waitForTimeout(1500);
    await shot(page, viewport, opened ? "02-upload-dialog" : "02-no-upload-button");

    if (opened && DUPLICATE_FILE && viewport === VIEWPORTS[0]) {
      await page.locator('input[type="file"]').first().setInputFiles(DUPLICATE_FILE);
      await page.waitForTimeout(800);
      await clickByText(page, /^analyze \d+ paper/i);
      for (let i = 0; i < 30 && !(await page.locator('[role="dialog"] [role="alert"]').count()); i += 1) await page.waitForTimeout(1000);
      await page.waitForTimeout(500);
      await shot(page, viewport, "03a-duplicate-refused");
      await clickByText(page, /^clear all$/i);
      await page.waitForTimeout(500);
    }

    if (opened && uploadHere) {
      await page.locator('input[type="file"]').first().setInputFiles(UPLOAD_FILE);
      await page.waitForTimeout(800);
      await shot(page, viewport, "03-file-chosen");
      await clickByText(page, /^analyze \d+ paper/i);
      await page.waitForTimeout(1500);
      await shot(page, viewport, "03b-uploading");
      await waitForText(page, /being analyzed/i, 90000);
      await shot(page, viewport, "04-after-upload");
      await clickByText(page, /^follow progress$/i);
      await page.waitForTimeout(8000);
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
        await shot(page, viewport, uploadHere ? "06b-repository-while-analyzing" : "06b-repository");
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

    if (uploadHere) {
      await page.goto(`${BASE}/workspace/home`, { waitUntil: "domcontentloaded" });
      const finished = await waitForText(page, /is ready|are ready|papers? analyzed|analysis finished/i, ANALYSIS_WAIT_MS);
      await page.waitForTimeout(1500);
      await shot(page, viewport, finished ? "08-home-after-analysis" : "08-home-still-analyzing");
      await page.goto(`${BASE}/workspace/library`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      if (PROJECT_NAME) {
        const card = page.locator("main button", { hasText: PROJECT_NAME }).first();
        if (await card.count()) {
          await card.click();
          await page.waitForTimeout(5000);
        }
      }
      await shot(page, viewport, "09-library-after-analysis");
    }

    if (PAPER_TITLE) {
      const paper = page.locator("main button", { hasText: PAPER_TITLE }).first();
      if (await paper.count()) {
        await paper.click();
        await page.waitForTimeout(6000);
        await shot(page, viewport, "07-paper-view");
        await page.keyboard.press("Escape");
      }
    }
    // Where the analysed papers end up: the repository's dashboard tabs.
    for (const tab of DASHBOARD_TABS) {
      await page.goto(`${BASE}/workspace/dashboard?tab=${encodeURIComponent(tab)}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(9000);
      await shot(page, viewport, `10-dashboard-${tab}`);
    }
    notes.push({ step: "console", viewport, problems: consoleErrors.slice(0, 10) });
    await context.close();
  }
  await browser.close();
  writeFileSync(join(OUT, "notes.json"), JSON.stringify(notes, null, 2));
  for (const note of notes) {
    const facts = note.facts?.length ? `  [${note.facts.join(" / ")}]` : "";
    console.log(`${note.viewport} ${note.step}: ${note.problems.length ? note.problems.join(" | ") : "ok"}${facts}`);
  }
}

void main();
