import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/** Escape closes only the topmost layer, and overlays keep focus (docs/32, 2.9). */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("a dialog layer closes only on an Escape that is its own", () => {
  const modal = read("src/components/ui/Modal.tsx");
  const hook = modal.slice(modal.indexOf("export function useDialogLayer("), modal.indexOf("export default function Modal("));
  assert.match(hook, /if \(openModals\[openModals\.length - 1\] !== layerId \|\| event\.defaultPrevented\) return;/, "top layer only, and not a handled Escape");
  assert.match(hook, /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*onCloseRef\.current\(\);/, "and marks the Escape it handled");
  assert.match(hook, /previouslyFocused\?\.focus\(\{ preventScroll: true \}\);/, "focus goes back");
  assert.match(hook, /document\.body\.style\.overflow = "hidden";/);
  assert.match(modal, /useDialogLayer\(mounted, containerRef, onClose\);/, "the Modal itself is a layer");
  assert.match(modal, /export function hasOpenDialog\(\): boolean \{\s*return openModals\.length > 0;/);
});

test("menus mark the Escape they handle, and always-on listeners act only while open", () => {
  assert.match(read("src/hooks/useDismiss.ts"), /if \(event\.key !== "Escape" \|\| event\.defaultPrevented\) return;\s*event\.preventDefault\(\);/);
  assert.match(read("src/components/ui/Select.tsx"), /preventDefault/);
  assert.match(read("src/components/workspace/WorkspaceProfileMenu.tsx"), /if \(event\.key !== "Escape" \|\| !openRef\.current \|\| event\.defaultPrevented\) return;\s*event\.preventDefault\(\);/);
  const search = read("src/components/workspace/WorkspaceGlobalSearch.tsx");
  assert.match(search, /if \(!openRef\.current \|\| event\.defaultPrevented\) return;\s*event\.preventDefault\(\);/);
  assert.match(search, /event\.key === "\/" && !event\.metaKey && !event\.ctrlKey && !event\.altKey && !hasOpenDialog\(\)/, "no search over an open dialog");
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /if \(event\.key !== "Escape" \|\| event\.defaultPrevented\) return;\s*event\.preventDefault\(\);\s*setMenuOpen\(false\);/);
});

test("the hand-built overlays are dialog layers", () => {
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /useDialogLayer\(sidebarOpen && drawerIsOverlay, drawerRef, \(\) => setSidebarOpen\(false\)\);/);
  assert.match(shell, /ref=\{drawerRef\}\s+role="dialog"/);
  assert.doesNotMatch(shell, /if \(event\.key === "Escape"\) setSidebarOpen\(false\);/, "its own Escape handler is gone");
  const dashboard = read("src/components/DashboardClient.tsx");
  assert.match(dashboard, /useDialogLayer\(filterOpen && filterSheetIsOverlay && !isSemanticMapTab, filterSheetRef, \(\) => setFilterOpen\(false\)\);/);
  assert.match(dashboard, /const filterSheetIsOverlay = useIsNarrow\(1280\);/, "only below xl, where the sheet shows");
  assert.match(dashboard, /ref=\{filterSheetRef\}\s+role="dialog"/);
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /useDialogLayer\(reportFullViewOpen, reportViewRef, \(\) => setReportFullViewOpen\(false\)\);/);
  assert.match(chat, /ref=\{reportViewRef\}\s+role="dialog"/);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}

test("every aria-modal overlay is a dialog layer", () => {
  for (const path of sourceFiles(join(root, "src"))) {
    const text = readFileSync(path, "utf8");
    if (!text.includes('aria-modal="true"')) continue;
    const relative = path.replaceAll("\\", "/").replace(/.*\/src\//, "src/");
    assert.ok(relative === "src/components/ui/Modal.tsx" || /useDialogLayer\(/.test(text), `${relative} declares a modal without the layer`);
  }
});
