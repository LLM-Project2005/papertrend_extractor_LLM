/*
 * recharts for dashboard render tests: the real library, but a
 * ResponsiveContainer with a fixed size. The real one measures its parent in
 * the browser and draws nothing on the server, so the charts would be empty.
 */
import React from "react";

export * from "recharts";

export function ResponsiveContainer({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) {
  return React.cloneElement(children, { width: 900, height: 420 });
}
