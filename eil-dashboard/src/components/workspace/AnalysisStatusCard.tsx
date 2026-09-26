"use client";

/*
 * Analysis progress, in one visual language at three sizes:
 *
 *  - the pill (AnalysisTrayPill): a progress ring and one line, floating in
 *    the corner of every workspace page while papers are analysed;
 *  - the tray (compact): the pill opened - every paper with its steps, over
 *    the page on desktop and as a bottom sheet on a phone;
 *  - the page card: the same rows with room to show every step by name.
 *
 * Each paper keeps the full ten-step pipeline. Folded, the steps are a
 * ten-segment bar; unfolded, a stepper - horizontal where there is width for
 * ten labels, vertical where there is not - so nothing needs sideways scroll.
 */

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";
import {
  describeRunFailure,
  getRunDisplayTitle,
  getRunStageCaption,
  getRunStageMessage,
  getRunStatusLabel,
} from "@/lib/ingestion-status";
import {
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CloseIcon,
  FullscreenIcon,
  InfoIcon,
  SpinnerIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@/components/ui/Icons";
import {
  buttonClass,
  chipClass,
  floatingPanelClass,
  iconButtonClass,
  panelClass,
  type ChipTone,
} from "@/components/ui/controls";

type StageStatus = "done" | "active" | "waiting" | "failed";
type OverallTone = "active" | "done" | "failed";

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
    label: "Prepare",
    stages: ["preparing", "downloading"],
  },
  {
    key: "extract",
    label: "Read text",
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

const STATE_WORD: Record<StageStatus, string> = {
  done: "Done",
  active: "In progress",
  waiting: "Waiting",
  failed: "Stopped here",
};

const SEGMENT_TONE: Record<StageStatus, string> = {
  done: "bg-ink",
  active: "bg-ink/15",
  waiting: "bg-hairline-strong",
  failed: "bg-red-500",
};

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

function stageStates(run: IngestionRunRow): StageStatus[] {
  return TIMELINE_STAGES.map((stage, index) => getTimelineStatus(run, stage, index));
}

/** How far one paper is, from 0 to 1. A finished or failed paper counts as 1. */
function runProgress(run: IngestionRunRow): number {
  if (run.status === "succeeded" || run.status === "failed") return 1;
  return getStageIndex(run) / (TIMELINE_STAGES.length - 1);
}

function analysisOverview(runs: IngestionRunRow[]) {
  const summary = summarizeRuns(runs);
  const active = summary.queued + summary.processing;
  const terminal = runs.length > 0 && active === 0;
  const progress = runs.length
    ? runs.reduce((total, run) => total + runProgress(run), 0) / runs.length
    : 0;
  const tone: OverallTone = !terminal ? "active" : summary.failed > 0 ? "failed" : "done";
  const plural = summary.total === 1 ? "" : "s";
  const headline = terminal
    ? summary.failed > 0
      ? `${summary.succeeded} of ${summary.total} paper${plural} analyzed`
      : `${summary.total === 1 ? "Your paper is" : `All ${summary.total} papers are`} ready`
    : `Analyzing ${summary.total} paper${plural}`;
  const counts = (
    [
      [summary.processing, "analyzing"],
      [summary.queued, "waiting"],
      [summary.succeeded, "ready"],
      [summary.failed, "failed"],
    ] as Array<[number, string]>
  )
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(" · ");
  return { summary, active, terminal, progress, tone, headline, counts };
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

/* ------------------------------------------------------------ small parts */

/** A ring that fills as the batch advances; a check or a warning once it ends. */
function ProgressRing({ value, tone, size = 20 }: { value: number; tone: OverallTone; size?: number }) {
  if (tone === "done") {
    return (
      <span className="flex flex-none" style={{ width: size, height: size }} aria-hidden="true">
        <CheckCircleIcon weight="fill" className="h-full w-full text-emerald-600 dark:text-emerald-400" />
      </span>
    );
  }
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0.06, Math.min(1, value));
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className="flex-none -rotate-90"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r={radius} fill="none" strokeWidth="2.25" className="stroke-hairline-strong" />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - filled)}
        className={`transition-[stroke-dashoffset] duration-700 ease-out-expo ${
          tone === "failed" ? "stroke-red-600 dark:stroke-red-400" : "stroke-ink"
        }`}
      />
    </svg>
  );
}

function RunGlyph({ run }: { run: IngestionRunRow }) {
  return (
    <span className="flex h-5 w-5 flex-none items-center justify-center" aria-hidden="true">
      {run.status === "succeeded" ? (
        <CheckCircleIcon weight="fill" className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-400" />
      ) : run.status === "failed" ? (
        <WarningCircleIcon weight="fill" className="h-[18px] w-[18px] text-red-600 dark:text-red-400" />
      ) : run.status === "processing" ? (
        <SpinnerIcon className="h-4 w-4 text-ink" />
      ) : (
        <ClockIcon className="h-[18px] w-[18px] text-mute" />
      )}
    </span>
  );
}

function statusChipTone(run: IngestionRunRow): ChipTone {
  if (run.status === "succeeded") return "success";
  if (run.status === "failed") return "danger";
  if (run.status === "processing") return "accent";
  return "neutral";
}

/** The ten steps, folded into ten segments. */
function StepBar({ states }: { states: StageStatus[] }) {
  return (
    <div className="flex gap-[3px]" aria-hidden="true">
      {states.map((status, index) => (
        <span
          key={TIMELINE_STAGES[index].key}
          title={`${TIMELINE_STAGES[index].label}: ${STATE_WORD[status]}`}
          className={`relative h-1 flex-1 overflow-hidden rounded-full transition-colors duration-500 ease-out-expo ${SEGMENT_TONE[status]}`}
        >
          {status === "active" ? (
            <span className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-ink/70 motion-safe:animate-progress-sweep motion-reduce:w-full motion-reduce:bg-ink/40" />
          ) : null}
        </span>
      ))}
    </div>
  );
}

function StepNode({ status }: { status: StageStatus }) {
  const ring = "relative z-10 flex h-5 w-5 flex-none items-center justify-center rounded-full transition-colors duration-500 ease-out-expo";
  if (status === "done") {
    return (
      <span className={`${ring} bg-ink text-canvas`}>
        <CheckIcon weight="bold" className="h-3 w-3" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${ring} bg-red-600 text-white dark:bg-red-500`}>
        <CloseIcon weight="bold" className="h-3 w-3" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className={`${ring} border-[1.5px] border-ink bg-surface`}>
        <span className="h-2 w-2 rounded-full bg-ink motion-safe:animate-pulse" />
      </span>
    );
  }
  return (
    <span className={`${ring} border border-hairline-strong bg-surface`}>
      <span className="h-1.5 w-1.5 rounded-full bg-hairline-strong" />
    </span>
  );
}

/** Every step by name, top to bottom: the tray and narrow screens. */
function StepList({ run, states }: { run: IngestionRunRow; states: StageStatus[] }) {
  return (
    <ol aria-label="Analysis steps">
      {TIMELINE_STAGES.map((stage, index) => {
        const status = states[index];
        const last = index === TIMELINE_STAGES.length - 1;
        return (
          <li
            key={stage.key}
            className="relative flex gap-3 pb-3 last:pb-0"
            aria-current={status === "active" ? "step" : undefined}
          >
            {!last ? (
              <span
                aria-hidden="true"
                className={`absolute bottom-0 left-[9.5px] top-5 w-px transition-colors duration-500 ${
                  status === "done" ? "bg-ink" : "bg-hairline-strong"
                }`}
              />
            ) : null}
            <StepNode status={status} />
            <div className="min-w-0 flex-1 pt-px">
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[13px] font-medium ${status === "waiting" ? "text-mute" : "text-ink"}`}>
                  {stage.label}
                </span>
                <span
                  className={`flex-none text-xs ${
                    status === "failed" ? "text-red-700 dark:text-red-300" : "text-mute"
                  }`}
                >
                  {STATE_WORD[status]}
                </span>
              </div>
              {status === "active" ? (
                <p className="mt-0.5 text-[13px] leading-5 text-body">{getRunStageMessage(run)}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Every step by name, left to right: the page card on a wide screen. */
function StepTrack({ states }: { states: StageStatus[] }) {
  const short: Record<StageStatus, string> = { done: "Done", active: "Now", waiting: "", failed: "Stopped" };
  return (
    <ol className="grid grid-cols-10" aria-label="Analysis steps">
      {TIMELINE_STAGES.map((stage, index) => {
        const status = states[index];
        return (
          <li
            key={stage.key}
            className="relative flex flex-col items-center text-center"
            aria-current={status === "active" ? "step" : undefined}
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={`absolute left-0 right-1/2 top-[9.5px] h-px transition-colors duration-500 ${
                  states[index - 1] === "done" ? "bg-ink" : "bg-hairline-strong"
                }`}
              />
            ) : null}
            {index < TIMELINE_STAGES.length - 1 ? (
              <span
                aria-hidden="true"
                className={`absolute left-1/2 right-0 top-[9.5px] h-px transition-colors duration-500 ${
                  status === "done" ? "bg-ink" : "bg-hairline-strong"
                }`}
              />
            ) : null}
            <StepNode status={status} />
            <span
              className={`mt-2 px-0.5 text-xs font-medium leading-4 ${
                status === "waiting" ? "text-mute" : "text-ink"
              }`}
            >
              {stage.label}
            </span>
            <span
              className={`mt-0.5 h-4 text-[11px] leading-4 ${
                status === "failed" ? "text-red-700 dark:text-red-300" : "text-mute"
              }`}
            >
              {short[status]}
              <span className="sr-only">{status === "waiting" ? STATE_WORD.waiting : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RunMetrics({ run }: { run: IngestionRunRow }) {
  const metrics = readMetrics(run);
  const queueWait = formatSeconds(metrics.queue_wait_seconds);
  const graph = formatSeconds(metrics.graph_seconds);
  const total = formatSeconds(metrics.total_worker_seconds);
  const values = [
    queueWait ? ["Waited", queueWait] : null,
    graph ? ["Analysis", graph] : null,
    total ? ["Total", total] : null,
  ].filter(Boolean) as Array<[string, string]>;
  if (values.length === 0) return null;
  return (
    <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
      {values.map(([label, value]) => (
        <div key={label} className="flex gap-1.5">
          <dt>{label}</dt>
          <dd className="font-mono tabular-nums text-body">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notice({ tone, children }: { tone: "warning" | "info"; children: ReactNode }) {
  const Icon = tone === "warning" ? WarningIcon : InfoIcon;
  return (
    <div
      role="status"
      className={`flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-5 ${
        tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200"
          : "border-hairline bg-subtle text-body"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 flex-none" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- one paper */

function RunRow({
  run,
  wide,
  defaultOpen,
  onCancelRun,
}: {
  run: IngestionRunRow;
  /** The page card: a horizontal stepper once the screen is wide enough. */
  wide: boolean;
  defaultOpen: boolean;
  onCancelRun?: (runId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const detailId = useId();
  const states = stageStates(run);
  const title = getRunDisplayTitle(run);
  const active = run.status === "queued" || run.status === "processing";
  const stepStartedMs = getRunStageEpochMs(run);
  const onThisStep =
    run.status === "processing" && stepStartedMs > 0
      ? formatDurationMinutes(Math.floor((Date.now() - stepStartedMs) / 60000))
      : "";
  const failure = run.status === "failed" ? describeRunFailure(run.error_message) : "";

  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <RunGlyph run={run} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-ink" title={title}>
              {title}
            </p>
            <div className="-mt-0.5 flex flex-none items-center gap-1">
              <span className={chipClass(statusChipTone(run))}>{getRunStatusLabel(run)}</span>
              {onCancelRun && active ? (
                <button
                  type="button"
                  onClick={() => void onCancelRun(run.id)}
                  className={iconButtonClass("sm")}
                  aria-label={`Cancel analysis for ${title}`}
                  title="Cancel analysis"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-0.5 text-[13px] leading-5 text-body">
            {getRunStageMessage(run)}
            {active ? (
              <span className="tabular-nums text-mute">
                {" "}
                · Step {getStageIndex(run) + 1} of {TIMELINE_STAGES.length}
              </span>
            ) : null}
          </p>
          {onThisStep ? (
            <p className="mt-0.5 text-xs text-mute">On this step for {onThisStep}</p>
          ) : null}

          {failure ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <p className="font-medium">{failure}</p>
              {run.error_message && run.error_message.trim() !== failure ? (
                <p className="mt-1 break-words font-mono text-xs opacity-80">{run.error_message}</p>
              ) : null}
            </div>
          ) : null}

          <div
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out-expo ${
              open ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
            }`}
            aria-hidden="true"
          >
            <div className="min-h-0 overflow-hidden">
              <div className="pt-3">
                <StepBar states={states} />
              </div>
            </div>
          </div>

          <div
            id={detailId}
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out-expo ${
              open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
            aria-hidden={!open}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="pt-4">
                {wide ? (
                  <>
                    <div className="hidden md:block">
                      <StepTrack states={states} />
                    </div>
                    <div className="md:hidden">
                      <StepList run={run} states={states} />
                    </div>
                  </>
                ) : (
                  <StepList run={run} states={states} />
                )}
                {!failure ? (
                  <p className="mt-4 text-[13px] leading-5 text-mute">{getRunStageCaption(run)}</p>
                ) : null}
                <RunMetrics run={run} />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={detailId}
            className="mt-2 inline-flex items-center gap-1 rounded-md py-1 text-xs font-medium text-mute transition-colors duration-150 hover:text-ink"
          >
            {open ? "Hide steps" : "Show all steps"}
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform duration-200 ease-out-quart ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>
    </li>
  );
}

function LoadingRows({ loading }: { loading?: boolean }) {
  return (
    <li className="py-4">
      <div className="flex gap-3">
        <span className="skeleton h-5 w-5 flex-none rounded-full" />
        <div className="flex-1 space-y-2.5">
          <span className="skeleton block h-4 w-2/3" />
          <span className="skeleton block h-3 w-1/3" />
          <span className="skeleton block h-1 w-full" />
        </div>
      </div>
      <p className="mt-3 text-xs text-mute" role="status">
        {loading ? "Loading progress..." : "Waiting for the first progress update."}
      </p>
    </li>
  );
}

/* ------------------------------------------------------------- the pill */

export function AnalysisTrayPill({
  runs,
  onOpen,
}: {
  runs: IngestionRunRow[];
  onOpen: () => void;
}) {
  const { summary, terminal, progress, tone } = analysisOverview(runs);
  const plural = summary.total === 1 ? "" : "s";
  const label = !terminal
    ? `Analyzing ${summary.total} paper${plural}`
    : summary.failed > 0
      ? `${summary.failed} of ${summary.total} failed`
      : `${summary.total} paper${plural} ready`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open analysis progress: ${label}`}
      title="Open analysis progress"
      className="group pointer-events-auto inline-flex h-11 max-w-full items-center gap-2.5 rounded-full border border-hairline bg-surface pl-3 pr-3.5 text-sm font-medium text-ink shadow-float transition-[border-color,transform] duration-150 ease-out-quart hover:border-hairline-strong active:scale-[0.98] motion-safe:animate-rise-in"
    >
      <ProgressRing value={progress} tone={tone} size={20} />
      <span className="truncate">{label}</span>
      {!terminal ? (
        <span className="tabular-nums text-mute">{Math.round(progress * 100)}%</span>
      ) : null}
      <ChevronUpIcon className="h-3.5 w-3.5 flex-none text-mute transition-transform duration-200 ease-out-quart group-hover:-translate-y-0.5" />
    </button>
  );
}

/* ------------------------------------------------------ the tray and card */

export default function AnalysisStatusCard({
  runs,
  folderJob,
  loading,
  compact = false,
  onMinimize,
  onExpand,
  onCollapse,
  onClear,
  onCancelRun,
  onCancelAll,
  onRetryQueue,
  onStartProcessing,
}: {
  runs: IngestionRunRow[];
  folderJob?: FolderAnalysisJobRow | null;
  loading?: boolean;
  /** The floating tray rather than the page card. */
  compact?: boolean;
  onMinimize?: () => void;
  /** Tray: open the full progress on Home. */
  onExpand?: () => void;
  /** Tray: fold back into the pill. */
  onCollapse?: () => void;
  onClear?: () => void;
  onCancelRun?: (runId: string) => void | Promise<void>;
  onCancelAll?: () => void | Promise<void>;
  onRetryQueue?: () => void | Promise<void>;
  onStartProcessing?: () => void | Promise<void>;
}) {
  const headingId = useId();
  const { summary, active, terminal: allTerminal, progress, tone, headline, counts } = analysisOverview(runs);
  const hasActiveRuns = active > 0;
  const hasQueuedWithoutProcessing = summary.queued > 0 && summary.processing === 0;
  const leadRun =
    runs.find((run) => run.status === "processing") ??
    runs.find((run) => run.status === "queued") ??
    runs[0];
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
  const staleLabel = `${Math.floor(staleMinutes)} minute${Math.floor(staleMinutes) === 1 ? "" : "s"}`;

  const notices = (
    <>
      {isLikelyStalled ? (
        <Notice tone="warning">
          Nothing has moved for about {staleLabel}. Use Retry processing to start the analysis again.
        </Notice>
      ) : null}
      {isLongRunningStage ? (
        <Notice tone="info">
          Still working. This step has been running for about {stageDurationLabel}; long papers can
          spend several minutes on one step before the next update.
        </Notice>
      ) : null}
    </>
  );

  const rows =
    runs.length === 0 ? (
      <LoadingRows loading={loading} />
    ) : (
      runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          wide={!compact}
          defaultOpen={compact ? runs.length === 1 : runs.length <= 3 || run.id === leadRun?.id}
          onCancelRun={onCancelRun}
        />
      ))
    );

  if (compact) {
    const hasFooter =
      (hasActiveRuns && onCancelAll) ||
      (isLikelyStalled && onRetryQueue) ||
      (hasQueuedWithoutProcessing && onStartProcessing);
    return (
      <section
        aria-labelledby={headingId}
        className={`${floatingPanelClass} pointer-events-auto flex max-h-[min(72dvh,600px)] origin-bottom-right flex-col overflow-hidden motion-safe:animate-scale-in`}
      >
        <header className="flex items-center gap-3 border-b border-hairline py-2.5 pl-4 pr-2">
          <ProgressRing value={progress} tone={tone} size={22} />
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="truncate text-sm font-semibold text-ink">
              {headline}
            </h2>
            <p className="truncate text-xs tabular-nums text-mute" aria-live="polite">
              {loading ? "Refreshing status..." : counts || "Starting..."}
            </p>
          </div>
          {onExpand ? (
            <button
              type="button"
              onClick={onExpand}
              className={iconButtonClass("md")}
              aria-label="Open the full analysis progress"
              title="Open full progress"
            >
              <FullscreenIcon className="h-4 w-4" />
            </button>
          ) : null}
          {allTerminal && onClear ? (
            <button
              type="button"
              onClick={onClear}
              className={iconButtonClass("md")}
              aria-label="Dismiss analysis status"
              title="Dismiss"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          ) : null}
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className={iconButtonClass("md")}
              aria-label="Minimize analysis progress"
              title="Minimize"
            >
              <ChevronDownIcon className="h-4 w-4" />
            </button>
          ) : null}
        </header>
        {isLikelyStalled || isLongRunningStage ? (
          <div className="space-y-2 px-4 pt-3">{notices}</div>
        ) : null}
        <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto overscroll-contain px-4">
          {rows}
        </ul>
        {hasFooter ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-4 py-2.5">
            {hasActiveRuns && onCancelAll ? (
              <button
                type="button"
                onClick={() => void onCancelAll()}
                className={buttonClass("ghost", "sm", "mr-auto text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200")}
                aria-label="Cancel all active analysis runs"
              >
                Cancel all
              </button>
            ) : null}
            {isLikelyStalled && onRetryQueue ? (
              <button type="button" onClick={() => void onRetryQueue()} className={buttonClass("primary", "sm")}>
                Retry processing
              </button>
            ) : null}
            {hasQueuedWithoutProcessing && onStartProcessing ? (
              <button type="button" onClick={() => void onStartProcessing()} className={buttonClass("primary", "sm")}>
                Start now
              </button>
            ) : null}
          </footer>
        ) : null}
      </section>
    );
  }

  const description = allTerminal
    ? summary.failed > 0
      ? "Papers that failed say why below. Add them again from the Library once the problem is fixed."
      : "Finished papers are in the Library and on the Dashboard, and Chat can cite them."
    : "Each paper is read for its title, year, topics, methods and category, usually in a few minutes. This updates by itself, and you can leave the page while it runs.";
  const percent = Math.round(progress * 100);

  return (
    <section aria-labelledby={headingId} className={`${panelClass} overflow-hidden`}>
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-subtle">
              <ProgressRing value={progress} tone={tone} size={22} />
            </span>
            <div className="min-w-0">
              <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
                {headline}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-body">{description}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:flex-none lg:justify-end">
            {isLikelyStalled && onRetryQueue ? (
              <button
                type="button"
                onClick={() => void onRetryQueue()}
                className={buttonClass("primary")}
                aria-label="Retry stalled analysis queue"
              >
                Retry processing
              </button>
            ) : null}
            {hasQueuedWithoutProcessing && onStartProcessing ? (
              <button
                type="button"
                onClick={() => void onStartProcessing()}
                className={buttonClass("primary")}
                aria-label="Start queued analysis processing now"
              >
                Start processing now
              </button>
            ) : null}
            {allTerminal && onClear ? (
              <button type="button" onClick={onClear} className={buttonClass("primary")}>
                Dismiss
              </button>
            ) : null}
            {/* Was "Open imports" pointing at /workspace/imports, which redirects to
                /workspace/library. The label promised a view that does not exist. */}
            <Link href="/workspace/library" className={buttonClass("secondary")}>
              Open repositories
            </Link>
            {onMinimize ? (
              <button type="button" onClick={onMinimize} className={buttonClass("secondary")}>
                Minimize
              </button>
            ) : null}
            {hasActiveRuns && onCancelAll ? (
              <button
                type="button"
                onClick={() => void onCancelAll()}
                className={buttonClass("ghost", "md", "text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200")}
                aria-label="Cancel all active analysis runs"
              >
                Cancel all
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between gap-4 text-xs tabular-nums text-mute">
            <span aria-live="polite">{loading && runs.length === 0 ? "Loading progress..." : counts || "Starting..."}</span>
            <span>{percent}%</span>
          </div>
          <div
            className="mt-2 h-1 overflow-hidden rounded-full bg-hairline"
            role="progressbar"
            aria-label="Overall analysis progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className={`h-full origin-left rounded-full transition-transform duration-700 ease-out-expo ${
                tone === "failed" ? "bg-red-500" : tone === "done" ? "bg-emerald-500" : "bg-ink"
              }`}
              style={{ transform: `scaleX(${Math.max(0.02, progress)})` }}
            />
          </div>
        </div>

        {isLikelyStalled || isLongRunningStage || folderJob ? (
          <div className="mt-5 space-y-2">
            {notices}
            {folderJob ? (
              <div className="rounded-lg bg-subtle px-3.5 py-3 text-[13px] leading-5">
                <p className="font-medium text-ink">
                  This upload
                  <span className="font-normal text-body"> · {folderJob.progress_message || folderJob.status}</span>
                </p>
                {folderJob.progress_detail ? (
                  <p className="mt-1 text-mute">{folderJob.progress_detail}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="divide-y divide-hairline border-t border-hairline px-5 sm:px-6">{rows}</ul>
    </section>
  );
}
