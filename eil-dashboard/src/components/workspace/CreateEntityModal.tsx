"use client";

import type { FormEvent, ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import { CloseIcon } from "@/components/ui/Icons";
import { buttonClass, fieldClass, iconButtonClass, labelClass } from "@/components/ui/controls";

interface CreateEntityModalProps {
  open: boolean;
  title: string;
  description: string;
  value: string;
  fieldLabel: string;
  fieldPlaceholder: string;
  submitLabel: string;
  busyLabel: string;
  busy?: boolean;
  error?: string | null;
  children?: ReactNode;
  wide?: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export default function CreateEntityModal({
  open,
  title,
  description,
  value,
  fieldLabel,
  fieldPlaceholder,
  submitLabel,
  busyLabel,
  busy = false,
  error,
  children,
  wide = false,
  onValueChange,
  onClose,
  onSubmit,
}: CreateEntityModalProps) {
  if (!open) {
    return null;
  }

  return (
    <Modal onClose={onClose}>
      <form
        onSubmit={onSubmit}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-xl border border-hairline bg-surface text-ink shadow-overlay ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5 sm:px-7">
          {/* The "Create" line that sat above the title is gone: it only
              announced the heading, and read "Create" over "Rename file"
              (UI audit #14). Controls are the shared ones (#21, #22). */}
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-body">{description}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("lg", "-mr-2 -mt-1")}
            aria-label={`Close ${title}`}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-7">
          <label className="grid gap-1.5">
            <span className={labelClass}>{fieldLabel}</span>
            <input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={fieldPlaceholder}
              autoFocus
              className={fieldClass}
            />
          </label>

          {children}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hairline px-6 py-4 sm:px-7">
          <button type="button" onClick={onClose} className={buttonClass("secondary", "md")}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
