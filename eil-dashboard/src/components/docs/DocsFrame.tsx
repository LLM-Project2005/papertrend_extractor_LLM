import Link from "next/link";
import {
  docsCategories,
  docsPages,
  getRelatedDocs,
  type DocsCallout,
  type DocsPage,
  type DocsSection,
} from "@/lib/docs-content";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  FileIcon,
  SearchIcon,
  SparkIcon,
} from "@/components/ui/Icons";
import DocsFixedRail from "@/components/docs/DocsFixedRail";
import DocsOnThisPage from "@/components/docs/DocsOnThisPage";

function calloutClasses(tone: DocsCallout["tone"]) {
  if (tone === "warning") {
    return "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100";
  }

  if (tone === "success") {
    return "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100";
  }

  return "border-papertrend-line bg-papertrend-raised text-papertrend-ink";
}

function DocsSidebar({ activeSlug }: { activeSlug?: string }) {
  return (
    <DocsFixedRail side="left">
      <div className="space-y-2">
        <Link
          href="/docs/search"
          className="flex items-center gap-2 rounded-md border border-papertrend-line bg-papertrend-surface px-3 py-2.5 text-sm font-medium text-papertrend-muted transition-colors hover:border-[var(--pt-line-strong)] hover:text-papertrend-ink"
        >
          <SearchIcon className="h-4 w-4" />
          Search docs
        </Link>
        <Link
          href="/docs"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeSlug
              ? "text-papertrend-muted hover:bg-papertrend-raised hover:text-papertrend-ink"
              : "border-l-2 border-papertrend-cyan bg-papertrend-action-soft text-papertrend-action"
          }`}
        >
          <FileIcon className="h-4 w-4" />
          Documentation
        </Link>
      </div>

      <div className="mt-5 space-y-5">
        {docsCategories.map((category) => (
          <nav key={category.id} aria-label={category.label}>
            <p className="px-3 font-mono text-[10px] uppercase text-papertrend-muted">
              {category.label}
            </p>
            <div className="mt-2 space-y-1">
              {category.pages.map((page) => {
                const active = page.slug === activeSlug;

                return (
                  <Link
                    key={page.slug}
                    href={`/docs/${page.slug}`}
                    className={`block rounded-lg px-3 py-2 text-sm leading-5 transition-colors ${
                      active
                        ? "border-l-2 border-papertrend-cyan bg-papertrend-action-soft text-papertrend-action"
                        : "border-l-2 border-transparent text-papertrend-muted hover:bg-papertrend-raised hover:text-papertrend-ink"
                    }`}
                  >
                    {page.title}
                  </Link>
                );
              })}
            </div>
          </nav>
        ))}
      </div>
    </DocsFixedRail>
  );
}

function DocsCalloutBox({ callout }: { callout: DocsCallout }) {
  return (
    <div className={`mt-5 rounded-lg border px-4 py-4 ${calloutClasses(callout.tone)}`}>
      <p className="text-sm font-semibold">{callout.title}</p>
      <p className="mt-2 text-sm leading-6 opacity-85">{callout.body}</p>
    </div>
  );
}

function DocsSectionBlock({ section }: { section: DocsSection }) {
  return (
    <section id={section.id} className="scroll-mt-24 border-t border-papertrend-line py-10 first:border-t-0 first:pt-0">
      <h2 className="text-2xl font-semibold text-papertrend-ink">
        {section.title}
      </h2>

      <div className="mt-4 space-y-4">
        {section.body.map((paragraph) => (
          <p key={paragraph} className="text-base leading-8 text-papertrend-muted">
            {paragraph}
          </p>
        ))}
      </div>

      {section.bullets ? (
        <ul className="mt-5 space-y-3">
          {section.bullets.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-7 text-papertrend-muted">
              <CheckCircleIcon className="mt-1 h-4 w-4 flex-none text-papertrend-cyan" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {section.steps ? (
        <ol className="mt-5 space-y-3">
          {section.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-7 text-papertrend-muted">
              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-papertrend-ink text-xs font-semibold text-papertrend-surface">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {section.checklist ? (
        <div className="mt-5 rounded-lg border border-papertrend-line bg-papertrend-surface p-4">
          <p className="text-sm font-semibold text-papertrend-ink">Checklist</p>
          <ul className="mt-3 space-y-2">
            {section.checklist.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-papertrend-muted">
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-papertrend-cyan" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {section.callout ? <DocsCalloutBox callout={section.callout} /> : null}
    </section>
  );
}

export function DocsArticle({ page }: { page: DocsPage }) {
  const relatedDocs = getRelatedDocs(page);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-28 sm:px-6">
      <DocsSidebar activeSlug={page.slug} />

      <article className="min-w-0 lg:ml-[292px] xl:mr-[252px]">
        <div className="mb-8 rounded-lg border border-papertrend-line bg-papertrend-surface p-5 lg:hidden">
          <p className="font-mono text-xs uppercase text-papertrend-muted">
            Documentation
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {docsPages.map((item) => (
              <Link
                key={item.slug}
                href={`/docs/${item.slug}`}
                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                  item.slug === page.slug
                    ? "bg-papertrend-action-soft text-papertrend-action"
                    : "text-papertrend-muted hover:bg-papertrend-raised hover:text-papertrend-ink"
                }`}
              >
                {item.title}
              </Link>
            ))}
          </div>
        </div>

        <div className="border-b border-papertrend-line pb-8">
          <p className="font-mono text-xs text-papertrend-action">
            {page.categoryLabel}
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-papertrend-ink sm:text-5xl">
            {page.title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-papertrend-muted">
            {page.description}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {page.tags.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-papertrend-line bg-papertrend-raised px-3 py-1 text-xs text-papertrend-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="py-9">
          {page.sections.map((section) => (
            <DocsSectionBlock key={section.id} section={section} />
          ))}
        </div>

        {relatedDocs.length > 0 ? (
          <section className="border-t border-papertrend-line pt-8">
            <h2 className="text-xl font-semibold text-papertrend-ink">Related docs</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {relatedDocs.map((related) => (
                <Link
                  key={related.slug}
                  href={`/docs/${related.slug}`}
                  className="group rounded-lg border border-papertrend-line bg-papertrend-surface p-4 transition-colors hover:border-[var(--pt-line-strong)]"
                >
                  <p className="text-sm font-semibold text-papertrend-ink">
                    {related.title}
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-papertrend-muted">
                    {related.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-papertrend-action">
                    Read more
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </article>

      <DocsOnThisPage sections={page.sections} />
    </div>
  );
}

export function DocsHome() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-28 sm:px-6">
      <section className="grid min-h-[58vh] gap-10 border-b border-papertrend-line pb-14 pt-6 lg:grid-cols-[0.38fr_1fr] lg:items-end">
        <div className="self-start font-mono text-xs text-papertrend-muted">
          <p className="text-papertrend-action">[ FIELD MANUAL ]</p>
          <p className="mt-3">Edition 2026.08</p>
          <p className="mt-1">Cloud research system</p>
        </div>
        <div>
          <h1 className="max-w-5xl text-5xl font-semibold leading-[0.98] text-papertrend-ink sm:text-6xl lg:text-7xl">
            Learn the instrument. Follow the evidence.
          </h1>
          <div className="mt-9 grid gap-7 border-t border-papertrend-line pt-7 md:grid-cols-2">
            <p className="max-w-xl text-base leading-8 text-papertrend-muted">
              A field guide to uploads, structured analysis, dashboards, grounded chat,
              deep research, evaluation, and cloud processing.
            </p>
            <div className="flex flex-wrap items-start gap-3 md:justify-end">
              <Link
                href="/docs/getting-started"
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-papertrend-ink px-5 py-2.5 text-sm font-semibold text-papertrend-surface transition-colors hover:bg-papertrend-action hover:text-white"
              >
                Start with the workflow
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link
                href="/docs/search"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-papertrend-line bg-papertrend-surface px-5 py-2.5 text-sm font-semibold text-papertrend-ink transition-colors hover:border-[var(--pt-line-strong)] hover:bg-papertrend-raised"
              >
                <SearchIcon className="h-4 w-4" />
                Search
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid border-b border-papertrend-line lg:grid-cols-[0.38fr_1fr]">
        <div className="border-b border-papertrend-line py-9 lg:border-b-0 lg:border-r lg:pr-8">
          <SparkIcon className="h-6 w-6 text-papertrend-cyan" />
          <h2 className="mt-4 text-xl font-semibold text-papertrend-ink">Start from a real task</h2>
          <p className="mt-3 max-w-sm text-sm leading-7 text-papertrend-muted">
            The shortest route into the manual, organized around work rather than product marketing.
          </p>
        </div>
        <div className="divide-y divide-papertrend-line lg:pl-8">
          {[
            { label: "Upload and analyze papers", href: "/docs/library-uploads" },
            { label: "Build charts in chat", href: "/docs/ai-research-chat#chart-mode" },
            { label: "Review extraction quality", href: "/docs/evaluation-quality" },
            { label: "Recover failed queue work", href: "/docs/troubleshooting" },
            { label: "Run a deep research report", href: "/docs/deep-research-agent" },
          ].map((task, index) => (
            <Link
              key={task.href}
              href={task.href}
              className="group grid min-h-16 grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 py-4 text-papertrend-ink transition-colors hover:text-papertrend-action"
            >
              <span className="font-mono text-xs text-papertrend-muted">0{index + 1}</span>
              <span className="font-medium">{task.label}</span>
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
      </section>

      <section className="py-16">
        <div className="mb-8 grid gap-4 lg:grid-cols-[0.38fr_1fr]">
          <p className="font-mono text-xs text-papertrend-action">[ REFERENCE INDEX ]</p>
          <h2 className="text-3xl font-semibold text-papertrend-ink sm:text-4xl">Browse every system chapter.</h2>
        </div>
        <div className="border-t border-papertrend-line">
          {docsCategories.map((category, categoryIndex) => (
            <div key={category.id} className="grid border-b border-papertrend-line py-8 lg:grid-cols-[0.38fr_1fr]">
              <div className="pr-8">
                <p className="font-mono text-xs text-papertrend-muted">0{categoryIndex + 1}</p>
                <h3 className="mt-3 text-xl font-semibold text-papertrend-ink">{category.label}</h3>
                <p className="mt-3 max-w-sm text-sm leading-6 text-papertrend-muted">{category.description}</p>
              </div>
              <div className="mt-6 grid gap-x-6 border-t border-papertrend-line md:grid-cols-2 lg:mt-0 lg:border-t-0">
                {category.pages.map((page) => (
                  <Link
                    key={page.slug}
                    href={`/docs/${page.slug}`}
                    className="group flex min-h-14 items-center justify-between gap-3 border-b border-papertrend-line text-sm font-medium text-papertrend-ink transition-colors hover:text-papertrend-action"
                  >
                    {page.title}
                    <ArrowRightIcon className="h-4 w-4 flex-none transition-transform group-hover:translate-x-1" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
