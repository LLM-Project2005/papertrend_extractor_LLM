"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import { LogoMarkIcon } from "@/components/ui/Icons";
import type { WorkspaceOrganizationRow } from "@/types/database";

const ORGANIZATION_TYPES: Array<WorkspaceOrganizationRow["type"]> = [
  "personal",
  "academic",
  "research_lab",
  "department",
  "company",
  "other",
];

export default function NewOrganizationPage() {
  const router = useRouter();
  const { hydrated, user } = useAuth();
  const { createOrganization, setSelectedOrganizationId } = useWorkspaceProfile();
  const [name, setName] = useState("");
  const [type, setType] = useState<WorkspaceOrganizationRow["type"]>("personal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !user) {
      router.replace("/login");
    }
  }, [hydrated, router, user]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Organization name is required.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const organization = await createOrganization(name, type);
      setSelectedOrganizationId(organization.id);
      router.push(`/organizations/${organization.id}/projects`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create organization."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#111111] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f9d63] text-white">
            <LogoMarkIcon className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold">New organization</span>
        </div>
      </header>

      <section className="mx-auto flex max-w-5xl justify-center px-6 py-20">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-3xl rounded-3xl border border-white/10 bg-[#171717]"
        >
          <div className="border-b border-white/10 px-8 py-7">
            <h1 className="text-3xl font-semibold tracking-tight">
              Create a new organization
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#9b9b9b]">
              Organizations group related projects together so your library,
              dashboard, and research chat stay easy to manage.
            </p>
          </div>

          <div className="space-y-8 px-8 py-8">
            <div className="grid gap-3">
              <label className="text-sm font-medium text-white">Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Organization name"
                className="rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-[#666] focus:border-[#1f9d63]"
              />
            </div>

            <div className="grid gap-3">
              <label className="text-sm font-medium text-white">Type</label>
              <select
                value={type}
                onChange={(event) =>
                  setType(event.target.value as WorkspaceOrganizationRow["type"])
                }
                className="rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-[#1f9d63]"
              >
                {ORGANIZATION_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 px-8 py-5">
            <Link
              href="/organizations"
              className="rounded-xl border border-white/10 bg-[#141414] px-4 py-2.5 text-sm font-medium text-[#d0d0d0] transition-colors hover:bg-[#1b1b1b]"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-[#1f9d63] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#198451] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Creating..." : "Create organization"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
