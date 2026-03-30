import type { IngestionRunRow } from "@/types/database";

type RunLike = Pick<
  IngestionRunRow,
  "status" | "model" | "input_payload" | "error_message"
>;

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
    case "queued":
      return "Queued for analysis";
    case "preparing":
      return "Preparing file for analysis";
    case "downloading":
      return "Downloading source file";
    case "extracting":
      return "Extracting text and analyzing paper";
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

export function getRunStageCaption(run: RunLike): string {
  if (run.status === "failed") {
    return run.error_message?.trim() || "The worker stopped before this file could finish.";
  }

  const detail = readInputPayloadString(run, "progress_detail");
  if (detail) {
    return detail;
  }

  if (run.status === "succeeded") {
    return "The workspace can now use this paper in dashboard views, papers, and chat.";
  }

  return "The worker updates this step automatically while the file moves through the pipeline.";
}
