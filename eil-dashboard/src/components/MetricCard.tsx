interface Props {
  label: string;
  value: string | number;
}

export default function MetricCard({ label, value }: Props) {
  return (
    <div className="app-card px-4 py-4 sm:px-5">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-[2rem]">
        {value}
      </p>
    </div>
  );
}
