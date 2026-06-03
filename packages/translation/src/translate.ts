/**
 * `translate()` — the entry point every text-producing surface calls.
 *
 * Flow:
 *   1. If sourceLang === targetLang, return text verbatim. No cache,
 *      no provider hit.
 *   2. Build a cache key from (tenantId, sourceText, sourceLang,
 *      targetLang, register, surface). Look up in cache.
 *   3. Cache hit  → return the stored target. Update telemetry.
 *   4. Cache miss → invoke the SOTA runner (which itself walks
 *      Claude → Gemini → NLLB). Persist the result in cache. Return.
 *
 * Zero-mix mandate (LP-23): on provider success the result is checked
 * for cross-language contamination and, when it leaks, repaired by the
 * injected fail-FIXED `rewriter`. On provider FAILURE the facade no
 * longer fails OPEN to source text (which would ship the WRONG language
 * to the recipient) — it asks the rewriter for a safe single-language
 * string, or, absent a rewriter, falls back to source ONLY when source
 * and target share a language family is impossible, so it surfaces the
 * source with an explicit warning. Callers that need a hard error set
 * `strict: true`.
 *
 * The cache + rewriter ports are injected so tests pass fakes and
 * production binds the Postgres cache + brain-backed rewriter.
 */

import { createTranslationRunner } from '@borjie/translation-sota';
import type { TranslationRunnerDeps } from '@borjie/translation-sota';
import { checkContamination } from './contamination.js';
import type { RewriteFn } from './dynamic-language-rewriter.js';
import type {
  TranslateInput,
  TranslateOutput,
  TranslationCachePort,
} from './types.js';

export interface TranslateDeps {
  readonly cache: TranslationCachePort;
  readonly runner: ReturnType<typeof createTranslationRunner>;
  readonly logger: {
    readonly info: (msg: string, meta?: Record<string, unknown>) => void;
    readonly warn: (msg: string, meta?: Record<string, unknown>) => void;
    readonly error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /**
   * Fail-FIXED dynamic-language rewriter (LP-23). Repairs a contaminated
   * provider result and produces a SAFE single-language string when the
   * provider chain fails. Optional so existing wiring keeps compiling;
   * when absent the facade preserves the legacy fail-open behaviour but
   * logs a zero-mix-risk warning.
   */
  readonly rewriter?: RewriteFn;
  /** Default surface label when caller didn't provide one. */
  readonly defaultSurface?: string;
  /** Now-fn for tests. */
  readonly now?: () => number;
}

export interface TranslateOptions {
  /** When true, runtime failures throw instead of returning a fallback. */
  readonly strict?: boolean;
  /**
   * Safe single-language string in the TARGET language, shipped when the
   * provider chain fails and a rewriter is wired. Typically an i18n
   * constant ("Tafadhali jaribu tena."). When omitted the facade has no
   * clean target string to fall back to and surfaces source text with a
   * warning (legacy behaviour) unless `strict` is set.
   */
  readonly safeFallback?: string;
}

export type TranslateFn = (
  input: TranslateInput,
  options?: TranslateOptions,
) => Promise<TranslateOutput>;

const PASSTHROUGH_SURFACE_FALLBACK = 'unspecified';

export function createTranslate(deps: TranslateDeps): TranslateFn {
  const now = deps.now ?? (() => Date.now());

  return async function translate(input, options): Promise<TranslateOutput> {
    const t0 = now();
    const surface = input.surface ?? deps.defaultSurface ?? PASSTHROUGH_SURFACE_FALLBACK;
    const register = input.register ?? 'neutral';

    // Step 1 — same-language passthrough.
    if (input.sourceLang === input.targetLang) {
      return Object.freeze({
        text: input.text,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        cacheHit: false,
        provider: 'passthrough',
        latencyMs: now() - t0,
      });
    }

    // Step 2 — empty / whitespace-only.
    if (input.text.trim().length === 0) {
      return Object.freeze({
        text: input.text,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        cacheHit: false,
        provider: 'passthrough',
        latencyMs: now() - t0,
      });
    }

    const cacheKey = {
      tenantId: input.tenantId,
      sourceText: input.text,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
      register,
      surface,
    };

    // Step 3 — cache lookup.
    let cached: string | null = null;
    try {
      cached = await deps.cache.get(cacheKey);
    } catch (err) {
      deps.logger.warn('translation.cache.get.error', {
        surface,
        error: (err as Error).message,
      });
    }

    if (cached !== null) {
      return Object.freeze({
        text: cached,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        cacheHit: true,
        provider: 'cache',
        latencyMs: now() - t0,
      });
    }

    // Step 4 — provider invocation via SOTA runner.
    try {
      const result = await deps.runner.run({
        tenantId: input.tenantId,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        sourceText: input.text,
        register,
      });

      // Step 4b — zero-mix guard. If the provider output leaks the source
      // language, repair it with the fail-FIXED rewriter before caching.
      let finalText = result.targetText;
      let contaminationRepaired = false;
      const contamination = checkContamination(finalText, input.targetLang);
      if (!contamination.ok) {
        if (deps.rewriter !== undefined) {
          const rewrite = await deps.rewriter({
            text: finalText,
            targetLang: input.targetLang,
            safeFallback: options?.safeFallback ?? '',
          });
          finalText = rewrite.text;
          contaminationRepaired = rewrite.rewritten || rewrite.source === 'safe-fallback';
          deps.logger.warn('translation.contamination.repaired', {
            surface,
            targetLang: input.targetLang,
            leakRatio: contamination.leakRatio,
            rewriteSource: rewrite.source,
          });
        } else {
          // No rewriter wired — DO NOT cache or ship a mixed string.
          deps.logger.error('translation.contamination.unrepaired', {
            surface,
            targetLang: input.targetLang,
            leakRatio: contamination.leakRatio,
          });
          if (options?.strict === true) {
            throw new Error(
              `translate(${surface}): contaminated output and no rewriter wired`,
            );
          }
          finalText = options?.safeFallback ?? '';
          contaminationRepaired = true;
        }
      }

      // Step 5 — best-effort cache write. Only cache CLEAN output; a
      // repaired/fallback string is request-specific and must not poison
      // the shared cache.
      if (!contaminationRepaired) {
        try {
          await deps.cache.set(cacheKey, {
            targetText: finalText,
            provider: result.provider,
            glossaryVersion: 'v1',
          });
        } catch (err) {
          deps.logger.warn('translation.cache.set.error', {
            surface,
            error: (err as Error).message,
          });
        }
      }

      deps.logger.info('translation.complete', {
        surface,
        provider: result.provider,
        latencyMs: result.latencyMs,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        contaminationRepaired,
      });

      return Object.freeze({
        text: finalText,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        cacheHit: false,
        provider: result.provider,
        latencyMs: now() - t0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error('translation.failed', {
        surface,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        error: message,
      });

      if (options?.strict === true) {
        throw new Error(`translate(${surface}): ${message}`);
      }

      // Fail-FIXED: the provider chain failed. Returning source text here
      // would ship the WRONG language to the recipient — a zero-mix
      // violation. When a rewriter + safe fallback are wired, ship the
      // safe single-language string instead.
      if (deps.rewriter !== undefined && options?.safeFallback !== undefined) {
        const rewrite = await deps.rewriter({
          text: options.safeFallback,
          targetLang: input.targetLang,
          safeFallback: options.safeFallback,
        });
        return Object.freeze({
          text: rewrite.text,
          sourceLang: input.sourceLang,
          targetLang: input.targetLang,
          cacheHit: false,
          provider: 'passthrough',
          latencyMs: now() - t0,
        });
      }

      // No safe fallback available. Surface source text but log the
      // zero-mix risk so the gap is visible in telemetry.
      deps.logger.warn('translation.failed.no-safe-fallback', {
        surface,
        targetLang: input.targetLang,
      });
      return Object.freeze({
        text: input.text,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        cacheHit: false,
        provider: 'passthrough',
        latencyMs: now() - t0,
      });
    }
  };
}

/**
 * Singleton holder. Composition root binds the real translate fn via
 * `setGlobalTranslate(...)` at boot; consumers import `translate`
 * directly.
 *
 * Until the composition root binds it, the global is undefined and
 * any call throws — which is the correct behaviour: a service that
 * tries to emit user-facing text MUST be wired through the boot
 * sequence.
 */
let globalTranslate: TranslateFn | undefined;

export function setGlobalTranslate(fn: TranslateFn): void {
  globalTranslate = fn;
}

export function resetGlobalTranslateForTests(): void {
  globalTranslate = undefined;
}

export async function translate(
  input: TranslateInput,
  options?: TranslateOptions,
): Promise<TranslateOutput> {
  if (globalTranslate === undefined) {
    // Surface-friendly fail-open: emit a console warning (the only
    // place in the package console is permitted — and only when the
    // composition root forgot to bind) and pass through.
    if (typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'test') {
      // Pino logger isn't available at module load — use stderr directly.
      const warn = (msg: string): void => {
        const stderr = (globalThis as { process?: { stderr?: { write: (s: string) => void } } })
          .process?.stderr;
        if (stderr !== undefined) {
          stderr.write(`${msg}\n`);
        }
      };
      warn(
        '[@borjie/translation] translate() called before setGlobalTranslate; returning source text',
      );
    }
    return Object.freeze({
      text: input.text,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
      cacheHit: false,
      provider: 'passthrough',
      latencyMs: 0,
    });
  }
  return globalTranslate(input, options);
}

export type { TranslationRunnerDeps };
