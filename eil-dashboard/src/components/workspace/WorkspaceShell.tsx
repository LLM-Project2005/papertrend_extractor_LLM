"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "@/components/theme/ThemeToggle";
import {
  ChartIcon,
  ChatIcon,
  CloseIcon,
  FileIcon,
  FolderIcon,
  HomeIcon,
  LogoMarkIcon,
  MenuIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/Icons";
import { useIngestionRuns } from "@/hooks/useIngestionRuns";
import { persistWorkspaceRoute } from "@/lib/workspace-session";
import AnalysisStatusCard from "@/components/workspace/AnalysisStatusCard";
import WorkspaceGlobalSearch from "@/components/workspace/WorkspaceGlobalSearch";
import WorkspaceProfileMenu from "@/components/workspace/WorkspaceProfileMenu";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
};

type WorkspaceNavSection = {
  id: string;
  label: string;
  items: WorkspaceNavItem[];
};

const NAV_SECTIONS: WorkspaceNavSection[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { href: "/workspace/home", label: "Project Overview", icon: HomeIcon },
      { href: "/workspace/dashboard", label: "Dashboard", icon: ChartIcon },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { href: "/workspace/chat", label: "Chat", icon: ChatIcon },
      { href: "/workspace/library", label: "Library", icon: FolderIcon },
      { href: "/workspace/logs", label: "History", icon: FileIcon },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [{ href: "/workspace/settings", label: "Settings", icon: SettingsIcon }],
  },
];

const SEARCH_PAGE_ITEMS = [
  {
    id: "organizations",
    label: "Start page",
    description: "Return to organizations and switch workspace context",
    href: "/organizations",
    icon: HomeIcon,
    keywords: ["organizations", "home", "homepage", "start"],
    featured: true,
  },
  {
    id: "project-overview",
    label: "Project Overview",
    description: "Open the project home and status view",
    href: "/workspace/home",
    icon: HomeIcon,
    keywords: ["overview", "home", "project"],
    featured: true,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Open research trends and analytics",
    href: "/workspace/dashboard",
    icon: ChartIcon,
    keywords: ["analytics", "trends", "insights"],
    featured: true,
  },
  {
    id: "chat",
    label: "Chat",
    description: "Open grounded research chat",
    href: "/workspace/chat",
    icon: ChatIcon,
    keywords: ["assistant", "conversation", "qa"],
    featured: true,
  },
  {
    id: "library",
    label: "Library",
    description: "Manage files, imports, and analyzed papers",
    href: "/workspace/library",
    icon: FolderIcon,
    keywords: ["papers", "files", "imports", "documents"],
    featured: true,
  },
  {
    id: "logs",
    label: "Analysis History",
    description: "Browse previous analysis runs and revisit files",
    href: "/workspace/logs",
    icon: FileIcon,
    keywords: ["history", "analysis", "jobs", "processing"],
    featured: true,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Adjust workspace preferences and identity",
    href: "/workspace/settings",
    icon: SettingsIcon,
    keywords: ["preferences", "configuration"],
  },
  {
    id: "profile",
    label: "Profile",
    description: "Manage your account details",
    href: "/workspace/profile",
    icon: UserIcon,
    keywords: ["account", "user"],
  },
];

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

function WorkspaceBreadcrumb({
  organizationName,
  organizationId,
  projectName,
}: {
  organizationName: string;
  organizationId: string | null;
  projectName: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-[#9b9b9b]">
        <Link
          href={organizationId ? `/organizations/${organizationId}/projects` : "/organizations"}
          className="truncate font-medium text-slate-700 transition-colors hover:text-slate-900 dark:text-[#d9d9d9] dark:hover:text-white"
        >
          {organizationName || "Organizations"}
        </Link>
        <span className="text-slate-300 dark:text-[#4f4f4f]">&gt;</span>
        <span className="truncate text-slate-500 dark:text-[#9b9b9b]">
          {projectName || "Select project"}
        </span>
      </div>
    </div>
  );
}

function DesktopSidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="group fixed inset-y-0 left-0 top-16 z-30 hidden w-[60px] overflow-hidden border-r border-slate-200 bg-white transition-[width] duration-200 ease-out hover:w-[220px] dark:border-[#222222] dark:bg-[#0f0f10] lg:block">
      <div className="flex h-full flex-col py-3">
        <nav className="flex-1 overflow-y-auto px-2">
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div
              key={section.id}
              className={sectionIndex === 0 ? "" : "mt-4 border-t border-slate-200 pt-4 dark:border-[#222222]"}
            >
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:text-[#5f5f5f]">
                {section.label}
              </p>
              <div className="mt-2 space-y-1">
                {section.items.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`mx-auto flex h-11 w-11 items-center justify-center rounded-xl text-sm transition-all duration-200 group-hover:mx-0 group-hover:w-full group-hover:justify-start group-hover:px-3 ${
                        isActive
                          ? "bg-slate-900 text-white dark:bg-[#262626]"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-[#8e8e8e] dark:hover:bg-[#1a1a1a] dark:hover:text-white"
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px] flex-none" />
                      <span className="ml-3 hidden whitespace-nowrap text-sm font-medium group-hover:block">
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}

function MobileSidebar({
  pathname,
  organizationName,
  organizationId,
  projectName,
  onClose,
}: {
  pathname: string;
  organizationName: string;
  organizationId: string | null;
  projectName: string;
  onClose: () => void;
}) {
  return (
    <div className="h-full w-full max-w-[260px] overflow-y-auto border-r border-slate-200 bg-white dark:border-[#222222] dark:bg-[#0f0f10]">
      <div className="sticky top-0 border-b border-slate-200 bg-white px-4 py-4 dark:border-[#222222] dark:bg-[#0f0f10]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f9d63] text-white">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <WorkspaceBreadcrumb
              organizationName={organizationName}
              organizationId={organizationId}
              projectName={projectName}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 dark:border-[#303030] dark:bg-[#181818] dark:text-[#d0d0d0]"
            aria-label="Close workspace navigation"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="space-y-4 px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id}>
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#5f5f5f]">
              {section.label}
            </p>
            <div className="mt-2 space-y-1">
              {section.items.map((item) => {
                const isActive = pathname.startsWith(item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "bg-slate-900 text-white dark:bg-[#262626]"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-[#c7c7c7] dark:hover:bg-[#1a1a1a] dark:hover:text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-none" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
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
    currentOrganization,
    currentProject,
    hasActiveProject,
    analysisSession,
    setAnalysisMinimized,
    removeAnalysisRunIds,
    clearAnalysisSession,
  } = useWorkspaceProfile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isChatPage = pathname.startsWith("/workspace/chat");
  const {
    runs,
    folderJob,
    cancelRuns,
    cancelAllActiveRuns,
    retryActiveProcessing,
    startQueuedProcessing,
    debugClearQueue,
    refresh,
  } =
    useIngestionRuns({
    enabled: Boolean(analysisSession?.runIds.length),
    folderJobId: analysisSession?.folderJobId ?? undefined,
    pollIntervalMs: 8000,
  });

  useEffect(() => {
    persistWorkspaceRoute(pathname);
  }, [pathname]);

  const activeRuns = analysisSession
    ? runs.filter((run) => analysisSession.runIds.includes(run.id))
    : [];

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
    try {
      const canceledRuns = await cancelAllActiveRuns(analysisSession?.folderJobId ?? undefined);
      if (canceledRuns.length > 0) {
        removeAnalysisRunIds(canceledRuns.map((run) => run.id));
      }
    } catch (error) {
      console.error("[workspace] failed to cancel all runs", {
        folderJobId: analysisSession?.folderJobId ?? null,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  async function handleRetryQueue() {
    try {
      await retryActiveProcessing(analysisSession?.folderJobId ?? undefined);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to retry processing.";
      console.error("[workspace] failed to retry processing", {
        folderJobId: analysisSession?.folderJobId ?? null,
        error: message,
      });
      if (typeof window !== "undefined") {
        window.alert(message);
      }
    }
  }

  async function handleStartProcessing() {
    try {
      await startQueuedProcessing(analysisSession?.folderJobId ?? undefined);
      await refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start queued processing.";
      console.error("[workspace] failed to start queued processing", {
        folderJobId: analysisSession?.folderJobId ?? null,
        error: message,
      });
      if (typeof window !== "undefined") {
        window.alert(message);
      }
    }
  }

  async function handleDebugClearQueue() {
    try {
      await debugClearQueue(analysisSession?.folderJobId ?? undefined);
      clearAnalysisSession();
      await refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to clear the worker queue.";
      console.error("[workspace] failed to debug-clear queue", {
        folderJobId: analysisSession?.folderJobId ?? null,
        error: message,
      });
      if (typeof window !== "undefined") {
        window.alert(message);
      }
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#111214] dark:text-slate-100">
      <DesktopSidebar pathname={pathname} />

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 lg:hidden">
          <MobileSidebar
            pathname={pathname}
            organizationName={currentOrganization?.name ?? ""}
            organizationId={currentOrganization?.id ?? null}
            projectName={currentProject?.name ?? ""}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      ) : null}

      <div className="min-h-screen lg:pl-[60px]">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-[#222222] dark:bg-[#0f0f10]/95">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 dark:border-[#303030] dark:bg-[#181818] dark:text-[#d0d0d0] lg:hidden"
                aria-label="Open workspace navigation"
              >
                <MenuIcon className="h-4 w-4" />
              </button>

              <Link
                href="/organizations"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f9d63] text-white transition-transform hover:scale-[1.02]"
                aria-label="Go to start page"
              >
                <LogoMarkIcon className="h-5 w-5" />
              </Link>

              <WorkspaceBreadcrumb
                organizationName={currentOrganization?.name ?? ""}
                organizationId={currentOrganization?.id ?? null}
                projectName={currentProject?.name ?? ""}
              />
            </div>

            <div className="order-3 w-full min-w-0 lg:order-2 lg:max-w-[560px] lg:flex-1">
              <WorkspaceGlobalSearch pageItems={SEARCH_PAGE_ITEMS} />
            </div>

            <div className="ml-auto flex items-center gap-2 lg:order-3">
              <ThemeToggle compact />
              <WorkspaceProfileMenu />
            </div>
          </div>
        </header>

        <main className={isChatPage ? "min-w-0" : "min-w-0 px-4 py-5 sm:px-6 sm:py-6"}>
          {hasActiveProject ? (
            children
          ) : (
            <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
              <div className="w-full rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center dark:border-[#2c2c2c] dark:bg-[#1b1b1b]">
                <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">Workspace setup</p>
                <h1 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">
                  Select a project to open the workspace
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-[#a3a3a3]">
                  Projects sit inside organizations. Pick one to continue into the
                  overview, dashboard, chat, library, and analysis history.
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
        (analysisSession.minimized ||
          !ALL_NAV_ITEMS.some((item) => pathname.startsWith(item.href)) ||
          pathname !== "/workspace/home") ? (
          <div className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))]">
            <AnalysisStatusCard
              runs={activeRuns}
              folderJob={folderJob}
              compact
              onExpand={() => setAnalysisMinimized(false)}
              onClear={clearAnalysisSession}
              onCancelRun={handleCancelRun}
              onCancelAll={handleCancelAllRuns}
              onRetryQueue={handleRetryQueue}
              onStartProcessing={handleStartProcessing}
              onDebugClearQueue={handleDebugClearQueue}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
