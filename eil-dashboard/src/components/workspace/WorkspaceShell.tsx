"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AuthStatus from "@/components/auth/AuthStatus";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  ChartIcon,
  ChatIcon,
  CloseIcon,
  HomeIcon,
  LogoMarkIcon,
  MenuIcon,
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

function SidebarContent({
  pathname,
  profile,
  onNavigate,
}: {
  pathname: string;
  profile: ReturnType<typeof useWorkspaceProfile>["profile"];
  onNavigate?: () => void;
}) {
  const intakeLabel =
    profile.primarySource === "pdf-upload"
      ? "PDF upload ready"
      : profile.primarySource === "csv-import"
        ? "Notebook sync ready"
        : "Connector planning";

  return (
    <div className="flex h-full flex-col px-3 py-4 sm:px-4 sm:py-5">
      <Link href="/" className="flex items-center gap-3 px-2" onClick={onNavigate}>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
          <LogoMarkIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Papertrend
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Research workspace
          </p>
        </div>
      </Link>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {profile.name}
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {profile.organization}
        </p>
        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          {profile.domain}
        </p>
      </div>

      <div className="mt-5">
        <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
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
                onClick={onNavigate}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
          Intake
        </p>
        <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
          {intakeLabel}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/start"
            onClick={onNavigate}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
          >
            Setup
          </Link>
          <Link
            href="/"
            onClick={onNavigate}
            className="rounded-lg border border-transparent px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            Landing
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { profile } = useWorkspaceProfile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem("papertrend_sidebar_open");
    if (stored === "false") {
      setDesktopSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      "papertrend_sidebar_open",
      desktopSidebarOpen ? "true" : "false"
    );
  }, [desktopSidebarOpen]);

  const currentItem =
    NAV_ITEMS.find((item) => pathname.startsWith(item.href)) ?? NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div
        className={`lg:grid lg:min-h-screen ${
          desktopSidebarOpen
            ? "lg:grid-cols-[240px_minmax(0,1fr)]"
            : "lg:grid-cols-[minmax(0,1fr)]"
        }`}
      >
        <aside
          className={`hidden border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 lg:block ${
            desktopSidebarOpen ? "lg:block" : "lg:hidden"
          }`}
        >
          <SidebarContent pathname={pathname} profile={profile} />
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-slate-950/45 lg:hidden">
            <div className="h-full max-w-[288px] overflow-y-auto border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Workspace menu
                </p>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <SidebarContent
                pathname={pathname}
                profile={profile}
                onNavigate={() => setSidebarOpen(false)}
              />
            </div>
          </div>
        )}

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
            <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (window.innerWidth >= 1024) {
                      setDesktopSidebarOpen((current) => !current);
                      return;
                    }

                    setSidebarOpen(true);
                  }}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  aria-label="Toggle workspace navigation"
                >
                  <MenuIcon className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    {currentItem.label}
                  </p>
                  <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                    {PAGE_DESCRIPTIONS[currentItem.href]}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <AuthStatus />
                <ThemeToggle />
                <Link
                  href="/workspace/imports"
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  <PlusIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Add source</span>
                </Link>
              </div>
            </div>
          </header>

          <main className="min-w-0 px-3 py-5 sm:px-6 sm:py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
