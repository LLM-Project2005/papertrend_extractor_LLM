interface ChatErrorPayload {
  error?: string;
}

const FIREBASE_GATEWAY_TIMEOUT_MESSAGE =
  "This answer took longer than the public gateway allows. Check this conversation in a moment before retrying; background reports continue even if this page stops waiting.";

export async function readChatResponse<T extends ChatErrorPayload>(
  response: Response
): Promise<T> {
  if (response.status === 504) {
    throw new Error(FIREBASE_GATEWAY_TIMEOUT_MESSAGE);
  }

  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    throw new Error(
      payload?.error ??
        `Chat request failed (${response.status}). Please retry; if it continues, report the time of the request so it can be traced.`
    );
  }
  if (!payload) {
    throw new Error("The chat service returned an unreadable response. Please retry.");
  }
  return payload;
}
