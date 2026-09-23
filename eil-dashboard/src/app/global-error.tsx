"use client";

/**
 * A global error replaces the root layout, including its <head>. That means the
 * pre-paint theme script does not run here and nothing ever puts `dark` on
 * <html> - so every `dark:` class on this page was unreachable, and a reader in
 * dark mode got a white screen at the exact moment something had already gone
 * wrong. The script is repeated rather than imported because this tree renders
 * without the layout that would provide it.
 */
const themeScript = `
(function () {
  try {
    var saved = window.localStorage.getItem("papertrend_theme");
    var dark = saved === "dark" || (saved !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900 dark:bg-black dark:text-white">
          <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
            <p className="text-sm font-medium text-slate-500 dark:text-[#9b9b9b]">Error</p>
            <h1 className="mt-2 text-2xl font-semibold">Papertrend hit a problem</h1>
            {/*
              This used to end "check the status logs". Readers do not have status
              logs - that sentence was written for whoever was on call.
            */}
            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
              The page stopped before it could load. Reloading usually clears it.
              Nothing you had saved is affected.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-5 inline-flex rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-[#e5e5e5]"
            >
              Try again
            </button>
            {error?.digest ? (
              <p className="mt-5 border-t border-slate-200 pt-4 font-mono text-xs text-slate-500 dark:border-[#1f1f1f] dark:text-[#8f8f8f]">
                Reference {error.digest}
              </p>
            ) : null}
          </section>
        </main>
      </body>
    </html>
  );
}
