/**
 * Segment-specific system-prompt prefixes. Per spec §6.
 *
 * The composer prepends `SEGMENT_PROMPTS[segment]` to every LLM call.
 * Segments are composable — when targeting two segments, the merged
 * prompt is the concatenation of both with a brief connector.
 */

import type { AudienceSegment } from '../types.js';

export const SEGMENT_PROMPTS: Readonly<Record<AudienceSegment, string>> = Object.freeze({
  mining_owner:
    'Frame for a mining-site owner. Lead with operational efficiency, ROI per truck-hour, regulatory drag reduction, and time-to-Tumemadini. Use concrete unit economics and avoid jargon-heavy investor language. Every numeric claim must include an inline [cite:ID] referencing operational data or ledger.',
  mineral_buyer:
    'Frame for a mineral buyer. Lead with assay quality, provenance, biometric-contract trust, parcel availability, and price competitiveness. Be transparent about ore grades and certification. Every quoted spec must cite an assay certificate or ledger record via [cite:ID].',
  institutional_investor:
    'Frame for an institutional investor. Lead with unit economics, regulatory moats, AI defensibility, TAM, and payback. Cite quarterly data and external research. Required disclaimer: past performance does not predict future results. Every numeric claim must include an inline [cite:ID] resolving to research or ledger.',
  regulator:
    'Frame for a Tanzanian or East-African regulator. Lead with compliance posture, audit-chain transparency, PDPA alignment, and data-residency. Use precise regulatory terminology. Every regulatory claim must cite the statute or clause via [cite:ID].',
  industry_partner:
    'Frame for an industry partner (technology vendor, supply-chain partner, joint-venture co-investor). Lead with integration depth, MCP coverage, joint go-to-market potential, and technical interoperability. Cite integration specs and partnership outcomes via [cite:ID].',
  mining_journalist:
    'Frame for a mining-industry journalist. Lead with data, citations, contrarian angles, and the founder narrative. Provide on-record sources. Be transparent about limitations. Every claim must cite primary research or owner ledger via [cite:ID].',
  general_public:
    'Frame for the general Tanzanian public. Lead with national interest, the formalisation story, jobs created, and environmental stewardship. Plain language. Avoid technical jargon. Every figure (jobs, output, regional impact) must include an inline [cite:ID].',
});

/**
 * Build a system-prompt prefix for a single segment or a merged set
 * of segments. When merging, segment prompts are concatenated with a
 * blank line and a short merge instruction.
 */
export function buildSegmentPromptPrefix(
  segments: ReadonlyArray<AudienceSegment>,
): string {
  if (segments.length === 0) {
    return 'Frame for a general audience. Every factual claim must include an inline [cite:ID].';
  }
  if (segments.length === 1) {
    const seg = segments[0];
    if (seg === undefined) {
      return 'Frame for a general audience. Every factual claim must include an inline [cite:ID].';
    }
    return SEGMENT_PROMPTS[seg];
  }
  const parts = segments.map((s) => SEGMENT_PROMPTS[s]);
  return `Address multiple audience segments in priority order. Merge framings without dropping any. ${parts.join('\n\n')}`;
}
