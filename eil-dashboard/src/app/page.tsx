import Link from "next/link";

const JOURNEY_STEPS = [
  {
    label: "Start here",
    title: "Shape the workspace around the team",
    description:
      "Capture the department, research goal, and the outputs that matter most before sending users into analytics.",
  },
  {
    label: "Bring sources in",
    title: "Upload papers or prepare connectors",
    description:
      "Start with PDF uploads or notebook outputs now, then expand into institutional connectors like OneDrive and SharePoint later.",
  },
  {
    label: "Work inside the corpus",
    title: "Move between dashboard, chat, and paper evidence",
    description:
      "Treat analytics, grounded conversation, and detailed paper review as parts of one workspace instead of separate tools.",
  },
];

const CAPABILITIES = [
  "Generic landing experience that works beyond one department or faculty",
  "Guided setup before the user lands in the workspace",
  "Dashboard analytics kept as a first-class module inside the workspace",
  "Corpus-grounded chat for synthesis and follow-up questions",
  "Import queue for PDFs today, with room for richer connectors later",
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f6f1e8] text-gray-900">
      <section className="relative overflow-hidden border-b border-[#dfd5c6] bg-[radial-gradient(circle_at_top_left,_rgba(243,223,186,0.9),_rgba(246,241,232,0.7)_40%,_rgba(246,241,232,1)_75%)]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
                Papertrend Workspace
              </p>
              <p className="mt-1 text-sm text-[#5a5248]">
                Research intelligence for departments, labs, and faculty teams
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/start"
                className="rounded-full bg-[#172029] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#253644]"
              >
                Start here
              </Link>
              <Link
                href="/workspace/home"
                className="rounded-full border border-[#172029] px-5 py-3 text-sm font-semibold text-[#172029] transition-colors hover:bg-white/60"
              >
                Open workspace
              </Link>
            </div>
          </header>

          <div className="grid gap-8 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
                Landing to workspace journey
              </p>
              <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight text-[#172029] sm:text-6xl">
                Turn scattered research papers into a guided workspace.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-[#4f4a44]">
                Start with a landing page that explains the system, then move users
                through setup, imports, analytics, and grounded chat inside a
                reusable workspace shell. The product can start with EIL and expand
                to other departments without changing the core journey.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/start"
                  className="rounded-full bg-[#172029] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#253644]"
                >
                  Build a workspace
                </Link>
                <Link
                  href="/workspace/dashboard"
                  className="rounded-full border border-[#172029] px-6 py-3 text-sm font-semibold text-[#172029] transition-colors hover:bg-white/70"
                >
                  See the dashboard module
                </Link>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                {CAPABILITIES.map((item) => (
                  <div
                    key={item}
                    className="rounded-[24px] border border-[#dfd5c6] bg-white/80 px-4 py-4 text-sm leading-6 text-[#4f4a44] shadow-sm backdrop-blur"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -left-8 top-12 h-40 w-40 rounded-full bg-[#d6b889]/35 blur-3xl" />
              <div className="absolute bottom-4 right-0 h-44 w-44 rounded-full bg-[#8bb6c7]/25 blur-3xl" />
              <div className="relative rounded-[36px] border border-[#d7c9b4] bg-[#172029] p-6 text-white shadow-[0_30px_80px_rgba(23,32,41,0.18)]">
                <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9bb0bc]">
                    Workspace modules
                  </p>
                  <div className="mt-4 grid gap-3">
                    {[
                      "Home for next actions and ingestion status",
                      "Dashboard for trends, tracks, and comparisons",
                      "Chat for grounded synthesis across the corpus",
                      "Papers for evidence-level review",
                      "Imports for uploads and connectors",
                    ].map((item) => (
                      <div
                        key={item}
                        className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#d8e2e6]"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 rounded-[28px] border border-[#b89158] bg-[#f3dfba] p-5 text-[#172029]">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#76592d]">
                    Why this shape
                  </p>
                  <p className="mt-3 text-sm leading-7">
                    Users no longer have to decode a dashboard first. They are
                    oriented by the landing page, guided by setup, then dropped into
                    a workspace with clear modules and next steps.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
            Product journey
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-[#172029]">
            Keep the dashboard, but make it part of a larger research workflow.
          </h2>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {JOURNEY_STEPS.map((step, index) => (
            <article
              key={step.title}
              className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
                0{index + 1} {step.label}
              </p>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-gray-900">
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-gray-600">
                {step.description}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
