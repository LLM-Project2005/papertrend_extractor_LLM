/*
 * src/lib/deep-research/run.ts for upload-spend-behaviour-routes.test.ts: a
 * research session of two calls through the real model client.
 */
import { createChatCompletion } from "../../src/lib/openai";

export async function runResearchSession(input: { sessionId: string }): Promise<"completed"> {
  await createChatCompletion([{ role: "user", content: `Plan ${input.sessionId}` }], 0, undefined, "DEEP_RESEARCH_PLAN");
  await createChatCompletion([{ role: "user", content: "Write the report." }], 0, undefined, "DEEP_RESEARCH_WRITE");
  return "completed";
}
