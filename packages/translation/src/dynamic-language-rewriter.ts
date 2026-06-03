/**
 * Dynamic, fail-FIXED language-purity rewriter (LP-23).
 *
 * This is the SOTA, non-hardcoded language safety net. When a string is
 * meant to be 100% one language but the producer leaked tokens from the
 * other ("AI Credit biashara Officer" in an English reply), this module:
 *
 *   1. Detects the contamination DYNAMICALLY via the lexicon-backed
 *      `offTargetRatio` detector (NOT a fixed substitution table).
 *   2. If contaminated, rewrites the text in REAL TIME via the injected
 *      brain / LLM port — a genuine AI language pass, generated per
 *      string, never a dictionary or template substitution.
 *   3. Caches the rewrite (AI OUTPUT, not a hardcoded mapping) so an
 *      identical leak rewrites once per process lifetime.
 *
 * FAIL-FIXED, not fail-open: the whole reason this exists is the
 * zero-mix mandate. The old facade returned SOURCE text on provider
 * failure, which can ship a mixed/wrong-language string to a user. Here,
 * if the live rewrite fails OR the model still returns a contaminated
 * string, we fall back to a SAFE single-language string — never mixed.
 * The caller supplies that safe fallback (an i18n constant in the target
 * language); we never invent prose.
 *
 * The brain/LLM is an INJECTED PORT — no provider SDK is imported here,
 * keeping this leaf pure and testable. Production binds the port to the
 * Borjie brain (Opus 4.x) at the composition root.
 *
 * Reference: LITFIN src/core/language-intelligence/dynamic-language-rewriter.ts.
 */

import {
  offTargetRatio,
  hasOffTargetLeak,
  checkContamination,
} from './contamination.js';
import type { Locale } from './types.js';

/**
 * Injected AI rewrite port. The implementation calls the brain / LLM
 * with the system + user prompt and returns the rewritten string. It
 * MAY throw on provider exhaustion — the rewriter catches it and falls
 * back to the safe single-language string.
 */
export interface LanguageRewriterPort {
  readonly rewrite: (input: RewriterPortInput) => Promise<string>;
}

export interface RewriterPortInput {
  /** The contaminated text to rewrite into the target language. */
  readonly text: string;
  /** Target language the output MUST be 100% in. */
  readonly targetLang: Locale;
  /** Ready-built system prompt describing the language-purity task. */
  readonly systemPrompt: string;
  /** Tokens to preserve verbatim (names, acronyms). */
  readonly preserve: ReadonlyArray<string>;
  /** Optional abort signal for latency-bounded calls. */
  readonly abortSignal?: AbortSignal;
}

export interface RewriterLogger {
  readonly warn: (msg: string, meta?: Record<string, unknown>) => void;
  readonly info: (msg: string, meta?: Record<string, unknown>) => void;
}

/** LRU cache port — pluggable so tests can assert hits/misses. */
export interface RewriteCachePort {
  readonly get: (key: string) => string | undefined;
  readonly set: (key: string, value: string) => void;
}

export interface RewriterDeps {
  readonly port: LanguageRewriterPort;
  readonly logger: RewriterLogger;
  /** Defaults to a 256-entry in-process LRU. */
  readonly cache?: RewriteCachePort;
  /**
   * Above this off-target ratio, fire the live rewrite. Defaults to
   * 0 (LITFIN parity) — ANY leak triggers a rewrite. Surfaces that
   * tolerate borrowed loanwords can raise it.
   */
  readonly minLeakRatio?: number;
  /** Tokens preserved verbatim across languages. Defaults to BORJIE set. */
  readonly preserve?: ReadonlyArray<string>;
}

export interface RewriteInput {
  readonly text: string;
  readonly targetLang: Locale;
  /**
   * Safe single-language fallback in the TARGET language. Shipped when
   * the live rewrite fails or still leaks. MUST already be clean — it is
   * the zero-mix guarantee of last resort. Typically an i18n constant.
   */
  readonly safeFallback: string;
  readonly abortSignal?: AbortSignal;
}

export type RewriteSource = 'skip' | 'cache' | 'brain' | 'safe-fallback';

export interface RewriteResult {
  /** The text guaranteed to be single-language for `targetLang`. */
  readonly text: string;
  /** True when a real AI rewrite produced the text. */
  readonly rewritten: boolean;
  /** Off-target ratio the detector measured on the input, in [0,1]. */
  readonly offTargetRatio: number;
  readonly source: RewriteSource;
}

/**
 * Tokens kept verbatim across any language — names + regulator acronyms
 * a Tanzanian mining estate writes identically in English and Swahili.
 * The model is INSTRUCTED to preserve them; we do not string-mask
 * (masking is the hardcoded approach we deliberately avoid).
 */
export const BORJIE_PRESERVE_TOKENS: ReadonlyArray<string> = Object.freeze([
  'Mr. Mwikila',
  'Borjie',
  'TIN',
  'BRELA',
  'TRA',
  'NEMC',
  'TMAA',
  'GST',
  'STAMICO',
  'NIDA',
  'KYC',
  'AML',
  'IFRS',
  'TZS',
  'M-Pesa',
  'OSHA',
  'AMCOS',
  'SACCO',
]);

const TARGET_NAME: Readonly<Record<Locale, string>> = {
  en: 'English',
  sw: 'Swahili (Kiswahili)',
} as Record<Locale, string>;

function targetName(lang: Locale): string {
  return TARGET_NAME[lang] ?? lang;
}

function otherName(lang: Locale): string {
  return lang === 'en' ? targetName('sw') : targetName('en');
}

/**
 * Build the language-purity system prompt. Pure — exported so the
 * composition-root port and tests share one source of truth.
 */
export function buildRewriterSystemPrompt(
  target: Locale,
  preserve: ReadonlyArray<string>,
): string {
  return [
    `You are the Borjie language-purity rewriter. The input is meant to be 100% ${targetName(target)} but contains ${otherName(target)} words.`,
    `Rewrite it so EVERY word is ${targetName(target)}. Preserve meaning, numbers, tone, persona voice, and formatting exactly. This is a language pass, not a content edit.`,
    `Keep these names and acronyms verbatim, never translate or re-case them: ${preserve.join(', ')}.`,
    `Output ONLY the rewritten text. No preamble, no quotes, no notes.`,
  ].join(' ');
}

const DEFAULT_MAX_CACHE = 256;

/**
 * Tiny in-process LRU. Stores AI output keyed by (target, len, hash).
 */
export function createInMemoryRewriteCache(
  maxEntries: number = DEFAULT_MAX_CACHE,
): RewriteCachePort {
  const map = new Map<string, string>();
  return {
    get(key) {
      const hit = map.get(key);
      if (hit === undefined) {
        return undefined;
      }
      // Refresh recency.
      map.delete(key);
      map.set(key, hit);
      return hit;
    },
    set(key, value) {
      if (map.size >= maxEntries && !map.has(key)) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) {
          map.delete(oldest);
        }
      }
      map.set(key, value);
    },
  };
}

function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function cacheKey(target: Locale, text: string): string {
  return `${target}:${text.length}:${fnv1a(text)}`;
}

export type RewriteFn = (input: RewriteInput) => Promise<RewriteResult>;

/**
 * Build the rewriter. Returns a function that GUARANTEES single-language
 * output for the target: clean passthrough, live AI rewrite on
 * contamination, or the caller's safe fallback when the rewrite cannot
 * produce a clean string.
 */
export function createDynamicLanguageRewriter(deps: RewriterDeps): RewriteFn {
  const cache = deps.cache ?? createInMemoryRewriteCache();
  const minLeakRatio = deps.minLeakRatio ?? 0;
  const preserve = deps.preserve ?? BORJIE_PRESERVE_TOKENS;

  return async function ensureLanguage(input): Promise<RewriteResult> {
    const trimmed = input.text.trim();
    if (trimmed.length === 0) {
      return Object.freeze({
        text: input.text,
        rewritten: false,
        offTargetRatio: 0,
        source: 'skip' as const,
      });
    }

    const ratio = offTargetRatio(trimmed, input.targetLang);
    // Fail-closed fire decision: a SINGLE confidently-wrong-language token
    // (e.g. one leaked content word) can round to a near-zero ratio, so we
    // also consult the hard-leak signal. We skip the AI call ONLY when the
    // ratio is within tolerance AND there is no hard leak, i.e. only when
    // we are confident the text is already single-language.
    const hardLeak = hasOffTargetLeak(trimmed, input.targetLang);
    if (ratio <= minLeakRatio && !hardLeak) {
      // Confirmed clean (or within tolerance): no AI call, ship verbatim.
      return Object.freeze({
        text: input.text,
        rewritten: false,
        offTargetRatio: ratio,
        source: 'skip' as const,
      });
    }

    const key = cacheKey(input.targetLang, trimmed);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return Object.freeze({
        text: cached,
        rewritten: true,
        offTargetRatio: ratio,
        source: 'cache' as const,
      });
    }

    try {
      const systemPrompt = buildRewriterSystemPrompt(input.targetLang, preserve);
      const out = await deps.port.rewrite({
        text: trimmed,
        targetLang: input.targetLang,
        systemPrompt,
        preserve,
        ...(input.abortSignal !== undefined ? { abortSignal: input.abortSignal } : {}),
      });
      const cleaned = out.trim();

      // The model could echo nothing usable, or could STILL leak. Either
      // way we refuse to ship a contaminated string — fall to the safe
      // single-language fallback. This is the fail-FIXED guarantee.
      if (cleaned.length === 0) {
        deps.logger.warn('language-rewriter.empty-output', {
          targetLang: input.targetLang,
        });
        return safeFallbackResult(input, ratio, deps.logger);
      }

      const recheck = checkContamination(cleaned, input.targetLang);
      if (!recheck.ok) {
        deps.logger.warn('language-rewriter.still-contaminated', {
          targetLang: input.targetLang,
          leakRatio: recheck.leakRatio,
          leakedTokens: recheck.leakedTokens.slice(0, 8),
        });
        return safeFallbackResult(input, ratio, deps.logger);
      }

      cache.set(key, cleaned);
      deps.logger.info('language-rewriter.rewritten', {
        targetLang: input.targetLang,
        offTargetRatio: ratio,
      });
      return Object.freeze({
        text: cleaned,
        rewritten: true,
        offTargetRatio: ratio,
        source: 'brain' as const,
      });
    } catch (err) {
      deps.logger.warn('language-rewriter.failed', {
        targetLang: input.targetLang,
        error: err instanceof Error ? err.message : String(err),
      });
      return safeFallbackResult(input, ratio, deps.logger);
    }
  };
}

/**
 * Last line of defence. The caller's `safeFallback` MUST already be in
 * the target language; if it somehow leaks too, we strip it to the
 * longest single-language run rather than ship mixed text. As an
 * absolute floor we return an empty string — a blank is never a
 * zero-mix violation, whereas a mixed string is.
 */
function safeFallbackResult(
  input: RewriteInput,
  ratio: number,
  logger: RewriterLogger,
): RewriteResult {
  const fallback = input.safeFallback.trim();
  if (fallback.length > 0 && checkContamination(fallback, input.targetLang).ok) {
    return Object.freeze({
      text: input.safeFallback,
      rewritten: false,
      offTargetRatio: ratio,
      source: 'safe-fallback' as const,
    });
  }
  logger.warn('language-rewriter.fallback-also-contaminated', {
    targetLang: input.targetLang,
  });
  return Object.freeze({
    text: '',
    rewritten: false,
    offTargetRatio: ratio,
    source: 'safe-fallback' as const,
  });
}
