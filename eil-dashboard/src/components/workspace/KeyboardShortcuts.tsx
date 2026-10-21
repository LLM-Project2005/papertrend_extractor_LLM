"use client";

/*
 * "?" lists the workspace's keyboard shortcuts (2026-10-21). The list is the
 * shortcuts the pages really have; a test checks each one against its code.
 */
// React in scope: the test runner compiles JSX the classic way.
import React, { useEffect, useState } from "react";
import Modal, { hasOpenDialog } from "@/components/ui/Modal";
import { CloseIcon } from "@/components/ui/Icons";
import { iconButtonClass } from "@/components/ui/controls";

/** True when a key press belongs to a field: "/" and "?" are just characters there. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return Boolean(element.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}

/** Ctrl+K, or ⌘K on a Mac: search from anywhere, even from a field. */
export function isSearchShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}

type Shortcut = { keys: string[][]; label: string };

/** Each entry's keys are alternatives; the keys inside one are pressed together. */
export function shortcutGroups(mac: boolean): Array<{ title: string; items: Shortcut[] }> {
  const mod = mac ? "⌘" : "Ctrl";
  return [
    {
      title: "Anywhere in the workspace",
      items: [
        { keys: [["/"], [mod, "K"]], label: "Search papers, pages and repositories" },
        { keys: [["?"]], label: "Show these shortcuts" },
        { keys: [["Esc"]], label: "Close a dialog, menu or search" },
      ],
    },
    {
      title: "Search and the repository list",
      items: [
        { keys: [["↑"], ["↓"]], label: "Move through the results" },
        { keys: [["Home"], ["End"]], label: "First or last result" },
        { keys: [["Enter"]], label: "Open the result" },
      ],
    },
    {
      title: "An open paper",
      items: [
        { keys: [["←"], ["→"]], label: "Previous or next paper in the list it was opened from" },
      ],
    },
    {
      title: "Chat",
      items: [
        { keys: [["Enter"]], label: "Send the question" },
        { keys: [["Shift", "Enter"]], label: "New line" },
      ],
    },
  ];
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function ShortcutsList({ mac }: { mac: boolean }) {
  return (
    <div className="space-y-5">
      {shortcutGroups(mac).map((group) => (
        <section key={group.title}>
          <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-mute">{group.title}</h3>
          <dl className="mt-2 divide-y divide-hairline">
            {group.items.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 py-2">
                <dt className="text-sm text-body">{item.label}</dt>
                <dd className="flex flex-none items-center gap-1.5 text-xs text-mute">
                  {item.keys.map((combo, index) => (
                    <span key={combo.join("+")} className="flex items-center gap-1">
                      {index > 0 ? <span aria-hidden>or</span> : null}
                      {combo.map((key) => (
                        <kbd key={key} className="min-w-[1.5rem] rounded border border-hairline bg-subtle px-1.5 py-0.5 text-center font-mono text-[11px] text-ink">
                          {key}
                        </kbd>
                      ))}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

const OPEN_EVENT = "papertrend:keyboard-shortcuts";

/** Opens the list from a menu item. */
export function openKeyboardShortcuts(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(isMac());
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || hasOpenDialog()) return;
      event.preventDefault();
      setOpen(true);
    }
    const show = () => setOpen(true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, []);
  if (!open) return null;
  return (
    <Modal onClose={() => setOpen(false)}>
      <div className="max-h-[85vh] w-[min(520px,92vw)] overflow-y-auto rounded-xl border border-hairline bg-surface px-6 py-5 shadow-overlay">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-ink">Keyboard shortcuts</h2>
          <button type="button" onClick={() => setOpen(false)} className={iconButtonClass("md")} aria-label="Close keyboard shortcuts">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <ShortcutsList mac={mac} />
      </div>
    </Modal>
  );
}
