"use client";

import { useEffect, useState } from "react";
import type { DocsSection } from "@/lib/docs-content";
import DocsFixedRail from "@/components/docs/DocsFixedRail";

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
    <DocsFixedRail side="right">
      <p className="font-mono text-[10px] uppercase text-papertrend-muted">
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
                  ? "border-l-2 border-papertrend-cyan pl-3 font-semibold text-papertrend-ink"
                  : "border-l-2 border-transparent pl-3 font-normal text-papertrend-muted hover:text-papertrend-ink"
              }`}
            >
              {section.title}
            </a>
          );
        })}
      </nav>
    </DocsFixedRail>
  );
}
