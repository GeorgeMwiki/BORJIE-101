/**
 * Spotlight wrapper — wraps content as DATA between random-suffix
 * delimiters so it cannot be confused for an instruction by the LLM.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4
 */

import { randomBytes } from 'node:crypto';

import { type SpotlightSource, type SpotlitContent, SPOTLIGHT_SYSTEM_DIRECTIVE } from './types.js';

const MAX_DELIMITER_REPETITION = 3;

/**
 * Generate a random 6-char hex delimiter suffix for this session.
 * Per-session randomness prevents attackers from constructing the
 * closing tag (replay-resistance).
 */
export function makeDelimiterId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Strip / neutralise any attempt by upstream content to embed a closing
 * delimiter mid-payload. Replaces with a visible marker that the
 * downstream classifier (and humans) can see.
 */
function neutralizeInnerDelimiters(content: string, delimiterId: string): string {
  if (content.length === 0) return content;
  // Find any occurrence of <<<END_XYZ>>> with the same id and neutralise it
  const escapedId = delimiterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<<<END_[A-Z_]+_${escapedId}>>>`, 'g');
  return content.replace(re, '[neutralised-delimiter]');
}

/**
 * Wrap content as DATA in spotlighting delimiters.
 *
 *   <<<SOURCE_<delimiter>>>>
 *     ...content...
 *   <<<END_SOURCE_<delimiter>>>>
 *
 * Per-session delimiter prevents attackers from constructing the
 * closing tag.
 */
export function spotlight(
  source: SpotlightSource,
  content: string,
  delimiterId: string = makeDelimiterId()
): SpotlitContent {
  if (delimiterId.length === 0) {
    throw new Error('spotlight: delimiterId must be non-empty');
  }
  const cleanContent = neutralizeInnerDelimiters(content, delimiterId);
  const open = `<<<${source}_${delimiterId}>>>`;
  const close = `<<<END_${source}_${delimiterId}>>>`;
  const wrapped = `${open}\n${cleanContent}\n${close}`;
  return Object.freeze({ source, delimiterId, wrapped });
}

/**
 * Convenience — wrap a disclosure-eligible field's content.
 *
 * Even Tier-2 fields shown to internal staff should be spotlit so the
 * LLM doesn't accidentally treat the field's content as a directive.
 */
export function spotlightDisclosedField(
  content: string,
  delimiterId: string = makeDelimiterId()
): SpotlitContent {
  return spotlight('DISCLOSED_FIELD', content, delimiterId);
}

/**
 * Convenience — wrap a tenant document (RAG retrieval result).
 */
export function spotlightTenantDocument(
  content: string,
  delimiterId: string = makeDelimiterId()
): SpotlitContent {
  return spotlight('TENANT_DOCUMENT', content, delimiterId);
}

/**
 * Convenience — wrap a user message (chat input).
 */
export function spotlightUserMessage(
  content: string,
  delimiterId: string = makeDelimiterId()
): SpotlitContent {
  return spotlight('USER_MESSAGE', content, delimiterId);
}

/**
 * Returns the system-prompt directive that should be paired with the
 * spotlighting wrapper. This MUST be in the system prompt itself, not
 * in user-injected content.
 */
export function getSpotlightSystemDirective(): string {
  return SPOTLIGHT_SYSTEM_DIRECTIVE;
}

/**
 * Maximum delimiter repetition allowed — guard for very long pipelines.
 */
export function maxDelimiterRepetition(): number {
  return MAX_DELIMITER_REPETITION;
}
