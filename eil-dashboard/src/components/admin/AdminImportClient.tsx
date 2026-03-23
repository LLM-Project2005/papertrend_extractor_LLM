"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  CloudIcon,
  CloseIcon,
  DriveIcon,
  FileIcon,
  FolderIcon,
  OneDriveIcon,
  PaperIcon,
  PlusIcon,
  SharePointIcon,
  UploadIcon,
} from "@/components/ui/Icons";

interface IngestionRun {
  id: string;
  source_type: "batch" | "upload";
  status: "queued" | "processing" | "succeeded" | "failed";
  source_filename?: string | null;
  source_path?: string | null;
  provider?: string | null;
  model?: string | null;
  input_payload?: { folder_name?: string; source_kind?: string } | null;
  error_message?: string | null;
  updated_at?: string;
}

type ImportSource =
  | "pdf-upload"
  | "google-drive"
  | "onedrive"
  | "sharepoint"
  | "cloud-storage";

const FOLDER_STORAGE_KEY = "papertrend_import_folders_v1";

const SOURCE_OPTIONS = [
  { id: "pdf-upload", label: "PDF upload", status: "ready", icon: UploadIcon, description: "Upload papers directly into the workspace knowledge library." },
  { id: "google-drive", label: "Google Drive", status: "planned", icon: DriveIcon, description: "Planned connector for shared drive folders and research archives." },
  { id: "onedrive", label: "OneDrive", status: "planned", icon: OneDriveIcon, description: "Planned connector for institution-managed document libraries." },
  { id: "sharepoint", label: "SharePoint", status: "planned", icon: SharePointIcon, description: "Planned connector for Microsoft knowledge bases and file stores." },
  { id: "cloud-storage", label: "Cloud storage", status: "planned", icon: CloudIcon, description: "Planned connector for buckets and external archives." },
] as const;

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

function getFolderName(run: IngestionRun) {
  const payloadFolder = run.input_payload?.folder_name?.trim();
  if (payloadFolder) return payloadFolder;
  const parts = (run.source_path ?? "").split("/").filter(Boolean);
  return parts.length >= 3 && parts[0] === "pending" ? parts[1] : "Inbox";
}

function sanitizeFolderName(folderName: string) {
  return folderName.trim().replace(/[\\/]+/g, "-");
}

export default function AdminImportClient() {
  const { session, isAdmin, user } = useAuth();
  const [adminSecret, setAdminSecret] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [folders, setFolders] = useState<string[]>(["Inbox"]);
  const [activeFolder, setActiveFolder] = useState("Inbox");
  const [draftFolderName, setDraftFolderName] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [selectedSource, setSelectedSource] = useState<ImportSource>("pdf-upload");
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedSecret = window.localStorage.getItem("eil_admin_secret");
    if (savedSecret) setAdminSecret(savedSecret);
    const savedFolders = window.localStorage.getItem(FOLDER_STORAGE_KEY);
    if (savedFolders) {
      try {
        const parsed = JSON.parse(savedFolders) as string[];
        if (parsed.length > 0) setFolders(Array.from(new Set(["Inbox", ...parsed])));
      } catch {}
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    if (isAdmin && session?.access_token) void loadRuns();
  }, [isAdmin, session?.access_token]);

  const authHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {};
    if (isAdmin && session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
      return headers;
    }
    if (adminSecret.trim()) headers["x-admin-secret"] = adminSecret.trim();
    return headers;
  }, [adminSecret, isAdmin, session?.access_token]);

  const selectedSourceMeta = SOURCE_OPTIONS.find((source) => source.id === selectedSource)!;
  const visibleRuns = useMemo(() => runs.filter((run) => getFolderName(run) === activeFolder), [activeFolder, runs]);

  async function loadRuns(secretOverride?: string) {
    const secret = secretOverride ?? adminSecret;
    const headers: Record<string, string> | null =
      isAdmin && session?.access_token
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
      const nextRuns = payload.runs ?? [];
      setRuns(nextRuns);
      setFolders((current) => Array.from(new Set(["Inbox", ...current, ...nextRuns.map(getFolderName)])));
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

  function handleCreateFolder() {
    const sanitized = sanitizeFolderName(draftFolderName);
    if (!sanitized) {
      setError("Enter a folder name first.");
      return;
    }
    setFolders((current) => Array.from(new Set([...current, sanitized])));
    setActiveFolder(sanitized);
    setDraftFolderName("");
    setShowFolderInput(false);
    setMessage(`Folder "${sanitized}" created.`);
  }

  async function handleUpload() {
    if (!isAdmin && !adminSecret.trim()) {
      setError("Sign in as an admin or enter the shared admin secret before importing.");
      return;
    }
    if (selectedSource !== "pdf-upload") {
      setError("This connector is planned but not yet live. Use PDF upload for now.");
      return;
    }
    if (files.length === 0) {
      setError("Choose at least one PDF file.");
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("folder", activeFolder);
      formData.append("source_kind", selectedSource);
      if (provider.trim()) formData.append("provider", provider.trim());
      if (model.trim()) formData.append("model", model.trim());

      const response = await fetch("/api/admin/import", {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      const payload = (await response.json()) as { runs?: IngestionRun[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Import failed.");

      setFiles([]);
      setRuns((current) => [...(payload.runs ?? []), ...current]);
      setFolders((current) => Array.from(new Set([...current, activeFolder])));
      setShowImportModal(false);
      setMessage("Files added to the knowledge library and queued for extraction.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Import failed.");
    } finally {
      setUploading(false);
    }
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
        {folders.map((folder) => {
          const active = folder === activeFolder;
          return (
            <button key={folder} type="button" onClick={() => setActiveFolder(folder)} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-slate-900 text-white dark:bg-[#f3f3f3] dark:text-[#171717]" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#212121] dark:text-[#b8b8b8] dark:hover:bg-[#2a2a2a]"}`}>
              <FolderIcon className="h-4 w-4" />
              <span>{folder}</span>
            </button>
          );
        })}
      </div>

      {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <section className="app-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-[#2f2f2f] sm:px-5">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">Files</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-[#9c9c9c]">{visibleRuns.length} item{visibleRuns.length === 1 ? "" : "s"} in {activeFolder}</p>
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
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-[#171717] dark:text-[#b8b8b8]">{run.input_payload?.source_kind ?? run.source_type}</span>
                    </div>
                    <div className="mt-3 flex items-start gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-[#171717] dark:text-[#b8b8b8]"><FileIcon className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">{run.source_filename || run.id}</p>
                        <p className="mt-1 break-all text-xs text-slate-500 dark:text-[#8f8f8f]">{run.source_path || "Queued upload"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-slate-500 dark:text-[#9c9c9c]"><p>Updated</p><p className="mt-1 text-slate-900 dark:text-[#e2e2e2]">{formatTimestamp(run.updated_at)}</p></div>
                  <div className="text-sm text-slate-500 dark:text-[#9c9c9c]"><p>Model</p><p className="mt-1 text-slate-900 dark:text-[#e2e2e2]">{run.model || "Not set"}</p></div>
                  {run.error_message && <div className="sm:col-span-3"><p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{run.error_message}</p></div>}
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="app-surface px-5 py-5">
            <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">Access</p>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">{user ? `Signed in as ${user.email}. Current role: ${isAdmin ? "admin" : "member"}.` : "Sign in as an admin or use the shared admin secret to manage imports."}</p>
            <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-[#d4d4d4]">Shared admin secret</label>
            <div className="mt-2 flex gap-2">
              <input type="password" value={adminSecret} onChange={(event) => setAdminSecret(event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#171717] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10" placeholder={isAdmin ? "Optional when signed in as admin" : "Enter the shared admin secret"} />
              <button type="button" onClick={handleSecretSave} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-[#2f2f2f] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:bg-[#171717]">Save</button>
            </div>
          </section>

          <section className="app-surface px-5 py-5">
            <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">Knowledge sources</p>
            <div className="mt-4 space-y-3">
              {SOURCE_OPTIONS.map((source) => {
                const Icon = source.icon;
                return (
                  <div key={source.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 dark:bg-[#212121] dark:text-[#d4d4d4]"><Icon className="h-5 w-5" /></span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">{source.label}</p>
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-[#2a2a2a] dark:text-[#b8b8b8]">{source.status}</span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">{source.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-[#2f2f2f] dark:bg-[#212121]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-[#2f2f2f] sm:px-6">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-[#9c9c9c]">Import knowledge</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-[#f2f2f2]">Add files and sources to {activeFolder}</h2>
              </div>
              <button type="button" onClick={() => setShowImportModal(false)} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0]"><CloseIcon className="h-4 w-4" /></button>
            </div>

            <div className="space-y-6 px-5 py-5 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {SOURCE_OPTIONS.map((source) => {
                  const Icon = source.icon;
                  const active = source.id === selectedSource;
                  return (
                    <button key={source.id} type="button" onClick={() => setSelectedSource(source.id)} className={`rounded-3xl border px-4 py-4 text-left transition-colors ${active ? "border-slate-900 bg-slate-900 text-white dark:border-[#f3f3f3] dark:bg-[#f3f3f3] dark:text-[#171717]" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-[#2f2f2f] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a]"}`}>
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/5 dark:bg-black/10"><Icon className="h-5 w-5" /></span>
                      <p className="mt-4 text-sm font-medium">{source.label}</p>
                      <p className={`mt-2 text-xs leading-5 ${active ? "text-white/75 dark:text-[#4a4a4a]" : "text-slate-500 dark:text-[#9c9c9c]"}`}>{source.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center dark:border-[#3a3a3a] dark:bg-[#171717]">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-600 dark:bg-[#212121] dark:text-[#d0d0d0]"><PaperIcon className="h-6 w-6" /></span>
                <p className="mt-4 text-base font-medium text-slate-900 dark:text-[#f2f2f2]">{selectedSourceMeta.id === "pdf-upload" ? "Drop PDFs here or browse files" : `${selectedSourceMeta.label} connector is planned`}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#9c9c9c]">{selectedSourceMeta.id === "pdf-upload" ? "The selected files will be uploaded into Supabase Storage and queued for extraction." : "Keep this source visible in the UI now, then connect the real integration later without changing the import flow."}</p>
                {selectedSourceMeta.id === "pdf-upload" ? (
                  <div className="mt-5">
                    <input type="file" accept="application/pdf" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []).filter(Boolean))} className="mx-auto block w-full max-w-md text-sm text-slate-600 dark:text-[#b8b8b8]" />
                  </div>
                ) : (
                  <button type="button" disabled className="mt-5 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-400 dark:border-[#2f2f2f] dark:text-[#707070]">Coming soon</button>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
                  <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">Selected files</p>
                  {files.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500 dark:text-[#9c9c9c]">No files selected yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {files.map((file) => (
                        <div key={file.name} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-[#2f2f2f] dark:bg-[#212121]">
                          <div className="flex items-center gap-3">
                            <FileIcon className="h-4 w-4 text-slate-400 dark:text-[#9c9c9c]" />
                            <span className="text-sm text-slate-900 dark:text-[#f2f2f2]">{file.name}</span>
                          </div>
                          <span className="text-xs text-slate-500 dark:text-[#9c9c9c]">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#2f2f2f] dark:bg-[#171717]">
                  <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">Processing details</p>
                  <div className="mt-4 space-y-3">
                    <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Provider, e.g. OpenRouter" className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#212121] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10" />
                    <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model, e.g. openai/gpt-4o-mini" className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#212121] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-[#2f2f2f]">
              <p className="text-sm text-slate-500 dark:text-[#9c9c9c]">Folder: <span className="font-medium text-slate-900 dark:text-[#f2f2f2]">{activeFolder}</span></p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setShowImportModal(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 dark:border-[#2f2f2f] dark:text-[#b8b8b8]">Cancel</button>
                <button type="button" onClick={handleUpload} disabled={uploading || selectedSource !== "pdf-upload"} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-[#f3f3f3] dark:text-[#171717] dark:disabled:bg-[#3a3a3a] dark:disabled:text-[#7e7e7e]">
                  {uploading ? "Importing..." : "Import to folder"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
