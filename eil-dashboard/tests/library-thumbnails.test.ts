/*
 * The Library's page thumbnails, kept between visits (2026-11-01, the owner's
 * choice of the quicker in-browser route over thumbnails made by the server).
 * The store runs against an in-memory stand-in for the browser's Cache API.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forgetPdfThumbnails, keepThumbnail, readThumbnail } from "../src/lib/pdf-thumbnail-cache";

function fakeCaches({ refuse = false } = {}) {
  const stores = new Map<string, Map<string, Response>>();
  return {
    stores,
    async open(name: string) {
      if (refuse) throw new DOMException("refused", "SecurityError");
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name)!;
      return {
        async match(key: string) {
          return entries.get(key)?.clone();
        },
        async put(key: string, response: Response) {
          // As the Cache API does: a key written again moves to the end.
          entries.delete(key);
          entries.set(key, response);
        },
        async keys() {
          return [...entries.keys()];
        },
        async delete(key: string) {
          return entries.delete(key);
        },
      };
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
}

function withCaches<T>(value: unknown, run: () => Promise<T>): Promise<T> {
  const global = globalThis as { caches?: unknown };
  const before = global.caches;
  global.caches = value;
  return run().finally(() => {
    if (before === undefined) delete global.caches;
    else global.caches = before;
  });
}

const picture = (text: string) => new Blob([text], { type: "image/webp" });

test("a kept thumbnail comes back on the next visit, and signing out removes it", async () => {
  await withCaches(fakeCaches(), async () => {
    assert.equal(await readThumbnail("run-1:papers/a.pdf"), null);
    await keepThumbnail("run-1:papers/a.pdf", picture("page one"));
    const kept = await readThumbnail("run-1:papers/a.pdf");
    assert.equal(kept?.type, "image/webp");
    assert.equal(await kept?.text(), "page one");
    await forgetPdfThumbnails();
    assert.equal(await readThumbnail("run-1:papers/a.pdf"), null);
  });
});

test("only the newest 300 thumbnails are kept", async () => {
  const caches = fakeCaches();
  await withCaches(caches, async () => {
    for (let index = 0; index < 305; index += 1) await keepThumbnail(`run-${index}:a.pdf`, picture(String(index)));
    const [store] = caches.stores.values();
    assert.equal(store.size, 300);
    assert.equal(await readThumbnail("run-4:a.pdf"), null);
    assert.equal(await (await readThumbnail("run-5:a.pdf"))?.text(), "5");
    assert.equal(await (await readThumbnail("run-304:a.pdf"))?.text(), "304");
  });
});

test("a browser that refuses storage, or has none, just draws the page again", async () => {
  await withCaches(fakeCaches({ refuse: true }), async () => {
    await keepThumbnail("run-1:a.pdf", picture("x"));
    assert.equal(await readThumbnail("run-1:a.pdf"), null);
    await forgetPdfThumbnails();
  });
  await withCaches(undefined, async () => {
    await keepThumbnail("run-1:a.pdf", picture("x"));
    assert.equal(await readThumbnail("run-1:a.pdf"), null);
    await forgetPdfThumbnails();
  });
});

test("the grid looks for a kept thumbnail before queueing, and shares one pdf.js worker", () => {
  const source = readFileSync(new URL("../src/components/workspace/PdfThumbnail.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("readThumbnail(key)") < source.indexOf("inTurn(async"), "a kept picture skips the queue");
  assert.match(source, /void keepThumbnail\(key, drawn\)/);
  assert.match(source, /worker: sharedWorker, disableAutoFetch: true, disableStream: true/);
  assert.match(source, /navigator\.hardwareConcurrency >= 4 \? 4 : 2/);
});

test("signing out forgets the thumbnails", () => {
  const source = readFileSync(new URL("../src/components/auth/AuthProvider.tsx", import.meta.url), "utf8");
  assert.match(source, /signOut: async \(\) => \{\s*\/\/[^\n]*\n\s*await forgetPdfThumbnails\(\);/);
});
