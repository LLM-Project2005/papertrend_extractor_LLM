/*
 * src/lib/openai.ts for chat pipeline tests (see route-harness.ts): no request
 * leaves the process. Each model call is recorded in
 * globalThis.__chatScopeModel and answered by its `reply`, by task name; a
 * reply of null is what an unconfigured model gives. ModelCallError is the
 * real one.
 */
import { recordAiTokenUsage } from "../../src/lib/ai-token-usage";
import type { ChatCompletionParameters, ChatCompletionResult, ChatMessage } from "../../src/lib/openai";

export { ModelCallError } from "../../src/lib/openai";
export type {
  ChatCompletionAnnotation,
  ChatCompletionParameters,
  ChatCompletionResult,
  ChatCompletionToolCall,
  ChatMessage,
} from "../../src/lib/openai";

export interface ScriptedModelCall {
  taskName: string;
  messages: ChatMessage[];
  model?: string;
  parameters: ChatCompletionParameters;
}

export interface ScriptedModel {
  calls: ScriptedModelCall[];
  reply(call: ScriptedModelCall): unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var __chatScopeModel: ScriptedModel | undefined;
}

export async function createChatCompletionResult(
  messages: ChatMessage[],
  _temperature = 0.2,
  modelOverride?: string,
  taskName?: string,
  parameters: ChatCompletionParameters = {}
): Promise<ChatCompletionResult | null> {
  const script = globalThis.__chatScopeModel;
  const call: ScriptedModelCall = { taskName: taskName ?? "", messages, model: modelOverride, parameters };
  script?.calls.push(call);
  const reply = await script?.reply(call);
  if (reply === null || reply === undefined) return null;
  const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
  recordAiTokenUsage(usage, modelOverride ?? "google/gemini-3.7-flash");
  return {
    content: typeof reply === "string" ? reply : JSON.stringify(reply),
    annotations: [],
    toolCalls: [],
    model: modelOverride,
    usage,
  };
}

export async function createChatCompletion(
  messages: ChatMessage[],
  temperature = 0.2,
  modelOverride?: string,
  taskName?: string,
  parameters: ChatCompletionParameters = {}
): Promise<string | null> {
  return (await createChatCompletionResult(messages, temperature, modelOverride, taskName, parameters))?.content ?? null;
}
