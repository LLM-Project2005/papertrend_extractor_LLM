import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

function exists(relative: string): boolean {
  return existsSync(new URL(`../${relative}`, import.meta.url));
}

/* ------------------------------------------------- the theme, before first paint */

test("the theme is chosen before the browser paints", () => {
  // ThemeProvider starts at "light" and corrects inside an effect, which runs
  // after the first paint. Measured on the deployed site with the system set to
  // dark: the first painted frame was rgb(248,250,252) with no `dark` class, and
  // the class did not land for 165ms. Because `body` transitions its background
  // colour, the correction then played as a 220ms animated wipe from white to
  // black - on every navigation, for every dark-mode reader.
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /const themeScript = /, "a pre-paint script must exist");
  assert.match(layout, /<head>/, "it has to be in <head> to beat the first paint");
  assert.match(layout, /dangerouslySetInnerHTML=\{\{ __html: themeScript \}\}/);
  assert.match(layout, /classList\.toggle\("dark", dark\)/);
});

test("the pre-paint script reads the key the provider writes", () => {
  // Two sources of truth for the theme would flip it back on hydration, which is
  // the same defect wearing different clothes.
  const layout = read("src/app/layout.tsx");
  const provider = read("src/components/theme/ThemeProvider.tsx");
  const key = /"papertrend_theme"/;
  assert.match(layout, key);
  assert.match(provider, key);
  assert.match(layout, /prefers-color-scheme: dark/, "same system fallback as the provider");
  assert.match(provider, /prefers-color-scheme: dark/);
});

test("the script cannot take the page down with it", () => {
  // localStorage throws outright in some privacy modes. A theme preference is
  // never worth a blank page.
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /try \{[\s\S]*?\} catch \(e\) \{\}/);
});

test("the browser is told which palette to paint its own furniture in", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /:root \{[\s\S]*?color-scheme: light;/);
  assert.match(css, /\.dark \{\s*color-scheme: dark;\s*\}/);
});

/* ------------------------------------------------------------ honesty of copy */

test("no build note ships as a reason to choose the product", () => {
  // "Static marketing pages with client-only auth CTA" was the fourth value
  // pillar on the public landing page.
  const content = read("src/components/marketing/marketing-content.ts");
  assert.equal(
    /client-only auth CTA/.test(content),
    false,
    "an implementation detail must not be sold to visitors"
  );
  assert.match(content, /Per-file queue status, retries, and run history/);
});

test("every value pillar is something a reader could verify", () => {
  const content = read("src/components/marketing/marketing-content.ts");
  const block = content
    .slice(
      content.indexOf("export const valuePillars"),
      content.indexOf("];", content.indexOf("export const valuePillars"))
    )
    // The comment recording what the fourth pillar used to say quotes the old
    // text, which would otherwise be read back as a fifth pillar.
    .replace(/^\s*\/\/.*$/gm, "");
  const pillars = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(pillars.length, 4);
  for (const pillar of pillars) {
    assert.equal(
      /static|client-only|CTA|SSR|bundle|deploy/i.test(pillar),
      false,
      `"${pillar}" describes the build, not the product`
    );
  }
});

/* -------------------------------------------------------------- hit areas */

test("the two account-recovery paths on the login page can be hit", () => {
  // Measured on the deployed site: "Create password account" was 136x16 and
  // "Reset password" 84x16. Sixteen pixels tall, on the two controls a person
  // reaches for when they cannot get in.
  const panel = read("src/components/auth/AuthPanel.tsx");
  const secondary = [...panel.matchAll(/className="(-my-2[^"]*)"/g)].map((m) => m[1]);
  assert.ok(secondary.length >= 2, "both secondary buttons need padded hit areas");
  for (const cls of secondary) {
    assert.match(cls, /py-2/, "vertical padding is what makes the target");
    assert.match(cls, /-my-2/, "negative margin keeps the row height unchanged");
  }
});

test("documentation contents links are taller than their text", () => {
  // Four per page across thirteen pages, each a 20px target.
  const toc = read("src/components/docs/DocsOnThisPage.tsx");
  assert.match(toc, /block py-1 text-sm leading-5/);
  assert.match(toc, /space-y-1/, "the gap shrinks as the padding grows");
});

/* ------------------------------------------------------- the provider marks */

test("the sign-in provider marks are drawn as filled logos", () => {
  // The icon base renders fill="none" stroke="currentColor", which cannot draw a
  // logo. The old Google mark was four disconnected stroke fragments and read as
  // a scribble on the one page where a reader decides whether to trust the site.
  const icons = read("src/components/ui/Icons.tsx");
  const google = icons.slice(icons.indexOf("export function GoogleIcon"), icons.indexOf("export function FacebookIcon"));
  assert.equal(/<BaseIcon/.test(google), false, "a logo cannot go through the stroke base");
  assert.match(google, /fill="#4285F4"/);
  assert.match(google, /fill="#34A853"/);
  assert.match(google, /fill="#FBBC05"/);
  assert.match(google, /fill="#EA4335"/);

  const facebookStart = icons.indexOf("export function FacebookIcon");
  const facebook = icons.slice(facebookStart, icons.indexOf("\n}", facebookStart));
  assert.equal(/<BaseIcon/.test(facebook), false);
  assert.match(facebook, /fill="#1877F2"/);
});

/* ------------------------------------------------------- docs navigation */

test("a documentation tag leads somewhere", () => {
  // They were spans styled exactly like filter chips, so they invited a click
  // and did nothing.
  const frame = read("src/components/docs/DocsFrame.tsx");
  assert.match(frame, /href=\{`\/docs\/search\?q=\$\{encodeURIComponent\(tag\)\}`\}/);
});

test("documentation search accepts a query from the URL", () => {
  // Without this the tags would link to an empty search box.
  const search = read("src/components/docs/DocsSearchClient.tsx");
  assert.match(search, /new URLSearchParams\(window\.location\.search\)\.get\("q"\)/);
  // Match the call and the import, not the word - the comment above the effect
  // explains why the hook is avoided and would otherwise fail its own test.
  assert.equal(
    /useSearchParams\s*\(|useSearchParams\s*[,}]/.test(search),
    false,
    "this route is statically rendered; the hook would force a Suspense boundary"
  );
});

test("the popular documentation list is a shortlist, not the whole shelf", () => {
  // Nine of thirteen pages carried popular: true - 69%, so the label curated
  // nothing, and the same pages were listed again grouped immediately below.
  const content = read("src/lib/docs-content.ts");
  const popular = (content.match(/popular: true/g) ?? []).length;
  const pages = (content.match(/^\s{8}slug: "/gm) ?? []).length;
  assert.ok(popular > 0, "the shortlist should not be empty");
  assert.ok(
    popular <= Math.ceil(pages / 3),
    `${popular} of ${pages} pages flagged popular is not a shortlist`
  );
});

/* ------------------------------------------------------- the workspace header */

test("a phone still says which repository you are in", () => {
  // Both breadcrumb halves truncated inside a 390px header shared with six other
  // controls, so it rendered as "Rep... > T...".
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  const crumb = shell.slice(
    shell.indexOf("function WorkspaceBreadcrumb"),
    shell.indexOf("function DesktopSidebar")
  );
  assert.match(crumb, /min-w-0 truncate/, "the project name is the part that may truncate");
  assert.match(crumb, /hidden sm:inline/, "the parent label steps aside on a narrow header");
});

test("the route back to the repository picker survives on a phone", () => {
  // The drawer's "Repositories" entry points at /workspace/library, a different
  // page. This breadcrumb link is the only way back to /workspaces, so it may
  // change shape but it may not disappear.
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  const crumb = shell.slice(
    shell.indexOf("function WorkspaceBreadcrumb"),
    shell.indexOf("function DesktopSidebar")
  );
  assert.match(crumb, /href="\/workspaces"/);
  assert.match(crumb, /aria-label="All repositories"/, "an icon-only control still needs a name");
  assert.match(crumb, /rotate-180 sm:hidden/, "it collapses to a back arrow rather than vanishing");
  assert.equal(
    /hidden[^"]*sm:inline[^"]*"\s*\n?\s*>\s*\n?\s*<ArrowRightIcon/.test(crumb),
    false,
    "the link itself must never be the thing that is hidden"
  );
});

/* ------------------------------------------------------------- dead source */

test("components that nothing renders are not kept", () => {
  // 864 lines across six components with no static, dynamic or lazy reference
  // anywhere - orphans of routes that were later turned into redirect() shims.
  // They do not reach the browser, but they mislead every maintainer who greps.
  for (const orphan of [
    "src/components/auth/AuthStatus.tsx",
    "src/components/dashboard/PlannedDashboardSection.tsx",
    "src/components/PrimaryNavigation.tsx",
    "src/components/workspace/StartWorkspaceClient.tsx",
    "src/components/workspace/WorkspaceEmptyState.tsx",
    "src/components/workspace/WorkspacePapersClient.tsx",
  ]) {
    assert.equal(exists(orphan), false, `${orphan} is unreferenced and should be gone`);
  }
});
