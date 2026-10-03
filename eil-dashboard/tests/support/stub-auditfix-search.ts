/*
 * src/components/workspace/WorkspaceGlobalSearch.tsx for render tests: the
 * real search, which also records the pages it was handed in
 * globalThis.__auditfixSearchPages.
 */
import { createElement } from "react";
import WorkspaceGlobalSearch from "../../src/components/workspace/WorkspaceGlobalSearch";

type Props = Parameters<typeof WorkspaceGlobalSearch>[0];

declare global {
  // eslint-disable-next-line no-var
  var __auditfixSearchPages: Props["pageItems"] | undefined;
}

export default function RecordedSearch(props: Props) {
  globalThis.__auditfixSearchPages = props.pageItems;
  return createElement(WorkspaceGlobalSearch, props);
}
