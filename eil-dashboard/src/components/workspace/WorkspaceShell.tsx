"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  ChartIcon,
  ChatIcon,
  HomeIcon,
  LogoMarkIcon,
  PaperIcon,
  PlusIcon,
  SettingsIcon,
  UploadIcon,
} from "@/components/ui/Icons";

const NAV_ITEMS = [
  { href: "/workspace/home", label: "Home", icon: HomeIcon },
  { href: "/workspace/dashboard", label: "Dashboard", icon: ChartIcon },
  { href: "/workspace/chat", label: "Chat", icon: ChatIcon },
  { href: "/workspace/papers", label: "Papers", icon: PaperIcon },
  { href: "/workspace/imports", label: "Imports", icon: UploadIcon },
  { href: "/workspace/settings", label: "Settings", icon: SettingsIcon },
] as const;

const PAGE_DESCRIPTIONS: Record<string, string> = {
  "/workspace/home": "Overview, next steps, and the current state of your corpus.",
  "/workspace/dashboard": "Analytics across trends, topics, keywords, and track views.",
  "/workspace/chat": "A clean assistant surface for grounded questions across the corpus.",
  "/workspace/papers": "Inspect titles, keywords, evidence, and track assignments.",
  "/workspace/imports": "Bring new sources into the workspace and monitor intake.",
  "/workspace/settings": "Adjust the workspace identity and onboarding defaults.",
};

export default function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { profile } = useWorkspaceProfile();

  const currentItem =
    NAV_ITEMS.find((item) => pathname.startsWith(item.href)) ?? NAV_ITEMS[0];

  const intakeLabel =
    profile.primarySource === "pdf-upload"
      ? "PDF upload ready"
      : profile.primarySource === "csv-import"
        ? "Notebook sync ready"
        : "Connector planning";

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="grid min-h-screen lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col px-4 py-5">
            <Link href="/" className="flex items-center gap-3 px-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                <LogoMarkIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Papertrend</p>
                <p className="text-xs text-slate-500">Research workspace</p>
              </div>
            </Link>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-medium text-slate-900">{profile.name}</p>
              <p className="mt-1 text-sm text-slate-500">{profile.organization}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                {profile.domain}
              </p>
            </div>

            <div className="mt-6">
              <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Modules
              </p>
              <nav className="mt-2 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Intake
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900">{intakeLabel}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/start"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
                >
                  Setup
                </Link>
                <Link
                  href="/"
                  className="rounded-lg border border-transparent px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  Landing
                </Link>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {currentItem.label}
                </p>
                <p className="mt-1 truncate text-sm text-slate-600">
                  {PAGE_DESCRIPTIONS[currentItem.href]}
                </p>
              </div>
              <Link
                href="/workspace/imports"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                <PlusIcon className="h-4 w-4" />
                <span>Add source</span>
              </Link>
            </div>
          </header>

          <main className="min-w-0 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
