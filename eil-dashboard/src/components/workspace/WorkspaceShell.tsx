"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import ThemeToggle from "@/components/theme/ThemeToggle";
import {
  ArrowRightIcon,
  BookOpenIcon,
  ChartIcon,
  ChatIcon,
  CloseIcon,
  FolderIcon,
  HomeIcon,
  LogoMarkIcon,
  MenuIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/Icons";
import type { IconProps } from "@/components/ui/Icons";
import { useIngestionRuns } from "@/hooks/useIngestionRuns";
import { useLongTaskLogger } from "@/hooks/useLongTaskLogger";
import {
  ANALYSIS_SESSION_STORAGE_KEY,
  persistWorkspaceRoute,
} from "@/lib/workspace-session";
import AnalysisStatusCard, { AnalysisTrayPill } from "@/components/workspace/AnalysisStatusCard";
import WorkspaceGlobalSearch from "@/components/workspace/WorkspaceGlobalSearch";
import WorkspaceLoadingState from "@/components/workspace/WorkspaceLoadingState";
import WorkspaceProfileMenu from "@/components/workspace/WorkspaceProfileMenu";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";

type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: (props: IconProps) => JSX.Element;
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
      { href: "/workspace/home", label: "Repository Overview", icon: HomeIcon },
      { href: "/workspace/dashboard", label: "Dashboard", icon: ChartIcon },
    ],
  },
  {
    id: "project",
    label: "Repository",
    items: [
      { href: "/workspace/chat", label: "Chat", icon: ChatIcon },
      { href: "/workspace/library", label: "Repositories", icon: FolderIcon },
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
    id: "projects",
    // This and the "library" entry below were both labelled "Repositories",
    // pointing at different pages, in the same command palette - a reader saw the
    // same word twice and had to read the descriptions to guess which was which.
    label: "Switch repository",
    description: "Switch between research repositories",
    href: "/workspaces",
    icon: HomeIcon,
    keywords: ["switch repository", "repository picker", "project picker", "projects", "home", "start"],
    featured: true,
  },
  {
    id: "project-overview",
    label: "Repository Overview",
    description: "Open the repository home and status view",
    href: "/workspace/home",
    icon: HomeIcon,
    keywords: ["overview", "home", "repository", "project", "activity", "status", "recent papers"],
    featured: true,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Open research trends and analytics",
    href: "/workspace/dashboard",
    icon: ChartIcon,
    keywords: ["analytics", "trends", "insights", "adaptive dashboard", "topic chart", "keyword chart", "tracks"],
    featured: true,
  },
  {
    id: "chat",
    label: "Chat",
    description: "Open grounded research chat",
    href: "/workspace/chat",
    icon: ChatIcon,
    keywords: ["assistant", "conversation", "qa", "ai chat", "deep research", "deep agent", "chart mode", "web search"],
    featured: true,
  },
  {
    id: "library",
    label: "Repositories",
    description: "Browse account repositories and analyzed papers",
    href: "/workspace/library",
    icon: FolderIcon,
    keywords: ["papers", "files", "imports", "documents", "upload", "analyze paper", "search library", "paper detail"],
    featured: true,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Adjust repository preferences and identity",
    href: "/workspace/settings",
    icon: SettingsIcon,
    keywords: ["preferences", "configuration", "repository settings", "project settings", "settings"],
  },
  {
    id: "profile",
    label: "Profile",
    description: "Manage your name, picture and sign-in",
    href: "/workspace/settings?section=profile",
    icon: UserIcon,
    keywords: ["account", "user", "avatar", "profile settings"],
  },
];

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

function WorkspaceBreadcrumb({
  projectName,
  onNavigate,
}: {
  projectName: string;
  onNavigate?: (href: string) => void;
}) {
  return (
    <div className="min-w-0">
      {/* Both halves used to truncate, and on a 390px header sharing space with six
          other controls neither survived - the breadcrumb read "Rep... > T...",
          which tells a reader nothing at all.
          Below sm the parent collapses to a back arrow rather than disappearing:
          this link is the only route back to the repository picker, since the
          drawer's "Repositories" entry points at /workspace/library instead. */}
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-500 dark:text-[#9b9b9b]">
        <Link
          href="/workspaces"
          onClick={() => onNavigate?.("/workspaces")}
          prefetch={false}
          aria-label="All repositories"
          className="-my-2 flex flex-none items-center rounded px-2 py-2 font-medium text-slate-700 transition-colors hover:text-slate-900 dark:text-[#d9d9d9] dark:hover:text-white"
        >
          <ArrowRightIcon className="h-4 w-4 rotate-180 sm:hidden" />
          <span className="hidden sm:inline">Repositories</span>
        </Link>
        {/* A separator glyph, not content: a screen reader should step over it
            rather than announce "greater than" between the two names. Marking it
            decorative is also what exempts it from the text-contrast rule it
            would otherwise fail at 1.48:1. */}
        <span aria-hidden="true" className="hidden flex-none text-slate-300 dark:text-[#4f4f4f] sm:inline">
          &gt;
        </span>
        <span className="min-w-0 truncate text-slate-500 dark:text-[#9b9b9b]">
          {projectName || "Select repository"}
        </span>
      </div>
    </div>
  );
}

function DesktopSidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <aside className="group fixed bottom-0 left-0 top-16 z-30 hidden w-14 overflow-hidden border-r border-hairline bg-surface transition-[width,box-shadow] duration-250 ease-out-expo hover:w-[216px] hover:shadow-float lg:block">
      <div className="flex h-full flex-col py-2">
        <nav className="flex-1 overflow-y-auto px-2">
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div
              key={section.id}
              className={sectionIndex === 0 ? "" : "mt-3 border-t border-hairline pt-3"}
            >
              <p className="whitespace-nowrap px-3 text-xs font-medium text-mute opacity-0 transition-opacity duration-150 group-hover:opacity-100">
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
                      prefetch={false}
                      onClick={() => onNavigate(item.href)}
                      className={`mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-sm transition-[background-color,color,width,margin,padding] duration-200 ease-out-quart group-hover:mx-0 group-hover:w-full group-hover:justify-start group-hover:px-3 ${
                        isActive
                          // #111111 on the rail's #050505 surface is 1.08:1 - the
                          // chip was there in the markup and absent to the eye.
                          // #1f1f1f is the brand's own raised tone and reads.
                          ? "bg-slate-900 text-white dark:bg-[#1f1f1f]"
                          : "text-mute hover:bg-subtle hover:text-ink"
                      }`}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon className="h-[18px] w-[18px] flex-none" weight={isActive ? "fill" : "regular"} />
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
  projectName,
  onClose,
  onNavigate,
}: {
  pathname: string;
  projectName: string;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <div className="h-full w-full max-w-[280px] overflow-y-auto border-r border-hairline bg-surface shadow-overlay motion-safe:animate-drawer-in">
      <div className="sticky top-0 border-b border-hairline bg-surface px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <span className="flex h-10 w-10 items-center justify-center text-slate-950 dark:text-white">
              <LogoMarkIcon className="h-7 w-7" />
            </span>
            <WorkspaceBreadcrumb
              projectName={projectName}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-mute transition-colors hover:bg-subtle hover:text-ink"
            aria-label="Close workspace navigation"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="space-y-4 px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id}>
            <p className="px-3 text-xs font-medium text-mute">
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
                    prefetch={false}
                    onClick={() => {
                      onNavigate(item.href);
                      onClose();
                    }}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        // #030303 is darker than the drawer's own #050505 surface,
                        // so the "you are here" chip was not merely invisible, it
                        // was inverted. Matches the rail's active tone.
                        ? "bg-slate-900 text-white dark:bg-[#1f1f1f]"
                        : "text-body hover:bg-subtle hover:text-ink"
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-none" weight={isActive ? "fill" : "regular"} />
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
  useLongTaskLogger("workspace");
  const pathname = usePathname();
  const router = useRouter();
  const { hydrated: authHydrated, user } = useAuth();
  const {
    currentProject,
    hasActiveProject,
    workspaceLoading,
    analysisSession,
    setAnalysisMinimized,
    removeAnalysisRunIds,
    clearAnalysisSession,
  } = useWorkspaceProfile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const isChatPage = pathname.startsWith("/workspace/chat");
  // A new upload opens the progress card, so the reader who just added papers
  // from the Library or Chat sees them start instead of a small badge.
  const analysisSessionKey = analysisSession?.runIds.join(",") ?? "";
  const seenAnalysisSessionKeyRef = useRef(analysisSessionKey);
  useEffect(() => {
    if (analysisSessionKey && analysisSessionKey !== seenAnalysisSessionKeyRef.current) {
      setStatusPanelOpen(true);
    }
    seenAnalysisSessionKeyRef.current = analysisSessionKey;
  }, [analysisSessionKey]);

  useEffect(() => {
    if (!authHydrated || user) {
      return;
    }
    const returnTo = encodeURIComponent(pathname || "/workspace/home");
    router.replace(`/login?returnTo=${returnTo}`);
  }, [authHydrated, pathname, router, user]);

  const handleAnalysisUnauthorized = useCallback(() => {
    console.warn("[workspace] clearing stale analysis session after auth rejection");
    clearAnalysisSession();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ANALYSIS_SESSION_STORAGE_KEY);
    }
  }, [clearAnalysisSession]);
  const handleNavigate = useCallback(
    (href: string) => {
      if (href !== pathname) {
        setNavigating(true);
        setPendingHref(href);
      }
    },
    [pathname]
  );
  const {
    runs,
    folderJob,
    cancelRuns,
    cancelAllActiveRuns,
    retryActiveProcessing,
    startQueuedProcessing,
    refresh,
  } =
    useIngestionRuns({
    enabled: Boolean(analysisSession?.runIds.length),
    folderJobId: analysisSession?.folderJobId ?? undefined,
    pollIntervalMs: 3000,
    onUnauthorized: handleAnalysisUnauthorized,
  });

  useEffect(() => {
    persistWorkspaceRoute(pathname);
    setNavigating(false);
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!navigating || !pendingHref) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const targetUrl = new URL(pendingHref, window.location.origin);
      if (window.location.pathname !== targetUrl.pathname) {
        console.warn("[workspace] client navigation did not commit; falling back to document navigation", {
          from: window.location.pathname,
          to: targetUrl.pathname,
        });
        window.location.assign(targetUrl.toString());
        return;
      }

      setNavigating(false);
      setPendingHref(null);
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [navigating, pendingHref]);

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


  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-hairline bg-canvas/80 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-body transition-colors hover:bg-subtle hover:text-ink lg:hidden"
              aria-label="Open workspace navigation"
            >
              <MenuIcon className="h-4 w-4" />
            </button>

            <Link
              href="/"
              prefetch={false}
              onClick={() => handleNavigate("/")}
              className="flex h-10 w-10 items-center justify-center text-slate-950 transition-transform hover:scale-[1.04] dark:text-white"
              aria-label="Go to front page"
            >
              <LogoMarkIcon className="h-7 w-7" />
            </Link>

            <WorkspaceBreadcrumb
              projectName={currentProject?.name ?? ""}
              onNavigate={handleNavigate}
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <WorkspaceGlobalSearch pageItems={SEARCH_PAGE_ITEMS} />
            <Link
              href="/docs"
              prefetch={false}
              onClick={() => handleNavigate("/docs")}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-medium text-body transition-colors duration-150 hover:bg-subtle hover:text-ink"
              aria-label="Open documentation"
            >
              <BookOpenIcon className="h-4 w-4" />
              <span className="hidden md:inline">Docs</span>
            </Link>
            <ThemeToggle compact />
            <WorkspaceProfileMenu />
          </div>
        </div>
        {/*
          The site-wide reduced-motion rule collapses every animation duration,
          so `animate-pulse` on a half-width bar stopped at its last keyframe and
          sat there - a solid bar frozen at 50%, which reads as stalled rather
          than as working. It also had no accessible name at all. Under reduced
          motion it now fills the track, which is a static statement instead of
          an animation that never arrives.
        */}
        {navigating ? (
          <div
            role="status"
            aria-label="Loading page"
            className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-slate-950/10 dark:bg-white/10"
          >
            <div className="h-full w-full bg-slate-950 motion-safe:w-1/2 motion-safe:animate-pulse dark:bg-white" />
          </div>
        ) : null}
      </header>

      <DesktopSidebar pathname={pathname} onNavigate={handleNavigate} />

      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 motion-safe:animate-fade-in lg:hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSidebarOpen(false);
          }}
        >
          <MobileSidebar
            pathname={pathname}
            projectName={currentProject?.name ?? ""}
            onClose={() => setSidebarOpen(false)}
            onNavigate={handleNavigate}
          />
        </div>
      ) : null}

      <div className="min-h-[100dvh] pt-16 lg:pl-14">
        <main className={isChatPage ? "min-w-0" : "workspace-content-enter min-w-0 px-4 py-6 sm:px-8 sm:py-8"}>
          {!authHydrated || !user || workspaceLoading ? (
            <WorkspaceLoadingState />
          ) : hasActiveProject ? (
            children
          ) : (
            <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
              <div className="w-full text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-body">
                  <FolderIcon className="h-5 w-5" />
                </span>
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
                  Choose a repository
                </h1>
                <p className="mt-2 text-sm leading-6 text-body">
                  Each repository keeps its own papers, dashboard and chat. Pick one to open, or
                  create a new one.
                </p>
                <Link
                  href="/workspaces"
                  className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-canvas transition-[background-color,transform] duration-150 hover:bg-ink/85 active:scale-[0.98]"
                >
                  Open repositories
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </div>
          )}
        </main>

        {analysisSession &&
        (analysisSession.minimized ||
          !ALL_NAV_ITEMS.some((item) => pathname.startsWith(item.href)) ||
          pathname !== "/workspace/home") ? (
          <div className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex justify-end sm:inset-x-auto sm:bottom-5 sm:right-5">
            {statusPanelOpen ? (
              <div className="w-full sm:w-[400px]">
                <AnalysisStatusCard
                  runs={activeRuns}
                  folderJob={folderJob}
                  compact
                  onExpand={() => {
                    setAnalysisMinimized(false);
                    if (pathname !== "/workspace/home") {
                      handleNavigate("/workspace/home");
                      router.push("/workspace/home");
                    }
                  }}
                  onCollapse={() => setStatusPanelOpen(false)}
                  onClear={clearAnalysisSession}
                  onCancelRun={handleCancelRun}
                  onCancelAll={handleCancelAllRuns}
                  onRetryQueue={handleRetryQueue}
                  onStartProcessing={handleStartProcessing}
                />
              </div>
            ) : (
              <AnalysisTrayPill runs={activeRuns} onOpen={() => setStatusPanelOpen(true)} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
