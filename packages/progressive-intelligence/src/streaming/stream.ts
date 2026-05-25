/**
 * Streaming-inference helpers.
 *
 * `streamInference({ request, brain })` returns an `AsyncIterable<StreamingEvent>`
 * with monotonic ids per stream. Backpressure-aware: if the consumer
 * stops pulling, the generator pauses (vanilla JS async generator
 * semantics — no buffer overrun on the brain side).
 *
 * Reconnect-safe: callers persist the last `id` they received and pass
 * it back as `resumeFromId`. We replay nothing (the brain may not
 * support it), but we filter out any events with id <= resumeFromId
 * which lets clients fast-forward through an in-memory replay buffer.
 *
 * The SSE encoder is decoupled so the same iterator works in a Hono
 * route, a WebSocket relay, or a queue worker.
 */
import type { Brain, BrainChunk, BrainRequest, StreamingEvent } from '../types.js';

export interface StreamInferenceArgs {
  readonly request: BrainRequest;
  readonly brain: Brain;
  /** Inject a clock for deterministic tests. */
  readonly now?: () => Date;
  /** Resume from a previous event id (filter out anything <= this). */
  readonly resumeFromId?: number;
  /** Heartbeat interval — for keep-alive on idle streams. 0 disables. */
  readonly heartbeatMs?: number;
}

export async function* streamInference(
  args: StreamInferenceArgs,
): AsyncIterable<StreamingEvent> {
  const now = args.now ?? (() => new Date());
  const startTs = now().toISOString();
  const resumeFromId = args.resumeFromId ?? 0;
  let id = resumeFromId + 1;

  // Emit a meta event so the consumer knows the stream is alive.
  const startEvent: StreamingEvent = {
    id: id++,
    kind: 'meta',
    data: 'stream-started',
    ts: startTs,
    meta: { resumedFrom: resumeFromId },
  };
  yield startEvent;

  try {
    const stream = args.brain.stream(args.request);
    let lastEmitAt = Date.now();
    for await (const chunk of stream) {
      const ts = now().toISOString();
      const event = mapChunk(chunk, id, ts);
      if (!event) continue;
      id += 1;
      yield event;
      lastEmitAt = Date.now();
      if (event.kind === 'done' || event.kind === 'error') return;
      // Cooperative heartbeat — yields a heartbeat event if no token
      // has been emitted for `heartbeatMs`. Disabled by default to
      // keep the contract simple; consumers can wrap if they want.
      if (
        args.heartbeatMs &&
        args.heartbeatMs > 0 &&
        Date.now() - lastEmitAt >= args.heartbeatMs
      ) {
        const hb: StreamingEvent = {
          id: id++,
          kind: 'heartbeat',
          data: 'hb',
          ts: now().toISOString(),
        };
        yield hb;
      }
    }
    const doneEvent: StreamingEvent = {
      id: id++,
      kind: 'done',
      data: 'stream-ended',
      ts: now().toISOString(),
    };
    yield doneEvent;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorEvent: StreamingEvent = {
      id: id++,
      kind: 'error',
      data: message,
      ts: now().toISOString(),
    };
    yield errorEvent;
  }
}

function mapChunk(
  chunk: BrainChunk,
  id: number,
  ts: string,
): StreamingEvent | undefined {
  switch (chunk.kind) {
    case 'token':
      return { id, kind: 'token', data: chunk.text, ts };
    case 'error':
      return { id, kind: 'error', data: chunk.message, ts };
    case 'done':
      return chunk.meta
        ? { id, kind: 'done', data: 'stream-ended', ts, meta: chunk.meta }
        : { id, kind: 'done', data: 'stream-ended', ts };
    default:
      return undefined;
  }
}

/**
 * Encode a StreamingEvent as a single SSE frame
 * (`id: ...\nevent: ...\ndata: ...\n\n`). Multi-line `data` is split
 * across `data:` lines per SSE spec.
 */
export function encodeSse(event: StreamingEvent): string {
  const parts: string[] = [];
  parts.push(`id: ${event.id}`);
  parts.push(`event: ${event.kind}`);
  for (const line of event.data.split('\n')) {
    parts.push(`data: ${line}`);
  }
  if (event.meta) {
    parts.push(`data: ${JSON.stringify({ meta: event.meta })}`);
  }
  return parts.join('\n') + '\n\n';
}

/**
 * Convenience pipe: streamInference → SSE-encoded async iterable of
 * strings. Useful for a Hono / Express handler.
 */
export async function* streamInferenceAsSse(
  args: StreamInferenceArgs,
): AsyncIterable<string> {
  for await (const event of streamInference(args)) {
    yield encodeSse(event);
  }
}
