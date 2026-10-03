/*
 * The theme before the first paint, run rather than read: the root layout is
 * rendered, the script it puts in <head> is run against a page made of a
 * storage, a system setting and the root element's classes, and the
 * ThemeProvider's own saved choice is handed back to it. Sign-in, the fonts
 * and the stylesheet are swapped for render (tests/support/stub-*.ts); the
 * layout and the provider are the real ones.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/node_modules/geist/dist/sans.js", support("stub-siteui-fonts.ts"));
stubModule("/node_modules/geist/dist/mono.js", support("stub-siteui-fonts.ts"));
stubModule("/src/app/globals.css", support("stub-siteui-stylesheet.ts"));
(globalThis as { React?: typeof React }).React = React;

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

/** A page for the script: its storage, whether the system asks for dark, and the root element's classes. */
function browserPage(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, systemDark: boolean, classes: string[] = []) {
  const rootClasses = new Set(classes);
  const window = {
    localStorage: storage,
    matchMedia: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && systemDark,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  };
  const document = {
    documentElement: {
      classList: {
        toggle: (name: string, on: boolean) => (on ? rootClasses.add(name) : rootClasses.delete(name), on),
        contains: (name: string) => rootClasses.has(name),
      },
    },
  };
  return { window, document, rootClasses };
}

async function renderedLayout() {
  const { default: RootLayout } = await import("../src/app/layout");
  return renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "The page itself")));
}

async function prePaintScript() {
  const html = await renderedLayout();
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? "";
  const script = head.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "the layout's <head> carries a script");
  return script;
}

/** Runs the pre-paint script in a page and says whether the page came out dark. */
function paint(script: string, page: ReturnType<typeof browserPage>) {
  vm.runInNewContext(script, { window: page.window, document: page.document });
  return page.rootClasses.has("dark");
}

test("the theme is chosen in <head>, before anything in the body is painted", async () => {
  const html = await renderedLayout();
  const head = html.indexOf("<head>");
  const script = html.indexOf("<script>");
  const body = html.indexOf("<body");
  assert.ok(head >= 0 && head < script && script < html.indexOf("</head>") && html.indexOf("</head>") < body, "the script sits in <head>, ahead of <body>");
  assert.ok(html.indexOf("The page itself") > body);
});

test("the pre-paint script follows a saved choice, and the system's when there is none", async () => {
  const script = await prePaintScript();
  const saved = (value: string | null) => {
    const storage = new MemoryStorage();
    if (value) storage.setItem("papertrend_theme", value);
    return storage;
  };
  assert.equal(paint(script, browserPage(saved("dark"), false)), true, "saved dark on a light system");
  assert.equal(paint(script, browserPage(saved("light"), true, ["dark"])), false, "saved light on a dark system, and a stale class removed");
  assert.equal(paint(script, browserPage(saved(null), true)), true, "nothing saved: the system's dark");
  assert.equal(paint(script, browserPage(saved(null), false)), false, "nothing saved: the system's light");
});

test("the pre-paint script reads what the ThemeProvider saves", async () => {
  // Two places deciding the theme would flip it back on hydration. The choice
  // a reader makes through the provider is what the next page's script reads.
  const script = await prePaintScript();
  const { ThemeProvider, useTheme } = await import("../src/components/theme/ThemeProvider");
  let theme: ReturnType<typeof useTheme> | undefined;
  function Probe() {
    theme = useTheme();
    return null;
  }
  renderToStaticMarkup(createElement(ThemeProvider, null, createElement(Probe)));
  assert.ok(theme);

  const storage = new MemoryStorage();
  const host = globalThis as { window?: unknown; document?: unknown };
  const choose = (preference: "light" | "dark" | "system", systemDark: boolean) => {
    const page = browserPage(storage, systemDark);
    host.window = page.window;
    host.document = page.document;
    try {
      theme!.setPreference(preference);
    } finally {
      delete host.window;
      delete host.document;
    }
    return page.rootClasses.has("dark");
  };
  try {
    assert.equal(choose("dark", false), true, "the provider paints the choice at once");
    assert.equal(paint(script, browserPage(storage, false)), true, "the next page opens dark on a light system");
    assert.equal(choose("light", true), false);
    assert.equal(paint(script, browserPage(storage, true)), false, "and light on a dark system");
    choose("system", false);
    assert.equal(paint(script, browserPage(storage, true)), true, "following the system again");
    assert.equal(paint(script, browserPage(storage, false)), false);
  } finally {
    delete host.window;
    delete host.document;
  }
});

test("a storage that throws leaves the page standing, in its default theme", async () => {
  // localStorage throws outright in some privacy modes.
  const script = await prePaintScript();
  const refusing = {
    getItem: () => {
      throw new Error("SecurityError: storage is disabled");
    },
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const page = browserPage(refusing, true);
  assert.doesNotThrow(() => paint(script, page));
  assert.equal(page.rootClasses.has("dark"), false);
});
