import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { loadRepositoryContext } from "@/lib/repository-chat";
import { chatCorsPreflight, withChatCors } from "@/lib/chat-cors";
import { exampleQuestions } from "@/lib/chat-guidance";

/**
 * What a question in this scope would actually search, before it is sent.
 *
 * The composer showed a scope name and a hardcoded count of zero, so a reader
 * could not tell whether a question would search five papers or thirty-eight,
 * and the number they saw before sending never matched the number the answer
 * reported afterwards.
 *
 * It also returns example questions built from the reader's own paper titles.
 * Generic examples teach nothing about what this assistant can do with these
 * papers; a question naming a paper they recognise does, and it proves the
 * repository was read.
 */
export async function OPTIONS(request: Request) {
  return chatCorsPreflight(request);
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return withChatCors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), request);
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const folderId = searchParams.get("folderId");

  try {
    const context = await loadRepositoryContext({
      ownerUserId: user.id,
      // No question is being asked; only the scope is being described.
      prompt: "",
      projectId: projectId ?? undefined,
      knowledgeScope: {
        kind: folderId ? "folder" : projectId ? "project" : "all_projects",
        projectId: projectId ?? undefined,
        folderId: folderId ?? undefined,
      },
    });

    const papers = context.papers.map((paper) => ({
      paperId: paper.paperId,
      title: paper.title,
      year: paper.year,
    }));

    return withChatCors(
      NextResponse.json({
        scopeLabel: context.scopeLabel,
        eligiblePaperCount: papers.length,
        examples: exampleQuestions(papers, context.scopeLabel),
        topics: context.topicCounts.slice(0, 6).map((topic) => topic.label),
      }),
      request
    );
  } catch (error) {
    // A scope that cannot be read is not worth an error banner on an empty
    // page: the composer falls back to naming the scope without a count.
    return withChatCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Scope unavailable." },
        { status: 200 }
      ),
      request
    );
  }
}
