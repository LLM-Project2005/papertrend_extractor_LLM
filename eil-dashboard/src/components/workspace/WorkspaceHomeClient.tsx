"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useDashboardData } from "@/hooks/useData";
import { useIngestionRuns } from "@/hooks/useIngestionRuns";
import { WORKSPACE_GOALS, WORKSPACE_SOURCES } from "@/lib/workspace-profile";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import AnalyzeFlowModal from "@/components/workspace/AnalyzeFlowModal";
import AnalysisStatusCard from "@/components/workspace/AnalysisStatusCard";
import {
  ArrowRightIcon,
  ChartIcon,
  ChatIcon,
  CheckCircleIcon,
  CircleIcon,
  PaperIcon,
  UploadIcon,
} from "@/components/ui/Icons";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="app-card px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500 dark:text-[#a3a3a3]">{label}</p>
        <span className="text-slate-400 dark:text-[#8e8e8e]">{icon}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">
        {value}
      </p>
    </article>
  );
}

function QuickLink({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 transition-colors hover:border-slate-300 dark:border-[#2f2f2f] dark:bg-[#171717] dark:hover:border-[#3a3a3a]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-slate-400 dark:text-[#8e8e8e]">{icon}</span>
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">{title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">{description}</p>
        </div>
      </div>
      <ArrowRightIcon className="mt-1 h-4 w-4 flex-none text-slate-300 dark:text-[#666666]" />
    </Link>
  );
}

export default function WorkspaceHomeClient() {
  const {
    profile,
    folders,
    selectedFolderId,
    refreshFolders,
    analysisSession,
    startAnalysisSession,
    setAnalysisMinimized,
    removeAnalysisRunIds,
    clearAnalysisSession,
  } = useWorkspaceProfile();
  const scopedFolderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);
  const { data, loading } = useDashboardData(selectedFolderId, scopedFolderIds);
  const { runs, folderJob, cancelRuns, cancelAllActiveRuns, retryActiveProcessing } =
    useIngestionRuns({
    enabled: Boolean(analysisSession?.runIds.length),
    folderJobId: analysisSession?.folderJobId ?? undefined,
    pollIntervalMs: 8000,
  });
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const selectedFolderLabel =
    selectedFolderId === "all"
      ? "All folders"
      : folders.find((folder) => folder.id === selectedFolderId)?.name ?? "Selected folder";

  const summary = useMemo(() => {
    if (!data) {
      return {
        paperCount: "0",
        topicCount: "0",
        keywordCount: "0",
        yearRange: "No data yet",
      };
    }

    const papers = new Set(data.trends.map((row) => row.paper_id)).size;
    const topics = new Set(data.trends.map((row) => row.topic)).size;
    const keywords = new Set(data.trends.map((row) => row.keyword)).size;
    const years = [...new Set(data.trends.map((row) => row.year))].sort();

    return {
      paperCount: papers.toLocaleString(),
      topicCount: topics.toLocaleString(),
      keywordCount: keywords.toLocaleString(),
      yearRange:
        years.length > 0 ? `${years[0]} to ${years[years.length - 1]}` : "No data yet",
    };
  }, [data]);

  const activeRuns = analysisSession
    ? runs.filter((run) => analysisSession.runIds.includes(run.id))
    : [];

  const activeSource = WORKSPACE_SOURCES.find(
    (source) => source.id === profile.primarySource
  );
  const activeGoal = WORKSPACE_GOALS.find((goal) => goal.id === profile.goal);
  const isPreviewMode = data?.useMock ?? true;
  const hasLiveAnalysisSession =
    Boolean(analysisSession?.runIds.length) && !analysisSession?.minimized;
  const hasCompletedRealData = !isPreviewMode;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("analyze") === "1") {
      setShowAnalyzeModal(true);
    }
  }, []);

  const checklist = [
    {
      title: "Confirm workspace profile",
      detail: "Name, domain, goal, and outputs can all be tuned from Settings.",
      done: profile.onboardingComplete,
    },
    {
      title: "Queue the first analysis run",
      detail: isPreviewMode
        ? "Optional for now. Preview data stays available while the live backend analysis is offline."
        : "Upload PDFs and choose the first source method from Analyze.",
      done: activeRuns.length > 0 || hasCompletedRealData,
    },
    {
      title: "Validate workspace data",
      detail: hasCompletedRealData
        ? "Analytics are reading from the current Supabase-backed dataset."
        : "The workspace will switch away from preview mode after the analysis worker finishes and syncs the results.",
      done: hasCompletedRealData,
    },
  ];

  function handleAnalyzeCreated(
    createdRuns: IngestionRunRow[],
    context: {
      folder: string;
      folderId?: string | null;
      folderJob?: FolderAnalysisJobRow | null;
      sourceKind: string;
    }
  ) {
    startAnalysisSession(createdRuns, context);
    void refreshFolders();
    setShowAnalyzeModal(false);
  }

  async function handleCancelRun(runId: string) {
    try {
      const canceledRuns = await cancelRuns([runId]);
      if (canceledRuns.length > 0) {
        removeAnalysisRunIds(canceledRuns.map((run) => run.id));
      }
    } catch (error) {
      console.error("[workspace.home] failed to cancel run", {
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
      console.error("[workspace.home] failed to cancel all runs", {
        folderJobId: analysisSession?.folderJobId ?? null,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  async function handleRetryQueue() {
    try {
      await retryActiveProcessing(analysisSession?.folderJobId ?? undefined);
    } catch (error) {
      console.error("[workspace.home] failed to retry processing", {
        folderJobId: analysisSession?.folderJobId ?? null,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="app-surface px-6 py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-[#a3a3a3]">
              Workspace overview
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">
              {profile.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-[#a3a3a3]">
              {isPreviewMode
                ? "Preview data is active, so you can keep using analytics, papers, and chat while the live backend analysis process is being fixed."
                : "A clean control center for bringing in papers, reviewing analytics, and switching into grounded chat without bouncing between separate tools."}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-[#6f6f6f]">
              Current scope: {selectedFolderLabel}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowAnalyzeModal(true)}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-[#f3f3f3] dark:text-[#171717] dark:hover:bg-white"
            >
              Analyze
            </button>
            <Link
              href="/workspace/library"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
            >
              Open library
            </Link>
          </div>
        </div>
      </section>

      {hasLiveAnalysisSession ? (
        <AnalysisStatusCard
          runs={activeRuns}
          folderJob={folderJob}
          loading={loading && activeRuns.length === 0}
          onMinimize={() => setAnalysisMinimized(true)}
          onClear={clearAnalysisSession}
          onCancelRun={handleCancelRun}
          onCancelAll={handleCancelAllRuns}
          onRetryQueue={handleRetryQueue}
        />
      ) : null}

      <>
        {isPreviewMode ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Preview data is active, so dashboard, papers, and chat remain usable even before running Analyze. Live results can replace this dataset once the backend pipeline is restored.
          </section>
        ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Papers"
              value={loading ? "..." : summary.paperCount}
              icon={<PaperIcon className="h-5 w-5" />}
            />
            <MetricCard
              label="Topics"
              value={loading ? "..." : summary.topicCount}
              icon={<ChartIcon className="h-5 w-5" />}
            />
            <MetricCard
              label="Keywords"
              value={loading ? "..." : summary.keywordCount}
              icon={<ChatIcon className="h-5 w-5" />}
            />
            <MetricCard
              label="Coverage"
              value={loading ? "..." : summary.yearRange}
              icon={<UploadIcon className="h-5 w-5" />}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <article className="app-surface p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">
                    Continue setup
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-[#a3a3a3]">
                    Keep the workspace focused on the next meaningful actions.
                  </p>
                </div>
                <Link
                  href="/workspace/settings"
                  className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-[#bdbdbd] dark:hover:text-white"
                >
                  Edit settings
                </Link>
              </div>

              <div className="mt-5 divide-y divide-slate-200 dark:divide-[#2f2f2f]">
                {checklist.map((item) => (
                  <div key={item.title} className="flex items-start gap-4 py-4 first:pt-0">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center">
                      {item.done ? (
                        <CheckCircleIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                      ) : (
                        <CircleIcon className="h-5 w-5 text-slate-300 dark:text-[#555555]" />
                      )}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <div className="space-y-6">
              <article className="app-surface p-6">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">Quick access</h2>
                <div className="mt-4 space-y-3">
                  <QuickLink
                    href="/workspace/dashboard"
                    title="Dashboard"
                    description="Trends, tracks, keywords, and the current research picture."
                    icon={<ChartIcon className="h-5 w-5" />}
                  />
                <QuickLink
                  href="/workspace/chat"
                  title="Chat"
                  description={
                    isPreviewMode
                      ? "Ask questions against the preview corpus until the live analysis backend is restored."
                      : "Ask grounded questions and follow citations back to papers."
                  }
                  icon={<ChatIcon className="h-5 w-5" />}
                />
                <QuickLink
                  href="/workspace/papers"
                    title="Library"
                    description={
                      isPreviewMode
                      ? "Browse the preview paper set and the current uploaded files in one place."
                      : "Manage files and review analyzed papers from the same library."
                    }
                    icon={<PaperIcon className="h-5 w-5" />}
                  />
              </div>
              </article>

              <article className="app-surface p-6">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f2f2f2]">Workspace profile</h2>
                <dl className="mt-4 space-y-4 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500 dark:text-[#a3a3a3]">Organization</dt>
                    <dd className="text-right font-medium text-slate-900 dark:text-[#f2f2f2]">
                      {profile.organization}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500 dark:text-[#a3a3a3]">Domain</dt>
                    <dd className="text-right font-medium text-slate-900 dark:text-[#f2f2f2]">
                      {profile.domain}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500 dark:text-[#a3a3a3]">Goal</dt>
                    <dd className="text-right font-medium text-slate-900 dark:text-[#f2f2f2]">
                      {activeGoal?.label}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500 dark:text-[#a3a3a3]">Primary source</dt>
                    <dd className="text-right font-medium text-slate-900 dark:text-[#f2f2f2]">
                      {activeSource?.label}
                    </dd>
                  </div>
                </dl>
              </article>
            </div>
          </section>
      </>

      <AnalyzeFlowModal
        open={showAnalyzeModal}
        onClose={() => setShowAnalyzeModal(false)}
        title="Analyze documents for this workspace"
        eyebrow="Analyze"
        defaultFolder="Inbox"
        onCreated={handleAnalyzeCreated}
      />
    </div>
  );
}
