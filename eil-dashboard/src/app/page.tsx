import Link from "next/link";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { LogoMarkIcon } from "@/components/ui/Icons";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-black dark:text-white">
      <header className="border-b border-slate-200 bg-white/80 dark:border-[#1f1f1f] dark:bg-transparent">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f9d63] text-white">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <span className="text-xl font-semibold tracking-normal">Papertrend</span>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:hover:bg-[#0a0a0a]"
            >
              Start your project
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-81px)] max-w-6xl flex-col items-center justify-center px-6 py-24 text-center">
        <p className="text-sm font-medium text-[#34d399]">Research intelligence workspace</p>
        <h1 className="mt-6 text-5xl font-semibold tracking-normal text-slate-950 dark:text-white sm:text-7xl">
          Build a research library.
          <br />
          <span className="text-[#34d399]">Scale it into insight.</span>
        </h1>
        <p className="mt-8 max-w-3xl text-lg leading-9 text-slate-600 dark:text-[#bdbdbd]">
          Papertrend helps teams organize paper collections, analyze folders in
          batch, and move from documents to grounded dashboards and research chat
          without juggling separate tools.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-xl bg-[#1f9d63] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#198451]"
          >
            Start your project
          </Link>
        </div>
      </section>
    </main>
  );
}
