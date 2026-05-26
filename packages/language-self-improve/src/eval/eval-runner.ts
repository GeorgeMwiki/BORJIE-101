/**
 * Eval runner — runs the gauntlet against (a) the currently-live
 * adapter (or base if none) and (b) the proposed adapter, computes
 * per-axis aggregates + deltas, and returns an `EvalRunPair` for the
 * PromotionDecider to consume.
 *
 * The model invocation is delegated to an injected `LanguageModelPort`
 * so the runner stays provider-agnostic. The port's `generate` returns
 * the model's transcription / response for a given prompt; the runner
 * scores it against the gauntlet's `expectedText`.
 *
 * Live-test discipline: there is no fabrication of model outputs in
 * this module. The injected port is the only source of generated
 * text. The gauntlet entries themselves are input data — prompts and
 * expected references — not mocked outputs.
 */

import {
  type Adapter,
  type EvalDelta,
  type EvalRun,
  type GauntletEntry,
  type LanguageTag,
  type PromotionDecision,
  DEFAULT_LANGUAGE_SCORE_WEIGHTS,
} from '../types.js';
import { computeWer } from '../score/wer-scorer.js';
import {
  type PhonemiserPort,
  naiveCodepointPhonemiser,
  computePer,
} from '../score/per-scorer.js';
import {
  type SwahiliLinguisticsPort,
  type LlmGraderPort,
  naiveSwahiliPort,
  passthroughLlmGrader,
  scoreGrammar,
} from '../score/grammar-scorer.js';
import {
  type GlossaryTerm,
  type TranslationSotaPort,
  defaultTerminologyPort,
  MINING_GLOSSARY,
  scoreTerminology,
} from '../score/terminology-scorer.js';

export interface LanguageModelPort {
  generate(
    prompt: string,
    adapter: Adapter | null,
    lang: LanguageTag,
  ): Promise<string>;
}

export interface EvalRunnerPorts {
  readonly model: LanguageModelPort;
  readonly phonemiser?: PhonemiserPort;
  readonly swahili?: SwahiliLinguisticsPort;
  readonly fallback?: LlmGraderPort;
  readonly terminology?: TranslationSotaPort;
}

export interface EvalRunnerConfig {
  readonly tenantId: string;
  readonly gauntletVersion: string;
  readonly glossary?: ReadonlyArray<GlossaryTerm>;
}

export interface EvalAggregate {
  readonly wer: number;
  readonly per: number;
  readonly grammar: number;
  readonly terminology: number;
  readonly entries: number;
}

export interface EvalRunPair {
  readonly current: EvalAggregate;
  readonly proposed: EvalAggregate;
  readonly delta: EvalDelta;
}

/**
 * Score a single gauntlet entry. Pure-ish — invokes the model port (one
 * I/O) then the linguistics ports (port-local I/O).
 */
async function scoreEntryAgainstAdapter(
  entry: GauntletEntry,
  adapter: Adapter | null,
  ports: EvalRunnerPorts,
  glossary: ReadonlyArray<GlossaryTerm>,
): Promise<{
  wer: number;
  per: number;
  grammar: number;
  terminology: number;
}> {
  const phonemiser = ports.phonemiser ?? naiveCodepointPhonemiser;
  const swahili = ports.swahili ?? naiveSwahiliPort;
  const fallback = ports.fallback ?? passthroughLlmGrader;
  const terminologyPort = ports.terminology ?? defaultTerminologyPort;

  const generated = await ports.model.generate(entry.prompt, adapter, entry.lang);

  const werResult = computeWer(entry.expectedText, generated);
  const wer = Math.max(0, Math.min(1, werResult.wer));

  const perResult = await computePer(
    entry.expectedText,
    generated,
    entry.lang,
    phonemiser,
  );
  const per = Math.max(0, Math.min(1, perResult.per));

  const grammarResult = await scoreGrammar(generated, entry.lang, {
    swahili,
    fallback,
  });
  const grammar = Math.max(0, Math.min(1, grammarResult.score));

  const terminologyResult = await scoreTerminology(
    generated,
    entry.lang,
    glossary,
    terminologyPort,
  );
  const terminology = Math.max(0, Math.min(1, terminologyResult.score));

  return Object.freeze({ wer, per, grammar, terminology });
}

async function aggregateOver(
  adapter: Adapter | null,
  entries: ReadonlyArray<GauntletEntry>,
  ports: EvalRunnerPorts,
  glossary: ReadonlyArray<GlossaryTerm>,
): Promise<EvalAggregate> {
  if (entries.length === 0) {
    return Object.freeze({
      wer: 0,
      per: 0,
      grammar: 1,
      terminology: 1,
      entries: 0,
    });
  }
  let werSum = 0;
  let perSum = 0;
  let grammarSum = 0;
  let terminologySum = 0;
  for (const entry of entries) {
    const result = await scoreEntryAgainstAdapter(
      entry,
      adapter,
      ports,
      glossary,
    );
    werSum += result.wer;
    perSum += result.per;
    grammarSum += result.grammar;
    terminologySum += result.terminology;
  }
  const n = entries.length;
  return Object.freeze({
    wer: werSum / n,
    per: perSum / n,
    grammar: grammarSum / n,
    terminology: terminologySum / n,
    entries: n,
  });
}

/**
 * Run the gauntlet against both adapters and compute deltas.
 * Δ = proposed − current.
 *
 *   - WER / PER → lower is better, so negative delta = improvement.
 *   - Grammar / terminology → higher is better, so positive delta =
 *     improvement.
 */
export async function runEvalGauntlet(
  current: Adapter | null,
  proposed: Adapter,
  entries: ReadonlyArray<GauntletEntry>,
  ports: EvalRunnerPorts,
  glossary?: ReadonlyArray<GlossaryTerm>,
): Promise<EvalRunPair> {
  const g = glossary ?? MINING_GLOSSARY;
  const currentAgg = await aggregateOver(current, entries, ports, g);
  const proposedAgg = await aggregateOver(proposed, entries, ports, g);
  return Object.freeze({
    current: currentAgg,
    proposed: proposedAgg,
    delta: Object.freeze({
      wer: proposedAgg.wer - currentAgg.wer,
      per: proposedAgg.per - currentAgg.per,
      grammar: proposedAgg.grammar - currentAgg.grammar,
      terminology: proposedAgg.terminology - currentAgg.terminology,
    }),
  });
}

/**
 * Construct the `EvalRun` row representation from an `EvalRunPair` and
 * a `PromotionDecision`. The audit hash here is a content hash of the
 * inputs — the persistence layer is expected to chain it onto the
 * PO-14 prev hash.
 */
export function buildEvalRunRow(
  config: EvalRunnerConfig,
  proposed: Adapter,
  pair: EvalRunPair,
  decision: PromotionDecision,
): EvalRun {
  const _ = DEFAULT_LANGUAGE_SCORE_WEIGHTS;
  const content = `${config.tenantId}|${proposed.id}|${config.gauntletVersion}|${pair.proposed.wer.toFixed(6)}|${decision}|w:${_.wer}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 31 + content.charCodeAt(i)) | 0;
  }
  return Object.freeze({
    id: `${proposed.id}-${pair.proposed.entries}-${decision}`,
    tenantId: config.tenantId,
    adapterId: proposed.id,
    gauntletVersion: config.gauntletVersion,
    wer: pair.proposed.wer,
    per: pair.proposed.per,
    grammarScore: pair.proposed.grammar,
    terminologyScore: pair.proposed.terminology,
    mos: null,
    decision,
    ranAt: new Date().toISOString(),
    auditHash: `eval-${(hash >>> 0).toString(16)}`,
  });
}
