"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import AnalysisProfileEditor, { profileSummary } from "@/components/workspace/AnalysisProfileEditor";
import { createGeneralAnalysisProfile, sanitizeProjectAnalysisProfile, toIngestionAnalysisProfile } from "@/lib/project-analysis-profile";
import Modal from "@/components/ui/Modal";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CloseIcon,
  FileIcon,
  UploadIcon,
} from "@/components/ui/Icons";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";
import { fingerprintFiles } from "@/lib/client-file-hash";
import { putFileWithRetry } from "@/lib/upload-retry";
import type { ProjectAnalysisProfile } from "@/types/workspace";

const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_FILES = 50;
const PROJECT_ANALYSIS_PROFILES_ENABLED =
  process.env.NEXT_PUBLIC_PROJECT_ANALYSIS_PROFILES_ENABLED === "true";
/** The folder every upload lands in; repositories no longer have visible folders. */
const INTERNAL_FOLDER_NAME = "Repository";
const SOURCE_KIND = "pdf-upload";

async function readJsonPayload<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

interface AnalyzeFlowModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * The repository the papers go to. Defaults to the one the workspace is set
   * to; the Library passes the repository being browsed, which can differ.
   */
  projectId?: string | null;
  onCreated?: (
    runs: IngestionRunRow[],
    context: {
      folder: string;
      folderId?: string | null;
      folderJob?: FolderAnalysisJobRow | null;
      sourceKind: string;
    }
  ) => void;
}

type QueuedSummary = {
  count: number;
  firstName: string;
  failedCount: number;
  projectName: string;
  warning?: string | null;
};

export default function AnalyzeFlowModal({
  open,
  onClose,
  projectId,
  onCreated,
}: AnalyzeFlowModalProps) {
  const router = useRouter();
  const { session, user } = useAuth();
  const { selectedProjectId, currentProject, allProjects, updateProjectAnalysisProfile } = useWorkspaceProfile();
  const targetProject =
    (projectId ? allProjects.find((project) => project.id === projectId) : null) ?? currentProject;
  const targetProjectId = targetProject?.id ?? selectedProjectId;
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedSummary, setQueuedSummary] = useState<QueuedSummary | null>(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProjectAnalysisProfile>(createGeneralAnalysisProfile);
  const [savingProfile, setSavingProfile] = useState(false);
  const [previousProfileCount, setPreviousProfileCount] = useState(0);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    setProfileDraft(targetProject?.analysis_profile ?? createGeneralAnalysisProfile());
    setProfileError(null);
  }, [targetProject]);

  useEffect(() => {
    if (!PROJECT_ANALYSIS_PROFILES_ENABLED || !open || !targetProject?.id || !session?.access_token) {
      setPreviousProfileCount(0);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/workspace/projects/${encodeURIComponent(targetProject.id)}/analysis-profile`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<{ coverage?: { previousProfile?: number } }> : null)
      .then((payload) => setPreviousProfileCount(Number(payload?.coverage?.previousProfile ?? 0)))
      .catch((coverageError) => {
        if ((coverageError as Error).name !== "AbortError") setPreviousProfileCount(0);
      });
    return () => controller.abort();
  }, [targetProject?.analysis_profile_hash, targetProject?.id, open, session?.access_token]);

  const activeAnalysisProfile = targetProject?.analysis_profile ?? createGeneralAnalysisProfile();
  const projectName = targetProject?.name ?? "this repository";

  function selectPdfFiles(nextFiles: File[]) {
    const validFiles = nextFiles.filter((file) =>
      (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
      && file.size <= MAX_UPLOAD_FILE_BYTES
    );
    const rejected = nextFiles.length - validFiles.length;
    const candidates = [...files, ...validFiles];
    const unique = candidates.filter((file, index, rows) =>
      rows.findIndex((candidate) =>
        candidate.name === file.name
        && candidate.size === file.size
        && candidate.lastModified === file.lastModified
      ) === index
    );
    if (unique.length > MAX_UPLOAD_FILES) {
      setError(`Only the first ${MAX_UPLOAD_FILES} PDFs were kept. Add the rest in another upload.`);
    } else if (rejected > 0) {
      setError(`${rejected} file${rejected === 1 ? " was" : "s were"} skipped. Only PDFs of 10 MB or less can be added.`);
    } else {
      setError(null);
    }
    setFiles(unique.slice(0, MAX_UPLOAD_FILES));
  }

  if (!open) {
    return null;
  }

  function handleClose() {
    if (!uploading) {
      setQueuedSummary(null);
      setFiles([]);
      setError(null);
    }
    onClose();
  }

  async function handleAnalyze() {
    if (!user || !session?.access_token) {
      setError("Sign in before adding papers.");
      return;
    }
    if (!targetProjectId) {
      setError("Choose a repository before adding papers.");
      return;
    }
    if (files.length === 0) {
      setError("Choose at least one PDF.");
      return;
    }

    setUploading(true);
    setUploadStage("Preparing upload");
    setUploadProgress(null);
    setError(null);

    try {
      const analysisProfile = toIngestionAnalysisProfile(activeAnalysisProfile);
      const oversizedFiles = files.filter((file) => file.size > MAX_UPLOAD_FILE_BYTES);
      if (oversizedFiles.length > 0) {
        throw new Error(`Each PDF must be 10 MB or smaller (${plural(oversizedFiles.length, "file")} too large).`);
      }

      setUploadStage("Checking for papers already in your library");
      const fingerprints = await fingerprintFiles(files, (completed, total) => {
        setUploadStage(`Checking for papers already in your library (${completed}/${total})`);
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      };

      const prepareResponse = await fetch("/api/admin/import/prepare", {
        method: "POST",
        headers,
        body: JSON.stringify({
          folder: INTERNAL_FOLDER_NAME,
          source_kind: SOURCE_KIND,
          project_id: targetProjectId,
          analysis_profile: analysisProfile,
          files: files.map((file, fileIndex) => ({
            fileIndex,
            name: file.name,
            size: file.size,
            type: file.type || "application/pdf",
            sha256: fingerprints[fileIndex],
          })),
        }),
      });

      const preparePayload = await readJsonPayload<{
        runs?: IngestionRunRow[];
        folderJob?: FolderAnalysisJobRow | null;
        uploads?: Array<{
          fileIndex: number;
          runId: string;
          storagePath: string;
          signedUrl: string;
          uploadHeaders?: Record<string, string>;
          fileName: string;
        }>;
        error?: string;
      }>(prepareResponse);

      if (!prepareResponse.ok || !preparePayload?.folderJob || !preparePayload.uploads) {
        throw new Error(
          preparePayload?.error ??
            `The upload could not be prepared (status ${prepareResponse.status}). Try again in a moment.`
        );
      }

      const uploads = preparePayload.uploads;
      setUploadStage(`Uploading ${plural(uploads.length, "PDF")}`);
      setUploadProgress({ done: 0, total: uploads.length });

      const uploaded: Array<{ runId: string; storagePath: string; fileName: string }> = [];
      const failed: Array<{ runId: string; storagePath: string; fileName: string; errorMessage: string }> = [];

      for (const uploadTarget of uploads) {
        const file = files[uploadTarget.fileIndex];
        if (!file) {
          failed.push({
            runId: uploadTarget.runId,
            storagePath: uploadTarget.storagePath,
            fileName: uploadTarget.fileName,
            errorMessage: "The selected file could not be matched to its upload.",
          });
        } else {
          try {
            await putFileWithRetry(uploadTarget.signedUrl, file, {
              "Content-Type": file.type || "application/pdf",
              ...(uploadTarget.uploadHeaders ?? { "x-upsert": "false" }),
            });
            uploaded.push({
              runId: uploadTarget.runId,
              storagePath: uploadTarget.storagePath,
              fileName: uploadTarget.fileName,
            });
          } catch (uploadError) {
            failed.push({
              runId: uploadTarget.runId,
              storagePath: uploadTarget.storagePath,
              fileName: uploadTarget.fileName,
              errorMessage:
                uploadError instanceof Error ? uploadError.message : "The file could not be uploaded.",
            });
          }
        }
        setUploadProgress({ done: uploaded.length + failed.length, total: uploads.length });
      }

      setUploadStage("Starting the analysis");
      const finalizeResponse = await fetch("/api/admin/import/finalize", {
        method: "POST",
        headers,
        body: JSON.stringify({
          folderJobId: preparePayload.folderJob.id,
          uploaded,
          failed,
        }),
      });

      const finalizePayload = await readJsonPayload<{
        runs?: IngestionRunRow[];
        folderJob?: FolderAnalysisJobRow | null;
        warning?: string | null;
        error?: string;
      }>(finalizeResponse);

      if (!finalizeResponse.ok) {
        throw new Error(
          finalizePayload?.error ??
            `The upload finished but analysis could not be started (status ${finalizeResponse.status}).`
        );
      }

      const finalizedRuns = finalizePayload?.runs ?? [];
      const queuedRuns = finalizedRuns.filter((run) => run.status !== "failed");
      const folderJob = finalizePayload?.folderJob ?? null;

      if (finalizedRuns.length > 0) {
        onCreated?.(finalizedRuns, {
          folder: INTERNAL_FOLDER_NAME,
          folderId: folderJob?.folder_id ?? null,
          folderJob,
          sourceKind: SOURCE_KIND,
        });
      }

      if (queuedRuns.length === 0) {
        throw new Error(
          `None of the files could be uploaded${failed[0]?.errorMessage ? `: ${failed[0].errorMessage}` : "."} Check the connection and try again.`
        );
      }

      setQueuedSummary({
        count: queuedRuns.length,
        firstName: queuedRuns[0]?.display_name || queuedRuns[0]?.source_filename || files[0]?.name || "Your PDF",
        failedCount: failed.length,
        projectName,
        warning: finalizePayload?.warning ?? null,
      });
      setFiles([]);
      setError(null);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "The papers could not be added."
      );
    } finally {
      setUploading(false);
      setUploadStage("");
      setUploadProgress(null);
    }
  }

  const secondaryButtonClass =
    "inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white";
  const primaryButtonClass =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-[#f3f3f3] dark:text-[#171717] dark:hover:bg-white dark:disabled:bg-[#3a3a3a] dark:disabled:text-[#7e7e7e]";
  const panelClass =
    "flex max-h-[calc(100dvh-1.5rem)] w-[min(36rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#050505] sm:max-h-[calc(100dvh-3rem)]";

  if (queuedSummary) {
    const { count, firstName, failedCount, warning } = queuedSummary;
    return (
      <Modal onClose={handleClose}>
        <div className={panelClass}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
                <CheckCircleIcon className="h-6 w-6" />
              </span>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
                aria-label="Close"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <h2 className="mt-5 text-xl font-semibold text-slate-900 dark:text-[#f2f2f2]">
              {count === 1 ? "Your paper is being analyzed" : `${count} papers are being analyzed`}
            </h2>
            <p className="mt-2 break-words text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
              {count === 1
                ? `${firstName} was added to ${queuedSummary.projectName}.`
                : `${firstName} and ${plural(count - 1, "other file")} were added to ${queuedSummary.projectName}.`}
            </p>

            <ol className="mt-5 space-y-3 text-sm">
              <li className="flex gap-3">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 flex-none text-blue-600 dark:text-blue-300" />
                <span className="text-slate-700 dark:text-[#d4d4d4]">Uploaded to private storage</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 h-3 w-3 flex-none rounded-full border-2 border-slate-900 motion-safe:animate-pulse dark:border-white" />
                <span className="text-slate-700 dark:text-[#d4d4d4]">
                  Analysis: title, year, topics, methods and category. This usually takes a few minutes
                  per paper, and larger batches run one paper after another.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 h-3 w-3 flex-none rounded-full border-2 border-slate-300 dark:border-[#444]" />
                <span className="text-slate-500 dark:text-[#9c9c9c]">
                  Ready: each paper appears in the Library and on the Dashboard as soon as it finishes.
                </span>
              </li>
            </ol>

            <p className="mt-5 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">
              You can close this window and keep working. Progress shows on Home, and in the corner
              of every other page.
            </p>

            {failedCount > 0 ? (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                {plural(failedCount, "file")} could not be uploaded. They are marked as failed in the
                Library; add them again when the connection is steady.
              </p>
            ) : null}
            {warning ? (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {warning}
              </p>
            ) : null}
          </div>
          <div className="flex flex-none flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 dark:border-[#1f1f1f] sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={() => {
                handleClose();
                router.push("/workspace/library");
              }}
              className={secondaryButtonClass}
            >
              Open Library
            </button>
            <button
              type="button"
              onClick={() => {
                handleClose();
                router.push("/workspace/home");
              }}
              className={primaryButtonClass}
            >
              <span>Follow progress</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const progressPercent = uploadProgress && uploadProgress.total > 0
    ? Math.round((uploadProgress.done / uploadProgress.total) * 100)
    : null;

  return (
    <Modal onClose={handleClose}>
      <div className={panelClass}>
        <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-[#1f1f1f] sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500 dark:text-[#9c9c9c]">Add papers</p>
            <h2 className="mt-1 break-words text-xl font-semibold text-slate-900 dark:text-[#f2f2f2]">
              {targetProject ? `Add papers to ${targetProject.name}` : "Choose a repository first"}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex-none rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6">
          <label
            htmlFor="papertrend-pdf-upload"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              if (!uploading) selectPdfFiles(Array.from(event.dataTransfer.files));
            }}
            className={`block cursor-pointer rounded-lg border border-dashed px-5 py-7 text-center transition-colors focus-within:ring-2 focus-within:ring-slate-900/20 dark:focus-within:ring-white/20 ${
              dragActive
                ? "border-slate-900 bg-slate-100 dark:border-white dark:bg-[#111111]"
                : "border-slate-300 bg-slate-50 hover:border-slate-500 dark:border-[#3a3a3a] dark:bg-[#080808] dark:hover:border-[#666]"
            }`}
          >
            <input
              id="papertrend-pdf-upload"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={uploading}
              onChange={(event) => {
                selectPdfFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
              className="sr-only"
            />
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm dark:bg-[#111111] dark:text-[#d0d0d0]">
              <UploadIcon className="h-5 w-5" />
            </span>
            <span className="mt-4 block text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
              {files.length > 0 ? "Add more PDFs" : "Drop PDFs here, or click to choose"}
            </span>
            <span className="mt-1.5 block text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">
              Up to {MAX_UPLOAD_FILES} PDFs at a time, 10 MB each. A paper already analyzed in this account is caught before it uploads.
            </span>
          </label>

          {files.length > 0 ? (
            <section>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                  {plural(files.length, "PDF")} selected
                  <span className="font-normal text-slate-500 dark:text-[#9c9c9c]"> ({formatFileSize(totalBytes)})</span>
                </p>
                {!uploading ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFiles([]);
                      setError(null);
                    }}
                    className="rounded px-1 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-[#9c9c9c] dark:hover:text-white"
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
              <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                {files.map((file, index) => {
                  const flagged = Boolean(error && error.includes(file.name));
                  return (
                    <li
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                        flagged
                          ? "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30"
                          : "border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <FileIcon className="h-4 w-4 flex-none text-slate-500 dark:text-[#9c9c9c]" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-slate-900 dark:text-[#f2f2f2]" title={file.name}>
                            {file.name}
                          </span>
                          <span className={`block text-xs ${flagged ? "text-red-700 dark:text-red-200" : "text-slate-500 dark:text-[#9c9c9c]"}`}>
                            {flagged ? "Remove this file to continue" : formatFileSize(file.size)}
                          </span>
                        </span>
                      </span>
                      {!uploading ? (
                        <button
                          type="button"
                          onClick={() => {
                            setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
                            if (flagged) setError(null);
                          }}
                          className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-[#111] dark:hover:text-white"
                          aria-label={`Remove ${file.name}`}
                          title="Remove file"
                        >
                          <CloseIcon className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {PROJECT_ANALYSIS_PROFILES_ENABLED && targetProject ? (
            <section className="rounded-lg border border-slate-200 px-4 py-3 dark:border-[#242424]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase text-slate-500 dark:text-[#777]">Analysis profile</p>
                  <p className="mt-1 text-sm font-medium leading-6 text-slate-900 dark:text-white">{profileSummary(activeAnalysisProfile)}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-[#999]">Every paper in this upload is classified with it.</p>
                  {previousProfileCount > 0 ? (
                    <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">
                      {plural(previousProfileCount, "existing paper")} still use an earlier profile. New papers use this one.
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    if (showProfileEditor) setProfileDraft(activeAnalysisProfile);
                    setProfileError(null);
                    setShowProfileEditor((visible) => !visible);
                  }}
                  className="flex-none rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-[#333] dark:bg-black dark:text-[#ddd] dark:hover:bg-[#111]"
                >
                  {showProfileEditor ? "Cancel" : "Change"}
                </button>
              </div>
              {showProfileEditor ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-[#242424] dark:bg-[#080808]">
                  <AnalysisProfileEditor
                    value={profileDraft}
                    onChange={(next) => { setProfileDraft(next); setProfileError(null); }}
                    templates={allProjects.filter((project) => project.id !== targetProject.id && project.analysis_profile).map((project) => ({ projectId: project.id, projectName: project.name, profile: project.analysis_profile! }))}
                    compact
                    error={profileError}
                  />
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => { setProfileDraft(activeAnalysisProfile); setProfileError(null); setShowProfileEditor(false); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-[#333]">Discard</button>
                    <button
                      type="button"
                      disabled={savingProfile}
                      onClick={async () => {
                        setSavingProfile(true);
                        setProfileError(null);
                        try {
                          const normalized = sanitizeProjectAnalysisProfile(profileDraft);
                          await updateProjectAnalysisProfile(targetProject.id, normalized);
                          setProfileDraft(normalized);
                          setShowProfileEditor(false);
                          setError(null);
                        } catch (saveError) {
                          setProfileError(saveError instanceof Error ? saveError.message : "Could not save the analysis profile.");
                        } finally { setSavingProfile(false); }
                      }}
                      className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                    >
                      {savingProfile ? "Saving..." : "Save for repository"}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section>
            <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">What happens next</p>
            <ol className="mt-2 space-y-2 text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-[#111111] dark:text-[#d0d0d0]">1</span>
                <span>The PDFs upload to private storage. Keep this tab open until the upload finishes.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-[#111111] dark:text-[#d0d0d0]">2</span>
                <span>Each paper is read for its title, year, topics, methods and category, usually in a few minutes. You can keep working meanwhile.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-[#111111] dark:text-[#d0d0d0]">3</span>
                <span>Finished papers appear in the Library, on the Dashboard and in Chat.</span>
              </li>
            </ol>
          </section>

          {error ? (
            <div role="alert" className="break-words rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex-none border-t border-slate-200 px-5 py-4 dark:border-[#1f1f1f] sm:px-6">
          {uploading ? (
            <div className="mb-3" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-slate-900 dark:text-[#f2f2f2]">{uploadStage || "Working"}</span>
                {uploadProgress ? (
                  <span className="flex-none text-slate-500 dark:text-[#9c9c9c]">
                    {uploadProgress.done}/{uploadProgress.total}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1a1a1a]">
                <div
                  className={`h-full rounded-full bg-slate-900 transition-[width] dark:bg-white ${progressPercent === null ? "w-1/3 motion-safe:animate-pulse" : ""}`}
                  style={progressPercent === null ? undefined : { width: `${Math.max(4, progressPercent)}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={handleClose} className={secondaryButtonClass}>
              {uploading ? "Hide" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleAnalyze();
              }}
              disabled={uploading || files.length === 0 || !targetProjectId}
              className={primaryButtonClass}
            >
              {uploading
                ? "Uploading..."
                : files.length > 0
                  ? `Analyze ${plural(files.length, "paper")}`
                  : "Analyze papers"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
