"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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

/** True while any dialog layer is open: page-wide shortcuts ("/") wait. */
export function hasOpenDialog(): boolean {
  return openModals.length > 0;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes `container` a dialog layer while `active` (docs/32, 2.9): it joins the
 * stack of open layers, takes focus and keeps Tab inside, closes on Escape
 * only when it is the top layer, stops the page behind from scrolling, and
 * gives focus back to where it was when it goes.
 *
 * An Escape something inside already handled - an open select or menu calls
 * preventDefault - is left alone, so that Escape closes the menu and not the
 * dialog around it. Hand-built overlays (the mobile navigation, the mobile
 * filters, the full research report) use this as the Modal does.
 */
export function useDialogLayer(active: boolean, container: RefObject<HTMLElement | null>, onClose: () => void): void {
  const layerId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    openModals.push(layerId);

    function handleKeyDown(event: KeyboardEvent) {
      if (openModals[openModals.length - 1] !== layerId || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = Array.from(container.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.offsetParent !== null
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      // Focus that has left the layer (a clicked gap, a control that
      // disappeared) is brought back rather than let loose on the page behind.
      if (!container.current?.contains(document.activeElement)) {
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

    container.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      const index = openModals.lastIndexOf(layerId);
      if (index !== -1) openModals.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [active, container, layerId]);
}

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Name the dialog after its own heading, so it is announced as "Add
  // papers, dialog" rather than just "dialog".
  useEffect(() => {
    const container = containerRef.current;
    if (!mounted || !container || label || container.hasAttribute("aria-labelledby")) return;
    const heading = container.querySelector<HTMLElement>("h1, h2, h3");
    if (heading) {
      if (!heading.id) heading.id = `${modalId.replace(/:/g, "")}-title`;
      container.setAttribute("aria-labelledby", heading.id);
    }
  }, [mounted, modalId, label]);

  useDialogLayer(mounted, containerRef, onClose);

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
