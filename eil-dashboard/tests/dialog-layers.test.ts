import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";
import React, { type ReactNode, type RefObject } from "react";
import { stubModule } from "./support/route-harness";
import { FakeElement, FakeEvent, dispatch, installDom, press, settle } from "./support/stub-uia11y-dom";
import { elements, mount, only, textOf, withProps } from "./support/stub-uia11y-hooks";

/**
 * Escape closes only the topmost layer, and overlays keep focus (docs/32, 2.9).
 * The layers, menus and overlays run through stub-uia11y-hooks.ts, with their
 * effects attached to the stand-in document of stub-uia11y-dom.ts. Sign-in,
 * the workspace, the dashboard data, the screen width and Next's router are
 * the tests/support/stub-auditfix-*.ts and stub-profiledash-narrow.ts ones.
 */

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/lib/use-narrow.ts", support("stub-profiledash-narrow.ts"));
stubModule("/src/hooks/useData.ts", support("stub-auditfix-dashboard-data.ts"));

(globalThis as { React?: typeof React }).React = React;

const root = fileURLToPath(new URL("..", import.meta.url));
const dom = installDom();
type ModalModule = typeof import("../src/components/ui/Modal");
let Modal: ModalModule["default"];
let hasOpenDialog: ModalModule["hasOpenDialog"];
let useDialogLayer: ModalModule["useDialogLayer"];
let useDismiss: typeof import("../src/hooks/useDismiss")["useDismiss"];

before(async () => {
  ({ default: Modal, hasOpenDialog, useDialogLayer } = await import("../src/components/ui/Modal"));
  ({ useDismiss } = await import("../src/hooks/useDismiss"));
});

function Layer({ active, container, onClose }: { active: boolean; container: RefObject<HTMLElement | null>; onClose: () => void }) {
  useDialogLayer(active, container, onClose);
  return null;
}

function Menu({ open, container, onDismiss }: { open: boolean; container: RefObject<HTMLElement | null>; onDismiss: () => void }) {
  useDismiss(open, onDismiss, container);
  return null;
}

const ref = (element: FakeElement) => ({ current: element as unknown as HTMLElement });

/** A panel with `count` focusable buttons in it. */
function panel(count = 2) {
  const element = new FakeElement("DIV");
  const buttons = Array.from({ length: count }, () => new FakeElement("BUTTON", true));
  element.append(...buttons);
  dom.document.body.append(element);
  return { element, buttons };
}

test("a dialog layer closes only on an Escape that is its own", () => {
  const trigger = new FakeElement("BUTTON", true);
  dom.document.body.append(trigger);
  trigger.focus();
  const closed: string[] = [];
  const outer = panel();
  const outerLayer = mount(Layer, { active: true, container: ref(outer.element), onClose: () => closed.push("outer") });
  assert.equal(hasOpenDialog(), true);
  assert.equal(dom.document.activeElement, outer.buttons[0], "focus moves into the layer");
  assert.equal(dom.document.body.style.overflow, "hidden", "the page behind stops scrolling");

  const inner = panel();
  const innerLayer = mount(Layer, { active: true, container: ref(inner.element), onClose: () => closed.push("inner") });
  const escape = press("Escape");
  assert.deepEqual(closed, ["inner"], "top layer only");
  assert.equal(escape.defaultPrevented, true, "and marks the Escape it handled");

  const handled = new FakeEvent("keydown", { key: "Escape" });
  handled.preventDefault();
  dispatch(handled);
  assert.deepEqual(closed, ["inner"], "an Escape already handled is left alone");

  innerLayer.unmount();
  assert.equal(dom.document.activeElement, outer.buttons[0], "focus goes back to where it was");
  press("Escape");
  assert.deepEqual(closed, ["inner", "outer"], "the layer below is on top now");

  outerLayer.rerender({ active: false, container: ref(outer.element), onClose: () => closed.push("outer") });
  assert.equal(hasOpenDialog(), false);
  assert.equal(dom.document.activeElement, trigger, "focus goes back to the button that opened it");
  assert.deepEqual(trigger.focusCalls.at(-1), { preventScroll: true });
  assert.equal(dom.document.body.style.overflow, "", "the page scrolls again");
  outerLayer.unmount();
});

test("Tab stays inside a dialog layer", () => {
  const { element, buttons } = panel(3);
  const hidden = new FakeElement("BUTTON", true);
  hidden.offsetParent = null;
  element.append(hidden);
  const layer = mount(Layer, { active: true, container: ref(element), onClose: () => undefined });
  buttons[2].focus();
  const forward = press("Tab");
  assert.equal(dom.document.activeElement, buttons[0], "past the last control (a hidden one is skipped) comes the first");
  assert.equal(forward.defaultPrevented, true);
  press("Tab", { shiftKey: true });
  assert.equal(dom.document.activeElement, buttons[2], "and back again");
  dom.document.body.focus();
  press("Tab");
  assert.equal(dom.document.activeElement, buttons[0], "focus that left the layer is brought back");
  layer.unmount();
});

test("the Modal is itself a dialog layer, named, and closes on the backdrop but not the panel", () => {
  const closed: string[] = [];
  const modal = mount(Modal, { onClose: () => closed.push("modal"), label: "Rename file", children: "Rename" as ReactNode });
  assert.equal(hasOpenDialog(), true);
  const dialog = only(modal.tree, { role: "dialog" });
  assert.equal(dialog.props["aria-modal"], "true");
  assert.equal(dialog.props["aria-label"], "Rename file");
  const click = new FakeEvent("click");
  (dialog.props.onClick as (event: FakeEvent) => void)(click);
  assert.equal(click.propagationStopped, true, "a press inside the panel does not reach the backdrop");
  (only(modal.tree, { role: "presentation" }).props.onClick as () => void)();
  assert.deepEqual(closed, ["modal"]);

  // A dialog opened from inside another (Rename over the paper window).
  const rename = mount(Modal, { onClose: () => closed.push("rename"), children: "Rename" as ReactNode });
  press("Escape");
  assert.deepEqual(closed, ["modal", "rename"]);
  rename.unmount();
  press("Escape");
  assert.deepEqual(closed, ["modal", "rename", "modal"]);
  modal.unmount();
  assert.equal(hasOpenDialog(), false);
});

test("a menu inside a dialog takes the first Escape, and the dialog the next", () => {
  const closed: string[] = [];
  const dialog = panel();
  const layer = mount(Layer, { active: true, container: ref(dialog.element), onClose: () => closed.push("dialog") });
  const menuBox = new FakeElement("DIV");
  dialog.element.append(menuBox);
  const menuProps = { open: true, container: ref(menuBox), onDismiss: () => closed.push("menu") };
  const menu = mount(Menu, menuProps);
  const first = press("Escape");
  assert.deepEqual(closed, ["menu"]);
  assert.equal(first.defaultPrevented, true, "the menu marks the Escape it handled");
  menu.rerender({ ...menuProps, open: false });
  assert.equal(dom.document.listening("keydown").length, 0, "a closed menu listens for nothing");
  press("Escape");
  assert.deepEqual(closed, ["menu", "dialog"]);
  menu.unmount();
  layer.unmount();
});

test("the account menu and search take Escape only while open, and no search opens over a dialog", async () => {
  globalThis.__auditfixAuth = { user: { id: "u1", email: "reader@papertrend.test" }, session: { access_token: "token" } };
  const { default: WorkspaceProfileMenu } = await import("../src/components/workspace/WorkspaceProfileMenu");
  const { default: WorkspaceGlobalSearch } = await import("../src/components/workspace/WorkspaceGlobalSearch");
  const account = mount(WorkspaceProfileMenu, {});
  const search = mount(WorkspaceGlobalSearch, { pageItems: [] });
  const accountOpen = () => only(account.tree, { "aria-label": "Open account menu" }).props["aria-expanded"];
  const searchOpen = () => only(search.tree, { "aria-label": "Search repository" }).props["aria-expanded"];

  assert.equal(press("Escape").defaultPrevented, false, "closed, they leave Escape to whatever is open");
  (only(account.tree, { "aria-label": "Open account menu" }).props.onClick as () => void)();
  assert.equal(accountOpen(), true);
  const handled = new FakeEvent("keydown", { key: "Escape" });
  handled.preventDefault();
  dispatch(handled);
  assert.equal(accountOpen(), true, "an Escape something else handled is not taken");
  assert.equal(press("Escape").defaultPrevented, true);
  assert.equal(accountOpen(), false);

  const dialog = panel();
  const layer = mount(Layer, { active: true, container: ref(dialog.element), onClose: () => undefined });
  press("/");
  assert.equal(searchOpen(), false, "no search over an open dialog");
  layer.unmount();
  const field = new FakeElement("INPUT");
  dom.document.body.append(field);
  press("/", { target: field });
  assert.equal(searchOpen(), false, "a slash typed in a field is a slash");
  assert.equal(press("/").defaultPrevented, true);
  assert.equal(searchOpen(), true);
  assert.equal(press("Escape").defaultPrevented, true);
  assert.equal(searchOpen(), false);
  account.unmount();
  search.unmount();
});

test("the mobile navigation is a dialog layer below lg", async () => {
  globalThis.__auditfixAuth = { user: { id: "u1", email: "reader@papertrend.test" }, session: { access_token: "token" } };
  globalThis.__auditfixWorkspace = { currentProject: { id: "p1", name: "Assessment studies" }, hasActiveProject: true };
  globalThis.__auditfixPathname = "/workspace/home";
  const { default: WorkspaceShell } = await import("../src/components/workspace/WorkspaceShell");
  for (const narrow of [true, false]) {
    globalThis.__profiledashNarrow = narrow;
    const shell = mount(WorkspaceShell, { children: "The page" as ReactNode });
    (only(shell.tree, { "aria-label": "Open workspace navigation" }).props.onClick as () => void)();
    const drawer = only(shell.tree, { role: "dialog" });
    assert.equal(drawer.props["aria-modal"], "true");
    assert.equal(drawer.props["aria-label"], "Workspace navigation");
    assert.equal(hasOpenDialog(), narrow, narrow ? "a layer on a phone" : "the drawer is hidden from lg, so it takes nothing");
    press("Escape");
    assert.equal(withRole(shell.tree, "dialog"), !narrow, narrow ? "Escape closes it" : "the hidden drawer keeps out of the way");
    shell.unmount();
  }
  globalThis.__profiledashNarrow = undefined;
});

function withRole(tree: ReactNode, role: string) {
  try {
    only(tree, { role });
    return true;
  } catch {
    return false;
  }
}

test("the dashboard's filter sheet is a dialog layer below xl", async () => {
  const project = { id: "p1", name: "Assessment studies" };
  globalThis.__auditfixAuth = { user: { id: "u1", email: "reader@papertrend.test" }, session: { access_token: "token" } };
  globalThis.__auditfixWorkspace = {
    currentProject: project,
    hasActiveProject: true,
    selectedProjectId: project.id,
    allProjects: [project],
    filtersLoadedFor: project.id,
    profile: {},
    selectedYears: [],
    selectedTracks: ["EL", "ELI", "LAE", "Other"],
    searchQuery: "",
    setSelectedYears: () => undefined,
    setSelectedTracks: () => undefined,
    setSearchQuery: () => undefined,
  };
  const trends = ["1", "2"].map((id) => ({ paper_id: id, year: "2020", title: `Paper ${id}`, topic: "Reading", keyword: "fluency", keyword_frequency: 1, evidence: "" }));
  globalThis.__auditfixDashboardData = {
    loading: false,
    data: { trends, tracksSingle: [], tracksMulti: [], categoryAssignments: [], useMock: false, diagnostics: {} },
  };
  globalThis.__auditfixPathname = "/workspace/dashboard";
  // The filters belong to the chart tabs; the dashboard opens on the semantic map.
  globalThis.__auditfixSearch = "tab=area_analysis";
  const { default: DashboardClient } = await import("../src/components/DashboardClient");
  for (const narrow of [true, false]) {
    globalThis.__profiledashNarrow = narrow;
    const dashboard = mount(DashboardClient, {});
    const filters = elements(dashboard.tree).find((element) => element.type === "button" && textOf(element.props.children as ReactNode) === "Filters");
    assert.ok(filters, "the Filters button");
    (filters.props.onClick as () => void)();
    const sheet = only(dashboard.tree, { role: "dialog", "aria-label": "Analytics filters" });
    assert.equal(sheet.props["aria-modal"], "true");
    assert.equal(hasOpenDialog(), narrow, narrow ? "a layer below xl" : "from xl the sheet is hidden and the side panel shows");
    if (narrow) {
      press("Escape");
      assert.equal(withProps(dashboard.tree, { "aria-label": "Analytics filters" }).length, 0, "Escape closes it");
    }
    dashboard.unmount();
  }
  globalThis.__profiledashNarrow = undefined;
  globalThis.__auditfixSearch = undefined;
});

test("the chat's full research report is a dialog layer, under a paper opened from it", async () => {
  globalThis.__auditfixAuth = { user: { id: "u1", email: "reader@papertrend.test" }, session: { access_token: "token" } };
  globalThis.__auditfixWorkspace = { currentProject: { id: "p1", name: "Assessment studies" }, hasActiveProject: true, selectedProjectId: "p1", allProjects: [], selectedYears: [], selectedTracks: [], searchQuery: "" };
  globalThis.__auditfixPathname = "/workspace/chat";
  const thread = { id: "thread-1", mode: "deep_research", title: "Peer feedback" };
  const session = { id: "s1", thread_id: "thread-1", status: "completed", prompt: "Peer feedback", final_report: ["# Peer feedback", "", "It helps revision."].join("\n"), requires_analysis: false, pending_run_count: 0, steps: [] };
  dom.window.respond = (url) =>
    url.startsWith("/api/chat/threads?limit=")
      ? { body: { threads: [thread] } }
      : url === "/api/chat/threads/thread-1"
        ? { body: { thread, messages: [], deepResearchSession: session } }
        : { status: 404, body: {} };
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  const chat = mount(ChatClient, {});
  await settle();
  const button = (text: string) => elements(chat.tree).find((found) => found.type === "button" && !found.props["aria-label"] && textOf(found.props.children as ReactNode).trim() === text);
  (button("Peer feedback")!.props.onClick as () => void)();
  await settle();
  (button("Full view")!.props.onClick as () => void)();
  const report = only(chat.tree, { role: "dialog", "aria-label": "Deep research report" });
  assert.equal(report.props["aria-modal"], "true");
  assert.equal(hasOpenDialog(), true);
  // A paper opened from the report is the layer on top: Escape closes it and leaves the report.
  const paper = panel();
  const paperLayer = mount(Layer, { active: true, container: ref(paper.element), onClose: () => paperLayer.unmount() });
  press("Escape");
  assert.equal(withProps(chat.tree, { "aria-label": "Deep research report" }).length, 1, "the report stays open under the paper");
  press("Escape");
  assert.equal(withProps(chat.tree, { "aria-label": "Deep research report" }).length, 0, "then Escape closes the report");
  assert.equal(hasOpenDialog(), false);
  chat.unmount();
  dom.window.respond = () => ({ status: 404, body: {} });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}

// A rule over every file, those written later included; opening each overlay
// to check it would need every page's data and a press, so the source is read.
test("every aria-modal overlay is a dialog layer", () => {
  for (const path of sourceFiles(join(root, "src"))) {
    const text = readFileSync(path, "utf8");
    if (!text.includes('aria-modal="true"')) continue;
    const relative = path.replaceAll("\\", "/").replace(/.*\/src\//, "src/");
    assert.ok(relative === "src/components/ui/Modal.tsx" || /useDialogLayer\(/.test(text), `${relative} declares a modal without the layer`);
  }
});
