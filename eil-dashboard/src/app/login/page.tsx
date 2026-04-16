"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import { getStoredWorkspaceRoute } from "@/lib/workspace-session";
import { LogoMarkIcon } from "@/components/ui/Icons";

export default function LoginPage() {
  const router = useRouter();
  const { hydrated, user } = useAuth();

  useEffect(() => {
    if (hydrated && user) {
      router.replace(getStoredWorkspaceRoute() ?? "/organizations");
    }
  }, [hydrated, router, user]);

  return (
    <main className="min-h-screen bg-[#111111] px-6 py-12 text-white">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-10">
        <div className="mt-12 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1f9d63] text-white">
            <LogoMarkIcon className="h-6 w-6" />
          </span>
          <div>
            <p className="text-xl font-semibold">Papertrend</p>
            <p className="text-sm text-[#8f8f8f]">Sign in to continue</p>
          </div>
        </div>

        <div className="w-full max-w-md">
          <AuthPanel
            eyebrow="Sign in"
            title="Welcome back"
            description="Continue with Google or Facebook to open your organizations and projects."
          />
        </div>
      </div>
    </main>
  );
}
