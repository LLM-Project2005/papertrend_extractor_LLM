import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a menu closes when the reader presses anywhere outside it", () => {
  const hook = read("src/hooks/useDismiss.ts");
  assert.match(hook, /document\.addEventListener\("pointerdown", onPointerDown, true\)/, "caught before any control can stop it");
  assert.match(hook, /if \(target instanceof Node && container\.current\?\.contains\(target\)\) return;/, "a press inside, the button included, is left alone");
  assert.match(hook, /if \(event\.key === "Escape"\) onDismissRef\.current\(\);/);

  // The chat's "+" menu, the conversation menu and each conversation's "..." menu.
  const chat = read("src/components/chat/ChatClient.tsx");
  assert.match(chat, /useDismiss\(menuOpen, \(\) => setMenuOpen\(false\), toolMenuRef\);/);
  assert.match(chat, /useDismiss\(conversationMenuOpen, \(\) => setConversationMenuOpen\(false\), conversationMenuRef\);/);
  assert.match(chat, /useDismiss\(Boolean\(threadMenuId\), \(\) => setThreadMenuId\(null\), threadMenuRef\);/);
  assert.match(chat, /<div className="relative" ref=\{toolMenuRef\}>\s*<button[\s\S]{0,200}setMenuOpen\(\(current\) => !current\)/, "the ref holds the + button too");
  assert.match(chat, /ref=\{threadMenuId === thread\.id \? threadMenuRef : undefined\}/);
});

test("the other menus already close on an outside press", () => {
  // Shared Select, search, the account menu, the Library's menus (a full-page
  // layer under the menu) and the dashboard's filter panel.
  assert.match(read("src/components/ui/Select.tsx"), /(pointerdown|mousedown)/);
  assert.match(read("src/components/workspace/WorkspaceGlobalSearch.tsx"), /(pointerdown|mousedown)/);
  assert.match(read("src/components/workspace/WorkspaceProfileMenu.tsx"), /(pointerdown|mousedown)/);
  assert.match(read("src/components/admin/AdminImportClient.tsx"), /className="fixed inset-0 z-40"/);
  assert.match(read("src/components/DashboardClient.tsx"), /onClick=\{\(\) => setFilterOpen\(false\)\}/);
});
