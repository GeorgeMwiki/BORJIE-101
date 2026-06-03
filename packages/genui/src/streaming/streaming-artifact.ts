/**
 * Generative-UI streaming primitive (LP-24b).
 *
 * Where the artifact-stream-parser turns raw token soup into open/delta/
 * close lifecycle events, THIS module works one level higher: a typed,
 * structured artifact (`StreamingArtifact<T>`) that arrives in
 * incremental chunks (schema → partial* → final | error) so a UI can
 * pre-allocate slots and render progressively.
 *
 *   - `StreamingArtifact<T>` — the assembled, immutable view a consumer
 *     reduces chunks into.
 *   - `ArtifactChunk<T>` — one wire chunk.
 *   - `createArtifactWriter<T>` — server-side writer that publishes
 *     chunks through an injected transport (SSE / WebSocket / realtime).
 *   - `reduceArtifactChunk` — pure reducer to fold a chunk into a
 *     `StreamingArtifact<T>` snapshot (so client and server share logic).
 *
 * Pure: all side effects flow through the injected `ArtifactTransport`.
 *
 * Reference: LITFIN src/core/ui/generative-stream.ts.
 *
 * @module genui/streaming/streaming-artifact
 */

export type ArtifactChunkKind =
  /** Initial schema declaration so the UI can pre-allocate slots. */
  | "schema"
  /** Partial value update — shallow-merged into the artifact. */
  | "partial"
  /** Final committed value — replaces the artifact. */
  | "final"
  /** Stream error — the consumer should surface it. */
  | "error";

export interface ArtifactChunk<T = Record<string, unknown>> {
  readonly artifactId: string;
  readonly kind: ArtifactChunkKind;
  readonly data?: Partial<T> | T;
  readonly error?: string;
  /** Monotonic per-artifact sequence number, starting at 1. */
  readonly seq: number;
  /** Sender wall-clock at emit time (ms). */
  readonly emittedAt: number;
}

export type StreamingArtifactStatus =
  | "streaming"
  | "complete"
  | "error";

/**
 * The assembled view a consumer reduces chunks into. Immutable —
 * `reduceArtifactChunk` always returns a fresh object.
 */
export interface StreamingArtifact<T = Record<string, unknown>> {
  readonly artifactId: string;
  readonly status: StreamingArtifactStatus;
  /** Best-known value so far (schema, then merged partials, then final). */
  readonly value: Partial<T>;
  readonly error?: string;
  /** Last sequence number folded in. */
  readonly lastSeq: number;
}

/**
 * Transport contract — injected so this module is testable without SSE /
 * WebSocket wiring.
 */
export interface ArtifactTransport {
  readonly publish: (chunk: ArtifactChunk) => void | Promise<void>;
  readonly close: () => void | Promise<void>;
}

export interface ArtifactWriter<T> {
  readonly artifactId: string;
  /** Initial schema-only chunk. Call once at the start. */
  readonly schema: (schema: Partial<T>) => Promise<void>;
  /** Stream a partial update (shallow-merged). */
  readonly partial: (partial: Partial<T>) => Promise<void>;
  /** Commit the final value and close the stream. */
  readonly final: (value: T) => Promise<void>;
  /** Mark the stream failed and close. */
  readonly fail: (error: string) => Promise<void>;
  readonly closed: () => boolean;
}

export interface ArtifactWriterClock {
  readonly now: () => number;
}

/**
 * Create a typed artifact writer. Pure — side effects flow through the
 * injected transport. The clock is injectable for deterministic tests.
 */
export function createArtifactWriter<T>(
  artifactId: string,
  transport: ArtifactTransport,
  clock: ArtifactWriterClock = { now: () => Date.now() },
): ArtifactWriter<T> {
  let seq = 0;
  let isClosed = false;

  function ensureOpen(): void {
    if (isClosed) {
      throw new Error(
        `ArtifactWriter '${artifactId}' is closed; further writes are not allowed.`,
      );
    }
  }

  function publish(
    kind: ArtifactChunkKind,
    data?: Partial<T> | T,
    error?: string,
  ): Promise<void> {
    seq += 1;
    const chunk: ArtifactChunk = {
      artifactId,
      kind,
      seq,
      emittedAt: clock.now(),
      ...(data !== undefined ? { data: data as Partial<unknown> } : {}),
      ...(error !== undefined ? { error } : {}),
    };
    return Promise.resolve(transport.publish(chunk));
  }

  return {
    artifactId,
    async schema(schema) {
      ensureOpen();
      await publish("schema", schema);
    },
    async partial(partial) {
      ensureOpen();
      await publish("partial", partial);
    },
    async final(value) {
      ensureOpen();
      await publish("final", value);
      isClosed = true;
      await Promise.resolve(transport.close());
    },
    async fail(error) {
      if (isClosed) return;
      await publish("error", undefined, error);
      isClosed = true;
      await Promise.resolve(transport.close());
    },
    closed: () => isClosed,
  };
}

/**
 * Pure reducer: fold one chunk into a `StreamingArtifact<T>` snapshot.
 * Out-of-order / stale chunks (seq <= lastSeq) are ignored so a
 * reconnect replay cannot regress the view. Returns the same reference
 * when nothing changed.
 */
export function reduceArtifactChunk<T>(
  prev: StreamingArtifact<T> | undefined,
  chunk: ArtifactChunk<T>,
): StreamingArtifact<T> {
  const base: StreamingArtifact<T> =
    prev ?? {
      artifactId: chunk.artifactId,
      status: "streaming",
      value: {},
      lastSeq: 0,
    };

  // Ignore stale / duplicate chunks and chunks for a different artifact.
  if (chunk.artifactId !== base.artifactId || chunk.seq <= base.lastSeq) {
    return base;
  }

  switch (chunk.kind) {
    case "schema":
      return {
        artifactId: base.artifactId,
        status: "streaming",
        value: { ...base.value, ...(chunk.data as Partial<T>) },
        lastSeq: chunk.seq,
      };
    case "partial":
      return {
        artifactId: base.artifactId,
        status: "streaming",
        value: { ...base.value, ...(chunk.data as Partial<T>) },
        lastSeq: chunk.seq,
      };
    case "final":
      return {
        artifactId: base.artifactId,
        status: "complete",
        value: (chunk.data as T) ?? base.value,
        lastSeq: chunk.seq,
      };
    case "error":
      return {
        artifactId: base.artifactId,
        status: "error",
        value: base.value,
        error: chunk.error ?? "unknown error",
        lastSeq: chunk.seq,
      };
    default:
      return base;
  }
}

/**
 * Fold a full chunk sequence into one snapshot (server replay / tests).
 */
export function assembleArtifact<T>(
  chunks: ReadonlyArray<ArtifactChunk<T>>,
): StreamingArtifact<T> | undefined {
  let acc: StreamingArtifact<T> | undefined;
  for (const chunk of chunks) {
    acc = reduceArtifactChunk(acc, chunk);
  }
  return acc;
}

/**
 * In-memory transport for tests + local-dev replay. Records every chunk
 * and exposes a `consume()` snapshot.
 */
export function createInMemoryArtifactTransport(): ArtifactTransport & {
  readonly consume: () => ReadonlyArray<ArtifactChunk>;
  readonly isClosed: () => boolean;
} {
  const buffer: ArtifactChunk[] = [];
  let closed = false;
  return {
    publish: (c) => {
      buffer.push(c);
    },
    close: () => {
      closed = true;
    },
    consume: () => [...buffer],
    isClosed: () => closed,
  };
}
