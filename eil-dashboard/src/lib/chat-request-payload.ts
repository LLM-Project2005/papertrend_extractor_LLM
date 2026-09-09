const CHAT_REQUEST_MESSAGE_LIMIT = 24;
const CHAT_REQUEST_MESSAGE_CHARACTER_LIMIT = 12_000;
const CHAT_REQUEST_ATTACHMENT_LIMIT = 10;
const CHAT_REQUEST_RUN_LIMIT = 50;

function compactChatMessage(content: string): string {
  if (content.length <= CHAT_REQUEST_MESSAGE_CHARACTER_LIMIT) return content;
  const marker = "\n\n[Long message shortened for conversation context]\n\n";
  const available = CHAT_REQUEST_MESSAGE_CHARACTER_LIMIT - marker.length;
  const startLength = Math.ceil(available * 0.55);
  return `${content.slice(0, startLength)}${marker}${content.slice(-(available - startLength))}`;
}

function uniqueRunIds(values: unknown[]): string[] {
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))]
    .slice(0, CHAT_REQUEST_RUN_LIMIT);
}

export function normalizeChatRequestPayload(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  if (typeof body.message === "string") next.message = compactChatMessage(body.message);
  if (Array.isArray(body.messages)) {
    next.messages = body.messages
      .filter((item): item is { role: "user" | "assistant"; content: string } => {
        if (!item || typeof item !== "object") return false;
        const record = item as Record<string, unknown>;
        return (record.role === "user" || record.role === "assistant") && typeof record.content === "string";
      })
      .slice(-CHAT_REQUEST_MESSAGE_LIMIT)
      .map((item) => ({ role: item.role, content: compactChatMessage(item.content) }));
  }
  if (Array.isArray(body.attachments)) {
    next.attachments = body.attachments.slice(0, CHAT_REQUEST_ATTACHMENT_LIMIT).map((attachment) => {
      if (!attachment || typeof attachment !== "object") return attachment;
      const normalized = { ...(attachment as Record<string, unknown>) };
      if (normalized.size !== undefined && normalized.size !== null) {
        const size = Number(normalized.size);
        if (Number.isFinite(size) && size >= 0) normalized.size = size;
        else delete normalized.size;
      } else {
        delete normalized.size;
      }
      return normalized;
    });
  }
  if (Array.isArray(body.selectedRunIds)) {
    next.selectedRunIds = uniqueRunIds(body.selectedRunIds);
  }
  if (body.knowledgeScope && typeof body.knowledgeScope === "object") {
    const scope = { ...(body.knowledgeScope as Record<string, unknown>) };
    if (Array.isArray(scope.runIds)) scope.runIds = uniqueRunIds(scope.runIds);
    next.knowledgeScope = scope;
  }
  return next;
}
