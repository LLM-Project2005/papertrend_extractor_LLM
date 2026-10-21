"use client";

/*
 * Keeps the browser tab's title (src/lib/tab-title.ts): the page Next.js
 * named, the repository a page registers with useTabTitleRepository, and the
 * progress of the papers being analysed. A reader who asked for it also gets
 * a browser notification when a batch finishes while they are elsewhere.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BellIcon } from "@/components/ui/Icons";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  NOTIFY_STORAGE_KEY,
  analysisInProgress,
  composeTabTitle,
  countRuns,
  doneNotice,
  doneStatus,
  progressStatus,
} from "@/lib/tab-title";
import type { IngestionRunRow } from "@/types/database";

/** How long "✓ 5 papers ready" stays once the tab is in view. */
const DONE_SEEN_MS = 8000;

// The repository of the page on screen, if the page is about one.
let pageRepository: string | null = null;
const listeners = new Set<() => void>();
function setPageRepository(name: string | null) {
  if (pageRepository === name) return;
  pageRepository = name;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Names the repository in the tab's title while this page is open: for pages
 * about one repository (Home, the Dashboard, a repository in the Library).
 */
export function useTabTitleRepository(name: string | null | undefined): void {
  const value = name?.trim() || null;
  useEffect(() => {
    setPageRepository(value);
    return () => setPageRepository(null);
  }, [value]);
}

function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function readNotifyChoice(): boolean {
  try {
    return window.localStorage.getItem(NOTIFY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNotifyChoice(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(NOTIFY_STORAGE_KEY, "1");
    else window.localStorage.removeItem(NOTIFY_STORAGE_KEY);
  } catch {
    // Storage off: the choice lasts for this page only.
  }
}

/** The repository a batch belongs to, when all its papers name the same one. */
function batchProjectId(runs: IngestionRunRow[]): string | null {
  const ids = new Set(runs.map((run) => run.input_payload?.project_id).filter((id): id is string => typeof id === "string" && Boolean(id)));
  return ids.size === 1 ? [...ids][0] : null;
}

export default function WorkspaceTabTitle({ runs }: { runs: IngestionRunRow[] }) {
  const repository = useSyncExternalStore(subscribe, () => pageRepository, () => null);
  const { allProjects, projects } = useWorkspaceProfile();
  const counts = countRuns(runs);
  const active = analysisInProgress(counts);
  const [doneShown, setDoneShown] = useState(false);
  const wasActive = useRef(false);

  // A batch that finishes during this visit is announced; one that had
  // finished before the page opened is not.
  const batchProject = batchProjectId(runs);
  const batchName = [...allProjects, ...projects].find((project) => project.id === batchProject)?.name ?? null;
  const noticeRef = useRef<{ title: string; body: string } | null>(null);
  noticeRef.current = doneNotice(counts, batchName);
  useEffect(() => {
    if (active) {
      wasActive.current = true;
      setDoneShown(false);
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    if (counts.total === 0) return;
    setDoneShown(true);
    const notice = noticeRef.current;
    if (!notice || !notificationsSupported() || Notification.permission !== "granted" || !readNotifyChoice()) return;
    // Only for a reader looking elsewhere; the tray says it on screen.
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    try {
      const notification = new Notification(notice.title, { body: notice.body, icon: "/brand/papertrend-mark.svg", tag: "papertrend-analysis" });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Some browsers allow notifications only from a service worker.
    }
  }, [active, counts.total]);

  // "Seen": the tab has been in view for a few seconds.
  useEffect(() => {
    if (!doneShown) return;
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") timer = window.setTimeout(() => setDoneShown(false), DONE_SEEN_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [doneShown]);

  const status = progressStatus(counts) ?? (doneShown ? doneStatus(counts) : null);

  // Next.js writes each page's title into <title>; this adds to it, and adds
  // again whenever a navigation writes a new one.
  useEffect(() => {
    let base = document.title;
    let composed = "";
    const apply = () => {
      if (document.title !== composed) base = document.title;
      composed = composeTabTitle(base, { status, repository });
      if (document.title !== composed) document.title = composed;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title === composed) document.title = base;
    };
  }, [status, repository]);

  return null;
}

/**
 * "Notify me when done", beside the analysis progress: asks the browser once,
 * then remembers the choice in this browser.
 */
export function NotifyWhenDoneToggle({ className = "" }: { className?: string }) {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "blocked">("unsupported");
  useEffect(() => {
    if (!notificationsSupported()) return;
    if (Notification.permission === "denied") setState("blocked");
    else setState(Notification.permission === "granted" && readNotifyChoice() ? "on" : "off");
  }, []);
  if (state === "unsupported") return null;
  if (state === "blocked") {
    return <p className={`text-xs text-mute ${className}`}>Notifications are blocked for this site in your browser.</p>;
  }
  const on = state === "on";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={async () => {
        if (on) {
          writeNotifyChoice(false);
          setState("off");
          return;
        }
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission().catch(() => "default" as const);
        if (permission === "granted") {
          writeNotifyChoice(true);
          setState("on");
        } else {
          setState(permission === "denied" ? "blocked" : "off");
        }
      }}
      title={on ? "You will get a notification when these papers are done. Click to turn it off." : "Get a browser notification when these papers are done"}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
        on ? "bg-subtle text-ink" : "text-body hover:bg-subtle hover:text-ink"
      } ${className}`}
    >
      <BellIcon className="h-3.5 w-3.5" weight={on ? "fill" : "regular"} />
      <span>{on ? "Notifying you" : "Notify me when done"}</span>
    </button>
  );
}
