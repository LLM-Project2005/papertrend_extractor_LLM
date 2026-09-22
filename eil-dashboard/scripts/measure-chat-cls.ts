/**
 * Measures layout shift on the chat page while an answer arrives.
 *
 * Phase 5 asks for CLS under 0.1, and CLS is not something that can be reasoned
 * about from source: it depends on what the browser actually paints and when.
 * A container that looks fixed in the markup still shifts if a font swaps, an
 * image loads without dimensions, or a block appears above the reader's
 * position.
 *
 *   PT_BASE_URL=... PT_EMAIL=... PT_PASSWORD=... npx tsx scripts/measure-chat-cls.ts
 *
 * Exits non-zero if CLS reaches 0.1, so it can gate a release.
 *
 * Playwright is deliberately NOT a dependency of this project: it pulls a
 * browser of a few hundred megabytes and these scripts run occasionally rather
 * than in CI. Install it when you need them:
 *
 *   npm install --no-save playwright && npx playwright install chromium
 */
import { chromium, type Page } from "playwright";

const BASE = (process.env.PT_BASE_URL ?? "").replace(/\/$/, "");
const EMAIL = process.env.PT_EMAIL ?? "";
const PASSWORD = process.env.PT_PASSWORD ?? "";
const QUESTION = process.env.PT_QUESTION ?? "How many papers are in this repository?";

if (!BASE || !EMAIL || !PASSWORD) {
  console.error("PT_BASE_URL, PT_EMAIL and PT_PASSWORD are required.");
  process.exit(2);
}

/** Starts a CLS observer that survives until the page is asked for the total. */
async function startClsObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    (window as unknown as { __shifts: unknown[] }).__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        // A shift within 500ms of a click or keypress is the reader's own
        // doing and is excluded from CLS by definition.
        if (entry.hadRecentInput) continue;
        (window as unknown as { __cls: number }).__cls += entry.value;
        (window as unknown as { __shifts: unknown[] }).__shifts.push({
          value: Number(entry.value.toFixed(5)),
          at: Math.round(entry.startTime),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function readCls(page: Page): Promise<{ cls: number; shifts: Array<{ value: number; at: number }> }> {
  return page.evaluate(() => ({
    cls: Number(((window as unknown as { __cls: number }).__cls ?? 0).toFixed(5)),
    shifts: (window as unknown as { __shifts: Array<{ value: number; at: number }> }).__shifts ?? [],
  }));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await startClsObserver(page);

  console.log(`opening ${BASE}`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120_000 });

  // Sign in through the form the reader uses, rather than injecting a token,
  // so the measurement covers the same page transitions they see.
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 120_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log(`signed in, at ${new URL(page.url()).pathname}`);

  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(2_000);
  const beforeAsking = await readCls(page);
  console.log(`CLS after load and settle: ${beforeAsking.cls}`);

  const composer = page.locator("textarea").first();
  await composer.waitFor({ timeout: 60_000 });

  // A CLS of zero means nothing unless an answer actually arrived, so the page
  // is measured against its own text length rather than a fixed threshold that
  // the page chrome alone could satisfy.
  const lengthBefore = await page.evaluate(() => document.body.innerText.length);
  await composer.fill(QUESTION);
  await composer.press("Enter");

  // Total text length is the wrong signal on this page: sending a question
  // removes the intro and its capability list, so the page can get shorter
  // while the answer is still being written. The assistant message itself is
  // the only thing that means an answer arrived.
  let answered = false;
  try {
    await page.locator('[data-testid="assistant-message"]').first().waitFor({ timeout: 180_000 });
    answered = true;
  } catch {
    console.log("  no assistant message appeared within the timeout");
  }
  await page.waitForTimeout(4_000);
  const lengthAfter = await page.evaluate(() => document.body.innerText.length);
  console.log(`page text: ${lengthBefore} -> ${lengthAfter} characters (answer arrived: ${answered})`);

  const after = await readCls(page);
  console.log(`CLS after the answer arrived: ${after.cls}`);
  if (after.shifts.length > 0) {
    console.log("largest shifts:");
    for (const shift of [...after.shifts].sort((a, b) => b.value - a.value).slice(0, 5)) {
      console.log(`  ${shift.value} at ${shift.at}ms`);
    }
  }

  await browser.close();

  const passes = after.cls < 0.1 && answered;
  console.log("");
  if (!answered) {
    console.log("INCONCLUSIVE: no answer arrived, so a CLS of zero proves nothing");
  } else {
    console.log(`${passes ? "PASS" : "FAIL"}: CLS ${after.cls} against a limit of 0.1, with an answer on screen`);
  }
  process.exit(passes ? 0 : 1);
}

main().catch((error) => {
  console.error("measurement failed:", error instanceof Error ? error.message : error);
  process.exit(2);
});
