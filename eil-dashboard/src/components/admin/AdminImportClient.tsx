"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import CreateEntityModal from "@/components/workspace/CreateEntityModal";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import Modal from "@/components/ui/Modal";
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  DriveIcon,
  FileIcon,
  FolderIcon,
  GridViewIcon,
  ImageIcon,
  ListViewIcon,
  MoreHorizontalIcon,
  PaperIcon,
  PencilSquareIcon,
  PlusIcon,
  SearchIcon,
  SortIcon,
  StarIcon,
  UploadIcon,
} from "@/components/ui/Icons";
import type {
  FolderAnalysisJobRow,
  IngestionRunRow,
  ResearchFolderRow,
} from "@/types/database";

type ViewMode = "list" | "grid";
type TypeFilter = "all" | "folder" | "pdf" | "image" | "document" | "other";
type ModifiedFilter = "all" | "7d" | "30d" | "year" | "older";
type SourceFilter = "all" | "upload" | "google-drive" | "workspace";
type SortKey = "name" | "modified" | "size";
type SortDirection = "asc" | "desc";
type FolderPlacement = "on-top" | "mixed";
type ToolbarPopoverKind = "new" | "type" | "modified" | "source" | "sort";

type ToolbarPopoverState = {
  kind: ToolbarPopoverKind;
  top: number;
  left: number;
  width: number;
};

type LibraryEntry = {
  id: string;
  kind: "folder" | "file";
  name: string;
  ownerLabel: string;
  modifiedAt: string | null;
  modifiedMs: number;
  sizeBytes: number | null;
  sizeLabel: string;
  typeFilter: TypeFilter;
  sourceFilter: SourceFilter;
  sourceLabel: string;
  subtitle: string;
  statusLabel: string | null;
  favorite: boolean;
  folder?: ResearchFolderRow;
  run?: IngestionRunRow;
};

type ItemMenuState = {
  item: LibraryEntry;
  top: number;
  left: number;
};

const TYPE_OPTIONS: Array<{ id: TypeFilter; label: string }> = [
  { id: "all", label: "All types" },
  { id: "folder", label: "Folders" },
  { id: "pdf", label: "PDF" },
  { id: "image", label: "Images" },
  { id: "document", label: "Documents" },
  { id: "other", label: "Other files" },
];

const MODIFIED_OPTIONS: Array<{ id: ModifiedFilter; label: string }> = [
  { id: "all", label: "Any time" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "year", label: "This year" },
  { id: "older", label: "Older" },
];

const SOURCE_OPTIONS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All sources" },
  { id: "upload", label: "Upload" },
  { id: "google-drive", label: "Google Drive" },
  { id: "workspace", label: "Workspace folders" },
];

const SORT_KEY_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: "name", label: "Name" },
  { id: "modified", label: "Date modified" },
  { id: "size", label: "File size" },
];

const FOLDER_PLACEMENT_OPTIONS: Array<{ id: FolderPlacement; label: string }> = [
  { id: "on-top", label: "On top" },
  { id: "mixed", label: "Mixed with files" },
];

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

function sourceOf(run: IngestionRunRow) {
  const value =
    typeof run.input_payload?.source_kind === "string"
      ? run.input_payload.source_kind
      : run.source_type;
  return value === "google-drive" ? "Google Drive" : "Upload";
}

function typeOfRun(run: IngestionRunRow): Exclude<TypeFilter, "all" | "folder"> {
  const ext = extOf(run);
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt"].includes(ext)) {
    return "document";
  }
  return "other";
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "\u2014";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function timeToMs(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatShortDate(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDetailedDate(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function matchesModifiedFilter(modifiedMs: number, filter: ModifiedFilter) {
  if (filter === "all") return true;
  if (!modifiedMs) return false;
  const now = Date.now();
  const diff = now - modifiedMs;
  const days = diff / (1000 * 60 * 60 * 24);
  if (filter === "7d") return days <= 7;
  if (filter === "30d") return days <= 30;
  if (filter === "year") {
    return new Date(modifiedMs).getFullYear() === new Date().getFullYear();
  }
  return days > 365;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getPopoverPosition(rect: DOMRect, width: number, estimatedHeight: number) {
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
    window.innerWidth - margin - width,
    Math.max(margin, rect.left)
  );
  return { top, left };
}

function getFolderUploadName(files: File[]) {
  for (const file of files) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (relativePath && relativePath.includes("/")) {
      const [folder] = relativePath.split("/");
      if (folder?.trim()) return folder.trim();
    }
  }
  return "Uploaded folder";
}

const MAX_UPLOAD_BATCH_FILES = 8;
const MAX_UPLOAD_BATCH_BYTES = 18 * 1024 * 1024;

function splitIntoUploadBatches(files: File[]) {
  const batches: File[][] = [];
  let currentBatch: File[] = [];
  let currentBytes = 0;

  for (const file of files) {
    const wouldOverflowCount = currentBatch.length >= MAX_UPLOAD_BATCH_FILES;
    const wouldOverflowBytes =
      currentBatch.length > 0 && currentBytes + file.size > MAX_UPLOAD_BATCH_BYTES;

    if (wouldOverflowCount || wouldOverflowBytes) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(file);
    currentBytes += file.size;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function readJsonPayload<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function buildUploadErrorMessage(fallback: string, payload: { error?: string } | null) {
  if (payload?.error?.trim()) {
    return payload.error;
  }
  return fallback;
}

function glyphForEntry(item: LibraryEntry) {
  if (item.kind === "folder") return FolderIcon;
  if (item.sourceFilter === "google-drive") return DriveIcon;
  if (item.typeFilter === "pdf") return PaperIcon;
  if (item.typeFilter === "image") return ImageIcon;
  return FileIcon;
}

function badgeToneForEntry(item: LibraryEntry) {
  if (item.kind === "folder") {
    return "bg-[#f7c948]/15 text-[#b88900] dark:bg-[#f7c948]/10 dark:text-[#f7d05a]";
  }
  if (item.typeFilter === "pdf") {
    return "bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-300";
  }
  if (item.typeFilter === "image") {
    return "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (item.sourceFilter === "google-drive") {
    return "bg-sky-100 text-sky-600 dark:bg-sky-950/30 dark:text-sky-300";
  }
  return "bg-slate-200 text-slate-700 dark:bg-[#2b2b2b] dark:text-[#d6d6d6]";
}

function defaultDirectionForSort(sortKey: SortKey): SortDirection {
  return sortKey === "name" ? "asc" : "desc";
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
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [modifiedFilter, setModifiedFilter] = useState<ModifiedFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [folderPlacement, setFolderPlacement] = useState<FolderPlacement>("on-top");
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [draftFolderName, setDraftFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderModalError, setFolderModalError] = useState<string | null>(null);
  const [toolbarPopover, setToolbarPopover] = useState<ToolbarPopoverState | null>(null);
  const [itemMenuState, setItemMenuState] = useState<ItemMenuState | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [infoRun, setInfoRun] = useState<IngestionRunRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders]
  );

  const activeFolder =
    selectedFolderId === "all" ? null : folderById.get(selectedFolderId) ?? null;
  const ownerInitial = (session?.user?.email?.charAt(0) ?? "M").toUpperCase();

  async function loadRuns() {
    if (!currentProject?.id || !session?.access_token) {
      setRuns([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspace/library?projectId=${encodeURIComponent(currentProject.id)}`,
        { headers: requestHeaders }
      );
      const payload = (await response.json()) as {
        runs?: IngestionRunRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load library files.");
      }
      setRuns(payload.runs ?? []);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load library files."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, [currentProject?.id, requestHeaders, session?.access_token]);

  useEffect(() => {
    if (!toolbarPopover && !itemMenuState) return;
    const closeMenus = () => {
      setToolbarPopover(null);
      setItemMenuState(null);
    };
    window.addEventListener("resize", closeMenus);
    window.addEventListener("scroll", closeMenus, true);
    return () => {
      window.removeEventListener("resize", closeMenus);
      window.removeEventListener("scroll", closeMenus, true);
    };
  }, [itemMenuState, toolbarPopover]);

  async function patchRun(runId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/workspace/library/${runId}`, {
      method: "PATCH",
      headers: jsonRequestHeaders,
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { run?: IngestionRunRow; error?: string };
    if (!response.ok || !payload.run) {
      throw new Error(payload.error ?? "Action failed.");
    }
    setRuns((current) =>
      current.map((run) => (run.id === payload.run!.id ? payload.run! : run))
    );
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
    if (!response.ok) {
      throw new Error(payload.error ?? "Action failed.");
    }
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

  async function handlePreviewRun(run: IngestionRunRow) {
    const payload = await postRun(run.id, "open");
    if (payload.url) {
      setPreviewUrl(payload.url);
      setPreviewTitle(titleOf(run));
    }
  }

  async function handleOpenRunInNewTab(run: IngestionRunRow) {
    const payload = await postRun(run.id, "open");
    if (payload.url) {
      window.open(payload.url, "_blank", "noopener,noreferrer");
    }
  }

  async function handleDownloadRun(run: IngestionRunRow) {
    const payload = await postRun(run.id, "open");
    if (!payload.url) return;
    const anchor = document.createElement("a");
    anchor.href = payload.url;
    anchor.download = titleOf(run);
    anchor.rel = "noopener noreferrer";
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function handleRenameRun(run: IngestionRunRow) {
    const nextName = window.prompt("Rename file", titleOf(run));
    if (!nextName?.trim()) return;
    await patchRun(run.id, { action: "rename", value: nextName.trim() });
    setMessage(`Renamed "${titleOf(run)}".`);
  }

  async function handleToggleFavorite(run: IngestionRunRow) {
    await patchRun(run.id, { action: "favorite", value: !run.is_favorite });
  }

  async function handleCopyRun(run: IngestionRunRow) {
    const payload = await postRun(run.id, "copy");
    if (payload.run) {
      setRuns((current) => [
        payload.run!,
        ...current.filter((item) => item.id !== payload.run!.id),
      ]);
    }
  }

  async function handleMoveRun(run: IngestionRunRow) {
    const activeFolderName =
      folders.find((folder) => folder.id === run.folder_id)?.name ?? "Inbox";
    const target = window.prompt("Move to folder", activeFolderName);
    if (!target?.trim()) return;
    const existing = folders.find(
      (folder) => folder.name.toLowerCase() === target.trim().toLowerCase()
    );
    const folder = existing ?? (await createFolder(target.trim()));
    await patchRun(run.id, { action: "move", folderId: folder.id });
    await refreshFolders();
  }

  async function handleTrashRun(run: IngestionRunRow) {
    await patchRun(run.id, { action: "trash" });
    setRuns((current) => current.filter((item) => item.id !== run.id));
  }

  async function queueUploads(selectedFiles: File[], mode: "files" | "folder") {
    setToolbarPopover(null);
    if (!session?.access_token) {
      setError("Sign in before uploading files.");
      return;
    }
    if (!currentProject?.id) {
      setError("Choose a project before uploading files.");
      return;
    }

    const pdfFiles = selectedFiles.filter((file) =>
      file.name.toLowerCase().endsWith(".pdf")
    );
    const ignoredCount = selectedFiles.length - pdfFiles.length;

    if (pdfFiles.length === 0) {
      setError("Only PDF uploads are supported right now.");
      return;
    }

    const targetFolderName =
      mode === "folder" ? getFolderUploadName(pdfFiles) : activeFolder?.name ?? "Inbox";

    setLoading(true);
    try {
      const batches = splitIntoUploadBatches(pdfFiles);
      const createdRuns: IngestionRunRow[] = [];
      let nextFolderId: string | null = null;
      let nextFolderJob: FolderAnalysisJobRow | null = null;

      for (const batch of batches) {
        const formData = new FormData();
        batch.forEach((file) => formData.append("files", file));
        formData.append("folder", targetFolderName);
        formData.append("source_kind", "pdf-upload");
        formData.append("project_id", currentProject.id);

        const response = await fetch("/api/admin/import", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: formData,
        });

        const payload = await readJsonPayload<{
          runs?: IngestionRunRow[];
          folderJob?: FolderAnalysisJobRow | null;
          error?: string;
        }>(response);

        if (!response.ok) {
          const fallbackMessage =
            response.status === 413
              ? "This upload batch is too large for the server. Try fewer or smaller PDFs at a time."
              : `Upload request failed with status ${response.status}.`;
          throw new Error(buildUploadErrorMessage(fallbackMessage, payload));
        }

        createdRuns.push(...(payload?.runs ?? []));
        nextFolderId = payload?.folderJob?.folder_id ?? nextFolderId;
        nextFolderJob = payload?.folderJob ?? nextFolderJob;
      }

      setRuns((current) => {
        const createdIds = new Set(createdRuns.map((run) => run.id));
        return [...createdRuns, ...current.filter((run) => !createdIds.has(run.id))];
      });
      await refreshFolders();
      startAnalysisSession(createdRuns, {
        sourceKind: "pdf-upload",
        folder: targetFolderName,
        folderId: nextFolderId,
        folderJob: nextFolderJob,
      });
      if (nextFolderId && (mode === "folder" || selectedFolderId !== "all")) {
        setSelectedFolderId(nextFolderId);
      }
      setMessage(
        ignoredCount > 0
          ? `Queued ${pdfFiles.length} PDF file${pdfFiles.length === 1 ? "" : "s"}. Ignored ${ignoredCount} non-PDF file${ignoredCount === 1 ? "" : "s"}.`
          : `Queued ${pdfFiles.length} PDF file${pdfFiles.length === 1 ? "" : "s"} for analysis.`
      );
      setError(null);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Failed to queue uploads."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleFilePickerChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []).filter(Boolean);
    event.target.value = "";
    if (selectedFiles.length === 0) return;
    void queueUploads(selectedFiles, "files");
  }

  function openFolderPicker() {
    setToolbarPopover(null);
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.accept = ".pdf,application/pdf";
    const folderPicker = picker as HTMLInputElement & {
      webkitdirectory?: boolean;
      directory?: boolean;
    };
    folderPicker.webkitdirectory = true;
    folderPicker.directory = true;
    picker.onchange = () => {
      const selectedFiles = Array.from(picker.files ?? []).filter(Boolean);
      if (selectedFiles.length === 0) return;
      void queueUploads(selectedFiles, "folder");
    };
    picker.click();
  }

  function openToolbarMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    kind: ToolbarPopoverKind,
    width = 224
  ) {
    if (toolbarPopover?.kind === kind) {
      setToolbarPopover(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const position = getPopoverPosition(rect, width, kind === "sort" ? 360 : 280);
    setToolbarPopover({
      kind,
      width,
      top: position.top,
      left: position.left,
    });
    setItemMenuState(null);
  }

  function openItemMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    item: LibraryEntry
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = getPopoverPosition(rect, 224, item.kind === "folder" ? 160 : 340);
    setItemMenuState({
      item,
      top: position.top,
      left: Math.min(position.left, window.innerWidth - 240),
    });
    setToolbarPopover(null);
  }

  function handleSortHeaderClick(nextSortKey: SortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(defaultDirectionForSort(nextSortKey));
  }

  const folderStats = useMemo(() => {
    const stats = new Map<string, { count: number; latest: string | null }>();
    for (const folder of folders) {
      stats.set(folder.id, {
        count: 0,
        latest: folder.updated_at ?? folder.created_at ?? null,
      });
    }
    for (const run of runs) {
      if (!run.folder_id) continue;
      const current = stats.get(run.folder_id) ?? { count: 0, latest: null };
      current.count += 1;
      const updatedAt = run.updated_at ?? run.created_at ?? null;
      if (timeToMs(updatedAt) >= timeToMs(current.latest)) {
        current.latest = updatedAt;
      }
      stats.set(run.folder_id, current);
    }
    return stats;
  }, [folders, runs]);

  const folderEntries = useMemo<LibraryEntry[]>(() => {
    if (selectedFolderId !== "all") return [];
    return folders.map((folder) => {
      const stats = folderStats.get(folder.id);
      const fileCount = stats?.count ?? 0;
      const modifiedAt = stats?.latest ?? folder.updated_at ?? folder.created_at ?? null;
      return {
        id: `folder:${folder.id}`,
        kind: "folder",
        name: folder.name,
        ownerLabel: "me",
        modifiedAt,
        modifiedMs: timeToMs(modifiedAt),
        sizeBytes: null,
        sizeLabel: "\u2014",
        typeFilter: "folder",
        sourceFilter: "workspace",
        sourceLabel: "Workspace folder",
        subtitle: `${fileCount} file${fileCount === 1 ? "" : "s"} \u2022 Workspace folder`,
        statusLabel: null,
        favorite: false,
        folder,
      };
    });
  }, [folderStats, folders, selectedFolderId]);

  const fileEntries = useMemo<LibraryEntry[]>(() => {
    return runs
      .filter((run) => {
        if (selectedFolderId !== "all" && run.folder_id !== selectedFolderId) {
          return false;
        }
        return !run.trashed_at;
      })
      .map((run) => {
        const folderName = run.folder_id
          ? folderById.get(run.folder_id)?.name ?? "Folder"
          : "Inbox";
        const sourceLabel = sourceOf(run);
        const subtitle =
          selectedFolderId === "all"
            ? `${folderName} \u2022 ${sourceLabel}`
            : `${sourceLabel} \u2022 ${extOf(run).toUpperCase()}`;
        return {
          id: `file:${run.id}`,
          kind: "file",
          name: titleOf(run),
          ownerLabel: "me",
          modifiedAt: run.updated_at ?? run.created_at ?? null,
          modifiedMs: timeToMs(run.updated_at ?? run.created_at ?? null),
          sizeBytes: run.file_size_bytes ?? null,
          sizeLabel: formatBytes(run.file_size_bytes),
          typeFilter: typeOfRun(run),
          sourceFilter: sourceLabel === "Google Drive" ? "google-drive" : "upload",
          sourceLabel,
          subtitle,
          statusLabel: run.status !== "succeeded" ? run.status : null,
          favorite: Boolean(run.is_favorite),
          run,
        };
      });
  }, [folderById, runs, selectedFolderId]);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const combined = [...folderEntries, ...fileEntries].filter((item) => {
      if (typeFilter !== "all" && item.typeFilter !== typeFilter) return false;
      if (sourceFilter !== "all" && item.sourceFilter !== sourceFilter) return false;
      if (!matchesModifiedFilter(item.modifiedMs, modifiedFilter)) return false;
      if (!needle) return true;
      return [item.name, item.subtitle, item.sourceLabel, item.statusLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });

    return combined.sort((left, right) => {
      if (
        selectedFolderId === "all" &&
        folderPlacement === "on-top" &&
        left.kind !== right.kind
      ) {
        return left.kind === "folder" ? -1 : 1;
      }

      let result = 0;
      if (sortKey === "name") {
        result = compareText(left.name, right.name);
      } else if (sortKey === "modified") {
        result = left.modifiedMs - right.modifiedMs;
      } else {
        result = (left.sizeBytes ?? -1) - (right.sizeBytes ?? -1);
      }

      if (result === 0) {
        result = compareText(left.name, right.name);
      }

      return sortDirection === "asc" ? result : -result;
    });
  }, [
    fileEntries,
    folderEntries,
    folderPlacement,
    modifiedFilter,
    query,
    selectedFolderId,
    sortDirection,
    sortKey,
    sourceFilter,
    typeFilter,
  ]);

  const rootGridFolders = useMemo(
    () => visibleEntries.filter((item) => item.kind === "folder"),
    [visibleEntries]
  );
  const rootGridFiles = useMemo(
    () => visibleEntries.filter((item) => item.kind === "file"),
    [visibleEntries]
  );

  const typeFilterLabel =
    TYPE_OPTIONS.find((option) => option.id === typeFilter)?.label ?? "Type";
  const modifiedFilterLabel =
    MODIFIED_OPTIONS.find((option) => option.id === modifiedFilter)?.label ??
    "Modified";
  const sourceFilterLabel =
    SOURCE_OPTIONS.find((option) => option.id === sourceFilter)?.label ?? "Source";
  const currentSortDirectionOptions =
    sortKey === "name"
      ? [
          { id: "asc" as const, label: "A to Z" },
          { id: "desc" as const, label: "Z to A" },
        ]
      : sortKey === "modified"
        ? [
            { id: "desc" as const, label: "Newest first" },
            { id: "asc" as const, label: "Oldest first" },
          ]
        : [
            { id: "desc" as const, label: "Largest first" },
            { id: "asc" as const, label: "Smallest first" },
          ];

  const activeMenuRun =
    itemMenuState?.item.kind === "file" ? itemMenuState.item.run ?? null : null;

  function renderToolbarPopover() {
    if (!toolbarPopover) return null;

    const sectionClass =
      "rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.18)] dark:border-[#2f2f2f] dark:bg-[#171717]";
    const itemClass =
      "flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]";

    if (toolbarPopover.kind === "new") {
      return (
        <div
          className={`fixed ${sectionClass}`}
          style={{
            top: toolbarPopover.top,
            left: toolbarPopover.left,
            width: toolbarPopover.width,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setToolbarPopover(null);
              setFolderModalError(null);
              setShowFolderModal(true);
            }}
            className={itemClass}
          >
            <span className="flex items-center gap-3">
              <FolderIcon className="h-4 w-4" />
              <span>Create new folder</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setToolbarPopover(null);
              fileInputRef.current?.click();
            }}
            className={itemClass}
          >
            <span className="flex items-center gap-3">
              <UploadIcon className="h-4 w-4" />
              <span>Upload file</span>
            </span>
          </button>
          <button
            type="button"
            onClick={openFolderPicker}
            className={itemClass}
          >
            <span className="flex items-center gap-3">
              <FolderIcon className="h-4 w-4" />
              <span>Upload folder</span>
            </span>
          </button>
        </div>
      );
    }

    if (toolbarPopover.kind === "type") {
      return (
        <div
          className={`fixed ${sectionClass}`}
          style={{
            top: toolbarPopover.top,
            left: toolbarPopover.left,
            width: toolbarPopover.width,
          }}
        >
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setTypeFilter(option.id);
                setToolbarPopover(null);
              }}
              className={itemClass}
            >
              <span>{option.label}</span>
              {typeFilter === option.id ? <CheckIcon className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>
      );
    }

    if (toolbarPopover.kind === "modified") {
      return (
        <div
          className={`fixed ${sectionClass}`}
          style={{
            top: toolbarPopover.top,
            left: toolbarPopover.left,
            width: toolbarPopover.width,
          }}
        >
          {MODIFIED_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setModifiedFilter(option.id);
                setToolbarPopover(null);
              }}
              className={itemClass}
            >
              <span>{option.label}</span>
              {modifiedFilter === option.id ? <CheckIcon className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>
      );
    }

    if (toolbarPopover.kind === "source") {
      return (
        <div
          className={`fixed ${sectionClass}`}
          style={{
            top: toolbarPopover.top,
            left: toolbarPopover.left,
            width: toolbarPopover.width,
          }}
        >
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setSourceFilter(option.id);
                setToolbarPopover(null);
              }}
              className={itemClass}
            >
              <span>{option.label}</span>
              {sourceFilter === option.id ? <CheckIcon className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>
      );
    }

    return (
      <div
        className={`fixed ${sectionClass} space-y-3`}
        style={{
          top: toolbarPopover.top,
          left: toolbarPopover.left,
          width: toolbarPopover.width,
        }}
      >
        <div className="space-y-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#808080]">
            Sort by
          </p>
          {SORT_KEY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setSortKey(option.id);
                setSortDirection(defaultDirectionForSort(option.id));
              }}
              className={itemClass}
            >
              <span>{option.label}</span>
              {sortKey === option.id ? <CheckIcon className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>

        <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-[#2a2a2a]">
          <p className="px-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#808080]">
            Sort direction
          </p>
          {currentSortDirectionOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSortDirection(option.id)}
              className={itemClass}
            >
              <span>{option.label}</span>
              {sortDirection === option.id ? <CheckIcon className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>

        <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-[#2a2a2a]">
          <p className="px-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#808080]">
            Folders
          </p>
          {FOLDER_PLACEMENT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFolderPlacement(option.id)}
              className={itemClass}
            >
              <span>{option.label}</span>
              {folderPlacement === option.id ? <CheckIcon className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderItemMenu() {
    if (!itemMenuState) return null;

    const itemClass =
      "flex w-full rounded-2xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-[#d0d0d0] dark:hover:bg-[#222222]";
    const menuItem = itemMenuState.item;

    if (menuItem.kind === "folder" && menuItem.folder) {
      return (
        <div
          className="fixed rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.18)] dark:border-[#2f2f2f] dark:bg-[#171717]"
          style={{ top: itemMenuState.top, left: itemMenuState.left, width: 224 }}
        >
          <button
            type="button"
            onClick={() => {
              setSelectedFolderId(menuItem.folder!.id);
              setItemMenuState(null);
            }}
            className={itemClass}
          >
            Open folder
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedFolderId(menuItem.folder!.id);
              setItemMenuState(null);
              fileInputRef.current?.click();
            }}
            className={itemClass}
          >
            Upload files here
          </button>
        </div>
      );
    }

    if (!activeMenuRun) return null;

    return (
      <div
        className="fixed rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.18)] dark:border-[#2f2f2f] dark:bg-[#171717]"
        style={{ top: itemMenuState.top, left: itemMenuState.left, width: 224 }}
      >
        <button
          type="button"
          onClick={async () => {
            try {
              await handlePreviewRun(activeMenuRun);
            } catch (openError) {
              setError(
                openError instanceof Error ? openError.message : "Failed to preview file."
              );
            } finally {
              setItemMenuState(null);
            }
          }}
          className={itemClass}
        >
          Preview
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await handleOpenRunInNewTab(activeMenuRun);
            } catch (openError) {
              setError(
                openError instanceof Error ? openError.message : "Failed to open file."
              );
            } finally {
              setItemMenuState(null);
            }
          }}
          className={itemClass}
        >
          Open in new tab
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await handleRenameRun(activeMenuRun);
            } catch (renameError) {
              setError(
                renameError instanceof Error ? renameError.message : "Failed to rename file."
              );
            } finally {
              setItemMenuState(null);
            }
          }}
          className={itemClass}
        >
          Edit name
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await handleCopyRun(activeMenuRun);
            } catch (copyError) {
              setError(
                copyError instanceof Error ? copyError.message : "Failed to copy file."
              );
            } finally {
              setItemMenuState(null);
            }
          }}
          className={itemClass}
        >
          Make a copy
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await handleMoveRun(activeMenuRun);
            } catch (moveError) {
              setError(
                moveError instanceof Error ? moveError.message : "Failed to move file."
              );
            } finally {
              setItemMenuState(null);
            }
          }}
          className={itemClass}
        >
          Move to folder
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await handleToggleFavorite(activeMenuRun);
            } catch (favoriteError) {
              setError(
                favoriteError instanceof Error
                  ? favoriteError.message
                  : "Failed to update favorite."
              );
            } finally {
              setItemMenuState(null);
            }
          }}
          className={itemClass}
        >
          {activeMenuRun.is_favorite ? "Remove favorite" : "Add to favorite"}
        </button>
        <button
          type="button"
          onClick={() => {
            setInfoRun(activeMenuRun);
            setItemMenuState(null);
          }}
          className={itemClass}
        >
          File information
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await handleTrashRun(activeMenuRun);
            } catch (trashError) {
              setError(
                trashError instanceof Error ? trashError.message : "Failed to move file to trash."
              );
            } finally {
              setItemMenuState(null);
            }
          }}
          className="flex w-full rounded-2xl px-3 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/20"
        >
          Move to trash
        </button>
      </div>
    );
  }

  function renderFilterButton(
    kind: Exclude<ToolbarPopoverKind, "new" | "sort">,
    label: string
  ) {
    return (
      <button
        type="button"
        onClick={(event) => openToolbarMenu(event, kind, 220)}
        className="inline-flex items-center gap-2 rounded-[16px] border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 dark:border-[#383838] dark:bg-[#161616] dark:text-[#d0d0d0] dark:hover:border-[#4a4a4a] dark:hover:text-white"
      >
        <span>{label}</span>
        <ChevronDownIcon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleFilePickerChange}
      />

      <div className="space-y-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
              {activeFolder ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId("all")}
                    className="rounded-full px-2 py-1 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#1b1b1b] dark:hover:text-white"
                  >
                    My Drive
                  </button>
                  <span>/</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {activeFolder.name}
                  </span>
                </>
              ) : (
                <span>My Drive</span>
              )}
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">
              {activeFolder?.name ?? "My Drive"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500 dark:text-[#a3a3a3]">
              Browse folders and research files together inside{" "}
              {currentProject?.name ?? "this project"} with a Drive-style layout.
            </p>
          </div>

          <div className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={(event) => openToolbarMenu(event, "new", 240)}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-[20px] border border-slate-300 bg-[#e8f0fe] px-5 text-sm font-semibold text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition hover:border-slate-400 dark:border-[#3c3c3c] dark:bg-[#1e2a3b] dark:text-white dark:hover:border-[#515151]"
            >
              <PlusIcon className="h-4 w-4" />
              <span>New</span>
            </button>

            <label className="relative block min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#808080]" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search in Library"
                className="h-14 w-full rounded-[20px] border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-4 focus:ring-slate-900/5 dark:border-[#383838] dark:bg-[#161616] dark:text-white dark:placeholder:text-[#6f6f6f] dark:focus:border-[#5a5a5a] dark:focus:ring-white/10"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {renderFilterButton("type", typeFilter === "all" ? "Type" : typeFilterLabel)}
            {renderFilterButton(
              "modified",
              modifiedFilter === "all" ? "Modified" : modifiedFilterLabel
            )}
            {renderFilterButton(
              "source",
              sourceFilter === "all" ? "Source" : sourceFilterLabel
            )}
          </div>

          <div className="flex items-center gap-2 self-start xl:self-auto">
            <button
              type="button"
              onClick={(event) => openToolbarMenu(event, "sort", 260)}
              className="inline-flex items-center gap-2 rounded-[16px] border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 dark:border-[#383838] dark:bg-[#161616] dark:text-[#d0d0d0] dark:hover:border-[#4a4a4a] dark:hover:text-white"
            >
              <SortIcon className="h-4 w-4" />
              <span>Sort</span>
            </button>
            <button
              type="button"
              onClick={() => void loadRuns()}
              className="inline-flex items-center gap-2 rounded-[16px] border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 dark:border-[#383838] dark:bg-[#161616] dark:text-[#d0d0d0] dark:hover:border-[#4a4a4a] dark:hover:text-white"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <div className="inline-flex rounded-full border border-slate-300 bg-white p-1 dark:border-[#383838] dark:bg-[#161616]">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition ${
                  viewMode === "list"
                    ? "bg-[#d7ebff] text-slate-900 dark:bg-[#244767] dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:text-white"
                }`}
                aria-label="List layout"
              >
                <ListViewIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition ${
                  viewMode === "grid"
                    ? "bg-[#d7ebff] text-slate-900 dark:bg-[#244767] dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:text-white"
                }`}
                aria-label="Grid layout"
              >
                <GridViewIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="app-surface overflow-visible">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-5 dark:border-[#2f2f2f] sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                {visibleEntries.length} item{visibleEntries.length === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-[#9c9c9c]">
                {activeFolder
                  ? `Showing everything inside ${activeFolder.name}.`
                  : "Folders and files are mixed together in one library view."}
              </p>
            </div>
          </div>
        </div>

        {visibleEntries.length === 0 ? (
          <div className="flex min-h-[360px] items-center justify-center px-6 py-12 text-center">
            <div>
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-slate-100 text-slate-500 dark:bg-[#171717] dark:text-[#9c9c9c]">
                <FolderIcon className="h-7 w-7" />
              </span>
              <p className="mt-5 text-lg font-medium text-slate-900 dark:text-[#f2f2f2]">
                Nothing matches these filters yet
              </p>
              <p className="mt-2 text-sm text-slate-500 dark:text-[#9c9c9c]">
                Try another filter combination or use the New button to add files.
              </p>
            </div>
          </div>
        ) : viewMode === "list" ? (
          <div className="px-4 py-4 sm:px-6">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_180px_170px_120px_160px] items-center gap-4 border-b border-slate-200 px-3 py-3 text-sm font-medium text-slate-600 dark:border-[#2a2a2a] dark:text-[#9c9c9c] md:grid">
              <button
                type="button"
                onClick={() => handleSortHeaderClick("name")}
                className="flex items-center gap-2 text-left transition hover:text-slate-900 dark:hover:text-white"
              >
                <span>Name</span>
                {sortKey === "name" ? (
                  <span className="text-xs text-sky-600 dark:text-sky-300">
                    {sortDirection === "asc" ? "\u2191" : "\u2193"}
                  </span>
                ) : null}
              </button>
              <div>Owner</div>
              <button
                type="button"
                onClick={() => handleSortHeaderClick("modified")}
                className="flex items-center gap-2 text-left transition hover:text-slate-900 dark:hover:text-white"
              >
                <span>Date modified</span>
                {sortKey === "modified" ? (
                  <span className="text-xs text-sky-600 dark:text-sky-300">
                    {sortDirection === "asc" ? "\u2191" : "\u2193"}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => handleSortHeaderClick("size")}
                className="flex items-center gap-2 text-left transition hover:text-slate-900 dark:hover:text-white"
              >
                <span>File size</span>
                {sortKey === "size" ? (
                  <span className="text-xs text-sky-600 dark:text-sky-300">
                    {sortDirection === "asc" ? "\u2191" : "\u2193"}
                  </span>
                ) : null}
              </button>
              <div className="text-right">Actions</div>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-[#2a2a2a]">
              {visibleEntries.map((item) => {
                const Glyph = glyphForEntry(item);
                return (
                  <article
                    key={item.id}
                    className="group grid gap-4 px-3 py-4 md:grid-cols-[minmax(0,1.5fr)_180px_170px_120px_160px] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-12 w-12 flex-none items-center justify-center rounded-[18px] ${badgeToneForEntry(item)}`}
                        >
                          <Glyph className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {item.kind === "folder" ? (
                              <button
                                type="button"
                                onClick={() => setSelectedFolderId(item.folder!.id)}
                                className="truncate text-left text-sm font-semibold text-slate-900 transition hover:text-sky-700 dark:text-[#f2f2f2] dark:hover:text-sky-300"
                              >
                                {item.name}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handlePreviewRun(item.run!)}
                                className="truncate text-left text-sm font-semibold text-slate-900 transition hover:text-sky-700 dark:text-[#f2f2f2] dark:hover:text-sky-300"
                              >
                                {item.name}
                              </button>
                            )}
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#1c1c1c] dark:text-[#bbbbbb]">
                              {item.kind === "folder"
                                ? "Folder"
                                : extOf(item.run!).toUpperCase()}
                            </span>
                            {item.favorite ? (
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                                Favorite
                              </span>
                            ) : null}
                            {item.statusLabel ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold capitalize text-slate-600 dark:bg-[#1c1c1c] dark:text-[#bbbbbb]">
                                {item.statusLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-500 dark:text-[#9c9c9c]">
                            {item.subtitle}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-[#b6b6b6]">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-xs font-semibold text-white">
                        {ownerInitial}
                      </span>
                      <span>{item.ownerLabel}</span>
                    </div>

                    <div
                      className="text-sm text-slate-600 dark:text-[#b6b6b6]"
                      title={formatDetailedDate(item.modifiedAt)}
                    >
                      {formatShortDate(item.modifiedAt)}
                    </div>

                    <div className="text-sm text-slate-600 dark:text-[#b6b6b6]">
                      {item.sizeLabel}
                    </div>

                    <div className="flex items-center justify-end gap-1">
                      {item.kind === "file" ? (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleDownloadRun(item.run!);
                              } catch (downloadError) {
                                setError(
                                  downloadError instanceof Error
                                    ? downloadError.message
                                    : "Failed to download file."
                                );
                              }
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#202020] dark:hover:text-white"
                            aria-label={`Download ${item.name}`}
                          >
                            <DownloadIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleRenameRun(item.run!);
                              } catch (renameError) {
                                setError(
                                  renameError instanceof Error
                                    ? renameError.message
                                    : "Failed to rename file."
                                );
                              }
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#202020] dark:hover:text-white"
                            aria-label={`Rename ${item.name}`}
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleToggleFavorite(item.run!);
                              } catch (favoriteError) {
                                setError(
                                  favoriteError instanceof Error
                                    ? favoriteError.message
                                    : "Failed to update favorite."
                                );
                              }
                            }}
                            className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition ${
                              item.favorite
                                ? "bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
                                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#202020] dark:hover:text-white"
                            }`}
                            aria-label={`${item.favorite ? "Remove" : "Add"} ${item.name} ${
                              item.favorite ? "from" : "to"
                            } favorites`}
                          >
                            <StarIcon className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSelectedFolderId(item.folder!.id)}
                          className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-[#b6b6b6] dark:hover:bg-[#202020] dark:hover:text-white"
                        >
                          <FolderIcon className="h-4 w-4" />
                          <span>Open</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(event) => openItemMenu(event, item)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#202020] dark:hover:text-white"
                        aria-label={`Open actions for ${item.name}`}
                      >
                        <MoreHorizontalIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-8 px-4 py-5 sm:px-6">
            {selectedFolderId === "all" && folderPlacement === "on-top" && rootGridFolders.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-[#8b8b8b]">
                    Folders
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {rootGridFolders.map((item) => {
                    const Glyph = glyphForEntry(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedFolderId(item.folder!.id)}
                        className="group flex items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white dark:border-[#2c2c2c] dark:bg-[#191919] dark:hover:border-[#3a3a3a] dark:hover:bg-[#1e1e1e]"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <span
                              className={`flex h-11 w-11 flex-none items-center justify-center rounded-[16px] ${badgeToneForEntry(item)}`}
                            >
                              <Glyph className="h-5 w-5" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                                {item.name}
                              </p>
                              <p className="mt-1 truncate text-xs text-slate-500 dark:text-[#9c9c9c]">
                                {item.subtitle}
                              </p>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openItemMenu(event, item);
                          }}
                          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#242424] dark:hover:text-white"
                          aria-label={`Open actions for ${item.name}`}
                        >
                          <MoreHorizontalIcon className="h-4 w-4" />
                        </button>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {(selectedFolderId !== "all" || folderPlacement === "mixed" || rootGridFiles.length > 0) ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-[#8b8b8b]">
                    {selectedFolderId === "all" ? "Files" : "Folder contents"}
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                  {(selectedFolderId === "all" && folderPlacement === "mixed"
                    ? visibleEntries
                    : selectedFolderId === "all"
                      ? rootGridFiles
                      : visibleEntries
                  ).map((item) => {
                    if (item.kind === "folder") {
                      const Glyph = glyphForEntry(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedFolderId(item.folder!.id)}
                          className="group flex items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white dark:border-[#2c2c2c] dark:bg-[#191919] dark:hover:border-[#3a3a3a] dark:hover:bg-[#1e1e1e]"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <span
                                className={`flex h-11 w-11 flex-none items-center justify-center rounded-[16px] ${badgeToneForEntry(item)}`}
                              >
                                <Glyph className="h-5 w-5" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                                  {item.name}
                                </p>
                                <p className="mt-1 truncate text-xs text-slate-500 dark:text-[#9c9c9c]">
                                  {item.subtitle}
                                </p>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openItemMenu(event, item);
                            }}
                            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#242424] dark:hover:text-white"
                            aria-label={`Open actions for ${item.name}`}
                          >
                            <MoreHorizontalIcon className="h-4 w-4" />
                          </button>
                        </button>
                      );
                    }

                    const Glyph = glyphForEntry(item);
                    return (
                      <article
                        key={item.id}
                        className="group overflow-hidden rounded-[24px] border border-slate-200 bg-white transition hover:border-slate-300 dark:border-[#2c2c2c] dark:bg-[#171717] dark:hover:border-[#3a3a3a]"
                      >
                        <button
                          type="button"
                          onClick={() => void handlePreviewRun(item.run!)}
                          className="flex w-full flex-col text-left"
                        >
                          <div className="relative flex h-44 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(191,219,254,0.75),rgba(255,255,255,0.95))] dark:bg-[radial-gradient(circle_at_top_left,rgba(30,64,175,0.28),rgba(23,23,23,1))]">
                            <span
                              className={`flex h-16 w-16 items-center justify-center rounded-[20px] ${badgeToneForEntry(item)}`}
                            >
                              <Glyph className="h-7 w-7" />
                            </span>
                            <span className="absolute left-4 top-4 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm dark:bg-[#0f0f0f]/90 dark:text-[#d0d0d0]">
                              {extOf(item.run!).toUpperCase()}
                            </span>
                            {item.favorite ? (
                              <span className="absolute right-4 top-4 rounded-full bg-amber-100 p-2 text-amber-600 shadow-sm dark:bg-amber-950/30 dark:text-amber-300">
                                <StarIcon className="h-4 w-4" />
                              </span>
                            ) : null}
                          </div>
                          <div className="space-y-3 px-4 py-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                                {item.name}
                              </p>
                              <p className="mt-1 text-xs text-slate-500 dark:text-[#9c9c9c]">
                                {item.subtitle}
                              </p>
                            </div>
                            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#9c9c9c]">
                              <span>{formatShortDate(item.modifiedAt)}</span>
                              <span>{item.sizeLabel}</span>
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-[#242424]">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await handleDownloadRun(item.run!);
                                } catch (downloadError) {
                                  setError(
                                    downloadError instanceof Error
                                      ? downloadError.message
                                      : "Failed to download file."
                                  );
                                }
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#202020] dark:hover:text-white"
                              aria-label={`Download ${item.name}`}
                            >
                              <DownloadIcon className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await handleRenameRun(item.run!);
                                } catch (renameError) {
                                  setError(
                                    renameError instanceof Error
                                      ? renameError.message
                                      : "Failed to rename file."
                                  );
                                }
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#202020] dark:hover:text-white"
                              aria-label={`Rename ${item.name}`}
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await handleToggleFavorite(item.run!);
                                } catch (favoriteError) {
                                  setError(
                                    favoriteError instanceof Error
                                      ? favoriteError.message
                                      : "Failed to update favorite."
                                  );
                                }
                              }}
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition ${
                                item.favorite
                                  ? "bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
                                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#202020] dark:hover:text-white"
                              }`}
                              aria-label={`${item.favorite ? "Remove" : "Add"} ${item.name} ${
                                item.favorite ? "from" : "to"
                              } favorites`}
                            >
                              <StarIcon className="h-4 w-4" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => openItemMenu(event, item)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#202020] dark:hover:text-white"
                            aria-label={`Open actions for ${item.name}`}
                          >
                            <MoreHorizontalIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

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

      {(toolbarPopover || itemMenuState) && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => {
                  setToolbarPopover(null);
                  setItemMenuState(null);
                }}
                role="presentation"
              />
              <div
                className="fixed z-50"
                onClick={(event) => event.stopPropagation()}
                role="presentation"
              >
                {renderToolbarPopover()}
                {renderItemMenu()}
              </div>
            </>,
            document.body
          )
        : null}

      {previewUrl ? (
        <Modal onClose={() => setPreviewUrl(null)}>
          <div className="h-[85vh] w-[min(1100px,92vw)] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-[#2f2f2f] dark:bg-[#111111]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#2f2f2f]">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {previewTitle}
              </p>
              <button
                type="button"
                onClick={() => setPreviewUrl(null)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 dark:border-[#2f2f2f] dark:text-[#d0d0d0]"
              >
                Close
              </button>
            </div>
            <iframe
              src={previewUrl}
              title={previewTitle}
              className="h-[calc(85vh-65px)] w-full bg-white"
            />
          </div>
        </Modal>
      ) : null}

      {infoRun ? (
        <Modal onClose={() => setInfoRun(null)}>
          <div className="w-[min(560px,92vw)] rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-2xl dark:border-[#2f2f2f] dark:bg-[#111111]">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              File information
            </h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Name</dt>
                <dd className="text-right text-slate-900 dark:text-white">
                  {titleOf(infoRun)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Type</dt>
                <dd className="text-right text-slate-900 dark:text-white">
                  {extOf(infoRun).toUpperCase()}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Source</dt>
                <dd className="text-right text-slate-900 dark:text-white">
                  {sourceOf(infoRun)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Size</dt>
                <dd className="text-right text-slate-900 dark:text-white">
                  {formatBytes(infoRun.file_size_bytes)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Updated</dt>
                <dd className="text-right text-slate-900 dark:text-white">
                  {formatDetailedDate(infoRun.updated_at)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-slate-500 dark:text-[#9c9c9c]">Path</dt>
                <dd className="max-w-[280px] break-all text-right text-slate-900 dark:text-white">
                  {infoRun.source_path || "Unavailable"}
                </dd>
              </div>
            </dl>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
