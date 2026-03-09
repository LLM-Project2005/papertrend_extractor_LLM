"use client";

/**
 * A simple CSS-grid heatmap component. Receives a 2D data map
 * with row labels, column labels, and values.
 */

interface Props {
  rows: string[];
  cols: string[];
  values: number[][]; // values[rowIdx][colIdx]
  title?: string;
  colorScale?: [string, string]; // [low, high] hex colours
}

function interpolate(low: string, high: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16),
    ];
  };
  const [lr, lg, lb] = parse(low);
  const [hr, hg, hb] = parse(high);
  const r = Math.round(lr + (hr - lr) * t);
  const g = Math.round(lg + (hg - lg) * t);
  const b = Math.round(lb + (hb - lb) * t);
  return `rgb(${r},${g},${b})`;
}

export default function Heatmap({
  rows,
  cols,
  values,
  title,
  colorScale = ["#fff7ec", "#cc4c02"],
}: Props) {
  const flat = values.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const range = max - min || 1;

  return (
    <div>
      {title && (
        <h4 className="text-sm font-semibold text-gray-700 mb-3">{title}</h4>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-1" />
              {cols.map((c) => (
                <th
                  key={c}
                  className="p-1 font-medium text-gray-500 text-center whitespace-nowrap"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <td className="pr-2 font-medium text-gray-600 whitespace-nowrap text-right">
                  {r}
                </td>
                {cols.map((c, ci) => {
                  const v = values[ri]?.[ci] ?? 0;
                  const t = (v - min) / range;
                  return (
                    <td
                      key={c}
                      className="p-0"
                      title={`${r} × ${c}: ${v}`}
                    >
                      <div
                        className="w-10 h-8 flex items-center justify-center text-[10px] font-medium border border-white/50"
                        style={{
                          backgroundColor: interpolate(
                            colorScale[0],
                            colorScale[1],
                            t
                          ),
                          color: t > 0.6 ? "#fff" : "#333",
                        }}
                      >
                        {v}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
