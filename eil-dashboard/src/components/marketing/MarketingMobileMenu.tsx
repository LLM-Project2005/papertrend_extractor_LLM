"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { marketingFeatures } from "@/components/marketing/marketing-content";
import { CloseIcon, MenuIcon } from "@/components/ui/Icons";

export default function MarketingMobileMenu({ immersive = false }: { immersive?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-10 w-10 items-center justify-center border ${immersive ? "border-white/25 text-white" : "border-papertrend-line text-papertrend-ink"}`}
        aria-expanded={open}
        aria-controls="marketing-mobile-menu"
        aria-label={open ? "Close navigation" : "Open navigation"}
      >
        {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.nav
            id="marketing-mobile-menu"
            aria-label="Mobile navigation"
            className="fixed inset-x-0 top-16 z-50 border-b border-papertrend-line bg-papertrend-surface px-4 py-5 text-papertrend-ink shadow-overlay"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mx-auto max-w-7xl divide-y divide-papertrend-line border-y border-papertrend-line">
              {marketingFeatures.map((feature, index) => (
                <Link
                  key={feature.slug}
                  href={`/features/${feature.slug}`}
                  onClick={() => setOpen(false)}
                  className="grid min-h-14 grid-cols-[36px_minmax(0,1fr)] items-center gap-3 py-3 text-sm font-semibold"
                >
                  <span className="font-mono text-xs text-papertrend-muted">0{index + 1}</span>
                  {feature.navLabel}
                </Link>
              ))}
              <Link href="/docs" onClick={() => setOpen(false)} className="grid min-h-14 grid-cols-[36px_minmax(0,1fr)] items-center gap-3 py-3 text-sm font-semibold">
                <span className="font-mono text-xs text-papertrend-muted">05</span>
                Documentation
              </Link>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
