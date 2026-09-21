interface ChatErrorPayload {
  error?: string;
}

const FIREBASE_GATEWAY_TIMEOUT_MESSAGE =
  "This answer took longer than the public gateway allows. Check this conversation in a moment before retrying; background reports continue even if this page stops waiting.";

export async function readChatResponse<T extends ChatErrorPayload>(
  response: Response
): Promise<T> {
  if (response.status === 502 || response.status === 504) {
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

export interface ChatProgressUpdate {
  stage: string;
  label: string;
  detail?: string;
}

/**
 * Reads a Server-Sent Events chat response, reporting progress as it arrives.
 *
 * A repository answer runs several model calls, so the reader would otherwise
 * watch one static label for up to half a minute. The final `result` frame
 * carries exactly the payload the JSON route returns.
 */
export async function readChatStream<T extends ChatErrorPayload>(
  response: Response,
  onProgress: (update: ChatProgressUpdate) => void
): Promise<T> {
  if (response.status === 502 || response.status === 504) {
    throw new Error(FIREBASE_GATEWAY_TIMEOUT_MESSAGE);
  }
  if (!response.body) {
    throw new Error("The chat service returned an unreadable response. Please retry.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;
  let failure: { error: string; status: number } | null = null;

  const handleFrame = (frame: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (eventName === "progress") {
      const update = payload as ChatProgressUpdate;
      if (update?.label) onProgress(update);
    } else if (eventName === "result") {
      result = payload as T;
    } else if (eventName === "error") {
      failure = payload as { error: string; status: number };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      handleFrame(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handleFrame(buffer);

  if (failure) throw new Error((failure as { error: string }).error);
  if (!result) {
    throw new Error("The chat service returned an unreadable response. Please retry.");
  }
  return result;
}
