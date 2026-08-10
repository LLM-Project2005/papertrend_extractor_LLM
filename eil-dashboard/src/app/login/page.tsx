"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import { getStoredWorkspaceRoute } from "@/lib/workspace-session";
import { LogoMarkIcon } from "@/components/ui/Icons";

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
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900 dark:bg-black dark:text-white">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-10">
        <div className="mt-12 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center text-slate-950 dark:text-white">
            <LogoMarkIcon className="h-9 w-9" />
          </span>
          <div>
            <p className="text-xl font-semibold">Papertrend</p>
            <p className="text-sm text-slate-500 dark:text-[#8f8f8f]">Sign in to continue</p>
          </div>
        </div>

        <div className="w-full max-w-md">
          <AuthPanel
            eyebrow="Sign in"
            title="Welcome back"
            description="Continue with Google or Facebook to open your workspaces and projects."
          />
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900 dark:bg-black dark:text-white">
          <div className="mx-auto flex max-w-5xl items-center justify-center">
            <p className="mt-24 text-sm text-slate-500 dark:text-[#9b9b9b]">Loading</p>
          </div>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
