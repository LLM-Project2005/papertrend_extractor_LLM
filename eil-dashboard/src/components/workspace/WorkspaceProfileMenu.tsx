"use client";

import { menuItemClass } from "@/components/ui/controls";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  BookOpenIcon,
  HomeIcon,
  LogoutIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/Icons";

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

interface WorkspaceProfileMenuProps {
  variant?: "workspace" | "marketing";
}

export default function WorkspaceProfileMenu({
  variant = "workspace",
}: WorkspaceProfileMenuProps) {
  const { hydrated, user, profile, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      // Only while open, and marked as handled: this listener is always
      // attached, and would otherwise take every Escape a dialog is owed.
      if (event.key !== "Escape" || !openRef.current || event.defaultPrevented) return;
      event.preventDefault();
      if (containerRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
      setOpen(false);
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
    return <div className="h-9 w-9 rounded-full bg-subtle" aria-label="Loading account" />;
  }

  if (!user) {
    // On the public pages a signed-out visitor needs the words, not an icon.
    return variant === "marketing" ? (
      <Link
        href="/login"
        className="inline-flex h-9 items-center rounded-full px-3 text-sm font-medium text-body transition-colors hover:text-ink"
      >
        Sign in
      </Link>
    ) : (
      <Link
        href="/login"
        aria-label="Sign in"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-body transition-colors hover:bg-subtle hover:text-ink"
      >
        <UserIcon className="h-4 w-4" />
      </Link>
    );
  }

  const itemClass = menuItemClass();

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(event) => {
        // Tabbing past the last link closes it, as a click elsewhere does.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-hairline transition-[box-shadow,transform] duration-150 hover:ring-hairline-strong active:scale-95"
        aria-expanded={open}
        aria-label="Open account menu"
      >
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-subtle text-[11px] font-semibold text-ink">
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
      </button>

      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-[min(280px,calc(100vw-1.5rem))] origin-top-right rounded-xl border border-hairline bg-surface p-1.5 shadow-overlay motion-safe:animate-scale-in"
        >
          <div className="px-2.5 pb-2.5 pt-2">
            <p className="truncate text-sm font-medium text-ink">{identity.name}</p>
            <p className="mt-0.5 truncate text-xs text-mute">{identity.email}</p>
          </div>
          <div className="border-t border-hairline pt-1.5">
            <Link href="/workspace/settings?section=profile" onClick={() => setOpen(false)} className={itemClass}>
              <SettingsIcon className="h-4 w-4" />
              <span>Account settings</span>
            </Link>
            <Link href="/workspaces" onClick={() => setOpen(false)} className={itemClass}>
              <HomeIcon className="h-4 w-4" />
              <span>Repositories</span>
            </Link>
            <Link href="/docs" onClick={() => setOpen(false)} className={itemClass}>
              <BookOpenIcon className="h-4 w-4" />
              <span>Documentation</span>
            </Link>
          </div>
          <div className="mt-1.5 border-t border-hairline pt-1.5">
            <button
              type="button"
             
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className={`${itemClass} w-full`}
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
