"use client";

/*
 * One paper window for the whole workspace.
 *
 * A paper named anywhere - a dashboard chart, an Adaptive insight, a chat
 * citation, a search result, Home - used to open the Library page, and the
 * reader had to find their way back. It now opens here, over the page they
 * were on, with everything the Library's window offers.
 *
 * The open paper lives in the address (?paper=<run>&paperTab=<tab>), so Back
 * closes it, Forward reopens it and a copied link opens it again. "paperTab"
 * rather than "tab", because the dashboard already keeps its own tab there.
 * The Library keeps its own window (it also updates its file list), so on the
 * Library page this defers to it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import dynamic from "next/dynamic";
import { PAPER_PARAM, PAPER_TAB_PARAM, libraryPaperHref, readPaperTab, type PaperExplorerTab, type PaperTarget } from "@/lib/paper-address";
import Modal from "@/components/ui/Modal";
import { buttonClass, fieldClass, labelClass } from "@/components/ui/controls";
import { SpinnerIcon } from "@/components/ui/Icons";
import { buildAnalysisMarkdown, sanitizeFilenamePart, triggerTextDownload } from "@/lib/paper-report";
import { getRunDisplayTitle } from "@/lib/ingestion-status";
import type { IngestionRunRow, RunAnalysisDetail } from "@/types/database";

// The paper window and its PDF reader load when a paper is opened; they were
// part of every workspace page (docs/32, 3.3).
const PaperAnalysisExplorerModal = dynamic(() => import("@/components/workspace/PaperAnalysisExplorerModal"), {
  ssr: false,
});

interface PaperViewer {
  openPaper: (target: PaperTarget) => void;
}

const PaperViewerContext = createContext<PaperViewer | null>(null);

/** The workspace's paper window, or null outside the workspace. */
export function usePaperViewer(): PaperViewer | null {
  return useContext(PaperViewerContext);
}

export { libraryPaperHref, parsePaperHref, type PaperTarget } from "@/lib/paper-address";

function isLibraryPath(pathname: string): boolean {
  return pathname.startsWith("/workspace/library");
}

export function PaperViewerProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<IngestionRunRow | null>(null);
  const [detail, setDetail] = useState<RunAnalysisDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PaperExplorerTab>("overview");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const requestRef = useRef(0);
  const pushedRef = useRef(false);
  /** The run shown or being opened, so the address sync does not open it twice. */
  const shownRunIdRef = useRef<string | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const authHeaders = useCallback((): Record<string, string> => (tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}), []);

  const load = useCallback(
    async (target: PaperTarget) => {
      const id = (requestRef.current += 1);
      setOpen(true);
      setRun(null);
      setDetail(null);
      setError(null);
      setLoading(true);
      setTab(target.tab ?? "overview");
      try {
        let runId = target.runId ?? null;
        if (!runId && target.paperId) {
          const resolved = await fetch(`/api/workspace/library/resolve?paperId=${encodeURIComponent(target.paperId)}`, { headers: authHeaders() });
          const payload = (await resolved.json().catch(() => ({}))) as { runId?: string; error?: string };
          if (!resolved.ok || !payload.runId) {
            throw new Error(resolved.status === 404 ? "This paper is not in your Library any more. It may be in Trash." : payload.error || "The paper could not be found.");
          }
          runId = payload.runId;
        }
        if (!runId) throw new Error("The paper could not be found.");
        shownRunIdRef.current = runId;
        const response = await fetch(`/api/workspace/library/${encodeURIComponent(runId)}/analysis`, { headers: authHeaders() });
        const payload = (await response.json().catch(() => ({}))) as { run?: IngestionRunRow; analysis?: RunAnalysisDetail; error?: string };
        if (id !== requestRef.current) return null;
        if (!response.ok || !payload.run) throw new Error(payload.error || "The paper could not be opened.");
        setRun(payload.run);
        setDetail(payload.analysis ?? null);
        return payload.run.id;
      } catch (loadError) {
        if (id === requestRef.current) setError(loadError instanceof Error ? loadError.message : "The paper could not be opened.");
        return null;
      } finally {
        if (id === requestRef.current) setLoading(false);
      }
    },
    [authHeaders]
  );

  const writeAddress = useCallback((runId: string | null, nextTab: PaperExplorerTab, mode: "push" | "replace") => {
    const url = new URL(window.location.href);
    if (runId) {
      url.searchParams.set(PAPER_PARAM, runId);
      if (nextTab !== "overview") url.searchParams.set(PAPER_TAB_PARAM, nextTab);
      else url.searchParams.delete(PAPER_TAB_PARAM);
    } else {
      url.searchParams.delete(PAPER_PARAM);
      url.searchParams.delete(PAPER_TAB_PARAM);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    if (mode === "push") window.history.pushState(window.history.state, "", next);
    else window.history.replaceState(window.history.state, "", next);
  }, []);

  const openPaper = useCallback(
    (target: PaperTarget) => {
      if (!target.runId && !target.paperId) return;
      // The Library has its own window and file list; send the paper there.
      if (isLibraryPath(window.location.pathname)) {
        router.push(libraryPaperHref(target));
        return;
      }
      void load(target).then((runId) => {
        if (!runId) return;
        writeAddress(runId, target.tab ?? "overview", pushedRef.current ? "replace" : "push");
        pushedRef.current = true;
      });
    },
    [load, router, writeAddress]
  );

  const close = useCallback(() => {
    requestRef.current += 1;
    shownRunIdRef.current = null;
    setOpen(false);
    setRun(null);
    setDetail(null);
    setError(null);
    setRenaming(false);
    if (pushedRef.current) {
      // Step back out of the entry that opening added, so Back does not reopen it.
      pushedRef.current = false;
      window.history.back();
    } else {
      writeAddress(null, "overview", "replace");
    }
  }, [writeAddress]);

  // A link with ?paper= opens the window (reload, a copied link), and Back and
  // Forward open and close it.
  useEffect(() => {
    if (isLibraryPath(pathname)) return;
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      const runId = params.get(PAPER_PARAM);
      if (!runId) {
        pushedRef.current = false;
        shownRunIdRef.current = null;
        requestRef.current += 1;
        setOpen(false);
        setRun(null);
        setDetail(null);
        setError(null);
        return;
      }
      const nextTab = readPaperTab(params.get(PAPER_TAB_PARAM));
      if (shownRunIdRef.current !== runId) {
        shownRunIdRef.current = runId;
        void load({ runId, tab: nextTab });
      } else {
        setTab(nextTab);
      }
    };
    if (token) sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [load, pathname, token]);

  const viewer = useMemo<PaperViewer>(() => ({ openPaper }), [openPaper]);

  async function postRun(action: "open") {
    if (!run) return null;
    const response = await fetch(`/api/workspace/library/${encodeURIComponent(run.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ action }),
    });
    const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "The file could not be opened.");
    return payload.url ?? null;
  }

  async function patchRun(body: Record<string, unknown>) {
    if (!run) return null;
    const response = await fetch(`/api/workspace/library/${encodeURIComponent(run.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { run?: IngestionRunRow; paper?: { title: string; year: string }; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "The change could not be saved.");
    return payload;
  }

  const fileName = run ? run.display_name || run.source_filename || run.id : "";

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = renameDraft.trim();
    if (!value) {
      setRenameError("Enter a name.");
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      const payload = await patchRun({ action: "rename", value });
      if (payload?.run) setRun(payload.run);
      setRenaming(false);
    } catch (renameFailure) {
      setRenameError(renameFailure instanceof Error ? renameFailure.message : "The name could not be saved.");
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <PaperViewerContext.Provider value={viewer}>
      {children}
      {open && !run ? (
        <Modal onClose={close}>
          <div className="w-[min(420px,92vw)] rounded-xl border border-hairline bg-surface px-6 py-6 shadow-overlay" role="status" aria-live="polite">
            {error ? (
              <>
                <p className="text-sm font-medium text-ink">The paper could not be opened</p>
                <p className="mt-1.5 text-sm leading-6 text-body">{error}</p>
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={close} className={buttonClass("secondary", "sm")}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <p className="flex items-center gap-2.5 text-sm text-body">
                <SpinnerIcon className="h-4 w-4" />
                Opening the paper…
              </p>
            )}
          </div>
        </Modal>
      ) : null}
      {open && run ? (
        <PaperAnalysisExplorerModal
          key={run.id}
          run={run}
          initialTab={tab}
          onTabChange={(next) => {
            setTab(next);
            writeAddress(run.id, next, "replace");
          }}
          detail={detail}
          loading={loading}
          error={error}
          onClose={close}
          onResolvePreviewUrl={() => postRun("open")}
          onOpenInNewTab={async () => {
            const opened = window.open("", "_blank");
            const url = await postRun("open").catch(() => null);
            if (opened && url) {
              opened.opener = null;
              opened.location.href = url;
            } else {
              opened?.close();
            }
          }}
          onDownload={async () => {
            const url = await postRun("open");
            if (!url) return;
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = fileName;
            anchor.rel = "noopener noreferrer";
            anchor.target = "_blank";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          }}
          onDownloadReport={async () => {
            if (!detail?.available) throw new Error("The analysis for this paper is not ready yet.");
            const base = sanitizeFilenamePart(detail.title || getRunDisplayTitle(run, run.id));
            triggerTextDownload(`${base || "analysis-report"} - pipeline-analysis.md`, buildAnalysisMarkdown(run, detail), "text/markdown;charset=utf-8");
          }}
          onToggleFavorite={async () => {
            const payload = await patchRun({ action: "favorite", value: !run.is_favorite });
            if (payload?.run) setRun(payload.run);
          }}
          onRename={async () => {
            setRenameDraft(fileName);
            setRenameError(null);
            setRenaming(true);
          }}
          onCorrect={async (correction) => {
            const payload = await patchRun({ action: "correct", ...correction });
            const paper = payload?.paper;
            if (!paper) throw new Error("The correction could not be saved.");
            setDetail((current) => (current ? { ...current, title: paper.title, year: paper.year } : current));
          }}
          onOpenDashboard={() => {
            close();
            router.push("/workspace/dashboard");
          }}
        />
      ) : null}
      {renaming && run ? (
        <Modal onClose={() => setRenaming(false)}>
          <form onSubmit={(event) => void submitRename(event)} className="w-[min(440px,92vw)] rounded-xl border border-hairline bg-surface px-6 py-6 shadow-overlay">
            <h2 className="text-base font-semibold text-ink">Rename file</h2>
            <label htmlFor="paper-viewer-rename" className={`${labelClass} mt-4 block`}>
              File name
            </label>
            <input
              id="paper-viewer-rename"
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              maxLength={240}
              className={`${fieldClass} mt-1.5 h-10`}
            />
            {renameError ? (
              <p className="mt-2 text-[13px] text-red-700 dark:text-red-300" role="alert">
                {renameError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(false)} className={buttonClass("secondary", "sm")}>
                Cancel
              </button>
              <button type="submit" disabled={renameBusy} className={buttonClass("primary", "sm")}>
                {renameBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </PaperViewerContext.Provider>
  );
}
