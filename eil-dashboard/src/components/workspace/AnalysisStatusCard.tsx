"use client";

import Link from "next/link";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";
import {
  getRunModelLabel,
  getRunStageCaption,
  getRunStageMessage,
} from "@/lib/ingestion-status";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleIcon,
  CloseIcon,
} from "@/components/ui/Icons";

type StageStatus = "done" | "active" | "waiting" | "failed";

type TimelineStage = {
  key: string;
  label: string;
  stages: string[];
  graphNodes?: string[];
};

const TIMELINE_STAGES: TimelineStage[] = [
  {
    key: "uploading",
    label: "Upload",
    stages: ["uploading"],
  },
  {
    key: "queued",
    label: "Queued",
    stages: ["queued", "queued_waiting_for_worker", "queued_but_unstarted"],
  },
  {
    key: "download",
    label: "Download",
    stages: ["preparing", "downloading"],
  },
  {
    key: "extract",
    label: "Extract",
    stages: ["starting_analysis", "extracting", "extracting_text", "cleaning_text"],
    graphNodes: ["extract", "clean"],
  },
  {
    key: "segment",
    label: "Sections",
    stages: ["translating_text", "structuring_sections"],
    graphNodes: ["translate", "segment"],
  },
  {
    key: "metadata",
    label: "Metadata",
    stages: ["inferring_metadata", "extracting_author_keywords"],
    graphNodes: ["metadata", "extract_author_keywords"],
  },
  {
    key: "concepts",
    label: "Keywords",
    stages: ["extracting_keywords", "grouping_topics", "labeling_topics"],
    graphNodes: ["mine_keywords", "group_topics", "label_trends"],
  },
  {
    key: "classify",
    label: "Classify",
    stages: ["classifying_tracks", "classifying_typology", "extracting_facets"],
    graphNodes: ["classify_tracks", "classify_typology", "extract_facets"],
  },
  {
    key: "save",
    label: "Save",
    stages: ["building_dataset", "saving"],
    graphNodes: ["build_dataset"],
  },
  {
    key: "done",
    label: "Done",
    stages: ["completed"],
  },
];

function summarizeRuns(runs: IngestionRunRow[]) {
  return runs.reduce(
    (summary, run) => {
      summary.total += 1;
      if (run.status === "succeeded") summary.succeeded += 1;
      else if (run.status === "failed") summary.failed += 1;
      else if (run.status === "processing") summary.processing += 1;
      else summary.queued += 1;
      return summary;
    },
    { total: 0, queued: 0, processing: 0, succeeded: 0, failed: 0 }
  );
}

function readPayloadString(run: IngestionRunRow, key: string): string {
  const value = run.input_payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readMetrics(run: IngestionRunRow): Record<string, unknown> {
  const value = run.input_payload?.analysis_metrics;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readCompletedGraphNodes(run: IngestionRunRow): Set<string> {
  const metrics = readMetrics(run);
  const rawNodes = metrics.completed_graph_nodes;
  if (!Array.isArray(rawNodes)) {
    return new Set();
  }
  return new Set(
    rawNodes
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "node" in item) {
          const node = (item as { node?: unknown }).node;
          return typeof node === "string" ? node : "";
        }
        return "";
      })
      .filter(Boolean)
  );
}

function getStageIndex(run: IngestionRunRow): number {
  if (run.status === "succeeded") return TIMELINE_STAGES.length - 1;
  const stage = readPayloadString(run, "progress_stage").toLowerCase();
  const explicitIndex = TIMELINE_STAGES.findIndex((item) =>
    item.stages.includes(stage)
  );
  if (explicitIndex >= 0) return explicitIndex;
  if (run.status === "processing") return Math.max(1, explicitIndex);
  return 0;
}

function getTimelineStatus(
  run: IngestionRunRow,
  stage: TimelineStage,
  index: number
): StageStatus {
  if (run.status === "failed") {
    const currentIndex = getStageIndex(run);
    if (index < currentIndex) return "done";
    return index === currentIndex ? "failed" : "waiting";
  }
  if (run.status === "succeeded") return "done";
  const currentIndex = getStageIndex(run);
  const completedNodes = readCompletedGraphNodes(run);
  if (index < currentIndex) return "done";
  if (
    index === currentIndex &&
    (run.status === "processing" || run.status === "queued")
  ) {
    return "active";
  }
  if (stage.graphNodes?.every((node) => completedNodes.has(node))) {
    return "done";
  }
  return "waiting";
}

function formatSeconds(value: unknown): string {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function RunTimeline({ run }: { run: IngestionRunRow }) {
  return (
    <div className="mt-4 overflow-x-auto pb-2 pt-1">
      <div className="grid min-w-[760px] grid-cols-10">
        {TIMELINE_STAGES.map((stage, index) => {
          const status = getTimelineStatus(run, stage, index);
          const previousStatus =
            index > 0
              ? getTimelineStatus(run, TIMELINE_STAGES[index - 1], index - 1)
              : null;
          const lineDone =
            status === "done" ||
            status === "active" ||
            status === "failed" ||
            previousStatus === "done";
          const dotTone =
            status === "done"
              ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-[#111111]"
              : status === "active"
                ? "border-slate-900 bg-white text-slate-900 shadow-[0_0_0_4px_rgba(15,23,42,0.08)] dark:border-white dark:bg-[#050505] dark:text-white dark:shadow-[0_0_0_4px_rgba(255,255,255,0.12)]"
                : status === "failed"
                  ? "border-red-400 bg-red-50 text-red-700 dark:border-red-500/70 dark:bg-red-950/30 dark:text-red-200"
                  : "border-slate-200 bg-white text-slate-300 dark:border-[#242424] dark:bg-[#050505] dark:text-[#555555]";
          const labelTone =
            status === "waiting"
              ? "text-slate-400 dark:text-[#666666]"
              : "text-slate-700 dark:text-[#d4d4d4]";
          const stateLabel =
            status === "done" ? "Done" : status === "active" ? "Now" : status;
          return (
            <div
              key={stage.key}
              className="relative flex min-h-[58px] flex-col items-center px-1 text-center"
            >
              {index > 0 ? (
                <span
                  className={`absolute left-0 right-1/2 top-3 h-px ${
                    lineDone
                      ? "bg-slate-300 dark:bg-[#5f5f5f]"
                      : "bg-slate-200 dark:bg-[#1f1f1f]"
                  }`}
                />
              ) : null}
              {index < TIMELINE_STAGES.length - 1 ? (
                <span
                  className={`absolute left-1/2 right-0 top-3 h-px ${
                    status === "done"
                      ? "bg-slate-300 dark:bg-[#5f5f5f]"
                      : "bg-slate-200 dark:bg-[#1f1f1f]"
                  }`}
                />
              ) : null}
              <span
                className={`relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border ${dotTone}`}
                title={`${stage.label}: ${stateLabel}`}
                aria-label={`${stage.label}: ${stateLabel}`}
              >
                {status === "done" ? (
                  <CheckCircleIcon className="h-4 w-4" />
                ) : status === "failed" ? (
                  <CloseIcon className="h-3.5 w-3.5" />
                ) : (
                  <CircleIcon
                    className={`h-3.5 w-3.5 ${
                      status === "active" ? "animate-pulse" : ""
                    }`}
                  />
                )}
              </span>
              <span
                className={`mt-2 text-[11px] font-semibold uppercase tracking-normal ${labelTone}`}
              >
                {stage.label}
              </span>
              <span className="mt-0.5 text-[10px] capitalize text-slate-400 dark:text-[#777777]">
                {stateLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunMetrics({ run }: { run: IngestionRunRow }) {
  const metrics = readMetrics(run);
  const queueWait = formatSeconds(metrics.queue_wait_seconds);
  const download = formatSeconds(metrics.download_seconds);
  const graph = formatSeconds(metrics.graph_seconds);
  const save = formatSeconds(metrics.save_seconds);
  const total = formatSeconds(metrics.total_worker_seconds);
  const completedNodes = readCompletedGraphNodes(run).size;
  const values = [
    queueWait ? ["Queue", queueWait] : null,
    download ? ["Download", download] : null,
    graph ? ["Graph", graph] : null,
    save ? ["Save", save] : null,
    total ? ["Total", total] : null,
    completedNodes > 0 ? ["Nodes", `${completedNodes}`] : null,
  ].filter(Boolean) as Array<[string, string]>;
  if (values.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {values.map(([label, value]) => (
        <span
          key={label}
          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#a3a3a3]"
        >
          {label}: {value}
        </span>
      ))}
    </div>
  );
}

function toEpochMs(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getRunProgressEpochMs(run?: IngestionRunRow | null): number {
  if (!run) {
    return 0;
  }
  const payloadValue = run.input_payload?.progress_updated_at;
  const progressMs =
    typeof payloadValue === "string" && payloadValue.trim()
      ? toEpochMs(payloadValue)
      : 0;
  return Math.max(progressMs, toEpochMs(run.updated_at ?? null));
}

function getRunStageEpochMs(run?: IngestionRunRow | null): number {
  if (!run) {
    return 0;
  }
  const payloadValue = run.input_payload?.progress_updated_at;
  if (typeof payloadValue === "string" && payloadValue.trim()) {
    return toEpochMs(payloadValue);
  }
  return toEpochMs(run.updated_at ?? null);
}

function formatDurationMinutes(totalMinutes: number) {
  if (totalMinutes < 1) {
    return "under a minute";
  }
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export default function AnalysisStatusCard({
  runs,
  folderJob,
  loading,
  compact = false,
  onMinimize,
  onExpand,
  onClear,
  onCancelRun,
  onCancelAll,
  onRetryQueue,
  onStartProcessing,
  onDebugClearQueue,
}: {
  runs: IngestionRunRow[];
  folderJob?: FolderAnalysisJobRow | null;
  loading?: boolean;
  compact?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
  onClear?: () => void;
  onCancelRun?: (runId: string) => void | Promise<void>;
  onCancelAll?: () => void | Promise<void>;
  onRetryQueue?: () => void | Promise<void>;
  onStartProcessing?: () => void | Promise<void>;
  onDebugClearQueue?: () => void | Promise<void>;
}) {
  const summary = summarizeRuns(runs);
  const allTerminal =
    runs.length > 0 &&
    runs.every((run) => run.status === "succeeded" || run.status === "failed");
  const hasActiveRuns = runs.some(
    (run) => run.status === "queued" || run.status === "processing"
  );
  const hasQueuedWithoutProcessing =
    runs.some((run) => run.status === "queued") &&
    !runs.some((run) => run.status === "processing");
  const leadRun =
    runs.find((run) => run.status === "processing") ??
    runs.find((run) => run.status === "queued") ??
    runs[0];
  const leadMessage = folderJob?.progress_message || (leadRun ? getRunStageMessage(leadRun) : "");
  const leadDetail = folderJob?.progress_detail
    ? folderJob.progress_detail
    : hasActiveRuns
      ? `${summary.processing + summary.queued} active run${summary.processing + summary.queued === 1 ? "" : "s"}`
      : `${summary.succeeded} completed`;
  const staleReferenceMs = Math.max(
    getRunProgressEpochMs(leadRun),
    toEpochMs(folderJob?.updated_at ?? null)
  );
  const stageReferenceMs = getRunStageEpochMs(leadRun);
  const workerTouchMs = Math.max(
    toEpochMs(leadRun?.updated_at ?? null),
    toEpochMs(folderJob?.updated_at ?? null)
  );
  const staleMinutes = staleReferenceMs > 0 ? (Date.now() - staleReferenceMs) / 60000 : 0;
  const stageMinutes = stageReferenceMs > 0 ? (Date.now() - stageReferenceMs) / 60000 : 0;
  const hasRecentWorkerTouch = workerTouchMs > 0 && Date.now() - workerTouchMs <= 120000;
  const isLikelyStalled = hasActiveRuns && staleMinutes >= 5 && !hasRecentWorkerTouch;
  const isLongRunningStage =
    Boolean(leadRun) &&
    leadRun?.status === "processing" &&
    stageMinutes >= 3 &&
    hasRecentWorkerTouch;
  const stageDurationLabel = formatDurationMinutes(Math.floor(stageMinutes));

  if (compact) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xl dark:border-[#1f1f1f] dark:bg-[#050505]">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onExpand}
            className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#6f6f6f]">
                {folderJob ? "Folder analysis" : "Analysis active"}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-[#ececec]">
                {loading
                  ? "Refreshing status..."
                  : leadMessage || `${summary.processing + summary.queued} in progress, ${summary.succeeded} done`}
              </p>
              {!loading ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-[#8f8f8f]">
                  {leadDetail}
                </p>
              ) : null}
            </div>
            <ArrowRightIcon className="h-4 w-4 text-slate-400 dark:text-[#8f8f8f]" />
          </button>
          {allTerminal && onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#a0a0a0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
              aria-label="Dismiss analysis status"
              title="Dismiss"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {hasActiveRuns && onCancelAll ? (
            <button
              type="button"
              onClick={() => void onCancelAll()}
              className="inline-flex h-8 flex-none items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
              aria-label="Cancel all active analysis runs"
              title="Cancel all processing"
            >
              Cancel all
            </button>
          ) : null}
          {isLikelyStalled && onRetryQueue ? (
            <button
              type="button"
              onClick={() => void onRetryQueue()}
              className="inline-flex h-8 flex-none items-center justify-center rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800 transition-colors hover:border-amber-400 hover:bg-amber-100 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:border-amber-800"
              aria-label="Retry stalled analysis queue"
              title="Retry processing"
            >
              Retry
            </button>
          ) : null}
          {hasQueuedWithoutProcessing && onStartProcessing ? (
            <button
              type="button"
              onClick={() => void onStartProcessing()}
              className="inline-flex h-8 flex-none items-center justify-center rounded-full border border-sky-300 bg-sky-50 px-3 text-xs font-medium text-sky-800 transition-colors hover:border-sky-400 hover:bg-sky-100 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:border-sky-800"
              aria-label="Start queued analysis processing now"
              title="Start processing now"
            >
              Start now
            </button>
          ) : null}
          {onDebugClearQueue ? (
            <button
              type="button"
              onClick={() => void onDebugClearQueue()}
              className="inline-flex h-8 flex-none items-center justify-center rounded-full border border-rose-300 bg-rose-50 px-3 text-xs font-medium text-rose-800 transition-colors hover:border-rose-400 hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:border-rose-800"
              aria-label="Debug clear worker queue"
              title="Debug clear queue"
            >
              Debug reset
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className="app-surface px-6 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">
            {folderJob ? "Folder analysis status" : "Analysis status"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-900 dark:text-[#f2f2f2]">
            {folderJob
              ? "Your folder batch is moving through analysis"
              : "Your files are being prepared for analysis"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
            {folderJob?.progress_detail
              ? folderJob.progress_detail
              : "The app has queued the upload successfully. The external analysis worker now picks up the files, runs the extraction pipeline, and writes results back into Supabase."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasActiveRuns && onCancelAll ? (
            <button
              type="button"
              onClick={() => void onCancelAll()}
              className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200 dark:hover:border-red-800 dark:hover:bg-red-950/35"
              aria-label="Cancel all active analysis runs"
              title="Cancel all processing"
            >
              Cancel all processing
            </button>
          ) : null}
          {isLikelyStalled && onRetryQueue ? (
            <button
              type="button"
              onClick={() => void onRetryQueue()}
              className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 transition-colors hover:border-amber-400 hover:bg-amber-100 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:border-amber-800"
              aria-label="Retry stalled analysis queue"
              title="Retry processing"
            >
              Retry processing
            </button>
          ) : null}
          {hasQueuedWithoutProcessing && onStartProcessing ? (
            <button
              type="button"
              onClick={() => void onStartProcessing()}
              className="inline-flex items-center justify-center rounded-lg border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-800 transition-colors hover:border-sky-400 hover:bg-sky-100 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:border-sky-800"
              aria-label="Start queued analysis processing now"
              title="Start processing now"
            >
              Start processing now
            </button>
          ) : null}
          {onDebugClearQueue ? (
            <button
              type="button"
              onClick={() => void onDebugClearQueue()}
              className="inline-flex items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-800 transition-colors hover:border-rose-400 hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:border-rose-800"
              aria-label="Debug clear worker queue"
              title="Debug clear queue"
            >
              Debug clear queue
            </button>
          ) : null}
          <button
            type="button"
            onClick={onMinimize}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
          >
            Minimize
          </button>
          <Link
            href="/workspace/imports"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
          >
            Open imports
          </Link>
          {allTerminal && onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-[#ececec] dark:text-[#171717] dark:hover:bg-white"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {folderJob ? (
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#050505] dark:text-[#c9c9c9]">
            Stage: {folderJob.progress_message || folderJob.status}
          </span>
        ) : null}
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#050505] dark:text-[#c9c9c9]">
          {summary.total} total
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#050505] dark:text-[#c9c9c9]">
          {summary.queued} queued
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#050505] dark:text-[#c9c9c9]">
          {summary.processing} processing
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#050505] dark:text-[#c9c9c9]">
          {summary.succeeded} succeeded
        </span>
        {summary.failed > 0 ? (
          <span className="rounded-full bg-red-100 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-200">
            {summary.failed} failed
          </span>
        ) : null}
      </div>

      <div className="mt-5 space-y-3">
        {isLikelyStalled ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
            Processing appears stalled. The queue has not advanced for about {Math.floor(staleMinutes)} minute{Math.floor(staleMinutes) === 1 ? "" : "s"}. Use Retry processing to trigger the worker again.
          </div>
        ) : null}
        {isLongRunningStage ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200">
            The worker is still active. The current stage has been running for about {stageDurationLabel}, and some paper-analysis steps can legitimately take several minutes before the next visible progress update.
          </div>
        ) : null}
        {folderJob ? (
          <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                  Folder batch progress
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-[#cfcfcf]">
                  {folderJob.progress_message || folderJob.status}
                </p>
                {folderJob.progress_detail ? (
                  <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">
                    {folderJob.progress_detail}
                  </p>
                ) : null}
              </div>
              <span className="text-xs font-medium uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
                {folderJob.status}
              </span>
            </div>
          </article>
        ) : null}
        {runs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#a3a3a3]">
            {loading ? "Loading run status..." : "Waiting for run status to appear."}
          </div>
        ) : (
          runs.map((run) => (
            <article
              key={run.id}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                    {run.source_filename || run.id}
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-[#cfcfcf]">
                    {getRunStageMessage(run)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-[#8f8f8f]">
                    {getRunModelLabel(run)}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-[#8f8f8f]">
                    {getRunStageCaption(run)}
                  </p>
                  {run.status === "processing" && getRunStageEpochMs(run) > 0 ? (
                    <p className="mt-2 text-xs font-medium text-sky-700 dark:text-sky-300">
                      Current stage duration:{" "}
                      {formatDurationMinutes(
                        Math.floor(
                          (Date.now() - getRunStageEpochMs(run)) / 60000
                        )
                      )}
                    </p>
                  ) : null}
                  <RunMetrics run={run} />
                </div>
                <div className="flex items-center gap-2">
                  {onCancelRun &&
                  (run.status === "queued" || run.status === "processing") ? (
                    <button
                      type="button"
                      onClick={() => void onCancelRun(run.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#a0a0a0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
                      aria-label={`Cancel analysis for ${run.source_filename || run.id}`}
                      title="Cancel analysis"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {run.status === "succeeded" ? (
                    <CheckCircleIcon className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                  ) : (
                    <CircleIcon className="h-4 w-4 text-slate-400 dark:text-[#666666]" />
                  )}
                  <span className="text-xs font-medium uppercase tracking-normal text-slate-500 dark:text-[#8f8f8f]">
                    {run.status}
                  </span>
                </div>
              </div>
              {run.error_message ? (
                <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  {run.error_message}
                </p>
              ) : null}
              <RunTimeline run={run} />
            </article>
          ))
        )}
      </div>
    </section>
  );
}
