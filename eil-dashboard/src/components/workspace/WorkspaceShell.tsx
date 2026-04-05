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
  FileIcon,
  FolderIcon,
  HomeIcon,
  LogoMarkIcon,
  MenuIcon,
  PlusIcon,
  SettingsIcon,
} from "@/components/ui/Icons";

const NAV_ITEMS = [
  { href: "/workspace/home", label: "Project Overview", icon: HomeIcon },
  { href: "/workspace/dashboard", label: "Dashboard", icon: ChartIcon },
  { href: "/workspace/chat", label: "Chat", icon: ChatIcon },
  { href: "/workspace/library", label: "Library", icon: FolderIcon },
  { href: "/workspace/logs", label: "Logs", icon: FileIcon },
  { href: "/workspace/settings", label: "Settings", icon: SettingsIcon },
] as const;

const PAGE_DESCRIPTIONS: Record<string, string> = {
  "/workspace/home": "Current project status, scope, and the next useful actions.",
  "/workspace/dashboard": "Analytics across trends, topics, keywords, and track views.",
  "/workspace/chat": "",
  "/workspace/library": "Manage files, folders, and analyzed papers in one place.",
  "/workspace/logs": "Track queued, completed, and failed processing activity.",
  "/workspace/settings": "Adjust the workspace identity and onboarding defaults.",
  "/workspace/profile": "Review the signed-in account and update the profile shown in the workspace.",
};

function DesktopSidebar({
  pathname,
  profile,
  projectName,
  organizationName,
}: {
  pathname: string;
  profile: ReturnType<typeof useWorkspaceProfile>["profile"];
  projectName: string;
  organizationName: string;
}) {
  return (
    <aside className="group fixed inset-y-0 left-0 z-40 hidden w-[68px] overflow-hidden border-r border-[#262626] bg-[#161616] transition-[width] duration-200 ease-out hover:w-[248px] lg:block">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-3 py-4">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-[#1f9d63] text-white">
            <LogoMarkIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 overflow-hidden opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <p className="truncate text-base font-semibold text-[#f2f2f2]">
              Papertrend
            </p>
            <p className="truncate text-sm text-[#8f8f8f]">
              Project workspace
            </p>
          </div>
        </div>

        <div className="border-b border-[#262626] px-3 pb-4">
          <div className="rounded-2xl border border-transparent px-1 py-1 transition-colors group-hover:border-[#2f2f2f] group-hover:bg-[#1d1d1d]">
            <div className="flex items-start gap-3 px-2 py-2">
              <span className="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-[#2f2f2f] bg-[#202020]">
                <HomeIcon className="h-4 w-4 text-[#8f8f8f]" />
              </span>
              <div className="min-w-0 overflow-hidden opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <p className="truncate text-sm font-medium text-[#ececec]">
                  {projectName || profile.name}
                </p>
                <p className="truncate text-sm text-[#8f8f8f]">
                  {organizationName || profile.organization}
                </p>
                <p className="mt-1 truncate text-xs uppercase tracking-[0.16em] text-[#6f6f6f]">
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
                    ? "bg-[#2b2b2b] text-[#f2f2f2]"
                    : "text-[#9a9a9a] hover:bg-[#202020] hover:text-[#ececec]"
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

        <div className="border-t border-[#262626] px-3 py-4">
          <Link
            href="/workspace/library"
            className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-[#9a9a9a] transition-colors hover:bg-[#202020] hover:text-[#ececec]"
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl">
              <PlusIcon className="h-5 w-5" />
            </span>
            <span className="overflow-hidden whitespace-nowrap text-sm font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              Add to library
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
  projectName,
  organizationName,
  onClose,
}: {
  pathname: string;
  profile: ReturnType<typeof useWorkspaceProfile>["profile"];
  projectName: string;
  organizationName: string;
  onClose: () => void;
}) {
  return (
    <div className="h-full max-w-[264px] overflow-y-auto border-r border-[#262626] bg-[#161616]">
      <div className="sticky top-0 flex items-center justify-between border-b border-[#262626] bg-[#161616] px-4 py-4">
        <p className="text-sm font-medium text-[#ececec]">
          Workspace menu
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[#353535] bg-[#232323] p-2 text-[#d0d0d0]"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-5 px-4 py-5">
        <div className="rounded-2xl border border-[#2f2f2f] bg-[#202020] px-4 py-4">
          <p className="text-sm font-medium text-[#ececec]">
            {projectName || profile.name}
          </p>
          <p className="mt-1 text-sm text-[#8f8f8f]">
            {organizationName || profile.organization}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#6f6f6f]">
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
                    ? "bg-[#2b2b2b] text-[#f2f2f2]"
                    : "text-[#c7c7c7] hover:bg-[#232323] hover:text-[#ececec]"
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
    currentOrganization,
    currentProject,
    hasActiveProject,
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
    <div className="min-h-screen bg-[#171717] text-slate-100">
      <DesktopSidebar
        pathname={pathname}
        profile={profile}
        projectName={currentProject?.name ?? ""}
        organizationName={currentOrganization?.name ?? ""}
      />

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 lg:hidden">
          <MobileSidebar
            pathname={pathname}
            profile={profile}
            projectName={currentProject?.name ?? ""}
            organizationName={currentOrganization?.name ?? ""}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      ) : null}

      <div className="min-h-screen lg:pl-[68px]">
        <header className="sticky top-0 z-30 border-b border-[#2c2c2c] bg-[#171717]/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex items-center justify-center rounded-lg border border-[#353535] bg-[#232323] p-2 text-[#d0d0d0] lg:hidden"
                aria-label="Open workspace navigation"
              >
                <MenuIcon className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6f6f]">
                  {currentItem.label}
                </p>
                {PAGE_DESCRIPTIONS[currentItem.href] ? (
                  <p className="mt-1 truncate text-sm text-[#b8b8b8]">
                    {PAGE_DESCRIPTIONS[currentItem.href]}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <AuthStatus />
              <ThemeToggle />
              <Link
                href="/workspace/library"
                className="inline-flex items-center gap-2 rounded-lg bg-[#ececec] px-4 py-2.5 text-sm font-medium text-[#171717] transition-colors hover:bg-white"
              >
                <PlusIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Add to library</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="min-w-0 px-3 py-5 sm:px-6 sm:py-6">
          {hasActiveProject ? (
            children
          ) : (
            <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
              <div className="w-full rounded-[28px] border border-[#2c2c2c] bg-[#1b1b1b] px-8 py-10 text-center">
                <p className="text-sm font-medium text-[#8f8f8f]">Workspace setup</p>
                <h1 className="mt-3 text-3xl font-semibold text-white">
                  Select a project to open the workspace
                </h1>
                <p className="mt-4 text-sm leading-7 text-[#a3a3a3]">
                  Projects now sit inside organizations. Pick one to continue into
                  the library, dashboard, chat, and analysis workspace.
                </p>
                <Link
                  href="/organizations"
                  className="mt-8 inline-flex items-center rounded-xl bg-[#1f9d63] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#198451]"
                >
                  Open organizations
                </Link>
              </div>
            </div>
          )}
        </main>

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
