"use client";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900 dark:bg-black dark:text-white">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
        <p className="text-sm font-medium text-slate-500 dark:text-[#9b9b9b]">Error</p>
        <h1 className="mt-2 text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
          The page could not finish loading. No technical details were exposed.
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
  );
}
