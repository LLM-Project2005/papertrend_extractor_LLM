/**
 * Walks the chat page with the Tab key and reports what a keyboard reader gets.
 *
 * The CSS rule that draws a focus ring can be present and still not reach a
 * control: an element with `tabindex="-1"`, one hidden behind a parent that is
 * `display: none`, or a custom control built from a div never receives focus at
 * all. Asserting the rule exists proves the rule exists. Pressing Tab proves
 * the reader can get there and can see where they are.
 *
 *   PT_BASE_URL=... PT_EMAIL=... PT_PASSWORD=... npx tsx scripts/measure-chat-keyboard.ts
 *
 * Playwright is deliberately NOT a dependency of this project: it pulls a
 * browser of a few hundred megabytes and these scripts run occasionally rather
 * than in CI. Install it when you need them:
 *
 *   npm install --no-save playwright && npx playwright install chromium
 */
import { chromium } from "playwright";

const BASE = (process.env.PT_BASE_URL ?? "").replace(/\/$/, "");
const EMAIL = process.env.PT_EMAIL ?? "";
const PASSWORD = process.env.PT_PASSWORD ?? "";
const MAX_STOPS = Number.parseInt(process.env.PT_TAB_STOPS ?? "120", 10);

if (!BASE || !EMAIL || !PASSWORD) {
  console.error("PT_BASE_URL, PT_EMAIL and PT_PASSWORD are required.");
  process.exit(2);
}

interface Stop {
  isStart: boolean;
  tag: string;
  label: string;
  outlineWidth: string;
  outlineStyle: string;
  visible: boolean;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } } as never);

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 120_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(2_000);

  // The composer takes focus on load, so the walk would start mid-page.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  const stops: Stop[] = [];
  const seen = new Set<string>();
  let leftDocument = 0;
  for (let index = 0; index < MAX_STOPS; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const styles = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      // Mark the first control reached so the cycle can be detected by
      // identity rather than by label.
      const started = element.dataset.walkStart === "1";
      if (!document.querySelector('[data-walk-start="1"]')) element.dataset.walkStart = "1";
      return {
        isStart: started,
        tag: element.tagName.toLowerCase(),
        label:
          element.getAttribute("aria-label") ??
          element.getAttribute("placeholder") ??
          (element.textContent ?? "").trim().slice(0, 44) ??
          "",
        outlineWidth: styles.outlineWidth,
        outlineStyle: styles.outlineStyle,
        visible: box.width > 0 && box.height > 0,
      };
    });
    // Focus leaving the document for the browser's own chrome shows up as
    // body, and it happens once per pass. Treating it as the end stopped the
    // walk after four controls on a page with 224 of them.
    if (!stop) {
      leftDocument += 1;
      if (leftDocument > 2) break;
      continue;
    }
    // A cycle is the same element coming round again, not the same label. Two
    // links legitimately read "Repositories" - one in the top bar, one in the
    // sidebar - and treating those as a cycle ended the walk at 13 controls on
    // a page that has 224.
    if (stop.isStart && stops.length > 1) break;
    stops.push(stop);
  }

  await browser.close();

  console.log(`tab stops reached: ${stops.length}`);
  const noRing = stops.filter(
    (stop) => stop.visible && (stop.outlineStyle === "none" || Number.parseFloat(stop.outlineWidth) === 0)
  );
  const offscreen = stops.filter((stop) => !stop.visible);

  for (const stop of stops.slice(0, 14)) {
    const ring = stop.outlineStyle === "none" ? "NO RING" : `${stop.outlineStyle} ${stop.outlineWidth}`;
    console.log(`  ${stop.tag.padEnd(9)} ${ring.padEnd(14)} ${stop.label.replace(/\s+/g, " ")}`);
  }
  if (stops.length > 14) console.log(`  ... and ${stops.length - 14} more`);

  console.log("");
  console.log(`controls with no visible focus ring: ${noRing.length}`);
  console.log(`controls focused while not rendered: ${offscreen.length}`);

  // A page with almost no tab stops means the walk did not really run, which
  // would make an empty failure list meaningless.
  const enough = stops.length >= 5;
  const passes = enough && noRing.length === 0 && offscreen.length === 0;
  console.log("");
  if (!enough) {
    console.log(`INCONCLUSIVE: only ${stops.length} tab stops, so nothing was really walked`);
  } else {
    console.log(
      passes
        ? `PASS: ${stops.length} controls reachable by keyboard, every one showing focus`
        : "FAIL: see the counts above"
    );
  }
  process.exit(passes ? 0 : 1);
}

main().catch((error) => {
  console.error("measurement failed:", error instanceof Error ? error.message : error);
  process.exit(2);
});
