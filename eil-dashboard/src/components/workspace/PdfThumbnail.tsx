"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadPdfJs } from "@/lib/pdfjs-loader";

/*
 * A paper's first page as a picture, for the Library's grid (2026-10-31, the
 * user's request: a glimpse of each paper, as Google Drive shows one).
 *
 * pdf.js draws the page in the browser from the stored PDF, as the paper
 * viewer does, reading only the parts of the file page 1 needs. A card starts
 * when it comes near the view, two at a time, so a long grid does not fetch
 * every paper at once. Each picture is kept for the session; a paper whose
 * page cannot be drawn keeps the caller's fallback and is not tried again.
 */

const RENDER_WIDTH = 480;
const AT_ONCE = 2;

const pictures = new Map<string, Promise<string | null>>();
const ready = new Map<string, string>();
let running = 0;
const waiting: Array<() => void> = [];

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function drawFirstPage(url: string): Promise<string | null> {
  const pdfjs = await loadPdfJs();
  // Ranges only: a streamed read would go on to fetch the whole file.
  const task = pdfjs.getDocument({ url, disableAutoFetch: true, disableStream: true, isEvalSupported: false });
  try {
    const document_ = await task.promise;
    const page = await document_.getPage(1);
    const viewport = page.getViewport({ scale: RENDER_WIDTH / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    // A browser without WebP encoding hands back a PNG, which is fine too.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    void task.destroy();
  }
}

function pictureFor(key: string, getUrl: () => Promise<string | null>): Promise<string | null> {
  let picture = pictures.get(key);
  if (!picture) {
    picture = inTurn(async () => {
      const url = await getUrl();
      // A paper linked from Google Drive opens in Drive; there is no PDF here to draw.
      if (!url || /^https:\/\/(drive|docs)\.google\.com\//.test(url)) return null;
      return drawFirstPage(url);
    })
      .then((src) => {
        if (src) ready.set(key, src);
        return src;
      })
      .catch(() => null);
    pictures.set(key, picture);
  }
  return picture;
}

export default function PdfThumbnail({
  cacheKey,
  getUrl,
  fallback,
}: {
  /** Names the stored file: the same key never draws the page twice. */
  cacheKey: string;
  /** A link the browser can read the PDF from (the Library's signed "open" link). */
  getUrl: () => Promise<string | null>;
  /** Shown until the page is drawn, and for good if it cannot be. */
  fallback: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const getUrlRef = useRef(getUrl);
  getUrlRef.current = getUrl;
  const [src, setSrc] = useState<string | null>(() => ready.get(cacheKey) ?? null);

  useEffect(() => {
    const known = ready.get(cacheKey);
    if (known) {
      setSrc(known);
      return;
    }
    setSrc(null);
    const node = box.current;
    if (!node) return;
    let current = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void pictureFor(cacheKey, () => getUrlRef.current()).then((picture) => {
          if (current && picture) setSrc(picture);
        });
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [cacheKey]);

  return (
    <div ref={box} className="h-full w-full">
      {src ? (
        // A blob drawn in this browser: next/image has nothing to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full rounded-t-md bg-white object-cover object-top shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        />
      ) : (
        fallback
      )}
    </div>
  );
}
