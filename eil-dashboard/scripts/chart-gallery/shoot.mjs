/*
 * Screenshots the chart gallery (docs/38) in light and dark, at phone and
 * desktop width, and checks every chart: nothing wider than its card, and no
 * two pieces of text on top of each other. Prints what it finds as JSON.
 *
 *   node scripts/chart-gallery/shoot.mjs <galleryDir> [onlyPrefix]
 *
 * Playwright is not a dependency of the dashboard: PLAYWRIGHT_FROM names a
 * file in a project that has it (default: this package).
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(process.env.PLAYWRIGHT_FROM ?? import.meta.url);
const { chromium } = require("playwright");

const dir = resolve(process.argv[2]);
const only = process.argv[3] ?? "";
const shots = join(dir, "shots");
mkdirSync(shots, { recursive: true });

/** Runs in the page: overflow and overlapping text in each specimen. */
function inspect() {
  const found = [];
  const textOf = (element) => (element.textContent ?? "").trim().slice(0, 40);
  for (const section of document.querySelectorAll("[data-specimen]")) {
    const id = section.getAttribute("data-specimen");
    const card = section.getBoundingClientRect();
    for (const chart of section.querySelectorAll("[data-chart]")) {
      const box = chart.getBoundingClientRect();
      // A chart that scrolls sideways on purpose (a wide grid or table) is allowed to.
      const scroller = chart.querySelector(".overflow-x-auto");
      if (box.right > card.right + 1 && !scroller) found.push({ id, problem: "wider than its card", by: Math.round(box.right - card.right) });
      if (!scroller && chart.scrollWidth > chart.clientWidth + 1) found.push({ id, problem: "scrolls sideways", by: chart.scrollWidth - chart.clientWidth });
      // Text leaves: elements with text and no element children.
      const leaves = [...chart.querySelectorAll("span, p, button, th, td, li")].filter(
        (element) => element.children.length === 0 && textOf(element) && element.getClientRects().length > 0
      );
      const rects = leaves.map((element) => ({ element, rect: element.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && rect.height > 0);
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i].rect;
          const b = rects[j].rect;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 2 && overlapY > 2 && !rects[i].element.contains(rects[j].element) && !rects[j].element.contains(rects[i].element)) {
            found.push({ id, problem: "text overlaps", a: textOf(rects[i].element), b: textOf(rects[j].element) });
          }
        }
      }
      // Text cut off at the card's edge.
      for (const { element, rect } of rects) {
        if (rect.right > card.right + 1 && !element.closest(".overflow-x-auto")) found.push({ id, problem: "text past the card", text: textOf(element) });
      }
    }
  }
  return found;
}

const browser = await chromium.launch();
const report = {};
for (const theme of ["light", "dark"]) {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    const url = `${pathToFileURL(join(dir, "index.html")).href}?theme=${theme}${only ? `&only=${encodeURIComponent(only)}` : ""}`;
    await page.goto(url);
    await page.waitForSelector("[data-specimen]");
    const name = `${theme}-${width}`;
    report[name] = { errors, problems: await page.evaluate(inspect) };
    // One screenshot per specimen, so each can be read on its own.
    for (const section of await page.$$("[data-specimen]")) {
      const id = await section.getAttribute("data-specimen");
      await section.screenshot({ path: join(shots, `${name}-${id}.png`) });
    }
    await page.close();
  }
}
await browser.close();
writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
const summary = Object.fromEntries(Object.entries(report).map(([name, value]) => [name, { errors: value.errors.length, problems: value.problems.length }]));
console.log(JSON.stringify(summary));
