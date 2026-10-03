/*
 * src/components/ui/Modal.tsx for render tests. The real dialog draws
 * nothing until it has mounted in a browser and then moves into a portal on
 * document.body, so a server render of anything inside one is empty; here the
 * dialog is drawn in place, with the same role and name.
 */
import { createElement, type ReactNode } from "react";

export function hasOpenDialog(): boolean {
  return false;
}

export function useDialogLayer(): void {}

export default function Modal({ children, label }: { children: ReactNode; onClose?: () => void; zIndexClassName?: string; label?: string }) {
  return createElement("div", { role: "dialog", "aria-modal": "true", "aria-label": label }, children);
}
