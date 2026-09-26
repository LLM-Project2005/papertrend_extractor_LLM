import Link from "next/link";
import type { ReactNode } from "react";
import MarketingCTA from "@/components/marketing/MarketingCTA";
import { footerLinks, marketingFeatures } from "@/components/marketing/marketing-content";
import { LogoMarkIcon, MenuIcon } from "@/components/ui/Icons";
import ThemeToggle from "@/components/theme/ThemeToggle";
import WorkspaceProfileMenu from "@/components/workspace/WorkspaceProfileMenu";

interface MarketingNavProps {
  activeSlug?: string;
  /** Match the documentation's wider three-column layout. */
  wide?: boolean;
}

function navLinkClass(active: boolean) {
  return `rounded-full px-3 py-1.5 text-sm transition-colors duration-150 ${
    active ? "bg-subtle font-medium text-ink" : "text-body hover:text-ink"
  }`;
}

export function MarketingNav({ activeSlug, wide = false }: MarketingNavProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-hairline/70 bg-white/75 backdrop-blur-md backdrop-saturate-150 dark:bg-black/70">
      <div className={`mx-auto flex h-16 items-center justify-between gap-4 px-4 sm:px-6 ${wide ? "max-w-[1240px]" : "max-w-6xl"}`}>
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="Papertrend home">
          <LogoMarkIcon className="h-6 w-6 flex-none text-ink" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">Papertrend</span>
        </Link>

        <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 md:flex">
          {marketingFeatures.map((feature) => (
            <Link
              key={feature.slug}
              href={`/features/${feature.slug}`}
              aria-current={activeSlug === feature.slug ? "page" : undefined}
              className={navLinkClass(activeSlug === feature.slug)}
            >
              {feature.navLabel}
            </Link>
          ))}
          <Link href="/docs" aria-current={activeSlug === "docs" ? "page" : undefined} className={navLinkClass(activeSlug === "docs")}>
            Docs
          </Link>
        </nav>

        <div className="flex items-center gap-1.5">
          <ThemeToggle compact />
          <WorkspaceProfileMenu variant="marketing" />
          <MarketingCTA className="hidden sm:inline-flex" />
          {/* No JavaScript needed to open the menu on a phone. */}
          <details className="group relative md:hidden">
            <summary
              className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-body transition-colors hover:bg-subtle hover:text-ink [&::-webkit-details-marker]:hidden"
              aria-label="Open navigation"
            >
              <MenuIcon className="h-4 w-4" />
            </summary>
            <nav
              aria-label="Mobile"
              className="absolute right-0 top-11 z-50 w-64 origin-top-right rounded-xl border border-hairline bg-surface p-1.5 shadow-overlay motion-safe:animate-scale-in"
            >
              {marketingFeatures.map((feature) => (
                <Link
                  key={feature.slug}
                  href={`/features/${feature.slug}`}
                  className={`block rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    activeSlug === feature.slug ? "bg-subtle font-medium text-ink" : "text-body hover:bg-subtle hover:text-ink"
                  }`}
                >
                  {feature.navLabel}
                </Link>
              ))}
              <Link href="/docs" className="block rounded-lg px-3 py-2.5 text-sm text-body transition-colors hover:bg-subtle hover:text-ink">
                Docs
              </Link>
              <div className="mt-1.5 border-t border-hairline p-1.5 pt-3">
                <MarketingCTA className="w-full" />
              </div>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

const FOOTER_GROUPS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  { title: "Product", links: footerLinks.filter((link) => link.href.startsWith("/features")) },
  {
    title: "Documentation",
    links: [
      { label: "Getting started", href: "/docs/getting-started" },
      ...footerLinks.filter((link) => link.href.startsWith("/docs")),
      { label: "Troubleshooting", href: "/docs/troubleshooting" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Repositories", href: "/workspaces" },
      { label: "Settings", href: "/workspace/settings" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer data-site-footer className="border-t border-hairline bg-canvas">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.1fr_2fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5">
            <LogoMarkIcon className="h-6 w-6 text-ink" />
            <span className="text-[15px] font-semibold tracking-tight text-ink">Papertrend</span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-6 text-body">
            Research papers read the same careful way, charted over time, and answered with citations.
          </p>
        </div>

        {/*
          These are navigation links. They were once drawn as bordered, filled
          boxes - the treatment this site gives buttons and inputs - so the
          footer read as a row of disabled form controls. A list of links looks
          like a list of links; the padding keeps a generous hit area.
        */}
        <nav aria-label="Footer" className="grid gap-8 sm:grid-cols-3">
          {FOOTER_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-sm font-medium text-ink">{group.title}</p>
              <ul className="mt-3 space-y-0.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="-mx-2 rounded px-2 py-2 text-sm text-body transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-mute sm:px-6">
          <p>© {new Date().getFullYear()} Papertrend</p>
          <p>Made for researchers who want to check the answer.</p>
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
    <div className="min-h-[100dvh] overflow-x-clip bg-canvas text-ink">
      <MarketingNav activeSlug={activeSlug} wide={activeSlug === "docs"} />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
