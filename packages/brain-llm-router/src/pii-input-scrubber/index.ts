/**
 * `@borjie/brain-llm-router/pii-input-scrubber` — public surface.
 *
 * 3-stage cascade (brand redact → PII regex → Presidio shape):
 *
 *     safeText(input)      → string (scrubbed)
 *     safePayload(value)   → same shape with all string leaves scrubbed
 */

export {
  safeText,
  safePayload,
  setPiiScrubberConfig,
  resetPiiScrubberConfig,
  type PiiScrubberConfig,
  type BrandRedactor,
  type PiiScrubber,
  type PresidioScrubber,
} from './pii-scrubber.js';
export {
  PII_PATTERNS,
  scrubPiiText,
  type PiiPattern,
} from './pii-patterns.js';
