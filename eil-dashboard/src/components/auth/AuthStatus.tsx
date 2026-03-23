"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { LogoutIcon, UserIcon } from "@/components/ui/Icons";

export default function AuthStatus() {
  const { hydrated, user, profile, isAdmin, signOut } = useAuth();

  if (!hydrated) {
    return (
      <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Loading account...
      </div>
    );
  }

  if (!user) {
    return (
      <Link
        href="/#account"
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
      >
        <UserIcon className="h-4 w-4" />
        <span>Sign in</span>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 sm:flex">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <UserIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="max-w-[180px] truncate text-sm font-medium text-slate-900 dark:text-white">
            {profile?.full_name || user.email}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isAdmin ? "Admin" : "Member"}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
      >
        <LogoutIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}
