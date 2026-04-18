"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  AttachmentIcon,
  CloseIcon,
  FileIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import type { IngestionRunRow } from "@/types/database";

type HistoryGroup = {
  id: string;
  label: string;
  runs: IngestionRunRow[];
};

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function getRunTimestamp(run: IngestionRunRow) {
  return run.completed_at ?? run.updated_at ?? run.created_at ?? null;
}

function getRunTimeMs(run: IngestionRunRow) {
  const timestamp = getRunTimestamp(run);
  if (!timestamp) return 0;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getHistoryStorageKey(userId?: string, projectId?: string | null) {
  return `papertrend.analysis-history.hidden.${userId ?? "anonymous"}.${
    projectId ?? "no-project"
  }`;
}

function readHiddenHistoryIds(storageKey: string) {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set<string>();
  }
}

function writeHiddenHistoryIds(storageKey: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)));
}

function statusTone(status: IngestionRunRow["status"]) {
  if (status === "succeeded") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300";
  }
  return "bg-slate-200 text-slate-700 dark:bg-[#2a2a2a] dark:text-[#d6d6d6]";
}

function groupLabelForDate(date: Date) {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfValue = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfValue.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return startOfValue.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function groupKeyForDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildHistoryGroups(runs: IngestionRunRow[]): HistoryGroup[] {
  const grouped = new Map<string, HistoryGroup>();

  for (const run of runs) {
    const timestamp = getRunTimestamp(run);
    const parsed = timestamp ? new Date(timestamp) : new Date(0);
    const safeDate = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
    const key = groupKeyForDate(safeDate);
    const existing = grouped.get(key);
    if (existing) {
      existing.runs.push(run);
      continue;
    }
    grouped.set(key, {
      id: key,
      label: safeDate.getTime() === 0 ? "Older" : groupLabelForDate(safeDate),
      runs: [run],
    });
  }

  return Array.from(grouped.values()).sort((left, right) => right.id.localeCompare(left.id));
}

function matchesSearch(run: IngestionRunRow, query: string) {
  if (!query) return true;
  const haystack = [
    run.display_name,
    run.source_filename,
    run.source_path,
    run.error_message,
    run.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function titleOf(run: IngestionRunRow) {
  return run.display_name || run.source_filename || run.id;
}

function subtitleOf(run: IngestionRunRow) {
  if (run.error_message?.trim()) return run.error_message;
  if (run.source_path?.trim()) return run.source_path;
  if (run.status === "succeeded") return "Analysis completed successfully.";
  if (run.status === "failed") return "Analysis failed.";
  return "Processing activity";
}

export default function WorkspaceLogsPage() {
  const { session } = useAuth();
  const { currentProject } = useWorkspaceProfile();
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const storageKey = useMemo(
    () => getHistoryStorageKey(session?.user?.id, currentProject?.id),
    [currentProject?.id, session?.user?.id]
  );

  useEffect(() => {
    setHiddenIds(readHiddenHistoryIds(storageKey));
  }, [storageKey]);

  useEffect(() => {
    async function load() {
      if (!currentProject?.id || !session?.access_token) {
        setRuns([]);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(
          `/api/workspace/library?projectId=${encodeURIComponent(
            currentProject.id
          )}&view=logs&includeTrashed=true`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );
        const payload = (await response.json()) as {
          runs?: IngestionRunRow[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load history.");
        }
        setRuns(
          [...(payload.runs ?? [])].sort(
            (left, right) => getRunTimeMs(right) - getRunTimeMs(left)
          )
        );
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load history.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [currentProject?.id, session?.access_token]);

  const visibleRuns = useMemo(
    () =>
      runs.filter((run) => !hiddenIds.has(run.id)).filter((run) => matchesSearch(run, normalizedQuery)),
    [hiddenIds, normalizedQuery, runs]
  );
  const groups = useMemo(() => buildHistoryGroups(visibleRuns), [visibleRuns]);
  const hiddenCount = hiddenIds.size;

  function dismissRun(runId: string) {
    setHiddenIds((current) => {
      const next = new Set(current);
      next.add(runId);
      writeHiddenHistoryIds(storageKey, next);
      return next;
    });
  }

  function resetHiddenHistory() {
    const next = new Set<string>();
    writeHiddenHistoryIds(storageKey, next);
    setHiddenIds(next);
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-slate-500 dark:border-[#2f2f2f] dark:text-[#a3a3a3]">
            Analysis History
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#f2f2f2]">
              History
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-[#a3a3a3]">
              Revisit previous analysis runs, jump back into the Library, and tidy up your
              history without removing the original files.
            </p>
          </div>
        </div>

        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={resetHiddenHistory}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:text-[#d2d2d2] dark:hover:border-[#3a3a3a] dark:hover:text-[#f2f2f2]"
          >
            Restore hidden items ({hiddenCount})
          </button>
        ) : null}
      </div>

      <section className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.32)] backdrop-blur dark:border-[#2f2f2f] dark:bg-[#171717]/88">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="relative block flex-1">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#7a7a7a]">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by file name, source path, status, or error"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white dark:border-[#2c2c2c] dark:bg-[#111111] dark:text-[#f2f2f2] dark:placeholder:text-[#7a7a7a] dark:focus:border-[#3a3a3a]"
            />
          </label>
          <p className="text-sm text-slate-500 dark:text-[#9c9c9c]">
            {visibleRuns.length} {visibleRuns.length === 1 ? "item" : "items"}
          </p>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-[#8f8f8f]">
          Removing an item here only hides it from history. It stays in the Library unless you
          delete it there.
        </p>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-[28px] border border-slate-200/80 bg-white/80 px-5 py-10 text-sm text-slate-500 dark:border-[#2f2f2f] dark:bg-[#171717]/85 dark:text-[#a3a3a3]">
          Loading analysis history...
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50/80 px-5 py-10 text-sm text-slate-500 dark:border-[#333333] dark:bg-[#171717]/80 dark:text-[#9c9c9c]">
          {runs.length === 0
            ? "No analysis history yet."
            : "No history items matched your search."}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.id} className="space-y-3">
              <div className="px-1 text-sm font-medium text-slate-600 dark:text-[#c8c8c8]">
                {group.label}
              </div>
              <div className="space-y-3">
                {group.runs.map((run) => {
                  const removedFromLibrary = Boolean(run.trashed_at);
                  return (
                    <article
                      key={run.id}
                      className="rounded-[24px] border border-slate-200/80 bg-white/85 px-4 py-4 shadow-[0_14px_40px_-32px_rgba(15,23,42,0.35)] transition hover:border-slate-300 dark:border-[#2f2f2f] dark:bg-[#171717]/92 dark:hover:border-[#3a3a3a]"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-center">
                        <div className="flex min-w-0 flex-1 items-start gap-4">
                          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-[#222222] dark:text-[#d6d6d6]">
                            <FileIcon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-base font-medium text-slate-900 dark:text-[#f2f2f2]">
                                {titleOf(run)}
                              </p>
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${statusTone(
                                  run.status
                                )}`}
                              >
                                {run.status}
                              </span>
                              {removedFromLibrary ? (
                                <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:bg-[#2a2a2a] dark:text-[#c8c8c8]">
                                  Removed from library
                                </span>
                              ) : null}
                            </div>
                            <p className="line-clamp-2 text-sm text-slate-500 dark:text-[#9c9c9c]">
                              {subtitleOf(run)}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-[#8f8f8f]">
                              <span>{formatDateTime(getRunTimestamp(run))}</span>
                              {run.source_filename ? <span>{run.source_filename}</span> : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 md:self-stretch">
                          {removedFromLibrary ? (
                            <span className="inline-flex items-center rounded-full px-3 py-2 text-sm text-slate-400 dark:text-[#767676]">
                              Library file unavailable
                            </span>
                          ) : (
                            <Link
                              href={`/workspace/library?runId=${encodeURIComponent(run.id)}`}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-[#2f2f2f] dark:text-[#d6d6d6] dark:hover:border-[#3a3a3a] dark:hover:text-[#f2f2f2]"
                            >
                              <AttachmentIcon className="h-4 w-4" />
                              View in library
                            </Link>
                          )}

                          <button
                            type="button"
                            onClick={() => dismissRun(run.id)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:text-[#8a8a8a] dark:hover:border-[#333333] dark:hover:bg-[#222222] dark:hover:text-[#f2f2f2]"
                            title="Remove from history only"
                            aria-label={`Remove ${titleOf(run)} from history`}
                          >
                            <CloseIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
