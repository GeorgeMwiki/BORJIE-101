/**
 * Self-improve runner — orchestrates the full loop:
 *
 *   1. Read captured pairs from the training-pair repo for (tenant, lang).
 *   2. Curate them (dedupe + PII-redact + dialect-balance + active-learning).
 *   3. Mint an adapter via the LoRA port OR build a rag-prefix.
 *   4. Run the gauntlet against current + proposed adapters.
 *   5. Decide promote / rollback / no-op.
 *   6. Persist the EvalRun and (if promote) transition the adapter to live;
 *      (if rollback) transition to rolled-back.
 *
 * Construction follows the composition-root pattern — every external
 * boundary is injected as a port so tests can pin determinism.
 */

import {
  type Adapter,
  type EvalRun,
  type GauntletEntry,
  type LanguageTag,
  type PromotionDecision,
  type TrainingPair,
  DEFAULT_PROMOTION_THRESHOLDS,
  type PromotionThresholds,
} from '../types.js';
import {
  type CuratorConfig,
  type PiiRedactorPort,
  DEFAULT_CURATOR_CONFIG,
  curateExamples,
  type CuratorInput,
} from '../curate/example-curator.js';
import type { LoraAdapterPort } from '../adapter/lora-adapter-port.js';
import {
  buildRagPrefix,
  DEFAULT_RAG_PREFIX_CONFIG,
  type RagPrefixConfig,
} from '../adapter/rag-prefix-builder.js';
import {
  buildEvalRunRow,
  type EvalRunnerPorts,
  runEvalGauntlet,
} from '../eval/eval-runner.js';
import { decidePromotion } from '../decide/promotion-decider.js';
import type { TrainingPairRepository } from '../repositories/training-pair-repository.js';
import type { AdapterRepository } from '../repositories/adapter-repository.js';
import type { EvalRunRepository } from '../repositories/eval-run-repository.js';

/**
 * Threshold for switching from rag-prefix to LoRA. Below this count the
 * runner defaults to building a rag-prefix; at or above, it trains a
 * LoRA adapter.
 */
export const LORA_PAIR_FLOOR = 200;

export interface SelfImproveRunnerPorts {
  readonly trainingPairRepo: TrainingPairRepository;
  readonly adapterRepo: AdapterRepository;
  readonly evalRunRepo: EvalRunRepository;
  readonly loraPort: LoraAdapterPort;
  readonly redactor: PiiRedactorPort;
  readonly evalRunnerPorts: EvalRunnerPorts;
}

export interface SelfImproveRunnerConfig {
  readonly tenantId: string;
  readonly lang: LanguageTag;
  readonly baseModel: string;
  readonly gauntletVersion: string;
  readonly curatorConfig?: CuratorConfig;
  readonly ragPrefixConfig?: RagPrefixConfig;
  readonly promotionThresholds?: PromotionThresholds;
  /** Override the LoRA pair floor — used by tests. */
  readonly loraFloor?: number;
}

export interface SelfImproveRunResult {
  readonly proposedAdapter: Adapter;
  readonly evalRun: EvalRun;
  readonly decision: PromotionDecision;
  readonly curatedPairCount: number;
  readonly currentAdapter: Adapter | null;
  readonly ragPrefixText: string | null;
}

function buildAdapterVersion(): string {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12);
  const rand = Math.random().toString(16).slice(2, 8);
  return `${stamp}-${rand}`;
}

function inferDialect(
  pair: TrainingPair,
): 'bongo' | 'coast' | 'lake' | 'sheng' | 'other' {
  // Heuristic: read pair.scores or tags. The TrainingPair shape does
  // not currently carry dialect at top-level; we fall back to lang.
  if (pair.lang === 'sw-bongo') return 'bongo';
  if (pair.lang === 'sw-coast') return 'coast';
  if (pair.lang === 'sw-lake') return 'lake';
  if (pair.lang === 'sheng') return 'sheng';
  return 'other';
}

/**
 * Execute the loop end-to-end. Returns the proposed adapter, the eval
 * run row, the decision, and (for rag-prefix path) the built prefix
 * text.
 */
export async function runSelfImprove(
  config: SelfImproveRunnerConfig,
  ports: SelfImproveRunnerPorts,
  gauntletEntries: ReadonlyArray<GauntletEntry>,
): Promise<SelfImproveRunResult> {
  const tenantId = config.tenantId;
  const lang = config.lang;

  // 1. Read captured pairs
  const raw = await ports.trainingPairRepo.listForTenant(tenantId, lang);

  // 2. Curate
  const curatorInputs: CuratorInput[] = raw.map((pair) => ({
    pair,
    dialect: inferDialect(pair),
  }));
  const curatorConfig = config.curatorConfig ?? DEFAULT_CURATOR_CONFIG;
  const curation = await curateExamples(curatorInputs, ports.redactor, curatorConfig);
  const includedPairs = curation.curated.filter((p) => p.included);

  // Persist the curated pairs back (idempotent — the repo upsert keeps
  // the same id).
  for (const pair of curation.curated) {
    await ports.trainingPairRepo.upsert(pair);
  }

  // 3. Mint adapter — LoRA if N ≥ floor, rag-prefix otherwise
  const floor = config.loraFloor ?? LORA_PAIR_FLOOR;
  const currentAdapter = await ports.adapterRepo.findLive(tenantId, lang);
  let proposedAdapter: Adapter;
  let ragPrefixText: string | null = null;

  if (includedPairs.length >= floor) {
    const handle = await ports.loraPort.submitTrainingJob(
      includedPairs,
      config.baseModel,
      lang,
      tenantId,
    );
    const report = await ports.loraPort.pollJobStatus(handle);
    if (report.status !== 'succeeded') {
      throw new Error(`LoRA training failed: ${report.error ?? 'unknown'}`);
    }
    const version = buildAdapterVersion();
    proposedAdapter = await ports.loraPort.materialiseAdapter(handle, version);
    proposedAdapter = Object.freeze({
      ...proposedAdapter,
      trainingPairCount: includedPairs.length,
    });
  } else {
    const ragConfig = config.ragPrefixConfig ?? DEFAULT_RAG_PREFIX_CONFIG;
    const prefix = buildRagPrefix(includedPairs, ragConfig);
    ragPrefixText = prefix.text;
    const version = buildAdapterVersion();
    proposedAdapter = Object.freeze({
      id: `rag-prefix-${tenantId}-${lang}-${version}`,
      tenantId,
      lang,
      version,
      adapterKind: 'rag-prefix' as const,
      baseModel: config.baseModel,
      trainingPairCount: includedPairs.length,
      status: 'staged' as const,
      createdAt: new Date().toISOString(),
      auditHash: `rag-prefix-${prefix.tokenCount}-${prefix.includedPairCount}`,
    });
  }

  await ports.adapterRepo.upsert(proposedAdapter);

  // 4. Run gauntlet
  const evalPair = await runEvalGauntlet(
    currentAdapter,
    proposedAdapter,
    gauntletEntries,
    ports.evalRunnerPorts,
  );

  // 5. Decide
  const promotionResult = decidePromotion(
    evalPair.delta,
    config.promotionThresholds ?? DEFAULT_PROMOTION_THRESHOLDS,
  );

  const evalRun = buildEvalRunRow(
    { tenantId, gauntletVersion: config.gauntletVersion },
    proposedAdapter,
    evalPair,
    promotionResult.decision,
  );
  await ports.evalRunRepo.insert(evalRun);

  // 6. Apply transition
  if (promotionResult.decision === 'promote') {
    await ports.adapterRepo.transition(proposedAdapter.id, 'live');
  } else if (promotionResult.decision === 'rollback') {
    await ports.adapterRepo.transition(proposedAdapter.id, 'rolled-back');
  }

  return Object.freeze({
    proposedAdapter,
    evalRun,
    decision: promotionResult.decision,
    curatedPairCount: includedPairs.length,
    currentAdapter,
    ragPrefixText,
  });
}
