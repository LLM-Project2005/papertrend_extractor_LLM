"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Landing" },
  { href: "/start", label: "Start" },
  { href: "/workspace/home", label: "Workspace" },
];

interface Props {
  orientation?: "horizontal" | "vertical";
}

export default function PrimaryNavigation({
  orientation = "horizontal",
}: Props) {
  const pathname = usePathname();
  const isVertical = orientation === "vertical";

  return (
    <nav className={`flex ${isVertical ? "flex-col gap-2" : "flex-wrap gap-2"}`}>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
            } ${isVertical ? "text-left" : ""}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
