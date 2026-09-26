"use client";

import { useEffect, useState } from "react";
import type { DocsSection } from "@/lib/docs-content";

/**
 * The page's own contents, with the section being read marked.
 *
 * An IntersectionObserver reports which headings sit in the top band of the
 * viewport, so nothing runs on every scroll event. The list sits in a sticky
 * column, so it needs no positioning script either.
 */
export default function DocsOnThisPage({
  sections,
}: {
  sections: Pick<DocsSection, "id" | "title">[];
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return undefined;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        const topmost = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        if (topmost) setActiveId(topmost[0]);
      },
      // A heading counts as "being read" from just under the header to about a
      // third of the way down the screen.
      { rootMargin: "-88px 0px -62% 0px", threshold: 0 }
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 2) return null;

  return (
    <div>
      <p className="text-xs font-medium text-mute">On this page</p>
      {/* py-1 on each link rather than a gap between them: the gap was dead space
          a pointer could not use, so every entry was a 20px-tall target. */}
      <nav aria-label="On this page" className="mt-3 space-y-1 border-l border-hairline">
        {sections.map((section) => {
          const active = section.id === activeId;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => setActiveId(section.id)}
              aria-current={active ? "location" : undefined}
              className={`block py-1 text-sm leading-5 -ml-px border-l pl-3 transition-colors duration-150 ${
                active
                  ? "border-ink font-medium text-ink"
                  : "border-transparent text-mute hover:border-hairline-strong hover:text-ink"
              }`}
            >
              {section.title}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
