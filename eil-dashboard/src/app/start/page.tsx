import Link from "next/link";
import StartWorkspaceClient from "@/components/workspace/StartWorkspaceClient";

export default function StartPage() {
  return (
    <main className="min-h-screen bg-[#f6f1e8] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
              Guided setup
            </p>
            <p className="mt-1 text-sm text-[#5a5248]">
              Configure the workspace before sending people into analytics.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/"
              className="rounded-full border border-[#172029] px-4 py-2.5 text-sm font-semibold text-[#172029] transition-colors hover:bg-white/70"
            >
              Back to landing
            </Link>
            <Link
              href="/workspace/home"
              className="rounded-full bg-[#172029] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#253644]"
            >
              Skip to workspace
            </Link>
          </div>
        </div>

        <StartWorkspaceClient />
      </div>
    </main>
  );
}
