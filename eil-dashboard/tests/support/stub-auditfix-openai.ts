/*
 * src/lib/openai.ts for chat tests (see route-harness.ts): no request leaves
 * the process. Each model call's task name is recorded in
 * globalThis.__auditfixModelCalls and answered from
 * globalThis.__auditfixModelReplies by task name; a task with no reply gets
 * null, as from a model that is not configured. ModelCallError is the real one.
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
  var __auditfixModelCalls: string[] | undefined;
  // eslint-disable-next-line no-var
  var __auditfixModelReplies: Record<string, string> | undefined;
}

export async function createChatCompletionResult(
  _messages: ChatMessage[],
  _temperature = 0.2,
  modelOverride?: string,
  taskName?: string,
  _parameters: ChatCompletionParameters = {}
): Promise<ChatCompletionResult | null> {
  (globalThis.__auditfixModelCalls ??= []).push(taskName ?? "");
  const reply = globalThis.__auditfixModelReplies?.[taskName ?? ""];
  if (reply === undefined) return null;
  return { content: reply, annotations: [], toolCalls: [], model: modelOverride };
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
