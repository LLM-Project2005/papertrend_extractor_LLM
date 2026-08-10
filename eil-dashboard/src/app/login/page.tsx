"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import { getStoredWorkspaceRoute } from "@/lib/workspace-session";
import { CheckCircleIcon, LogoMarkIcon } from "@/components/ui/Icons";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hydrated, user } = useAuth();

  useEffect(() => {
    if (hydrated && user) {
      const returnTo = searchParams.get("returnTo");
      const safeReturnTo =
        returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
          ? returnTo
          : getStoredWorkspaceRoute() ?? "/workspaces";
      router.replace(safeReturnTo);
    }
  }, [hydrated, router, searchParams, user]);

  return (
    <main className="min-h-screen bg-papertrend-canvas text-papertrend-ink">
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden border-r border-white/15 bg-[#05080c] px-10 py-12 text-white lg:flex lg:flex-col">
          <Image
            src="/images/papertrend-origami-hero.png"
            alt="Folded papers forming a connected research system"
            fill
            priority
            sizes="55vw"
            className="object-cover object-[63%_center] opacity-70"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,8,12,0.98),rgba(5,8,12,0.8)_48%,rgba(5,8,12,0.1))]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(0deg,rgba(5,8,12,0.96),transparent)]" />
          <Link href="/" className="relative inline-flex items-center gap-3 self-start" aria-label="Papertrend home">
            <LogoMarkIcon className="h-8 w-8" />
            <span className="text-sm font-semibold">Papertrend</span>
          </Link>
          <div className="relative my-auto max-w-xl">
            <p className="font-mono text-xs uppercase text-[#5ce1e6]">[ Secure research workspace ]</p>
            <h1 className="mt-5 max-w-2xl text-5xl font-semibold leading-[1.02] xl:text-6xl">
              Return to the evidence behind the insight.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-8 text-[#c7d0dc]">
              Open your repositories, continue analysis, and ask grounded questions
              across the papers you have already organized.
            </p>
            <ul className="mt-10 grid gap-0 border-t border-white/20">
              {["Private repository scope", "Visible analysis progress", "Source-linked research chat"].map((item) => (
                <li key={item} className="flex min-h-14 items-center gap-3 border-b border-white/20 text-sm text-[#e5ebf2]">
                  <CheckCircleIcon className="h-4 w-4 text-[#5ce1e6]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-[#9eabbc]">Papertrend academic beta</p>
        </section>

        <section className="relative flex min-h-screen items-center justify-center bg-papertrend-canvas px-5 py-10 sm:px-8">
          <p className="absolute right-6 top-6 hidden font-mono text-[11px] text-papertrend-muted sm:block">
            Identity / Firebase secured
          </p>
          <div className="w-full max-w-md">
            <Link href="/" className="mb-10 inline-flex items-center gap-3 lg:hidden" aria-label="Papertrend home">
              <LogoMarkIcon className="h-8 w-8" />
              <span className="text-sm font-semibold">Papertrend</span>
            </Link>
            <AuthPanel
              eyebrow="Secure access"
              title="Welcome back"
              description="Sign in to open your research repositories and continue where you left off."
            />
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-papertrend-canvas px-6 text-papertrend-muted">
          <p className="text-sm">Preparing secure sign-in...</p>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
