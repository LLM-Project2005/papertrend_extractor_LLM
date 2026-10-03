/*
 * A stand-in for React's renderer, for tests that need what a server render
 * never does: effects, state changes and the handlers a press calls. `mount`
 * calls one component with React's own hooks pointed here, runs its effects at
 * once (against the document and window of stub-uia11y-dom.ts), and calls it
 * again whenever its state changes. Its children stay elements, unrendered, so
 * a test reads the props a component gives them and calls their handlers.
 *
 * Only the component passed to `mount` runs here; everything else in the
 * process uses React as it is.
 */
import React, { isValidElement, type Context, type ReactNode } from "react";

interface Dispatcher {
  [hook: string]: unknown;
}

// React 19's hook dispatcher slot. It is internal: a React upgrade that moves
// it fails here, loudly, rather than letting these tests pass without running.
// The sturdier alternative is jsdom with @testing-library/react (docs/32).
const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: Dispatcher | null } })
  .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: Dispatcher | null };
if (!internals || !("H" in internals)) {
  throw new Error("React's hook dispatcher has moved (React upgraded?): update tests/support/stub-uia11y-hooks.ts, or move these tests to jsdom.");
}

type Cleanup = void | (() => void);

interface EffectSlot {
  kind: "effect";
  layout: boolean;
  deps: readonly unknown[] | undefined;
  create: (() => Cleanup) | null;
  cleanup: Cleanup;
  ran: boolean;
}

interface Mounted<P> {
  /** What the component returned last. */
  readonly tree: ReactNode;
  /** How many times it has been called. */
  readonly renders: number;
  rerender(props: P): void;
  /** Runs every cleanup, as leaving the page does. */
  unmount(): void;
}

let ids = 0;

function depsChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (!previous || !next) return true;
  return previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
}

/**
 * Mounts `component` with `props`. `contexts` gives the value a context has
 * here, where no provider is rendered above it; others read their default.
 */
export function mount<P>(component: (props: P) => ReactNode, props: P, contexts: Map<Context<unknown>, unknown> = new Map()): Mounted<P> {
  const slots: unknown[] = [];
  let index = 0;
  let tree: ReactNode = null;
  let renders = 0;
  let busy = false;
  let dirty = false;
  let unmounted = false;
  let currentProps = props;

  function slot<T>(make: () => T): T {
    if (index >= slots.length) slots.push(make());
    return slots[index++] as T;
  }

  function effect(layout: boolean, create: () => Cleanup, deps?: readonly unknown[]) {
    const state = slot<EffectSlot>(() => ({ kind: "effect", layout, deps: undefined, create: null, cleanup: undefined, ran: false }));
    if (!state.ran || depsChanged(state.deps, deps)) {
      state.create = create;
      state.deps = deps;
      state.ran = true;
    }
  }

  function readContext(context: Context<unknown>) {
    return contexts.has(context) ? contexts.get(context) : (context as unknown as { _currentValue: unknown })._currentValue;
  }

  function memo<T>(create: () => T, deps: readonly unknown[] | undefined): T {
    const state = slot<{ value?: T; deps?: readonly unknown[]; set: boolean }>(() => ({ set: false }));
    if (!state.set || depsChanged(state.deps, deps)) {
      state.value = create();
      state.deps = deps;
      state.set = true;
    }
    return state.value as T;
  }

  function stateHook<S>(initial: S | (() => S)) {
    const state = slot(() => {
      const holder: { value: S; set: (next: S | ((current: S) => S)) => void } = {
        value: typeof initial === "function" ? (initial as () => S)() : initial,
        set: (next) => {
          if (unmounted) return;
          const value = typeof next === "function" ? (next as (current: S) => S)(holder.value) : next;
          if (Object.is(value, holder.value)) return;
          holder.value = value;
          flush();
        },
      };
      return holder;
    });
    return [state.value, state.set] as const;
  }

  const dispatcher: Dispatcher = {
    useState: stateHook,
    useReducer<S, A>(reducer: (state: S, action: A) => S, initialArg: S, init?: (arg: S) => S) {
      const [value, set] = stateHook(() => (init ? init(initialArg) : initialArg));
      const dispatch = memo(() => (action: A) => set((current) => reducer(current, action)), []);
      return [value, dispatch];
    },
    useRef: <T>(initial: T) => slot(() => ({ current: initial })),
    useMemo: memo,
    useCallback: <T>(callback: T, deps: readonly unknown[]) => memo(() => callback, deps),
    useEffect: (create: () => Cleanup, deps?: readonly unknown[]) => effect(false, create, deps),
    useLayoutEffect: (create: () => Cleanup, deps?: readonly unknown[]) => effect(true, create, deps),
    useInsertionEffect: (create: () => Cleanup, deps?: readonly unknown[]) => effect(true, create, deps),
    useContext: readContext,
    use(usable: unknown) {
      if (usable && typeof usable === "object" && "Provider" in usable) return readContext(usable as Context<unknown>);
      throw new Error("use() of a promise is not supported here");
    },
    useId: () => slot(() => `«t${(ids += 1)}»`),
    useDeferredValue: <T>(value: T) => value,
    useTransition: () => [false, (callback: () => void) => callback()],
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useImperativeHandle: () => undefined,
    useDebugValue: () => undefined,
  };

  function render() {
    index = 0;
    renders += 1;
    const previous = internals.H;
    internals.H = dispatcher;
    try {
      tree = component(currentProps);
    } finally {
      internals.H = previous;
    }
  }

  function runEffects() {
    const effects = slots.filter((entry): entry is EffectSlot => (entry as EffectSlot)?.kind === "effect");
    for (const layout of [true, false]) {
      for (const entry of effects) {
        if (entry.layout !== layout || !entry.create) continue;
        const create = entry.create;
        entry.create = null;
        if (typeof entry.cleanup === "function") entry.cleanup();
        entry.cleanup = create();
      }
    }
  }

  function flush() {
    if (busy) {
      dirty = true;
      return;
    }
    busy = true;
    try {
      let rounds = 0;
      do {
        dirty = false;
        if ((rounds += 1) > 50) throw new Error("the component kept changing its own state");
        render();
        runEffects();
      } while (dirty && !unmounted);
    } finally {
      busy = false;
    }
  }

  flush();
  return {
    get tree() {
      return tree;
    },
    get renders() {
      return renders;
    },
    rerender(next: P) {
      currentProps = next;
      flush();
    },
    unmount() {
      unmounted = true;
      for (const entry of slots) {
        if ((entry as EffectSlot)?.kind === "effect" && typeof (entry as EffectSlot).cleanup === "function") {
          ((entry as EffectSlot).cleanup as () => void)();
          (entry as EffectSlot).cleanup = undefined;
        }
      }
    },
  };
}

type AnyProps = Record<string, unknown> & { children?: ReactNode };
export interface FoundElement {
  type: unknown;
  props: AnyProps;
}

const PORTAL = Symbol.for("react.portal");

/** Every element in a tree, depth first, portals and fragments included. */
export function elements(node: ReactNode): FoundElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child as ReactNode));
  if (node && typeof node === "object" && (node as { $$typeof?: symbol }).$$typeof === PORTAL) {
    return elements((node as unknown as { children: ReactNode }).children);
  }
  if (!isValidElement(node)) return [];
  const props = node.props as AnyProps;
  return [{ type: node.type, props }, ...elements(props.children)];
}

/** The elements whose props include every one given (a role, an id, a label). */
export function withProps(node: ReactNode, wanted: Record<string, unknown>): FoundElement[] {
  return elements(node).filter((element) => Object.entries(wanted).every(([key, value]) => Object.is(element.props[key], value)));
}

/** The one element with these props; fails when there are none or several. */
export function only(node: ReactNode, wanted: Record<string, unknown>): FoundElement {
  const found = withProps(node, wanted);
  if (found.length !== 1) throw new Error(`expected one element with ${JSON.stringify(wanted)}, found ${found.length}`);
  return found[0];
}

/** The text directly inside an element and its descendants. */
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child as ReactNode)).join("");
  if (!isValidElement(node)) return "";
  return textOf((node.props as AnyProps).children);
}
