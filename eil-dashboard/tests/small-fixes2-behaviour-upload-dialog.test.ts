/*
 * The upload dialog and the Google Drive Picker, run (docs/32, long-term
 * health): AnalyzeFlowModal through stub-uia11y-hooks.ts against the stand-in
 * document and window of stub-uia11y-dom.ts, with the stub-auditfix-* sign-in,
 * workspace, theme and router. The real Picker module drives a stand-in of
 * Google's Picker and sign-in scripts; every request the dialog makes is
 * answered here, and storage refuses the first upload's link once.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import React, { type ReactNode } from "react";
import { stubModule } from "./support/route-harness";
import { dispatch, FakeElement, FakeEvent, installDom, press, settle } from "./support/stub-uia11y-dom";
import { elements, mount, textOf, type FoundElement } from "./support/stub-uia11y-hooks";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
(globalThis as { React?: typeof React }).React = React;

const PROJECT = { id: "00000000-0000-4000-8000-0000000000a1", name: "Assessment studies" };
const JOB = "00000000-0000-4000-8000-0000000000b1";

type Sent = { url: string; method: string; headers: Record<string, string>; body?: unknown };

/** Google's sign-in and Picker scripts, as far as the page uses them. */
function fakeGoogle() {
  const picker = { callback: null as null | ((data: Record<string, unknown>) => void), visible: [] as boolean[], disposed: 0 };
  class Builder {
    addView() { return this; }
    enableFeature() { return this; }
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setTitle() { return this; }
    setMaxItems() { return this; }
    setCallback(callback: (data: Record<string, unknown>) => void) {
      picker.callback = callback;
      return this;
    }
    build() {
      return { setVisible: (visible: boolean) => void picker.visible.push(visible), dispose: () => void (picker.disposed += 1) };
    }
  }
  class View {
    setMimeTypes() { return this; }
    setIncludeFolders() { return this; }
    setSelectFolderEnabled() { return this; }
  }
  const google = {
    accounts: { oauth2: { initTokenClient: (options: { callback: (response: { access_token?: string }) => void }) => ({ requestAccessToken: () => options.callback({ access_token: "drive-token" }) }) } },
    picker: {
      PickerBuilder: Builder,
      DocsView: View,
      ViewId: { DOCS: "docs" },
      Feature: { MULTISELECT_ENABLED: "multi", SUPPORT_DRIVES: "drives" },
      Action: { PICKED: "picked", CANCEL: "cancel" },
      Response: { ACTION: "action", DOCUMENTS: "docs" },
      Document: { ID: "id", NAME: "name", SIZE_BYTES: "sizeBytes", MIME_TYPE: "mimeType" },
    },
  };
  return { google, picker };
}

const click = (found: FoundElement | undefined) => {
  assert.ok(found, "the control is on the page");
  (found.props.onClick as () => void)();
};
const button = (tree: ReactNode, text: string) => elements(tree).find((found) => found.type === "button" && textOf(found.props.children as ReactNode).includes(text));

/** The dialog, open on the repository, in a page whose requests `answer` serves. */
async function openDialog(answer: (request: Sent) => { status?: number; body?: unknown; text?: string; blob?: Blob } | undefined) {
  const dom = installDom("https://papertrend.test/workspace/library");
  const { google, picker } = fakeGoogle();
  Object.assign(dom.window, { google, gapi: { load: (_name: string, ready: () => void) => ready() } });
  // Google's two scripts are already on the page.
  Object.assign(dom.document, { head: new FakeElement("HEAD"), querySelector: () => ({ dataset: { loaded: "true" } }) });
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
    sent.push(request);
    const reply = answer(request) ?? (request.url === "/api/workspace/library/room"
      ? { body: { used: 47, limit: 50, remaining: 3, exempt: false } }
      : request.url === "/api/integrations/google-drive/picker-config"
        ? { body: { enabled: true, clientId: "client", apiKey: "key", appId: "app" } }
        : { status: 404, body: {} });
    if (reply.blob) return new Response(reply.blob, { status: reply.status ?? 200 });
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  globalThis.__auditfixAuth = { user: { id: "00000000-0000-4000-8000-00000000000a", email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = { currentProject: PROJECT, hasActiveProject: true, selectedProjectId: PROJECT.id, allProjects: [PROJECT] };
  const { default: AnalyzeFlowModal } = await import("../src/components/workspace/AnalyzeFlowModal");
  const dialog = mount(AnalyzeFlowModal, { open: true, onClose: () => undefined, projectId: PROJECT.id });
  await settle();
  return {
    dom,
    dialog,
    picker,
    sent,
    choose(files: File[]) {
      const input = elements(dialog.tree).find((found) => found.type === "input" && found.props.type === "file")!;
      (input.props.onChange as (event: unknown) => void)({ target: { files, value: "" } });
    },
    done() {
      dialog.unmount();
      dom.restore();
    },
  };
}

const pdf = (name: string, text: string) => new File([`%PDF-1.7 ${text}`], name, { type: "application/pdf" });
const sha256 = async (file: File) => createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");

test("the upload dialog shows the room, fingerprints each file, records where it came from, renews a refused link and lists what was left out", async () => {
  const fromComputer = pdf("computer.pdf", "one");
  const duplicate = pdf("duplicate.pdf", "two");
  const page = await openDialog((request) => {
    if (request.url.startsWith("https://www.googleapis.com/drive/v3/files/drive-doc-1")) return { blob: new Blob(["%PDF-1.7 drive"]) };
    if (request.url === "/api/admin/import/prepare") {
      return {
        status: 201,
        body: {
          folderJob: { id: JOB },
          uploads: [0, 1].map((fileIndex) => ({ fileIndex, runId: `run-${fileIndex}`, storagePath: `gs://uploads/pending/Repository/run-${fileIndex}/paper.pdf`, signedUrl: `https://storage.test/put-${fileIndex}?sig=first`, fileName: `file-${fileIndex}` })),
          skipped: [{ fileIndex: 2, name: "duplicate.pdf", reason: 'Already analyzed in this account as "old.pdf".' }],
        },
      };
    }
    // Storage refuses the first link as expired; the renewed one works.
    if (request.url === "https://storage.test/put-0?sig=first") return { status: 400, text: "ExpiredToken" };
    if (request.url === "/api/admin/import/renew") return { body: { signedUrl: "https://storage.test/put-0?sig=renewed" } };
    if (request.url.startsWith("https://storage.test/")) return { status: 200, text: "" };
    if (request.url === "/api/admin/import/finalize") {
      return { status: 201, body: { runs: [{ id: "run-0", status: "queued", display_name: "computer.pdf" }, { id: "run-1", status: "queued" }], folderJob: { id: JOB, folder_id: "f1" }, warning: null } };
    }
    return undefined;
  });
  try {
    // Several at once, and nothing over 10 MB.
    const input = elements(page.dialog.tree).find((found) => found.type === "input" && found.props.type === "file")!;
    assert.equal(input.props.multiple, true);
    page.choose([fromComputer, new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.pdf", { type: "application/pdf" })]);
    assert.match(textOf(page.dialog.tree), /1 file was skipped\. Only PDFs of 10 MB or less can be added\./);
    assert.match(textOf(page.dialog.tree), /Room for 3 more papers in this account \(47 of 50 used, Trash included\)\./);

    // One from Google Drive.
    click(button(page.dialog.tree, "Choose from Google Drive"));
    await settle();
    page.picker.callback!({ action: "picked", docs: [{ id: "drive-doc-1", name: "From Drive.pdf", sizeBytes: 14 }] });
    await settle();
    page.choose([duplicate]);
    assert.match(textOf(page.dialog.tree), /3 PDFs selected/);

    click(button(page.dialog.tree, "Analyze 3 papers"));
    // Hashing runs on the thread pool, so wait for the outcome rather than a
    // fixed number of turns: under load a fixed count was not always enough.
    for (const started = Date.now(); !page.sent.some((request) => request.url === "/api/admin/import/finalize"); ) {
      if (Date.now() - started > 5_000) assert.fail("finalize was never sent");
      await settle();
    }
    await settle();
    const prepare = page.sent.find((request) => request.url === "/api/admin/import/prepare")!;
    const files = (prepare.body as { files: Array<{ name: string; sha256: string; drive_file_id: string | null }> }).files;
    assert.deepEqual(files.map((file) => [file.name, file.drive_file_id]), [["computer.pdf", null], ["From Drive.pdf", "drive-doc-1"], ["duplicate.pdf", null]]);
    assert.equal(files[0].sha256, await sha256(fromComputer));
    assert.equal(files[2].sha256, await sha256(duplicate));
    assert.match(files[1].sha256, /^[0-9a-f]{64}$/);

    const renew = page.sent.find((request) => request.url === "/api/admin/import/renew");
    assert.deepEqual(renew?.body, { folderJobId: JOB, runId: "run-0", storagePath: "gs://uploads/pending/Repository/run-0/paper.pdf" });
    assert.deepEqual(
      page.sent.filter((request) => request.method === "PUT").map((request) => request.url),
      ["https://storage.test/put-0?sig=first", "https://storage.test/put-0?sig=renewed", "https://storage.test/put-1?sig=first"]
    );
    const finalize = page.sent.find((request) => request.url === "/api/admin/import/finalize");
    assert.deepEqual((finalize?.body as { uploaded: Array<{ runId: string }> }).uploaded.map((item) => item.runId), ["run-0", "run-1"]);
    assert.match(textOf(page.dialog.tree), /1 file left out[\s\S]*duplicate\.pdf: Already analyzed in this account as "old\.pdf"\./);
  } finally {
    page.done();
  }
});

test("a stuck Drive Picker closes from the page, by Escape or its own button, and the reader is told why", async () => {
  const COOKIES = /Allow third-party cookies for this site in your browser's settings/;
  const page = await openDialog(() => undefined);
  try {
    const closeControl = () => page.dom.document.body.childNodes.find((node) => node instanceof FakeElement && node.attributes["aria-label"] === "Close Google Drive") as FakeElement | undefined;
    // The upload window's own Escape handler, which must not see this Escape.
    let windowClosed = 0;
    page.dom.window.addEventListener("keydown", (event) => void (event.key === "Escape" && (windowClosed += 1)));

    click(button(page.dialog.tree, "Choose from Google Drive"));
    await settle();
    assert.ok(closeControl(), "the page puts its own Close over the Picker");
    press("Enter");
    assert.ok(closeControl(), "another key leaves it open");
    const escape = press("Escape");
    await settle();
    assert.equal(escape.defaultPrevented, true);
    assert.equal(windowClosed, 0, "the upload window stays open");
    assert.equal(closeControl(), undefined, "the Close is taken away");
    assert.deepEqual(page.dom.window.listening("keydown").filter((entry) => entry.capture), [], "and so is its Escape");
    assert.deepEqual(page.picker.visible.at(-1), false);
    assert.equal(page.picker.disposed, 1, "the Picker is torn down");
    assert.match(textOf(page.dialog.tree), COOKIES);

    // Its own button does the same.
    click(button(page.dialog.tree, "Choose from Google Drive"));
    await settle();
    assert.doesNotMatch(textOf(page.dialog.tree), COOKIES, "a new try clears the message");
    dispatch(new FakeEvent("click", { target: closeControl()! }));
    await settle();
    assert.equal(closeControl(), undefined);
    assert.equal(page.picker.disposed, 2);
    assert.match(textOf(page.dialog.tree), COOKIES);

    // Closed with Google's own control, nothing went wrong: nothing to explain.
    click(button(page.dialog.tree, "Choose from Google Drive"));
    await settle();
    page.picker.callback!({ action: "cancel" });
    await settle();
    assert.equal(closeControl(), undefined);
    assert.doesNotMatch(textOf(page.dialog.tree), COOKIES);
  } finally {
    page.done();
  }
});
