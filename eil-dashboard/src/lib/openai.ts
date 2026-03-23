import { getOpenAIConfig } from "@/lib/server-env";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function createChatCompletion(
  messages: ChatMessage[],
  temperature = 0.2
): Promise<string | null> {
  const config = getOpenAIConfig();
  if (!config) {
    return null;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      messages,
    }),
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
