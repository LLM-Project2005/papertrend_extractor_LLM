/*
 * src/lib/openai.ts for route tests (see route-harness.ts): no request leaves
 * the process. Each model call - its task, model and messages - is recorded
 * in globalThis.__smallfix2ModelCalls, and answered with null, as from a model
 * that is not configured. ModelCallError is the real one.
 */
import type { ChatCompletionParameters, ChatCompletionResult, ChatMessage } from "../../src/lib/openai";

export { ModelCallError } from "../../src/lib/openai";
export type {
  ChatCompletionAnnotation,
  ChatCompletionParameters,
  ChatCompletionResult,
  ChatCompletionToolCall,
  ChatMessage,
} from "../../src/lib/openai";

declare global {
  // eslint-disable-next-line no-var
  var __smallfix2ModelCalls: Array<{ task: string; model?: string; messages: ChatMessage[] }> | undefined;
}

export async function createChatCompletionResult(
  messages: ChatMessage[],
  _temperature = 0.2,
  modelOverride?: string,
  taskName?: string,
  _parameters: ChatCompletionParameters = {}
): Promise<ChatCompletionResult | null> {
  (globalThis.__smallfix2ModelCalls ??= []).push({ task: taskName ?? "", model: modelOverride, messages });
  return null;
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
