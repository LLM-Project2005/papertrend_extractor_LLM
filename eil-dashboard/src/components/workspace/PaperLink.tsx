"use client";

/*
 * A link to a paper. A plain click opens the paper window over the current
 * page; a middle click, Ctrl/Cmd-click or "Open in new tab" still follows the
 * real address to the Library, as a link should.
 */
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { usePaperViewer } from "@/components/workspace/PaperViewerProvider";
import { libraryPaperHref, parsePaperHref, type PaperTarget } from "@/lib/paper-address";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** The paper, or a Library address for one ("/workspace/library?paperId=…"). */
  paper: PaperTarget | string;
  children: ReactNode;
};

export function openInPlace(event: MouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export default function PaperLink({ paper, children, onClick, ...rest }: Props) {
  const viewer = usePaperViewer();
  const resolved = typeof paper === "string" ? parsePaperHref(paper) : paper;
  const href = typeof paper === "string" ? paper : libraryPaperHref(paper);
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !viewer || !resolved || !openInPlace(event)) return;
        event.preventDefault();
        viewer.openPaper(resolved);
      }}
    >
      {children}
    </a>
  );
}
