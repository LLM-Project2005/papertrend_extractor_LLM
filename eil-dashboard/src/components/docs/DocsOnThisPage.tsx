"use client";

import { useEffect, useState } from "react";
import type { DocsSection } from "@/lib/docs-content";

export default function DocsOnThisPage({
  sections,
}: {
  sections: Pick<DocsSection, "id" | "title">[];
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    if (sections.length === 0) return undefined;

    const sectionIds = new Set(sections.map((section) => section.id));
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (elements.length === 0) return undefined;

    function updateActiveSection() {
      const visibleSection = elements
        .map((element) => ({
          id: element.id,
          top: element.getBoundingClientRect().top,
        }))
        .filter((item) => item.top <= 140)
        .sort((a, b) => b.top - a.top)[0];

      if (visibleSection && sectionIds.has(visibleSection.id)) {
        setActiveId(visibleSection.id);
        return;
      }

      const nextSection = elements
        .map((element) => ({
          id: element.id,
          top: element.getBoundingClientRect().top,
        }))
        .filter((item) => item.top > 140)
        .sort((a, b) => a.top - b.top)[0];

      if (nextSection && sectionIds.has(nextSection.id)) {
        setActiveId(nextSection.id);
      }
    }

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);

    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [sections]);

  return (
    <aside className="fixed right-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))] top-20 z-20 hidden h-[calc(100vh-5rem)] w-[220px] overflow-y-hidden overscroll-contain border-l border-slate-200 pl-5 hover:overflow-y-auto focus-within:overflow-y-auto dark:border-[#1f1f1f] xl:block">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-400 dark:text-[#666666]">
        On this page
      </p>
      <nav className="mt-3 space-y-2">
        {sections.map((section) => {
          const active = section.id === activeId;

          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => setActiveId(section.id)}
              className={`block text-sm leading-5 transition-colors ${
                active
                  ? "font-semibold text-slate-950 dark:text-white"
                  : "font-normal text-slate-500 hover:text-slate-950 dark:text-[#8f8f8f] dark:hover:text-white"
              }`}
            >
              {section.title}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
