/**
 * SSE-parse helpers extracted from the chat route.
 *
 * Next.js 15 disallows arbitrary exports from route files
 * (`route.ts`) — only HTTP method names, `runtime`, `dynamic`, etc.
 * are valid exports. These helpers live in a sibling module so the
 * route can import them while tests can also import them directly.
 */

/**
 * Concatenate the `text` field of every `message_chunk` frame in a
 * Borjie SSE payload. Used as a defence-in-depth fallback when the
 * widget did not ask for streaming yet the upstream still answered with
 * SSE (the gateway always streams). Without this the raw multi-event
 * blob would land in the chat bubble verbatim — the original bug.
 *
 * SSE frame shape (one record, blank-line terminated):
 *   event: <name>
 *   data: <json>
 *
 * Anything that isn't a `message_chunk` is ignored (turn.accepted /
 * suggested_actions / done / error frames).
 */
export function extractMessageChunksFromSse(sse: string): string {
  const lines = sse.split('\n');
  let currentEvent: string | null = null;
  const parts: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0) {
      currentEvent = null;
      continue;
    }
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('data:')) continue;
    if (currentEvent !== 'message_chunk') continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as { text?: string };
      if (typeof parsed.text === 'string') parts.push(parsed.text);
    } catch {
      /* skip malformed frame */
    }
  }
  return parts.join('').trim();
}

/**
 * Reduce an upstream payload to a single reply string for JSON callers.
 * Handles three shapes:
 *   1. SSE (content-type text/event-stream OR body looks like SSE)
 *   2. JSON envelope with reply/text field
 *   3. Plain text passthrough
 */
export function extractReplyFromUpstream(
  body: string,
  contentType: string,
): string {
  const isSse =
    contentType.includes('text/event-stream') ||
    body.startsWith('event:') ||
    body.startsWith('data:');
  if (isSse) {
    const joined = extractMessageChunksFromSse(body);
    if (joined.length > 0) return joined;
    // Fall through if the SSE carried no message_chunk frames.
  }
  try {
    const json = JSON.parse(body) as { reply?: string; text?: string };
    return json.reply ?? json.text ?? body;
  } catch {
    return body;
  }
}
