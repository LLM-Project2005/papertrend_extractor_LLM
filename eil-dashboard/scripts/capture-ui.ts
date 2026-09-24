/**
 * Captures every page of the site as a reader actually receives it.
 *
 * Two kinds of evidence come back. A full-page screenshot, which is what a
 * design reviewer needs and no static analysis can substitute for. And a
 * diagnostics record read from *computed* styles in the live page, not from
 * className strings - every previous checker in this repo that parsed classes
 * was wrong about something, because a class does not tell you what won the
 * cascade, what the inherited background was, or whether the element was
 * visible at all.
 *
 * Read-only: it navigates and screenshots. The only interaction is the login
 * form, and only when credentials are supplied in the environment.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UI_BASE_URL ?? "https://papertrend.web.app";
const OUT = process.env.UI_OUT_DIR ?? "./ui-audit";
const EMAIL = process.env.UI_TEST_EMAIL ?? "";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "";
/** Which repository the workspace opens (optional). */
const PROJECT_ID = process.env.UI_PROJECT_ID ?? "";
/** Comma-separated route id prefixes to capture; everything when unset. */
const ONLY = (process.env.UI_ONLY ?? "").split(",").map((value) => value.trim()).filter(Boolean);

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const DOCS = [
  "getting-started", "workspace-concepts", "library-uploads", "google-drive-imports",
  "search-navigation", "settings-profile", "paper-analysis", "research-dashboard",
  "ai-research-chat", "deep-research-agent", "cloud-queue", "evaluation-quality",
  "troubleshooting",
];
const FEATURES = ["paper-analysis", "research-dashboard", "ai-research-chat", "cloud-queue"];

interface Route {
  id: string;
  path: string;
  auth: boolean;
  /** Surfaces where the light-mode override layer is most likely to misfire. */
  bothThemes?: boolean;
}

const ROUTES: Route[] = [
  { id: "landing", path: "/", auth: false, bothThemes: true },
  { id: "login", path: "/login", auth: false, bothThemes: true },
  { id: "docs-index", path: "/docs", auth: false, bothThemes: true },
  { id: "docs-search", path: "/docs/search", auth: false, bothThemes: true },
  ...DOCS.map((s) => ({ id: `docs-${s}`, path: `/docs/${s}`, auth: false })),
  ...FEATURES.map((s) => ({ id: `feature-${s}`, path: `/features/${s}`, auth: false, bothThemes: true })),
  // Only surfaces that render something of their own. /chat, /start, /workspace,
  // /organizations*, /workspaces/new, /workspace/papers, /workspace/imports and
  // /admin/import are all redirect() shims for legacy URLs; capturing them would
  // just re-photograph their targets under a misleading name.
  { id: "workspaces", path: "/workspaces", auth: true, bothThemes: true },
  { id: "workspace-home", path: "/workspace/home", auth: true, bothThemes: true },
  { id: "workspace-dashboard", path: "/workspace/dashboard", auth: true, bothThemes: true },
  // Every fixed tab, not only the default: the charts each tab draws are what
  // docs/28 changed, and a harness that only saw Overview could not see them.
  { id: "workspace-dashboard-trend", path: "/workspace/dashboard?tab=trend_analysis", auth: true, bothThemes: true },
  { id: "workspace-dashboard-categories", path: "/workspace/dashboard?tab=track_analysis", auth: true, bothThemes: true },
  { id: "workspace-dashboard-keywords", path: "/workspace/dashboard?tab=keyword_explorer", auth: true, bothThemes: true },
  { id: "workspace-dashboard-adaptive", path: "/workspace/dashboard?tab=adaptive", auth: true, bothThemes: true },
  { id: "workspace-chat", path: "/workspace/chat", auth: true, bothThemes: true },
  { id: "workspace-library", path: "/workspace/library", auth: true, bothThemes: true },
  { id: "workspace-profile", path: "/workspace/profile", auth: true },
  { id: "workspace-settings", path: "/workspace/settings", auth: true },
  { id: "not-found", path: "/this-route-does-not-exist", auth: false },
];

/* ------------------------------------------------------------------ in-page */

/**
 * Runs inside the page. Everything here reads resolved values: the colour that
 * won the cascade, the background actually painted behind the text, the box the
 * element actually occupies.
 */
const DIAGNOSTICS = `(() => {
  const out = {
    contrast: [], tapTargets: [], overflowX: null, images: [],
    controls: [], headings: [], duplicateIds: [], truncation: [],
    fontSizes: {}, emptyInteractive: [], zIndexes: [], counts: {},
  };

  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((n) => parseFloat(n.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  /** The background actually painted behind an element, walking up through transparency. */
  const effectiveBg = (el) => {
    let node = el;
    let acc = null;
    while (node && node.nodeType === 1) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc ? over(acc, bg) : bg;
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    return acc && acc.a >= 0.999 ? acc : { r: 255, g: 255, b: 255, a: 1 };
  };

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const all = Array.from(document.querySelectorAll('*'));
  out.counts.elements = all.length;

  /* ------- contrast, measured on elements that own a text node ------- */
  const seen = new Set();
  for (const el of all) {
    if (!visible(el)) continue;
    // Content marked decorative is exempt from the text-contrast rule, because a
    // screen reader never reads it and it carries no meaning to lose. The
    // breadcrumb's ">" separator is the case here: it failed at 1.48:1 and the
    // correct fix was to mark it decorative, not to darken a glyph that exists
    // only to sit between two names.
    if (el.closest('[aria-hidden="true"]')) continue;
    const direct = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim()).join(' ').trim();
    if (!direct) continue;
    const s = getComputedStyle(el);
    const fg0 = parse(s.color);
    if (!fg0) continue;
    const bg = effectiveBg(el);
    const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
    const size = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    out.fontSizes[String(Math.round(size))] = (out.fontSizes[String(Math.round(size))] || 0) + 1;
    if (r < need) {
      const key = s.color + '|' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + '|' + Math.round(size);
      if (seen.has(key)) continue;
      seen.add(key);
      out.contrast.push({
        text: direct.slice(0, 70),
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0, 110),
        color: s.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        fontSize: size, weight, ratio: Math.round(r * 100) / 100, need,
      });
    }
  }

  /* ------- text drawn inside SVG, which is painted with fill, not color -------
     Every chart label on the site lives here. A checker that reads the color
     property reports a clean page while the axis labels sit at 3.5:1, which is
     exactly what happened: four chart components were fixed off the back of a
     separate one-off script, and a fifth stayed broken because this sweep could
     not see it.
     (No backticks in here: this whole block is inside a template literal, and
     one would end it early - which it did, and the file still ran.) */
  for (const node of Array.from(document.querySelectorAll('svg text, svg tspan'))) {
    if (!visible(node)) continue;
    if (node.closest('[aria-hidden="true"]')) continue;
    const label = (node.textContent || '').trim();
    if (!label) continue;
    const s = getComputedStyle(node);
    const fill = parse(s.fill);
    if (!fill || fill.a === 0) continue;
    // An <svg> has no painted background of its own, so the effective backdrop
    // is whatever HTML element encloses it.
    const host = node.closest('svg');
    const bg = effectiveBg(host ? host.parentElement || host : node);
    const fg = fill.a < 1 ? over(fill, bg) : fill;
    const size = parseFloat(s.fontSize) || 12;
    const need = size >= 24 ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r < need) {
      const key = 'svg|' + s.fill + '|' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + '|' + Math.round(size);
      if (seen.has(key)) continue;
      seen.add(key);
      out.contrast.push({
        text: label.slice(0, 70),
        tag: 'svg:' + node.tagName.toLowerCase(),
        cls: String((node.getAttribute && node.getAttribute('class')) || '').slice(0, 110),
        color: s.fill, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        fontSize: size, weight: parseInt(s.fontWeight, 10) || 400,
        ratio: Math.round(r * 100) / 100, need,
      });
    }
  }

  /* ------- tap targets ------- */
  const interactive = all.filter((el) =>
    visible(el) && (
      ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(el.tagName) ||
      el.getAttribute('role') === 'button' ||
      (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
    ));
  out.counts.interactive = interactive.length;
  for (const el of interactive) {
    // A <label> that wraps its control forwards clicks to it, so the target a
    // person actually aims at is the label's box, not the control's. Several
    // inputs and selects here sit inside a padded, bordered label and were being
    // reported as 20px targets when the thing you click is 37px tall.
    let box = el;
    const label = el.closest('label');
    if (label && label !== el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      box = label;
    }
    const r = box.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.position === 'fixed' && r.height < 2) continue;
    if (r.height < 24 || r.width < 24) {
      out.tapTargets.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 50),
        label: el.getAttribute('aria-label') || '',
        w: Math.round(r.width), h: Math.round(r.height),
        cls: String(el.className || '').slice(0, 110),
      });
    }
    const name = (el.textContent || '').trim() || el.getAttribute('aria-label') ||
      el.getAttribute('title') || el.getAttribute('placeholder') ||
      (el.querySelector('img') && el.querySelector('img').getAttribute('alt')) || '';
    if (!name) {
      out.emptyInteractive.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 110),
        html: el.outerHTML.slice(0, 160),
      });
    }
  }

  /* ------- horizontal overflow: which element actually sticks out ------- */
  const docW = document.documentElement.clientWidth;
  out.overflowX = {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: docW,
    overflows: document.documentElement.scrollWidth > docW + 1,
    culprits: [],
  };
  if (out.overflowX.overflows) {
    for (const el of all) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > docW + 1 && r.width <= docW * 1.5) {
        out.overflowX.culprits.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 110),
          right: Math.round(r.right), w: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 50),
        });
      }
    }
    out.overflowX.culprits = out.overflowX.culprits.slice(0, 12);
  }

  /* ------- images ------- */
  for (const img of Array.from(document.querySelectorAll('img'))) {
    out.images.push({
      src: (img.getAttribute('src') || '').slice(0, 90),
      alt: img.getAttribute('alt'),
      hasAlt: img.hasAttribute('alt'),
      w: Math.round(img.getBoundingClientRect().width),
      h: Math.round(img.getBoundingClientRect().height),
      natural: img.naturalWidth + 'x' + img.naturalHeight,
      loaded: img.complete && img.naturalWidth > 0,
    });
  }

  /* ------- heading order ------- */
  for (const h of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    if (!visible(h)) continue;
    out.headings.push({
      level: parseInt(h.tagName.slice(1), 10),
      text: (h.textContent || '').trim().slice(0, 80),
      fontSize: parseFloat(getComputedStyle(h).fontSize),
    });
  }

  /* ------- duplicate ids ------- */
  const ids = {};
  for (const el of all) {
    if (!el.id) continue;
    ids[el.id] = (ids[el.id] || 0) + 1;
  }
  out.duplicateIds = Object.keys(ids).filter((k) => ids[k] > 1);

  /* ------- text clipped or overflowing its box ------- */
  for (const el of all) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const clipped = el.scrollWidth > el.clientWidth + 1 && s.overflow !== 'visible' && s.overflowX !== 'visible';
    const noEllipsis = clipped && s.textOverflow !== 'ellipsis' && s.overflowX !== 'auto' && s.overflowX !== 'scroll';
    if (noEllipsis) {
      out.truncation.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 110),
        text: (el.textContent || '').trim().slice(0, 60),
        scrollW: el.scrollWidth, clientW: el.clientWidth,
      });
    }
  }
  out.truncation = out.truncation.slice(0, 15);

  /* ------- stacking ------- */
  const zs = {};
  for (const el of all) {
    const z = getComputedStyle(el).zIndex;
    if (z && z !== 'auto') zs[z] = (zs[z] || 0) + 1;
  }
  out.zIndexes = Object.keys(zs).map((z) => ({ z, count: zs[z] })).sort((a, b) => Number(b.z) - Number(a.z)).slice(0, 15);

  return out;
})()`;

/* ------------------------------------------------------------------ driver */

async function login(page: Page): Promise<boolean> {
  if (!EMAIL || !PASSWORD) return false;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const email = page.locator('input[type="email"]').first();
  if (!(await email.count())) return false;
  await email.fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(1000);
    if (!page.url().includes("/login")) {
      // UI_PROJECT_ID chooses the repository the workspace opens, the same
      // localStorage key the app writes when a reader picks one.
      if (PROJECT_ID) {
        await page.evaluate(`window.localStorage.setItem("papertrend_workspace_project_v1", ${JSON.stringify(PROJECT_ID)})`);
      }
      return true;
    }
  }
  return false;
}

async function capture(page: Page, route: Route, vp: typeof VIEWPORTS[number], theme: string, consoleErrors: string[]) {
  consoleErrors.length = 0;
  const record: Record<string, unknown> = { route: route.id, path: route.path, viewport: vp.name, theme };
  try {
    const started = Date.now();
    const resp = await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    record.status = resp ? resp.status() : null;
    await page.waitForTimeout(route.auth ? 7000 : 3500);
    // Walk down the page a screen at a time rather than jumping to the bottom.
    // Reveal animations are driven by an IntersectionObserver, and a single jump
    // never intersects the middle of the page - which reads in the screenshot as
    // a huge blank band, a defect the site does not actually have.
    const steps = Number(
      await page.evaluate(`Math.min(40, Math.ceil(document.body.scrollHeight / window.innerHeight) + 1)`)
    );
    for (let i = 0; i <= steps; i += 1) {
      await page.evaluate((step: number) => {
        window.scrollTo(0, step * window.innerHeight * 0.8);
      }, i);
      await page.waitForTimeout(320);
    }
    await page.evaluate(`window.scrollTo(0, 0)`);
    await page.waitForTimeout(900);
    record.loadMs = Date.now() - started;
    record.title = await page.title();

    // Let transitions finish before measuring. An element caught halfway through
    // a fade has a fractional opacity, which blends toward its background and
    // reads as a contrast failure that no user ever sees.
    await page.evaluate(() => {
      const running = document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect);
      return Promise.race([
        Promise.allSettled(running.map((a) => a.finished)),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    });
    await page.waitForTimeout(300);

    record.diagnostics = await page.evaluate(DIAGNOSTICS);

    const dir = join(OUT, "shots", route.id);
    mkdirSync(dir, { recursive: true });
    const shot = join(dir, `${vp.name}-${theme}.png`);
    await page.screenshot({ path: shot, fullPage: true, animations: "disabled" });
    record.screenshot = shot;
    record.landedOn = page.url();
  } catch (err) {
    record.error = String(err).slice(0, 400);
  }
  record.consoleErrors = consoleErrors.slice(0, 15);
  return record;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const records: unknown[] = [];

  // One context per viewport+theme, signed in once and reused for every route.
  //
  // Firebase keeps its session in IndexedDB, which Playwright's storageState does
  // not carry. Handing a saved state to a fresh context therefore produced a
  // signed-out browser, and every authenticated route screenshotted the login
  // page - the entire product surface, silently missing from the audit.
  for (const vp of VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      const routes = ROUTES.filter((r) => (theme === "dark" ? r.bothThemes : true)).filter(
        (r) => ONLY.length === 0 || ONLY.some((prefix) => r.id.startsWith(prefix))
      );
      if (routes.length === 0) continue;

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        colorScheme: theme === "dark" ? "dark" : "light",
      });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240)); });
      page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 240)));

      let authed = false;
      if (routes.some((r) => r.auth)) {
        authed = await login(page);
        console.log(`[${vp.name}/${theme}] ${authed ? "signed in" : "SIGN-IN FAILED - authed routes skipped"}`);
      }

      for (const route of routes) {
        if (route.auth && !authed) continue;
        const r = await capture(page, route, vp, theme, consoleErrors);
        records.push(r);
        const d = (r as { diagnostics?: { contrast?: unknown[]; tapTargets?: unknown[]; overflowX?: { overflows?: boolean } } }).diagnostics;
        const landed = String((r as { landedOn?: string }).landedOn ?? "");
        const bounced = route.auth && landed.includes("/login");
        console.log(
          `${route.id} ${vp.name}/${theme} -> ${(r as { status?: number }).status ?? "ERR"}` +
          (d ? ` contrast:${d.contrast?.length ?? 0} taps:${d.tapTargets?.length ?? 0} overflow:${d.overflowX?.overflows ? "YES" : "no"}` : "") +
          (bounced ? "  *** BOUNCED TO LOGIN ***" : "") +
          ((r as { error?: string }).error ? ` ERROR ${(r as { error?: string }).error}` : "")
        );
      }
      await context.close();
    }
  }

  writeFileSync(join(OUT, "diagnostics.json"), JSON.stringify(records, null, 2));
  await browser.close();
  console.log(`\nwrote ${records.length} records to ${join(OUT, "diagnostics.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
