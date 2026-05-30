"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

interface DocsFixedRailProps {
  children: ReactNode;
  side: "left" | "right";
}

const RAIL_TOP_PX = 80;

export default function DocsFixedRail({ children, side }: DocsFixedRailProps) {
  const [railStyle, setRailStyle] = useState<CSSProperties>({
    position: "fixed",
    top: RAIL_TOP_PX,
  });

  useEffect(() => {
    let frameId = 0;

    function updateRailPosition() {
      window.cancelAnimationFrame(frameId);

      frameId = window.requestAnimationFrame(() => {
        const footer = document.querySelector<HTMLElement>("[data-site-footer]");

        if (!footer) {
          setRailStyle({
            position: "fixed",
            top: RAIL_TOP_PX,
          });
          return;
        }

        const footerTop = footer.getBoundingClientRect().top;
        const railHeight = Math.max(0, window.innerHeight - RAIL_TOP_PX);

        if (footerTop <= window.innerHeight) {
          setRailStyle({
            position: "absolute",
            top: window.scrollY + footerTop - railHeight,
          });
          return;
        }

        setRailStyle({
          position: "fixed",
          top: RAIL_TOP_PX,
        });
      });
    }

    updateRailPosition();
    window.addEventListener("scroll", updateRailPosition, { passive: true });
    window.addEventListener("resize", updateRailPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", updateRailPosition);
      window.removeEventListener("resize", updateRailPosition);
    };
  }, []);

  const sideClass =
    side === "left"
      ? "left-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))] w-[260px] pr-4 lg:block"
      : "right-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))] w-[220px] border-l border-slate-200 pl-5 dark:border-[#1f1f1f] xl:block";

  return (
    <aside
      className={`z-20 hidden h-[calc(100vh-5rem)] overflow-y-hidden overscroll-contain hover:overflow-y-auto focus-within:overflow-y-auto ${sideClass}`}
      style={railStyle}
    >
      {children}
    </aside>
  );
}
