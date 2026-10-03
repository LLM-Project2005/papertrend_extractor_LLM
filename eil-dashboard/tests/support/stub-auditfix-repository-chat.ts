/*
 * src/lib/repository-chat.ts for chat job tests (see route-harness.ts):
 * runRepositoryChat does what the test scripted in
 * globalThis.__auditfixChatAnswer - answer, or fail as a provider or a guard
 * would. Everything else is the real module.
 */
import type { RepositoryChatInput, RepositoryChatResult } from "../../src/lib/repository-chat";

export * from "../../src/lib/repository-chat";

declare global {
  // eslint-disable-next-line no-var
  var __auditfixChatAnswer: ((input: RepositoryChatInput) => Promise<RepositoryChatResult>) | undefined;
}

export async function runRepositoryChat(input: RepositoryChatInput): Promise<RepositoryChatResult> {
  const answer = globalThis.__auditfixChatAnswer;
  if (!answer) throw new Error("No repository chat answer was scripted for this test.");
  return answer(input);
}
