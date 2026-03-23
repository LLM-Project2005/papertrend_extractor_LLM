interface Props {
  label: string;
  value: string | number;
}

export default function MetricCard({ label, value }: Props) {
  return (
    <div className="app-card px-5 py-4">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}
