/**
 * Content-hash helper for the translation cache.
 *
 * The cache table (`translation_cache`) is keyed by SHA-256 of the
 * canonical join of (sourceLang, targetLang, register, surface,
 * sourceText). Identical content collapses to one row irrespective of
 * which tenant requested it first.
 *
 * Uses Web-Crypto in browsers/edge and node:crypto on Node 18+ so the
 * module works inside Bun, Workers, and Vercel Edge.
 */

import { createHash } from 'node:crypto';
import type { TranslationCacheKey } from './types.js';

const FIELD_SEP = '␟'; // unit-separator — unlikely in user text

export function canonicalCacheString(key: TranslationCacheKey): string {
  return [
    key.sourceLang,
    key.targetLang,
    key.register,
    key.surface,
    key.sourceText,
  ].join(FIELD_SEP);
}

export function contentHash(key: TranslationCacheKey): string {
  return createHash('sha256').update(canonicalCacheString(key), 'utf8').digest('hex');
}
