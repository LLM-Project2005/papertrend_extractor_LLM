/*
 * Choosing PDFs from Google Drive, in the browser.
 *
 * Google's own Picker shows the reader's Drive; the app is granted the
 * drive.file scope, which covers only the files picked (no Google security
 * review is needed for it, and nothing else in the Drive is readable). The
 * chosen PDFs are downloaded here and handed to the ordinary upload path, so
 * duplicate checks, the account allowance and size limits apply exactly as
 * they do to a file from the computer.
 *
 * Configuration (an OAuth client ID, a browser API key restricted to the
 * Picker API, and the Cloud project number) is read from the server at run
 * time; without it the Drive button is not shown.
 */

export interface DrivePickerConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

export interface PickedDriveFile {
  file: File;
}

export class DrivePickerCancelled extends Error {
  /**
   * True when the reader closed the Picker with this page's own Close button
   * (or Escape) rather than Google's. That is the way out when the Picker is
   * stuck, which happens when the browser blocks Google's cookies inside the
   * page: the Picker asks to sign in again, and a file chosen in its sign-in
   * window never reaches the page.
   */
  constructor(readonly closedByPage = false) {
    super("No files were chosen.");
  }
}

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_BYTES = 10 * 1024 * 1024;

type GoogleGlobal = {
  accounts: {
    oauth2: {
      initTokenClient: (options: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; error?: string }) => void;
        error_callback?: (error: { type?: string }) => void;
      }) => { requestAccessToken: (options?: { prompt?: string }) => void };
    };
  };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (viewId?: unknown) => DocsView;
    ViewId: { DOCS: unknown };
    Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES: unknown };
    Action: { PICKED: string; CANCEL: string };
    Response: { ACTION: string; DOCUMENTS: string };
    Document: { ID: string; NAME: string; SIZE_BYTES: string; MIME_TYPE: string };
  };
};

type DocsView = {
  setMimeTypes: (types: string) => DocsView;
  setIncludeFolders: (value: boolean) => DocsView;
  setSelectFolderEnabled: (value: boolean) => DocsView;
};

type PickerBuilder = {
  addView: (view: DocsView) => PickerBuilder;
  enableFeature: (feature: unknown) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setMaxItems: (count: number) => PickerBuilder;
  setCallback: (callback: (data: Record<string, unknown>) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void; dispose?: () => void };
};

declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: { load: (name: string, callback: () => void) => void };
  }
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Google Drive could not be reached. Check your connection and try again."));
    if (!existing) document.head.appendChild(script);
  });
}

async function loadGoogle(): Promise<GoogleGlobal> {
  await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
  await new Promise<void>((resolve) => window.gapi!.load("picker", resolve));
  if (!window.google?.picker || !window.google.accounts) {
    throw new Error("Google Drive could not be opened. Try again in a moment.");
  }
  return window.google;
}

function requestToken(google: GoogleGlobal, clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.access_token) resolve(response.access_token);
        else reject(new Error("Google did not grant access to Drive."));
      },
      error_callback: (error) => {
        reject(error.type === "popup_closed" ? new DrivePickerCancelled() : new Error("Google did not grant access to Drive."));
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

interface PickedDocument {
  id: string;
  name: string;
  sizeBytes: number;
}

/**
 * A Close button of this page's own, over Google's Picker, and Escape.
 * Google's close control lives inside its frame; when the Picker is stuck
 * (see DrivePickerCancelled) that frame may show only a sign-in prompt, and
 * there was no way out of the dialog.
 */
function addPageCloseControl(onClose: () => void): () => void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "drive-picker-close";
  button.textContent = "Close Google Drive";
  button.setAttribute("aria-label", "Close Google Drive");
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };
  button.addEventListener("click", onClose);
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(button);
  return () => {
    button.removeEventListener("click", onClose);
    document.removeEventListener("keydown", onKey, true);
    button.remove();
  };
}

function showPicker(google: GoogleGlobal, config: DrivePickerConfig, token: string, maxItems: number): Promise<PickedDocument[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let removeCloseControl: () => void = () => undefined;
    let pickerHandle: { setVisible: (visible: boolean) => void; dispose?: () => void } | null = null;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      removeCloseControl();
      try {
        pickerHandle?.setVisible(false);
        pickerHandle?.dispose?.();
      } catch {
        // The Picker may already have closed itself.
      }
      outcome();
    };
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes("application/pdf")
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setTitle("Choose PDFs to analyze")
      .setMaxItems(maxItems)
      .setCallback((data) => {
        const action = data[google.picker.Response.ACTION];
        if (action === google.picker.Action.CANCEL) finish(() => reject(new DrivePickerCancelled()));
        if (action !== google.picker.Action.PICKED) return;
        const documents = (data[google.picker.Response.DOCUMENTS] as Array<Record<string, unknown>>) ?? [];
        finish(() =>
          resolve(
            documents.map((document) => ({
              id: String(document[google.picker.Document.ID]),
              name: String(document[google.picker.Document.NAME] ?? "Drive file.pdf"),
              sizeBytes: Number(document[google.picker.Document.SIZE_BYTES] ?? 0),
            }))
          )
        );
      })
      .build();
    pickerHandle = picker;
    removeCloseControl = addPageCloseControl(() => finish(() => reject(new DrivePickerCancelled(true))));
    picker.setVisible(true);
  });
}

/**
 * Lets the reader pick PDFs in Google Drive and returns them as files ready
 * for the upload dialog. Files over 10 MB are returned in `tooLarge` rather
 * than downloaded, so the reader hears why they were left out.
 */
export async function pickPdfsFromDrive(
  config: DrivePickerConfig,
  options: { maxItems: number; onProgress?: (done: number, total: number) => void }
): Promise<{ files: File[]; tooLarge: string[] }> {
  const google = await loadGoogle();
  const token = await requestToken(google, config.clientId);
  const picked = await showPicker(google, config, token, options.maxItems);
  const tooLarge = picked.filter((document) => document.sizeBytes > MAX_BYTES).map((document) => document.name);
  const wanted = picked.filter((document) => document.sizeBytes <= MAX_BYTES);
  const files: File[] = [];
  let done = 0;
  options.onProgress?.(0, wanted.length);
  for (const document of wanted) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`"${document.name}" could not be downloaded from Drive.`);
    const blob = await response.blob();
    const name = document.name.toLowerCase().endsWith(".pdf") ? document.name : `${document.name}.pdf`;
    files.push(new File([blob], name, { type: "application/pdf" }));
    done += 1;
    options.onProgress?.(done, wanted.length);
  }
  return { files, tooLarge };
}
