import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-papertrend-canvas px-6 text-papertrend-ink">
      <section className="w-full max-w-md border-y border-papertrend-line py-10">
        <p className="papertrend-kicker">404</p>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-papertrend-muted">
          The page may have moved, or you may not have access to it.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-md bg-papertrend-action px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--pt-action-hover)]"
        >
          Go home
        </Link>
      </section>
    </main>
  );
}
