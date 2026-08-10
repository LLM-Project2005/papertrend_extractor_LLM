"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { getStoredWorkspaceRoute } from "@/lib/workspace-session";

interface MarketingCTAProps {
  variant?: "primary" | "secondary" | "ghost";
  label?: string;
  loggedInLabel?: string;
  className?: string;
  showArrow?: boolean;
  tone?: "default" | "onDark";
}

const variantClasses = {
  primary:
    "bg-papertrend-ink text-papertrend-surface hover:bg-papertrend-action hover:text-white",
  secondary:
    "border border-papertrend-line bg-papertrend-surface text-papertrend-ink hover:border-[var(--pt-line-strong)] hover:bg-papertrend-raised",
  ghost:
    "border border-transparent bg-transparent text-papertrend-muted hover:bg-papertrend-raised hover:text-papertrend-ink",
};

export default function MarketingCTA({
  variant = "primary",
  label = "Start your project",
  loggedInLabel = "Open workspace",
  className = "",
  showArrow = true,
  tone = "default",
}: MarketingCTAProps) {
  const { hydrated, user } = useAuth();

  const href = useMemo(() => {
    if (!hydrated || !user) {
      return "/login";
    }

    return getStoredWorkspaceRoute() ?? "/workspace/home";
  }, [hydrated, user]);

  const copy = hydrated && user ? loggedInLabel : label;

  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition-colors ${tone === "onDark" && variant === "primary" ? "bg-[#f5f6f1] text-[#080b10] hover:bg-white" : variantClasses[variant]} ${className}`}
    >
      <span>{copy}</span>
      {showArrow ? <ArrowRightIcon className="h-4 w-4" /> : null}
    </Link>
  );
}
