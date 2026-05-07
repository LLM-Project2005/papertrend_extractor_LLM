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
}

export async function createChatCompletion(
  messages: ChatMessage[],
  temperature = 0.2,
  modelOverride?: string,
  taskName?: string,
  parameters: ChatCompletionParameters = {}
): Promise<string | null> {
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
    choices?: Array<{ message?: { content?: string } }>;
  };

  return payload.choices?.[0]?.message?.content?.trim() ?? null;
}
