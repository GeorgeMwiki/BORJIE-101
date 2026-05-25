/**
 * `createBiasHandling({ brain?, audit?, jurisdiction })` — ergonomic
 * composition root for callers who want one object exposing every
 * subsystem with the same `jurisdiction` / `brain` pre-wired.
 *
 * Intentionally thin — every primitive is also exported standalone
 * for callers that want to compose differently.
 */

import {
  getApplicableProtections,
  type SupportedJurisdiction,
} from './anti-discrimination-laws/index.js';
import { BiasDriftMonitor } from './drift-monitoring/index.js';
import type { BiasDriftMonitorOptions } from './drift-monitoring/index.js';
import { runBBQ, runCrowSPairs, runHONEST, runStereoSet } from './llm-bias-benchmarks/index.js';
import { runRealToxicityPrompts } from './llm-bias-benchmarks/real-toxicity-prompts.js';
import type {
  BiasBrain,
  LLMBiasBenchmark,
  ProtectedAttribute,
  ProtectionContext,
} from './types.js';

/** Minimal audit hook the factory will call when wired. */
export interface BiasAuditSink {
  record(entry: {
    readonly subsystem: 'llm_bias_benchmark' | 'drift_alert';
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<void> | void;
}

export interface CreateBiasHandlingArgs {
  readonly jurisdiction: SupportedJurisdiction | string;
  /** Optional LLM brain for the benchmark suites. */
  readonly brain?: BiasBrain;
  /** Optional audit sink — used to record benchmark + alert events. */
  readonly audit?: BiasAuditSink;
  /** Optional drift monitor options. */
  readonly driftOptions?: BiasDriftMonitorOptions;
}

export interface BiasHandling {
  readonly jurisdiction: SupportedJurisdiction | string;
  readonly driftMonitor: BiasDriftMonitor;
  /** Protected attributes applicable in (jurisdiction, context). */
  protections(context?: ProtectionContext): ReadonlyArray<ProtectedAttribute>;
  /** Run BBQ on the configured brain (throws if no brain wired). */
  runBBQ(args?: { subset?: ReadonlyArray<string> }): Promise<LLMBiasBenchmark>;
  /** Run StereoSet on the configured brain. */
  runStereoSet(): Promise<LLMBiasBenchmark>;
  /** Run CrowS-Pairs on the configured brain. */
  runCrowSPairs(): Promise<LLMBiasBenchmark>;
  /** Run HONEST on the configured brain. */
  runHONEST(): Promise<LLMBiasBenchmark>;
  /** Run RealToxicityPrompts on the configured brain. */
  runRealToxicityPrompts(args?: {
    toxicityScorer?: (s: string) => boolean | Promise<boolean>;
  }): Promise<LLMBiasBenchmark>;
}

export function createBiasHandling(args: CreateBiasHandlingArgs): BiasHandling {
  const driftMonitor = new BiasDriftMonitor(args.driftOptions ?? {});
  function ensureBrain(): BiasBrain {
    if (!args.brain) {
      throw new Error(
        '[bias-handling] no `brain` configured — pass `brain` to createBiasHandling() to run LLM benchmarks.',
      );
    }
    return args.brain;
  }
  async function recordBenchmark(b: LLMBiasBenchmark): Promise<LLMBiasBenchmark> {
    if (args.audit) {
      await args.audit.record({
        subsystem: 'llm_bias_benchmark',
        payload: {
          suite: b.suite,
          overallScore: b.overallScore,
          perCategory: b.perCategory,
          itemsEvaluated: b.itemsEvaluated,
        },
      });
    }
    return b;
  }
  return {
    jurisdiction: args.jurisdiction,
    driftMonitor,
    protections(context) {
      const opts: { jurisdiction: SupportedJurisdiction | string; context?: ProtectionContext } = {
        jurisdiction: args.jurisdiction,
      };
      if (context !== undefined) opts.context = context;
      return getApplicableProtections(opts);
    },
    async runBBQ(opts) {
      const out = await runBBQ({
        brain: ensureBrain(),
        ...(opts?.subset !== undefined ? { subset: opts.subset } : {}),
      });
      return recordBenchmark(out);
    },
    async runStereoSet() {
      return recordBenchmark(await runStereoSet({ brain: ensureBrain() }));
    },
    async runCrowSPairs() {
      return recordBenchmark(await runCrowSPairs({ brain: ensureBrain() }));
    },
    async runHONEST() {
      return recordBenchmark(await runHONEST({ brain: ensureBrain() }));
    },
    async runRealToxicityPrompts(opts) {
      const runArgs: Parameters<typeof runRealToxicityPrompts>[0] = {
        brain: ensureBrain(),
      };
      if (opts?.toxicityScorer !== undefined) {
        (runArgs as { toxicityScorer?: typeof opts.toxicityScorer }).toxicityScorer = opts.toxicityScorer;
      }
      return recordBenchmark(await runRealToxicityPrompts(runArgs));
    },
  };
}
