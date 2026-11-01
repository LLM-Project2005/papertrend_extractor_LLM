"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 text-ink">
      <section className="w-full max-w-md rounded-xl border border-hairline bg-surface p-6 shadow-sm">
        <p className="text-sm font-medium text-mute">Error</p>
        <h1 className="mt-2 text-2xl font-semibold">Something went wrong</h1>
        {/*
          This used to read "No technical details were exposed." That is a note to
          the developer who wrote the boundary, not to the person reading it - it
          answers a question they had not asked, and invites the one they now
          will. What a reader needs here is what to do next.
        */}
        <p className="mt-3 text-sm leading-6 text-mute">
          The page could not finish loading. Trying again usually works; if it
          does not, your work is still saved and reloading the workspace will
          bring it back.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-slate-800 dark:hover:bg-[#e5e5e5]"
          >
            Try again
          </button>
          <a
            href="/workspace/home"
            className="inline-flex rounded-lg border border-hairline px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-slate-300 hover:text-ink dark:hover:border-[#3a3a3a]"
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
          <p className="mt-5 border-t border-hairline pt-4 font-mono text-xs text-mute">
            Reference {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
