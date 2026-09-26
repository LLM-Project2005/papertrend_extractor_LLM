"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ArrowRightIcon } from "@/components/ui/Icons";
import { getStoredWorkspaceRoute } from "@/lib/workspace-session";

interface MarketingCTAProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "lg";
  label?: string;
  loggedInLabel?: string;
  className?: string;
  showArrow?: boolean;
}

const variantClasses = {
  primary: "bg-ink text-canvas shadow-raise hover:bg-ink/85",
  secondary: "border border-hairline bg-surface text-ink hover:border-hairline-strong hover:bg-subtle",
  ghost: "text-body hover:bg-subtle hover:text-ink",
};

const sizeClasses = {
  sm: "h-9 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

/**
 * The one call to action on the public pages. A signed-out visitor is sent to
 * sign in; a signed-in one goes straight back to the workspace page they last
 * had open.
 */
export default function MarketingCTA({
  variant = "primary",
  size = "sm",
  label = "Get started",
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
      className={`group inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out-quart active:scale-[0.98] ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    >
      <span>{copy}</span>
      {showArrow ? (
        <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 ease-out-quart group-hover:translate-x-0.5" />
      ) : null}
    </Link>
  );
}
