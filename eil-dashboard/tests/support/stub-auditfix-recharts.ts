/*
 * recharts for dashboard render tests: the real library, with a
 * ResponsiveContainer of a fixed size. The real one measures its parent in a
 * browser and draws nothing on the server.
 */
import React from "react";

export * from "recharts";

export function ResponsiveContainer({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) {
  return React.cloneElement(children, { width: 900, height: 420 });
}
