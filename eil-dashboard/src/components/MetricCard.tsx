interface Props {
  label: string;
  value: string | number;
}

export default function MetricCard({ label, value }: Props) {
  return (
    <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
      <p className="text-xs text-gray-500 tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
