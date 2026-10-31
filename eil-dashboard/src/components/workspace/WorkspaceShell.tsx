"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import ThemeToggle from "@/components/theme/ThemeToggle";
import {
  BookOpenIcon,
  ChartIcon,
  ChatIcon,
  CloseIcon,
  FolderIcon,
  HomeIcon,
  LogoMarkIcon,
  MenuIcon,
  SettingsIcon,
  StackIcon,
  TableIcon,
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
import RepositorySwitcher from "@/components/workspace/RepositorySwitcher";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { AnalysisRunsContext } from "@/components/workspace/AnalysisRunsContext";
import WorkspaceTabTitle from "@/components/workspace/WorkspaceTabTitle";
import KeyboardShortcuts, { openKeyboardShortcuts } from "@/components/workspace/KeyboardShortcuts";
import { useDialogLayer } from "@/components/ui/Modal";
import { useIsNarrow } from "@/lib/use-narrow";
import { buttonClass, selectedClass } from "@/components/ui/controls";
import { useAnalysisRunActions } from "@/components/workspace/useAnalysisRunActions";

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
      { href: "/workspace/home", label: "Home", icon: HomeIcon },
      { href: "/workspace/dashboard", label: "Dashboard", icon: ChartIcon },
    ],
  },
  {
    id: "project",
    label: "Repository",
    items: [
      { href: "/workspace/chat", label: "Chat", icon: ChatIcon },
      // The paper table (docs/42): the papers against the reader's own columns.
      { href: "/workspace/table", label: "Table", icon: TableIcon },
      // The file browser. Every other screen already called it the Library;
      // only this entry said "Repositories", the name of the picker at
      // /workspaces, so one word named two different pages.
      { href: "/workspace/library", label: "Library", icon: FolderIcon },
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
    // Not Home's icon: the picker and Home are different places (UI audit C19).
    icon: StackIcon,
    keywords: ["switch repository", "change repository", "repository picker", "switch project", "change project", "project picker", "projects", "start"],
    featured: true,
  },
  {
    id: "project-overview",
    label: "Home",
    description: "The repository's overview, recent papers and progress",
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
    keywords: [
      "assistant", "conversation", "qa", "ai chat", "deep research", "deep agent", "research agent", "research plan", "report",
      "chart mode", "chart", "graph", "visualize", "visualise", "plot", "กราฟ", "แผนภูมิ", "web search",
    ],
    featured: true,
  },
  {
    id: "table",
    label: "Table",
    description: "Lay the papers out against your own columns, each cell with its sentence",
    href: "/workspace/table",
    icon: TableIcon,
    keywords: ["table", "extract", "extraction", "data extraction", "columns", "compare papers", "matrix", "spreadsheet", "literature table", "ตาราง"],
    featured: true,
  },
  {
    id: "library",
    label: "Library",
    description: "Browse, rename and restore the papers in each repository",
    href: "/workspace/library",
    icon: FolderIcon,
    keywords: ["papers", "files", "imports", "documents", "upload", "analyze paper", "search library", "paper detail"],
    featured: true,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Adjust repository preferences and identity",
    href: "/workspace/settings?section=repository",
    icon: SettingsIcon,
    keywords: ["preferences", "configure", "configure repository", "configuration", "repository settings", "project settings", "settings"],
  },
  {
    id: "profile",
    label: "Profile",
    description: "Manage your name, picture and sign-in",
    href: "/workspace/settings?section=profile",
    icon: UserIcon,
    keywords: ["profile", "account", "user", "avatar", "profile settings"],
  },
];

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

/** How long a client navigation may take before the page is loaded afresh. */
export const STUCK_NAVIGATION_MS = 12_000;

/** Pages that work without a chosen repository. */
const PROJECT_OPTIONAL_ROUTES = ["/workspace/settings"];

function WorkspaceBreadcrumb({
  onNavigate,
  onDone,
}: {
  onNavigate?: (href: string) => void;
  /** After a repository is chosen: the phone drawer closes. */
  onDone?: () => void;
}) {
  return (
    <div className="min-w-0">
      {/* Both halves used to truncate, and on a 390px header sharing space with six
          other controls neither survived - the breadcrumb read "Rep... > T...",
          which tells a reader nothing at all.
          Below sm the parent collapses to a back arrow rather than disappearing:
          this link is the only route back to the repository picker, since the
          drawer's "Library" entry points at /workspace/library instead. */}
      <div className="flex min-w-0 items-center gap-2 text-sm text-mute">
        <Link
          href="/workspaces"
          onClick={() => onNavigate?.("/workspaces")}
          prefetch={false}
          aria-label="All repositories"
          className="-my-2 flex flex-none items-center rounded px-2 py-2 font-medium text-ink transition-colors hover:text-ink"
        >
          {/* The repositories icon, as on the switcher's "All repositories": a
              back arrow here read as "back a page" (UI audit C18). */}
          <StackIcon className="h-4 w-4 sm:hidden" />
          <span className="hidden sm:inline">Repositories</span>
        </Link>
        {/* A separator glyph, not content: a screen reader should step over it
            rather than announce "greater than" between the two names. Marking it
            decorative is also what exempts it from the text-contrast rule it
            would otherwise fail at 1.48:1. */}
        <span aria-hidden="true" className="hidden flex-none text-hairline-strong sm:inline">
          &gt;
        </span>
        {/* The name opens the list of repositories, to switch without going to /workspaces. */}
        <RepositorySwitcher onNavigate={onNavigate} onDone={onDone} />
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
    // The rail opens at once rather than animating its width (UI audit #13: no
    // width/margin/padding animation); its section names still fade in.
    <aside className="group fixed bottom-0 left-0 top-16 z-30 hidden w-14 overflow-hidden border-r border-hairline bg-surface transition-shadow duration-150 ease-out hover:w-[216px] hover:shadow-float has-[:focus-visible]:w-[216px] has-[:focus-visible]:shadow-float lg:block">
      <div className="flex h-full flex-col py-2">
        <nav className="flex-1 overflow-y-auto px-2">
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div
              key={section.id}
              className={sectionIndex === 0 ? "" : "mt-3 border-t border-hairline pt-3"}
            >
              <p className="whitespace-nowrap px-3 text-xs font-medium text-mute opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
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
                      className={`mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-sm transition-colors duration-150 group-hover:mx-0 group-hover:w-full group-hover:justify-start group-hover:px-3 group-has-[:focus-visible]:mx-0 group-has-[:focus-visible]:w-full group-has-[:focus-visible]:justify-start group-has-[:focus-visible]:px-3 ${
                        isActive
                          // "You are here", not the primary button's ink fill: a
                          // soft fill and an ink bar, which carries it in dark mode
                          // (UI audit #22).
                          ? selectedClass
                          : "text-mute hover:bg-subtle hover:text-ink"
                      }`}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon className="h-[18px] w-[18px] flex-none" weight={isActive ? "fill" : "regular"} />
                      {/* sr-only rather than hidden: the name stays readable to
                          assistive technology while the rail is collapsed. */}
                      <span className="sr-only ml-3 whitespace-nowrap text-sm font-medium group-hover:not-sr-only group-has-[:focus-visible]:not-sr-only">
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
  onClose,
  onNavigate,
}: {
  pathname: string;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <div className="h-full w-full max-w-[280px] overflow-y-auto border-r border-hairline bg-surface shadow-overlay motion-safe:animate-drawer-in">
      <div className="sticky top-0 border-b border-hairline bg-surface px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <span className="flex h-10 w-10 items-center justify-center text-ink">
              <LogoMarkIcon className="h-7 w-7" />
            </span>
            <WorkspaceBreadcrumb
              onNavigate={onNavigate}
              onDone={onClose}
            />
          </div>
          <button
            type="button"
            autoFocus
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
                        // Matches the rail: the selected look, not the ink fill.
                        ? selectedClass
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
    clearAnalysisSession,
  } = useWorkspaceProfile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // The drawer is a dialog layer below lg: Escape closes it when it is on top,
  // Tab stays inside, and closing it puts focus back on the menu button.
  const drawerIsOverlay = useIsNarrow(1024);
  useDialogLayer(sidebarOpen && drawerIsOverlay, drawerRef, () => setSidebarOpen(false));
  const [navigating, setNavigating] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const isChatPage = pathname.startsWith("/workspace/chat");
  // Settings hold the account and admin pages, which need no repository; the
  // repository gate hid them from anyone without one (docs/32, 2.11, AUTH-5).
  const projectOptional = PROJECT_OPTIONAL_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
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
    // The query too: a paper, a tab or a filter in the address comes back
    // with the reader after they sign in (docs/32, 2.11, SHELL-5a).
    const returnTo = encodeURIComponent(`${pathname || "/workspace/home"}${window.location.search}`);
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
  // The one poller for the followed runs; pages read it through the context.
  const analysisRuns = useIngestionRuns({
    enabled: Boolean(analysisSession?.runIds.length),
    folderJobId: analysisSession?.folderJobId ?? undefined,
    runIds: analysisSession?.runIds,
    pollIntervalMs: 3000,
    onUnauthorized: handleAnalysisUnauthorized,
  });
  const { runs, folderJob } = analysisRuns;

  useEffect(() => {
    persistWorkspaceRoute(pathname);
    setNavigating(false);
    setPendingHref(null);
  }, [pathname]);

  // A last resort for a client navigation that never commits. At 1.5 seconds
  // it reloaded the whole page on any slow load - a phone on a weak network, a
  // server waking up - so the page loaded twice and lost its state (docs/32,
  // 3.2; audit SHELL-6). It now waits long enough to mean "stuck".
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
    }, STUCK_NAVIGATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [navigating, pendingHref]);

  const activeRuns = analysisSession
    ? runs.filter((run) => analysisSession.runIds.includes(run.id))
    : [];

  // Cancel, retry and start: one set of handlers with Home, and a failure
  // shows beside the tray instead of in the console or an alert() (UI audit #7).
  const runActions = useAnalysisRunActions(analysisRuns, "workspace");

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-overlay"
      >
        Skip to content
      </a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-hairline bg-canvas/80 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              ref={menuButtonRef}
              onClick={() => setSidebarOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-body transition-colors hover:bg-subtle hover:text-ink lg:hidden"
              aria-label="Open workspace navigation"
              aria-expanded={sidebarOpen}
            >
              <MenuIcon className="h-4 w-4" />
            </button>

            <Link
              href="/"
              prefetch={false}
              onClick={() => handleNavigate("/")}
              className="flex h-10 w-10 items-center justify-center text-ink transition-transform hover:scale-[1.04]"
              aria-label="Papertrend front page"
            >
              <LogoMarkIcon className="h-7 w-7" />
            </Link>

            <WorkspaceBreadcrumb onNavigate={handleNavigate} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <WorkspaceGlobalSearch pageItems={SEARCH_PAGE_ITEMS} />
            <Link
              href="/docs/getting-started"
              prefetch={false}
              onClick={() => handleNavigate("/docs/getting-started")}
              className="hidden h-9 items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-medium text-body transition-colors duration-150 hover:bg-subtle hover:text-ink sm:inline-flex"
              aria-label="Docs"
            >
              <BookOpenIcon className="h-4 w-4" />
              <span className="hidden md:inline">Docs</span>
            </Link>
            <ThemeToggle compact />
            <WorkspaceProfileMenu onShowShortcuts={openKeyboardShortcuts} />
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
            className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-ink/10"
          >
            <div className="h-full w-full bg-ink motion-safe:w-1/2 motion-safe:animate-pulse" />
          </div>
        ) : null}
      </header>

      <DesktopSidebar pathname={pathname} onNavigate={handleNavigate} />

      {sidebarOpen ? (
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Workspace navigation"
          className="fixed inset-0 z-50 overscroll-contain bg-black/40 motion-safe:animate-fade-in lg:hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSidebarOpen(false);
          }}
        >
          <MobileSidebar
            pathname={pathname}
            onClose={() => setSidebarOpen(false)}
            onNavigate={handleNavigate}
          />
        </div>
      ) : null}

      <div className="min-h-[100dvh] pt-16 lg:pl-14">
        <main
          id="main"
          tabIndex={-1}
          className={isChatPage ? "min-w-0 outline-none" : "workspace-content-enter min-w-0 px-4 py-6 outline-none sm:px-8 sm:py-8"}
        >
          {!authHydrated || !user || workspaceLoading ? (
            <WorkspaceLoadingState />
          ) : hasActiveProject || projectOptional ? (
            <AnalysisRunsContext.Provider value={analysisRuns}>{children}</AnalysisRunsContext.Provider>
          ) : (
            <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
              <div className="w-full text-center">
                <FolderIcon className="mx-auto h-7 w-7 text-mute" />
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
                  Choose a repository
                </h1>
                <p className="mt-2 text-sm leading-6 text-body">
                  Each repository keeps its own papers, dashboard and chat. Pick one to open, or
                  create a new one.
                </p>
                <Link href="/workspaces" className={buttonClass("primary", "md", "mt-6")}>
                  Open repositories
                </Link>
              </div>
            </div>
          )}
        </main>

        <WorkspaceTabTitle runs={activeRuns} />
        <KeyboardShortcuts />

        {analysisSession &&
        (analysisSession.minimized ||
          !ALL_NAV_ITEMS.some((item) => pathname.startsWith(item.href)) ||
          pathname !== "/workspace/home") ? (
          // tray-dock: above the chat composer on the chat page, in the corner elsewhere.
          <div className="tray-dock pointer-events-none fixed inset-x-3 z-40 flex justify-end sm:inset-x-auto sm:right-5">
            {statusPanelOpen ? (
              <div className="w-full space-y-2 sm:w-[400px]">
                {runActions.notice ? <div className="pointer-events-auto shadow-float">{runActions.notice}</div> : null}
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
                  onCancelRun={runActions.onCancelRun}
                  onCancelAll={runActions.onCancelAll}
                  onRetryQueue={runActions.onRetryQueue}
                  onStartProcessing={runActions.onStartProcessing}
                />
              </div>
            ) : (
              <AnalysisTrayPill runs={activeRuns} onOpen={() => setStatusPanelOpen(true)} onClear={clearAnalysisSession} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
