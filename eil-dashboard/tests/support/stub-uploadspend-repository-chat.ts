/*
 * src/lib/repository-chat.ts for upload-spend-behaviour-routes.test.ts: a
 * background answer made of one call through the real model client, or, for
 * the prompt "refuse", that call and then a spending-limit refusal.
 */
import { createChatCompletion } from "../../src/lib/openai";
import { GuardError } from "../../src/lib/security-guards";

export async function runRepositoryChat(input: { prompt: string }) {
  const answer = await createChatCompletion([{ role: "user", content: input.prompt }], 0.2, undefined, "REPOSITORY_ANSWER");
  if (input.prompt === "refuse") throw new GuardError("You have used today's AI allowance.", 429);
  return {
    handled: true,
    answer: answer ?? "",
    citations: [],
    charts: [],
    coverage: {},
    limitations: [],
    diagnostics: {},
    execution: { operation: "summary" },
  };
}
