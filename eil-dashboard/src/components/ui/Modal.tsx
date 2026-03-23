"use client";

import { useEffect, type ReactNode } from "react";

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
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 ${zIndexClassName} bg-black/55`}
      onClick={onClose}
      role="presentation"
    >
      <div className="flex min-h-full items-center justify-center px-4 py-6 sm:px-6">
        <div onClick={(event) => event.stopPropagation()} role="presentation">
          {children}
        </div>
      </div>
    </div>
  );
}
