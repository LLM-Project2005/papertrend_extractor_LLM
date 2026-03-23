import PrimaryNavigation from "@/components/PrimaryNavigation";
import AdminImportClient from "@/components/admin/AdminImportClient";

export default function AdminImportPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PrimaryNavigation />
        <AdminImportClient />
      </div>
    </main>
  );
}
