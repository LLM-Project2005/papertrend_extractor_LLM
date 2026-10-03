import assert from "node:assert/strict";
import test, { before } from "node:test";
import React, { type ReactNode, type RefObject } from "react";
import { stubModule } from "./support/route-harness";
import { FakeElement, FakeEvent, dispatch, installDom, press, settle } from "./support/stub-uia11y-dom";
import { elements, mount, only, textOf, withProps, type FoundElement } from "./support/stub-uia11y-hooks";

/**
 * Menus close on a press outside them and on Escape. The menus run through
 * stub-uia11y-hooks.ts, their listeners on the stand-in document of
 * stub-uia11y-dom.ts; sign-in, the workspace, the theme, the dashboard data
 * and Next's router are the tests/support/stub-auditfix-*.ts ones.
 */

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/hooks/useData.ts", support("stub-auditfix-dashboard-data.ts"));
stubModule("/src/lib/use-narrow.ts", support("stub-profiledash-narrow.ts"));
(globalThis as { React?: typeof React }).React = React;

const dom = installDom();
const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };
const SIGNED_IN = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "token" } };
let useDismiss: typeof import("../src/hooks/useDismiss")["useDismiss"];

before(async () => {
  ({ useDismiss } = await import("../src/hooks/useDismiss"));
});

function Menu({ open, container, onDismiss }: { open: boolean; container: RefObject<HTMLElement | null>; onDismiss: () => void }) {
  useDismiss(open, onDismiss, container);
  return null;
}

/** A press that starts on `target`. */
const pressOn = (target: FakeElement) => dispatch(new FakeEvent("pointerdown", { target }));
const mouseOn = (target: FakeElement) => dispatch(new FakeEvent("mousedown", { target }));

function element(tag = "DIV", parent: FakeElement = dom.document.body) {
  const made = new FakeElement(tag, tag === "BUTTON");
  parent.append(made);
  return made;
}

const click = (found: FoundElement | undefined) => (found?.props.onClick as () => void)();

test("a menu closes when the reader presses anywhere outside it", () => {
  const container = element();
  const button = element("BUTTON", container);
  const elsewhere = element("BUTTON");
  // A control that stops the press from bubbling still counts as outside.
  elsewhere.addEventListener("pointerdown", (event) => event.stopPropagation());
  let dismissed = 0;
  const props = { open: true, container: { current: container as unknown as HTMLElement }, onDismiss: () => (dismissed += 1) };
  const menu = mount(Menu, props);
  assert.deepEqual(dom.document.listening("pointerdown").map((entry) => entry.capture), [true], "caught before any control can stop it");
  pressOn(button);
  pressOn(container);
  assert.equal(dismissed, 0, "a press inside, the button included, is left alone");
  pressOn(elsewhere);
  assert.equal(dismissed, 1);
  const escape = press("Escape");
  assert.equal(dismissed, 2);
  assert.equal(escape.defaultPrevented, true);
  menu.rerender({ ...props, open: false });
  pressOn(elsewhere);
  press("Escape");
  assert.equal(dismissed, 2, "a closed menu does nothing");
  assert.equal(dom.document.listening("pointerdown").length + dom.document.listening("keydown").length, 0);
  menu.unmount();
});

/**
 * Gives the innermost element with a ref around the button labelled `label`
 * a stand-in node, as React would on mounting it, and returns a stand-in for
 * the button inside it.
 */
function attachAround(tree: ReactNode, label: string): FakeElement {
  const holder = elements(tree)
    .filter((found) => found.props.ref && elements(found.props.children as ReactNode).some((inner) => inner.props["aria-label"] === label))
    .at(-1);
  assert.ok(holder, `${label}: inside an element with a ref`);
  const box = element();
  (holder.props.ref as { current: unknown }).current = box;
  return element("BUTTON", box);
}

test("the chat's menus close on a press outside them or Escape, and each holds its own button", async () => {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT], selectedYears: [], selectedTracks: [], searchQuery: "" };
  globalThis.__auditfixPathname = "/workspace/chat";
  dom.window.respond = (url) =>
    url.startsWith("/api/chat/threads?limit=")
      ? { body: { threads: [{ id: "thread-1", mode: "chat", title: "Peer feedback" }], hasMore: false } }
      : { status: 404, body: {} };
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  const chat = mount(ChatClient, {});
  await settle();
  // The + menu, the conversation menu and each conversation's "..." menu.
  for (const label of ["Open attachment and tool menu", "Open conversation menu", "Options for Peer feedback"]) {
    const button = () => only(chat.tree, { "aria-label": label });
    click(button());
    assert.equal(button().props["aria-expanded"], true, label);
    const inside = attachAround(chat.tree, label);
    pressOn(inside);
    assert.equal(button().props["aria-expanded"], true, `${label}: a press on its button is left to the button's own toggle`);
    pressOn(element());
    assert.equal(button().props["aria-expanded"], false, `${label}: a press outside closes it`);
    click(button());
    const escape = press("Escape");
    assert.equal(escape.defaultPrevented, true, `${label}: Escape is marked, so the drawer around it stays open`);
    assert.equal(button().props["aria-expanded"], false, `${label}: Escape closes it`);
  }
  chat.unmount();
  dom.window.respond = () => ({ status: 404, body: {} });
});

test("the other menus close on an outside press", async () => {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true };
  const { default: Select } = await import("../src/components/ui/Select");
  const { default: WorkspaceProfileMenu } = await import("../src/components/workspace/WorkspaceProfileMenu");
  const { default: WorkspaceGlobalSearch } = await import("../src/components/workspace/WorkspaceGlobalSearch");
  const outside = element();

  const select = mount(Select, { value: "a", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }], onChange: () => undefined, label: "Sort" });
  click(only(select.tree, { "aria-haspopup": "listbox" }));
  assert.equal(withProps(select.tree, { role: "listbox" }).length, 1);
  pressOn(outside);
  assert.equal(withProps(select.tree, { role: "listbox" }).length, 0, "the shared Select");

  const account = mount(WorkspaceProfileMenu, {});
  const accountButton = () => only(account.tree, { "aria-label": "Open account menu" });
  click(accountButton());
  assert.equal(accountButton().props["aria-expanded"], true);
  mouseOn(outside);
  assert.equal(accountButton().props["aria-expanded"], false, "the account menu");

  const search = mount(WorkspaceGlobalSearch, { pageItems: [] });
  const searchButton = () => only(search.tree, { "aria-label": "Search repository" });
  click(searchButton());
  assert.equal(searchButton().props["aria-expanded"], true);
  mouseOn(outside);
  assert.equal(searchButton().props["aria-expanded"], false, "search");
  for (const mounted of [select, account, search]) mounted.unmount();
});

test("the Library's menus close on a press anywhere beside them", async () => {
  // A full-page layer lies under each open menu, and takes the press.
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT] };
  globalThis.__auditfixSearch = `repo=${PROJECT.id}`;
  const { default: Library } = await import("../src/components/admin/AdminImportClient");
  const library = mount(Library, {});
  await settle();
  const typeFilter = () => elements(library.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode) === "Type");
  const layer = () => withProps(library.tree, { className: "fixed inset-0 z-40" });
  assert.equal(layer().length, 0);
  (typeFilter()!.props.onClick as (event: unknown) => void)({ currentTarget: { getBoundingClientRect: () => ({ top: 100, bottom: 136, left: 200, right: 300, width: 100, height: 36 }) } });
  assert.equal(typeFilter()!.props["aria-expanded"], true);
  assert.equal(layer().length, 1, "the layer is under the open menu");
  click(layer()[0]);
  assert.equal(typeFilter()!.props["aria-expanded"], false);
  assert.equal(layer().length, 0);
  library.unmount();
  globalThis.__auditfixSearch = undefined;
});

test("the dashboard's filter panel closes on a press beside it", async () => {
  globalThis.__auditfixAuth = SIGNED_IN;
  globalThis.__auditfixWorkspace = {
    currentProject: PROJECT,
    hasActiveProject: true,
    selectedProjectId: PROJECT.id,
    allProjects: [PROJECT],
    filtersLoadedFor: PROJECT.id,
    profile: {},
    selectedYears: [],
    selectedTracks: ["EL", "ELI", "LAE", "Other"],
    searchQuery: "",
  };
  globalThis.__auditfixDashboardData = {
    loading: false,
    data: { trends: [{ paper_id: "1", year: "2020", title: "Paper 1", topic: "Reading", keyword: "fluency", keyword_frequency: 1, evidence: "" }], tracksSingle: [], tracksMulti: [], categoryAssignments: [], useMock: false, diagnostics: {} },
  };
  globalThis.__auditfixPathname = "/workspace/dashboard";
  globalThis.__profiledashNarrow = false;
  const { default: DashboardClient } = await import("../src/components/DashboardClient");
  const dashboard = mount(DashboardClient, {});
  const sheetOpen = () => withProps(dashboard.tree, { "aria-label": "Analytics filters" }).length > 0;
  click(elements(dashboard.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode) === "Filters"));
  assert.equal(sheetOpen(), true);
  // From xl the panel sits beside the page over a clear layer; a press on that layer closes it.
  const layer = elements(dashboard.tree).find((found) => found.type === "div" && found.props.role === undefined && String(found.props.className).includes("fixed inset-0") && typeof found.props.onClick === "function");
  click(layer);
  assert.equal(sheetOpen(), false);
  dashboard.unmount();
  globalThis.__profiledashNarrow = undefined;
});
