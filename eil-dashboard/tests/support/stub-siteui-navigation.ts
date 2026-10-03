/*
 * next/navigation for the site UI render tests, outside Next's app router.
 * The page's address is globalThis.__siteuiPathname with the query
 * globalThis.__siteuiSearch; every useSearchParams call is counted in
 * globalThis.__siteuiSearchParamsReads, and redirect() throws a
 * SiteUiRedirect carrying the address it was given.
 */
declare global {
  // eslint-disable-next-line no-var
  var __siteuiPathname: string | undefined;
  // eslint-disable-next-line no-var
  var __siteuiSearch: string | undefined;
  // eslint-disable-next-line no-var
  var __siteuiSearchParamsReads: number | undefined;
}

export class SiteUiRedirect extends Error {
  constructor(readonly href: string) {
    super(`redirect(${href})`);
  }
}

const router = {
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
};

export function usePathname() {
  return globalThis.__siteuiPathname ?? "/workspace/home";
}

export function useRouter() {
  return router;
}

export function useSearchParams() {
  globalThis.__siteuiSearchParamsReads = (globalThis.__siteuiSearchParamsReads ?? 0) + 1;
  return new URLSearchParams(globalThis.__siteuiSearch ?? "");
}

export function notFound(): never {
  throw new Error("notFound() in a render test");
}

export function redirect(href: string): never {
  throw new SiteUiRedirect(href);
}
