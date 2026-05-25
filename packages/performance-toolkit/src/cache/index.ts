/**
 * Cache barrel — ETag, SWR, Brotli/Gzip, Cache-Control presets.
 */

export { createETagCache, computeETag } from './etag-cache.js';
export type { ETagCache, ETagHandleArgs } from './etag-cache.js';
export { staleWhileRevalidate } from './stale-while-revalidate.js';
export {
  pickEncoding,
  compressForClient,
  honoCompress,
  isCompressible,
} from './compression.js';
export type { EncodingChoice, CompressedResult } from './compression.js';
export {
  applyCacheControl,
  honoCacheControl,
  expressCacheControl,
} from './cache-control.js';
