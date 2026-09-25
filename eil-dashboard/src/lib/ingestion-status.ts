import type { IngestionRunRow } from "@/types/database";

type RunLike = Pick<
  IngestionRunRow,
  "status" | "model" | "input_payload" | "error_message"
>;

type NamedRun = Pick<IngestionRunRow, "display_name" | "source_filename" | "input_payload" | "paper_title">;

/**
 * The paper's own title once it has been analysed: the Library joins it from
 * the paper row, and the worker also stores it on the run.
 */
export function getRunPaperTitle(run: NamedRun): string {
  const joined = typeof run.paper_title === "string" ? run.paper_title.trim() : "";
  if (joined) return joined;
  const stored = run.input_payload?.paper_title;
  return typeof stored === "string" ? stored.trim() : "";
}

/**
 * What a reader calls the paper: a name they gave the file wins, then the
 * paper's title, then the file it came from.
 *
 * An upload starts with display_name set to the file's own name, so only a
 * display name that differs from it is one the reader chose.
 */
export function getRunDisplayTitle(run: NamedRun, fallback = "Untitled paper"): string {
  const displayName = run.display_name?.trim() ?? "";
  const fileName = run.source_filename?.trim() ?? "";
  const chosenName = displayName && displayName !== fileName ? displayName : "";
  return chosenName || getRunPaperTitle(run) || fileName || displayName || fallback;
}

/** A status word for a person, not the queue's own state name. */
export function getRunStatusLabel(run: Pick<IngestionRunRow, "status">): string {
  switch (run.status) {
    case "succeeded":
      return "Ready";
    case "failed":
      return "Failed";
    case "processing":
      return "Analyzing";
    default:
      return "Queued";
  }
}

const AUTO_MODEL_VALUES = new Set([
  "",
  "auto",
  "automatic",
  "automatic-task-routing",
  "task-routed",
  "task_routed",
]);

function readInputPayloadString(run: RunLike, key: string): string {
  const value = run.input_payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function getRunModelLabel(run: RunLike): string {
  const payloadLabel = readInputPayloadString(run, "analysis_label");
  if (payloadLabel) {
    return payloadLabel;
  }

  const model = (run.model ?? "").trim();
  if (!model || AUTO_MODEL_VALUES.has(model.toLowerCase())) {
    return "Automatic per-task model routing";
  }

  return model;
}

export function getRunStageMessage(run: RunLike): string {
  if (run.status === "failed") {
    return "Analysis failed";
  }
  if (run.status === "succeeded") {
    return "Analysis complete";
  }

  const explicit = readInputPayloadString(run, "progress_message");
  if (explicit) {
    return explicit;
  }

  const stage = readInputPayloadString(run, "progress_stage").toLowerCase();
  switch (stage) {
    case "uploading":
      return "Uploading file";
    case "queued":
      return "Queued for analysis";
    case "queued_waiting_for_worker":
      return "Waiting for the analysis service to start";
    case "queued_but_unstarted":
      return "Queued, but analysis has not started";
    case "preparing":
      return "Preparing file for analysis";
    case "downloading":
      return "Downloading source file";
    case "starting_analysis":
      return "Starting the analysis pipeline";
    case "extracting":
    case "extracting_text":
      return "Extracting text from the PDF";
    case "cleaning_text":
      return "Cleaning and routing extracted text";
    case "translating_text":
      return "Translating non-English content";
    case "structuring_sections":
      return "Structuring paper sections";
    case "inferring_metadata":
      return "Inferring title and publication metadata";
    case "extracting_author_keywords":
      return "Extracting author-provided keywords";
    case "extracting_keywords":
      return "Extracting grounded keywords";
    case "grouping_topics":
      return "Grouping keywords into topics";
    case "labeling_topics":
      return "Labeling topic trends";
    case "classifying_tracks":
      return "Classifying research categories";
    case "classifying_typology":
      return "Classifying research typology";
    case "extracting_facets":
      return "Extracting research facets";
    case "building_dataset":
      return "Building the workspace dataset";
    case "saving":
      return "Saving results to the workspace";
    case "completed":
      return "Analysis complete";
    case "failed":
      return "Analysis failed";
    default:
      return run.status === "processing" ? "Analyzing paper" : "Queued for analysis";
  }
}

/**
 * Signatures of a message written for a stack trace rather than for a person.
 *
 * Most worker failures already read as sentences - "No extractable text was
 * found in the PDF." - and those are shown unchanged, because they say exactly
 * what happened. What a reader should never meet is the transport exception
 * underneath them, which arrives raw from the storage client:
 *
 *   Timeout of 90.0s exceeded, last exception: HTTPSConnectionPool(
 *   host='storage.googleapis.com', port=443): Max retries exceeded...
 *
 * That was the most prominent line under "Analysis failed" on the first screen
 * after signing in.
 */
const WRITTEN_FOR_A_STACK_TRACE =
  /HTTPSConnectionPool|Max retries|urllib3|Traceback|port=\d+|object at 0x|[A-Za-z]{3,}Error\(|SSLError/;

/**
 * What to show a reader when a run failed.
 *
 * The raw text is not discarded - `AnalysisStatusCard` and the History page
 * still print it underneath, because someone diagnosing a run wants the
 * original. This is only the sentence that leads.
 */
export function describeRunFailure(raw: string | null | undefined): string {
  const message = String(raw ?? "").trim();
  if (!message) return "The worker stopped before this file could finish.";
  if (!WRITTEN_FOR_A_STACK_TRACE.test(message)) return message;
  if (/timeout|timed out|max retries/i.test(message)) {
    return "This file took too long to download, so the run timed out. Trying it again usually works.";
  }
  return "The analysis stopped on a network or storage error. Trying it again usually works.";
}

export function getRunStageCaption(run: RunLike): string {
  if (run.status === "failed") {
    return describeRunFailure(run.error_message);
  }

  const detail = readInputPayloadString(run, "progress_detail");
  if (detail) {
    return detail;
  }

  if (run.status === "succeeded") {
    return "The workspace can now use this paper in dashboard views, papers, and chat.";
  }

  return "This updates by itself as the paper moves through each step.";
}
