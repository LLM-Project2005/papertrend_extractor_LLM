"use client";

import { useEffect, useState, type ReactNode } from "react";

interface DocsFixedRailProps {
  children: ReactNode;
  side: "left" | "right";
}

export default function DocsFixedRail({ children, side }: DocsFixedRailProps) {
  const [footerOffset, setFooterOffset] = useState(0);

  useEffect(() => {
    let frameId = 0;

    function updateFooterOffset() {
      window.cancelAnimationFrame(frameId);

      frameId = window.requestAnimationFrame(() => {
        const footer = document.querySelector<HTMLElement>("[data-site-footer]");

        if (!footer) {
          setFooterOffset(0);
          return;
        }

        const footerTop = footer.getBoundingClientRect().top;
        const overlap = Math.max(0, window.innerHeight - footerTop);
        setFooterOffset(overlap);
      });
    }

    updateFooterOffset();
    window.addEventListener("scroll", updateFooterOffset, { passive: true });
    window.addEventListener("resize", updateFooterOffset);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", updateFooterOffset);
      window.removeEventListener("resize", updateFooterOffset);
    };
  }, []);

  const sideClass =
    side === "left"
      ? "left-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))] w-[260px] pr-4 lg:block"
      : "right-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))] w-[220px] border-l border-slate-200 pl-5 dark:border-[#1f1f1f] xl:block";

  return (
    <aside
      className={`fixed top-20 z-20 hidden h-[calc(100vh-5rem)] overflow-y-hidden overscroll-contain transition-transform duration-75 hover:overflow-y-auto focus-within:overflow-y-auto ${sideClass}`}
      style={{
        transform: footerOffset ? `translateY(-${footerOffset}px)` : undefined,
      }}
    >
      {children}
    </aside>
  );
}
