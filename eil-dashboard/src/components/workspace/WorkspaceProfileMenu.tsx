"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useWorkspaceProfile } from "@/components/workspace/WorkspaceProvider";
import {
  ChevronDownIcon,
  LogoutIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/Icons";
import { buildWorkspacePath } from "@/lib/workspace-routes";

function getInitials(value: string) {
  const parts = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "PT";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export default function WorkspaceProfileMenu() {
  const { hydrated, user, profile, isAdmin, signOut } = useAuth();
  const {
    currentOrganization,
    currentProject,
    selectedOrganizationId,
    selectedProjectId,
  } = useWorkspaceProfile();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const profileHref = buildWorkspacePath({
    organizationId: selectedOrganizationId ?? currentOrganization?.id ?? null,
    projectId: selectedProjectId ?? currentProject?.id ?? null,
    projectName: currentProject?.name ?? null,
    section: "profile",
  });
  const settingsHref = buildWorkspacePath({
    organizationId: selectedOrganizationId ?? currentOrganization?.id ?? null,
    projectId: selectedProjectId ?? currentProject?.id ?? null,
    projectName: currentProject?.name ?? null,
    section: "settings",
  });

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const identity = useMemo(() => {
    const name = profile?.full_name || user?.email || "Papertrend user";
    return {
      name,
      email: profile?.email || user?.email || "No email available",
      initials: getInitials(name),
      avatarUrl: profile?.avatar_url || null,
      roleLabel: isAdmin ? "Admin" : "Member",
    };
  }, [isAdmin, profile?.avatar_url, profile?.email, profile?.full_name, user?.email]);

  if (!hydrated) {
    return (
      <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-500 dark:border-[#353535] dark:bg-[#171717] dark:text-[#a3a3a3]">
        Loading account...
      </div>
    );
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#353535] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-10 items-center gap-3 rounded-xl border border-slate-200 bg-white px-2.5 pr-3 text-left text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-[#353535] dark:bg-[#171717] dark:text-[#d0d0d0] dark:hover:border-[#3a3a3a] dark:hover:text-white"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 dark:bg-[#242424] dark:text-[#f2f2f2]">
          {identity.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={identity.avatarUrl}
              alt={identity.name}
              className="h-full w-full object-cover"
            />
          ) : (
            identity.initials
          )}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-[150px] truncate text-sm font-medium">
            {identity.name}
          </span>
        </span>
        <ChevronDownIcon className="h-4 w-4 text-slate-400 dark:text-[#8f8f8f]" />
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-3 w-[min(320px,calc(100vw-1.5rem))] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_16px_48px_rgba(15,23,42,0.16)] dark:border-[#2f2f2f] dark:bg-[#171717] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-[#2a2a2a] dark:bg-[#1e1e1e]">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
              {identity.name}
            </p>
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-[#9b9b9b]">
              {identity.email}
            </p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[#6f6f6f]">
              {identity.roleLabel}
            </p>
          </div>

          <div className="mt-2 space-y-1">
            <Link
              href={profileHref}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#d0d0d0] dark:hover:bg-[#202020] dark:hover:text-white"
            >
              <UserIcon className="h-4 w-4" />
              <span>Profile settings</span>
            </Link>
            <Link
              href={settingsHref}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#d0d0d0] dark:hover:bg-[#202020] dark:hover:text-white"
            >
              <SettingsIcon className="h-4 w-4" />
              <span>Workspace settings</span>
            </Link>
          </div>

          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3 dark:border-red-900/50 dark:bg-red-950/20">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-500 dark:text-red-300">
              Dangerous zone
            </p>
            <p className="mt-2 text-sm leading-6 text-red-600 dark:text-red-200">
              Sign out from this account on this device.
            </p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-[#1a1212] dark:text-red-200 dark:hover:bg-[#211515]"
            >
              <LogoutIcon className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
