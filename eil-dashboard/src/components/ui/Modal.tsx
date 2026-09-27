"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  zIndexClassName?: string;
  /** A name for a dialog with no visible heading. Otherwise its first heading names it. */
  label?: string;
}

/*
 * Open dialogs, innermost last. A dialog opened from inside another (Rename
 * over the paper explorer) handles Escape and Tab alone, so one Escape closes
 * only the dialog on top.
 */
const openModals: string[] = [];

// Layout timing on the client (the copy must be taken before the DOM goes);
// the plain effect on the server, where layout effects only warn.
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function Modal({
  children,
  onClose,
  zIndexClassName = "z-50",
  label,
}: ModalProps) {
  const modalId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    openModals.push(modalId);

    // Name the dialog after its own heading, so it is announced as "Add
    // papers, dialog" rather than just "dialog".
    const container = containerRef.current;
    if (container && !label && !container.hasAttribute("aria-labelledby")) {
      const heading = container.querySelector<HTMLElement>("h1, h2, h3");
      if (heading) {
        if (!heading.id) heading.id = `${modalId.replace(/:/g, "")}-title`;
        container.setAttribute("aria-labelledby", heading.id);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (openModals[openModals.length - 1] !== modalId) {
        return;
      }
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.offsetParent !== null);
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      // Focus that has left the dialog (a clicked gap, a control that
      // disappeared) is brought back rather than let loose on the page behind.
      if (!containerRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const focusable = containerRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus({ preventScroll: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      const index = openModals.lastIndexOf(modalId);
      if (index !== -1) openModals.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [mounted, modalId, label]);

  // Closing animates too. The parent removes a dialog outright, so as it goes
  // a still copy is left in its place for a moment and faded out: inert,
  // hidden from assistive technology, with its frames and videos blanked so
  // nothing reloads. Under reduced motion the dialog just disappears.
  useClientLayoutEffect(() => {
    if (!mounted) return;
    const node = backdropRef.current;
    return () => {
      if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const ghost = node.cloneNode(true) as HTMLElement;
      const originals = node.querySelectorAll<HTMLElement>("iframe, video");
      ghost.querySelectorAll<HTMLElement>("iframe, video").forEach((element, index) => {
        const blank = document.createElement("div");
        const source = originals[index];
        blank.style.width = `${source?.offsetWidth ?? 0}px`;
        blank.style.height = `${source?.offsetHeight ?? 0}px`;
        blank.style.background = "rgb(var(--subtle))";
        element.replaceWith(blank);
      });
      ghost.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      ghost.classList.remove("modal-backdrop");
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("inert", "");
      ghost.style.pointerEvents = "none";
      const panel = ghost.querySelector<HTMLElement>(".modal-panel");
      panel?.classList.remove("modal-panel");
      document.body.appendChild(ghost);
      ghost.scrollTop = node.scrollTop;
      const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170, easing: "cubic-bezier(0.7, 0, 0.84, 0)" });
      panel?.animate(
        [
          { transform: "none" },
          { transform: "translateY(8px) scale(0.985)" },
        ],
        { duration: 170, easing: "cubic-bezier(0.7, 0, 0.84, 0)" }
      );
      fade.onfinish = () => ghost.remove();
      fade.oncancel = () => ghost.remove();
    };
  }, [mounted]);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      ref={backdropRef}
      className={`modal-backdrop fixed inset-0 ${zIndexClassName} overflow-y-auto overscroll-contain bg-black/65 backdrop-blur-[2px]`}
      onClick={onClose}
      role="presentation"
    >
      <div className="flex min-h-full items-center justify-center px-3 py-3 sm:px-6 sm:py-6">
        <div
          ref={containerRef}
          className="modal-panel min-w-0"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={label}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
