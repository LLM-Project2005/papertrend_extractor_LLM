"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { getStoredWorkspaceRoute } from "@/lib/workspace-session";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { LogoMarkIcon } from "@/components/ui/Icons";

export default function LandingPage() {
  const router = useRouter();
  const { hydrated, user } = useAuth();

  useEffect(() => {
    if (hydrated && user) {
      router.replace(getStoredWorkspaceRoute() ?? "/organizations");
    }
  }, [hydrated, router, user]);

  return (
    <main className="min-h-screen bg-[#111111] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f9d63] text-white">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <span className="text-xl font-semibold tracking-tight">Papertrend</span>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="rounded-xl border border-white/10 bg-[#1b1b1b] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#222222]"
            >
              Start your project
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-81px)] max-w-6xl flex-col items-center justify-center px-6 py-24 text-center">
        <p className="text-sm font-medium text-[#34d399]">Research intelligence workspace</p>
        <h1 className="mt-6 text-5xl font-semibold tracking-tight text-white sm:text-7xl">
          Build a research library.
          <br />
          <span className="text-[#34d399]">Scale it into insight.</span>
        </h1>
        <p className="mt-8 max-w-3xl text-lg leading-9 text-[#bdbdbd]">
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
