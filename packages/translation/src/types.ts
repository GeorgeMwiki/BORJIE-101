/**
 * `@borjie/translation` — facade types.
 *
 * The facade wraps `@borjie/translation-sota` (which itself orchestrates
 * Claude 4.7 → Gemini 2.5 Pro → NLLB-200 with glossary-lock, register,
 * code-switch) and adds a cache layer keyed by (sourceText, sourceLang,
 * targetLang, glossaryVersion, register).
 *
 * The cache table (`translation_cache`) is shared by every surface
 * that emits user-facing text: emails, PDFs, push, SMS, audit log
 * render, decision-journal render, webhook payloads, cron workers,
 * reports, badges, error toasts.
 */

import type { LanguageCode, RegisterLevel } from '@borjie/translation-sota';

export type Locale = LanguageCode;
export type Register = RegisterLevel;

/**
 * Translation request — what callers provide. tenantId is required
 * for glossary scoping + audit-chain. When the source comes from a
 * tenant-agnostic surface (e.g. marketing public emails) callers
 * MUST pass the canonical platform tenant id.
 */
export interface TranslateInput {
  readonly text: string;
  readonly sourceLang: Locale;
  readonly targetLang: Locale;
  readonly tenantId: string;
  readonly register?: Register;
  /**
   * Optional surface label for telemetry / cache key isolation.
   * Examples: 'email.welcome.subject', 'pdf.invoice.header',
   * 'push.licence-expiry.body', 'audit.action-description'.
   */
  readonly surface?: string;
}

/**
 * Translation result — what callers consume. When the source and
 * target languages match, the runner is bypassed entirely (no
 * provider hit, no cache write) and the caller receives the text
 * verbatim with `cacheHit=false, provider='passthrough'`.
 */
export interface TranslateOutput {
  readonly text: string;
  readonly sourceLang: Locale;
  readonly targetLang: Locale;
  readonly cacheHit: boolean;
  readonly provider: 'cache' | 'passthrough' | 'claude-opus-4-7' | 'gemini-2-5-pro' | 'nllb-200';
  readonly latencyMs: number;
}

/**
 * Cache port — pluggable. Production binds the Drizzle-backed
 * Postgres adapter (translation_cache table); tests use the
 * in-memory adapter.
 */
export interface TranslationCachePort {
  readonly get: (key: TranslationCacheKey) => Promise<string | null>;
  readonly set: (key: TranslationCacheKey, value: TranslationCacheValue) => Promise<void>;
}

export interface TranslationCacheKey {
  readonly tenantId: string;
  readonly sourceText: string;
  readonly sourceLang: Locale;
  readonly targetLang: Locale;
  readonly register: Register;
  readonly surface: string;
}

export interface TranslationCacheValue {
  readonly targetText: string;
  readonly provider: string;
  readonly glossaryVersion: string;
}
