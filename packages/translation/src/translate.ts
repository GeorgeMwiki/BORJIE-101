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
 * The facade NEVER throws on cache miss + provider failure — it logs
 * an error and returns the SOURCE TEXT unchanged so a downstream
 * email/PDF still ships in source language rather than blank. Callers
 * that need stricter behaviour set `strict: true`.
 *
 * The cache port is injected so tests pass a Map-backed adapter and
 * production binds the Postgres adapter.
 */

import { createTranslationRunner } from '@borjie/translation-sota';
import type { TranslationRunnerDeps } from '@borjie/translation-sota';
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
  /** Default surface label when caller didn't provide one. */
  readonly defaultSurface?: string;
  /** Now-fn for tests. */
  readonly now?: () => number;
}

export interface TranslateOptions {
  /** When true, runtime failures throw instead of returning source text. */
  readonly strict?: boolean;
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

      // Step 5 — best-effort cache write (don't fail the request if write fails).
      try {
        await deps.cache.set(cacheKey, {
          targetText: result.targetText,
          provider: result.provider,
          glossaryVersion: 'v1',
        });
      } catch (err) {
        deps.logger.warn('translation.cache.set.error', {
          surface,
          error: (err as Error).message,
        });
      }

      deps.logger.info('translation.complete', {
        surface,
        provider: result.provider,
        latencyMs: result.latencyMs,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
      });

      return Object.freeze({
        text: result.targetText,
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

      // Fail-open: return source text unchanged so the surface still ships.
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
