import { Suspense } from "react";
import WorkspacePapersClient from "@/components/workspace/WorkspacePapersClient";

export default function WorkspacePapersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center rounded-[32px] border border-[#dfd5c6] bg-white">
          <div className="text-center">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="text-sm text-gray-500">Loading paper library...</p>
          </div>
        </div>
      }
    >
      <WorkspacePapersClient />
    </Suspense>
  );
}
