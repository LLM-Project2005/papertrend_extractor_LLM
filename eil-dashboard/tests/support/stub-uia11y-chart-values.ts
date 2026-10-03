/*
 * src/components/tabs/ChartValues.tsx for dashboard render tests: the real
 * list, with the props each chart gave it kept in globalThis.__uia11yChartValues,
 * so a test can do what a press on one of its values does.
 */
import { createElement } from "react";
import ChartValues, { paperCount } from "../../src/components/tabs/ChartValues";

export { paperCount };
export type { ChartValue } from "../../src/components/tabs/ChartValues";

type Props = Parameters<typeof ChartValues>[0];

declare global {
  // eslint-disable-next-line no-var
  var __uia11yChartValues: Props[] | undefined;
}

export default function RecordedChartValues(props: Props) {
  (globalThis.__uia11yChartValues ??= []).push(props);
  return createElement(ChartValues, props);
}
