/**
 * Audit-chain link for the language-sota writes.
 *
 * Wraps the platform `@borjie/audit-hash-chain` primitive with the shape
 * of payload that the language layer produces. Two payload kinds:
 *
 *   - `utterance` — one row of `language_utterances`.
 *   - `provider-quality` — one row of `language_provider_quality`.
 *
 * No I/O, no DB. Caller persists the entries however they like; the
 * verify path is also pure.
 */

import { chainHash, GENESIS_HASH as PLATFORM_GENESIS } from '@borjie/audit-hash-chain';

/**
 * Re-exports the platform genesis hash so callers can stay inside this
 * package's import surface.
 */
export const GENESIS_HASH = PLATFORM_GENESIS;

export interface UtteranceHashInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly channel: string;
  readonly sourceLang: string;
  readonly detectedLang: string;
  readonly text: string;
  readonly recordedAtIso: string;
  readonly consentState: string;
}

export interface ProviderQualityHashInput {
  readonly tenantId: string;
  readonly provider: string;
  readonly lang: string;
  readonly wer: number;
  readonly per: number;
  readonly mos: number;
  readonly sampleN: number;
  readonly measuredAtIso: string;
}

/**
 * Compute the hash for an utterance row. Combines the row payload with
 * the previous chain head via the sha256-based chain hash.
 */
export function computeUtteranceAuditHash(
  payload: UtteranceHashInput,
  prevHash: string,
): string {
  return chainHash({
    prev: prevHash,
    payload: {
      op: 'language.utterance.record',
      ...payload,
    },
  });
}

/**
 * Compute the hash for a provider-quality row.
 */
export function computeProviderQualityAuditHash(
  payload: ProviderQualityHashInput,
  prevHash: string,
): string {
  return chainHash({
    prev: prevHash,
    payload: {
      op: 'language.provider_quality.record',
      ...payload,
    },
  });
}
