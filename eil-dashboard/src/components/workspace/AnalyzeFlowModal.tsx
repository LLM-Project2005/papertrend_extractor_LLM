"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import Modal from "@/components/ui/Modal";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CloudIcon,
  CloseIcon,
  DriveIcon,
  FileIcon,
  FolderIcon,
  OneDriveIcon,
  PaperIcon,
  SharePointIcon,
  UploadIcon,
} from "@/components/ui/Icons";
import type { FolderAnalysisJobRow, IngestionRunRow } from "@/types/database";

type ImportSource =
  | "pdf-upload"
  | "google-drive"
  | "onedrive"
  | "sharepoint"
  | "cloud-storage";

interface DriveFileItem {
  id: string;
  name: string;
  kind: "folder" | "file";
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface DriveBreadcrumb {
  id: string;
  name: string;
}

const SOURCE_OPTIONS = [
  {
    id: "pdf-upload",
    label: "PDF upload",
    status: "ready",
    icon: UploadIcon,
    description: "Upload paper PDFs directly into the workspace queue.",
  },
  {
    id: "google-drive",
    label: "Google Drive",
    status: "ready",
    icon: DriveIcon,
    description: "Connect Google Drive, browse PDFs, and queue them without local upload.",
  },
  {
    id: "onedrive",
    label: "OneDrive",
    status: "planned",
    icon: OneDriveIcon,
    description: "Planned connector for institution-managed document libraries.",
  },
  {
    id: "sharepoint",
    label: "SharePoint",
    status: "planned",
    icon: SharePointIcon,
    description: "Planned connector for Microsoft document repositories.",
  },
  {
    id: "cloud-storage",
    label: "Cloud storage",
    status: "planned",
    icon: CloudIcon,
    description: "Planned connector for buckets and external archives.",
  },
] as const;

const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;

async function readJsonPayload<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

interface AnalyzeFlowModalProps {
  open: boolean;
  onClose: () => void;
  defaultFolder?: string;
  title?: string;
  eyebrow?: string;
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

export default function AnalyzeFlowModal({
  open,
  onClose,
  defaultFolder = "Inbox",
  title = "Analyze workspace sources",
  eyebrow = "Analyze",
  onCreated,
}: AnalyzeFlowModalProps) {
  const router = useRouter();
  const { session, user } = useAuth();
  const { selectedProjectId, currentProject } = useWorkspaceProfile();
  const [adminSecret, setAdminSecret] = useState("");
  const [folder, setFolder] = useState(defaultFolder);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedSource, setSelectedSource] = useState<ImportSource>("pdf-upload");
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveSearch, setDriveSearch] = useState("");
  const [selectedDriveFileIds, setSelectedDriveFileIds] = useState<string[]>([]);
  const [driveFolderTrail, setDriveFolderTrail] = useState<DriveBreadcrumb[]>([
    { id: "root", name: "My Drive" },
  ]);
  const [queuedSummary, setQueuedSummary] = useState<{
    count: number;
    fileName: string;
    warning?: string | null;
  } | null>(null);

  useEffect(() => {
    setFolder(defaultFolder);
  }, [defaultFolder]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setAdminSecret(window.localStorage.getItem("eil_admin_secret") ?? "");
    const searchParams = new URLSearchParams(window.location.search);
    const driveError = searchParams.get("drive_error");
    if (driveError) {
      setError(decodeURIComponent(driveError));
    }
  }, []);

  const selectedSourceMeta = useMemo(
    () => SOURCE_OPTIONS.find((source) => source.id === selectedSource)!,
    [selectedSource]
  );

  async function loadDriveFiles(search = driveSearch, parentId = driveFolderTrail.at(-1)?.id ?? "root") {
    if (!session?.access_token || !user) {
      setDriveConnected(false);
      setDriveFiles([]);
      return;
    }

    setDriveLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set("search", search.trim());
      }
      params.set("parentId", parentId);
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/integrations/google-drive/files${query}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = (await response.json()) as {
        connected?: boolean;
        files?: DriveFileItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load Google Drive files.");
      }

      setDriveConnected(Boolean(payload.connected));
      setDriveFiles(payload.files ?? []);
    } catch (driveError) {
      setDriveConnected(false);
      setDriveFiles([]);
      setError(
        driveError instanceof Error
          ? driveError.message
          : "Failed to load Google Drive files."
      );
    } finally {
      setDriveLoading(false);
    }
  }

  useEffect(() => {
    if (!open || selectedSource !== "google-drive") {
      return;
    }

    if (!user || !session?.access_token) {
      setDriveConnected(false);
      setDriveFiles([]);
      return;
    }

    void loadDriveFiles(driveSearch, driveFolderTrail.at(-1)?.id ?? "root");
  }, [driveFolderTrail, driveSearch, open, selectedSource, session?.access_token, user]);

  if (!open) {
    return null;
  }

  function handleClose() {
    setQueuedSummary(null);
    setFiles([]);
    setError(null);
    onClose();
  }

  async function handleConnectGoogleDrive() {
    if (!session?.access_token || !user) {
      setError("Sign in before connecting Google Drive.");
      return;
    }

    setDriveConnecting(true);
    setError(null);

    try {
      const response = await fetch("/api/integrations/google-drive/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          returnTo: `${window.location.pathname}?analyze=1&source=google-drive`,
        }),
      });

      const payload = (await response.json()) as {
        authorizationUrl?: string;
        error?: string;
      };

      if (!response.ok || !payload.authorizationUrl) {
        throw new Error(payload.error ?? "Failed to start Google Drive connection.");
      }

      window.location.href = payload.authorizationUrl;
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to connect Google Drive."
      );
      setDriveConnecting(false);
    }
  }

  async function handleAnalyze() {
    if (!user && !adminSecret.trim()) {
      setError("Sign in or enter the shared admin secret before starting analysis.");
      return;
    }
    if (!selectedProjectId) {
      setError("Choose a project before adding files to the library.");
      return;
    }

    setUploading(true);
    setUploadStage("Preparing upload");
    setError(null);

    try {
      if (selectedSource === "pdf-upload") {
        if (files.length === 0) {
          throw new Error("Choose one PDF file.");
        }
        if (files.length > 1) {
          throw new Error("For beta stability, upload one PDF at a time.");
        }

        const invalidFiles = files.filter(
          (file) => !file.name.toLowerCase().endsWith(".pdf")
        );
        if (invalidFiles.length > 0) {
          throw new Error("Only PDF files are supported for direct upload.");
        }

        const oversizedFiles = files.filter((file) => file.size > MAX_UPLOAD_FILE_BYTES);
        if (oversizedFiles.length > 0) {
          throw new Error(
            `Each PDF must be 20 MB or smaller. Oversized count: ${oversizedFiles.length}.`
          );
        }

        const headers: Record<string, string> = {};
        if (session?.access_token && user) {
          headers.Authorization = `Bearer ${session.access_token}`;
        } else if (adminSecret.trim()) {
          headers["x-admin-secret"] = adminSecret.trim();
        }

        setUploadStage("Creating queue record");
        const prepareResponse = await fetch("/api/admin/import/prepare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify({
            folder: folder.trim() || defaultFolder,
            source_kind: selectedSource,
            project_id: selectedProjectId,
            files: files.map((file, fileIndex) => ({
              fileIndex,
              name: file.name,
              size: file.size,
              type: file.type || "application/pdf",
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
            fileName: string;
          }>;
          error?: string;
        }>(prepareResponse);

        if (!prepareResponse.ok || !preparePayload?.folderJob || !preparePayload.uploads) {
          throw new Error(
            preparePayload?.error ??
              `Failed to prepare direct upload (status ${prepareResponse.status}).`
          );
        }

        setUploadStage("Uploading PDF to secure storage");
        const uploaded: Array<{
          runId: string;
          storagePath: string;
          fileName: string;
        }> = [];
        const failed: Array<{
          runId: string;
          storagePath: string;
          fileName: string;
          errorMessage: string;
        }> = [];

        for (const uploadTarget of preparePayload.uploads) {
          const file = files[uploadTarget.fileIndex];
          if (!file) {
            failed.push({
              runId: uploadTarget.runId,
              storagePath: uploadTarget.storagePath,
              fileName: uploadTarget.fileName,
              errorMessage: "Local file mapping failed during upload.",
            });
            continue;
          }

          try {
            const uploadResponse = await fetch(uploadTarget.signedUrl, {
              method: "PUT",
              headers: {
                "Content-Type": file.type || "application/pdf",
                "x-upsert": "false",
              },
              body: file,
            });

            if (!uploadResponse.ok) {
              const body = await uploadResponse.text();
              throw new Error(body || `Storage upload failed with status ${uploadResponse.status}.`);
            }

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
                uploadError instanceof Error
                  ? uploadError.message
                  : "Failed to upload file to storage.",
            });
          }
        }

        setUploadStage("Finalizing queue");
        const finalizeResponse = await fetch("/api/admin/import/finalize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
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
              `Failed to finalize direct upload (status ${finalizeResponse.status}).`
          );
        }

        setUploadStage("Worker requested");
        const queuedRuns = (finalizePayload?.runs ?? []).filter(
          (run) => run.status !== "failed"
        );
        const folderJob = finalizePayload?.folderJob ?? null;
        const queueWarning = finalizePayload?.warning ?? null;

        if (queuedRuns.length === 0) {
          throw new Error("All selected files failed during upload.");
        }

        if (adminSecret.trim() && typeof window !== "undefined") {
          window.localStorage.setItem("eil_admin_secret", adminSecret.trim());
        }

        onCreated?.(queuedRuns, {
          folder: folder.trim() || defaultFolder,
          folderId: folderJob?.folder_id ?? null,
          folderJob,
          sourceKind: selectedSource,
        });

        setQueuedSummary({
          count: queuedRuns.length,
          fileName: queuedRuns[0]?.display_name || queuedRuns[0]?.source_filename || files[0]?.name || "Selected PDF",
          warning: queueWarning,
        });
        setFiles([]);
        if (queueWarning) {
          setError(queueWarning);
        } else {
          setError(null);
        }
        return;
      }

      if (selectedSource === "google-drive") {
        if (!user || !session?.access_token) {
          throw new Error("Sign in before queueing Google Drive files.");
        }
        if (!driveConnected) {
          throw new Error("Connect Google Drive before queueing files.");
        }
        if (selectedDriveFileIds.length === 0) {
          throw new Error("Select at least one Google Drive PDF.");
        }

        const response = await fetch("/api/integrations/google-drive/queue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            fileIds: selectedDriveFileIds,
            folder: folder.trim() || defaultFolder,
            projectId: selectedProjectId,
          }),
        });

        const payload = (await response.json()) as {
          runs?: IngestionRunRow[];
          folderJob?: FolderAnalysisJobRow | null;
          warning?: string | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to queue Google Drive files.");
        }

        onCreated?.(payload.runs ?? [], {
          folder: folder.trim() || defaultFolder,
          folderId: payload.folderJob?.folder_id ?? null,
          folderJob: payload.folderJob ?? null,
          sourceKind: selectedSource,
        });

        setSelectedDriveFileIds([]);
        if (payload.warning) {
          setError(payload.warning);
        }
        onClose();
        return;
      }

      throw new Error("This connector is still planned.");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Failed to queue analysis."
      );
    } finally {
      setUploading(false);
      setUploadStage("");
    }
  }

  const selectedDriveFiles = driveFiles.filter((file) =>
    selectedDriveFileIds.includes(file.id)
  );
  const driveFolders = driveFiles.filter((file) => file.kind === "folder");
  const drivePdfFiles = driveFiles.filter((file) => file.kind === "file");

  if (queuedSummary) {
    return (
      <Modal onClose={handleClose}>
        <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl dark:border-[#1f1f1f] dark:bg-[#050505]">
          <div className="flex items-start justify-between gap-4">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
              <CheckCircleIcon className="h-6 w-6" />
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
              aria-label="Close upload confirmation"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-[#f2f2f2]">
            File queued for analysis
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
            {queuedSummary.fileName} was uploaded and added to the worker queue. The
            Home page shows the live timeline while the analysis runs.
          </p>
          {queuedSummary.warning ? (
            <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              {queuedSummary.warning}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 dark:border-[#1f1f1f] dark:text-[#b8b8b8]"
            >
              Stay here
            </button>
            <button
              type="button"
              onClick={() => {
                handleClose();
                router.push("/workspace/home");
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-[#f3f3f3] dark:text-[#171717]"
            >
              <span>View progress on Home</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={handleClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#050505]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-[#1f1f1f] sm:px-6">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-[#9c9c9c]">
              {eyebrow}
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-[#f2f2f2]">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]"
            aria-label="Close upload modal"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#030303]">
            <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
              Single PDF upload
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">
              Google Drive and batch uploads are temporarily hidden for beta stability.
              Upload one paper at a time and track progress from Home.
            </p>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center dark:border-[#3a3a3a] dark:bg-[#050505]">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
                <PaperIcon className="h-6 w-6" />
              </span>

              {selectedSourceMeta.id === "pdf-upload" ? (
                <>
                  <p className="mt-4 text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
                    Choose one paper PDF
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">
                    The file will be uploaded, queued, and processed by the analysis worker.
                  </p>
                  <div className="mt-5">
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(event) =>
                        setFiles(Array.from(event.target.files ?? []).filter(Boolean).slice(0, 1))
                      }
                      className="mx-auto block w-full max-w-md text-sm text-slate-600 dark:text-[#b8b8b8]"
                    />
                  </div>
                </>
              ) : selectedSourceMeta.id === "google-drive" ? (
                <>
                  <p className="mt-4 text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
                    Browse PDFs from Google Drive
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">
                    Connect your Drive once, then select the research PDFs you want to queue into this workspace.
                  </p>

                  {!user ? (
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#9c9c9c]">
                      Sign in first to connect Google Drive.
                    </div>
                  ) : !driveConnected ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleConnectGoogleDrive();
                      }}
                      disabled={driveConnecting}
                      className="mt-5 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white dark:bg-[#f3f3f3] dark:text-[#171717]"
                    >
                      {driveConnecting ? "Connecting..." : "Connect Google Drive"}
                    </button>
                  ) : (
                    <div className="mt-5 space-y-3 text-left">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-[#9c9c9c]">
                        {driveFolderTrail.map((folder, index) => (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() => {
                              const nextTrail = driveFolderTrail.slice(0, index + 1);
                              setDriveFolderTrail(nextTrail);
                            }}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a]"
                          >
                            {folder.name}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          value={driveSearch}
                          onChange={(event) => setDriveSearch(event.target.value)}
                          placeholder="Search this folder"
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-[#242424]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void loadDriveFiles(
                              driveSearch,
                              driveFolderTrail.at(-1)?.id ?? "root"
                            );
                          }}
                          className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
                        >
                          Refresh
                        </button>
                      </div>

                      <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#050505]">
                        {driveLoading ? (
                          <p className="px-4 py-4 text-sm text-slate-500 dark:text-[#9c9c9c]">
                            Loading Google Drive PDFs...
                          </p>
                        ) : driveFiles.length === 0 ? (
                          <p className="px-4 py-4 text-sm text-slate-500 dark:text-[#9c9c9c]">
                            No PDF files found in Google Drive.
                          </p>
                        ) : (
                          <div className="divide-y divide-slate-200 dark:divide-[#2f2f2f]">
                            {driveFolders.map((folder) => (
                              <button
                                key={folder.id}
                                type="button"
                                onClick={() => {
                                  setDriveFolderTrail((current) => [
                                    ...current,
                                    { id: folder.id, name: folder.name },
                                  ]);
                                  setDriveSearch("");
                                }}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-[#0a0a0a]"
                              >
                                <span className="flex h-4 w-4 items-center justify-center">
                                  <FolderIcon className="h-4 w-4 text-slate-400 dark:text-[#9c9c9c]" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                                    {folder.name}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500 dark:text-[#9c9c9c]">
                                    Folder
                                  </p>
                                </div>
                              </button>
                            ))}
                            {drivePdfFiles.map((file) => {
                              const checked = selectedDriveFileIds.includes(file.id);
                              return (
                                <label
                                  key={file.id}
                                  className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-[#0a0a0a]"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) => {
                                      setSelectedDriveFileIds((current) =>
                                        event.target.checked
                                          ? [...current, file.id]
                                          : current.filter((id) => id !== file.id)
                                      );
                                    }}
                                    className="mt-1 h-4 w-4 rounded border-slate-300"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start gap-3">
                                      <FileIcon className="mt-0.5 h-4 w-4 text-slate-400 dark:text-[#9c9c9c]" />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                                          {file.name}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-[#9c9c9c]">
                                          {file.modifiedTime
                                            ? new Date(file.modifiedTime).toLocaleString()
                                            : "Modified time unavailable"}
                                          {file.size
                                            ? ` • ${Math.max(1, Math.round(Number(file.size) / 1024))} KB`
                                            : ""}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-4 text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
                    {selectedSourceMeta.label} connector is planned
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">
                    Keep this source visible in the UI now, then connect the real integration later without changing the analyze flow.
                  </p>
                  <button
                    type="button"
                    disabled
                    className="mt-5 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-400 dark:border-[#1f1f1f] dark:text-[#707070]"
                  >
                    Coming soon
                  </button>
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                  Queue details
                </p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#050505]">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8f8f8f]">
                      Project
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                      {currentProject?.name ?? "No project selected"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#050505]">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#8f8f8f]">
                      Destination
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                      {folder.trim() || defaultFolder}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">
                      The app uses the current library location automatically.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                  Selected files
                </p>
                {!user && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                    <p className="text-xs font-medium uppercase tracking-normal text-slate-400 dark:text-[#8f8f8f]">
                      Access
                    </p>
                    <input
                      type="password"
                      value={adminSecret}
                      onChange={(event) => setAdminSecret(event.target.value)}
                      placeholder="Shared admin secret"
                      className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-[#242424]"
                    />
                  </div>
                )}

                {selectedSource === "pdf-upload" ? (
                  files.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500 dark:text-[#9c9c9c]">
                      No files selected yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {files.map((file) => (
                        <div
                          key={`${file.name}-${file.size}`}
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#050505]"
                        >
                          <div className="flex items-center gap-3">
                            <FileIcon className="h-4 w-4 text-slate-400 dark:text-[#9c9c9c]" />
                            <span className="text-sm text-slate-900 dark:text-[#f2f2f2]">
                              {file.name}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500 dark:text-[#9c9c9c]">
                            {Math.max(1, Math.round(file.size / 1024))} KB
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                ) : selectedSource === "google-drive" ? (
                  selectedDriveFiles.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500 dark:text-[#9c9c9c]">
                      No Google Drive PDFs selected yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {selectedDriveFiles.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#1f1f1f] dark:bg-[#050505]"
                        >
                          <div className="flex items-center gap-3">
                            <DriveIcon className="h-4 w-4 text-slate-400 dark:text-[#9c9c9c]" />
                            <span className="text-sm text-slate-900 dark:text-[#f2f2f2]">
                              {file.name}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500 dark:text-[#9c9c9c]">
                            {file.size
                              ? `${Math.max(1, Math.round(Number(file.size) / 1024))} KB`
                              : "Drive file"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="mt-3 text-sm text-slate-500 dark:text-[#9c9c9c]">
                    This connector is not live yet.
                  </p>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
          {uploading ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
              <span className="font-medium">{uploadStage || "Queueing file"}</span>
              <span className="ml-2 text-blue-700/80 dark:text-blue-200/80">
                Please keep this window open.
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-[#1f1f1f]">
          <p className="text-sm text-slate-500 dark:text-[#9c9c9c]">
            Files are queued in Supabase first, then processed by the external analysis worker.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 dark:border-[#1f1f1f] dark:text-[#b8b8b8]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleAnalyze();
              }}
              disabled={
                uploading ||
                (selectedSource === "pdf-upload" && files.length !== 1) ||
                (selectedSource === "google-drive" &&
                  (!driveConnected || selectedDriveFileIds.length === 0)) ||
                (selectedSource !== "pdf-upload" && selectedSource !== "google-drive")
              }
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-[#f3f3f3] dark:text-[#171717] dark:disabled:bg-[#3a3a3a] dark:disabled:text-[#7e7e7e]"
            >
              {uploading ? "Queueing..." : "Upload and queue"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
