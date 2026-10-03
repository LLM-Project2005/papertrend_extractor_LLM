/*
 * The little of a browser's document and window that the menus, dialog layers
 * and paper window touch, for tests run through stub-uia11y-hooks.ts: event
 * listeners with a capture and a bubble phase (window, then document, then the
 * element, and back out), focus, the body's style, an address with a history,
 * timers a test advances, the file a download link held, and a stand-in for
 * fetch. `installDom` puts them on globalThis; its `restore` takes them away
 * again.
 */
import { resolveObjectURL, type Blob } from "node:buffer";

type Listener = { type: string; listener: (event: FakeEvent) => void; capture: boolean };

function captureOf(options: unknown): boolean {
  return typeof options === "boolean" ? options : Boolean((options as { capture?: boolean } | undefined)?.capture);
}

export class FakeEventTarget {
  listeners: Listener[] = [];
  addEventListener(type: string, listener: (event: FakeEvent) => void, options?: unknown) {
    const capture = captureOf(options);
    if (this.listeners.some((entry) => entry.type === type && entry.listener === listener && entry.capture === capture)) return;
    this.listeners.push({ type, listener, capture });
  }
  removeEventListener(type: string, listener: (event: FakeEvent) => void, options?: unknown) {
    const capture = captureOf(options);
    this.listeners = this.listeners.filter((entry) => !(entry.type === type && entry.listener === listener && entry.capture === capture));
  }
  /** The listeners for `type` now attached here. */
  listening(type: string): Listener[] {
    return this.listeners.filter((entry) => entry.type === type);
  }
}

export class FakeNode extends FakeEventTarget {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  append(...nodes: FakeNode[]) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
    return this;
  }
  appendChild(node: FakeNode) {
    this.append(node);
    return node;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter((node) => node !== this);
    this.parentNode = null;
  }
  contains(other: unknown): boolean {
    for (let node = other as FakeNode | null; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  descendants(): FakeNode[] {
    return this.childNodes.flatMap((node) => [node, ...node.descendants()]);
  }
}

export class FakeElement extends FakeNode {
  readonly nodeType = 1;
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  isContentEditable = false;
  /** Non-null while the element is laid out (a hidden one has none). */
  offsetParent: object | null = {};
  focusCalls: unknown[] = [];
  clicks = 0;
  href = "";
  download = "";
  rel = "";
  target = "";
  constructor(
    readonly tagName = "DIV",
    readonly focusable = false
  ) {
    super();
  }
  focus(options?: unknown) {
    this.focusCalls.push(options);
    (globalThis.document as unknown as FakeDocument).activeElement = this;
  }
  /** What a download link held when it was clicked. */
  downloaded: Blob | undefined;
  click() {
    this.clicks += 1;
    if (this.href.startsWith("blob:")) this.downloaded = resolveObjectURL(this.href);
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  /** Answers the dialog layer's query for focusable elements, the only one asked here. */
  querySelectorAll(_selector: string): FakeElement[] {
    return this.descendants().filter((node): node is FakeElement => node instanceof FakeElement && node.focusable);
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  scrollIntoView() {}
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  /** Each scrollTo the page asked for. */
  scrolls: Array<{ top?: number; behavior?: string }> = [];
  scrollTo(options: { top?: number; behavior?: string }) {
    this.scrolls.push(options);
    if (typeof options.top === "number") this.scrollTop = Math.max(0, Math.min(options.top, this.scrollHeight - this.clientHeight));
  }
}

export class FakeEvent {
  defaultPrevented = false;
  propagationStopped = false;
  key?: string;
  button = 0;
  shiftKey = false;
  metaKey = false;
  ctrlKey = false;
  altKey = false;
  target: FakeNode | null = null;
  constructor(
    readonly type: string,
    init: Partial<Pick<FakeEvent, "key" | "button" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "target">> = {}
  ) {
    Object.assign(this, init);
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
}

export class FakeDocument extends FakeNode {
  readonly nodeType = 9;
  body = new FakeElement("BODY");
  visibilityState = "visible";
  activeElement: FakeElement;
  constructor() {
    super();
    this.append(this.body);
    this.body.style.overflow = "";
    this.activeElement = this.body;
  }
  /** Every element a page made, in order (a download link is removed once clicked). */
  created: FakeElement[] = [];
  createElement(tagName: string) {
    const element = new FakeElement(tagName.toUpperCase());
    this.created.push(element);
    return element;
  }
  getElementById() {
    return null;
  }
}

export class FakeStorage {
  items = new Map<string, string>();
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

export interface FakeResponse {
  status?: number;
  body?: unknown;
  /** Holds the answer back until this settles: a slow request. */
  after?: Promise<void>;
}

export class FakeWindow extends FakeEventTarget {
  location: URL;
  /** Each address the history moved to, and how. */
  historyLog: Array<{ how: "push" | "replace" | "back"; href?: string }> = [];
  private entries: string[];
  history: { state: unknown; pushState: (state: unknown, title: string, href: string) => void; replaceState: (state: unknown, title: string, href: string) => void; back: () => void };
  /** Each fetch the page made, answered by `respond`. */
  requests: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = [];
  respond: (url: string, init?: { method?: string; body?: string }) => FakeResponse = () => ({ status: 404, body: {} });
  opened: Array<{ closed: boolean }> = [];
  constructor(href: string) {
    super();
    this.location = new URL(href);
    this.entries = [this.location.href];
    const move = (how: "push" | "replace", target: string) => {
      const next = new URL(target, this.location.href);
      this.historyLog.push({ how, href: `${next.pathname}${next.search}${next.hash}` });
      if (how === "push") this.entries.push(next.href);
      else this.entries[this.entries.length - 1] = next.href;
      this.location = next;
    };
    this.history = {
      state: null,
      pushState: (_state, _title, target) => move("push", target),
      replaceState: (_state, _title, target) => move("replace", target),
      // As a browser does: the address goes back one entry and popstate follows.
      back: () => {
        this.historyLog.push({ how: "back" });
        if (this.entries.length < 2) return;
        this.entries.pop();
        this.location = new URL(this.entries[this.entries.length - 1]);
        dispatch(new FakeEvent("popstate"));
      },
    };
  }
  requestAnimationFrame(callback: (time: number) => void) {
    callback(0);
    return 1;
  }
  cancelAnimationFrame() {}
  // Every media query matches, reduced motion included, so nothing waits on an animation.
  matchMedia() {
    return { matches: true, addEventListener() {}, removeEventListener() {} };
  }
  // Timers run only when a test says time has passed (`advance`), so a poll or
  // a fallback waits for a test rather than firing in the middle of one.
  timers = new Map<number, { callback: () => void; ms: number; repeat: boolean }>();
  private timerIds = 0;
  setTimeout = (callback: () => void, ms = 0) => this.addTimer(callback, ms, false);
  clearTimeout = (id?: number) => void this.timers.delete(id ?? -1);
  setInterval = (callback: () => void, ms = 0) => this.addTimer(callback, ms, true);
  clearInterval = (id?: number) => void this.timers.delete(id ?? -1);
  private addTimer(callback: () => void, ms: number, repeat: boolean) {
    this.timerIds += 1;
    this.timers.set(this.timerIds, { callback, ms, repeat });
    return this.timerIds;
  }
  /** Runs, once, every timer due within `ms`. */
  advance(ms: number) {
    for (const [id, timer] of [...this.timers]) {
      if (timer.ms > ms || !this.timers.has(id)) continue;
      if (!timer.repeat) this.timers.delete(id);
      timer.callback();
    }
  }
  innerWidth = 1280;
  innerHeight = 800;
  localStorage = new FakeStorage();
  sessionStorage = new FakeStorage();
  open() {
    const opened = { closed: false, opener: null as unknown, location: { href: "" }, close() { this.closed = true; } };
    this.opened.push(opened);
    return opened;
  }
}

/** Sends `event` through the capture phase, its target and the bubble phase, as a browser does. */
export function dispatch(event: FakeEvent): FakeEvent {
  const document = globalThis.document as unknown as FakeDocument;
  const window = globalThis.window as unknown as FakeWindow;
  const target = event.target ?? document.body;
  event.target = target;
  const path: FakeEventTarget[] = [];
  for (let node: FakeNode | null = target; node; node = node.parentNode) path.push(node);
  path.push(window);
  const call = (at: FakeEventTarget, capture: boolean | null) => {
    for (const entry of [...at.listeners]) {
      if (entry.type === event.type && (capture === null || entry.capture === capture)) entry.listener(event);
    }
  };
  for (const at of [...path].reverse().slice(0, -1)) call(at, true);
  call(target, null);
  for (const at of path.slice(1)) {
    if (event.propagationStopped) break;
    call(at, false);
  }
  return event;
}

/** A key pressed with nothing in particular focused. */
export function press(key: string, init: ConstructorParameters<typeof FakeEvent>[1] = {}): FakeEvent {
  return dispatch(new FakeEvent("keydown", { key, ...init }));
}

const GLOBALS = ["document", "window", "Node", "HTMLElement", "fetch"] as const;

/** Puts a fresh document and window at `href` on globalThis. */
export function installDom(href = "https://papertrend.test/workspace/home") {
  const saved = Object.fromEntries(GLOBALS.map((name) => [name, (globalThis as Record<string, unknown>)[name]]));
  const document = new FakeDocument();
  const window = new FakeWindow(href);
  const scope = globalThis as Record<string, unknown>;
  scope.document = document;
  scope.window = window;
  scope.Node = FakeNode;
  scope.HTMLElement = FakeElement;
  scope.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    window.requests.push({ url, init });
    const answer = window.respond(url, init);
    if (answer.after) await answer.after;
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => answer.body ?? {} };
  };
  return {
    document,
    window,
    restore() {
      for (const name of GLOBALS) scope[name] = saved[name];
    },
  };
}

/** Lets pending promise callbacks (a fetch and what follows it) run. */
export async function settle(rounds = 10) {
  for (let round = 0; round < rounds; round += 1) await new Promise((resolve) => setImmediate(resolve));
}
