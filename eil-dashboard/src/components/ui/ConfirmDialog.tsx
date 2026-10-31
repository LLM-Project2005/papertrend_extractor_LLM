"use client";

// React in scope: the test runner compiles JSX the classic way.
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import { buttonClass } from "@/components/ui/controls";

/*
 * The one way to ask "are you sure?" (2026-10-31, UI audit #22). The browser's
 * own confirm() looked like no other part of the product and stayed white in
 * dark mode; this is the Table's delete dialog, made shared.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ title: "Delete this repository?", confirmLabel: "Delete" }))) return;
 *   ...
 *   return <>{...}{confirmDialog}</>;
 *
 * Focus starts on Cancel, so Enter never deletes by accident.
 */

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for anything that removes or cannot be undone. */
  tone?: "danger" | "primary";
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  onCancel,
  onConfirm,
}: ConfirmOptions & { onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <Modal onClose={onCancel} zIndexClassName="z-[80]">
      <div className="w-[min(420px,92vw)] rounded-xl border border-hairline bg-surface p-5 shadow-overlay">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {body ? <div className="mt-2 text-sm leading-6 text-body">{body}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className={buttonClass("secondary", "sm")}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={buttonClass(tone, "sm")}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A promise-returning confirm, and the dialog to render while it waits. */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [asking, setAsking] = useState<ConfirmOptions | null>(null);
  const answer = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        answer.current = resolve;
        setAsking(options);
      }),
    []
  );
  const settle = (value: boolean) => {
    answer.current?.(value);
    answer.current = null;
    setAsking(null);
  };
  const dialog = asking ? <ConfirmDialog {...asking} onCancel={() => settle(false)} onConfirm={() => settle(true)} /> : null;
  return [confirm, dialog];
}
