import Link from "next/link";
import {
  docsCategories,
  docsPages,
  getRelatedDocs,
  popularDocsPages,
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

function calloutClasses(tone: DocsCallout["tone"]) {
  if (tone === "warning") {
    return "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100";
  }

  if (tone === "success") {
    return "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100";
  }

  return "border-slate-200 bg-slate-50 text-slate-800 dark:border-[#1f1f1f] dark:bg-[#050505] dark:text-[#d0d0d0]";
}

function DocsSidebar({ activeSlug }: { activeSlug?: string }) {
  return (
    <aside className="hidden w-[260px] flex-none lg:block">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-4">
        <Link
          href="/docs"
          className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeSlug
              ? "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-[#a3a3a3] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
              : "bg-slate-950 text-white dark:bg-white dark:text-[#171717]"
          }`}
        >
          <FileIcon className="h-4 w-4" />
          Documentation
        </Link>

        <div className="space-y-5">
          {docsCategories.map((category) => (
            <nav key={category.id} aria-label={category.label}>
              <p className="px-3 text-[11px] font-semibold uppercase tracking-normal text-slate-400 dark:text-[#666666]">
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
                          ? "bg-slate-950 text-white dark:bg-white dark:text-[#171717]"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-[#a3a3a3] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
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
      </div>
    </aside>
  );
}

function OnThisPage({ sections }: { sections: DocsSection[] }) {
  return (
    <aside className="hidden w-[220px] flex-none xl:block">
      <div className="sticky top-20 border-l border-slate-200 pl-5 dark:border-[#1f1f1f]">
        <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-400 dark:text-[#666666]">
          On this page
        </p>
        <nav className="mt-3 space-y-2">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="block text-sm leading-5 text-slate-500 transition-colors hover:text-slate-950 dark:text-[#8f8f8f] dark:hover:text-white"
            >
              {section.title}
            </a>
          ))}
        </nav>
      </div>
    </aside>
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
    <section id={section.id} className="scroll-mt-24 border-t border-slate-200 py-9 first:border-t-0 first:pt-0 dark:border-[#1f1f1f]">
      <h2 className="text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
        {section.title}
      </h2>

      <div className="mt-4 space-y-4">
        {section.body.map((paragraph) => (
          <p key={paragraph} className="text-base leading-8 text-slate-600 dark:text-[#a3a3a3]">
            {paragraph}
          </p>
        ))}
      </div>

      {section.bullets ? (
        <ul className="mt-5 space-y-3">
          {section.bullets.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-7 text-slate-600 dark:text-[#b8b8b8]">
              <CheckCircleIcon className="mt-1 h-4 w-4 flex-none text-slate-950 dark:text-white" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {section.steps ? (
        <ol className="mt-5 space-y-3">
          {section.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-7 text-slate-600 dark:text-[#b8b8b8]">
              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white dark:bg-white dark:text-[#171717]">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {section.checklist ? (
        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 dark:border-[#1f1f1f] dark:bg-[#050505]">
          <p className="text-sm font-semibold text-slate-950 dark:text-white">Checklist</p>
          <ul className="mt-3 space-y-2">
            {section.checklist.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-slate-600 dark:text-[#b8b8b8]">
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-slate-950 dark:bg-white" />
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
    <div className="mx-auto flex max-w-7xl gap-8 px-4 pb-20 pt-28 sm:px-6">
      <DocsSidebar activeSlug={page.slug} />

      <article className="min-w-0 flex-1">
        <div className="mb-8 rounded-lg border border-slate-200 bg-white p-5 dark:border-[#1f1f1f] dark:bg-[#050505] lg:hidden">
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#666666]">
            Documentation
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {docsPages.map((item) => (
              <Link
                key={item.slug}
                href={`/docs/${item.slug}`}
                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                  item.slug === page.slug
                    ? "bg-slate-950 text-white dark:bg-white dark:text-[#171717]"
                    : "text-slate-600 hover:bg-slate-100 dark:text-[#a3a3a3] dark:hover:bg-[#0a0a0a]"
                }`}
              >
                {item.title}
              </Link>
            ))}
          </div>
        </div>

        <div className="border-b border-slate-200 pb-8 dark:border-[#1f1f1f]">
          <p className="text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">
            {page.categoryLabel}
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-normal text-slate-950 dark:text-white sm:text-5xl">
            {page.title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-slate-600 dark:text-[#a3a3a3]">
            {page.description}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {page.tags.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#8f8f8f]"
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
          <section className="border-t border-slate-200 pt-8 dark:border-[#1f1f1f]">
            <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Related docs</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {relatedDocs.map((related) => (
                <Link
                  key={related.slug}
                  href={`/docs/${related.slug}`}
                  className="group rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 dark:border-[#1f1f1f] dark:bg-[#050505] dark:hover:border-[#3a3a3a]"
                >
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">
                    {related.title}
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
                    {related.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-950 dark:text-white">
                    Read more
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </article>

      <OnThisPage sections={page.sections} />
    </div>
  );
}

export function DocsHome() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-28 sm:px-6">
      <section className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-6 dark:border-[#1f1f1f] dark:bg-[#050505] sm:p-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,124,240,0.12),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,0,128,0.10),transparent_32%)]" />
        <div className="relative max-w-3xl">
          <p className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-500 dark:border-[#1f1f1f] dark:bg-[#030303] dark:text-[#8f8f8f]">
            PAPERTREND DOCS
          </p>
          <h1 className="mt-6 text-4xl font-semibold tracking-normal text-slate-950 dark:text-white sm:text-6xl">
            Learn, operate, and trust your research workspace.
          </h1>
          <p className="mt-6 text-base leading-8 text-slate-600 dark:text-[#a3a3a3]">
            Detailed product documentation for uploads, analysis, dashboards, AI chat,
            deep research, cloud queue behavior, evaluation, and troubleshooting.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs/getting-started"
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-[#171717] dark:hover:bg-[#f2f2f2]"
            >
              Start reading
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/search"
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-[#2a2a2a] dark:bg-[#050505] dark:text-white dark:hover:border-[#4d4d4d] dark:hover:bg-[#0a0a0a]"
            >
              <SearchIcon className="h-4 w-4" />
              Search docs
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-[#1f1f1f] dark:bg-[#050505]">
          <div className="flex items-center gap-2">
            <SparkIcon className="h-5 w-5 text-slate-950 dark:text-white" />
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Popular docs</h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {popularDocsPages.map((page) => (
              <Link
                key={page.slug}
                href={`/docs/${page.slug}`}
                className="group rounded-lg border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-slate-300 hover:bg-white dark:border-[#1f1f1f] dark:bg-[#030303] dark:hover:border-[#3a3a3a] dark:hover:bg-[#050505]"
              >
                <p className="text-sm font-semibold text-slate-950 dark:text-white">{page.title}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-500 dark:text-[#8f8f8f]">
                  {page.description}
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-950 dark:text-white">
                  Open
                  <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-[#1f1f1f] dark:bg-[#050505]">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Common tasks</h2>
          <div className="mt-5 space-y-2">
            {[
              { label: "Upload and analyze papers", href: "/docs/library-uploads" },
              { label: "Build charts in chat", href: "/docs/ai-research-chat#chart-mode" },
              { label: "Review unknown years", href: "/docs/evaluation-quality#year-quality" },
              { label: "Fix queue or failed-file issues", href: "/docs/troubleshooting" },
              { label: "Understand deep research", href: "/docs/deep-research-agent" },
            ].map((task) => (
              <Link
                key={task.href}
                href={task.href}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-[#1f1f1f] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
              >
                {task.label}
                <ArrowRightIcon className="h-4 w-4 flex-none" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-5 md:grid-cols-3">
        {docsCategories.map((category) => (
          <div
            key={category.id}
            className="rounded-lg border border-slate-200 bg-white p-5 dark:border-[#1f1f1f] dark:bg-[#050505]"
          >
            <p className="text-xs font-semibold uppercase tracking-normal text-slate-400 dark:text-[#666666]">
              {category.label}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-[#a3a3a3]">
              {category.description}
            </p>
            <div className="mt-5 space-y-2">
              {category.pages.map((page) => (
                <Link
                  key={page.slug}
                  href={`/docs/${page.slug}`}
                  className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-[#d0d0d0] dark:hover:bg-[#0a0a0a] dark:hover:text-white"
                >
                  {page.title}
                  <ArrowRightIcon className="h-3.5 w-3.5 flex-none" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
