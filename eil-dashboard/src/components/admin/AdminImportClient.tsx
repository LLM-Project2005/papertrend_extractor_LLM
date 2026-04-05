"use client";

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import AnalyzeFlowModal from "@/components/workspace/AnalyzeFlowModal";
import CreateEntityModal from "@/components/workspace/CreateEntityModal";
import Modal from "@/components/ui/Modal";
import PaperExplorer from "@/components/tabs/PaperExplorer";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { useDashboardData } from "@/hooks/useData";
import {
  DriveIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PaperIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import type { IngestionRunRow } from "@/types/database";

type LibraryView = "files" | "favorites" | "trash" | "papers";
type FileMenuState = {
  run: IngestionRunRow;
  top: number;
  left: number;
};

function titleOf(run: IngestionRunRow) {
  return run.display_name || run.source_filename || run.id;
}

function extOf(run: IngestionRunRow) {
  return (
    run.source_extension ||
    titleOf(run).split(".").pop()?.toLowerCase() ||
    "file"
  );
}

function fileColor(run: IngestionRunRow) {
  const ext = extOf(run);
  if (ext === "pdf") return "bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-300";
  if (ext === "docx" || ext === "doc") {
    return "bg-blue-100 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300";
  }
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    return "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  return "bg-slate-200 text-slate-700 dark:bg-[#2b2b2b] dark:text-[#d6d6d6]";
}

function fileGlyph(run: IngestionRunRow) {
  const ext = extOf(run);
  if (sourceOf(run) === "Google Drive") return DriveIcon;
  if (ext === "pdf") return PaperIcon;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return ImageIcon;
  return FileIcon;
}

function sourceOf(run: IngestionRunRow) {
  const value =
    typeof run.input_payload?.source_kind === "string"
      ? run.input_payload.source_kind
      : run.source_type;
  return value === "google-drive" ? "Google Drive" : "Upload";
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "Unknown size";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function AdminImportClient() {
  const { session } = useAuth();
  const {
    currentProject,
    folders,
    selectedFolderId,
    setSelectedFolderId,
    createFolder,
    refreshFolders,
    startAnalysisSession,
  } = useWorkspaceProfile();
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  const [view, setView] = useState<LibraryView>("files");
  const [query, setQuery] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [draftFolderName, setDraftFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderModalError, setFolderModalError] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<FileMenuState | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [infoRun, setInfoRun] = useState<IngestionRunRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    return headers;
  }, [session?.access_token]);
  const jsonRequestHeaders = useMemo<Record<string, string>>(
    () => ({
      "Content-Type": "application/json",
      ...requestHeaders,
    }),
    [requestHeaders]
  );

  const folderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);
  const { data } = useDashboardData(selectedFolderId, folderIds);

  const activeFolder =
    selectedFolderId === "all"
      ? folders[0]?.name ?? "Inbox"
      : folders.find((folder) => folder.id === selectedFolderId)?.name ?? "Inbox";
  const activeMenuRun = menuState?.run ?? null;

  async function loadRuns(nextView: LibraryView = view) {
    if (!currentProject?.id || !session?.access_token) {
      setRuns([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspace/library?projectId=${encodeURIComponent(
          currentProject.id
        )}&includeTrashed=${nextView === "trash" ? "true" : "false"}`,
        { headers: requestHeaders }
      );
      const payload = (await response.json()) as { runs?: IngestionRunRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load library files.");
      setRuns(payload.runs ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load library files.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, [currentProject?.id, requestHeaders, session?.access_token, view]);

  useEffect(() => {
    if (!menuState) return;
    const closeMenu = () => setMenuState(null);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuState]);

  async function patchRun(runId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/workspace/library/${runId}`, {
      method: "PATCH",
      headers: jsonRequestHeaders,
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { run?: IngestionRunRow; error?: string };
    if (!response.ok || !payload.run) throw new Error(payload.error ?? "Action failed.");
    setRuns((current) => current.map((run) => (run.id === payload.run!.id ? payload.run! : run)));
    return payload.run;
  }

  async function postRun(runId: string, action: "copy" | "open") {
    const response = await fetch(`/api/workspace/library/${runId}`, {
      method: "POST",
      headers: jsonRequestHeaders,
      body: JSON.stringify({ action }),
    });
    const payload = (await response.json()) as {
      run?: IngestionRunRow;
      url?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? "Action failed.");
    return payload;
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftFolderName.trim()) return;
    setCreatingFolder(true);
    setFolderModalError(null);
    try {
      const folder = await createFolder(draftFolderName.trim());
      setSelectedFolderId(folder.id);
      setDraftFolderName("");
      setShowFolderModal(false);
      setMessage(`Folder "${folder.name}" created.`);
      setError(null);
    } catch (createError) {
      const nextError =
        createError instanceof Error ? createError.message : "Failed to create folder.";
      setFolderModalError(nextError);
      setError(nextError);
    } finally {
      setCreatingFolder(false);
    }
  }

  function openFileMenu(event: ReactMouseEvent<HTMLButtonElement>, run: IngestionRunRow) {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const estimatedHeight = 340;
    const margin = 16;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < estimatedHeight && rect.top > estimatedHeight;
    const top = openAbove
      ? Math.max(margin, rect.top - estimatedHeight - 8)
      : Math.max(
          margin,
          Math.min(window.innerHeight - margin - estimatedHeight, rect.bottom + 8)
        );
    const left = Math.min(
      window.innerWidth - margin - menuWidth,
      Math.max(margin, rect.right - menuWidth)
    );
    setMenuState({ run, top, left });
  }

  const visibleRuns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (selectedFolderId !== "all" && run.folder_id !== selectedFolderId) return false;
      if (view === "favorites" && !run.is_favorite) return false;
      if (view === "trash" && !run.trashed_at) return false;
      if (view !== "trash" && run.trashed_at) return false;
      if (!needle) return true;
      return [titleOf(run), run.source_path, sourceOf(run), extOf(run)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [query, runs, selectedFolderId, view]);

  const paperData = useMemo(() => {
    if (!data) return { trends: [], tracksSingle: [] };
    if (!query.trim()) return { trends: data.trends, tracksSingle: data.tracksSingle };
    const ids = new Set(
      data.trends
        .filter((row) =>
          [row.title, row.topic, row.keyword, row.year]
            .join(" ")
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        )
        .map((row) => row.paper_id)
    );
    return {
      trends: data.trends.filter((row) => ids.has(row.paper_id)),
      tracksSingle: data.tracksSingle.filter((row) => ids.has(row.paper_id)),
    };
  }, [data, query]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">Library</h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500 dark:text-[#a3a3a3]">
            Manage files and analyzed papers together inside {currentProject?.name ?? "this project"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setFolderModalError(null); setShowFolderModal(true); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:bg-[#212121] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white">
            <FolderIcon className="h-4 w-4" />
            <span>New folder</span>
          </button>
          <button type="button" onClick={() => setShowImportModal(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-[#f3f3f3] dark:text-[#171717] dark:hover:bg-white">
            <PlusIcon className="h-4 w-4" />
            <span>Add files</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "files" as const, label: "Files" },
            { id: "favorites" as const, label: "Favorites" },
            { id: "trash" as const, label: "Trash" },
            { id: "papers" as const, label: "Analyzed papers" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                view === item.id
                  ? "bg-slate-900 text-white dark:bg-[#f3f3f3] dark:text-[#171717]"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#212121] dark:text-[#b8b8b8] dark:hover:bg-[#2a2a2a]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="relative block w-full max-w-md">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#8e8e8e]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={view === "papers" ? "Search analyzed papers" : "Search files"}
            className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-[#353535] dark:bg-[#212121] dark:text-white dark:placeholder:text-[#727272] dark:focus:border-white dark:focus:ring-white/10"
          />
        </label>
      </div>

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
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => setSelectedFolderId(folder.id)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              selectedFolderId === folder.id
                ? "bg-slate-900 text-white dark:bg-[#f3f3f3] dark:text-[#171717]"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#212121] dark:text-[#b8b8b8] dark:hover:bg-[#2a2a2a]"
            }`}
          >
            <FolderIcon className="h-4 w-4" />
            <span>{folder.name}</span>
          </button>
        ))}
      </div>

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</div> : null}

      {view === "papers" ? (
        <section className="app-surface px-4 py-4 sm:px-5">
          <PaperExplorer trends={paperData.trends} tracksSingle={paperData.tracksSingle} />
        </section>
      ) : (
        <section className="app-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-[#2f2f2f] sm:px-5">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">Files</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-[#9c9c9c]">
                {visibleRuns.length} item{visibleRuns.length === 1 ? "" : "s"} in {selectedFolderId === "all" ? "all folders" : activeFolder}
              </p>
            </div>
            <button type="button" onClick={() => void loadRuns()} disabled={loading} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-[#2f2f2f] dark:text-[#b8b8b8] dark:hover:border-[#3a3a3a] dark:hover:text-white">
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          {visibleRuns.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center px-6 py-10 text-center">
              <div>
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-[#171717] dark:text-[#9c9c9c]">
                  <FolderIcon className="h-6 w-6" />
                </span>
                <p className="mt-4 text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
                  {view === "trash" ? "Trash is empty" : "No files in this view yet"}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-[#2f2f2f]">
              {visibleRuns.map((run) => (
                <article key={run.id} className="group grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1.3fr)_170px_120px_auto] sm:items-center sm:px-5">
                  <div className="min-w-0">
                    <div className="flex items-start gap-3">
                      {(() => {
                        const Glyph = fileGlyph(run);
                        return (
                          <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-2xl ${fileColor(run)}`}>
                            <Glyph className="h-5 w-5" />
                          </span>
                        );
                      })()}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">{titleOf(run)}</p>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#171717] dark:text-[#b8b8b8]">{extOf(run).toUpperCase()}</span>
                          {run.is_favorite ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Favorite</span> : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-[#9c9c9c]">{sourceOf(run)} | {formatBytes(run.file_size_bytes)}</p>
                        <p className="mt-1 break-all text-xs text-slate-500 dark:text-[#8f8f8f]">{run.source_path || "Queued upload"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="text-sm text-slate-500 dark:text-[#9c9c9c]">
                    <p>Updated</p>
                    <p className="mt-1 text-slate-900 dark:text-[#e2e2e2]">{formatTime(run.updated_at)}</p>
                  </div>

                  <div className="text-sm text-slate-500 dark:text-[#9c9c9c]">
                    <p>Status</p>
                    <p className="mt-1 capitalize text-slate-900 dark:text-[#e2e2e2]">{run.status}</p>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={(event) => {
                        if (menuState?.run.id === run.id) {
                          setMenuState(null);
                          return;
                        }
                        openFileMenu(event, run);
                      }}
                      className="rounded-xl border border-transparent p-2 text-slate-500 opacity-0 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 group-hover:opacity-100 dark:text-[#8f8f8f] dark:hover:border-[#343434] dark:hover:bg-[#1a1a1a] dark:hover:text-white"
                    >
                      <MoreHorizontalIcon className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <CreateEntityModal
        open={showFolderModal}
        title="Create folder"
        description="Create a new folder inside the current project."
        value={draftFolderName}
        fieldLabel="Folder name"
        fieldPlaceholder="For example: Syntax papers"
        submitLabel="Create folder"
        busyLabel="Creating..."
        busy={creatingFolder}
        error={folderModalError}
        onValueChange={setDraftFolderName}
        onClose={() => {
          setDraftFolderName("");
          setFolderModalError(null);
          setShowFolderModal(false);
        }}
        onSubmit={handleCreateFolder}
      />

      {activeMenuRun && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuState(null)}
                role="presentation"
              />
              <div
                className="fixed z-50 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-[#2f2f2f] dark:bg-[#1b1b1b]"
                style={{ top: `${menuState?.top ?? 0}px`, left: `${menuState?.left ?? 0}px` }}
                onClick={(event) => event.stopPropagation()}
                role="presentation"
              >
                <button type="button" onClick={async () => { try { const payload = await postRun(activeMenuRun.id, "open"); if (payload.url) { setPreviewUrl(payload.url); setPreviewTitle(titleOf(activeMenuRun)); } } catch (openError) { setError(openError instanceof Error ? openError.message : "Failed to open file."); } finally { setMenuState(null); } }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]">Preview</button>
                <button type="button" onClick={async () => { try { const payload = await postRun(activeMenuRun.id, "open"); if (payload.url) window.open(payload.url, "_blank", "noopener,noreferrer"); } catch (openError) { setError(openError instanceof Error ? openError.message : "Failed to open file."); } finally { setMenuState(null); } }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]">Open in new tab</button>
                <button type="button" onClick={async () => { const nextName = window.prompt("Rename file", titleOf(activeMenuRun)); if (!nextName?.trim()) { setMenuState(null); return; } try { await patchRun(activeMenuRun.id, { action: "rename", value: nextName.trim() }); } catch (renameError) { setError(renameError instanceof Error ? renameError.message : "Failed to rename file."); } finally { setMenuState(null); } }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]">Edit name</button>
                <button type="button" onClick={async () => { try { const payload = await postRun(activeMenuRun.id, "copy"); if (payload.run) setRuns((current) => [payload.run!, ...current]); } catch (copyError) { setError(copyError instanceof Error ? copyError.message : "Failed to copy file."); } finally { setMenuState(null); } }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]">Make a copy</button>
                <button type="button" onClick={async () => { const target = window.prompt("Move to folder", folders.find((folder) => folder.id === activeMenuRun.folder_id)?.name ?? activeFolder); if (!target?.trim()) { setMenuState(null); return; } try { const existing = folders.find((folder) => folder.name.toLowerCase() === target.trim().toLowerCase()); const folder = existing ?? (await createFolder(target.trim())); await patchRun(activeMenuRun.id, { action: "move", folderId: folder.id }); await refreshFolders(); } catch (moveError) { setError(moveError instanceof Error ? moveError.message : "Failed to move file."); } finally { setMenuState(null); } }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]">Move to folder</button>
                <button type="button" onClick={async () => { try { await patchRun(activeMenuRun.id, { action: "favorite", value: !activeMenuRun.is_favorite }); } catch (favoriteError) { setError(favoriteError instanceof Error ? favoriteError.message : "Failed to update favorite."); } finally { setMenuState(null); } }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]">{activeMenuRun.is_favorite ? "Remove favorite" : "Add to favorite"}</button>
                <button type="button" onClick={() => { setInfoRun(activeMenuRun); setMenuState(null); }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]">File information</button>
                <button type="button" onClick={async () => { try { await patchRun(activeMenuRun.id, { action: activeMenuRun.trashed_at ? "restore" : "trash" }); if (!activeMenuRun.trashed_at && view !== "trash") setRuns((current) => current.filter((item) => item.id !== activeMenuRun.id)); } catch (trashError) { setError(trashError instanceof Error ? trashError.message : "Failed to update trash."); } finally { setMenuState(null); } }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/20">{activeMenuRun.trashed_at ? "Restore from trash" : "Move to trash"}</button>
              </div>
            </>,
            document.body
          )
        : null}

      <AnalyzeFlowModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        defaultFolder={activeFolder}
        title={`Add files to ${currentProject?.name ?? "this project"}`}
        eyebrow="Library"
        onCreated={(createdRuns, context) => {
          setRuns((current) => [...createdRuns, ...current]);
          if (context.folderId) setSelectedFolderId(context.folderId);
          void refreshFolders();
          startAnalysisSession(createdRuns as IngestionRunRow[], context);
          setMessage("Files were added to the library and queued for analysis.");
          setError(null);
          setShowImportModal(false);
        }}
      />

      {previewUrl ? (
        <Modal onClose={() => setPreviewUrl(null)}>
          <div className="h-[85vh] w-[min(1100px,92vw)] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-[#2f2f2f] dark:bg-[#111111]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#2f2f2f]">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{previewTitle}</p>
              <button
                type="button"
                onClick={() => setPreviewUrl(null)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
              >
                Close
              </button>
            </div>
            <iframe src={previewUrl} title={previewTitle} className="h-[calc(85vh-65px)] w-full bg-white" />
          </div>
        </Modal>
      ) : null}

      {infoRun ? (
        <Modal onClose={() => setInfoRun(null)}>
          <div className="w-[min(560px,92vw)] rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-2xl dark:border-[#2f2f2f] dark:bg-[#111111]">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">File information</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Name</dt>
                <dd className="text-right text-slate-900 dark:text-white">{titleOf(infoRun)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Type</dt>
                <dd className="text-right text-slate-900 dark:text-white">{extOf(infoRun).toUpperCase()}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Size</dt>
                <dd className="text-right text-slate-900 dark:text-white">{formatBytes(infoRun.file_size_bytes)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Updated</dt>
                <dd className="text-right text-slate-900 dark:text-white">{formatTime(infoRun.updated_at)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Path</dt>
                <dd className="max-w-[280px] break-all text-right text-slate-900 dark:text-white">{infoRun.source_path || "Unavailable"}</dd>
              </div>
            </dl>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
