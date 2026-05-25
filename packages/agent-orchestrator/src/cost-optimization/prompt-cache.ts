/**
 * Prompt-cache manager — wraps a `BrainPort` to leverage Anthropic's
 * prompt-caching API (cache_control on system + tool sections).
 *
 * Strategy:
 *
 *   - first call with a given (system + tools) signature: cache it
 *     and record stats as "creation"
 *   - subsequent calls with the same signature: signal the brain to
 *     reuse the cached chunk
 *
 * The wrapper itself is transport-agnostic. It tags requests with a
 * cache key (via `traceTag` prefix) so the concrete brain adapter can
 * append the right `cache_control` markers.
 */

import type {
  BrainCallRequest,
  BrainCallResponse,
  BrainPort,
} from '../types.js';

const CACHE_PREFIX = 'cache-key:';

export interface CacheStats {
  readonly creations: number;
  readonly reuses: number;
  readonly distinctKeys: number;
}

export interface PromptCacheManager {
  readonly brain: BrainPort;
  stats(): CacheStats;
  /** Compute the signature key for a given request without calling. */
  signature(req: BrainCallRequest): string;
  /** Pruning: clear the signature memory (e.g. on tenant rotation). */
  reset(): void;
}

export interface CreatePromptCacheInput {
  readonly brain: BrainPort;
  /**
   * Optional hasher; default is a stable JSON-stringify of system +
   * tool name list. Custom hashers can incorporate tenant + version.
   */
  readonly signatureFn?: (req: BrainCallRequest) => string;
}

export function createPromptCacheManager(input: CreatePromptCacheInput): PromptCacheManager {
  const seen = new Set<string>();
  let creations = 0;
  let reuses = 0;
  const sigFn = input.signatureFn ?? defaultSignature;

  return {
    brain: {
      async call(req: BrainCallRequest): Promise<BrainCallResponse> {
        const sig = sigFn(req);
        const isFirst = !seen.has(sig);
        const tagSuffix = isFirst ? 'first' : 'reuse';
        const tag = `${CACHE_PREFIX}${sig.slice(0, 16)}:${tagSuffix}${req.traceTag ? `|${req.traceTag}` : ''}`;
        if (isFirst) {
          seen.add(sig);
          creations += 1;
        } else {
          reuses += 1;
        }
        const resp = await input.brain.call({ ...req, traceTag: tag });
        return resp;
      },
    },
    stats() {
      return Object.freeze({
        creations,
        reuses,
        distinctKeys: seen.size,
      });
    },
    signature: (req) => sigFn(req),
    reset: () => {
      seen.clear();
      creations = 0;
      reuses = 0;
    },
  };
}

function defaultSignature(req: BrainCallRequest): string {
  const tools = (req.tools ?? []).map((t) => t.name).sort();
  return hash(`${req.system}${tools.join('')}`);
}

/** Lightweight DJB2 hash — adequate for in-memory dedup, not crypto. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
