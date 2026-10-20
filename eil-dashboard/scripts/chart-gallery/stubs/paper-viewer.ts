/** The gallery has no paper viewer: a paper link stays a plain link. */
export function usePaperViewer(): null {
  return null;
}

export { libraryPaperHref, parsePaperHref, type PaperTarget } from "@/lib/paper-address";
