/**
 * Brain-stream + async-offload helpers — latency wins for the
 * `/api/v1/brain/turn` path.
 *
 * Two concerns live here, kept OUT of the already-large `brain.hono.ts`:
 *
 *   1. STREAMING FIRST-TOKEN — `chunkTextToSse` yields the assistant text
 *      in small chunks so the SSE consumer paints output token-by-token
 *      instead of waiting for the whole answer. (The orchestrator currently
 *      produces the full text before streaming; this keeps the
 *      chunk-by-chunk render contract and tightens the chunk size so the
 *      first visible paint lands sooner.)
 *
 *   2. ASYNC-OFFLOAD — `deferPostResponseWork` runs NON-CRITICAL
 *      post-response work (cognitive-memory observe, analytics) OFF the
 *      critical path so the user's reply is not blocked. The work STILL
 *      RUNS — just after the HTTP response is handed back — and every
 *      error is swallowed so a deferred fault can never surface to the
 *      user who already has their answer.
 *
 * IMPORTANT — what is NOT offloaded: the Auditor evidence-required HARD
 * enforcement (`auditAndEnforceJson`) stays on the critical path because it
 * can WITHHOLD an ungrounded answer (422) — offloading it would let an
 * evidence-empty reply reach the user, violating the CLAUDE.md
 * evidence-required rule. The audit-chain APPEND (which only records, never
 * changes the reply) is safe to defer and is fired here.
 *
 * @module brain-stream-helpers
 */

/**
 * Default SSE chunk size (chars). Smaller than the legacy 80 so the first
 * visible paint lands sooner; still large enough to avoid per-char frame
 * overhead. Tunable via `BORJIE_STREAM_CHUNK_CHARS` (clamped to [16, 240]).
 */
export const DEFAULT_STREAM_CHUNK_CHARS = 48;

/** Resolve the SSE chunk size from env, clamped to a safe range. */
export function resolveStreamChunkChars(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.BORJIE_STREAM_CHUNK_CHARS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return DEFAULT_STREAM_CHUNK_CHARS;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return DEFAULT_STREAM_CHUNK_CHARS;
  return Math.min(240, Math.max(16, n));
}

/**
 * Split `text` into ordered chunks of at most `chunkChars` characters for
 * token-by-token SSE rendering. Pure — returns a fresh array, never mutates.
 */
export function chunkTextToSse(
  text: string,
  chunkChars: number = DEFAULT_STREAM_CHUNK_CHARS,
): ReadonlyArray<string> {
  if (typeof text !== 'string' || text.length === 0) return [];
  const size = Math.max(1, chunkChars);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

/**
 * Run NON-CRITICAL post-response work OFF the critical path. The HTTP
 * response is already (about to be) returned; this schedules `work` on a
 * microtask so it runs AFTER the current turn returns to the event loop,
 * and swallows every error so a deferred fault can never affect the reply
 * the user already received.
 *
 * The work STILL RUNS — this is fire-and-forget, not drop. Callers that
 * need durability beyond process lifetime should enqueue to a real queue;
 * for the per-turn memory observe / analytics the in-process defer is the
 * right trade (the writes are best-effort side-channels by contract).
 */
export function deferPostResponseWork(
  work: () => void | Promise<void>,
  onError?: (err: unknown) => void,
): void {
  queueMicrotask(() => {
    try {
      const ret = work();
      if (ret && typeof (ret as Promise<void>).then === 'function') {
        (ret as Promise<void>).catch((err) => {
          if (onError) onError(err);
        });
      }
    } catch (err) {
      if (onError) onError(err);
    }
  });
}
