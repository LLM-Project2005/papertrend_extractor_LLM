/*
 * pdf.js, loaded once for every part of the app that draws a PDF: the paper
 * viewer and the Library's page thumbnails. The library is imported only when
 * a PDF is first drawn, and its worker is served from this site.
 */
const WORKER_SRC = "/pdfjs/pdf.worker.min.mjs";

export type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    // pdf.js 4 uses Promise.withResolvers, which Safari added only in 17.4.
    const promiseStatics = Promise as unknown as { withResolvers?: () => unknown };
    if (typeof promiseStatics.withResolvers !== "function") {
      promiseStatics.withResolvers = () => {
        let resolve: (value: unknown) => void = () => undefined;
        let reject: (reason?: unknown) => void = () => undefined;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };
    }
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}
