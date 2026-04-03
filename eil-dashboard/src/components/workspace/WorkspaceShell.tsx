"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import AuthStatus from "@/components/auth/AuthStatus";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { useIngestionRuns } from "@/hooks/useIngestionRuns";
import AnalysisStatusCard from "@/components/workspace/AnalysisStatusCard";
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
  "/workspace/profile": "Review the signed-in account and update the profile shown in the workspace.",
};

function DesktopSidebar({
  pathname,
  profile,
}: {
  pathname: string;
  profile: ReturnType<typeof useWorkspaceProfile>["profile"];
}) {
  return (
    <aside className="group fixed inset-y-0 left-0 z-40 hidden w-[76px] overflow-hidden border-r border-slate-200 bg-white transition-[width] duration-200 ease-out hover:w-[296px] dark:border-[#2c2c2c] dark:bg-[#1d1d1d] lg:block">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-3 py-4">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-[#ececec] dark:text-[#171717]">
            <LogoMarkIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 overflow-hidden opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <p className="truncate text-base font-semibold text-slate-950 dark:text-[#ececec]">
              Papertrend
            </p>
            <p className="truncate text-sm text-slate-500 dark:text-[#8f8f8f]">
              Research workspace
            </p>
          </div>
        </div>

        <div className="border-b border-slate-200 px-3 pb-4 dark:border-[#2c2c2c]">
          <div className="rounded-2xl border border-transparent px-1 py-1 transition-colors group-hover:border-slate-200 group-hover:bg-slate-50 dark:group-hover:border-[#2f2f2f] dark:group-hover:bg-[#202020]">
            <div className="flex items-start gap-3 px-2 py-2">
              <span className="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-[#303030] dark:bg-[#232323]">
                <HomeIcon className="h-4 w-4 text-slate-500 dark:text-[#8f8f8f]" />
              </span>
              <div className="min-w-0 overflow-hidden opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <p className="truncate text-sm font-medium text-slate-950 dark:text-[#ececec]">
                  {profile.name}
                </p>
                <p className="truncate text-sm text-slate-500 dark:text-[#8f8f8f]">
                  {profile.organization}
                </p>
                <p className="mt-1 truncate text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-[#6f6f6f]">
                  {profile.domain}
                </p>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors ${
                  isActive
                    ? "bg-slate-100 text-slate-950 dark:bg-[#2b2b2b] dark:text-[#f2f2f2]"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-[#9a9a9a] dark:hover:bg-[#232323] dark:hover:text-[#ececec]"
                }`}
              >
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <span className="block text-sm font-medium">{item.label}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-3 py-4 dark:border-[#2c2c2c]">
          <Link
            href="/workspace/imports"
            className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-[#9a9a9a] dark:hover:bg-[#232323] dark:hover:text-[#ececec]"
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl">
              <PlusIcon className="h-5 w-5" />
            </span>
            <span className="overflow-hidden whitespace-nowrap text-sm font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              Add source
            </span>
          </Link>
        </div>
      </div>
    </aside>
  );
}

function MobileSidebar({
  pathname,
  profile,
  onClose,
}: {
  pathname: string;
  profile: ReturnType<typeof useWorkspaceProfile>["profile"];
  onClose: () => void;
}) {
  return (
    <div className="h-full max-w-[288px] overflow-y-auto border-r border-slate-200 bg-white dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
      <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
        <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
          Workspace menu
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#353535] dark:bg-[#232323] dark:text-[#d0d0d0]"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-5 px-4 py-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#202020]">
          <p className="text-sm font-medium text-slate-950 dark:text-[#ececec]">
            {profile.name}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-[#8f8f8f]">
            {profile.organization}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-[#6f6f6f]">
            {profile.domain}
          </p>
        </div>

        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-slate-100 text-slate-950 dark:bg-[#2b2b2b] dark:text-[#f2f2f2]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-[#c7c7c7] dark:hover:bg-[#232323] dark:hover:text-[#ececec]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
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
  const {
    profile,
    folders,
    selectedFolderId,
    setSelectedFolderId,
    analysisSession,
    setAnalysisMinimized,
    removeAnalysisRunIds,
    clearAnalysisSession,
  } = useWorkspaceProfile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { runs, folderJob, cancelRuns } = useIngestionRuns({
    enabled: Boolean(analysisSession?.runIds.length),
    folderJobId: analysisSession?.folderJobId ?? undefined,
    pollIntervalMs: 8000,
  });

  const activeRuns = analysisSession
    ? runs.filter((run) => analysisSession.runIds.includes(run.id))
    : [];

  const currentItem =
    NAV_ITEMS.find((item) => pathname.startsWith(item.href)) ??
    (pathname.startsWith("/workspace/profile")
      ? { href: "/workspace/profile", label: "Profile" }
      : NAV_ITEMS[0]);

  async function handleCancelRun(runId: string) {
    try {
      const canceledRuns = await cancelRuns([runId]);
      if (canceledRuns.length > 0) {
        removeAnalysisRunIds(canceledRuns.map((run) => run.id));
      }
    } catch (error) {
      console.error("[workspace] failed to cancel run", {
        runId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  async function handleCancelAllRuns() {
    const activeRunIds = activeRuns
      .filter((run) => run.status === "queued" || run.status === "processing")
      .map((run) => run.id);

    if (activeRunIds.length === 0) {
      return;
    }

    try {
      const canceledRuns = await cancelRuns(activeRunIds);
      if (canceledRuns.length > 0) {
        removeAnalysisRunIds(canceledRuns.map((run) => run.id));
      }
    } catch (error) {
      console.error("[workspace] failed to cancel all runs", {
        runIds: activeRunIds,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#171717] dark:text-slate-100">
      <DesktopSidebar pathname={pathname} profile={profile} />

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 lg:hidden">
          <MobileSidebar
            pathname={pathname}
            profile={profile}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      ) : null}

      <div className="min-h-screen lg:pl-[76px]">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-[#2c2c2c] dark:bg-[#171717]/90">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#353535] dark:bg-[#232323] dark:text-[#d0d0d0] lg:hidden"
                aria-label="Open workspace navigation"
              >
                <MenuIcon className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
                  {currentItem.label}
                </p>
                <p className="mt-1 truncate text-sm text-slate-600 dark:text-[#b8b8b8]">
                  {PAGE_DESCRIPTIONS[currentItem.href]}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-[#353535] dark:bg-[#232323] dark:text-[#d0d0d0] sm:flex">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-[#7a7a7a]">
                  Folder
                </span>
                <select
                  value={selectedFolderId}
                  onChange={(event) => setSelectedFolderId(event.target.value)}
                  className="bg-transparent text-sm font-medium text-slate-700 outline-none dark:text-[#ececec]"
                >
                  <option value="all">All folders</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              <AuthStatus />
              <ThemeToggle />
              <Link
                href="/workspace/imports"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-[#ececec] dark:text-[#171717] dark:hover:bg-white"
              >
                <PlusIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Add source</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="min-w-0 px-3 py-5 sm:px-6 sm:py-6">{children}</main>

        {analysisSession &&
        (analysisSession.minimized || pathname !== "/workspace/home") ? (
          <div className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))]">
            <AnalysisStatusCard
              runs={activeRuns}
              folderJob={folderJob}
              compact
              onExpand={() => setAnalysisMinimized(false)}
              onClear={clearAnalysisSession}
              onCancelRun={handleCancelRun}
              onCancelAll={handleCancelAllRuns}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
