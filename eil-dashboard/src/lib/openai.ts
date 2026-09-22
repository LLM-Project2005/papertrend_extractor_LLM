import { getOpenAIConfig } from "@/lib/server-env";
import { recordAiTokenUsage } from "@/lib/ai-token-usage";
import { recordModelCallLatency } from "@/lib/model-latency";
import { cancellationSignal, requestSignal } from "@/lib/chat-cancellation";
import {
  adviseOnFailure,
  backoffMs,
  classifyFailure,
  isTransient,
  type FailureAdvice,
} from "@/lib/model-failure";
import { modelForTask } from "@/lib/model-routing";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionParameters {
  topP?: number;
  topK?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  tools?: unknown[];
  toolChoice?: unknown;
  parallelToolCalls?: boolean;
  timeoutMs?: number;
}

export interface ChatCompletionAnnotation {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

export interface ChatCompletionToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatCompletionResult {
  content: string | null;
  annotations: ChatCompletionAnnotation[];
  toolCalls: ChatCompletionToolCall[];
  model?: string;
  usage?: unknown;
}

function normalizeMessageContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim() || null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("")
      .trim();
    return text || null;
  }

  return null;
}

/**
 * A model failure that already knows what to tell the reader.
 *
 * Carrying the advice on the error means the route does not have to
 * re-diagnose a string it did not produce.
 */
export class ModelCallError extends Error {
  readonly advice: FailureAdvice;
  readonly status?: number;
  readonly providerMessage?: string;

  constructor(advice: FailureAdvice, status?: number, providerMessage?: string) {
    super(advice.message);
    this.name = "ModelCallError";
    this.advice = advice;
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

export async function createChatCompletionResult(
  messages: ChatMessage[],
  temperature = 0.2,
  modelOverride?: string,
  taskName?: string,
  parameters: ChatCompletionParameters = {}
): Promise<ChatCompletionResult | null> {
  const config = getOpenAIConfig(taskName);
  if (!config) {
    return null;
  }

  const usesOpenRouter = config.baseUrl.includes("openrouter.ai");
  // Steps that only emit JSON for other code run on the fast model; the two
  // steps a reader sees keep whatever the caller asked for.
  const routedModel = modelForTask({ taskName, requestedModel: modelOverride, usesOpenRouter });
  const requestBody: Record<string, unknown> = {
    model: routedModel || config.model,
    temperature,
    messages,
  };

  if (typeof parameters.topP === "number") {
    requestBody.top_p = parameters.topP;
  }
  if (typeof parameters.maxTokens === "number") {
    requestBody.max_tokens = parameters.maxTokens;
  }
  if (typeof parameters.frequencyPenalty === "number") {
    requestBody.frequency_penalty = parameters.frequencyPenalty;
  }
  if (typeof parameters.presencePenalty === "number") {
    requestBody.presence_penalty = parameters.presencePenalty;
  }
  if (usesOpenRouter && typeof parameters.topK === "number") {
    requestBody.top_k = parameters.topK;
  }
  if (parameters.tools && parameters.tools.length > 0) {
    requestBody.tools = parameters.tools;
  }
  if (parameters.toolChoice !== undefined) {
    requestBody.tool_choice = parameters.toolChoice;
  }
  if (typeof parameters.parallelToolCalls === "boolean") {
    requestBody.parallel_tool_calls = parameters.parallelToolCalls;
  }

  // Latency per call was never recorded, so a slow answer could not be
  // attributed to a particular step. Measuring is a precondition for tuning it.
  const startedAt = performance.now();

  /**
   * One retry, and only for a failure that could plausibly go the other way.
   *
   * A single dropped connection or a momentary 500 used to cost the reader the
   * whole answer: every step here degrades to something worse - deterministic
   * ranking, a skipped audit, a raw evidence list - and a transient blip is not
   * a good reason to take that. Retrying a refusal instead, a malformed
   * request or an unpaid account, would only double the wait before the same
   * outcome, so those are not retried.
   */
  let response: Response | null = null;
  let lastFailure: { status?: number; message?: string } = {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      const wait = backoffMs(classifyFailure(lastFailure));
      console.info("model_call_retry", JSON.stringify({ task: taskName ?? "unnamed", after: lastFailure, waitMs: wait }));
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    try {
      const attempted = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        // Stops when the reader leaves as well as when the call takes too long.
        signal: requestSignal(parameters.timeoutMs),
      });
      if (attempted.ok) {
        response = attempted;
        break;
      }
      lastFailure = { status: attempted.status, message: await attempted.text() };
    } catch (error) {
      lastFailure = { message: error instanceof Error ? error.message : String(error) };
    }
    // A reader who has gone away, or a request already refused, is not retried.
    if (cancellationSignal()?.aborted || !isTransient(lastFailure)) break;
  }

  if (!response) {
    recordModelCallLatency(taskName, performance.now() - startedAt, "failed", String(requestBody.model));
    const advice = adviseOnFailure({ ...lastFailure, aborted: cancellationSignal()?.aborted });
    throw new ModelCallError(advice, lastFailure.status, lastFailure.message);
  }

  const payload = (await response.json()) as {
    model?: string;
    usage?: unknown;
    choices?: Array<{
      message?: {
        content?: unknown;
        annotations?: ChatCompletionAnnotation[];
        tool_calls?: ChatCompletionToolCall[];
      };
    }>;
  };

  const message = payload.choices?.[0]?.message;
  recordModelCallLatency(taskName, performance.now() - startedAt, "ok", String(requestBody.model));
  // The model that served it, so the tokens can be turned into a cost.
  recordAiTokenUsage(payload.usage, String(requestBody.model));
  return {
    content: normalizeMessageContent(message?.content),
    annotations: Array.isArray(message?.annotations) ? message.annotations : [],
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
    model: payload.model,
    usage: payload.usage,
  };
}

export async function createChatCompletion(
  messages: ChatMessage[],
  temperature = 0.2,
  modelOverride?: string,
  taskName?: string,
  parameters: ChatCompletionParameters = {}
): Promise<string | null> {
  const result = await createChatCompletionResult(
    messages,
    temperature,
    modelOverride,
    taskName,
    parameters
  );
  return result?.content ?? null;
}
