import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { safeReturnPath } from "../src/lib/safe-return-path";

const FALLBACK = "/workspaces";

test("a path on this site is kept, with its query and fragment", () => {
  assert.equal(safeReturnPath("/workspace/library", FALLBACK), "/workspace/library");
  assert.equal(
    safeReturnPath("/workspace/library?paper=abc&tab=evidence#top", FALLBACK),
    "/workspace/library?paper=abc&tab=evidence#top"
  );
});

test("anything that would leave the site falls back", () => {
  // A backslash and a tab were both measured leaving the site after sign-in:
  // browsers read "\" as "/" and drop tabs, so these became //example.com.
  const escapes = [
    "/\\example.com",
    "/\t/example.com",
    "/\n/example.com",
    "/\r/example.com",
    "//example.com",
    // Dot segments collapse into "//example.com" once resolved.
    "/.//example.com",
    "/a/..//example.com",
    "/%2e//example.com",
    "/././/example.com",
    "https://example.com",
    "javascript:alert(1)",
    "example.com",
    "",
  ];
  for (const value of escapes) {
    assert.equal(safeReturnPath(value, FALLBACK), FALLBACK, JSON.stringify(value));
  }
  assert.equal(safeReturnPath(null, FALLBACK), FALLBACK);
  assert.equal(safeReturnPath(undefined, FALLBACK), FALLBACK);
});

test("every sign-in return path goes through the one check", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(read("src/app/login/page.tsx"), /safeReturnPath\(searchParams\.get\("returnTo"\)/);
  assert.match(read("src/components/auth/AuthProvider.tsx"), /safeReturnPath\(currentUrl\.searchParams\.get\("returnTo"\), ""\)/);
  assert.match(read("src/lib/security-guards.ts"), /return safeReturnPath\(raw, fallback\);/);
  for (const path of ["src/app/login/page.tsx", "src/components/auth/AuthProvider.tsx"]) {
    assert.doesNotMatch(read(path), /returnTo\.startsWith\("\/"\)/, `${path} still has its own check`);
  }
});

test("the image optimizer and the framework banner are off", () => {
  const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
  assert.match(config, /images: \{ unoptimized: true \}/);
  assert.match(config, /poweredByHeader: false/);
});

test("no generated path that is accepted leads off the site", () => {
  // Every combination of these pieces, four deep, after a leading slash. An
  // accepted result is followed the way a browser follows it, from a nested
  // page, and must stay on the same origin.
  const parts = ["/", ".", "..", "%2e", "%2E", "%2f", "a", "//", "evil.example", "@", "?", "#", ":", "%5c", "%09", " "];
  const escapes: string[] = [];
  let checked = 0;
  const visit = (prefix: string, depth: number) => {
    if (depth === 0) return;
    for (const part of parts) {
      const value = prefix + part;
      checked += 1;
      const out = safeReturnPath(value, FALLBACK);
      if (out !== FALLBACK && new URL(out, "https://site.example/deep/page").origin !== "https://site.example") {
        escapes.push(`${value} -> ${out}`);
      }
      visit(value, depth - 1);
    }
  };
  visit("/", 4);
  assert.ok(checked > 60_000, "the search covered the space");
  assert.deepEqual(escapes.slice(0, 5), []);
});
