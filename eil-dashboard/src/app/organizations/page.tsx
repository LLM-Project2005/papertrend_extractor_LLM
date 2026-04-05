"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { LogoMarkIcon, SearchIcon } from "@/components/ui/Icons";

export default function OrganizationsPage() {
  const router = useRouter();
  const { hydrated, user } = useAuth();
  const {
    organizations,
    refreshOrganizations,
    setSelectedOrganizationId,
  } = useWorkspaceProfile();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    refreshOrganizations().catch(() => undefined);
  }, [hydrated, refreshOrganizations, router, user]);

  const visibleOrganizations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return organizations;
    }
    return organizations.filter((organization) =>
      organization.name.toLowerCase().includes(needle)
    );
  }, [organizations, query]);

  if (!hydrated) {
    return <main className="min-h-screen bg-[#111111]" />;
  }

  return (
    <main className="min-h-screen bg-[#111111] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f9d63] text-white">
              <LogoMarkIcon className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold">Organizations</span>
          </div>

          <Link
            href="/organizations/new"
            className="rounded-xl bg-[#1f9d63] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#198451]"
          >
            New organization
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight">Your Organizations</h1>
          <p className="mt-4 text-base leading-8 text-[#a3a3a3]">
            Create a clean home for each team, lab, or research initiative before
            you start building projects.
          </p>
        </div>

        <div className="mt-10 max-w-sm">
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#171717] px-4 py-3">
            <SearchIcon className="h-4 w-4 text-[#7a7a7a]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search for an organization"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#6f6f6f]"
            />
          </label>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleOrganizations.map((organization) => (
            <button
              key={organization.id}
              type="button"
              onClick={() => {
                setSelectedOrganizationId(organization.id);
                router.push(`/organizations/${organization.id}/projects`);
              }}
              className="rounded-2xl border border-white/10 bg-[#171717] p-6 text-left transition-colors hover:border-white/20 hover:bg-[#1b1b1b]"
            >
              <p className="text-xl font-semibold text-white">{organization.name}</p>
              <p className="mt-2 text-sm capitalize text-[#9c9c9c]">
                {organization.type.replace(/_/g, " ")}
              </p>
            </button>
          ))}
        </div>

        {visibleOrganizations.length === 0 ? (
          <div className="mt-16 rounded-3xl border border-dashed border-white/10 bg-[#141414] px-6 py-14 text-center">
            <p className="text-lg font-medium text-white">No organizations yet</p>
            <p className="mt-3 text-sm leading-7 text-[#9c9c9c]">
              Start by creating one organization, then add projects inside it.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
