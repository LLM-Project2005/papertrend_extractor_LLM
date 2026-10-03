/*
 * The "server-only" marker for route tests. Next resolves it under the
 * react-server condition, to an empty module, when it builds a route; plain
 * Node takes the browser half, which throws. This maps it to the server half,
 * as a route is built, for this test process only.
 */
import * as nodeModule from "node:module";

interface ResolveResult {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context?: object) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: object, nextResolve: NextResolve): ResolveResult }): unknown;
};

let installed = false;

export function resolveServerOnlyAsServer() {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { ...nextResolve("next/dist/compiled/server-only/empty.js", context), shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}
