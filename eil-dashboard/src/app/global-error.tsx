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
        <main className="flex min-h-screen items-center justify-center bg-canvas px-6 text-ink">
          <section className="w-full max-w-md rounded-xl border border-hairline bg-surface p-6 shadow-sm">
            <p className="text-sm font-medium text-mute">Error</p>
            <h1 className="mt-2 text-2xl font-semibold">Papertrend hit a problem</h1>
            {/*
              This used to end "check the status logs". Readers do not have status
              logs - that sentence was written for whoever was on call.
            */}
            <p className="mt-3 text-sm leading-6 text-mute">
              The page stopped before it could load. Reloading usually clears it.
              Nothing you had saved is affected.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-5 inline-flex rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-slate-800 dark:hover:bg-[#e5e5e5]"
            >
              Try again
            </button>
            {error?.digest ? (
              <p className="mt-5 border-t border-hairline pt-4 font-mono text-xs text-mute">
                Reference {error.digest}
              </p>
            ) : null}
          </section>
        </main>
      </body>
    </html>
  );
}
