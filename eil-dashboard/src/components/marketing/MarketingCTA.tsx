"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { buttonClass } from "@/components/ui/controls";
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

/*
 * The product's one button recipe (controls.ts), not a pill of its own: the
 * public pages had a second primary style beside the app's (2026-10-31 audit).
 */
const SIZES = { sm: "md", lg: "lg" } as const;

/**
 * The one call to action on the public pages. A signed-out visitor is sent to
 * sign in; a signed-in one goes straight back to the workspace page they last
 * had open.
 *
 * The label says what to do (2026-10-31 audit: "Get started" was the stock
 * phrase), and no arrow is glued after it unless a caller asks for one.
 */
export default function MarketingCTA({
  variant = "primary",
  size = "sm",
  label = "Start with your papers",
  loggedInLabel = "Open workspace",
  className = "",
  showArrow = false,
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
      className={buttonClass(variant, SIZES[size], `group ${className}`.trim())}
    >
      <span>{copy}</span>
      {showArrow ? (
        <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 ease-out-quart group-hover:translate-x-0.5" />
      ) : null}
    </Link>
  );
}
