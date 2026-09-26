"use client";

/*
 * A repository's home: what is in it, what is happening to it, and the one
 * next step a reader most likely wants - add papers, or ask about the ones
 * already here.
 *
 * It deliberately carries no card grid of metrics or of identical actions.
 * The facts are one line under the name; asking is one field; the rest is two
 * ranked lists and the latest papers, each a link to the page that owns it.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDashboardData } from "@/hooks/useData";
import { useIngestionRuns } from "@/hooks/useIngestionRuns";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import AnalyzeFlowModal from "@/components/workspace/AnalyzeFlowModal";
import AnalysisStatusCard from "@/components/workspace/AnalysisStatusCard";
import {
  describeRunFailure,
  getRunDisplayTitle,
  getRunStageMessage,
  getRunStatusLabel,
} from "@/lib/ingestion-status";
import {
  ArrowRightIcon,
  ChartIcon,
  ChatIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  InfoIcon,
  SparkIcon,
  SpinnerIcon,
  UploadIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@/components/ui/Icons";
import { buttonClass, chipClass, panelClass } from "@/components/ui/controls";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";
import { isDatedYear } from "@/lib/dated-year";

type RankedItem = {
  label: string;
  value: number;
  detail?: string;
};

const STUCK_RUN_MINUTES = 15;

/** Starting questions. Each opens Chat with the question in the composer. */
const SUGGESTED_QUESTIONS = [
  { label: "Main findings", prompt: "What are the main findings across this repository?" },
  { label: "Make a chart", prompt: "Create the most useful chart from this repository." },
  { label: "Summarize recent papers", prompt: "Summarize the recent papers and highlight what matters." },
  { label: "Compare papers", prompt: "Compare the strongest papers in this repository." },
  { label: "Find research gaps", prompt: "Find research gaps and possible future study ideas." },
] as const;

function chatHref(question: string) {
  return `/workspace/chat?q=${encodeURIComponent(question)}`;
}

function runTitleOf(run: IngestionRunRow) {
  return getRunDisplayTitle(run);
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
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------ small parts */

function Fact({ value, label, loading }: { value: string; label: string; loading: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-ink">
        {loading ? <span className="skeleton inline-block h-4 w-8 align-middle" /> : value}
      </dd>
      <span aria-hidden="true" className="text-sm text-mute">
        {label}
      </span>
    </div>
  );
}

function Notice({ tone, children }: { tone: "danger" | "warning" | "info"; children: React.ReactNode }) {
  const Icon = tone === "info" ? InfoIcon : tone === "warning" ? WarningIcon : WarningCircleIcon;
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200"
        : "border-hairline bg-subtle text-body";
  return (
    <section className={`flex gap-3 rounded-xl border px-4 py-3.5 text-sm leading-6 ${toneClass}`}>
      <Icon className="mt-1 h-4 w-4 flex-none" />
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

function RankedList({
  title,
  unit,
  items,
  emptyLabel,
  loading,
}: {
  title: string;
  unit: string;
  items: RankedItem[];
  emptyLabel: string;
  loading: boolean;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2.5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="text-xs text-mute">{unit}</span>
      </div>
      {loading ? (
        <div className="space-y-4 pt-4" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="space-y-2">
              <span className="skeleton block h-3.5 w-3/4" />
              <span className="skeleton block h-1 w-full" />
            </div>
          ))}
        </div>
      ) : items.length > 0 ? (
        <ol className="space-y-4 pt-4">
          {items.map((item, index) => (
            <li key={`${title}-${item.label}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span className="w-3 flex-none text-right text-xs tabular-nums text-mute">{index + 1}</span>
                  <span className="truncate text-ink" title={item.label}>
                    {item.label}
                  </span>
                </span>
                <span className="flex-none text-[13px] tabular-nums text-body">
                  {item.value.toLocaleString()}
                </span>
              </div>
              <div className="ml-[22px] mt-1.5 h-1 overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full origin-left rounded-full bg-ink/75 transition-transform duration-700 ease-out-expo"
                  style={{ transform: `scaleX(${item.value / max})` }}
                />
              </div>
              {item.detail ? <p className="ml-[22px] mt-1 text-xs text-mute">{item.detail}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="pt-4 text-sm leading-6 text-mute">{emptyLabel}</p>
      )}
    </div>
  );
}

function RunStatusIcon({ run }: { run: IngestionRunRow }) {
  if (run.status === "succeeded") {
    return <CheckCircleIcon weight="fill" className="h-4 w-4 flex-none text-emerald-600 dark:text-emerald-400" />;
  }
  if (run.status === "failed") {
    return <WarningCircleIcon weight="fill" className="h-4 w-4 flex-none text-red-600 dark:text-red-400" />;
  }
  if (run.status === "processing") {
    return <SpinnerIcon className="h-4 w-4 flex-none text-ink" />;
  }
  return <ClockIcon className="h-4 w-4 flex-none text-mute" />;
}

function RecentPaperRow({ run }: { run: IngestionRunRow }) {
  const stuck = isRunStuck(run);
  const time = formatTimestamp(getRunTimestamp(run));
  const detail =
    run.status === "failed"
      ? describeRunFailure(run.error_message)
      : run.status === "succeeded"
        ? "Ready"
        : stuck
          ? "Stopped updating"
          : getRunStageMessage(run);
  return (
    <li>
      <Link
        href="/workspace/library"
        className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 hover:bg-subtle"
      >
        <RunStatusIcon run={run} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink" title={runTitleOf(run)}>
            {runTitleOf(run)}
          </span>
          <span className="mt-0.5 block truncate text-xs text-mute">
            <span className={run.status === "failed" ? "text-red-700 dark:text-red-300" : ""}>{detail}</span>
            {time ? <span> · {time}</span> : null}
          </span>
        </span>
        {run.status !== "succeeded" ? (
          <span
            className={chipClass(
              run.status === "failed" ? "danger" : stuck ? "warning" : run.status === "processing" ? "accent" : "neutral",
              "flex-none"
            )}
          >
            {stuck ? "Needs attention" : getRunStatusLabel(run)}
          </span>
        ) : null}
        <ChevronRightIcon className="h-4 w-4 flex-none text-mute opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </Link>
    </li>
  );
}

/** What a new repository shows instead of empty lists: the three steps. */
function GettingStarted({ onAdd }: { onAdd: () => void }) {
  const steps = [
    {
      title: "Add PDFs",
      body: "Upload papers from your computer. Each one is stored in this repository only.",
    },
    {
      title: "Let the analysis run",
      body: "Every paper is read for its title, year, topics, methods and category. Most take a few minutes.",
    },
    {
      title: "Explore and ask",
      body: "The Dashboard charts what the papers cover over time; Chat answers questions and cites its sources.",
    },
  ];
  return (
    <section className={`${panelClass} p-6 sm:p-8`}>
      <h2 className="text-lg font-semibold tracking-tight text-ink">Start with a few papers</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-body">
        This repository is empty. Add papers and the rest of the workspace fills in as each one is analyzed.
      </p>
      <ol className="mt-6 grid gap-6 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-hairline-strong text-xs font-medium tabular-nums text-ink">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-ink">{step.title}</p>
              <p className="mt-1 text-sm leading-6 text-body">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-7 flex flex-wrap gap-2">
        <button type="button" onClick={onAdd} className={buttonClass("primary", "lg")}>
          <UploadIcon className="h-4 w-4" />
          Add papers
        </button>
        <Link href="/docs/getting-started" className={buttonClass("ghost", "lg")}>
          Read the guide
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

export default function WorkspaceHomeClient() {
  const router = useRouter();
  const { session } = useAuth();
  const {
    currentProject,
    refreshFolders,
    analysisSession,
    startAnalysisSession,
    setAnalysisMinimized,
    removeAnalysisRunIds,
    clearAnalysisSession,
  } = useWorkspaceProfile();
  const { data, loading } = useDashboardData("all", [], {
    projectId: currentProject?.id ?? null,
    enabled: Boolean(currentProject?.id),
  });
  const {
    runs,
    folderJob,
    cancelRuns,
    cancelAllActiveRuns,
    retryActiveProcessing,
    startQueuedProcessing,
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
  const [question, setQuestion] = useState("");

  const summary = useMemo(() => {
    if (!data) {
      return {
        paperCount: 0,
        topicCount: 0,
        keywordCount: 0,
        yearRange: "",
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
      .filter(isDatedYear)
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
      paperCount: paperIds.size,
      topicCount,
      keywordCount: keywords.size,
      yearRange:
        years.length === 0
          ? ""
          : years[0] === years[years.length - 1]
            ? String(years[0])
            : `${years[0]}–${years[years.length - 1]}`,
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
  const recentRuns = useMemo(() => workspaceRuns.slice(0, 6), [workspaceRuns]);
  // Only once the data has arrived: while it loads there is nothing to say.
  const isPreviewMode = data?.useMock ?? false;
  const liveDataError = data?.diagnostics?.errorMessage ?? null;
  const hasLiveAnalysisSession =
    Boolean(analysisSession?.runIds.length) && !analysisSession?.minimized;
  const statsLoading = loading && !data;
  const isEmpty =
    !statsLoading && !libraryLoading && summary.paperCount === 0 && workspaceRuns.length === 0;

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
    if (!session?.access_token || !currentProject?.id) {
      setLibraryRuns([]);
      setLibraryLoading(false);
      setLibraryError(null);
      return;
    }

    const controller = new AbortController();

    async function loadLibraryRuns() {
      setLibraryLoading(true);
      try {
        const projectQuery = currentProject?.id
          ? `&projectId=${encodeURIComponent(currentProject.id)}`
          : "";
        const response = await fetch(
          `/api/workspace/library?includeTrashed=false${projectQuery}`,
          {
          headers: {
            Authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          signal: controller.signal,
          }
        );
        const payload = (await response.json()) as {
          runs?: IngestionRunRow[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load recent project activity.");
        }

        setLibraryRuns(payload.runs ?? []);
        setLibraryError(null);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setLibraryError(
          error instanceof Error ? error.message : "Failed to load recent project activity."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLibraryLoading(false);
        }
      }
    }

    void loadLibraryRuns();

    return () => controller.abort();
  }, [currentProject?.id, session?.access_token]);

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
    setLibraryRuns((current) => {
      const merged = new Map(current.map((run) => [run.id, run]));
      createdRuns.forEach((run) => merged.set(run.id, run));
      return [...merged.values()].sort(
        (left, right) => getRunTimeMs(right) - getRunTimeMs(left)
      );
    });
    void refreshFolders();
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

  function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    router.push(chatHref(trimmed));
  }

  const plural = (count: number, word: string) => `${word}${count === 1 ? "" : "s"}`;

  return (
    <div className="mx-auto max-w-[1180px] space-y-8 pb-16 pt-2 sm:pt-4">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <h1 className="truncate text-3xl font-semibold tracking-tight text-ink sm:text-[2.5rem] sm:leading-[1.1]">
            {currentProject?.name ?? "Repository"}
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-7 text-body">
            {currentProject?.description?.trim() ||
              "Add papers, follow their analysis here, then explore the results on the Dashboard or ask about them in Chat."}
          </p>
          <dl className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Fact value={summary.paperCount.toLocaleString()} label={plural(summary.paperCount, "paper")} loading={statsLoading} />
            <Fact value={summary.topicCount.toLocaleString()} label={plural(summary.topicCount, "topic")} loading={statsLoading} />
            <Fact value={summary.keywordCount.toLocaleString()} label={plural(summary.keywordCount, "keyword")} loading={statsLoading} />
            {summary.yearRange || statsLoading ? (
              <Fact value={summary.yearRange} label="published" loading={statsLoading} />
            ) : null}
          </dl>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAnalyzeModal(true)}
            className={buttonClass("primary", "lg")}
          >
            <UploadIcon className="h-4 w-4" />
            <span>Add papers</span>
          </button>
          <Link href="/workspace/dashboard" className={buttonClass("secondary", "lg")}>
            <ChartIcon className="h-4 w-4" />
            <span>Open dashboard</span>
          </Link>
        </div>
      </header>

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
        />
      ) : null}

      {liveDataError ? (
        <Notice tone="danger">
          This repository&apos;s results could not be loaded just now ({liveDataError}). Refresh the page to try again.
        </Notice>
      ) : null}

      {isPreviewMode ? (
        <Notice tone="warning">
          Showing sample data because this repository&apos;s own results could not be loaded. They replace it as soon as they load.
        </Notice>
      ) : null}

      {data?.diagnostics?.recoveredFromLegacyScope ? (
        <Notice tone="info">
          Showing recovered historical analyses because this repository has older canonical rows available.
        </Notice>
      ) : null}

      {attentionRuns.length > 0 ? (
        <Notice tone="warning">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              <span className="font-medium">
                {attentionRuns.length} recent {plural(attentionRuns.length, "paper")} failed or stopped updating.
              </span>{" "}
              The Library says why for each one.
            </p>
            <Link href="/workspace/library" className={buttonClass("secondary", "sm", "flex-none")}>
              Review in Library
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Notice>
      ) : null}

      {isEmpty ? (
        <GettingStarted onAdd={() => setShowAnalyzeModal(true)} />
      ) : (
        <>
          <section className={`${panelClass} p-5 sm:p-6`} aria-labelledby="home-ask">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 id="home-ask" className="text-base font-semibold text-ink">
                Ask about these papers
              </h2>
              <p className="text-[13px] text-mute">Answers cite the papers they come from.</p>
            </div>
            <form
              onSubmit={handleAsk}
              className="mt-4 flex items-center gap-2 rounded-xl border border-hairline bg-canvas p-1.5 pl-3.5 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15"
            >
              <SparkIcon className="h-4 w-4 flex-none text-mute" />
              <label htmlFor="home-question" className="sr-only">
                Your question
              </label>
              <input
                id="home-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What do these papers find about...?"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent py-2 text-base text-ink outline-none placeholder:text-mute focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={!question.trim()}
                className={buttonClass("primary", "md", "flex-none")}
              >
                <span className="hidden sm:inline">Ask</span>
                <ArrowRightIcon className="h-4 w-4" />
                <span className="sr-only sm:hidden">Ask</span>
              </button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((suggestion) => (
                <Link
                  key={suggestion.label}
                  href={chatHref(suggestion.prompt)}
                  title={suggestion.prompt}
                  className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-[13px] text-body transition-colors duration-150 hover:border-hairline-strong hover:text-ink"
                >
                  {suggestion.label}
                </Link>
              ))}
              <Link
                href="/workspace/chat"
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-subtle"
              >
                <ChatIcon className="h-3.5 w-3.5" />
                Open chat
              </Link>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <section className={`${panelClass} min-w-0 p-5 sm:p-6`} aria-labelledby="home-cover">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="home-cover" className="text-base font-semibold text-ink">
                  What the papers cover
                </h2>
                <Link
                  href="/workspace/dashboard"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-body transition-colors hover:text-ink"
                >
                  Dashboard
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-8 md:grid-cols-2">
                <RankedList
                  title="Top topics"
                  unit="Keyword mentions"
                  items={summary.topTopics}
                  loading={statsLoading}
                  emptyLabel="Topics appear here once a paper has been analyzed."
                />
                <RankedList
                  title="Top keywords"
                  unit="Mentions"
                  items={summary.topKeywords}
                  loading={statsLoading}
                  emptyLabel="Keywords appear here once a paper has been analyzed."
                />
              </div>
            </section>

            <section className={`${panelClass} min-w-0 p-5 sm:p-6`} aria-labelledby="home-recent">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="home-recent" className="text-base font-semibold text-ink">
                  Recent papers
                </h2>
                <Link
                  href="/workspace/library"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-body transition-colors hover:text-ink"
                >
                  Library
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-3">
                {libraryLoading && recentRuns.length === 0 ? (
                  <ul className="space-y-1" aria-label="Loading recent papers">
                    {[0, 1, 2, 3, 4].map((index) => (
                      <li key={index} className="flex items-center gap-3 py-2.5">
                        <span className="skeleton h-4 w-4 flex-none rounded-full" />
                        <span className="flex-1 space-y-1.5">
                          <span className="skeleton block h-3.5 w-4/5" />
                          <span className="skeleton block h-3 w-2/5" />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : libraryError ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200">
                    {libraryError}
                  </p>
                ) : recentRuns.length > 0 ? (
                  <ul>
                    {recentRuns.map((run) => (
                      <RecentPaperRow key={run.id} run={run} />
                    ))}
                  </ul>
                ) : (
                  <div className="py-8 text-center">
                    <p className="text-sm font-medium text-ink">No papers yet</p>
                    <p className="mt-1 text-sm text-mute">
                      Add PDFs and each one shows here while it is analyzed.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowAnalyzeModal(true)}
                      className={buttonClass("secondary", "md", "mt-4")}
                    >
                      <UploadIcon className="h-4 w-4" />
                      <span>Add papers</span>
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      <AnalyzeFlowModal
        open={showAnalyzeModal}
        onClose={() => setShowAnalyzeModal(false)}
        onCreated={handleAnalyzeCreated}
      />
    </div>
  );
}
