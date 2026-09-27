// pdf.js renders PDFs in a web worker, which the browser loads as a separate
// file. Copying it into public/ at build time keeps the 1.4 MB worker out of
// git and in step with the installed pdfjs-dist version.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const target = join(root, "public", "pdfjs", "pdf.worker.min.mjs");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("copied pdf.js worker to public/pdfjs/");
