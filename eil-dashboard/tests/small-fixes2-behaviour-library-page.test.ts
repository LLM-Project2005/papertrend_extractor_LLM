/*
 * The Library page, run (docs/32, long-term health): AdminImportClient through
 * stub-uia11y-hooks.ts against the stand-in document and fetch of
 * stub-uia11y-dom.ts, with the stub-auditfix-* sign-in, workspace, theme and
 * router. It starts from the account's repositories, uploads through the one
 * upload dialog, and selects and acts on only what is in view.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { type ReactNode } from "react";
import type { IngestionRunRow } from "../src/types/database";
import { stubModule } from "./support/route-harness";
import { installDom, settle } from "./support/stub-uia11y-dom";
import { elements, mount, textOf, type FoundElement } from "./support/stub-uia11y-hooks";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
(globalThis as { React?: typeof React }).React = React;

const A = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };
const B = { id: "00000000-0000-4000-8000-0000000000a2", name: "Reading fluency" };
const FOLDER_A = { id: "00000000-0000-4000-8000-0000000000f1", name: "Repository", project_id: A.id };
const FOLDER_B = { id: "00000000-0000-4000-8000-0000000000f2", name: "Repository", project_id: B.id };

function run(id: string, name: string, fields: Partial<IngestionRunRow> = {}): IngestionRunRow {
  return {
    id, source_type: "upload", status: "succeeded", source_filename: `${name}.pdf`, display_name: name, folder_id: FOLDER_A.id,
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", input_payload: {}, ...fields,
  } as IngestionRunRow;
}

const click = (found: FoundElement | undefined) => {
  assert.ok(found, "the control is on the page");
  (found.props.onClick as () => void)();
};
const button = (tree: ReactNode, text: string) => elements(tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).trim().startsWith(text));

async function library(runs: IngestionRunRow[]) {
  const dom = installDom("https://papertrend.test/workspace/library");
  const switched: string[] = [];
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = {
    currentProject: A, hasActiveProject: true, selectedProjectId: A.id, allProjects: [A, B], allFolders: [FOLDER_A, FOLDER_B], folders: [FOLDER_A],
    setSelectedProjectId: (id: string) => void switched.push(id),
  };
  globalThis.__auditfixSearch = "";
  dom.window.respond = (url, init) => {
    if (url.startsWith("/api/workspace/library?includeTrashed=")) return { body: { runs } };
    if (url === "/api/workspace/library/bulk") return { body: { changed: JSON.parse(init?.body ?? "{}").runIds.length, skipped: 0 } };
    return { status: 404, body: {} };
  };
  const { default: Library } = await import("../src/components/admin/AdminImportClient");
  const page = mount(Library as (props: unknown) => ReactNode, {});
  await settle();
  return {
    dom,
    page,
    switched,
    done() {
      page.unmount();
      dom.restore();
    },
  };
}

test("the Library starts from the account's repositories, opens one without changing the app's, and uploads through the one dialog", async () => {
  const lib = await library([run("r1", "Peer feedback"), run("r2", "Fluency norms", { folder_id: FOLDER_B.id })]);
  try {
    const index = textOf(lib.page.tree);
    assert.match(index, /2 repositories/);
    assert.match(index, /Repositories are the top-level containers for this account\./);
    const listing = lib.dom.window.requests.find((request) => request.url.startsWith("/api/workspace/library?"));
    assert.equal(listing?.url, "/api/workspace/library?includeTrashed=false");
    assert.equal(listing?.init?.headers?.Authorization, "Bearer reader-token");

    click(elements(lib.page.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).includes(B.name)));
    await settle();
    assert.deepEqual(lib.switched, [], "the rest of the app stays on its repository");
    assert.match(textOf(lib.page.tree), /Fluency norms/);
    assert.doesNotMatch(textOf(lib.page.tree), /Peer feedback/);
    // Uploads go through the shared dialog, to the repository being browsed.
    const dialogs = elements(lib.page.tree).filter((found) => typeof found.type === "function" && (found.type as { name?: string }).name === "AnalyzeFlowModal");
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].props.projectId, B.id);
    // Folders are not a thing a reader manages here.
    assert.doesNotMatch(textOf(lib.page.tree), /New folder|Move to folder|Rename folder/);
    assert.ok(!lib.dom.window.requests.some((request) => request.url.includes("/api/admin/import/prepare")));
  } finally {
    lib.done();
  }
});

test("the Library selects, and acts on, only what is in view", async () => {
  const runs = [
    run("r1", "Peer feedback in writing"),
    run("r2", "Peer review of essays", { status: "failed", source_path: "gs://uploads/pending/Repository/r2/a.pdf" }),
    run("r3", "Peer talk in class", { status: "failed", source_path: null }),
    run("r4", "Vocabulary apps", { input_payload: { import_source: "google-drive" } }),
  ];
  const lib = await library(runs);
  try {
    click(elements(lib.page.tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).includes(A.name)));
    await settle();
    // A Drive paper is here, so the Source filter is offered.
    assert.ok(button(lib.page.tree, "Source"), "the Source filter");
    const search = elements(lib.page.tree).find((found) => found.type === "input" && found.props.type === "search")!;
    (search.props.onChange as (event: unknown) => void)({ target: { value: "Peer" } });
    const selectAll = elements(lib.page.tree).find((found) => found.props["aria-label"] === "Select every file shown")!;
    (selectAll.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    const shown = elements(lib.page.tree).filter((found) => typeof found.props["aria-label"] === "string" && /^Select (?!every)/.test(found.props["aria-label"] as string));
    assert.deepEqual([...new Set(shown.map((found) => found.props["aria-label"]))].sort(), ["Select Peer feedback in writing", "Select Peer review of essays", "Select Peer talk in class"]);
    // Only a failed paper whose file was stored can be tried again.
    assert.ok(button(lib.page.tree, "Try again (1)"), textOf(lib.page.tree).slice(0, 400));
    assert.ok(button(lib.page.tree, "Analyze again (1)"));

    click(button(lib.page.tree, "Move to Trash"));
    await settle();
    const bulk = lib.dom.window.requests.find((request) => request.url === "/api/workspace/library/bulk");
    assert.deepEqual(JSON.parse(bulk?.init?.body ?? "{}"), { action: "trash", runIds: ["r1", "r2", "r3"] }, "the hidden Vocabulary apps is not touched");
    assert.match(textOf(lib.page.tree), /Moved 3 papers to Trash\./);
  } finally {
    lib.done();
  }
});
