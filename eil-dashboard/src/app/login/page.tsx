"use client";

import Link from "next/link";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import ProductShot from "@/components/marketing/ProductShot";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { getStoredWorkspaceRoute } from "@/lib/workspace-session";
import { safeReturnPath } from "@/lib/safe-return-path";
import { LogoMarkIcon } from "@/components/ui/Icons";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hydrated, user } = useAuth();

  useEffect(() => {
    if (hydrated && user) {
      router.replace(
        safeReturnPath(searchParams.get("returnTo"), getStoredWorkspaceRoute() ?? "/workspaces")
      );
    }
  }, [hydrated, router, searchParams, user]);

  return (
    <main className="grid min-h-[100dvh] bg-canvas text-ink lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-h-[100dvh] flex-col px-6 py-6 sm:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Papertrend home">
            <LogoMarkIcon className="h-6 w-6 text-ink" />
            <span className="text-[15px] font-semibold tracking-tight text-ink">Papertrend</span>
          </Link>
          <ThemeToggle compact />
        </header>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[380px] motion-safe:animate-rise-in">
            <AuthPanel title="Sign in to Papertrend" />
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-mute">
          <Link href="/" className="transition-colors hover:text-ink">
            Back to the front page
          </Link>
          <Link href="/docs/account-and-settings" className="transition-colors hover:text-ink">
            Help with signing in
          </Link>
        </footer>
      </div>

      {/* A real screen from the product, so the page shows what signing in opens. */}
      <aside className="relative hidden overflow-hidden border-l border-hairline bg-subtle/60 lg:flex lg:flex-col lg:justify-center lg:pl-16">
        <div className="max-w-md pr-16">
          <p className="text-2xl font-semibold leading-snug tracking-tight text-ink">
            Every paper read the same careful way, charted over time, and answered with citations.
          </p>
          <p className="mt-3 text-[15px] leading-7 text-body">
            Upload PDFs into a repository and the rest of the workspace fills in as each one is analyzed.
          </p>
        </div>
        <div className="mt-12 w-[880px] max-w-none">
          <ProductShot
            name="dashboard-trends"
            alt="The Trend Analysis view of the dashboard, showing themes by year."
            sizes="880px"
          />
        </div>
      </aside>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[100dvh] items-center justify-center bg-canvas">
          <p className="text-sm text-mute" role="status">
            Loading…
          </p>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
