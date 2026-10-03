/*
 * src/lib/repository-chat.ts for chat route tests (see route-harness.ts):
 * runRepositoryChat answers with what the test scripted in
 * globalThis.__chatScopeRepositoryChat. Everything else is the real module.
 */
import type { RepositoryChatInput, RepositoryChatResult } from "../../src/lib/repository-chat";

export * from "../../src/lib/repository-chat";

declare global {
  // eslint-disable-next-line no-var
  var __chatScopeRepositoryChat: ((input: RepositoryChatInput) => Promise<RepositoryChatResult>) | undefined;
}

export async function runRepositoryChat(input: RepositoryChatInput): Promise<RepositoryChatResult> {
  const answer = globalThis.__chatScopeRepositoryChat;
  if (!answer) throw new Error("No repository chat answer was scripted for this test.");
  return answer(input);
}
