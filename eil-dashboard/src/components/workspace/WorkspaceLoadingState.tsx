import Mascot from "@/components/ui/Mascot";

export default function WorkspaceLoadingState() {
  return (
    <div role="status" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <Mascot state="thinking" size={48} className="text-ink" />
      <p className="text-sm text-mute">Loading…</p>
    </div>
  );
}
