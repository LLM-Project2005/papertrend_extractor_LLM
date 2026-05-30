import Link from "next/link";
import type { ReactNode } from "react";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { footerLinks, marketingFeatures } from "@/components/marketing/marketing-content";
import { LogoMarkIcon } from "@/components/ui/Icons";
import ThemeToggle from "@/components/theme/ThemeToggle";
import WorkspaceProfileMenu from "@/components/workspace/WorkspaceProfileMenu";

interface MarketingNavProps {
  activeSlug?: string;
}

export function MarketingNav({ activeSlug }: MarketingNavProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-xl dark:border-[#1f1f1f] dark:bg-black/90">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="Papertrend home">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-slate-200 bg-white text-black dark:border-[#2a2a2a]">
            <LogoMarkIcon className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold text-slate-950 dark:text-white">Papertrend</span>
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 md:flex">
          {marketingFeatures.map((feature) => (
            <Link
              key={feature.slug}
              href={`/features/${feature.slug}`}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                activeSlug === feature.slug
                  ? "bg-slate-950 text-white dark:bg-white dark:text-[#171717]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-[#a3a3a3] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
              }`}
            >
              {feature.navLabel}
            </Link>
          ))}
          <Link
            href="/docs"
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              activeSlug === "docs"
                ? "bg-slate-950 text-white dark:bg-white dark:text-[#171717]"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-[#a3a3a3] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
            }`}
          >
            Docs
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <MarketingCTA className="hidden sm:inline-flex" />
          <WorkspaceProfileMenu variant="marketing" />
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer
      data-site-footer
      className="border-t border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-black"
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_1.2fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-black dark:border-[#2a2a2a]">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-slate-950 dark:text-white">Papertrend</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
            Research intelligence for teams that need to turn paper collections into
            reusable analysis, dashboards, and AI-assisted insight.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}

export function MarketingShell({
  children,
  activeSlug,
}: {
  children: ReactNode;
  activeSlug?: string;
}) {
  return (
    <div className="marketing-shell min-h-screen overflow-hidden bg-white text-slate-950 dark:bg-black dark:text-white">
      <MarketingNav activeSlug={activeSlug} />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
