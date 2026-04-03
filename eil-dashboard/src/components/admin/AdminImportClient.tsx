"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import AnalyzeFlowModal from "@/components/workspace/AnalyzeFlowModal";
import {
  getRunModelLabel,
  getRunStageMessage,
} from "@/lib/ingestion-status";
import {
  FileIcon,
  FolderIcon,
  PlusIcon,
} from "@/components/ui/Icons";
import type { IngestionRunRow, ResearchFolderRow } from "@/types/database";

interface IngestionRun {
  id: string;
  folder_id?: string | null;
  source_type: "batch" | "upload";
  status: "queued" | "processing" | "succeeded" | "failed";
  source_filename?: string | null;
  source_path?: string | null;
  provider?: string | null;
  model?: string | null;
  input_payload?: Record<string, unknown> | null;
  error_message?: string | null;
  updated_at?: string;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function StatusBadge({ status }: { status: IngestionRun["status"] }) {
  const classes =
    status === "succeeded"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
      : status === "failed"
        ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200"
        : status === "processing"
          ? "bg-slate-200 text-slate-700 dark:bg-[#2a2a2a] dark:text-slate-200"
          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200";

  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>{status}</span>;
}

function getFolderName(run: IngestionRun, folders: ResearchFolderRow[]) {
  if (run.folder_id) {
    const folder = folders.find((item) => item.id === run.folder_id);
    if (folder?.name) {
      return folder.name;
    }
  }
  const payloadFolder =
    typeof run.input_payload?.folder_name === "string"
      ? run.input_payload.folder_name.trim()
      : "";
  if (payloadFolder) return payloadFolder;
  const parts = (run.source_path ?? "").split("/").filter(Boolean);
  return parts.length >= 3 && parts[0] === "pending" ? parts[1] : "Inbox";
}

function sanitizeFolderName(folderName: string) {
  return folderName.trim().replace(/[\\/]+/g, "-");
}

export default function AdminImportClient() {
  const { session, isAdmin, user } = useAuth();
  const {
    startAnalysisSession,
    folders,
    selectedFolderId,
    setSelectedFolderId,
    createFolder,
    refreshFolders,
  } = useWorkspaceProfile();
  const [adminSecret, setAdminSecret] = useState("");
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [draftFolderName, setDraftFolderName] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeFolder = useMemo(
    () =>
      selectedFolderId === "all"
        ? folders[0]?.name ?? "Inbox"
        : folders.find((folder) => folder.id === selectedFolderId)?.name ?? "Inbox",
    [folders, selectedFolderId]
  );
  const visibleRuns = useMemo(
    () =>
      runs.filter((run) =>
        selectedFolderId === "all"
          ? true
          : run.folder_id
            ? run.folder_id === selectedFolderId
            : getFolderName(run, folders) === activeFolder
      ),
    [activeFolder, folders, runs, selectedFolderId]
  );

  useEffect(() => {
    const savedSecret = window.localStorage.getItem("eil_admin_secret");
    if (savedSecret) setAdminSecret(savedSecret);
  }, []);

  useEffect(() => {
    if (session?.access_token) {
      void loadRuns();
    }
  }, [session?.access_token]);

  async function loadRuns(secretOverride?: string) {
    const secret = secretOverride ?? adminSecret;
    const headers: Record<string, string> | null =
      session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : secret
          ? { "x-admin-secret": secret }
          : null;
    if (!headers) return;

    setLoadingRuns(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/import", { headers });
      const payload = (await response.json()) as { runs?: IngestionRun[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load imported files.");
      setRuns(payload.runs ?? []);
      if (session?.access_token) {
        await refreshFolders();
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load imported files.");
    } finally {
      setLoadingRuns(false);
    }
  }

  async function handleSecretSave() {
    if (!adminSecret.trim()) {
      setError("Enter the shared admin secret first.");
      return;
    }
    window.localStorage.setItem("eil_admin_secret", adminSecret.trim());
    await loadRuns(adminSecret.trim());
    setMessage("Admin secret saved locally for this browser.");
  }

  async function handleCreateFolder() {
    const sanitized = sanitizeFolderName(draftFolderName);
    if (!sanitized) {
      setError("Enter a folder name first.");
      return;
    }
    try {
      const folder = await createFolder(sanitized);
      setSelectedFolderId(folder.id);
      setMessage(`Folder "${folder.name}" created.`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create folder."
      );
      return;
    }
    setDraftFolderName("");
    setShowFolderInput(false);
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2] sm:text-3xl">Knowledge library</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">Organize uploaded files into folders, then bring in new knowledge with a single import flow.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowFolderInput((current) => !current)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#212121] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white">
            <FolderIcon className="h-4 w-4" />
            <span>New folder</span>
          </button>
          <button type="button" onClick={() => setShowImportModal(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-[#f3f3f3] dark:text-[#171717] dark:hover:bg-white">
            <PlusIcon className="h-4 w-4" />
            <span>Import</span>
          </button>
        </div>
      </div>

      {showFolderInput && (
        <div className="app-surface flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <input value={draftFolderName} onChange={(event) => setDraftFolderName(event.target.value)} placeholder="Folder name" className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#171717] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10" />
          <div className="flex gap-2">
            <button type="button" onClick={handleCreateFolder} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-[#f3f3f3] dark:text-[#171717]">Save folder</button>
            <button type="button" onClick={() => { setShowFolderInput(false); setDraftFolderName(""); }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 dark:border-[#2f2f2f] dark:text-[#b0b0b0]">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSelectedFolderId("all")}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            selectedFolderId === "all"
              ? "bg-slate-900 text-white dark:bg-[#f3f3f3] dark:text-[#171717]"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#212121] dark:text-[#b8b8b8] dark:hover:bg-[#2a2a2a]"
          }`}
        >
          <FolderIcon className="h-4 w-4" />
          <span>All folders</span>
        </button>
        {folders.map((folder) => {
          const active = folder.id === selectedFolderId;
          return (
            <button key={folder.id} type="button" onClick={() => setSelectedFolderId(folder.id)} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-slate-900 text-white dark:bg-[#f3f3f3] dark:text-[#171717]" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#212121] dark:text-[#b8b8b8] dark:hover:bg-[#2a2a2a]"}`}>
              <FolderIcon className="h-4 w-4" />
              <span>{folder.name}</span>
            </button>
          );
        })}
      </div>

      {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</div>}

      <div className="app-surface px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">Import access</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-[#9c9c9c]">
              {user ? `Signed in as ${user.email}. Current role: ${isAdmin ? "admin" : "member"}.` : "Sign in as an admin or use the shared admin secret to manage imports."}
            </p>
          </div>
          <div className="flex w-full max-w-xl gap-2">
            <input type="password" value={adminSecret} onChange={(event) => setAdminSecret(event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#171717] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10" placeholder={isAdmin ? "Optional when signed in as admin" : "Enter the shared admin secret"} />
            <button type="button" onClick={handleSecretSave} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-[#2f2f2f] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:bg-[#171717]">Save</button>
          </div>
        </div>
      </div>

      <section className="app-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-[#2f2f2f] sm:px-5">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">Files</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-[#9c9c9c]">{visibleRuns.length} item{visibleRuns.length === 1 ? "" : "s"} in {selectedFolderId === "all" ? "all folders" : activeFolder}</p>
            </div>
            <button type="button" onClick={() => loadRuns()} disabled={loadingRuns} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-[#2f2f2f] dark:text-[#b8b8b8] dark:hover:border-[#3a3a3a] dark:hover:text-white">
              {loadingRuns ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {visibleRuns.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center px-6 py-10 text-center">
              <div>
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-[#171717] dark:text-[#9c9c9c]"><FolderIcon className="h-6 w-6" /></span>
                <p className="mt-4 text-base font-medium text-slate-900 dark:text-[#f2f2f2]">No files in this folder yet</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">Open the import modal to upload PDFs now, or keep this folder ready for a future connector.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-[#2f2f2f]">
              {visibleRuns.map((run) => (
                <article key={run.id} className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1.3fr)_auto_auto] sm:items-center sm:px-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={run.status} />
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-[#171717] dark:text-[#b8b8b8]">
                        {typeof run.input_payload?.source_kind === "string"
                          ? run.input_payload.source_kind
                          : run.source_type}
                      </span>
                    </div>
                    <div className="mt-3 flex items-start gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-[#171717] dark:text-[#b8b8b8]"><FileIcon className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">{run.source_filename || run.id}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-[#d8d8d8]">{getRunStageMessage(run)}</p>
                        <p className="mt-1 break-all text-xs text-slate-500 dark:text-[#8f8f8f]">{run.source_path || "Queued upload"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-slate-500 dark:text-[#9c9c9c]"><p>Updated</p><p className="mt-1 text-slate-900 dark:text-[#e2e2e2]">{formatTimestamp(run.updated_at)}</p></div>
                  <div className="text-sm text-slate-500 dark:text-[#9c9c9c]"><p>Analysis mode</p><p className="mt-1 text-slate-900 dark:text-[#e2e2e2]">{getRunModelLabel(run)}</p></div>
                  {run.error_message && <div className="sm:col-span-3"><p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{run.error_message}</p></div>}
                </article>
              ))}
            </div>
          )}
      </section>

      <AnalyzeFlowModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        defaultFolder={activeFolder}
        title={`Add files and sources to ${activeFolder}`}
        eyebrow="Import knowledge"
        onCreated={(createdRuns, context) => {
          setRuns((current) => [...createdRuns, ...current]);
          if (context.folderId) {
            setSelectedFolderId(context.folderId);
          }
          void refreshFolders();
          startAnalysisSession(createdRuns as IngestionRunRow[], context);
          setMessage("Files added to the knowledge library and queued for extraction.");
          setError(null);
          setShowImportModal(false);
        }}
      />
    </div>
  );
}
