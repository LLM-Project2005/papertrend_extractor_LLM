/*
 * src/lib/openai.ts for the chat's web-step tests (see route-harness.ts): no
 * request leaves the process. Each model call is recorded in
 * globalThis.__chatAnswerModel and answered by its `reply`, by task name. A
 * reply of { content, annotations } is returned as the provider's own result,
 * annotations (the pages a web search returned) included; any other object is
 * sent back as JSON, and null is what an unconfigured model gives.
 * ModelCallError is the real one.
 */
import { recordAiTokenUsage } from "../../src/lib/ai-token-usage";
import type {
  ChatCompletionAnnotation,
  ChatCompletionParameters,
  ChatCompletionResult,
  ChatMessage,
} from "../../src/lib/openai";

export { ModelCallError } from "../../src/lib/openai";
export type {
  ChatCompletionAnnotation,
  ChatCompletionParameters,
  ChatCompletionResult,
  ChatCompletionToolCall,
  ChatMessage,
} from "../../src/lib/openai";

export interface ChatAnswerModelCall {
  taskName: string;
  messages: ChatMessage[];
  model?: string;
  parameters: ChatCompletionParameters;
}

export interface ChatAnswerModel {
  calls: ChatAnswerModelCall[];
  reply(call: ChatAnswerModelCall): unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var __chatAnswerModel: ChatAnswerModel | undefined;
}

function isCompletion(value: unknown): value is { content: string; annotations: ChatCompletionAnnotation[] } {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as { annotations?: unknown }).annotations);
}

export async function createChatCompletionResult(
  messages: ChatMessage[],
  _temperature = 0.2,
  modelOverride?: string,
  taskName?: string,
  parameters: ChatCompletionParameters = {}
): Promise<ChatCompletionResult | null> {
  const script = globalThis.__chatAnswerModel;
  const call: ChatAnswerModelCall = { taskName: taskName ?? "", messages, model: modelOverride, parameters };
  script?.calls.push(call);
  const reply = await script?.reply(call);
  if (reply === null || reply === undefined) return null;
  const usage = { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500 };
  recordAiTokenUsage(usage, modelOverride ?? "google/gemini-3.7-flash");
  return {
    content: isCompletion(reply) ? reply.content : typeof reply === "string" ? reply : JSON.stringify(reply),
    annotations: isCompletion(reply) ? reply.annotations : [],
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
