import { createChatCompletionResult } from "@/lib/openai";
import { buildPapertrendSystemPrompt } from "@/lib/papertrend-system-prompt";
import type { RepositoryCitation } from "@/lib/repository-chat";

function webCitations(annotations: unknown): RepositoryCitation[] {
  if (!Array.isArray(annotations)) return [];
  const seen = new Set<string>();
  const citations: RepositoryCitation[] = [];
  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== "object") continue;
    const value = (annotation as { url_citation?: Record<string, unknown> }).url_citation;
    const url = String(value?.url ?? "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let host = "web";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // Keep the neutral source label for malformed provider annotations.
    }
    const title = String(value?.title ?? host).trim() || host;
    const content = String(value?.content ?? "").trim();
    citations.push({
      paperId: `Web ${citations.length + 1}`,
      title,
      year: "Web",
      href: url,
      reason: content ? content.slice(0, 220) : host,
      sourceType: "web",
    });
  }
  return citations;
}

export async function augmentRepositoryAnswerWithWeb(input: {
  question: string;
  answer: string;
  model?: string;
}): Promise<{ answer: string; citations: RepositoryCitation[]; status: "succeeded" | "skipped" }> {
  const completion = await createChatCompletionResult(
    [
      {
        role: "system",
        content: buildPapertrendSystemPrompt("grounded_answer", [
          "Find concise, current external context that complements the supplied repository-grounded answer. " +
          "Do not repeat or contradict repository evidence without clearly labeling the disagreement. " +
          "Return only the web-context section and do not invent paper citations.",
        ]),
      },
      {
        role: "user",
        content: `Question: ${input.question}\n\nRepository-grounded answer:\n${input.answer}`,
      },
    ],
    0.2,
    input.model,
    "CHAT_WEB_AUGMENT",
    {
      maxTokens: 1_200,
      tools: [{
        type: "openrouter:web_search",
        parameters: { max_results: 5, max_total_results: 8, search_context_size: "medium" },
      }],
      toolChoice: "auto",
    }
  );
  const section = completion?.content?.trim();
  const citations = webCitations(completion?.annotations ?? []);
  return {
    answer: section ? `${input.answer}\n\n## Web context\n\n${section}` : input.answer,
    citations,
    status: section || citations.length > 0 ? "succeeded" : "skipped",
  };
}
