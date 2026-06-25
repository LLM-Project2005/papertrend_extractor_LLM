"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDashboardData } from "@/hooks/useData";
import { useIngestionRuns } from "@/hooks/useIngestionRuns";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import AnalyzeFlowModal from "@/components/workspace/AnalyzeFlowModal";
import AnalysisStatusCard from "@/components/workspace/AnalysisStatusCard";
import { getRunStageCaption } from "@/lib/ingestion-status";
import {
  ArrowRightIcon,
  ChartIcon,
  ChatIcon,
  CheckCircleIcon,
  FileIcon,
  PaperIcon,
  RefreshIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/ui/Icons";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";

type RankedItem = {
  label: string;
  value: number;
  detail?: string;
};

const STUCK_RUN_MINUTES = 15;

const AI_ACTIONS = [
  {
    title: "Ask the workspace",
    description: "Start with a grounded question across analyzed papers.",
    prompt: "What are the main findings in this workspace?",
    icon: ChatIcon,
  },
  {
    title: "Create a chart",
    description: "Use Chart mode to visualize topics, keywords, years, or tracks.",
    prompt: "Create the most useful chart from my analyzed papers.",
    icon: ChartIcon,
  },
  {
    title: "Summarize recent papers",
    description: "Turn the latest analyzed files into a compact reading brief.",
    prompt: "Summarize the recent papers and highlight what matters.",
    icon: PaperIcon,
  },
  {
    title: "Compare papers",
    description: "Ask for similarities, differences, methods, and contributions.",
    prompt: "Compare the strongest papers in this workspace.",
    icon: SparkIcon,
  },
  {
    title: "Find research gaps",
    description: "Look for missing angles, weak evidence, and next-study ideas.",
    prompt: "Find research gaps and possible future study ideas.",
    icon: RefreshIcon,
  },
] as const;

const surfaceClass =
  "rounded-xl border border-[#ebebeb] bg-white shadow-[0_1px_1px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)] dark:border-[#1f1f1f] dark:bg-[#050505] dark:shadow-none";
const softSurfaceClass =
  "rounded-lg border border-[#ebebeb] bg-[#fafafa] dark:border-[#1f1f1f] dark:bg-[#030303]";
const eyebrowClass =
  "font-mono text-[11px] font-medium uppercase tracking-normal text-[#888888] dark:text-[#8f8f8f]";
const primaryButtonClass =
  "inline-flex min-h-11 items-center gap-2 rounded-full bg-[#171717] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black dark:bg-white dark:text-[#171717] dark:hover:bg-[#f2f2f2]";
const secondaryButtonClass =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-[#ebebeb] bg-white px-5 py-2.5 text-sm font-medium text-[#171717] transition-colors hover:border-[#a1a1a1] hover:bg-[#fafafa] dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]";

function MetricCard({
  label,
  value,
  icon,
  detail,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  detail?: string;
}) {
  return (
    <article className={`${surfaceClass} px-5 py-5`}>
      <div className="flex items-center justify-between gap-3">
        <p className={eyebrowClass}>{label}</p>
        <span className="text-[#888888] dark:text-[#8f8f8f]">{icon}</span>
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-normal text-[#171717] dark:text-white">
        {value}
      </p>
      {detail ? (
        <p className="mt-2 text-sm leading-5 text-[#4d4d4d] dark:text-[#a3a3a3]">{detail}</p>
      ) : null}
    </article>
  );
}

function AIActionCard({
  title,
  description,
  prompt,
  icon: Icon,
}: {
  title: string;
  description: string;
  prompt: string;
  icon: (props: { className?: string }) => JSX.Element;
}) {
  return (
    <Link
      href="/workspace/chat"
      className={`${surfaceClass} group flex min-h-[150px] flex-col justify-between px-4 py-4 transition-colors hover:border-[#a1a1a1] hover:bg-[#fafafa] dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]`}
    >
      <div>
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#ebebeb] bg-white text-[#171717] dark:border-[#1f1f1f] dark:bg-black dark:text-white">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-[#171717] dark:text-white">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#4d4d4d] dark:text-[#a3a3a3]">
          {description}
        </p>
      </div>
      <p className="mt-4 line-clamp-2 rounded-md bg-[#fafafa] px-3 py-2 font-mono text-xs leading-5 text-[#4d4d4d] transition-colors group-hover:bg-white dark:bg-[#030303] dark:text-[#8f8f8f] dark:group-hover:bg-[#050505]">
        {prompt}
      </p>
    </Link>
  );
}

function InsightList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: RankedItem[];
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#171717] dark:text-white">{title}</h3>
        <span className="font-mono text-xs text-[#888888] dark:text-[#8f8f8f]">Top 5</span>
      </div>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map((item, index) => (
            <div
              key={`${title}-${item.label}`}
              className="flex items-center justify-between gap-4 rounded-lg border border-[#ebebeb] bg-white px-3 py-2.5 dark:border-[#1f1f1f] dark:bg-[#050505]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#171717] dark:text-white">
                  {index + 1}. {item.label}
                </p>
                {item.detail ? (
                  <p className="mt-0.5 truncate text-xs text-[#888888] dark:text-[#8f8f8f]">
                    {item.detail}
                  </p>
                ) : null}
              </div>
              <span className="rounded-full bg-[#fafafa] px-2.5 py-1 font-mono text-xs text-[#4d4d4d] dark:bg-[#030303] dark:text-[#d0d0d0]">
                {item.value.toLocaleString()}
              </span>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-[#ebebeb] px-3 py-4 text-sm text-[#4d4d4d] dark:border-[#1f1f1f] dark:text-[#8f8f8f]">
            {emptyLabel}
          </p>
        )}
      </div>
    </div>
  );
}

function runTitleOf(run: IngestionRunRow) {
  return run.display_name || run.source_filename || "Untitled file";
}

function getRunTimestamp(run: IngestionRunRow) {
  return run.completed_at ?? run.updated_at ?? run.created_at ?? null;
}

function getRunTimeMs(run: IngestionRunRow) {
  const timestamp = getRunTimestamp(run);
  if (!timestamp) return 0;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRunAgeMinutes(run: IngestionRunRow) {
  const timestampMs = getRunTimeMs(run);
  if (!timestampMs) return 0;
  return Math.floor((Date.now() - timestampMs) / 60000);
}

function isRunStuck(run: IngestionRunRow) {
  if (run.status !== "queued" && run.status !== "processing") {
    return false;
  }
  return getRunAgeMinutes(run) >= STUCK_RUN_MINUTES;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(status: IngestionRunRow["status"], stuck: boolean) {
  if (status === "succeeded") {
    return "bg-[#d3e5ff] text-[#0761d1] dark:bg-[#0b274a] dark:text-[#58a6ff]";
  }
  if (status === "failed") {
    return "bg-[#f7d4d6] text-[#c50000] dark:bg-[#351113] dark:text-[#ffb4b8]";
  }
  if (stuck) {
    return "bg-[#ffefcf] text-[#ab570a] dark:bg-[#382300] dark:text-[#ffd38a]";
  }
  return "bg-[#fafafa] text-[#4d4d4d] ring-1 ring-[#ebebeb] dark:bg-[#050505] dark:text-[#d0d0d0] dark:ring-[#242424]";
}

function RunActivityRow({ run }: { run: IngestionRunRow }) {
  const stuck = isRunStuck(run);
  const timestamp = getRunTimestamp(run);
  const statusLabel = stuck ? "needs attention" : run.status;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#ebebeb] bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#050505]">
      <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full border border-[#ebebeb] bg-white text-[#4d4d4d] dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#bdbdbd]">
        <FileIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-[#171717] dark:text-white">
            {runTitleOf(run)}
          </p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-normal ${statusTone(
              run.status,
              stuck
            )}`}
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#4d4d4d] dark:text-[#8f8f8f]">
          {getRunStageCaption(run)}
        </p>
        <p className="mt-2 font-mono text-[11px] text-[#888888] dark:text-[#6f6f6f]">
          {formatTimestamp(timestamp)}
        </p>
      </div>
    </div>
  );
}

export default function WorkspaceHomeClient() {
  const { session } = useAuth();
  const {
    profile,
    refreshFolders,
    analysisSession,
    startAnalysisSession,
    setAnalysisMinimized,
    removeAnalysisRunIds,
    clearAnalysisSession,
  } = useWorkspaceProfile();
  const { data, loading } = useDashboardData("all");
  const {
    runs,
    folderJob,
    cancelRuns,
    cancelAllActiveRuns,
    retryActiveProcessing,
    startQueuedProcessing,
    debugClearQueue,
    refresh,
  } = useIngestionRuns({
    enabled: Boolean(analysisSession?.runIds.length),
    folderJobId: analysisSession?.folderJobId ?? undefined,
    pollIntervalMs: 3000,
  });
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [libraryRuns, setLibraryRuns] = useState<IngestionRunRow[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const summary = useMemo(() => {
    if (!data) {
      return {
        paperCount: "0",
        topicCount: "0",
        keywordCount: "0",
        yearRange: "No data yet",
        topTopics: [] as RankedItem[],
        topKeywords: [] as RankedItem[],
      };
    }

    const paperIds = new Set([
      ...data.trends.map((row) => row.paper_id),
      ...data.tracksSingle.map((row) => row.paper_id),
      ...data.tracksMulti.map((row) => row.paper_id),
    ]);
    const keywords = new Set(data.trends.map((row) => row.keyword).filter(Boolean));
    const years = [
      ...new Set([
        ...data.trends.map((row) => row.year),
        ...data.tracksSingle.map((row) => row.year),
        ...data.tracksMulti.map((row) => row.year),
      ]),
    ]
      .filter(Boolean)
      .sort();
    const topicCount =
      data.topicFamilies && data.topicFamilies.length > 0
        ? data.topicFamilies.length
        : new Set(data.trends.map((row) => row.topic).filter(Boolean)).size;

    const topicItems =
      data.topicFamilies && data.topicFamilies.length > 0
        ? data.topicFamilies
            .map((family) => ({
              label: family.canonicalTopic,
              value: family.totalKeywordFrequency,
              detail: `${family.paperIds.length} paper${
                family.paperIds.length === 1 ? "" : "s"
              }`,
            }))
            .sort((left, right) => right.value - left.value)
            .slice(0, 5)
        : Object.values(
            data.trends.reduce<Record<string, RankedItem & { paperIds: Set<string> }>>(
              (acc, row) => {
                const label = row.topic || "Unclassified";
                if (!acc[label]) {
                  acc[label] = {
                    label,
                    value: 0,
                    paperIds: new Set<string>(),
                  };
                }
                acc[label].value += Number(row.keyword_frequency ?? 0) || 1;
                acc[label].paperIds.add(row.paper_id);
                return acc;
              },
              {}
            )
          )
            .map((item) => ({
              label: item.label,
              value: item.value,
              detail: `${item.paperIds.size} paper${item.paperIds.size === 1 ? "" : "s"}`,
            }))
            .sort((left, right) => right.value - left.value)
            .slice(0, 5);

    const keywordItems = Object.values(
      data.trends.reduce<Record<string, RankedItem>>((acc, row) => {
        const label = row.keyword || "Unclassified";
        if (!acc[label]) {
          acc[label] = { label, value: 0 };
        }
        acc[label].value += Number(row.keyword_frequency ?? 0) || 1;
        return acc;
      }, {})
    )
      .sort((left, right) => right.value - left.value)
      .slice(0, 5);

    return {
      paperCount: paperIds.size.toLocaleString(),
      topicCount: topicCount.toLocaleString(),
      keywordCount: keywords.size.toLocaleString(),
      yearRange:
        years.length > 0 ? `${years[0]} to ${years[years.length - 1]}` : "No data yet",
      topTopics: topicItems,
      topKeywords: keywordItems,
    };
  }, [data]);

  const activeRuns = analysisSession
    ? runs.filter((run) => analysisSession.runIds.includes(run.id))
    : [];
  const workspaceRuns = useMemo(() => {
    const merged = new Map(libraryRuns.map((run) => [run.id, run]));
    activeRuns.forEach((run) => merged.set(run.id, run));
    return [...merged.values()].sort((left, right) => getRunTimeMs(right) - getRunTimeMs(left));
  }, [activeRuns, libraryRuns]);
  const attentionRuns = useMemo(
    () =>
      workspaceRuns
        .filter((run) => run.status === "failed" || isRunStuck(run))
        .slice(0, 3),
    [workspaceRuns]
  );
  const recentRuns = useMemo(() => workspaceRuns.slice(0, 5), [workspaceRuns]);
  const isPreviewMode = data?.useMock ?? true;
  const liveDataError = data?.diagnostics?.errorMessage ?? null;
  const hasLiveAnalysisSession =
    Boolean(analysisSession?.runIds.length) && !analysisSession?.minimized;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("analyze") === "1") {
      setShowAnalyzeModal(true);
    }
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      setLibraryRuns([]);
      setLibraryLoading(false);
      setLibraryError(null);
      return;
    }

    const controller = new AbortController();

    async function loadLibraryRuns() {
      setLibraryLoading(true);
      try {
        const response = await fetch("/api/workspace/library?includeTrashed=false", {
          headers: {
            Authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          runs?: IngestionRunRow[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load recent workspace activity.");
        }

        setLibraryRuns(payload.runs ?? []);
        setLibraryError(null);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setLibraryError(
          error instanceof Error ? error.message : "Failed to load recent workspace activity."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLibraryLoading(false);
        }
      }
    }

    void loadLibraryRuns();

    return () => controller.abort();
  }, [session?.access_token]);

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
    setLibraryRuns((current) => [...createdRuns, ...current]);
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
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to retry processing.";
      console.error("[workspace.home] failed to retry processing", {
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
      console.error("[workspace.home] failed to start queued processing", {
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
      console.error("[workspace.home] failed to debug-clear queue", {
        folderJobId: analysisSession?.folderJobId ?? null,
        error: message,
      });
      if (typeof window !== "undefined") {
        window.alert(message);
      }
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <section className={`${surfaceClass} relative overflow-hidden px-6 py-8 sm:px-8`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#007cf0,#00dfd8,#7928ca,#ff0080,#ff4d4d,#f9cb28)]" />
        <div className="pointer-events-none absolute right-0 top-0 h-40 w-1/2 bg-[radial-gradient(ellipse_at_top_right,rgba(0,124,240,0.14),transparent_55%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className={eyebrowClass}>
              Workspace command center
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-normal text-[#171717] dark:text-white">
              {profile.name}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#4d4d4d] dark:text-[#a3a3a3]">
              Bring papers into analysis, watch the queue, and jump straight into AI
              workflows once the workspace has data.
            </p>
            <p className="mt-4 inline-flex rounded-full bg-[#fafafa] px-3 py-1 font-mono text-xs text-[#4d4d4d] ring-1 ring-[#ebebeb] dark:bg-[#030303] dark:text-[#a3a3a3] dark:ring-[#242424]">
              Showing all analyzed data across this workspace
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowAnalyzeModal(true)}
              className={primaryButtonClass}
            >
              <UploadIcon className="h-4 w-4" />
              <span>Analyze papers</span>
            </button>
            <Link
              href="/workspace/chat"
              className={secondaryButtonClass}
            >
              <ChatIcon className="h-4 w-4" />
              <span>Open chat</span>
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
          onStartProcessing={handleStartProcessing}
          onDebugClearQueue={handleDebugClearQueue}
        />
      ) : null}

      {liveDataError ? (
        <section className="rounded-lg border border-[#f7d4d6] bg-[#fff7f7] px-5 py-4 text-sm text-[#c50000] dark:border-[#5d1f24] dark:bg-[#220b0d] dark:text-[#ffb4b8]">
          Live dashboard data could not be loaded right now. The backend returned an error while assembling this workspace&apos;s analytics: {liveDataError}
        </section>
      ) : null}

      {isPreviewMode ? (
        <section className="rounded-lg border border-[#ffefcf] bg-[#fffaf0] px-5 py-4 text-sm text-[#ab570a] dark:border-[#5f3b00] dark:bg-[#211600] dark:text-[#ffd38a]">
          Preview data is active, so dashboard, papers, and chat remain usable even before running Analyze. Live results can replace this dataset once the backend pipeline is restored.
        </section>
      ) : null}

      {data?.diagnostics?.recoveredFromLegacyScope ? (
        <section className="rounded-lg border border-[#d3e5ff] bg-[#f5f9ff] px-5 py-4 text-sm text-[#0761d1] dark:border-[#14395f] dark:bg-[#07192b] dark:text-[#8bbcff]">
          Showing recovered historical analyses because this workspace has older canonical rows available.
        </section>
      ) : null}

      {attentionRuns.length > 0 ? (
        <section className="rounded-lg border border-[#ffefcf] bg-[#fffaf0] px-5 py-4 dark:border-[#5f3b00] dark:bg-[#211600]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#171717] dark:text-[#fff4dc]">
                Needs attention
              </p>
              <p className="mt-1 text-sm leading-6 text-[#ab570a] dark:text-[#ffd38a]">
                {attentionRuns.length} recent file{attentionRuns.length === 1 ? "" : "s"} failed or stopped updating.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {attentionRuns.map((run) => (
                <span
                  key={run.id}
                  className="max-w-[260px] truncate rounded-full border border-[#ffefcf] bg-white px-3 py-1 font-mono text-xs text-[#ab570a] dark:border-[#5f3b00] dark:bg-[#050505] dark:text-[#fff4dc]"
                >
                  {runTitleOf(run)}
                </span>
              ))}
              <Link
                href="/workspace/logs"
                className="inline-flex items-center gap-1 rounded-full bg-[#171717] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-black dark:bg-white dark:text-[#171717] dark:hover:bg-[#f2f2f2]"
              >
                Review
                <ArrowRightIcon className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Papers"
          value={loading ? "..." : summary.paperCount}
          detail="Unique analyzed papers"
          icon={<PaperIcon className="h-5 w-5" />}
        />
        <MetricCard
          label="Topics"
          value={loading ? "..." : summary.topicCount}
          detail="Workspace topic groups"
          icon={<ChartIcon className="h-5 w-5" />}
        />
        <MetricCard
          label="Keywords"
          value={loading ? "..." : summary.keywordCount}
          detail="Extracted keyword labels"
          icon={<ChatIcon className="h-5 w-5" />}
        />
        <MetricCard
          label="Coverage"
          value={loading ? "..." : summary.yearRange}
          detail="Publication year span"
          icon={<UploadIcon className="h-5 w-5" />}
        />
      </section>

      <section className={`${surfaceClass} p-6`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className={eyebrowClass}>
              AI actions
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal text-[#171717] dark:text-white">
              What do you want to do with these papers?
            </h2>
          </div>
          <Link
            href="/workspace/chat"
            className="inline-flex items-center gap-2 text-sm font-medium text-[#0070f3] hover:text-[#0761d1] dark:text-[#58a6ff] dark:hover:text-[#8bbcff]"
          >
            Open full chat
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {AI_ACTIONS.map((action) => (
            <AIActionCard key={action.title} {...action} />
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <article className={`${surfaceClass} p-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={eyebrowClass}>
                Workspace signal
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal text-[#171717] dark:text-white">
                Compact insight preview
              </h2>
            </div>
            <Link
              href="/workspace/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-[#ebebeb] bg-white px-4 py-2 text-sm font-medium text-[#171717] transition-colors hover:border-[#a1a1a1] hover:bg-[#fafafa] dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]"
            >
              Dashboard
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <InsightList
              title="Top topics"
              items={summary.topTopics}
              emptyLabel="No topic rows are available yet. Analyze papers to populate this view."
            />
            <InsightList
              title="Top keywords"
              items={summary.topKeywords}
              emptyLabel="No keyword rows are available yet. Analyze papers to populate this view."
            />
          </div>
        </article>

        <article className={`${surfaceClass} p-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={eyebrowClass}>
                Operations
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal text-[#171717] dark:text-white">
                Recent activity
              </h2>
            </div>
            <Link
              href="/workspace/logs"
              className="text-sm font-medium text-[#0070f3] hover:text-[#0761d1] dark:text-[#58a6ff] dark:hover:text-[#8bbcff]"
            >
              History
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            {libraryLoading ? (
              <div className="rounded-lg border border-dashed border-[#ebebeb] px-4 py-8 text-center dark:border-[#1f1f1f]">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-[#a1a1a1] border-t-transparent dark:border-[#8e8e8e]" />
                <p className="text-sm text-[#4d4d4d] dark:text-[#8f8f8f]">
                  Loading recent activity
                </p>
              </div>
            ) : libraryError ? (
              <p className="rounded-lg border border-[#f7d4d6] bg-[#fff7f7] px-4 py-4 text-sm text-[#c50000] dark:border-[#5d1f24] dark:bg-[#220b0d] dark:text-[#ffb4b8]">
                {libraryError}
              </p>
            ) : recentRuns.length > 0 ? (
              recentRuns.map((run) => <RunActivityRow key={run.id} run={run} />)
            ) : (
              <div className="rounded-lg border border-dashed border-[#ebebeb] px-4 py-8 text-center dark:border-[#1f1f1f]">
                <CheckCircleIcon className="mx-auto h-8 w-8 text-[#a1a1a1] dark:text-[#555555]" />
                <p className="mt-3 text-sm font-medium text-[#171717] dark:text-[#d0d0d0]">
                  No file activity yet
                </p>
                <p className="mt-1 text-sm text-[#4d4d4d] dark:text-[#8f8f8f]">
                  Analyze papers to start building the workspace record.
                </p>
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link
          href="/workspace/dashboard"
          className={`${softSurfaceClass} flex items-center justify-between px-4 py-4 transition-colors hover:border-[#a1a1a1] dark:hover:border-[#3a3a3a]`}
        >
          <span>
            <span className="block text-sm font-semibold text-[#171717] dark:text-white">
              Review analytics
            </span>
            <span className="mt-1 block text-sm text-[#4d4d4d] dark:text-[#a3a3a3]">
              Trends, tracks, keywords
            </span>
          </span>
          <ArrowRightIcon className="h-4 w-4 text-[#888888] dark:text-[#8e8e8e]" />
        </Link>
        <Link
          href="/workspace/library"
          className={`${softSurfaceClass} flex items-center justify-between px-4 py-4 transition-colors hover:border-[#a1a1a1] dark:hover:border-[#3a3a3a]`}
        >
          <span>
            <span className="block text-sm font-semibold text-[#171717] dark:text-white">
              Manage library
            </span>
            <span className="mt-1 block text-sm text-[#4d4d4d] dark:text-[#a3a3a3]">
              Files, folders, analysis
            </span>
          </span>
          <ArrowRightIcon className="h-4 w-4 text-[#888888] dark:text-[#8e8e8e]" />
        </Link>
        <Link
          href="/workspace/chat"
          className={`${softSurfaceClass} flex items-center justify-between px-4 py-4 transition-colors hover:border-[#a1a1a1] dark:hover:border-[#3a3a3a]`}
        >
          <span>
            <span className="block text-sm font-semibold text-[#171717] dark:text-white">
              Ask with sources
            </span>
            <span className="mt-1 block text-sm text-[#4d4d4d] dark:text-[#a3a3a3]">
              Chat, charts, web search
            </span>
          </span>
          <ArrowRightIcon className="h-4 w-4 text-[#888888] dark:text-[#8e8e8e]" />
        </Link>
      </section>

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
