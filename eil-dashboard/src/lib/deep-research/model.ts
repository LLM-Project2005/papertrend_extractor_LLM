/*
 * One forced tool call, parsed. Every structured step of a run - the plan,
 * the findings, the audit and the revision - goes through here, so none of
 * them depends on a model choosing to answer in the right shape.
 */
import { createChatCompletionResult, type ChatMessage } from "@/lib/openai";

export async function callTool(
  messages: ChatMessage[],
  tool: { type: string; function: { name: string } & Record<string, unknown> },
  task: string,
  options: { model?: string; maxTokens: number; timeoutMs: number; reasoningEffort?: "low" | "medium" | "high"; attempts?: number }
): Promise<unknown | null> {
  const name = tool.function.name;
  for (let attempt = 0; attempt < (options.attempts ?? 2); attempt += 1) {
    try {
      const result = await createChatCompletionResult(messages, 0, options.model, task, {
        maxTokens: options.maxTokens,
        tools: [tool],
        toolChoice: { type: "function", function: { name } },
        parallelToolCalls: false,
        timeoutMs: options.timeoutMs,
        reasoningEffort: options.reasoningEffort,
      });
      const call = result?.toolCalls.find((entry) => entry.function?.name === name);
      const text = call?.function?.arguments ?? result?.content ?? "";
      if (!text) continue;
      return JSON.parse(text);
    } catch (error) {
      console.warn("deep_research_tool_call_failed", { task, attempt, message: error instanceof Error ? error.message : "unknown_error" });
    }
  }
  return null;
}
