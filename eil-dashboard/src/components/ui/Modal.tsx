"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  zIndexClassName?: string;
}

export default function Modal({
  children,
  onClose,
  zIndexClassName = "z-50",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? dialog)?.focus();

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function handleTab(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (items.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleEscape);
    window.addEventListener("keydown", handleTab);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("keydown", handleTab);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 ${zIndexClassName} bg-[#071020]/65 backdrop-blur-[2px]`}
      onClick={onClose}
      role="presentation"
    >
      <div className="flex min-h-full items-center justify-center px-4 py-6 sm:px-6">
        <div
          ref={dialogRef}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className="min-w-0 max-w-full outline-none"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
