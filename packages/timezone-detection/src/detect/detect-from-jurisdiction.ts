/**
 * Jurisdiction-code → capital-city TZ fallback. Confidence 0.3 — used
 * only when browser + IP + account + JWT are all unavailable (e.g. a
 * webhook callback from a partner with no user context).
 */

import type { DetectionResult, JurisdictionCode } from '../types.js';
import { getJurisdictionDefault } from '../jurisdiction-defaults/index.js';

export function detectFromJurisdiction(
  jurisdictionCode: JurisdictionCode | null | undefined,
): DetectionResult | null {
  if (!jurisdictionCode) return null;
  const def = getJurisdictionDefault(jurisdictionCode);
  if (!def) return null;
  return {
    timezone: def.timezone,
    source: 'jurisdiction',
    confidence: def.isMultiZone ? 0.2 : 0.3,
    reason: `jurisdiction default for ${def.jurisdiction} (${def.canonicalCity}${
      def.isMultiZone ? ', multi-zone — verify against IP' : ''
    })`,
  };
}
