/*
 * The Library's page thumbnails, kept in this browser between visits
 * (2026-11-01, the owner chose this over thumbnails made by the server).
 *
 * Each picture is stored under its paper's key in the Cache API, so a second
 * visit shows it without fetching the PDF again. Only the newest MAX_KEPT are
 * kept, and signing out removes them all, since they show papers' first pages.
 * A browser that refuses storage (a private window, blocked site data) simply
 * draws the pages again.
 */

const CACHE_NAME = "papertrend-pdf-thumbnails-v1";
const MAX_KEPT = 300;

function keyFor(cacheKey: string): string {
  return `/pdf-thumbnails/${encodeURIComponent(cacheKey)}`;
}

async function openStore(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function readThumbnail(cacheKey: string): Promise<Blob | null> {
  const store = await openStore();
  if (!store) return null;
  try {
    const response = await store.match(keyFor(cacheKey));
    return response ? await response.blob() : null;
  } catch {
    return null;
  }
}

export async function keepThumbnail(cacheKey: string, picture: Blob): Promise<void> {
  const store = await openStore();
  if (!store) return;
  try {
    await store.put(keyFor(cacheKey), new Response(picture, { headers: { "content-type": picture.type } }));
    // Keys come back oldest first, so the oldest pictures go first.
    const kept = await store.keys();
    for (const old of kept.slice(0, Math.max(0, kept.length - MAX_KEPT))) await store.delete(old);
  } catch {
    // Storage full or refused: the page is drawn again next time.
  }
}

export async function forgetPdfThumbnails(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Nothing was kept.
  }
}
