export default function WorkspaceLoadingState() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
      <div className="w-full rounded-[32px] border border-slate-200 bg-white px-8 py-12 text-center shadow-sm dark:border-[#1f1f1f] dark:bg-[#050505]">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-[#1f9d63] border-t-transparent" />
        <p className="text-sm font-medium text-slate-500 dark:text-[#9b9b9b]">
          Loading
        </p>
      </div>
    </div>
  );
}
