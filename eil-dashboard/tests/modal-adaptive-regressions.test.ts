/*
 * The dialog layer and the paper window, run through React's client renderer
 * without a document (tests/support/stub-smallfix-root.ts): their effects and
 * state run, and what they draw is kept as elements to read.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type { IngestionRunRow, RunAnalysisDetail } from "../src/types/database";
import { captured, elementsOf, headlessRoot, textOf } from "./support/stub-smallfix-root";

test("shared modals portal to the document body so transformed ancestors cannot offset them", async () => {
  const { default: Modal } = await import("../src/components/ui/Modal");
  const root = await headlessRoot();
  const body = (globalThis as unknown as { document: { body: { style: { overflow?: string } } } }).document.body;
  let tree: ReactNode = null;
  await root.render(captured(Modal, { onClose: () => undefined, children: createElement("p", null, "Rename this paper") }, (next) => (tree = next)));
  const portal = tree as unknown as { containerInfo: unknown; children: ReactElement<{ className: string }> };
  assert.equal(portal.containerInfo, body, "drawn into the document body");
  const backdrop = portal.children.props.className.split(/\s+/);
  assert.ok(backdrop.includes("fixed") && backdrop.includes("inset-0"), "over the whole window");
  const dialog = elementsOf(tree).find((element) => element.props.role === "dialog");
  assert.equal(textOf(dialog), "Rename this paper");
  assert.equal(body.style.overflow, "hidden", "the page behind stops scrolling");
  await root.unmount();
  assert.notEqual(body.style.overflow, "hidden", "and scrolls again once it closes");
});

type ExplorerProps = ComponentProps<typeof import("../src/components/workspace/PaperAnalysisExplorerModal").default>;

function run(id: string): IngestionRunRow {
  const at = "2026-10-01T00:00:00.000Z";
  return { id, source_type: "upload", status: "succeeded", source_filename: `${id}.pdf`, display_name: `Paper ${id}`, created_at: at, updated_at: at } as IngestionRunRow;
}

const DETAIL: RunAnalysisDetail = { available: true, title: "Peer feedback", topics: [], keywords: [], concepts: [], facets: [], tracksSingle: [], tracksMulti: [] };
const idle = async () => undefined;

function explorerProps(overrides: Partial<ExplorerProps> = {}): ExplorerProps {
  return {
    run: run("1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51"),
    detail: DETAIL,
    loading: false,
    error: null,
    onClose: () => undefined,
    onResolvePreviewUrl: async () => null,
    onOpenInNewTab: idle,
    onDownload: idle,
    onDownloadReport: idle,
    onToggleFavorite: idle,
    onRename: idle,
    onOpenDashboard: () => undefined,
    ...overrides,
  };
}

const classesOf = (element: ReactElement<Record<string, unknown>> | undefined) => String(element?.props.className ?? "").split(/\s+/).filter(Boolean);

test("paper explorer tabs stay above the content, across the full width of the scrolling area", async () => {
  // The bar scrolled away with the content, and an inset bar let the content
  // show at its sides.
  const { default: PaperAnalysisExplorerModal } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const root = await headlessRoot();
  let tree: ReactNode = null;
  await root.render(captured(PaperAnalysisExplorerModal, explorerProps(), (next) => (tree = next)));
  const all = elementsOf(tree);
  const nav = all.find((element) => element.type === "nav" && element.props["aria-label"] === "Paper explorer tabs");
  const bar = classesOf(nav);
  for (const name of ["sticky", "top-0", "z-20"]) assert.ok(bar.includes(name), name);
  assert.ok(bar.some((name) => name.startsWith("bg-surface")), "on the dialog's own surface");
  assert.ok(bar.some((name) => name.startsWith("backdrop-blur")), "content passing under it is blurred");
  const scroller = classesOf(all.find((element) => ([] as ReactNode[]).concat(element.props.children as ReactNode).includes(nav)));
  assert.ok(scroller.includes("overflow-y-auto"), "it sits in the scrolling area");
  for (const prefix of ["", "sm:"]) {
    const padding = scroller.find((name) => name.startsWith(`${prefix}px-`));
    assert.ok(padding, `the scrolling area has ${prefix}px-`);
    assert.ok(bar.includes(`${prefix}-mx-${padding.slice(`${prefix}px-`.length)}`), `the bar reaches its edges (${prefix}${padding})`);
    assert.ok(bar.includes(padding), `and pads its tabs back in (${padding})`);
  }
  await root.unmount();
});

/* ------------------------------------------------- after the window opens */

/** The tab marked as the one on screen. */
function activeTab(tree: ReactNode): string {
  const nav = elementsOf(tree).find((element) => element.type === "nav" && element.props["aria-label"] === "Paper explorer tabs");
  const current = elementsOf(nav?.props.children as ReactNode).filter((element) => element.type === "button" && element.props["aria-current"] === "page");
  return current.map((button) => textOf(button)).join(",");
}

test("the paper window resolves its PDF address once, without cancelling itself", async () => {
  // The effect depended on its own loading flag and on a resolver the parent
  // recreates every render. Setting the flag re-ran it, the cleanup cancelled
  // the request in flight, and the viewer stayed on "Loading the PDF…".
  const { default: PaperAnalysisExplorerModal } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const { default: PdfViewer } = await import("../src/components/workspace/PdfViewer");
  const root = await headlessRoot();
  let tree: ReactNode = null;
  let calls = 0;
  let answer: (url: string) => void = () => undefined;
  const resolver = () => {
    calls += 1;
    return new Promise<string | null>((resolve) => (answer = resolve));
  };
  // As the Library does: a new resolver function on every render.
  const draw = () => root.render(captured(PaperAnalysisExplorerModal, explorerProps({ initialTab: "preview", onResolvePreviewUrl: () => resolver() }), (next) => (tree = next)));
  await draw();
  await draw();
  await draw();
  assert.equal(calls, 1, "asked once, however often the parent draws it");
  await root.act(() => answer("https://storage.test/papers/1.pdf"));
  const viewer = elementsOf(tree).find((element) => element.type === PdfViewer);
  assert.equal(viewer?.props.url, "https://storage.test/papers/1.pdf", "the viewer is given the address");
  await root.unmount();
});

test("a link to a paper's tab opens on that tab", async () => {
  // The window reset itself to Overview whenever the paper changed - on mount
  // too - so /workspace/library?paper=...&tab=evidence opened on Overview.
  const { default: PaperAnalysisExplorerModal } = await import("../src/components/workspace/PaperAnalysisExplorerModal");
  const root = await headlessRoot();
  let tree: ReactNode = null;
  const shown: string[] = [];
  const open = (id: string, initialTab: ExplorerProps["initialTab"]) =>
    root.render(captured(PaperAnalysisExplorerModal, explorerProps({ run: run(id), initialTab, onTabChange: (tab) => shown.push(tab) }), (next) => (tree = next)));
  await open("1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51", "evidence");
  assert.equal(activeTab(tree), "Evidence");
  assert.deepEqual(shown, ["evidence"], "never Overview on the way");
  await open("2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52", "keywords");
  assert.equal(activeTab(tree), "Keywords", "another paper opens on the tab its link asked for");
  await open("3a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c53", undefined);
  assert.equal(activeTab(tree), "Overview", "and a link without one on Overview");
  await root.unmount();
});
