import { describe, it, expect } from 'vitest';
import { runLoop } from '../runner/loop-runner.js';
import { createInMemoryLoopRunRepository } from '../repositories/loop-run-repository.js';
import { createInMemoryLayerOutcomeRepository } from '../repositories/layer-outcome-repository.js';
import { createInMemoryQualitySignalRepository } from '../repositories/quality-signal-repository.js';
import type {
  LoopInput,
  LoopLogger,
  LoopRunnerDeps,
  SensorsOutcome,
  PolicyOutcome,
  ToolsOutcome,
  LearningOutcome,
} from '../types.js';
import type { CompositeGateResult } from '@borjie/loop-quality-gates';

function makeLogger(): LoopLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function makeInput(over: Partial<LoopInput> = {}): LoopInput {
  return {
    id: 'lr-1',
    tenantId: 't1',
    loopKind: 'reactive',
    startedAt: '2026-05-26T10:00:00Z',
    prevHash: null,
    envelope: {},
    ...over,
  };
}

function happyPathDeps(): LoopRunnerDeps & {
  loopRunRepo: ReturnType<typeof createInMemoryLoopRunRepository>;
  layerOutcomeRepo: ReturnType<typeof createInMemoryLayerOutcomeRepository>;
  qualitySignalRepo: ReturnType<typeof createInMemoryQualitySignalRepository>;
} {
  const loopRunRepo = createInMemoryLoopRunRepository();
  const layerOutcomeRepo = createInMemoryLayerOutcomeRepository();
  const qualitySignalRepo = createInMemoryQualitySignalRepository();

  const sensors: SensorsOutcome = { items: [{ kind: 'chat-turn', text: 'hi' }] };
  const policy: PolicyOutcome = { decision: 'allow', reason: 'authorized' };
  const tools: ToolsOutcome = {
    status: 'ok',
    artifacts: [{ kind: 'reply', text: 'Mr. Mwikila here.' }],
    costUsdCents: 5,
  };
  const quality: CompositeGateResult = Object.freeze({
    pass: true,
    signals: Object.freeze([
      Object.freeze({
        signal: 'groundedness',
        score: 1.0,
        weight: 1.0,
        evidence: {},
      }),
      Object.freeze({
        signal: 'brand',
        score: 1.0,
        weight: 1.0,
        evidence: {},
      }),
    ]),
    failedGates: Object.freeze([]),
    reason: 'pass:all-gates-clean',
  });
  const learning: LearningOutcome = {
    skillUpdates: 1,
    memoryUpdates: 0,
    calibrationUpdates: 1,
    reason: 'ok',
  };

  // Deterministic clock — each call advances by 10ms.
  let t = 1_700_000_000_000;
  const now = (): Date => {
    const d = new Date(t);
    t += 10;
    return d;
  };

  return {
    loopRunRepo,
    layerOutcomeRepo,
    qualitySignalRepo,
    sensorsFn: async () => sensors,
    policyFn: async () => policy,
    toolsFn: async () => tools,
    qualityFn: async () => quality,
    learnFn: async () => learning,
    logger: makeLogger(),
    now,
  };
}

describe('loop-runner', () => {
  it('happy path: runs all five layers, status=ok, persists outcomes + signals', async () => {
    const deps = happyPathDeps();
    const result = await runLoop(makeInput(), deps);

    expect(result.status).toBe('ok');
    expect(result.layerOutcomes.length).toBe(5);
    expect(result.layerOutcomes.map((o) => o.layer)).toEqual([
      'sensors',
      'policy',
      'tools',
      'quality',
      'learning',
    ]);
    expect(result.qualitySignals.length).toBe(2);
    expect(result.totalCostUsdCents).toBeGreaterThanOrEqual(5);
    expect(result.reason).toBe('all-five-layers-passed');

    // Run row persisted with terminal status.
    const persisted = await deps.loopRunRepo.find('lr-1');
    expect(persisted?.status).toBe('ok');

    // Layer outcomes persisted.
    const layers = await deps.layerOutcomeRepo.listForRun('lr-1');
    expect(layers.length).toBe(5);

    // Quality signals persisted.
    const signals = await deps.qualitySignalRepo.listForRun('lr-1');
    expect(signals.length).toBe(2);
  });

  it('no_input: zero sensor items short-circuits with status=no_input', async () => {
    const deps = happyPathDeps();
    const result = await runLoop(makeInput({ id: 'lr-2' }), {
      ...deps,
      sensorsFn: async () => ({ items: [] }),
    });

    expect(result.status).toBe('no_input');
    // Only the sensors layer was executed.
    expect(result.layerOutcomes.length).toBe(1);
    expect(result.layerOutcomes[0]?.layer).toBe('sensors');
    expect(result.qualitySignals.length).toBe(0);
  });

  it('policy=deny short-circuits with status=denied', async () => {
    const deps = happyPathDeps();
    const result = await runLoop(makeInput({ id: 'lr-3' }), {
      ...deps,
      policyFn: async () => ({ decision: 'deny', reason: 'unauthorised' }),
    });

    expect(result.status).toBe('denied');
    // Sensors + policy only.
    expect(result.layerOutcomes.length).toBe(2);
  });

  it('quality fail still invokes learning and persists every signal', async () => {
    const deps = happyPathDeps();
    const failingQuality: CompositeGateResult = Object.freeze({
      pass: false,
      signals: Object.freeze([
        Object.freeze({
          signal: 'groundedness',
          score: 0.5,
          weight: 1.0,
          evidence: { failingClaimIds: ['k1'] },
        }),
        Object.freeze({
          signal: 'brand',
          score: 1.0,
          weight: 1.0,
          evidence: {},
        }),
      ]),
      failedGates: Object.freeze(['groundedness']),
      reason: 'fail:groundedness',
    });
    let learnInvoked = false;
    const result = await runLoop(makeInput({ id: 'lr-4' }), {
      ...deps,
      qualityFn: async () => failingQuality,
      learnFn: async () => {
        learnInvoked = true;
        return {
          skillUpdates: 0,
          memoryUpdates: 0,
          calibrationUpdates: 0,
          reason: 'downweight-failed-skill',
        };
      },
    });

    expect(result.status).toBe('quality_failed');
    expect(learnInvoked).toBe(true);
    // All five layers ran, including learning.
    expect(result.layerOutcomes.length).toBe(5);
    // Both signals (passing AND failing) persisted.
    const signals = await deps.qualitySignalRepo.listForRun('lr-4');
    expect(signals.length).toBe(2);
    expect(result.qualityResult?.pass).toBe(false);
  });

  it('tools throws => status=tool_error and learning is skipped', async () => {
    const deps = happyPathDeps();
    let learnInvoked = false;
    const result = await runLoop(makeInput({ id: 'lr-5' }), {
      ...deps,
      toolsFn: async () => {
        throw new Error('adapter-timeout');
      },
      learnFn: async () => {
        learnInvoked = true;
        return {
          skillUpdates: 0,
          memoryUpdates: 0,
          calibrationUpdates: 0,
          reason: 'never-reached',
        };
      },
    });

    expect(result.status).toBe('tool_error');
    expect(result.reason).toContain('adapter-timeout');
    expect(learnInvoked).toBe(false);
  });

  it('persistence: layer outcomes carry latencyMs and audit_hash linked to the run id', async () => {
    const deps = happyPathDeps();
    const result = await runLoop(makeInput({ id: 'lr-6' }), deps);
    const layers = await deps.layerOutcomeRepo.listForRun('lr-6');
    expect(layers.length).toBe(5);
    for (const lr of layers) {
      expect(lr.auditHash).toContain('lr-6');
      expect(lr.latencyMs).toBeGreaterThanOrEqual(0);
    }
    // The final run audit hash encodes the terminal status.
    expect(result.auditHash).toContain('lr-6');
    expect(result.auditHash).toContain('ok');
  });
});
