/*
 * next/navigation for render tests, outside Next's app router: the page's
 * address is globalThis.__auditfixPathname with the query
 * globalThis.__auditfixSearch, and the router records where it was asked to
 * go in globalThis.__auditfixNavigations.
 */
declare global {
  // eslint-disable-next-line no-var
  var __auditfixPathname: string | undefined;
  // eslint-disable-next-line no-var
  var __auditfixSearch: string | undefined;
  // eslint-disable-next-line no-var
  var __auditfixNavigations: string[] | undefined;
}

const router = {
  push: (href: string) => void (globalThis.__auditfixNavigations ??= []).push(href),
  replace: (href: string) => void (globalThis.__auditfixNavigations ??= []).push(href),
  prefetch: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
};

export function usePathname() {
  return globalThis.__auditfixPathname ?? "/workspace/home";
}

export function useRouter() {
  return router;
}

export function useSearchParams() {
  return new URLSearchParams(globalThis.__auditfixSearch ?? "");
}

export function notFound(): never {
  throw new Error("notFound() in a render test");
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) in a render test`);
}
