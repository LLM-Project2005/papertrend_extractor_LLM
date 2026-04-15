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
}) {
  const summary = summarizeRuns(runs);
  const allTerminal =
    runs.length > 0 &&
    runs.every((run) => run.status === "succeeded" || run.status === "failed");
  const hasActiveRuns = runs.some(
    (run) => run.status === "queued" || run.status === "processing"
  );
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

  if (compact) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xl dark:border-[#2c2c2c] dark:bg-[#1d1d1d]">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onExpand}
            className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
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
              className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#353535] dark:bg-[#202020] dark:text-[#a0a0a0] dark:hover:border-[#444444] dark:hover:text-white"
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
              className="inline-flex h-8 flex-none items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#353535] dark:bg-[#202020] dark:text-[#d0d0d0] dark:hover:border-[#444444] dark:hover:text-white"
              aria-label="Cancel all active analysis runs"
              title="Cancel all processing"
            >
              Cancel all
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
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">
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
          <button
            type="button"
            onClick={onMinimize}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
          >
            Minimize
          </button>
          <Link
            href="/workspace/imports"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
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
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#232323] dark:text-[#c9c9c9]">
            Stage: {folderJob.progress_message || folderJob.status}
          </span>
        ) : null}
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#232323] dark:text-[#c9c9c9]">
          {summary.total} total
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#232323] dark:text-[#c9c9c9]">
          {summary.queued} queued
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#232323] dark:text-[#c9c9c9]">
          {summary.processing} processing
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-[#232323] dark:text-[#c9c9c9]">
          {summary.succeeded} succeeded
        </span>
        {summary.failed > 0 ? (
          <span className="rounded-full bg-red-100 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-200">
            {summary.failed} failed
          </span>
        ) : null}
      </div>

      <div className="mt-5 space-y-3">
        {folderJob ? (
          <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
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
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-[#8f8f8f]">
                {folderJob.status}
              </span>
            </div>
          </article>
        ) : null}
        {runs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#a3a3a3]">
            {loading ? "Loading run status..." : "Waiting for run status to appear."}
          </div>
        ) : (
          runs.map((run) => (
            <article
              key={run.id}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]"
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
                </div>
                <div className="flex items-center gap-2">
                  {onCancelRun &&
                  (run.status === "queued" || run.status === "processing") ? (
                    <button
                      type="button"
                      onClick={() => void onCancelRun(run.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#353535] dark:bg-[#202020] dark:text-[#a0a0a0] dark:hover:border-[#444444] dark:hover:text-white"
                      aria-label={`Cancel analysis for ${run.source_filename || run.id}`}
                      title="Cancel analysis"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {run.status === "succeeded" ? (
                    <CheckCircleIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                  ) : (
                    <CircleIcon className="h-4 w-4 text-slate-400 dark:text-[#666666]" />
                  )}
                  <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-[#8f8f8f]">
                    {run.status}
                  </span>
                </div>
              </div>
              {run.error_message ? (
                <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  {run.error_message}
                </p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
