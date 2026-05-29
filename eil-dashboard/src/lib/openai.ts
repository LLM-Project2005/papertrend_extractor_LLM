import { getOpenAIConfig } from "@/lib/server-env";

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

export interface ChatCompletionResult {
  content: string | null;
  annotations: ChatCompletionAnnotation[];
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
  const requestBody: Record<string, unknown> = {
    model: modelOverride?.trim() || config.model,
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    model?: string;
    usage?: unknown;
    choices?: Array<{
      message?: {
        content?: unknown;
        annotations?: ChatCompletionAnnotation[];
      };
    }>;
  };

  const message = payload.choices?.[0]?.message;
  return {
    content: normalizeMessageContent(message?.content),
    annotations: Array.isArray(message?.annotations) ? message.annotations : [],
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
