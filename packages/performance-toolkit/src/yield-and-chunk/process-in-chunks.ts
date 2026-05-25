/**
 * `processInChunks` — process an iterable in chunks, yielding between
 * chunks. Tunable chunk size and optional yield-every cadence to keep
 * INP below the Web Vitals 200ms threshold.
 *
 * Use this anywhere a hot loop walks more than ~50 items on the client
 * — keystroke filters, batched import processing, large list sorts,
 * Vega-Lite chart data transforms, forecasting model warmup,
 * document-AI OCR result joining.
 *
 * @example basic
 *   await processInChunks(rows, (row) => parseRow(row));
 *
 * @example tuned chunk-size + per-item async work
 *   const parsed = await processInChunks(
 *     rows,
 *     async (row) => parseRowAsync(row),
 *     { chunkSize: 16, yieldEvery: 64 },
 *   );
 *
 * @example tracking progress
 *   await processInChunks(rows, parse, {
 *     onChunk: ({ processed, total }) => updateBar(processed / total),
 *   });
 *
 * @module yield-and-chunk/process-in-chunks
 */

import { yieldNow } from './yield-now.js';

export interface ProcessInChunksOptions {
  /**
   * Items per chunk before yielding. Lower for expensive callbacks,
   * higher for cheap ones. Default 50 matches the web.dev INP
   * guidance: keep the longest task under 50ms; if each callback is
   * < 1ms, 50 items still fits.
   */
  readonly chunkSize?: number;

  /**
   * If set, yield every N items regardless of chunk boundary. Useful
   * when chunk size is large for batching purposes but you still want
   * frequent yields. Defaults to `chunkSize`.
   */
  readonly yieldEvery?: number;

  /**
   * Progress callback fired after each yield. Lets callers update a
   * progress bar without polluting the per-item callback.
   */
  readonly onChunk?: (progress: ChunkProgress) => void;
}

export interface ChunkProgress {
  readonly processed: number;
  readonly total: number;
  readonly chunkIndex: number;
}

const DEFAULT_CHUNK_SIZE = 50;

/**
 * Map `items` through `fn` in chunks. Awaits each callback (so async
 * callbacks are safe) and yields to the main thread between chunks.
 * Returns the array of results in input order.
 */
export async function processInChunks<T, R>(
  items: ReadonlyArray<T>,
  fn: (item: T, index: number) => R | Promise<R>,
  opts: ProcessInChunksOptions = {},
): Promise<R[]> {
  if (items.length === 0) return [];
  const chunkSize = Math.max(1, Math.floor(opts.chunkSize ?? DEFAULT_CHUNK_SIZE));
  const yieldEvery = Math.max(1, Math.floor(opts.yieldEvery ?? chunkSize));
  const results: R[] = new Array(items.length);
  let chunkIndex = 0;
  for (let i = 0; i < items.length; i += 1) {
    results[i] = await fn(items[i] as T, i);
    if (i > 0 && (i + 1) % yieldEvery === 0 && (i + 1) < items.length) {
      await yieldNow();
      chunkIndex += 1;
      if (opts.onChunk !== undefined) {
        opts.onChunk({
          processed: i + 1,
          total: items.length,
          chunkIndex,
        });
      }
    }
  }
  return results;
}
