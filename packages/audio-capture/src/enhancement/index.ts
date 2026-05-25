/**
 * Enhancement port + adapters.
 *
 * `EnhancementPort.enhance` returns a *new* AudioChunk with the same format
 * but processed bytes. Vendor adapters route to remote APIs; the mock applies
 * a deterministic normalization in-process so tests can verify volume scaling
 * without external dependencies.
 */

import type { AudioChunk, EnhancementSpec } from '../types.js';

export interface EnhancementPort {
  readonly provider: string;
  enhance(spec: EnhancementSpec): Promise<AudioChunk>;
}

export { createResembleEnhanceAdapter } from './resemble.js';
export { createKrispAdapter } from './krisp.js';
export { createMockEnhancement } from './mock.js';
export { normaliseToLufs } from './loudness.js';
