/*
 * src/components/workspace/WorkspaceShell.tsx for the workspace layout's
 * render test: in place of the shell, a frame that says whether a paper window
 * is there for it and its page (data-paper-viewer), around the page itself.
 */
import { createElement, type ReactNode } from "react";
import { usePaperViewer } from "../../src/components/workspace/PaperViewerProvider";

export default function ProbeShell({ children }: { children: ReactNode }) {
  return createElement("div", { "data-paper-viewer": usePaperViewer() ? "present" : "absent" }, children);
}
