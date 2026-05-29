/**
 * Borjie Edge Inference — Cloudflare Worker (Roadmap R3, MVP scaffold).
 *
 * Phase-2 deployment per Docs/RESEARCH/EDGE_INFERENCE_CLOUDFLARE.md.
 * The worker runs Llama 3.1-8b at af-south-1 via Workers AI and emits
 * SSE chunks with the same `message_chunk` envelope as the api-gateway
 * brain. The api-gateway races this stream against the Anthropic
 * adapter; whichever returns the first chunk wins.
 *
 * THIS IS A SCAFFOLD. No deployment until the pilot SLO data lands.
 *
 * Wire shape (POST /v1/edge-brain/turn):
 *   Request  application/json { systemPrompt, intent, language: 'sw'|'en' }
 *   Response text/event-stream
 *     event: message_chunk { text, done }
 *     event: done          { tokens, latencyMs }
 *     event: error         { kind, message, retryable }
 *
 * Security posture:
 *   - PII boundary: the api-gateway scrubs the prompt before forwarding.
 *     The worker NEVER sees tenant names, phone numbers, NIDA, etc.
 *   - Hash chain: the worker emits NO audit record. The api-gateway
 *     writes one row per merged response (single-source per CLAUDE.md).
 *   - CORS: api-gateway is the only client; configured via
 *     `EDGE_BRAIN_ALLOWED_ORIGIN` env var.
 */

interface EdgeBrainEnv {
  readonly AI: AiBinding;
  readonly EDGE_BRAIN_DEFAULT_MODEL?: string;
  readonly EDGE_BRAIN_ALLOWED_ORIGIN?: string;
}

interface AiBinding {
  run(
    model: string,
    input: {
      readonly messages: ReadonlyArray<{
        readonly role: 'system' | 'user' | 'assistant';
        readonly content: string;
      }>;
      readonly stream?: boolean;
    },
  ): Promise<ReadableStream<Uint8Array>>;
}

interface EdgeTurnRequest {
  readonly systemPrompt: string;
  readonly intent: string;
  readonly language: 'sw' | 'en';
  readonly model?: string;
}

function jsonError(
  status: number,
  kind: string,
  message: string,
  retryable: boolean,
): Response {
  return new Response(
    JSON.stringify({ kind, message, retryable }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function corsHeaders(allowed: string | undefined): Record<string, string> {
  return {
    'access-control-allow-origin': allowed ?? '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
  };
}

function parsePayload(body: unknown): EdgeTurnRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.systemPrompt !== 'string') return null;
  if (typeof candidate.intent !== 'string') return null;
  const language =
    candidate.language === 'en' || candidate.language === 'sw'
      ? candidate.language
      : null;
  if (!language) return null;
  return {
    systemPrompt: candidate.systemPrompt,
    intent: candidate.intent,
    language,
    model: typeof candidate.model === 'string' ? candidate.model : undefined,
  };
}

export default {
  async fetch(req: Request, env: EdgeBrainEnv): Promise<Response> {
    const headers = corsHeaders(env.EDGE_BRAIN_ALLOWED_ORIGIN);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (req.method !== 'POST') {
      return jsonError(405, 'method_not_allowed', 'POST only', false);
    }
    const url = new URL(req.url);
    if (url.pathname !== '/v1/edge-brain/turn') {
      return jsonError(404, 'not_found', 'unknown route', false);
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_json', 'body must be JSON', false);
    }
    const parsed = parsePayload(body);
    if (!parsed) {
      return jsonError(
        400,
        'invalid_payload',
        'systemPrompt + intent + language required',
        false,
      );
    }
    const model =
      parsed.model ??
      env.EDGE_BRAIN_DEFAULT_MODEL ??
      '@cf/meta/llama-3.1-8b-instruct';

    // Defer to Workers AI — bind is named `AI` per wrangler.toml.
    const aiStream = await env.AI.run(model, {
      messages: [
        { role: 'system', content: parsed.systemPrompt },
        { role: 'user', content: parsed.intent },
      ],
      stream: true,
    });

    const startedAt = Date.now();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    async function pipe(): Promise<void> {
      let tokens = 0;
      try {
        const reader = aiStream.getReader();
        // Workers AI streams \n-delimited JSON lines. We translate each
        // to a `message_chunk` SSE event so the api-gateway parser is
        // unchanged from the Anthropic adapter shape.
        const decoder = new TextDecoder();
        let buf = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf('\n');
          while (nl !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            nl = buf.indexOf('\n');
            if (!line) continue;
            const payload = line.startsWith('data:')
              ? line.slice(5).trim()
              : line;
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsedLine = JSON.parse(payload) as {
                response?: string;
              };
              const text = parsedLine.response ?? '';
              if (!text) continue;
              tokens += 1;
              const sse = `event: message_chunk\ndata: ${JSON.stringify({
                text,
                done: false,
              })}\n\n`;
              await writer.write(encoder.encode(sse));
            } catch {
              // Skip malformed lines silently — the next attempt will succeed.
            }
          }
        }
        const doneEvent = `event: done\ndata: ${JSON.stringify({
          tokens,
          latencyMs: Date.now() - startedAt,
        })}\n\n`;
        await writer.write(encoder.encode(doneEvent));
      } catch (err) {
        const errorEvent = `event: error\ndata: ${JSON.stringify({
          kind: 'edge_stream_failed',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        })}\n\n`;
        await writer.write(encoder.encode(errorEvent));
      } finally {
        await writer.close();
      }
    }

    // Fire and forget — the response stream returns immediately while
    // the worker keeps writing chunks via the TransformStream.
    pipe().catch(() => {
      // Errors handled above; this catch is defensive.
    });

    return new Response(readable, {
      status: 200,
      headers: {
        ...headers,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-store',
        'x-borjie-edge': '1',
      },
    });
  },
};
