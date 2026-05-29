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
}

const variantClasses = {
  primary:
    "bg-white text-[#171717] hover:bg-[#f2f2f2] shadow-[0_0_0_1px_rgba(255,255,255,0.18)]",
  secondary:
    "border border-[#2a2a2a] bg-[#050505] text-white hover:border-[#4d4d4d] hover:bg-[#0a0a0a]",
  ghost:
    "border border-transparent bg-transparent text-[#d0d0d0] hover:bg-[#0a0a0a] hover:text-white",
};

export default function MarketingCTA({
  variant = "primary",
  label = "Start your project",
  loggedInLabel = "Open workspace",
  className = "",
  showArrow = true,
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition-colors ${variantClasses[variant]} ${className}`}
    >
      <span>{copy}</span>
      {showArrow ? <ArrowRightIcon className="h-4 w-4" /> : null}
    </Link>
  );
}
