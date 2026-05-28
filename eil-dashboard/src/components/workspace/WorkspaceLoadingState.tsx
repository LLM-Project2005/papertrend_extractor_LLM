import { LogoMarkIcon } from "@/components/ui/Icons";

export default function WorkspaceLoadingState({
  title = "Opening workspace",
  description = "Restoring your selected organization, project, and workspace data.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
      <div className="w-full rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm dark:border-[#2c2c2c] dark:bg-[#1b1b1b]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1f9d63] text-white shadow-[0_14px_36px_rgba(31,157,99,0.25)]">
          <LogoMarkIcon className="h-7 w-7" />
        </div>
        <div className="mx-auto mt-6 h-1.5 w-44 overflow-hidden rounded-full bg-slate-100 dark:bg-[#292929]">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-[#1f9d63]" />
        </div>
        <p className="mt-6 text-sm font-medium text-slate-500 dark:text-[#8f8f8f]">
          Loading
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">
          {title}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-600 dark:text-[#a3a3a3]">
          {description}
        </p>
      </div>
    </div>
  );
}
