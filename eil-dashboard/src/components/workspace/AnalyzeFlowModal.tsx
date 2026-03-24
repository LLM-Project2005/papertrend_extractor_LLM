"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import Modal from "@/components/ui/Modal";
import {
  CloudIcon,
  CloseIcon,
  DriveIcon,
  FileIcon,
  OneDriveIcon,
  PaperIcon,
  SharePointIcon,
  UploadIcon,
} from "@/components/ui/Icons";
import type { IngestionRunRow } from "@/types/database";

type ImportSource =
  | "pdf-upload"
  | "google-drive"
  | "onedrive"
  | "sharepoint"
  | "cloud-storage";

interface DriveFileItem {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
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

interface AnalyzeFlowModalProps {
  open: boolean;
  onClose: () => void;
  defaultFolder?: string;
  title?: string;
  eyebrow?: string;
  onCreated?: (
    runs: IngestionRunRow[],
    context: { folder: string; sourceKind: string }
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
  const { session, user } = useAuth();
  const [adminSecret, setAdminSecret] = useState("");
  const [folder, setFolder] = useState(defaultFolder);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [selectedSource, setSelectedSource] = useState<ImportSource>("pdf-upload");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveSearch, setDriveSearch] = useState("");
  const [selectedDriveFileIds, setSelectedDriveFileIds] = useState<string[]>([]);

  useEffect(() => {
    setFolder(defaultFolder);
  }, [defaultFolder]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setAdminSecret(window.localStorage.getItem("eil_admin_secret") ?? "");
    const searchParams = new URLSearchParams(window.location.search);
    const requestedSource = searchParams.get("source");
    if (requestedSource === "google-drive") {
      setSelectedSource("google-drive");
    }
    const driveError = searchParams.get("drive_error");
    if (driveError) {
      setError(decodeURIComponent(driveError));
    }
  }, []);

  const selectedSourceMeta = useMemo(
    () => SOURCE_OPTIONS.find((source) => source.id === selectedSource)!,
    [selectedSource]
  );

  async function loadDriveFiles(search = driveSearch) {
    if (!session?.access_token || !user) {
      setDriveConnected(false);
      setDriveFiles([]);
      return;
    }

    setDriveLoading(true);
    setError(null);

    try {
      const query = search.trim()
        ? `?search=${encodeURIComponent(search.trim())}`
        : "";
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

    void loadDriveFiles();
  }, [open, selectedSource, session?.access_token, user]);

  if (!open) {
    return null;
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

    setUploading(true);
    setError(null);

    try {
      if (selectedSource === "pdf-upload") {
        if (files.length === 0) {
          throw new Error("Choose at least one PDF file.");
        }

        const formData = new FormData();
        files.forEach((file) => formData.append("files", file));
        formData.append("folder", folder.trim() || defaultFolder);
        formData.append("source_kind", selectedSource);
        if (provider.trim()) {
          formData.append("provider", provider.trim());
        }
        if (model.trim()) {
          formData.append("model", model.trim());
        }

        const headers: Record<string, string> = {};
        if (session?.access_token && user) {
          headers.Authorization = `Bearer ${session.access_token}`;
        } else if (adminSecret.trim()) {
          headers["x-admin-secret"] = adminSecret.trim();
        }

        const response = await fetch("/api/admin/import", {
          method: "POST",
          headers,
          body: formData,
        });

        const payload = (await response.json()) as {
          runs?: IngestionRunRow[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to queue analysis.");
        }

        if (adminSecret.trim() && typeof window !== "undefined") {
          window.localStorage.setItem("eil_admin_secret", adminSecret.trim());
        }

        onCreated?.(payload.runs ?? [], {
          folder: folder.trim() || defaultFolder,
          sourceKind: selectedSource,
        });

        setFiles([]);
        setProvider("");
        setModel("");
        onClose();
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
            provider: provider.trim(),
            model: model.trim(),
          }),
        });

        const payload = (await response.json()) as {
          runs?: IngestionRunRow[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to queue Google Drive files.");
        }

        onCreated?.(payload.runs ?? [], {
          folder: folder.trim() || defaultFolder,
          sourceKind: selectedSource,
        });

        setSelectedDriveFileIds([]);
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
    }
  }

  const selectedDriveFiles = driveFiles.filter((file) =>
    selectedDriveFileIds.includes(file.id)
  );

  return (
    <Modal onClose={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-[#2f2f2f] dark:bg-[#212121]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-[#2f2f2f] sm:px-6">
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
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0]"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {SOURCE_OPTIONS.map((source) => {
              const Icon = source.icon;
              const active = source.id === selectedSource;
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => setSelectedSource(source.id)}
                  className={`rounded-3xl border px-4 py-4 text-left transition-colors ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white dark:border-[#f3f3f3] dark:bg-[#f3f3f3] dark:text-[#171717]"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a]"
                  }`}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/5 dark:bg-black/10">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{source.label}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                        source.status === "ready"
                          ? active
                            ? "bg-white/15 text-white dark:bg-black/10 dark:text-[#171717]"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : active
                            ? "bg-white/15 text-white/75 dark:bg-black/10 dark:text-[#444444]"
                            : "bg-slate-100 text-slate-500 dark:bg-[#2a2a2a] dark:text-[#8f8f8f]"
                      }`}
                    >
                      {source.status}
                    </span>
                  </div>
                  <p
                    className={`mt-2 text-xs leading-5 ${
                      active
                        ? "text-white/75 dark:text-[#4a4a4a]"
                        : "text-slate-500 dark:text-[#9c9c9c]"
                    }`}
                  >
                    {source.description}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center dark:border-[#3a3a3a] dark:bg-[#171717]">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-600 dark:bg-[#212121] dark:text-[#d0d0d0]">
                <PaperIcon className="h-6 w-6" />
              </span>

              {selectedSourceMeta.id === "pdf-upload" ? (
                <>
                  <p className="mt-4 text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
                    Drop PDFs here or browse files
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">
                    The selected files will be uploaded into Supabase Storage and queued for extraction.
                  </p>
                  <div className="mt-5">
                    <input
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={(event) =>
                        setFiles(Array.from(event.target.files ?? []).filter(Boolean))
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
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500 dark:border-[#2f2f2f] dark:bg-[#212121] dark:text-[#9c9c9c]">
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
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          value={driveSearch}
                          onChange={(event) => setDriveSearch(event.target.value)}
                          placeholder="Search Drive PDFs"
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#212121] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void loadDriveFiles();
                          }}
                          className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
                        >
                          Refresh
                        </button>
                      </div>

                      <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-slate-200 bg-white dark:border-[#2f2f2f] dark:bg-[#212121]">
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
                            {driveFiles.map((file) => {
                              const checked = selectedDriveFileIds.includes(file.id);
                              return (
                                <label
                                  key={file.id}
                                  className="flex cursor-pointer items-start gap-3 px-4 py-3"
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
                                    <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                                      {file.name}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-[#9c9c9c]">
                                      {file.modifiedTime
                                        ? new Date(file.modifiedTime).toLocaleString()
                                        : "Modified time unavailable"}
                                      {file.size ? ` • ${Math.max(1, Math.round(Number(file.size) / 1024))} KB` : ""}
                                    </p>
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
                    className="mt-5 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-400 dark:border-[#2f2f2f] dark:text-[#707070]"
                  >
                    Coming soon
                  </button>
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                  Analysis details
                </p>
                <div className="mt-4 space-y-3">
                  <input
                    value={folder}
                    onChange={(event) => setFolder(event.target.value)}
                    placeholder="Folder or group, e.g. Inbox"
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#212121] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10"
                  />
                  <input
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                    placeholder="Provider, e.g. OpenRouter or Google Drive"
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#212121] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10"
                  />
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="Model, e.g. openai/gpt-4o-mini"
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#212121] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10"
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                  Selected files
                </p>
                {!user && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#212121]">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 dark:text-[#8f8f8f]">
                      Access
                    </p>
                    <input
                      type="password"
                      value={adminSecret}
                      onChange={(event) => setAdminSecret(event.target.value)}
                      placeholder="Shared admin secret"
                      className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#171717] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10"
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
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#2f2f2f] dark:bg-[#212121]"
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
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#2f2f2f] dark:bg-[#212121]"
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
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-[#2f2f2f]">
          <p className="text-sm text-slate-500 dark:text-[#9c9c9c]">
            Files are queued in Supabase first, then processed by the external analysis worker.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 dark:border-[#2f2f2f] dark:text-[#b8b8b8]"
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
                (selectedSource !== "pdf-upload" && selectedSource !== "google-drive")
              }
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-[#f3f3f3] dark:text-[#171717] dark:disabled:bg-[#3a3a3a] dark:disabled:text-[#7e7e7e]"
            >
              {uploading ? "Analyzing..." : "Analyze"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
