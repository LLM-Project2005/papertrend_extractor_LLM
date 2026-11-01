// React in scope: the test runner compiles JSX the classic way.
import React, { type ReactNode } from "react";
import { buttonClass } from "@/components/ui/controls";

/*
 * A message about something that went wrong (or needs attention), on the page
 * where it happened (2026-10-31, UI audit #7). It says what broke and, when
 * there is one, offers the way forward ("Try again") beside it, instead of a
 * console line or the browser's alert().
 */

const tones = {
  error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
} as const;

export default function Notice({
  tone = "error",
  children,
  actionLabel,
  onAction,
  onDismiss,
  className = "",
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
  /** The way forward, e.g. "Try again". */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm leading-6 ${tones[tone]}${className ? ` ${className}` : ""}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className={buttonClass("secondary", "sm")}>
          {actionLabel}
        </button>
      ) : null}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className={buttonClass("ghost", "sm")}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
