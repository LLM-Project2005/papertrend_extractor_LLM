"use client";

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
      <div className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden border-r border-papertrend-line bg-papertrend-ink px-10 py-12 text-white lg:flex lg:flex-col">
          <Link href="/" className="relative inline-flex items-center gap-3 self-start" aria-label="Papertrend home">
            <LogoMarkIcon className="h-8 w-8" />
            <span className="text-sm font-semibold">Papertrend</span>
          </Link>
          <div className="relative my-auto max-w-xl">
            <p className="font-mono text-xs uppercase text-[#55c8d2]">Research workspace</p>
            <h1 className="mt-5 font-serif text-5xl font-semibold leading-[1.04]">
              Return to the evidence behind your work.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-8 text-[#c7d0dc]">
              Open your repositories, continue analysis, and ask grounded questions
              across the papers you have already organized.
            </p>
            <ul className="mt-10 space-y-4">
              {["Private repository scope", "Visible analysis progress", "Source-linked research chat"].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-[#e5ebf2]">
                  <CheckCircleIcon className="h-4 w-4 text-[#55c8d2]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-[#9eabbc]">Papertrend academic beta</p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
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
