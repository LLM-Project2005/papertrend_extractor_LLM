import AdminImportClient from "@/components/admin/AdminImportClient";

const CONNECTOR_CARDS = [
  {
    title: "PDF upload",
    status: "Ready now",
    description:
      "Upload research papers directly into Supabase Storage and queue them for extraction.",
  },
  {
    title: "Notebook or CSV sync",
    status: "Ready now",
    description:
      "Use the existing import script to sync extracted outputs into the workspace data model.",
  },
  {
    title: "OneDrive and SharePoint",
    status: "Planned",
    description:
      "Best added after the workspace model is stable so connectors attach to a clear ingestion flow.",
  },
];

export default function WorkspaceImportsPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-[#dfd5c6] bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b7357]">
          Imports module
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
          Bring documents into the workspace
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Keep the first version focused on reliable intake paths. PDF uploads and
          notebook syncs are already aligned with the Supabase-backed pipeline,
          while enterprise connectors can follow without changing the rest of the
          workspace experience.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {CONNECTOR_CARDS.map((card) => (
            <article
              key={card.title}
              className="rounded-[24px] border border-gray-200 bg-[#faf8f4] p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900">{card.title}</h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                    card.status === "Ready now"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {card.status}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                {card.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <AdminImportClient />
    </div>
  );
}
