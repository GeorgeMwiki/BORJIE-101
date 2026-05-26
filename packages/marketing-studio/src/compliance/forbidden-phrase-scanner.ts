/**
 * Forbidden-phrase scanner — per spec §8 + §11.
 *
 * Case-insensitive substring match. Returns the list of forbidden
 * phrases found in the body. Never mutates.
 */

import { DEFAULT_FORBIDDEN_PHRASES } from '../types.js';

export interface ForbiddenScanArgs {
  readonly body: string;
  readonly extra_forbidden?: ReadonlyArray<string>;
}

/**
 * Scan a body for forbidden phrases. Returns the set actually found
 * (deduped, lower-case keyed by the input phrase form).
 */
export function scanForbiddenPhrases(args: ForbiddenScanArgs): ReadonlyArray<string> {
  const lowered = args.body.toLowerCase();
  const allPhrases = [
    ...DEFAULT_FORBIDDEN_PHRASES,
    ...(args.extra_forbidden ?? []),
  ];
  const found = new Set<string>();
  for (const phrase of allPhrases) {
    const needle = phrase.toLowerCase();
    if (needle.length > 0 && lowered.includes(needle)) {
      found.add(phrase);
    }
  }
  return Object.freeze(Array.from(found));
}
