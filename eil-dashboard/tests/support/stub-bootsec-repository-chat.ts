/*
 * src/lib/repository-chat.ts for chat route tests: runRepositoryChat does what
 * the test scripted in globalThis.__bootsecRepositoryChat, and each call is
 * counted in globalThis.__bootsecRepositoryChatCalls. Everything else is the
 * real module.
 */
import type { RepositoryChatInput, RepositoryChatResult } from "../../src/lib/repository-chat";

export * from "../../src/lib/repository-chat";

declare global {
  // eslint-disable-next-line no-var
  var __bootsecRepositoryChat: ((input: RepositoryChatInput) => Promise<RepositoryChatResult>) | undefined;
  // eslint-disable-next-line no-var
  var __bootsecRepositoryChatCalls: number | undefined;
}

export async function runRepositoryChat(input: RepositoryChatInput): Promise<RepositoryChatResult> {
  globalThis.__bootsecRepositoryChatCalls = (globalThis.__bootsecRepositoryChatCalls ?? 0) + 1;
  const answer = globalThis.__bootsecRepositoryChat;
  if (!answer) throw new Error("No repository chat answer was scripted for this test.");
  return answer(input);
}
