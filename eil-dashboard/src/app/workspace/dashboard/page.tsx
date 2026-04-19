import { Suspense } from "react";
import DashboardClient from "@/components/DashboardClient";

function DashboardFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center rounded-[32px] border border-[#dfd5c6] bg-white">
      <div className="text-center">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        <p className="text-sm text-gray-500">Loading dashboard...</p>
      </div>
    </div>
  );
}

export default function WorkspaceDashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardClient basePath="/workspace/dashboard" />
    </Suspense>
  );
}
