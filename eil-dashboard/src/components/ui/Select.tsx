"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "@/components/ui/Icons";
import { menuItemClass, menuPanelClass } from "@/components/ui/controls";

/*
 * A dropdown in the product's own style, in place of the browser's <select>,
 * whose open list is drawn by the operating system (a blue highlight on a
 * square list that ignores the theme). This one opens a rounded panel like
 * the chat + menu, with a soft highlight and a check on the chosen option.
 *
 * It follows the listbox pattern: the button says it opens a listbox and
 * whether it is open; arrow keys, Home and End move the highlight; Enter or
 * Space chooses; Escape or Tab closes and focus returns to the button;
 * typing a letter jumps to the next option that starts with it.
 */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A second line under the label, for options that need explaining. */
  description?: string;
  /** Shown before the label, in the button and the list. */
  icon?: ReactNode;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** The accessible name, when the button's text alone would not say what it sets. */
  label: string;
  /** Opens above the button, for controls near the bottom of the screen. */
  placement?: "bottom" | "top";
  align?: "start" | "end";
  /** Text before the value inside the button, such as "Color:". */
  prefix?: string;
  size?: "sm" | "md";
  className?: string;
  panelClassName?: string;
}

export default function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  placement = "bottom",
  align = "start",
  prefix,
  size = "md",
  className = "",
  panelClassName = "",
}: SelectProps<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    listRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + step + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      for (let offset = 1; offset <= options.length; offset += 1) {
        const index = (activeIndex + offset) % options.length;
        if (options[index].label.toLowerCase().startsWith(letter)) {
          setActiveIndex(index);
          break;
        }
      }
    }
  }

  const height = size === "sm" ? "h-8 text-xs" : "h-9 text-sm";

  return (
    <div ref={containerRef} className={`relative inline-flex ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? ""}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex ${height} w-full min-w-0 items-center gap-2 rounded-lg border border-hairline bg-surface px-3 font-medium text-ink transition-[border-color,background-color] duration-150 hover:border-hairline-strong`}
      >
        {selected?.icon ? <span className="flex-none">{selected.icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-left">
          {prefix ? <span className="font-normal text-mute">{prefix} </span> : null}
          {selected?.label}
        </span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 flex-none text-mute transition-transform duration-200 ease-out-expo ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-option-${activeIndex}`}
          onKeyDown={onListKeyDown}
          className={`${menuPanelClass} absolute z-50 max-h-72 min-w-full overflow-y-auto outline-none ${
            placement === "top" ? "bottom-full mb-2 origin-bottom" : "top-full mt-2 origin-top"
          } ${align === "end" ? "right-0" : "left-0"} ${panelClassName}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(index)}
                className={menuItemClass(index === activeIndex, "cursor-pointer")}
              >
                {option.icon ? <span className="flex-none text-body">{option.icon}</span> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.description ? (
                    <span className="mt-0.5 block text-xs font-normal leading-5 text-mute">{option.description}</span>
                  ) : null}
                </span>
                <CheckIcon className={`h-4 w-4 flex-none text-ink ${isSelected ? "opacity-100" : "opacity-0"}`} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
