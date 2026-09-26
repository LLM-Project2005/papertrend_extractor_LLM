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

/** Dark or light text, whichever reads on this cell; the scale can run either
 * way (light to dark on a light page, dark to light on a dark one). */
function textOn(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#1f2937" : "#fafafa";
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
        <h4 className="mb-3 text-sm font-semibold text-slate-700 dark:text-[#ececec]">{title}</h4>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white p-1 dark:bg-[#050505]" />
              {cols.map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap p-1 text-center font-medium text-slate-500 dark:text-[#a3a3a3]"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                {/* Sticky and truncated on a phone, so the year columns scroll
                    under the names instead of being pushed off the card. */}
                <td
                  title={r}
                  className="sticky left-0 z-10 max-w-[9rem] truncate whitespace-nowrap bg-white pr-2 text-right font-medium text-slate-600 dark:bg-[#050505] dark:text-[#d0d0d0] sm:max-w-none"
                >
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
                        className="w-10 h-8 flex items-center justify-center text-[10px] font-medium border border-white/50 dark:border-black/50"
                        style={{
                          backgroundColor: interpolate(colorScale[0], colorScale[1], t),
                          color: textOn(interpolate(colorScale[0], colorScale[1], t)),
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
