"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import AnalyzeFlowModal from "@/components/workspace/AnalyzeFlowModal";
import CreateEntityModal from "@/components/workspace/CreateEntityModal";
import PaperAnalysisExplorerModal, {
  PAPER_EXPLORER_TABS,
  type PaperExplorerTab,
} from "@/components/workspace/PaperAnalysisExplorerModal";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { normalizePaperId, paperIdForRun } from "@/lib/paper-id";
import { buildAnalysisMarkdown, sanitizeFilenamePart, triggerTextDownload } from "@/lib/paper-report";
import Modal from "@/components/ui/Modal";
import dynamic from "next/dynamic";
import {
  ArrowRightIcon,
  CheckIcon,
  ChartIcon,
  ChevronDownIcon,
  CloseIcon,
  DownloadIcon,
  BooksIcon,
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
  RefreshIcon,
  SearchIcon,
  SortIcon,
  StarIcon,
  TrashIcon,
  UndoIcon,
  UploadIcon,
} from "@/components/ui/Icons";
import type { IngestionRunRow, RunAnalysisDetail } from "@/types/database";
import {
  describeRunFailure,
  getRunDisplayTitle,
  getRunPaperTitle,
  getRunStageMessage,
  getRunStatusLabel,
} from "@/lib/ingestion-status";
import { formatReanalysisEstimate } from "@/lib/reanalysis";
import { hasUsableAnalysis } from "@/lib/usable-analysis";
import { buttonClass, fieldClass, labelClass, menuItemClass, menuPanelClass } from "@/components/ui/controls";
import Mascot from "@/components/ui/Mascot";

type ViewMode = "list" | "grid";
type TypeFilter = "all" | "pdf" | "image" | "document" | "other";
type ModifiedFilter = "all" | "7d" | "30d" | "year" | "older";
type SourceFilter = "all" | "upload" | "google-drive";
type SortKey = "name" | "modified" | "size";
type SortDirection = "asc" | "desc";

const VIEW_MODES: ViewMode[] = ["list", "grid"];
const TYPE_FILTERS: TypeFilter[] = ["all", "pdf", "image", "document", "other"];
const MODIFIED_FILTERS: ModifiedFilter[] = ["all", "7d", "30d", "year", "older"];
const SOURCE_FILTERS: SourceFilter[] = ["all", "upload", "google-drive"];
const SORT_KEYS: SortKey[] = ["name", "modified", "size"];
const SORT_DIRECTIONS: SortDirection[] = ["asc", "desc"];

/** A value from the address, if it is one of the allowed ones. */
function readChoice<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
type ToolbarPopoverKind = "new" | "type" | "modified" | "source" | "sort";

type ToolbarPopoverState = {
  kind: ToolbarPopoverKind;
  top: number;
  left: number;
  width: number;
};

type LibraryEntry = {
  id: string;
  kind: "file";
  name: string;
  /** The paper's year once analysed; the column that said "me" on every row now says this. */
  yearLabel: string;
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
  run: IngestionRunRow;
};

type ItemMenuState = {
  item: LibraryEntry;
  top: number;
  left: number;
};

type RenameTarget = { kind: "file"; run: IngestionRunRow };

type RunAnalysisResponse = {
  run?: IngestionRunRow;
  analysis?: RunAnalysisDetail;
  error?: string;
};

// Only PDFs can be uploaded; "Images", "Documents" and "Other files" matched
// nothing (docs/32, 2.11, LIB-7).
const TYPE_OPTIONS: Array<{ id: TypeFilter; label: string }> = [
  { id: "all", label: "All types" },
  { id: "pdf", label: "PDF" },
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
  { id: "upload", label: "From a computer" },
  { id: "google-drive", label: "Google Drive" },
];

const SORT_KEY_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: "name", label: "Name" },
  { id: "modified", label: "Date modified" },
  { id: "size", label: "File size" },
];

/** What the paper is called in the list: a name given to the file, else its title. */
function titleOf(run: IngestionRunRow) {
  return getRunDisplayTitle(run, run.id);
}

/** The file itself: what a download is saved as and what a rename edits. */
function fileNameOf(run: IngestionRunRow) {
  return run.display_name || run.source_filename || run.id;
}

function paperIdOfRun(run: IngestionRunRow): string {
  return paperIdForRun(run);
}

function extOf(run: IngestionRunRow) {
  return (
    run.source_extension ||
    fileNameOf(run).split(".").pop()?.toLowerCase() ||
    "file"
  );
}

/** The paper's year, as the analysis found it (or a reader corrected it). */
function paperYearOf(run: IngestionRunRow): string {
  const year = run.input_payload?.year;
  return typeof year === "string" && /^\d{4}$/.test(year.trim()) ? year.trim() : typeof year === "number" ? String(year) : "\u2014";
}

/**
 * Where the file came from. A file picked in Google Drive is uploaded like
 * any other and recorded as import_source (docs/32, 4.5; audit LIB-7); the
 * older Drive connector set source_kind.
 */
function sourceOf(run: IngestionRunRow) {
  if (run.input_payload?.import_source === "google-drive") return "Google Drive";
  const value =
    typeof run.input_payload?.source_kind === "string"
      ? run.input_payload.source_kind
      : run.source_type;
  return value === "google-drive" ? "Google Drive" : "Upload";
}

function typeOfRun(run: IngestionRunRow): Exclude<TypeFilter, "all"> {
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

function glyphForEntry(item: LibraryEntry) {
  if (item.sourceFilter === "google-drive") return DriveIcon;
  if (item.typeFilter === "pdf") return PaperIcon;
  if (item.typeFilter === "image") return ImageIcon;
  return FileIcon;
}

function badgeToneForEntry(item: LibraryEntry) {
  // One quiet tone for every file: the glyph already says what it is, and a
  // red square beside each PDF read as an error on every row.
  if (item.run?.status === "failed") {
    return "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/60";
  }
  return "bg-subtle text-body ring-1 ring-inset ring-hairline";
}

function defaultDirectionForSort(sortKey: SortKey): SortDirection {
  return sortKey === "name" ? "asc" : "desc";
}

// Loaded when first opened: the formats are only needed by people who cite.
const ReferencesDialog = dynamic(() => import("@/components/admin/ReferencesDialog"), { ssr: false });

export default function AdminImportClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const {
    currentProject,
    allFolders,
    allProjects,
    setSelectedProjectId,
    setSelectedFolderId,
    refreshFolders,
    startAnalysisSession,
  } = useWorkspaceProfile();
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  // Whether the list has arrived at least once, so a link to a paper that is
  // not in it can be given up on instead of waited for.
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [libraryProjectId, setLibraryProjectId] = useState<string | null>(() => searchParams.get("repo"));
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>(() => readChoice(searchParams.get("view"), VIEW_MODES, "list"));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() => readChoice(searchParams.get("type"), TYPE_FILTERS, "all"));
  const [modifiedFilter, setModifiedFilter] = useState<ModifiedFilter>(() =>
    readChoice(searchParams.get("modified"), MODIFIED_FILTERS, "all")
  );
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(() => readChoice(searchParams.get("source"), SOURCE_FILTERS, "all"));
  const [sortKey, setSortKey] = useState<SortKey>(() => readChoice(searchParams.get("sort"), SORT_KEYS, "name"));
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => readChoice(searchParams.get("dir"), SORT_DIRECTIONS, "asc"));
  const [showTrash, setShowTrash] = useState(() => searchParams.get("trash") === "1");
  const [toolbarPopover, setToolbarPopover] = useState<ToolbarPopoverState | null>(null);
  const [itemMenuState, setItemMenuState] = useState<ItemMenuState | null>(null);
  // The menus open in a portal at the end of the page, so focus is carried
  // into them and back by hand: the first item takes focus when one opens,
  // arrows move through it, and Escape or Tab closes it and returns focus to
  // the button that opened it.
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [infoRun, setInfoRun] = useState<IngestionRunRow | null>(null);
  const [analysisRun, setAnalysisRun] = useState<IngestionRunRow | null>(null);
  const [analysisTab, setAnalysisTab] = useState<PaperExplorerTab>("overview");
  // Permanent deletion from Trash: one paper, or everything in Trash.
  const [deleteTarget, setDeleteTarget] = useState<{ runs: IngestionRunRow[]; all: boolean } | null>(null);
  // Several papers at once (docs/32, 4.5): the selection, by run, and the
  // papers a move is choosing a destination for.
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(() => new Set());
  const [moveTarget, setMoveTarget] = useState<IngestionRunRow[] | null>(null);
  const [moveFolderId, setMoveFolderId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // References for a selection or a whole repository (docs/32, 4.4).
  const [referencesFor, setReferencesFor] = useState<{ selection: { runIds: string[] } | { projectId: string }; label: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [analysisDetail, setAnalysisDetail] = useState<RunAnalysisDetail | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const autoOpenedRunIdRef = useRef<string | null>(null);
  const autoOpenedUploadActionRef = useRef(false);
  // ?paper= is the explorer's own address; ?runId= is the older form links still use.
  const requestedRunId = searchParams.get("paper") ?? searchParams.get("runId");
  const requestedPaperId = normalizePaperId(searchParams.get("paperId"));

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
    () => new Map(allFolders.map((folder) => [folder.id, folder])),
    [allFolders]
  );
  const libraryProject = useMemo(
    () => allProjects.find((project) => project.id === libraryProjectId) ?? null,
    [allProjects, libraryProjectId]
  );

  const projectStats = useMemo(() => {
    // "Papers" counts what was analysed; a failed upload is not a paper in the
    // repository, and was being counted as one.
    const stats = new Map<string, { papers: number; inProgress: number; failed: number; latest: string | null }>();
    for (const project of allProjects) {
      stats.set(project.id, { papers: 0, inProgress: 0, failed: 0, latest: project.updated_at ?? project.created_at ?? null });
    }
    for (const run of runs) {
      if (run.trashed_at) continue;
      const payloadProjectId = typeof run.input_payload?.project_id === "string"
        ? run.input_payload.project_id
        : null;
      const projectId = run.folder_id ? folderById.get(run.folder_id)?.project_id ?? payloadProjectId : payloadProjectId;
      const current = projectId ? stats.get(projectId) : null;
      if (!current) continue;
      if (run.status === "succeeded") current.papers += 1;
      else if (run.status === "failed") current.failed += 1;
      else current.inProgress += 1;
      const updated = run.updated_at ?? run.created_at ?? null;
      if (timeToMs(updated) > timeToMs(current.latest)) current.latest = updated;
    }
    return stats;
  }, [allProjects, folderById, runs]);

  async function loadRuns() {
    if (!session?.access_token) {
      setRuns([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspace/library?includeTrashed=${showTrash ? "true" : "false"}`,
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
      setRunsLoaded(true);
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
  }, [requestHeaders, session?.access_token, showTrash]);

  useEffect(() => {
    if (!session?.access_token) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadRuns();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [requestHeaders, session?.access_token, showTrash]);

  useEffect(() => {
    if (
      autoOpenedUploadActionRef.current ||
      searchParams.get("action") !== "upload" ||
      !currentProject?.id ||
      !session?.access_token
    ) {
      return;
    }

    // "Upload PDFs" in the search palette lands here: open the repository it
    // uploads into, then the same dialog as everywhere else.
    autoOpenedUploadActionRef.current = true;
    setLibraryProjectId(currentProject.id);
    setShowUploadModal(true);
  }, [currentProject?.id, searchParams, session?.access_token]);

  useEffect(() => {
    if (!toolbarPopover && !itemMenuState) return;
    const closeMenus = (event?: Event) => {
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) return;
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

  useEffect(() => {
    if (!toolbarPopover && !itemMenuState) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>("button:not([disabled]), [href]")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [itemMenuState, toolbarPopover]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href]") ?? []
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      setToolbarPopover(null);
      setItemMenuState(null);
      menuTriggerRef.current?.focus({ preventScroll: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus({ preventScroll: true });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus({ preventScroll: true });
    }
  }

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
    // An action returns the bare run; keep the paper title the list joined in.
    const updated = payload.run;
    setRuns((current) =>
      current.map((run) =>
        run.id === updated.id ? { ...updated, paper_title: updated.paper_title ?? run.paper_title } : run
      )
    );
    return { ...updated, paper_title: updated.paper_title ?? runs.find((run) => run.id === updated.id)?.paper_title };
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

  async function getRunOpenUrl(run: IngestionRunRow) {
    const payload = await postRun(run.id, "open");
    return payload.url ?? null;
  }

  async function handlePreviewRun(run: IngestionRunRow) {
    const url = await getRunOpenUrl(run);
    if (url) {
      setPreviewUrl(url);
      setPreviewTitle(titleOf(run));
    }
  }

  async function handleViewAnalysis(run: IngestionRunRow, tab: PaperExplorerTab = "overview") {
    autoOpenedRunIdRef.current = `run:${run.id}`;
    setAnalysisTab(tab);
    setAnalysisRun(run);
    setAnalysisDetail(null);
    setAnalysisError(null);
    setAnalysisLoading(true);

    try {
      const detail = await fetchAnalysisDetail(run.id);
      setAnalysisDetail(detail);
    } catch (analysisLoadError) {
      setAnalysisError(
        analysisLoadError instanceof Error
          ? analysisLoadError.message
          : "Failed to load analysis details."
      );
      throw analysisLoadError;
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function fetchAnalysisDetail(runId: string) {
    const response = await fetch(`/api/workspace/library/${runId}/analysis`, {
      headers: requestHeaders,
    });
    const payload = (await response.json()) as RunAnalysisResponse;

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load analysis details.");
    }

    return (
      payload.analysis ?? {
        available: false,
        topics: [],
        keywords: [],
        concepts: [],
        facets: [],
        tracksSingle: [],
        tracksMulti: [],
      }
    );
  }

  async function handleOpenPrimaryFileAction(run: IngestionRunRow, tab: PaperExplorerTab = "overview") {
    if (hasUsableAnalysis(run)) {
      await handleViewAnalysis(run, tab).catch(() => undefined);
      return;
    }

    await handlePreviewRun(run);
  }

  useEffect(() => {
    const requestedKey = requestedRunId
      ? `run:${requestedRunId}`
      : requestedPaperId
        ? `paper:${requestedPaperId}`
        : "";

    if (!requestedKey) {
      autoOpenedRunIdRef.current = null;
      return;
    }

    if (autoOpenedRunIdRef.current === requestedKey) {
      return;
    }

    const matchingRun = requestedRunId
      ? runs.find((run) => run.id === requestedRunId)
      : runs.find((run) => paperIdOfRun(run) === requestedPaperId);
    if (!matchingRun) {
      // The list has loaded and the paper is not in it: stop waiting, so the
      // address can be tidied instead of pointing at nothing.
      if (runsLoaded) autoOpenedRunIdRef.current = requestedKey;
      return;
    }

    autoOpenedRunIdRef.current = requestedKey;
    void handleOpenPrimaryFileAction(matchingRun, readChoice(searchParams.get("tab"), PAPER_EXPLORER_TABS, "overview"));
  }, [requestedPaperId, requestedRunId, runs, runsLoaded, searchParams]);

  // ------------------------------------------------------------- the address
  // What the reader is looking at lives in the address: the open repository,
  // Trash, the search, filters, sort and view, and the paper open in the
  // explorer with its tab. Reload, Back and a copied link return to the same
  // place. Opening a repository, Trash or a paper adds a history entry, so Back
  // steps out of it; typing and filtering replace the entry instead.
  const pushedPaperRef = useRef(false);
  const navigationKeyRef = useRef<string | null>(null);
  const analysisRunRef = useRef<IngestionRunRow | null>(null);
  analysisRunRef.current = analysisRun;
  const runsRef = useRef<IngestionRunRow[]>([]);
  runsRef.current = runs;

  useEffect(() => {
    const params = new URLSearchParams();
    if (libraryProjectId) params.set("repo", libraryProjectId);
    if (showTrash) params.set("trash", "1");
    if (query.trim()) params.set("q", query);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (modifiedFilter !== "all") params.set("modified", modifiedFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (sortKey !== "name") params.set("sort", sortKey);
    if (sortDirection !== "asc") params.set("dir", sortDirection);
    if (viewMode !== "list") params.set("view", viewMode);
    if (analysisRun) {
      params.set("paper", analysisRun.id);
      if (analysisTab !== "overview") params.set("tab", analysisTab);
    }
    // A link to a paper that has not opened yet (the list is still loading)
    // must survive, or the address would lose it before it could open.
    const currentParams = new URLSearchParams(window.location.search);
    const linked = currentParams.get("paper") ?? currentParams.get("runId");
    const linkedPaper = currentParams.get("paperId");
    const pendingKey = linked ? `run:${linked}` : linkedPaper ? `paper:${normalizePaperId(linkedPaper)}` : "";
    if (!analysisRun && pendingKey && autoOpenedRunIdRef.current !== pendingKey) return;

    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ""}`;
    const current = `${window.location.pathname}${window.location.search}`;
    const navigationKey = `${libraryProjectId ?? ""}|${showTrash ? 1 : 0}|${analysisRun?.id ?? ""}`;
    const firstRun = navigationKeyRef.current === null;
    const navigated = !firstRun && navigationKey !== navigationKeyRef.current;
    navigationKeyRef.current = navigationKey;
    if (next === current) return;

    // Closing a paper that was opened here goes back to the entry before it,
    // so Back afterwards does not reopen it.
    if (!analysisRun && pushedPaperRef.current) {
      pushedPaperRef.current = false;
      window.history.back();
      return;
    }
    const legacyLink = /[?&](runId|paperId)=/.test(window.location.search);
    if (navigated && !legacyLink) {
      window.history.pushState(null, "", next);
      if (analysisRun) pushedPaperRef.current = true;
    } else {
      window.history.replaceState(null, "", next);
    }
  }, [analysisRun, analysisTab, libraryProjectId, modifiedFilter, query, showTrash, sortDirection, sortKey, sourceFilter, typeFilter, viewMode]);

  // Back and Forward bring the view with them.
  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search);
      const paper = params.get("paper");
      navigationKeyRef.current = `${params.get("repo") ?? ""}|${params.get("trash") === "1" ? 1 : 0}|${paper ?? ""}`;
      setLibraryProjectId(params.get("repo"));
      setShowTrash(params.get("trash") === "1");
      setQuery(params.get("q") ?? "");
      setTypeFilter(readChoice(params.get("type"), TYPE_FILTERS, "all"));
      setModifiedFilter(readChoice(params.get("modified"), MODIFIED_FILTERS, "all"));
      setSourceFilter(readChoice(params.get("source"), SOURCE_FILTERS, "all"));
      setSortKey(readChoice(params.get("sort"), SORT_KEYS, "name"));
      setSortDirection(readChoice(params.get("dir"), SORT_DIRECTIONS, "asc"));
      setViewMode(readChoice(params.get("view"), VIEW_MODES, "list"));
      if (!paper) {
        pushedPaperRef.current = false;
        setAnalysisRun(null);
        setAnalysisDetail(null);
        setAnalysisError(null);
      } else if (paper !== analysisRunRef.current?.id) {
        const run = runsRef.current.find((item) => item.id === paper);
        if (run) void handleViewAnalysis(run, readChoice(params.get("tab"), PAPER_EXPLORER_TABS, "overview")).catch(() => undefined);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // handleViewAnalysis reads only refs and setters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOpenRunInNewTab(run: IngestionRunRow) {
    const opened = window.open("", "_blank");
    const url = await getRunOpenUrl(run);
    if (opened && url) {
      opened.opener = null;
      opened.location.href = url;
    } else {
      opened?.close();
    }
  }

  async function handleDownloadRun(run: IngestionRunRow) {
    const url = await getRunOpenUrl(run);
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileNameOf(run);
    anchor.rel = "noopener noreferrer";
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function handleDownloadAnalysisReport(
    run: IngestionRunRow,
    suppliedDetail?: RunAnalysisDetail | null
  ) {
    const detail =
      suppliedDetail && suppliedDetail.available
        ? suppliedDetail
        : await fetchAnalysisDetail(run.id);

    if (!detail.available) {
      throw new Error("Pipeline analysis is not ready yet for this file.");
    }

    const markdown = buildAnalysisMarkdown(run, detail);
    const baseName = sanitizeFilenamePart(
      detail.title || run.display_name || run.source_filename || run.id
    );
    const filename = `${baseName || "analysis-report"} - pipeline-analysis.md`;
    triggerTextDownload(filename, markdown, "text/markdown;charset=utf-8");
  }

  async function handleRenameRun(run: IngestionRunRow) {
    setItemMenuState(null);
    setRenameTarget({ kind: "file", run });
    setRenameDraft(fileNameOf(run));
    setRenameError(null);
  }

  async function handleToggleFavorite(run: IngestionRunRow) {
    const updatedRun = await patchRun(run.id, {
      action: "favorite",
      value: !run.is_favorite,
    });
    if (analysisRun?.id === updatedRun.id) {
      setAnalysisRun(updatedRun);
    }
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

  function projectIdOfRun(run: IngestionRunRow): string | null {
    const payloadProjectId = typeof run.input_payload?.project_id === "string" ? run.input_payload.project_id : null;
    return run.folder_id ? folderById.get(run.folder_id)?.project_id ?? payloadProjectId : payloadProjectId;
  }

  async function handleReanalyze(selection: { runIds: string[] } | { projectId: string }, paperCount: number) {
    if (paperCount === 0) {
      setError("There are no finished papers to analyze again.");
      return;
    }
    const confirmed = window.confirm(
      `Analyze again with the current pipeline?\n\n${formatReanalysisEstimate(paperCount)}. ` +
        "Titles and years you corrected are kept."
    );
    if (!confirmed) return;
    const response = await fetch("/api/workspace/library/reanalyze", {
      method: "POST",
      headers: jsonRequestHeaders,
      body: JSON.stringify(selection),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      queuedCount?: number;
      queuedRunIds?: string[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "The papers could not be queued.");
    }
    // Follow the re-queued papers in the progress tray, exactly as an upload
    // is followed. The message used to promise progress "on Home", where
    // nothing about a re-analysis ever appeared.
    // Follow what the server queued, by id: filtering the Library's own list
    // (at most 200 runs) missed papers it had not loaded.
    const queuedRuns = [...new Set(payload.queuedRunIds ?? [])].map((id) => ({ id }));
    if (queuedRuns.length > 0) {
      startAnalysisSession(queuedRuns, {
        sourceKind: "reanalysis",
        folder: libraryProject?.name ?? "Repository",
      });
    }
    setMessage(
      `${payload.queuedCount ?? 0} paper${payload.queuedCount === 1 ? "" : "s"} queued to be analyzed again. ` +
        "The progress tray follows each one."
    );
    await loadRuns();
  }

  async function handleTrashRun(run: IngestionRunRow) {
    await patchRun(run.id, { action: "trash" });
    setMessage(`Moved "${titleOf(run)}" to Trash.`);
  }

  async function handleRestoreRun(run: IngestionRunRow) {
    await patchRun(run.id, { action: "restore" });
    setMessage(`Restored "${titleOf(run)}" to its repository.`);
  }

  async function handlePermanentDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/library/trash", {
        method: "DELETE",
        headers: jsonRequestHeaders,
        body: JSON.stringify(deleteTarget.all ? { all: true } : { runIds: deleteTarget.runs.map((run) => run.id) }),
      });
      const payload = (await response.json().catch(() => ({}))) as { deleted?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The papers could not be deleted.");
      const count = payload.deleted ?? 0;
      setMessage(
        deleteTarget.all
          ? `Emptied Trash: ${count} paper${count === 1 ? "" : "s"} deleted for good.`
          : deleteTarget.runs.length > 1
            ? `Deleted ${count} papers for good.`
            : `Deleted "${titleOf(deleteTarget.runs[0])}" for good.`
      );
      setDeleteTarget(null);
      setDeleteConfirmText("");
      await loadRuns();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The papers could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameTarget) return;

    const nextName = renameDraft.trim();
    const currentName = fileNameOf(renameTarget.run);
    if (!nextName) {
      setRenameError("A name is required.");
      return;
    }
    if (nextName === currentName) {
      setRenameTarget(null);
      return;
    }

    setRenaming(true);
    setRenameError(null);
    try {
      const updatedRun = await patchRun(renameTarget.run.id, {
        action: "rename",
        value: nextName,
      });
      if (analysisRun?.id === updatedRun.id) {
        setAnalysisRun(updatedRun);
      }
      setMessage(`Renamed file to "${nextName}".`);
      setError(null);
      setRenameTarget(null);
    } catch (renameActionError) {
      setRenameError(
        renameActionError instanceof Error
          ? renameActionError.message
          : "Failed to rename."
      );
    } finally {
      setRenaming(false);
    }
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
    menuTriggerRef.current = event.currentTarget;
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
    menuTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = getPopoverPosition(rect, 224, 390);
    setItemMenuState({
      item,
      top: position.top,
      left: Math.min(position.left, window.innerWidth - 240),
    });
    setToolbarPopover(null);
  }

  /** A column header's name, with how the list is sorted by it. */
  function sortLabel(label: string, key: SortKey): string {
    if (sortKey !== key) return `${label}, sort by this column`;
    return `${label}, sorted ${sortDirection === "asc" ? "ascending" : "descending"}`;
  }

  function handleSortHeaderClick(nextSortKey: SortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(defaultDirectionForSort(nextSortKey));
  }

  const fileEntries = useMemo<LibraryEntry[]>(() => {
    return runs
      .filter((run) => {
        const payloadProjectId = typeof run.input_payload?.project_id === "string"
          ? run.input_payload.project_id
          : null;
        const runProjectId = run.folder_id
          ? folderById.get(run.folder_id)?.project_id ?? payloadProjectId
          : payloadProjectId;
        if (!libraryProjectId && !showTrash) return false;
        if (libraryProjectId && runProjectId !== libraryProjectId) return false;
        return showTrash ? Boolean(run.trashed_at) : !run.trashed_at;
      })
      .map((run) => {
        const sourceLabel = sourceOf(run);
        // A failed paper says why, on the paper itself. The grid view shows no
        // status pill at all, so before this a failed file there looked exactly
        // like a ready one; and with the History page gone this is the only place
        // an older failure can still explain itself.
        // The worker compares each paper's text with the repository's other
        // papers and notes an earlier copy; the reader decides what to keep.
        const duplicateOf = run.input_payload?.duplicate_of as { title?: string } | null | undefined;
        // A re-analysis that did not finish leaves the earlier results in
        // place; the note lasts until the paper is queued again.
        const failedAgainAt = String(run.input_payload?.reanalysis_failed_at ?? "");
        const reanalysisFailed =
          Boolean(failedAgainAt) && failedAgainAt >= String(run.input_payload?.reanalysis_requested_at ?? "");
        // A paper is listed by its title once analysed; the file it came in
        // stays underneath, so a search by file name still finds it.
        const shownName = titleOf(run);
        const paperTitle = getRunPaperTitle(run);
        const secondaryName =
          shownName !== fileNameOf(run)
            ? fileNameOf(run)
            : paperTitle && paperTitle !== shownName
              ? paperTitle
              : "";
        const subtitle =
          run.status === "failed"
            ? describeRunFailure(run.error_message)
            : duplicateOf?.title
              ? `Possible copy of "${duplicateOf.title}"`
              : run.status !== "succeeded"
                ? getRunStageMessage(run)
                : reanalysisFailed
                  ? "Analyzing again did not finish; the earlier results are shown. Try Analyze again later."
                  : secondaryName
                    ? secondaryName
                    : `${sourceLabel} \u2022 ${extOf(run).toUpperCase()}`;
        return {
          id: `file:${run.id}`,
          kind: "file",
          name: shownName,
          yearLabel: paperYearOf(run),
          modifiedAt: run.updated_at ?? run.created_at ?? null,
          modifiedMs: timeToMs(run.updated_at ?? run.created_at ?? null),
          sizeBytes: run.file_size_bytes ?? null,
          sizeLabel: formatBytes(run.file_size_bytes),
          typeFilter: typeOfRun(run),
          sourceFilter: sourceLabel === "Google Drive" ? "google-drive" : "upload",
          sourceLabel,
          subtitle,
          statusLabel: getRunStatusLabel(run),
          favorite: Boolean(run.is_favorite),
          run,
        };
      });
  }, [folderById, libraryProjectId, runs, showTrash]);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const combined = fileEntries.filter((item) => {
      if (typeFilter !== "all" && item.typeFilter !== typeFilter) return false;
      if (sourceFilter !== "all" && item.sourceFilter !== sourceFilter) return false;
      if (!matchesModifiedFilter(item.modifiedMs, modifiedFilter)) return false;
      if (!needle) return true;
      return [item.name, item.subtitle, item.sourceLabel, item.statusLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });

    return combined.sort((left, right) => {
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
    modifiedFilter,
    query,
    sortDirection,
    sortKey,
    sourceFilter,
    typeFilter,
  ]);

  const rootGridFiles = visibleEntries;

  // A selection holds only what is in view: a paper a filter hides is never
  // acted on unseen, and switching to Trash or another repository starts afresh.
  useEffect(() => {
    setSelectedRunIds(new Set());
  }, [showTrash, libraryProjectId]);
  const selectedRuns = useMemo(
    () => visibleEntries.filter((entry) => selectedRunIds.has(entry.run.id)).map((entry) => entry.run),
    [selectedRunIds, visibleEntries]
  );
  const allVisibleSelected = visibleEntries.length > 0 && selectedRuns.length === visibleEntries.length;
  const someVisibleSelected = selectedRuns.length > 0;
  const reanalysableSelection = selectedRuns.filter((run) => run.status === "succeeded" && !run.trashed_at);
  const retryableSelection = selectedRuns.filter((run) => run.status === "failed" && !run.trashed_at && Boolean(run.source_path));
  const citableSelection = selectedRuns.filter((run) => hasUsableAnalysis(run) && !run.trashed_at);
  function toggleRunSelected(runId: string) {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelectedRunIds(allVisibleSelected ? new Set() : new Set(visibleEntries.map((entry) => entry.run.id)));
  }
  /** Trash, restore or move a selection in one request (docs/32, 4.5). */
  async function runBulk(action: "trash" | "restore" | "move", targets: IngestionRunRow[], folderId?: string) {
    if (targets.length === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/library/bulk", {
        method: "POST",
        headers: jsonRequestHeaders,
        body: JSON.stringify({ action, runIds: targets.map((run) => run.id), ...(folderId ? { folderId } : {}) }),
      });
      const payload = (await response.json().catch(() => ({}))) as { changed?: number; skipped?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The papers could not be changed.");
      const changed = payload.changed ?? 0;
      const papers = `${changed} paper${changed === 1 ? "" : "s"}`;
      const destination = folderId ? moveDestinationLabel(folderId) : "";
      setMessage(
        (action === "trash"
          ? `Moved ${papers} to Trash.`
          : action === "restore"
            ? `Restored ${papers} to ${changed === 1 ? "its repository" : "their repositories"}.`
            : `Moved ${papers} to ${destination}.`) +
          (payload.skipped ? ` ${payload.skipped} ${payload.skipped === 1 ? "was" : "were"} already there.` : "")
      );
      setSelectedRunIds(new Set());
      setMoveTarget(null);
      await loadRuns();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "The papers could not be changed.");
    } finally {
      setBulkBusy(false);
    }
  }
  // Where a paper can be moved: each repository's folders, named by the
  // repository (and the folder, where a repository has more than one).
  const moveDestinations = useMemo(
    () =>
      allProjects
        .map((project) => {
          const folders = allFolders.filter((folder) => folder.project_id === project.id);
          return folders.map((folder) => ({
            id: folder.id,
            label: folders.length > 1 ? `${project.name} / ${folder.name}` : project.name,
          }));
        })
        .flat(),
    [allFolders, allProjects]
  );
  function moveDestinationLabel(folderId: string) {
    return moveDestinations.find((destination) => destination.id === folderId)?.label ?? "the folder";
  }

  const typeFilterLabel =
    TYPE_OPTIONS.find((option) => option.id === typeFilter)?.label ?? "Type";
  const modifiedFilterLabel =
    MODIFIED_OPTIONS.find((option) => option.id === modifiedFilter)?.label ??
    "Modified";
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

    const sectionClass = `z-50 origin-top ${menuPanelClass}`;
    const itemClass = menuItemClass(false, "justify-between");

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
              setShowUploadModal(true);
            }}
            className={itemClass}
          >
            <span className="flex items-center gap-3">
              <UploadIcon className="h-4 w-4" />
              <span>Add papers</span>
            </span>
          </button>
          {libraryProject ? (
            <button
              type="button"
              onClick={async () => {
                setToolbarPopover(null);
                const count = runs.filter(
                  (run) => run.status === "succeeded" && !run.trashed_at && projectIdOfRun(run) === libraryProject.id
                ).length;
                try {
                  await handleReanalyze({ projectId: libraryProject.id }, count);
                } catch (reanalyzeError) {
                  setError(reanalyzeError instanceof Error ? reanalyzeError.message : "The papers could not be queued.");
                }
              }}
              className={itemClass}
            >
              <span>Analyze repository again</span>
            </button>
          ) : null}
          {libraryProject ? (
            <button
              type="button"
              onClick={() => {
                setToolbarPopover(null);
                setReferencesFor({ selection: { projectId: libraryProject.id }, label: libraryProject.name });
              }}
              className={itemClass}
            >
              <span>Export references</span>
            </button>
          ) : null}
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
          <p className="px-3 text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#808080]">
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
              aria-pressed={sortKey === option.id}
              className={itemClass}
            >
              <span>{option.label}</span>
              {sortKey === option.id ? <CheckIcon className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>

        <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-[#1f1f1f]">
          <p className="px-3 text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#808080]">
            Sort direction
          </p>
          {currentSortDirectionOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSortDirection(option.id)}
              aria-pressed={sortDirection === option.id}
              className={itemClass}
            >
              <span>{option.label}</span>
              {sortDirection === option.id ? <CheckIcon className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>

      </div>
    );
  }

  function renderItemMenu() {
    if (!itemMenuState) return null;

    const itemClass = menuItemClass();
    const menuItem = itemMenuState.item;

    if (!activeMenuRun) return null;

    return (
      <div
        className="fixed z-50 origin-top rounded-xl border border-hairline bg-surface p-1.5 shadow-overlay motion-safe:animate-scale-in"
        style={{ top: itemMenuState.top, left: itemMenuState.left, width: 224 }}
      >
        {hasUsableAnalysis(activeMenuRun) ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await handleViewAnalysis(activeMenuRun);
              } catch (analysisViewError) {
                setError(
                  analysisViewError instanceof Error
                    ? analysisViewError.message
                    : "Failed to open analysis details."
                );
              } finally {
                setItemMenuState(null);
              }
            }}
            className={itemClass}
          >
            View analysis
          </button>
        ) : null}
        {hasUsableAnalysis(activeMenuRun) ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await handleDownloadAnalysisReport(activeMenuRun);
                setMessage(`Downloaded the analysis report for "${titleOf(activeMenuRun)}".`);
                setError(null);
              } catch (downloadError) {
                setError(
                  downloadError instanceof Error
                    ? downloadError.message
                    : "Failed to download the analysis report."
                );
              } finally {
                setItemMenuState(null);
              }
            }}
            className={itemClass}
          >
            Download analysis report
          </button>
        ) : null}
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
          Preview PDF
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
          Rename file
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
        {!activeMenuRun.trashed_at ? (
          <button
            type="button"
            onClick={() => {
              setMoveFolderId("");
              setMoveTarget([activeMenuRun]);
              setItemMenuState(null);
            }}
            className={itemClass}
          >
            Move to another repository…
          </button>
        ) : null}
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
        {activeMenuRun.status === "succeeded" && !activeMenuRun.trashed_at ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await handleReanalyze({ runIds: [activeMenuRun.id] }, 1);
              } catch (reanalyzeError) {
                setError(
                  reanalyzeError instanceof Error ? reanalyzeError.message : "The paper could not be queued."
                );
              } finally {
                setItemMenuState(null);
              }
            }}
            className={itemClass}
          >
            Analyze again
          </button>
        ) : null}
        {activeMenuRun.status === "failed" && !activeMenuRun.trashed_at && activeMenuRun.source_path ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await handleReanalyze({ runIds: [activeMenuRun.id] }, 1);
              } catch (retryError) {
                setError(retryError instanceof Error ? retryError.message : "The paper could not be queued.");
              } finally {
                setItemMenuState(null);
              }
            }}
            className={itemClass}
          >
            Try again
          </button>
        ) : null}
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
        {activeMenuRun.trashed_at ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await handleRestoreRun(activeMenuRun);
              } catch (restoreError) {
                setError(
                  restoreError instanceof Error
                    ? restoreError.message
                    : "Failed to restore file."
                );
              } finally {
                setItemMenuState(null);
              }
            }}
            className={itemClass}
          >
            Restore to repository
          </button>
        ) : null}
        {activeMenuRun.trashed_at ? (
          <button
            type="button"
            onClick={() => {
              setDeleteTarget({ runs: [activeMenuRun], all: false });
              setItemMenuState(null);
            }}
            className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-red-700 transition-colors duration-150 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-700 dark:text-red-300 dark:focus-visible:ring-red-300 dark:hover:bg-red-950/30 dark:focus-visible:bg-red-950/30"
          >
            Delete permanently…
          </button>
        ) : (
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
            className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-red-700 transition-colors duration-150 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            Move to trash
          </button>
        )}
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
        aria-expanded={toolbarPopover?.kind === kind}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3.5 text-sm font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
      >
        <span>{label}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 text-mute" />
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="space-y-5">
        {/*
          Browsing and switching are now different acts, so the one place they
          could be confused says which is which. Without this a reader could be
          looking at one repository's papers while the Dashboard and Chat in the
          sidebar were about another, with nothing on screen to say so.
        */}
        {!showTrash && libraryProject && currentProject && libraryProject.id !== currentProject.id ? (
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-[#1f1f1f] dark:bg-[#050505]">
            <p className="leading-6 text-slate-600 dark:text-[#a3a3a3]">
              You are browsing{" "}
              <span className="font-medium text-slate-900 dark:text-white">{libraryProject.name}</span>. Dashboard
              and Chat still use{" "}
              <span className="font-medium text-slate-900 dark:text-white">{currentProject.name}</span>.
            </p>
            <button
              type="button"
              onClick={() => setSelectedProjectId(libraryProject.id)}
              className="inline-flex flex-none items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-[#171717] dark:hover:bg-[#f2f2f2]"
            >
              Switch to this repository
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            {/* A way back up, only where there is somewhere to go back to: at
                the root it would just repeat the heading. */}
            {showTrash || libraryProject ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-[#8f8f8f]">
                <button
                  type="button"
                  onClick={() => {
                    if (showTrash) {
                      setShowTrash(false);
                    } else {
                      setLibraryProjectId(null);
                      setSelectedFolderId("all");
                    }
                  }}
                  className="-mx-2 rounded-full px-2 py-1 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                >
                  Library
                </button>
                <span aria-hidden="true">/</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {showTrash ? "Trash" : libraryProject?.name}
                </span>
              </div>
            ) : null}
            <h1 className="text-3xl font-semibold tracking-normal text-slate-900 dark:text-[#f2f2f2]">
              {showTrash ? "Trash" : libraryProject?.name ?? "Library"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500 dark:text-[#a3a3a3]">
              {showTrash
                ? "Review files moved out of repositories and restore them when needed."
                : libraryProject
                  ? `Browse and manage every paper inside ${libraryProject.name}.`
                  : "Open a repository to browse its research papers."}
            </p>
          </div>

          <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:flex sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={(event) => {
                if (!libraryProject) {
                  // From the list of repositories, "New" adds papers to the one
                  // the workspace is on, and opens it so they are seen arriving.
                  if (currentProject?.id) {
                    setLibraryProjectId(currentProject.id);
                    setShowUploadModal(true);
                  } else {
                    setMessage("Open a repository before adding papers.");
                  }
                  return;
                }
                openToolbarMenu(event, "new", 240);
              }}
              aria-expanded={toolbarPopover?.kind === "new"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-canvas shadow-raise transition-[background-color,transform] duration-150 hover:bg-ink/85 active:scale-[0.98]"
            >
              <PlusIcon className="h-4 w-4" />
              <span>New</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowTrash((current) => !current);
                setSelectedFolderId("all");
                setQuery("");
              }}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium shadow-raise transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] ${
                showTrash
                  ? "border-ink bg-ink text-canvas"
                  : "border-hairline bg-surface text-ink hover:border-hairline-strong hover:bg-subtle"
              }`}
            >
              <TrashIcon className="h-4 w-4" />
              <span>{showTrash ? "Back to library" : "Trash"}</span>
            </button>

            <label className="relative col-span-2 block min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={libraryProject ? `Search in ${libraryProject.name}` : "Search repositories"}
                className="h-10 w-full rounded-lg border border-hairline bg-surface py-2 pl-10 pr-3 text-base text-ink shadow-raise outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-mute hover:border-hairline-strong focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm"
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
            {/* A filter that cannot match anything is not offered (audit LIB-7). */}
            {sourceFilter !== "all" || fileEntries.some((entry) => entry.sourceFilter === "google-drive")
              ? renderFilterButton(
                  "source",
                  sourceFilter === "all" ? "Source" : SOURCE_OPTIONS.find((option) => option.id === sourceFilter)?.label ?? "Source"
                )
              : null}

          </div>

          <div className="flex items-center gap-2 self-start xl:self-auto">
            <button
              type="button"
              onClick={(event) => openToolbarMenu(event, "sort", 260)}
              aria-expanded={toolbarPopover?.kind === "sort"}
              aria-label={`Sort: ${SORT_KEY_OPTIONS.find((option) => option.id === sortKey)?.label ?? "Name"}, ${
                currentSortDirectionOptions.find((option) => option.id === sortDirection)?.label ?? ""
              }`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3.5 text-sm font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              <SortIcon className="h-4 w-4" />
              <span>Sort</span>
            </button>
            <button
              type="button"
              onClick={() => void loadRuns()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3.5 text-sm font-medium text-ink shadow-raise transition-[background-color,border-color,transform] duration-150 hover:border-hairline-strong hover:bg-subtle active:scale-[0.98]"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <div className="inline-flex rounded-lg border border-hairline bg-surface p-0.5 shadow-raise">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                // The chosen layout in ink, and said: a pale fill alone was 1.1:1 (A11Y-6, A11Y-7).
                aria-pressed={viewMode === "list"}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
                  viewMode === "list"
                    ? "bg-ink text-canvas"
                    : "text-mute hover:text-ink"
                }`}
                aria-label="List layout"
              >
                <ListViewIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                aria-pressed={viewMode === "grid"}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
                  viewMode === "grid"
                    ? "bg-ink text-canvas"
                    : "text-mute hover:text-ink"
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
        <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {libraryProject || showTrash ? (
      <section className="app-surface overflow-visible">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-5 dark:border-[#1f1f1f] sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                {visibleEntries.length} item{visibleEntries.length === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-[#9c9c9c]">
                {showTrash
                  ? "Papers in Trash still count toward your account's 50. Delete them permanently to free the space."
                  : "Every paper in this repository. Open one to see what the analysis found."}
              </p>
            </div>
            {showTrash && visibleEntries.length > 0 ? (
              <button
                type="button"
                onClick={() => setDeleteTarget({ runs: [], all: true })}
                className={buttonClass("danger", "sm")}
              >
                Empty Trash…
              </button>
            ) : null}
          </div>
          {selectedRuns.length > 0 ? (
            <div
              role="region"
              aria-label="Selected papers"
              className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-subtle px-3 py-2"
            >
              <p className="mr-1 text-sm font-medium text-ink" aria-live="polite">
                {selectedRuns.length} selected
              </p>
              {showTrash ? (
                <>
                  <button type="button" disabled={bulkBusy} onClick={() => void runBulk("restore", selectedRuns)} className={buttonClass("secondary", "sm")}>
                    <UndoIcon className="h-4 w-4" />
                    Restore
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => setDeleteTarget({ runs: selectedRuns, all: false })}
                    className={buttonClass("danger", "sm")}
                  >
                    Delete permanently…
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={bulkBusy || allFolders.length === 0}
                    onClick={() => {
                      setMoveFolderId("");
                      setMoveTarget(selectedRuns);
                    }}
                    className={buttonClass("secondary", "sm")}
                  >
                    <FolderIcon className="h-4 w-4" />
                    Move…
                  </button>
                  {reanalysableSelection.length > 0 ? (
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() =>
                        void handleReanalyze({ runIds: reanalysableSelection.map((run) => run.id) }, reanalysableSelection.length)
                          .then(() => setSelectedRunIds(new Set()))
                          .catch((reanalyzeError) =>
                            setError(reanalyzeError instanceof Error ? reanalyzeError.message : "The papers could not be queued.")
                          )
                      }
                      className={buttonClass("secondary", "sm")}
                    >
                      <RefreshIcon className="h-4 w-4" />
                      Analyze again ({reanalysableSelection.length})
                    </button>
                  ) : null}
                  {retryableSelection.length > 0 ? (
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() =>
                        void handleReanalyze({ runIds: retryableSelection.map((run) => run.id) }, retryableSelection.length)
                          .then(() => setSelectedRunIds(new Set()))
                          .catch((retryError) =>
                            setError(retryError instanceof Error ? retryError.message : "The papers could not be queued.")
                          )
                      }
                      className={buttonClass("secondary", "sm")}
                    >
                      <RefreshIcon className="h-4 w-4" />
                      Try again ({retryableSelection.length})
                    </button>
                  ) : null}
                  {citableSelection.length > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setReferencesFor({
                          selection: { runIds: citableSelection.map((run) => run.id) },
                          label: citableSelection.length === 1 ? titleOf(citableSelection[0]) : `${citableSelection.length} papers`,
                        })
                      }
                      className={buttonClass("secondary", "sm")}
                    >
                      <BooksIcon className="h-4 w-4" />
                      Cite ({citableSelection.length})
                    </button>
                  ) : null}
                  <button type="button" disabled={bulkBusy} onClick={() => void runBulk("trash", selectedRuns)} className={buttonClass("secondary", "sm")}>
                    <TrashIcon className="h-4 w-4" />
                    Move to Trash
                  </button>
                </>
              )}
              <button type="button" onClick={() => setSelectedRunIds(new Set())} className={buttonClass("ghost", "sm")}>
                Clear selection
              </button>
              {!allVisibleSelected ? (
                <button type="button" onClick={toggleAllVisible} className={buttonClass("ghost", "sm")}>
                  Select all {visibleEntries.length}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {visibleEntries.length === 0 ? (
          <div className="flex min-h-[360px] items-center justify-center px-6 py-12 text-center">
            <div>
              <Mascot
                state={showTrash ? "sleeping" : fileEntries.length === 0 ? "idle" : "surprised"}
                size={52}
                className="mx-auto text-ink"
              />
              {fileEntries.length === 0 && !showTrash ? (
                <>
                  <p className="mt-5 text-lg font-medium text-slate-900 dark:text-[#f2f2f2]">
                    No papers in this repository yet
                  </p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-[#9c9c9c]">
                    Add PDFs and each one is analyzed for its topics, methods and category.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(true)}
                    className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-[#171717] dark:hover:bg-[#f2f2f2]"
                  >
                    <UploadIcon className="h-4 w-4" />
                    <span>Add papers</span>
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-5 text-lg font-medium text-slate-900 dark:text-[#f2f2f2]">
                    {showTrash ? "Trash is empty" : "Nothing matches these filters"}
                  </p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-[#9c9c9c]">
                    {showTrash
                      ? "Papers you move to Trash wait here until you restore them."
                      : "Clear the search or pick another filter to see more papers."}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : viewMode === "list" ? (
          <div className="px-4 py-4 sm:px-6">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_180px_170px_120px_160px] items-center gap-4 border-b border-slate-200 px-3 py-3 text-sm font-medium text-slate-600 dark:border-[#1f1f1f] dark:text-[#9c9c9c] md:grid">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = someVisibleSelected && !allVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                  aria-label="Select every file shown"
                  className="h-4 w-4 flex-none cursor-pointer rounded border-field accent-[rgb(var(--ink))]"
                />
                <button
                  type="button"
                  onClick={() => handleSortHeaderClick("name")}
                  aria-label={sortLabel("Name", "name")}
                  className="flex items-center gap-2 text-left transition hover:text-slate-900 dark:hover:text-white"
                >
                  <span>Name</span>
                  {sortKey === "name" ? (
                    <span className="text-xs text-ink">
                      {sortDirection === "asc" ? "\u2191" : "\u2193"}
                    </span>
                  ) : null}
                </button>
              </div>
              <div>Year</div>
              <button
                type="button"
                onClick={() => handleSortHeaderClick("modified")}
                aria-label={sortLabel("Date modified", "modified")}
                className="flex items-center gap-2 text-left transition hover:text-slate-900 dark:hover:text-white"
              >
                <span>Date modified</span>
                {sortKey === "modified" ? (
                  <span className="text-xs text-ink">
                    {sortDirection === "asc" ? "\u2191" : "\u2193"}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => handleSortHeaderClick("size")}
                aria-label={sortLabel("File size", "size")}
                className="flex items-center gap-2 text-left transition hover:text-slate-900 dark:hover:text-white"
              >
                <span>File size</span>
                {sortKey === "size" ? (
                  <span className="text-xs text-ink">
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
                        <input
                          type="checkbox"
                          checked={selectedRunIds.has(item.run.id)}
                          onChange={() => toggleRunSelected(item.run.id)}
                          aria-label={`Select ${item.name}`}
                          className="mt-3 h-4 w-4 flex-none cursor-pointer rounded border-field accent-[rgb(var(--ink))]"
                        />
                        <span
                          className={`mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-lg ${badgeToneForEntry(item)}`}
                        >
                          <Glyph className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleOpenPrimaryFileAction(item.run)}
                              title={item.name}
                              className="line-clamp-2 min-w-0 text-left text-sm font-medium text-ink underline-offset-2 hover:underline"
                            >
                              {item.name}
                            </button>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#030303] dark:text-[#bbbbbb]">
                              {extOf(item.run).toUpperCase()}
                            </span>
                            {item.favorite ? (
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                                Favorite
                              </span>
                            ) : null}
                            {item.statusLabel ? (
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${
                                  item.run.status === "failed"
                                    ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200"
                                    : "bg-slate-100 text-slate-600 dark:bg-[#030303] dark:text-[#bbbbbb]"
                                }`}
                              >
                                {item.statusLabel}
                              </span>
                            ) : null}
                          </div>
                          <p
                            title={item.subtitle}
                            className={`mt-1 truncate text-sm ${
                              item.run.status === "failed"
                                ? "text-red-700 dark:text-red-200"
                                : "text-slate-500 dark:text-[#9c9c9c]"
                            }`}
                          >
                            {item.subtitle}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="text-sm tabular-nums text-slate-600 dark:text-[#b6b6b6]">
                      <span className="md:hidden">Year: </span>
                      {item.yearLabel}
                    </div>

                    <div
                      className="text-sm tabular-nums text-slate-600 dark:text-[#b6b6b6]"
                      title={formatDetailedDate(item.modifiedAt)}
                    >
                      {formatShortDate(item.modifiedAt)}
                    </div>

                    <div className="text-sm tabular-nums text-slate-600 dark:text-[#b6b6b6]">
                      {item.sizeLabel}
                    </div>

                    <div className="flex items-center justify-end gap-1">
                      <>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleDownloadRun(item.run);
                              } catch (downloadError) {
                                setError(
                                  downloadError instanceof Error
                                    ? downloadError.message
                                    : "Failed to download file."
                                );
                              }
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink"
                            aria-label={`Download ${item.name}`}
                          >
                            <DownloadIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleRenameRun(item.run);
                              } catch (renameError) {
                                setError(
                                  renameError instanceof Error
                                    ? renameError.message
                                    : "Failed to rename file."
                                );
                              }
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink"
                            aria-label={`Rename ${item.name}`}
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await handleToggleFavorite(item.run);
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
                                ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
                                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                            }`}
                            aria-label={`${item.favorite ? "Remove" : "Add"} ${item.name} ${
                              item.favorite ? "from" : "to"
                            } favorites`}
                            aria-pressed={item.favorite}
                          >
                            <StarIcon className="h-4 w-4" weight={item.favorite ? "fill" : "regular"} />
                          </button>
                      </>
                      <button
                        type="button"
                        onClick={(event) => openItemMenu(event, item)}
                        aria-expanded={itemMenuState?.item.id === item.id}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink"
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
            {rootGridFiles.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8b8b8b]">
                    Files
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                  {rootGridFiles.map((item) => {
                    const Glyph = glyphForEntry(item);
                    return (
                      <article
                        key={item.id}
                        className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRunIds.has(item.run!.id)}
                          onChange={() => toggleRunSelected(item.run!.id)}
                          aria-label={`Select ${item.name}`}
                          className="absolute left-3 top-3 z-10 h-4 w-4 flex-none cursor-pointer rounded border-field accent-[rgb(var(--ink))]"
                        />
                        <button
                          type="button"
                          onClick={() => void handleOpenPrimaryFileAction(item.run!)}
                          className="flex w-full flex-col text-left"
                        >
                          <div className="relative flex h-44 items-center justify-center overflow-hidden bg-slate-100 dark:bg-[#050505]">
                            <span
                              className={`flex h-14 w-14 items-center justify-center rounded-xl ${badgeToneForEntry(item)}`}
                            >
                              <Glyph className="h-7 w-7" />
                            </span>
                            <span className="absolute left-10 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm dark:bg-[#050505]/90 dark:text-[#d0d0d0]">
                              {extOf(item.run!).toUpperCase()}
                            </span>
                            {item.favorite ? (
                              <span className="absolute right-4 top-4 rounded-full bg-amber-100 p-2 text-amber-700 shadow-sm dark:bg-amber-950/30 dark:text-amber-300">
                                <StarIcon className="h-4 w-4" weight="fill" />
                              </span>
                            ) : null}
                          </div>
                          <div className="space-y-3 px-4 py-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-[#f2f2f2]">
                                {item.name}
                              </p>
                              <p
                                title={item.subtitle}
                                className={`mt-1 line-clamp-2 text-xs ${
                                  item.run.status === "failed"
                                    ? "text-red-700 dark:text-red-200"
                                    : "text-slate-500 dark:text-[#9c9c9c]"
                                }`}
                              >
                                {item.subtitle}
                              </p>
                            </div>
                            <div className="flex items-center justify-between text-xs tabular-nums text-slate-500 dark:text-[#9c9c9c]">
                              <span>{formatShortDate(item.modifiedAt)}</span>
                              <span>{item.sizeLabel}</span>
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-[#1f1f1f]">
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
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink"
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
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink"
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
                                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
                                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-[#8f8f8f] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                              }`}
                              aria-label={`${item.favorite ? "Remove" : "Add"} ${item.name} ${
                                item.favorite ? "from" : "to"
                              } favorites`}
                            aria-pressed={item.favorite}
                            >
                              <StarIcon className="h-4 w-4" weight={item.favorite ? "fill" : "regular"} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => openItemMenu(event, item)}
                        aria-expanded={itemMenuState?.item.id === item.id}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors duration-150 hover:bg-subtle hover:text-ink"
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
      ) : (
        <section className="app-surface overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-5 dark:border-[#1f1f1f]">
            <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
              {allProjects.length} repositor{allProjects.length === 1 ? "y" : "ies"}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-[#9c9c9c]">
              Repositories are the top-level containers for this account.
            </p>
          </div>
          {allProjects.length > 0 ? (
            <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {allProjects
                .filter((project) => !query.trim() || project.name.toLowerCase().includes(query.trim().toLowerCase()))
                .map((project) => {
                  const stats = projectStats.get(project.id) ?? { papers: 0, inProgress: 0, failed: 0, latest: null };
                  return (
                    <button
                      key={project.id}
                      type="button"
                      // Opening a repository here used to also set the app's
                      // active repository, so looking inside one to see what was
                      // in it silently redirected the Dashboard and Chat you
                      // opened next. Browsing any repository's files is the point
                      // of this screen; changing what the rest of the app is
                      // about is a separate decision, and it now has its own
                      // button in the notice below.
                      onClick={() => {
                        setLibraryProjectId(project.id);
                        setSelectedFolderId("all");
                        setQuery("");
                      }}
                      className="group flex min-h-32 items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 text-left transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a] dark:hover:bg-[#0a0a0a]"
                    >
                      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-[#111111] dark:text-[#d0d0d0]">
                        <BooksIcon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-semibold text-slate-900 dark:text-[#f2f2f2]">{project.name}</span>
                        <span className="mt-2 block text-sm text-slate-500 dark:text-[#9c9c9c]">
                          {stats.papers} paper{stats.papers === 1 ? "" : "s"}
                          {stats.inProgress > 0 ? `, ${stats.inProgress} being analyzed` : ""}
                        </span>
                        {stats.failed > 0 ? (
                          <span className="mt-1 block text-xs text-red-700 dark:text-red-300">
                            {stats.failed} failed to analyze
                          </span>
                        ) : null}
                        <span className="mt-3 block text-xs text-slate-500 dark:text-[#8f8f8f]">Updated {formatShortDate(stats.latest)}</span>
                      </span>
                      <ArrowRightIcon className="mt-1 h-4 w-4 flex-none text-slate-500 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  );
                })}
            </div>
          ) : (
            <div className="px-6 py-16 text-center text-sm text-slate-500 dark:text-[#9c9c9c]">
              Create a repository from the repository switcher to begin.
            </div>
          )}
        </section>
      )}

      <AnalyzeFlowModal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        projectId={libraryProject?.id ?? currentProject?.id ?? null}
        onCreated={(createdRuns, context) => {
          setRuns((current) => {
            const createdIds = new Set(createdRuns.map((run) => run.id));
            return [...createdRuns, ...current.filter((run) => !createdIds.has(run.id))];
          });
          const queued = createdRuns.filter((run) => run.status !== "failed");
          if (queued.length > 0) {
            startAnalysisSession(queued, context);
          }
          void refreshFolders();
        }}
      />

      <CreateEntityModal
        open={Boolean(renameTarget)}
        title="Rename file"
        description="Choose a clear name for this research file."
        value={renameDraft}
        fieldLabel="File name"
        fieldPlaceholder="File name"
        submitLabel="Save name"
        busyLabel="Saving…"
        busy={renaming}
        error={renameError}
        onValueChange={setRenameDraft}
        onClose={() => {
          if (renaming) return;
          setRenameTarget(null);
          setRenameDraft("");
          setRenameError(null);
        }}
        onSubmit={handleRenameSubmit}
      />

      {referencesFor ? (
        <ReferencesDialog
          selection={referencesFor.selection}
          label={referencesFor.label}
          headers={jsonRequestHeaders}
          onClose={() => setReferencesFor(null)}
        />
      ) : null}

      {moveTarget ? (
        <Modal
          onClose={() => {
            if (bulkBusy) return;
            setMoveTarget(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (moveFolderId) void runBulk("move", moveTarget, moveFolderId);
            }}
            className="w-[min(480px,92vw)] rounded-xl border border-hairline bg-surface p-6 shadow-overlay"
          >
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Move {moveTarget.length === 1 ? "this paper" : `${moveTarget.length} papers`}
            </h2>
            <p className="mt-2 text-sm leading-6 text-body">
              The analysis moves with each paper, so it is counted and searched where it lands.
            </p>
            <label htmlFor="move-destination" className={`${labelClass} mt-4`}>
              Move to
            </label>
            <select
              id="move-destination"
              value={moveFolderId}
              onChange={(event) => setMoveFolderId(event.target.value)}
              required
              autoFocus
              className={`${fieldClass} mt-1.5 h-10`}
            >
              <option value="" disabled>
                Choose a repository
              </option>
              {moveDestinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.label}
                </option>
              ))}
            </select>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={bulkBusy} onClick={() => setMoveTarget(null)} className={buttonClass("secondary", "md")}>
                Cancel
              </button>
              <button type="submit" disabled={bulkBusy || !moveFolderId} className={buttonClass("primary", "md")}>
                {bulkBusy ? "Moving\u2026" : "Move"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          onClose={() => {
            if (deleting) return;
            setDeleteTarget(null);
            setDeleteConfirmText("");
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handlePermanentDelete();
            }}
            className="w-[min(480px,92vw)] rounded-xl border border-hairline bg-surface p-6 shadow-overlay"
          >
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              {deleteTarget.all
                ? "Empty Trash?"
                : deleteTarget.runs.length > 1
                  ? `Delete ${deleteTarget.runs.length} papers permanently?`
                  : "Delete this paper permanently?"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-body">
              {deleteTarget.all
                ? "Every paper in Trash is deleted for good: the PDFs and everything the analysis found. This cannot be undone."
                : deleteTarget.runs.length > 1
                  ? `The ${deleteTarget.runs.length} selected papers are deleted for good: their PDFs and everything the analysis found. This cannot be undone.`
                  : `"${titleOf(deleteTarget.runs[0])}" is deleted for good: the PDF and everything the analysis found. This cannot be undone.`}
            </p>
            {deleteTarget.all || deleteTarget.runs.length > 1 ? (
              <label className="mt-4 block text-sm text-body">
                Type <span className="font-mono font-medium text-ink">delete</span> to confirm
                <input
                  value={deleteConfirmText}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className={`${fieldClass} mt-1.5`}
                />
              </label>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmText("");
                }}
                className={buttonClass("secondary", "md")}
              >
                Keep
              </button>
              <button
                type="submit"
                disabled={
                  deleting ||
                  ((deleteTarget.all || deleteTarget.runs.length > 1) && deleteConfirmText.trim().toLowerCase() !== "delete")
                }
                className={buttonClass("danger", "md")}
              >
                {deleting ? "Deleting…" : deleteTarget.all ? "Empty Trash" : "Delete permanently"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

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
                ref={menuRef}
                className="fixed z-50"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={handleMenuKeyDown}
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
          <div className="h-[85vh] w-[min(1100px,92vw)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#030303]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#1f1f1f]">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {previewTitle}
              </p>
              <button
                type="button"
                onClick={() => setPreviewUrl(null)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
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

      {analysisRun ? (
        <PaperAnalysisExplorerModal
          key={analysisRun.id}
          run={analysisRun}
          initialTab={analysisTab}
          onTabChange={setAnalysisTab}
          detail={analysisDetail}
          loading={analysisLoading}
          error={analysisError}
          onClose={() => {
            setAnalysisRun(null);
            setAnalysisDetail(null);
            setAnalysisError(null);
          }}
          onResolvePreviewUrl={() => getRunOpenUrl(analysisRun)}
          onOpenInNewTab={() => handleOpenRunInNewTab(analysisRun)}
          onDownload={() => handleDownloadRun(analysisRun)}
          onDownloadReport={async () => {
            try {
              await handleDownloadAnalysisReport(analysisRun, analysisDetail);
              setMessage(`Downloaded the analysis report for "${titleOf(analysisRun)}".`);
              setError(null);
            } catch (downloadError) {
              setError(
                downloadError instanceof Error
                  ? downloadError.message
                  : "Failed to download the analysis report."
              );
            }
          }}
          onToggleFavorite={() => handleToggleFavorite(analysisRun)}
          onRename={() => handleRenameRun(analysisRun)}
          onCorrect={async (correction) => {
            const response = await fetch(`/api/workspace/library/${analysisRun.id}`, {
              method: "PATCH",
              headers: jsonRequestHeaders,
              body: JSON.stringify({ action: "correct", ...correction }),
            });
            const payload = (await response.json().catch(() => ({}))) as {
              paper?: { title: string; year: string };
              error?: string;
            };
            if (!response.ok || !payload.paper) {
              throw new Error(payload.error ?? "The correction could not be saved.");
            }
            setAnalysisDetail((current) =>
              current ? { ...current, title: payload.paper!.title, year: payload.paper!.year } : current
            );
            setMessage(`Saved the correction for "${payload.paper.title}".`);
          }}
          onOpenDashboard={() => {
            if (typeof window !== "undefined") {
              window.location.assign("/workspace/dashboard");
            }
          }}
        />
      ) : null}

      {false && analysisRun && analysisDetail ? (
        <Modal
          onClose={() => {
            setAnalysisRun(null);
            setAnalysisDetail(null);
            setAnalysisError(null);
          }}
        >
          <div className="max-h-[90vh] w-[min(980px,92vw)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1f1f1f] dark:bg-[#030303]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-[#1f1f1f] sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                  Pipeline analysis
                </p>
                <h2 className="mt-2 truncate text-xl font-semibold text-slate-900 dark:text-white">
                  {analysisDetail?.title || titleOf(analysisRun!)}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
                    {analysisDetail?.year || "Year unavailable"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
                    {analysisRun!.status === "succeeded" ? "Analysis ready" : getRunStatusLabel(analysisRun!)}
                  </span>
                  {analysisDetail?.available === false ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                      <ChartIcon className="h-3.5 w-3.5" />
                      <span>Not analyzed yet</span>
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAnalysisRun(null);
                  setAnalysisDetail(null);
                  setAnalysisError(null);
                }}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
              >
                Close
              </button>
            </div>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                  This panel shows the fixed pipeline analysis from the workspace nodes.
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                  It is separate from deep research, which is prompt-driven and should be treated as its own workflow.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await handlePreviewRun(analysisRun!);
                    } catch (previewError) {
                      setAnalysisError(
                        previewError instanceof Error
                          ? previewError.message
                          : "Failed to preview file."
                      );
                    }
                  }}
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-[#171717]"
                >
                  Preview PDF
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await handleOpenRunInNewTab(analysisRun!);
                    } catch (openError) {
                      setAnalysisError(
                        openError instanceof Error
                          ? openError.message
                          : "Failed to open file."
                      );
                    }
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
                >
                  Open in new tab
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await handleDownloadRun(analysisRun!);
                    } catch (downloadError) {
                      setAnalysisError(
                        downloadError instanceof Error
                          ? downloadError.message
                          : "Failed to download file."
                      );
                    }
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.location.assign("/workspace/dashboard");
                    }
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-[#1f1f1f] dark:text-[#d0d0d0]"
                >
                  Open dashboard charts
                </button>
              </div>

              {analysisLoading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 text-center dark:border-[#1f1f1f] dark:bg-[#050505]">
                  <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-400 border-t-transparent dark:border-[#8e8e8e]" />
                  <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                    Loading the extracted analysis for this paper...
                  </p>
                </div>
              ) : null}

              {!analysisLoading && analysisError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  {analysisError}
                </div>
              ) : null}

              {!analysisLoading && !analysisError && !analysisDetail?.available ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 dark:border-[#1f1f1f] dark:bg-[#050505]">
                  <p className="text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
                    Analysis details are not ready yet for this file.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                    The PDF is still available, but the extracted paper sections and chart-ready analysis
                    have not been written back for this run yet.
                  </p>
                </div>
              ) : null}

              {!analysisLoading && !analysisError && analysisDetail?.available ? (
                <>
                  {(analysisDetail!.tracksSingle.length > 0 ||
                    analysisDetail!.concepts.length > 0 ||
                    analysisDetail!.facets.length > 0 ||
                    analysisDetail!.tracksMulti.length > 0 ||
                    analysisDetail!.topics.length > 0) ? (
                    <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                      <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                          Primary track classification
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {analysisDetail!.tracksSingle.length > 0 ? (
                            analysisDetail!.tracksSingle.map((track) => (
                              <span
                                key={track}
                                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
                              >
                                {track}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                              No single-track label found.
                            </span>
                          )}
                        </div>
                      </article>

                      <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                          Cross-track classification
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {analysisDetail!.tracksMulti.length > 0 ? (
                            analysisDetail!.tracksMulti.map((track) => (
                              <span
                                key={track}
                                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
                              >
                                {track}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                              No multi-track label found.
                            </span>
                          )}
                        </div>
                      </article>

                      <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                          Concept clusters
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {analysisDetail!.concepts.length > 0 ? (
                            analysisDetail!.concepts.slice(0, 6).map((concept) => (
                              <span
                                key={concept.label}
                                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
                              >
                                {concept.label}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                              No concept clusters were stored.
                            </span>
                          )}
                        </div>
                      </article>

                      <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                          Analytical facets
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {analysisDetail!.facets.length > 0 ? (
                            analysisDetail!.facets.slice(0, 6).map((facet, index) => (
                              <span
                                key={`${facet.facetType}-${facet.label}-${index}`}
                                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
                              >
                                {facet.label}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                              No analytical facets were stored.
                            </span>
                          )}
                        </div>
                      </article>

                      <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                          Pipeline topics
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {analysisDetail!.topics.length > 0 ? (
                            analysisDetail!.topics.slice(0, 8).map((topic) => (
                              <span
                                key={topic}
                                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]"
                              >
                                {topic}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                              No topic labels found.
                            </span>
                          )}
                        </div>
                      </article>
                    </section>
                  ) : null}

                  {analysisDetail!.concepts.length > 0 ? (
                    <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                            Canonical concepts
                          </p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-[#a3a3a3]">
                            Grouped concept families produced by the node pipeline.
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]">
                          {analysisDetail!.concepts.length} concept
                          {analysisDetail!.concepts.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {analysisDetail!.concepts.slice(0, 8).map((concept) => (
                          <article
                            key={concept.label}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#030303]"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                                {concept.label}
                              </p>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
                                {concept.totalFrequency}
                              </span>
                            </div>
                            {concept.matchedTerms.length > 0 ? (
                              <p className="mt-2 text-xs uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                                {concept.matchedTerms.slice(0, 5).join(" • ")}
                              </p>
                            ) : null}
                            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                              {concept.firstEvidence ||
                                concept.evidenceSnippets[0] ||
                                "No concept evidence snippet was stored."}
                            </p>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {analysisDetail!.facets.length > 0 ? (
                    <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                            Analytical facets
                          </p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-[#a3a3a3]">
                            Higher-level labels extracted by the analysis nodes.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {analysisDetail!.facets.map((facet, index) => (
                          <article
                            key={`${facet.facetType}-${facet.label}-${index}`}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#030303]"
                          >
                            <p className="text-xs uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                              {facet.facetType.replace(/_/g, " ")}
                            </p>
                            <p className="mt-2 text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                              {facet.label}
                            </p>
                            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                              {facet.evidence || "No supporting facet evidence was stored."}
                            </p>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="grid gap-4 lg:grid-cols-2">
                    {[
                      ["Extracted abstract claims", analysisDetail!.abstract_claims],
                      ["Extracted methods", analysisDetail!.methods],
                      ["Extracted results", analysisDetail!.results],
                      ["Extracted conclusion", analysisDetail!.conclusion],
                    ].map(([label, content]) => (
                      <article
                        key={label}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]"
                      >
                        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                          {label}
                        </p>
                        <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-[#d0d0d0]">
                          {content?.trim() || "No extracted text was available for this section."}
                        </p>
                      </article>
                    ))}
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                          Grounded keywords
                        </p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-[#a3a3a3]">
                          Evidence-backed keyword rows that feed the dashboard and chart planner.
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#030303] dark:text-[#d0d0d0]">
                        {analysisDetail!.keywords.length} keyword
                        {analysisDetail!.keywords.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3">
                      {analysisDetail!.keywords.length > 0 ? (
                        analysisDetail!.keywords.slice(0, 10).map((keyword, index) => (
                          <article
                            key={`${keyword.keyword}-${index}`}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-4 dark:border-[#1f1f1f] dark:bg-[#030303]"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm font-medium text-slate-900 dark:text-[#f2f2f2]">
                                {keyword.keyword}
                              </p>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0]">
                                {keyword.frequency}
                              </span>
                            </div>
                            <p className="mt-2 text-xs uppercase tracking-normal text-slate-500 dark:text-[#8e8e8e]">
                              {keyword.topic || "Unclassified topic"}
                            </p>
                            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-[#a3a3a3]">
                              {keyword.evidence || "No supporting evidence snippet was stored."}
                            </p>
                          </article>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-[#a3a3a3]">
                          No grounded keyword rows were available for this paper.
                        </p>
                      )}
                    </div>
                  </section>
                </>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}

      {infoRun ? (
        <Modal onClose={() => setInfoRun(null)}>
          <div className="w-[min(560px,92vw)] rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-2xl dark:border-[#1f1f1f] dark:bg-[#030303]">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                File information
              </h2>
              <button
                type="button"
                onClick={() => setInfoRun(null)}
                aria-label="Close"
                className="-mr-2 -mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-mute transition-colors hover:bg-subtle hover:text-ink"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
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
