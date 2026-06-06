"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-white px-6 text-slate-950 dark:bg-black dark:text-white">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
            <p className="text-sm font-medium text-slate-500 dark:text-[#9b9b9b]">Error</p>
            <h1 className="mt-2 text-2xl font-semibold">Papertrend hit a problem</h1>
            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
              Please retry the page. If this keeps happening, check the status logs.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-5 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-[#e5e5e5]"
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
