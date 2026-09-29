"use client";

import { useState } from "react";
import { reportFileName, reportMarkdown, type ExportCitation } from "@/lib/deep-research/export";

/** Copy and Download for a finished deep research report. */
export default function ReportActions({ content, citations, title }: { content: string; citations: ExportCitation[]; title: string }) {
  const [copied, setCopied] = useState(false);
  const markdown = () => reportMarkdown(content, citations);
  const buttonClass =
    "inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#262626] dark:text-[#d4d4d4] dark:hover:border-[#3a3a3a] dark:hover:text-white";
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Report actions">
      <button
        type="button"
        className={buttonClass}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(markdown());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2_000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy report"}
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          const url = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = reportFileName(title);
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        }}
      >
        Download (.md)
      </button>
    </div>
  );
}
