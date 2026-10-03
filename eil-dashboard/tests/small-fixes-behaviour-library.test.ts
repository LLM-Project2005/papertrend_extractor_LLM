/*
 * The Library's side of three fixes (run-status-copy, reanalysis-availability
 * and references-export), run rather than read: the Library is mounted with
 * React's client renderer and no document (tests/support/stub-smallfix-root.ts),
 * so its own fetch of the papers runs, and its menus and buttons are pressed
 * by calling their handlers. Sign-in, the workspace and Next's router are
 * swapped (tests/support/stub-auditfix-*.ts); the papers it is sent are the
 * test's.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement, ReactNode } from "react";
import { describeRunFailure } from "../src/lib/ingestion-status";
import type { IngestionRunRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";
import { captured, elementsOf, headlessRoot, textOf } from "./support/stub-smallfix-root";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));

const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment" };
const FOLDER = "00000000-0000-4000-8000-0000000000f1";

function run(id: string, title: string, status: IngestionRunRow["status"], extra: Partial<IngestionRunRow> = {}): IngestionRunRow {
  const at = new Date(Date.now() - 60_000).toISOString();
  return { id, source_type: "upload", status, source_filename: `${id.slice(0, 8)}.pdf`, display_name: title, folder_id: FOLDER, created_at: at, updated_at: at, input_payload: {}, ...extra } as IngestionRunRow;
}

const REANALYSIS = { reanalysis_requested_at: "2026-10-01T00:00:00Z", paper_id: "1", analysis_metrics: { completed_at: "2026-09-30T10:00:00Z" } };
const RUNS = {
  finished: run("1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51", "A finished paper", "succeeded"),
  reanalysing: run("2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52", "A paper analysed again", "processing", { input_payload: REANALYSIS }),
  firstAnalysis: run("3a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c53", "A paper half read", "processing", { input_payload: { paper_id: "1", analysis_metrics: { queue_wait_seconds: 3 } } }),
};

/** A click's event, from a button at the top left of the screen. */
const click = { currentTarget: { getBoundingClientRect: () => ({ top: 40, bottom: 72, left: 40, right: 72, width: 32, height: 32 }), focus: () => undefined }, stopPropagation: () => undefined, preventDefault: () => undefined };

/** The Library on the repository, once its own fetch of these papers has answered. */
async function library(runs: IngestionRunRow[]) {
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT], allFolders: [{ id: FOLDER, project_id: PROJECT.id, name: "Papers" }] };
  globalThis.__auditfixSearch = `repo=${PROJECT.id}`;
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    fetched.push(url);
    if (url.startsWith("/api/workspace/library?")) return Response.json({ runs });
    return Response.json({ error: "Not part of this test." }, { status: 404 });
  }) as typeof fetch;
  const { default: Library } = await import("../src/components/admin/AdminImportClient");
  const root = await headlessRoot();
  let tree: ReactNode = null;
  await root.render(captured(Library, {} as never, (next) => (tree = next)));
  await root.act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  const all = () => elementsOf(tree);
  /** The element `where` picks; it must be there. */
  const find = (where: (element: ReactElement<Record<string, unknown>>) => boolean, what: string) => {
    const found = all().find(where);
    assert.ok(found, `${what} is on screen`);
    return found;
  };
  const button = (label: string) => find((element) => element.type === "button" && (textOf(element).trim() === label || element.props["aria-label"] === label), label);
  /** Calls a handler as a press would, and waits for what it starts. */
  const press = (element: ReactElement<Record<string, unknown>>, handler = "onClick") =>
    root.act(async () => {
      await (element.props[handler] as (event: unknown) => unknown)(click);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const close = async () => {
    await root.unmount();
    globalThis.fetch = realFetch;
    globalThis.__auditfixSearch = undefined;
  };
  return { all, find, button, press, fetched, close };
}

/** The labels of the menu a paper's actions button opens. */
async function menuOf(view: Awaited<ReturnType<typeof library>>, title: string) {
  await view.press(view.button(`Open actions for ${title}`));
  const labels = view.all().filter((element) => element.type === "button").map((element) => textOf(element).trim());
  await view.press(view.button(`Open actions for ${title}`));
  return labels;
}

test("a failed paper explains itself where the papers are, the full sentence on hover", async () => {
  // The History page used to be the only place an older failure said why. The
  // paper in the Library carries the reason, the line truncating in the list.
  const raw = "Extraction produced no usable text for 3f2c9a1e-0000-4000-8000-000000000000.pdf.";
  const view = await library([run("4a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c54", "A scanned thesis", "failed", { error_message: raw })]);
  try {
    const sentence = describeRunFailure(raw);
    const subtitle = view.find((element) => element.props.title === sentence, "the plain sentence, as the hover title");
    assert.equal(textOf(subtitle), sentence, "and as the line itself");
    assert.ok(!view.all().some((element) => element.props.title === raw), "not the worker's own words");
  } finally {
    await view.close();
  }
});

test("a paper being re-analysed can still be opened and its report downloaded; analysing again is for finished papers", async () => {
  const view = await library(Object.values(RUNS));
  try {
    const finished = await menuOf(view, "A finished paper");
    const again = await menuOf(view, "A paper analysed again");
    const halfRead = await menuOf(view, "A paper half read");
    for (const label of ["View analysis", "Download analysis report"]) {
      assert.ok(finished.includes(label), `a finished paper: ${label}`);
      assert.ok(again.includes(label), `a paper being re-analysed: ${label}`);
      assert.ok(!halfRead.includes(label), `a first analysis still running: no ${label}`);
    }
    assert.ok(finished.includes("Analyze again"));
    assert.ok(!again.includes("Analyze again") && !halfRead.includes("Analyze again"), "only a finished paper is analysed again");

    // Opening a paper being re-analysed shows its earlier analysis, not the PDF alone.
    await view.press(view.find((element) => element.type === "button" && textOf(element).trim() === "A paper analysed again", "the paper's name"));
    assert.ok(view.fetched.includes(`/api/workspace/library/${RUNS.reanalysing.id}/analysis`));
  } finally {
    await view.close();
  }
});

test("the Library offers references for a selection, counting only the papers that can be cited, and for a whole repository", async () => {
  const view = await library(Object.values(RUNS));
  try {
    for (const title of ["A finished paper", "A paper analysed again", "A paper half read"]) {
      await view.press(view.find((element) => element.type === "input" && element.props["aria-label"] === `Select ${title}`, `the box for ${title}`), "onChange");
    }
    await view.press(view.button("Cite (2)"));
    const dialog = () => view.find((element) => typeof element.props.selection === "object" && typeof element.props.label === "string", "the references dialog");
    assert.deepEqual(dialog().props.selection, { runIds: [RUNS.finished.id, RUNS.reanalysing.id] });
    assert.equal(dialog().props.label, "2 papers");
    await view.press(dialog(), "onClose");

    await view.press(view.button("New"));
    await view.press(view.button("Export references"));
    assert.deepEqual(dialog().props.selection, { projectId: PROJECT.id });
    assert.equal(dialog().props.label, PROJECT.name);
  } finally {
    await view.close();
  }
});
