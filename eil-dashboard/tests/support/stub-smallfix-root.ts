/*
 * A React root without a document, for tests that need what a server render
 * never does: effects, state changes, and handlers called after a render.
 * React's own client renderer runs, against a container that stands in for a
 * DOM element, so whatever is mounted must draw no elements itself. A
 * component whose elements a test only reads is mounted through `captured`:
 * its hooks run, and the tree it returns is kept as elements, unrendered, for
 * the test to read props from and call handlers on.
 *
 * `window` and `document` get the few members React and the app's hooks
 * touch; nothing here is imported by the application.
 */
import React, { createElement, isValidElement, type ReactElement, type ReactNode } from "react";

type Globals = { window?: unknown; document?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };

const noop = () => undefined;
const events = { addEventListener: noop, removeEventListener: noop };

/** A browser's storage, in memory. */
class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

function installGlobals() {
  const globals = globalThis as Globals;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  // The app's components use the classic JSX transform's global React.
  globals.React ??= React;
  // A body a portal can be made for; what is portalled stays an element, as everything here does.
  globals.document ??= { ...events, visibilityState: "visible", body: { nodeType: 1, nodeName: "BODY", style: {} }, activeElement: null };
  globals.window ??= {
    ...events,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (handle: ReturnType<typeof setInterval>) => clearInterval(handle),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    location: { href: "https://papertrend.test/workspace/home", origin: "https://papertrend.test", pathname: "/workspace/home", hash: "", search: "" },
    history: { pushState: noop, replaceState: noop, back: noop },
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    navigator: { userAgent: "node" },
    innerWidth: 1280,
    innerHeight: 800,
    document: undefined,
  };
}

function container() {
  const view = { document: { activeElement: null }, HTMLIFrameElement: class {} };
  return { ...events, nodeType: 1, nodeName: "DIV", tagName: "DIV", textContent: "", ownerDocument: { ...events, nodeType: 9, defaultView: view } };
}

/** A mounted root: render, act and unmount, each waiting for React to finish. */
export async function headlessRoot() {
  installGlobals();
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container() as unknown as Element);
  const act = async (work: () => unknown = () => undefined) => {
    await React.act(async () => {
      await work();
    });
  };
  return {
    act,
    render: (element: ReactElement) => act(() => root.render(element)),
    unmount: () => act(() => root.unmount()),
  };
}

/**
 * An element that calls `component` with `props` as part of its own render, so
 * the component's hooks and effects run, and hands each tree it returns to
 * `keep` instead of drawing it.
 */
export function captured<P>(component: (props: P) => ReactNode, props: P, keep: (tree: ReactNode) => void): ReactElement {
  return createElement(Captured as (props: CapturedProps<P>) => null, { component, props, keep });
}

interface CapturedProps<P> {
  component: (props: P) => ReactNode;
  props: P;
  keep: (tree: ReactNode) => void;
}

function Captured<P>({ component, props, keep }: CapturedProps<P>) {
  keep(component(props));
  return null;
}

/** What createPortal returns: not an element, but its children are part of the tree. */
function isPortal(node: unknown): node is { children: ReactNode } {
  return Boolean(node) && typeof node === "object" && (node as { $$typeof?: symbol }).$$typeof === Symbol.for("react.portal");
}

/** Every element in a tree, depth first, through the children of elements already made. */
export function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (isPortal(node)) return elementsOf(node.children);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elementsOf(element.props.children as ReactNode)];
}

/** The text directly inside an element and its element children. */
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isPortal(node)) return textOf(node.children);
  if (!isValidElement(node)) return "";
  return textOf((node.props as { children?: ReactNode }).children);
}
