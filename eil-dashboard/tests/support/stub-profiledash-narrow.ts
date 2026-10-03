/*
 * src/lib/use-narrow.ts for render tests. The real hook reads a media query
 * after mounting, which a server render never does; here a test says whether
 * the screen is a phone with globalThis.__profiledashNarrow. labelColumn is
 * the real one.
 */
export { labelColumn } from "../../src/lib/use-narrow";

declare global {
  // eslint-disable-next-line no-var
  var __profiledashNarrow: boolean | undefined;
}

export function useIsNarrow(_maxWidth = 640): boolean {
  return Boolean(globalThis.__profiledashNarrow);
}
