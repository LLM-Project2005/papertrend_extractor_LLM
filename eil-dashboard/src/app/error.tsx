"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900 dark:bg-black dark:text-white">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
        <p className="text-sm font-medium text-slate-500 dark:text-[#9b9b9b]">Error</p>
        <h1 className="mt-2 text-2xl font-semibold">Something went wrong</h1>
        {/*
          This used to read "No technical details were exposed." That is a note to
          the developer who wrote the boundary, not to the person reading it - it
          answers a question they had not asked, and invites the one they now
          will. What a reader needs here is what to do next.
        */}
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
          The page could not finish loading. Trying again usually works; if it
          does not, your work is still saved and reloading the workspace will
          bring it back.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-[#e5e5e5]"
          >
            Try again
          </button>
          <a
            href="/workspace/home"
            className="inline-flex rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
          >
            Back to workspace
          </a>
        </div>
        {/*
          The digest is a hash Next.js also writes to the server log. It carries
          no stack and no data, and it is the only thing that lets someone say
          which failure they hit - so discarding it left a reader with nothing to
          report but "it broke".
        */}
        {error?.digest ? (
          <p className="mt-5 border-t border-slate-200 pt-4 font-mono text-xs text-slate-500 dark:border-[#1f1f1f] dark:text-[#8f8f8f]">
            Reference {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
