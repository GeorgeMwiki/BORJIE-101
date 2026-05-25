/**
 * Yield-to-main + chunked-loop helpers — INP < 200ms friendly.
 */

export { yieldNow } from './yield-now.js';
export { processInChunks } from './process-in-chunks.js';
export type {
  ChunkProgress,
  ProcessInChunksOptions,
} from './process-in-chunks.js';
