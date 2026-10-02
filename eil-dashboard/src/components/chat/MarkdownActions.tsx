"use client";

// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon } from "@/components/ui/Icons";

type CopyState = "idle" | "copied" | "failed";

export function downloadMarkdown(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Copy and Download (.md) for an answer, a report or a whole conversation
 * (docs/32, 4.2). The Markdown is built when asked for, not on every render.
 */
export default function MarkdownActions({
  markdown,
  fileName,
  copyLabel,
  label,
  compact = false,
}: {
  markdown: () => string;
  fileName: string;
  copyLabel: string;
  label: string;
  compact?: boolean;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    if (copy === "idle") return;
    const timer = window.setTimeout(() => setCopy("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [copy]);

  const buttonClass = compact
    ? "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/70 dark:text-[#a3a3a3] dark:hover:bg-[#141414] dark:hover:text-white"
    : "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#262626] dark:text-[#d4d4d4] dark:hover:border-[#3a3a3a] dark:hover:text-white";

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <button
        type="button"
        className={buttonClass}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(markdown());
            setCopy("copied");
          } catch {
            setCopy("failed");
          }
        }}
      >
        {copy === "copied" ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        <span aria-live="polite">{copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy" : copyLabel}</span>
      </button>
      <button type="button" className={buttonClass} onClick={() => downloadMarkdown(fileName, markdown())}>
        <DownloadIcon className="h-3.5 w-3.5" />
        Download (.md)
      </button>
    </div>
  );
}
