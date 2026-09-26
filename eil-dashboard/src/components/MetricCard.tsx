interface Props {
  label: string;
  value: string | number;
}

/*
 * One headline figure. The characters are keyed on the value, so when a filter
 * changes the number they rise into place again; screen readers get the value
 * once, as plain text, rather than character by character.
 */
export default function MetricCard({ label, value }: Props) {
  const text = String(value);
  return (
    <div className="app-card px-4 py-4 sm:px-5">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-normal text-slate-900 dark:text-white sm:text-[2rem]">
        <span className="sr-only">{text}</span>
        <span key={text} aria-hidden="true">
          {Array.from(text).map((character, index) => (
            <span key={index} className="digit-pop" style={{ animationDelay: `${index * 35}ms` }}>
              {character}
            </span>
          ))}
        </span>
      </p>
    </div>
  );
}
