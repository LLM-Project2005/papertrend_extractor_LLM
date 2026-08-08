"use client";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-papertrend-canvas px-6 text-papertrend-ink">
      <section className="w-full max-w-md border-y border-papertrend-line py-10">
        <p className="papertrend-kicker">Unable to open this view</p>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Something went wrong</h1>
        <p className="mt-3 text-sm leading-6 text-papertrend-muted">
          The page could not finish loading. No technical details were exposed.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-11 items-center rounded-md bg-papertrend-action px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--pt-action-hover)]"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
