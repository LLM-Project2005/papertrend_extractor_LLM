"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useId, useState, type ReactNode } from "react";
import { EASE } from "@/components/marketing/kit/motion";
import { ChevronDownIcon } from "@/components/ui/Icons";

/*
 * The technical half of an explanation, folded away until asked for. The
 * plain account is always on the page; a reader who wants the model, the
 * method or the number opens it here. Its text stays in the document while
 * closed (hidden, not removed), so find-in-page and search engines see it.
 */
export default function UnderTheHood({
  children,
  label = "Under the hood",
  className = "",
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="group -mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {label}
        <ChevronDownIcon
          className={`h-3.5 w-3.5 transition-transform duration-300 ease-out-expo ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="open"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.36, ease: EASE }}
            className="overflow-hidden"
          >
            <div id={id} className="mt-2 rounded-xl border border-dashed border-hairline-strong bg-subtle/60 px-4 py-3.5 text-[13.5px] leading-[1.65] text-body">
              {children}
            </div>
          </motion.div>
        ) : (
          <div id={id} hidden>
            {children}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
