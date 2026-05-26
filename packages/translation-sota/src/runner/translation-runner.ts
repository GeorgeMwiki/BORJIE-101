/**
 * Translation runner — the orchestrator.
 *
 * Walks the 3-tier provider stack in priority order. For each tier:
 *
 *   1. Pre-substitute glossary terms with `<<G:NNNN>>` placeholders
 *      (term-locker pass 1).
 *   2. Tag code-switch segments so brand / proper / number / target-
 *      language tokens are visible alongside the placeholders.
 *   3. Detect or accept the caller-supplied register.
 *   4. Invoke the provider with the placeholder-laced source +
 *      register hint.
 *   5. Unlock the placeholders (term-locker pass 3a).
 *   6. Apply the register mapper (formal honorific prefix when source
 *      was formal and provider stripped it).
 *   7. Verify glossary adherence (term-locker pass 3b). If adherence
 *      < floor and a fallback tier exists, demote and retry.
 *   8. Compute BLEU + chrF + terminology-adherence (when reference
 *      was provided in the request).
 *   9. Persist the run via `TranslationRunRepository`.
 *
 * The runner is stateless. All ports (providers, glossary repo,
 * domain port, run repo, eval repo, logger) are injected.
 */

import type {
  ComputeCometPort,
  DomainGlossaryPort,
  GlossaryOverrideRepository,
  LanguageCode,
  ProviderDemotion,
  ProviderId,
  ProviderPort,
  RegisterTag,
  TranslationEvalRepository,
  TranslationRequest,
  TranslationResult,
  TranslationRunRepository,
} from '../types.js';
import { TRANSLATION_CONSTANTS } from '../types.js';
import {
  loadTenantGlossary,
} from '../glossary/glossary-manager.js';
import {
  bindingsToSegments,
  lockTerms,
  unlockTerms,
  verifyTermSurvival,
} from '../glossary/term-locker.js';
import { segmentCodeSwitch } from '../codeswitch/segmenter.js';
import {
  applyRegister,
  detectRegister,
} from '../register/register-mapper.js';
import { bleu as computeBleu } from '../evaluation/bleu.js';
import { chrf as computeChrf } from '../evaluation/chrf.js';
import { computeTerminologyAdherence } from '../evaluation/terminology-adherence.js';
import type { TranslationLogger } from '../logger.js';

export interface TranslationRunnerDeps {
  /** Provider chain in priority order — tier 1 first. */
  readonly providers: ReadonlyArray<ProviderPort>;
  readonly overrideRepo: GlossaryOverrideRepository;
  readonly domainPort?: DomainGlossaryPort | undefined;
  readonly runRepo: TranslationRunRepository;
  readonly evalRepo?: TranslationEvalRepository | undefined;
  readonly cometPort?: ComputeCometPort | undefined;
  readonly logger: TranslationLogger;
  readonly now?: (() => number) | undefined;
}

export interface RunTranslationResult extends TranslationResult {
  readonly demotions: ReadonlyArray<ProviderDemotion>;
}

export function createTranslationRunner(deps: TranslationRunnerDeps) {
  const now = deps.now ?? (() => Date.now());
  return {
    async run(request: TranslationRequest): Promise<RunTranslationResult> {
      deps.logger.info('translation.run.start', {
        tenantId: request.tenantId,
        sourceLang: request.sourceLang,
        targetLang: request.targetLang,
        sourceLength: request.sourceText.length,
      });

      // Step 1 — load glossary.
      const glossary = await loadTenantGlossary({
        tenantId: request.tenantId,
        overrideRepo: deps.overrideRepo,
        ...(deps.domainPort !== undefined
          ? { domainPort: deps.domainPort }
          : {}),
      });

      // Step 2 — pre-substitute terms.
      const lock = lockTerms(
        request.sourceText,
        glossary,
        request.sourceLang,
        request.targetLang,
      );

      // Step 3 — tag code-switch segments on the *original* source
      // text. The segmenter recognises the placeholders we just
      // inserted via its own regex pass.
      const codeSwitchSegments = segmentCodeSwitch(
        lock.placeholderSource,
        request.sourceLang,
        request.targetLang,
        glossary,
      );
      const bindingSegments = bindingsToSegments(lock.placeholders);

      // Step 4 — register.
      const register =
        request.register !== undefined
          ? ({
              level: request.register,
              honorific: undefined,
            } as RegisterTag)
          : detectRegister(request.sourceText, request.sourceLang);

      // Step 5 — walk the provider tiers.
      const demotions: ProviderDemotion[] = [];
      let finalOutput: string | undefined;
      let finalProvider: ProviderId | undefined;
      let finalLatencyMs = 0;
      let finalCostCents = 0;

      for (let i = 0; i < deps.providers.length; i += 1) {
        const tier = deps.providers[i];
        if (tier === undefined) {
          continue;
        }
        try {
          const healthy = await tier.isHealthy();
          if (!healthy) {
            demotions.push(
              recordDemotion(tier.id, deps.providers[i + 1]?.id, 'unhealthy'),
            );
            continue;
          }
          const providerResult = await tier.translate({
            sourceLang: request.sourceLang,
            targetLang: request.targetLang,
            sourceText: lock.placeholderSource,
            placeholders: Object.freeze(
              lock.placeholders.map((b) => b.token),
            ),
            register,
          });

          const budget = pickBudget(tier.id);
          if (providerResult.latencyMs > budget) {
            demotions.push(
              recordDemotion(tier.id, deps.providers[i + 1]?.id, 'latency-budget'),
            );
            continue;
          }

          const unlocked = unlockTerms(
            providerResult.targetText,
            lock.placeholders,
          );
          const withRegister = applyRegister(
            unlocked,
            register,
            request.targetLang,
          );
          const adherence = verifyTermSurvival(
            providerResult.targetText,
            withRegister,
            lock.placeholders,
          );
          if (adherence < TRANSLATION_CONSTANTS.GLOSSARY_ADHERENCE_FLOOR) {
            demotions.push(
              recordDemotion(
                tier.id,
                deps.providers[i + 1]?.id,
                'glossary-violation',
              ),
            );
            deps.logger.warn('translation.glossary.violation', {
              tenantId: request.tenantId,
              provider: tier.id,
              adherence,
            });
            continue;
          }

          finalOutput = withRegister;
          finalProvider = tier.id;
          finalLatencyMs = providerResult.latencyMs;
          finalCostCents = providerResult.costUsdCents;
          break;
        } catch (err) {
          deps.logger.error('translation.provider.error', {
            provider: tier.id,
            error: (err as Error).message,
          });
          demotions.push(
            recordDemotion(tier.id, deps.providers[i + 1]?.id, 'error'),
          );
          continue;
        }
      }

      if (finalOutput === undefined || finalProvider === undefined) {
        throw new Error(
          'translation runner exhausted all provider tiers; no usable output',
        );
      }

      // Step 6 — eval.
      let bleuScore: number | null = null;
      let chrfScore: number | null = null;
      if (request.reference !== undefined) {
        bleuScore = computeBleu(finalOutput, request.reference).bleu;
        chrfScore = computeChrf(finalOutput, request.reference).chrf;
      }
      const adherenceFinal = computeTerminologyAdherence(
        finalOutput,
        lock.entriesUsed,
      );

      // Step 7 — persist.
      const persisted = await deps.runRepo.insert({
        tenantId: request.tenantId,
        sourceLang: request.sourceLang,
        targetLang: request.targetLang,
        sourceText: request.sourceText,
        targetText: finalOutput,
        provider: finalProvider,
        glossaryTermsUsed: lock.entriesUsed,
        codeSwitchSegments: Object.freeze([
          ...codeSwitchSegments,
          ...bindingSegments,
        ]),
        bleu: bleuScore,
        chrf: chrfScore,
        terminologyAdherence: adherenceFinal.score,
        latencyMs: finalLatencyMs,
        costUsdCents: finalCostCents,
      });

      // Step 8 — optional eval scoring rows.
      if (deps.evalRepo !== undefined) {
        if (bleuScore !== null) {
          await deps.evalRepo.insert({
            tenantId: request.tenantId,
            runId: persisted.id,
            judge: 'bleu',
            score: bleuScore,
            rubric: Object.freeze({
              reference: request.reference ?? '',
            }),
          });
        }
        if (chrfScore !== null) {
          await deps.evalRepo.insert({
            tenantId: request.tenantId,
            runId: persisted.id,
            judge: 'chrf',
            score: chrfScore * 100,
            rubric: Object.freeze({
              reference: request.reference ?? '',
            }),
          });
        }
        await deps.evalRepo.insert({
          tenantId: request.tenantId,
          runId: persisted.id,
          judge: 'terminology-adherence',
          score: adherenceFinal.score * 100,
          rubric: Object.freeze({
            violated: adherenceFinal.violated.map((e) => e.srcTerm),
          }),
        });
        if (deps.cometPort !== undefined) {
          const cometScore = await deps.cometPort.score({
            source: request.sourceText,
            ...(request.reference !== undefined
              ? { reference: request.reference }
              : { reference: undefined }),
            hypothesis: finalOutput,
            sourceLang: request.sourceLang as LanguageCode,
            targetLang: request.targetLang as LanguageCode,
          });
          await deps.evalRepo.insert({
            tenantId: request.tenantId,
            runId: persisted.id,
            judge: 'comet',
            score: cometScore * 100,
            rubric: Object.freeze({ port: 'ComputeCometPort' }),
          });
        }
      }

      const result: RunTranslationResult = Object.freeze({
        tenantId: request.tenantId,
        runId: persisted.id,
        sourceLang: request.sourceLang as LanguageCode,
        targetLang: request.targetLang as LanguageCode,
        sourceText: request.sourceText,
        targetText: finalOutput,
        provider: finalProvider,
        register,
        glossaryTermsUsed: lock.entriesUsed,
        codeSwitchSegments: Object.freeze([
          ...codeSwitchSegments,
          ...bindingSegments,
        ]),
        bleu: bleuScore,
        chrf: chrfScore,
        terminologyAdherence: adherenceFinal.score,
        latencyMs: finalLatencyMs,
        costUsdCents: finalCostCents,
        auditHash: persisted.auditHash,
        prevHash: persisted.prevHash,
        createdAt: persisted.createdAt,
        demotions: Object.freeze([...demotions]),
      });

      deps.logger.info('translation.run.complete', {
        tenantId: request.tenantId,
        provider: finalProvider,
        latencyMs: finalLatencyMs,
        adherence: adherenceFinal.score,
        demotions: demotions.length,
      });

      return result;

      function recordDemotion(
        from: ProviderId,
        to: ProviderId | undefined,
        reason: ProviderDemotion['reason'],
      ): ProviderDemotion {
        return Object.freeze({
          from,
          to: to ?? from,
          reason,
          at: new Date(now()),
        });
      }
    },
  };
}

function pickBudget(providerId: ProviderId): number {
  switch (providerId) {
    case 'claude-opus-4-7':
      return TRANSLATION_CONSTANTS.TIER1_LATENCY_BUDGET_MS;
    case 'gemini-2-5-pro':
      return TRANSLATION_CONSTANTS.TIER2_LATENCY_BUDGET_MS;
    case 'nllb-200':
      return TRANSLATION_CONSTANTS.TIER3_LATENCY_BUDGET_MS;
  }
}
