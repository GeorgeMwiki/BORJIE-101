/**
 * Streaming barrel — SSE server + client + stream-merge helpers.
 */

export { streamSSE, formatSSEFrame, SSE_HEADERS } from './stream-sse.js';
export { createSSEEndpoint } from './create-sse-endpoint.js';
export type {
  HonoLikeCtx,
  HonoLikeHandler,
  HonoLikeResponseInit,
} from './create-sse-endpoint.js';
export { streamingFetch, parseSSEFrame } from './streaming-fetch.js';
export type { StreamingFetchOptions } from './streaming-fetch.js';
export { mergeStreams, orderedMerge, tap } from './merge-streams.js';
