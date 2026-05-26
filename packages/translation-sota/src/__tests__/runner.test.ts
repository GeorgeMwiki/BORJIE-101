/**
 * Translation runner integration tests.
 *
 * Covers:
 *   - Happy path: tier-1 provider returns a placeholder-preserving
 *     output; runner unlocks, applies register, and persists.
 *   - 3-tier fallback: tier-1 throws → tier-2 throws → tier-3 returns
 *     a valid translation; demotion history is captured.
 *   - Glossary-violation demotion: tier-1 returns output dropping a
 *     placeholder; runner demotes to tier-2 which preserves it.
 */

import { describe, expect, it } from 'vitest';
import type {
  ProviderPort,
  ProviderTranslateRequest,
  ProviderTranslateResult,
} from '../types.js';
import { createInMemoryGlossaryOverrideRepository } from '../repositories/glossary-overrides.js';
import { createInMemoryTranslationRunRepository } from '../repositories/translation-runs.js';
import { createInMemoryTranslationEvalRepository } from '../repositories/translation-evals.js';
import { createTranslationRunner } from '../runner/translation-runner.js';
import { createLogger } from '../logger.js';

function silentLogger() {
  return createLogger({
    service: {
      name: '@borjie/translation-sota',
      version: '0.1.0',
      environment: 'development',
    },
    enabled: false,
    logLevel: 'silent',
    traceSampleRatio: 0,
    metricsIntervalMs: 60_000,
  });
}

/**
 * Build a fake provider that runs `mapper` against the request and
 * returns the result, tagged with the given id + latency.
 */
function fakeProvider(opts: {
  readonly id: 'claude-opus-4-7' | 'gemini-2-5-pro' | 'nllb-200';
  readonly mapper: (
    req: ProviderTranslateRequest,
  ) => string;
  readonly latencyMs?: number;
  readonly throws?: boolean;
  readonly healthy?: boolean;
}): ProviderPort {
  return {
    id: opts.id,
    async translate(req): Promise<ProviderTranslateResult> {
      if (opts.throws === true) {
        throw new Error(`provider ${opts.id} simulated failure`);
      }
      return Object.freeze({
        targetText: opts.mapper(req),
        latencyMs: opts.latencyMs ?? 100,
        costUsdCents: 1,
      });
    },
    async isHealthy(): Promise<boolean> {
      return opts.healthy ?? true;
    },
  };
}

describe('translation runner', () => {
  it('happy path: tier-1 succeeds, runner unlocks + applies register', async () => {
    const runRepo = createInMemoryTranslationRunRepository();
    const overrideRepo = createInMemoryGlossaryOverrideRepository();
    const evalRepo = createInMemoryTranslationEvalRepository();
    const runner = createTranslationRunner({
      providers: [
        fakeProvider({
          id: 'claude-opus-4-7',
          mapper: (req) =>
            // Provider preserves every placeholder verbatim and
            // translates the surrounding Swahili to English.
            req.sourceText
              .replace('imefika', 'has arrived')
              .replace('kwa', 'at the'),
        }),
      ],
      overrideRepo,
      runRepo,
      evalRepo,
      logger: silentLogger(),
    });

    const result = await runner.run({
      tenantId: 'tenant-1',
      sourceLang: 'sw',
      targetLang: 'en',
      sourceText: 'Ndugu, parseli imefika kwa PML.',
    });

    expect(result.provider).toBe('claude-opus-4-7');
    expect(result.terminologyAdherence).toBe(1);
    expect(result.demotions).toHaveLength(0);
    expect(result.targetText.toLowerCase()).toContain('parcel');
    expect(result.targetText).toContain('PML');
    expect(result.targetText.toLowerCase()).toContain('dear sir');
  });

  it('demotes through all 3 tiers, settles on tier-3 when tier-1 + tier-2 throw', async () => {
    const runRepo = createInMemoryTranslationRunRepository();
    const overrideRepo = createInMemoryGlossaryOverrideRepository();
    const runner = createTranslationRunner({
      providers: [
        fakeProvider({
          id: 'claude-opus-4-7',
          mapper: () => 'irrelevant',
          throws: true,
        }),
        fakeProvider({
          id: 'gemini-2-5-pro',
          mapper: () => 'irrelevant',
          throws: true,
        }),
        fakeProvider({
          id: 'nllb-200',
          mapper: (req) => req.sourceText.replace('imefika', 'has arrived'),
        }),
      ],
      overrideRepo,
      runRepo,
      logger: silentLogger(),
    });

    const result = await runner.run({
      tenantId: 'tenant-1',
      sourceLang: 'sw',
      targetLang: 'en',
      sourceText: 'Parseli imefika kwa PML.',
    });

    expect(result.provider).toBe('nllb-200');
    expect(result.demotions.length).toBeGreaterThanOrEqual(2);
    const reasons = result.demotions.map((d) => d.reason);
    expect(reasons).toContain('error');
  });

  it('demotes tier-1 to tier-2 when tier-1 mangles a placeholder', async () => {
    const runRepo = createInMemoryTranslationRunRepository();
    const overrideRepo = createInMemoryGlossaryOverrideRepository();
    const runner = createTranslationRunner({
      providers: [
        fakeProvider({
          id: 'claude-opus-4-7',
          // Strip out ALL placeholders entirely — guaranteed adherence
          // violation.
          mapper: (req) => req.sourceText.replace(/<<G:\d{4}>>/g, ''),
        }),
        fakeProvider({
          id: 'gemini-2-5-pro',
          mapper: (req) =>
            req.sourceText
              .replace('imefika', 'has arrived')
              .replace('kwa', 'at the'),
        }),
      ],
      overrideRepo,
      runRepo,
      logger: silentLogger(),
    });

    const result = await runner.run({
      tenantId: 'tenant-1',
      sourceLang: 'sw',
      targetLang: 'en',
      sourceText: 'Ndugu, parseli imefika kwa PML.',
    });

    expect(result.provider).toBe('gemini-2-5-pro');
    expect(result.demotions[0]?.reason).toBe('glossary-violation');
  });

  it('computes BLEU + chrF when a reference is provided', async () => {
    const runRepo = createInMemoryTranslationRunRepository();
    const overrideRepo = createInMemoryGlossaryOverrideRepository();
    const evalRepo = createInMemoryTranslationEvalRepository();
    const runner = createTranslationRunner({
      providers: [
        fakeProvider({
          id: 'claude-opus-4-7',
          // Provider preserves placeholders and translates surrounding
          // SW tokens; once the runner unlocks them we get a sentence
          // whose tokens match the reference.
          mapper: (req) =>
            req.sourceText
              .replace('imefika', 'arrived')
              .replace('kwa', 'at the'),
        }),
      ],
      overrideRepo,
      runRepo,
      evalRepo,
      logger: silentLogger(),
    });

    const result = await runner.run({
      tenantId: 'tenant-1',
      sourceLang: 'sw',
      targetLang: 'en',
      sourceText: 'Parseli imefika kwa PML.',
      reference: 'parcel arrived at the PML.',
    });

    expect(result.bleu).not.toBeNull();
    expect(result.chrf).not.toBeNull();
    expect((result.bleu ?? 0)).toBeGreaterThan(50);
  });
});
