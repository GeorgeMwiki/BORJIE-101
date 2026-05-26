/**
 * `RlvrRunner` — pipeline orchestrator.
 *
 * Wires the registry + reward shaper + curator + redactor together.
 * Every stage is dependency-injected so the runner is trivially
 * testable without a database or external trainer.
 *
 * State transitions:
 *
 *   pending → running → verifying → curating → redacting →
 *     ready_for_handoff → handed_off → completed
 *
 * Any stage can transition to `failed` with an `evidence` reason; the
 * runner refuses invalid transitions.
 */

import { createHash } from 'node:crypto';
import { shapeReward } from '../reward/reward-shaper.js';
import { curate } from '../pipeline/curator.js';
import { redactTrace } from '../pipeline/redactor.js';
import type {
  CuratedExample,
  CuratorConfig,
  RedactionConfig,
  RewardWeights,
  RlvrRun,
  RlvrRunKind,
  RlvrTrace,
  Verifier,
} from '../types.js';
import { DEFAULT_CURATOR_CONFIG } from '../types.js';
import type { RlvrRunRepository } from '../repositories/rlvr-run.repository.js';
import type { RlvrTraceRepository } from '../repositories/rlvr-trace.repository.js';
import type {
  RlvrVerificationRepository,
  StoredVerification,
} from '../repositories/rlvr-verification.repository.js';
import type { RlvrCuratedExampleRepository } from '../repositories/rlvr-curated-example.repository.js';
import type { VerifierRegistry } from '../verifiers/registry.js';

export interface RlvrRunnerDeps {
  readonly runs: RlvrRunRepository;
  readonly traces: RlvrTraceRepository;
  readonly verifications: RlvrVerificationRepository;
  readonly curated: RlvrCuratedExampleRepository;
  readonly registry: VerifierRegistry;
  readonly idGen: () => string;
  readonly clock: () => Date;
}

export interface StartRunInput {
  readonly tenantId: string;
  readonly kind: RlvrRunKind;
  readonly prevHash?: string;
}

export interface CompleteRunInput {
  readonly runId: string;
  readonly redaction: RedactionConfig;
  readonly weights?: RewardWeights;
  readonly curator?: CuratorConfig;
}

export interface CompleteRunOutput {
  readonly run: RlvrRun;
  readonly examples: ReadonlyArray<CuratedExample>;
  readonly includedCount: number;
  readonly excludedCount: number;
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

const GENESIS_HASH = 'GENESIS';

export class RlvrRunner {
  constructor(private readonly deps: RlvrRunnerDeps) {}

  async startRun(input: StartRunInput): Promise<RlvrRun> {
    const verifierSet = Object.freeze(
      this.deps.registry.verifiers.map((v) => v.name),
    );
    const startedAt = this.deps.clock().toISOString();
    const id = this.deps.idGen();
    const prev = input.prevHash ?? GENESIS_HASH;
    const auditHash = hash({
      id,
      tenantId: input.tenantId,
      kind: input.kind,
      verifierSet,
      startedAt,
      prev,
    });
    const run: RlvrRun = Object.freeze({
      id,
      tenantId: input.tenantId,
      kind: input.kind,
      startedAt,
      endedAt: null,
      status: 'pending',
      verifierSet,
      auditHash,
      prevHash: prev,
    });
    return this.deps.runs.create(run);
  }

  async ingestTrace(trace: RlvrTrace): Promise<RlvrTrace> {
    const run = await this.deps.runs.findById(trace.runId);
    if (!run) {
      throw new Error(`Unknown runId: ${trace.runId}`);
    }
    if (run.status === 'completed' || run.status === 'failed') {
      throw new Error(
        `Run ${run.id} is ${run.status}; cannot ingest`,
      );
    }
    return this.deps.traces.create(trace);
  }

  async completeRun(input: CompleteRunInput): Promise<CompleteRunOutput> {
    const run0 = await this.deps.runs.findById(input.runId);
    if (!run0) {
      throw new Error(`Run not found: ${input.runId}`);
    }
    const tenantId = run0.tenantId;

    // 1. Mark running.
    await this.deps.runs.updateStatus(run0.id, 'running', null);

    // 2. Verify every captured trace.
    await this.deps.runs.updateStatus(run0.id, 'verifying', null);
    const traces = await this.deps.traces.listByRun(run0.id);
    const verifiedEntries: Array<{
      trace: RlvrTrace;
      reward: ReturnType<typeof shapeReward>;
    }> = [];

    for (const trace of traces) {
      const results = await this.deps.registry.verifyAll(trace);
      for (const result of results) {
        const stored: StoredVerification = Object.freeze({
          id: this.deps.idGen(),
          traceId: trace.id,
          tenantId,
          result,
          verifiedAt: this.deps.clock().toISOString(),
          auditHash: hash({ traceId: trace.id, result }),
        });
        await this.deps.verifications.create(stored);
      }
      const reward = shapeReward({
        traceId: trace.id,
        results,
        ...(input.weights !== undefined ? { weights: input.weights } : {}),
      });
      verifiedEntries.push({ trace, reward });
    }

    // 3. Curate.
    await this.deps.runs.updateStatus(run0.id, 'curating', null);
    const examples = curate({
      runId: run0.id,
      runKind: run0.kind,
      entries: verifiedEntries,
      config: input.curator ?? DEFAULT_CURATOR_CONFIG,
      idGen: this.deps.idGen,
      clock: this.deps.clock,
    });

    // 4. Persist + redact included examples.
    await this.deps.runs.updateStatus(run0.id, 'redacting', null);
    for (const example of examples) {
      await this.deps.curated.create(example);
      if (example.included) {
        const trace = await this.deps.traces.findById(example.traceId);
        if (trace) {
          const redacted = redactTrace(trace, input.redaction);
          await this.deps.traces.attachRedacted(trace.id, redacted);
        }
      }
    }

    // 5. Ready / handed_off / completed.
    const ready = await this.deps.runs.updateStatus(
      run0.id,
      'ready_for_handoff',
      null,
    );
    const handed = await this.deps.runs.updateStatus(
      ready.id,
      'handed_off',
      null,
    );
    const endedAt = this.deps.clock().toISOString();
    const completed = await this.deps.runs.updateStatus(
      handed.id,
      'completed',
      endedAt,
    );

    const includedCount = examples.filter((e) => e.included).length;
    const excludedCount = examples.length - includedCount;
    return Object.freeze({
      run: completed,
      examples,
      includedCount,
      excludedCount,
    });
  }

  async failRun(runId: string): Promise<RlvrRun> {
    const endedAt = this.deps.clock().toISOString();
    return this.deps.runs.updateStatus(runId, 'failed', endedAt);
  }
}
