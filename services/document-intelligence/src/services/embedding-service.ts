/**
 * Embedding Service (NEW 15)
 *
 * Chunks document text and generates vector embeddings. The default
 * `StubEmbeddingModel` emits deterministic vectors so tests/dev run
 * without an API key — production swaps in a real port (OpenAI
 * `text-embedding-3-small` or Voyage). See KI-009 for the aligned
 * plan on wiring the Anthropic doc-chat adapter.
 */

export interface TextChunk {
  readonly chunkIndex: number;
  readonly text: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

export interface EmbeddedChunk extends TextChunk {
  readonly embedding: readonly number[];
  readonly embeddingModel: string;
}

export interface IEmbeddingModelPort {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<readonly number[][]>;
}

export interface EmbeddingServiceOptions {
  readonly model: IEmbeddingModelPort;
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  /** Max chunks sent per model.embed() call. Default: 32. */
  readonly batchSize?: number;
  /** Max concurrent model.embed() calls. Default: 4. */
  readonly maxConcurrency?: number;
}

export class EmbeddingService {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly batchSize: number;
  private readonly maxConcurrency: number;

  constructor(private readonly options: EmbeddingServiceOptions) {
    this.chunkSize = options.chunkSize ?? 1000;
    this.chunkOverlap = options.chunkOverlap ?? 150;
    this.batchSize = Math.max(1, options.batchSize ?? 32);
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
  }

  /** Split text into overlapping character-window chunks. */
  chunk(text: string, meta: Record<string, unknown> = {}): readonly TextChunk[] {
    if (!text) return [];
    const clean = text.replace(/\s+/g, ' ').trim();
    const chunks: TextChunk[] = [];
    let start = 0;
    let idx = 0;
    while (start < clean.length) {
      const end = Math.min(clean.length, start + this.chunkSize);
      const slice = clean.slice(start, end);
      chunks.push({ chunkIndex: idx, text: slice, meta });
      if (end >= clean.length) break;
      start = end - this.chunkOverlap;
      idx += 1;
    }
    return chunks;
  }

  async embedChunks(chunks: readonly TextChunk[]): Promise<readonly EmbeddedChunk[]> {
    if (chunks.length === 0) return [];

    // Split into batches of `batchSize` and cap concurrent embed() calls
    // at `maxConcurrency`. This keeps a burst of thousands of chunks from
    // stampeding the upstream provider and respects per-request token
    // limits. Rate-limit handling (429) is the provider adapter's
    // responsibility — a 429 thrown here bubbles up to the caller so the
    // ingest job can retry with backoff at a higher level.
    const batches: TextChunk[][] = [];
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      batches.push(chunks.slice(i, i + this.batchSize));
    }

    const results = new Array<readonly number[][]>(batches.length);
    let cursor = 0;

    const runOne = async (): Promise<void> => {
      while (cursor < batches.length) {
        const idx = cursor++;
        const batch = batches[idx];
        if (!batch) continue;
        const vectors = await this.options.model.embed(batch.map((c) => c.text));
        if (vectors.length !== batch.length) {
          throw new Error(
            `embedding count mismatch (batch ${idx}): expected ${batch.length}, got ${vectors.length}`
          );
        }
        results[idx] = vectors;
      }
    };

    const workerCount = Math.min(this.maxConcurrency, batches.length);
    await Promise.all(Array.from({ length: workerCount }, () => runOne()));

    const flat: EmbeddedChunk[] = [];
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b]!;
      const vectors = results[b]!;
      for (let i = 0; i < batch.length; i++) {
        flat.push({
          ...batch[i]!,
          embedding: vectors[i] ?? [],
          embeddingModel: this.options.model.model,
        });
      }
    }
    return flat;
  }

  async embedDocumentText(
    text: string,
    meta: Record<string, unknown> = {}
  ): Promise<readonly EmbeddedChunk[]> {
    const chunks = this.chunk(text, meta);
    return this.embedChunks(chunks);
  }
}

// ---------------------------------------------------------------------------
// Stub model — returns deterministic fake vectors so tests & devs can run
// without an API key. Replace with a real IEmbeddingModelPort.
// ---------------------------------------------------------------------------

export class StubEmbeddingModel implements IEmbeddingModelPort {
  readonly model = 'stub-embedding-v0';
  constructor(readonly dimensions: number = 1536) {}

  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    return texts.map((t) => {
      // Deterministic fake: hash character codes into vector slots.
      const v = new Array<number>(this.dimensions).fill(0);
      for (let i = 0; i < t.length; i++) {
        v[i % this.dimensions] = (v[i % this.dimensions]! + t.charCodeAt(i) / 1000) % 1;
      }
      return v;
    });
  }
}
