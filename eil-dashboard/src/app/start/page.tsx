import Link from "next/link";
import StartWorkspaceClient from "@/components/workspace/StartWorkspaceClient";
import { LogoMarkIcon } from "@/components/ui/Icons";

export default function StartPage() {
  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Papertrend</p>
              <p className="text-xs text-slate-500">Workspace setup</p>
            </div>
          </Link>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              Back to landing
            </Link>
            <Link
              href="/workspace/home"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Skip to workspace
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <section className="mb-6 rounded-3xl border border-slate-200 bg-white px-6 py-6 sm:px-8">
          <p className="text-sm font-medium text-slate-500">Guided setup</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            Configure the workspace before people land in analytics
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            This setup is intentionally lightweight. Define the research context,
            choose the first intake path, and prioritize the outputs you want the
            workspace to emphasize.
          </p>
        </section>

        <StartWorkspaceClient />
      </div>
    </main>
  );
}
