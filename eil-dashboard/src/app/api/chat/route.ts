import { NextResponse } from "next/server";
import {
  buildDeterministicGroundedAnswer,
  buildGroundedContext,
  retrieveCorpusPapers,
} from "@/lib/corpus";
import { createChatCompletion } from "@/lib/openai";

export const runtime = "nodejs";

interface ChatRequestBody {
  message?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

function buildFallbackAnswer(question: string, corpusError?: string): string {
  const lines = [
    "Broader guidance beyond the corpus:",
    `I could not find a direct answer to "${question}" in the stored EIL paper data.`,
    "A useful next step is to narrow the question by topic, year, track, or a specific paper title so the answer can be grounded in the dataset.",
  ];

  if (corpusError) {
    lines.push(`Corpus note: ${corpusError}`);
  }

  return lines.join("\n");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const currentMessage =
      body.message ??
      [...(body.messages ?? [])]
        .reverse()
        .find((message) => message.role === "user")?.content;

    if (!currentMessage?.trim()) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    let papers: Awaited<ReturnType<typeof retrieveCorpusPapers>>["papers"] = [];
    let citations: Awaited<ReturnType<typeof retrieveCorpusPapers>>["citations"] = [];
    let corpusError: string | undefined;

    try {
      const corpus = await retrieveCorpusPapers(currentMessage);
      papers = corpus.papers;
      citations = corpus.citations;
    } catch (error) {
      corpusError = error instanceof Error ? error.message : "Corpus retrieval failed.";
    }

    if (papers.length > 0) {
      const context = buildGroundedContext(papers);
      const llmAnswer = await createChatCompletion(
        [
          {
            role: "system",
            content:
              "You are the chat assistant for an EIL research dashboard. Answer from the supplied corpus context first. Cite papers inline as [Paper <id>]. If the corpus is insufficient, add a final section titled 'Broader guidance beyond the corpus'. Do not invent citations.",
          },
          {
            role: "user",
            content: `Question:\n${currentMessage}\n\nCorpus context:\n${context}`,
          },
        ],
        0.2
      );

      return NextResponse.json({
        mode: "grounded",
        answer: llmAnswer ?? buildDeterministicGroundedAnswer(currentMessage, papers),
        citations,
      });
    }

    const fallbackPrompt = [
      {
        role: "system" as const,
        content:
          "You are the chat assistant for an EIL research dashboard. The stored corpus does not directly answer the user's request. Provide careful broader guidance, and begin the answer with the heading 'Broader guidance beyond the corpus:'.",
      },
      {
        role: "user" as const,
        content: currentMessage,
      },
    ];

    const fallbackAnswer =
      (await createChatCompletion(fallbackPrompt, 0.4)) ??
      buildFallbackAnswer(currentMessage, corpusError);

    return NextResponse.json({
      mode: "fallback",
      answer: fallbackAnswer,
      citations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat request failed." },
      { status: 500 }
    );
  }
}
