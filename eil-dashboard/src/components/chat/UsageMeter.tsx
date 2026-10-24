"use client";

// React in scope: the test runner compiles JSX the classic way.
import React, { useCallback, useEffect, useId, useRef, useState } from "react";

/*
 * Today's AI use against the account's daily allowance, beside the chat
 * composer (2026-10-09 review: "each account has a fixed amount of daily token
 * usage; show it near chat"). The button shows how much of today's allowance
 * is left; it opens one bar and when the allowance starts again - nothing else
 * (2026-10-24 review: one limit bar, no estimates). The other daily limits
 * are still enforced on the server, which says so when one is reached. It
 * reads /api/workspace/usage when the page opens, after each answer and when
 * the window regains focus.
 */

type Meter = { used: number; limit: number };
export type Usage = {
  exempt: boolean;
  tokens: Meter;
  messages: Meter;
  deepResearch: Meter;
  webSearches: Meter;
  resetsAt: string;
  account?: { monthUsd: number; budgetUsd: number; share: number } | null;
};

export function usageShare(meter: Meter): number {
  if (meter.limit <= 0) return 0;
  return Math.min(1, Math.max(0, meter.used / meter.limit));
}

/** The share of a limit still left, as a whole percent. */
export function percentLeft(meter: Meter): number {
  return Math.round((1 - usageShare(meter)) * 100);
}

function Ring({ share }: { share: number }) {
  const radius = 6;
  const length = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 -rotate-90" aria-hidden="true">
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${share * length} ${length}`}
      />
    </svg>
  );
}

/** What the meter opens to; drawn on its own for the tests. */
export function UsagePanel({ usage, resets }: { usage: Usage; resets: string }) {
  const share = usageShare(usage.tokens);
  const warn = share >= 0.9;
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">Today’s AI allowance</p>
        {usage.exempt ? null : (
          <span className={`text-xs font-medium tabular-nums ${warn ? "text-amber-700 dark:text-amber-300" : "text-slate-900 dark:text-white"}`}>
            {percentLeft(usage.tokens)}% left
          </span>
        )}
      </div>
      {usage.exempt ? (
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-[#b4b4b4]">This account has no daily limit.</p>
      ) : (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1f1f1f]" aria-hidden="true">
            <div className={`h-full rounded-full ${warn ? "bg-amber-500" : "bg-slate-700 dark:bg-[#d4d4d4]"}`} style={{ width: `${(1 - share) * 100}%` }} />
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-600 dark:text-[#a3a3a3]">Starts again at {resets}.</p>
        </>
      )}
    </>
  );
}

export default function UsageMeter({ requestHeaders, refreshKey }: { requestHeaders: Record<string, string>; refreshKey: unknown }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const signedIn = Boolean(requestHeaders.Authorization);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const response = await fetch("/api/workspace/usage", { headers: requestHeaders, cache: "no-store" });
      if (response.ok) setUsage((await response.json()) as Usage);
    } catch {
      // The meter is a convenience; the limits themselves are enforced on the server.
    }
  }, [requestHeaders, signedIn]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!usage) return null;
  const share = usageShare(usage.tokens);
  const left = percentLeft(usage.tokens);
  const resets = new Date(usage.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const label = usage.exempt ? "Today's use" : `${left}% of today's allowance left`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-usage`}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium transition-colors hover:bg-slate-100 dark:hover:bg-[#1a1a1a] ${
          !usage.exempt && share >= 0.9 ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-[#b4b4b4]"
        }`}
        title="Today's AI allowance"
      >
        <Ring share={usage.exempt ? 0 : 1 - share} />
        <span className="tabular-nums" aria-hidden="true">{usage.exempt ? "Usage" : `${left}% left`}</span>
        <span className="sr-only">{label}. Show today’s AI use.</span>
      </button>
      {open ? (
        <div
          id={`${id}-usage`}
          role="region"
          aria-label="Today's AI allowance"
          className="absolute bottom-11 right-0 z-30 w-64 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-lg dark:border-[#2a2a2a] dark:bg-[#0f0f0f]"
        >
          <UsagePanel usage={usage} resets={resets} />
        </div>
      ) : null}
    </div>
  );
}
