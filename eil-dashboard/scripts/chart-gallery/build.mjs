/*
 * Builds the chart gallery (docs/38) into a folder of static files: the page,
 * its bundle and the site's own Tailwind CSS. Nothing is served or deployed.
 *
 *   node scripts/chart-gallery/build.mjs [outDir]
 *
 * The default folder is papertrend-chart-gallery in the system's temp folder.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "papertrend-chart-gallery"));
mkdirSync(out, { recursive: true });

// The paper viewer needs the app's router; in the gallery a paper link is a plain link.
const stubs = {
  name: "gallery-stubs",
  setup(context) {
    context.onResolve({ filter: /PaperViewerProvider$/ }, () => ({ path: join(here, "stubs", "paper-viewer.ts") }));
  },
};

await build({
  entryPoints: [join(here, "gallery.tsx")],
  bundle: true,
  outfile: join(out, "gallery.js"),
  format: "iife",
  jsx: "automatic",
  target: "es2022",
  tsconfig: join(root, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [stubs],
  logLevel: "warning",
});

const tailwind = join(root, "node_modules", ".bin", process.platform === "win32" ? "tailwindcss.cmd" : "tailwindcss");
execFileSync(tailwind, ["-c", join(root, "tailwind.config.ts"), "-i", join(root, "src", "app", "globals.css"), "-o", join(out, "gallery.css"), "--content", `${join(root, "src")}/**/*.{ts,tsx},${here}/**/*.tsx`], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

writeFileSync(
  join(out, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chart gallery</title><link rel="stylesheet" href="gallery.css"><style>body{font-family:system-ui,"Segoe UI","Leelawadee UI",sans-serif}</style></head><body class="bg-canvas text-ink"><div id="root"></div><script src="gallery.js"></script></body></html>`
);
console.log(out);
