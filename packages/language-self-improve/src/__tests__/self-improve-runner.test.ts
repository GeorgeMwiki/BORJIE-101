import { describe, expect, it } from 'vitest';

import { createInMemoryLoraPort } from '../adapter/lora-adapter-port.js';
import {
  type PiiRedactorPort,
} from '../curate/example-curator.js';
import type { LanguageModelPort } from '../eval/eval-runner.js';
import {
  createInMemoryAdapterRepository,
} from '../repositories/adapter-repository.js';
import {
  createInMemoryEvalRunRepository,
} from '../repositories/eval-run-repository.js';
import {
  createInMemoryTrainingPairRepository,
} from '../repositories/training-pair-repository.js';
import { runSelfImprove } from '../runner/self-improve-runner.js';
import type {
  Adapter,
  GauntletEntry,
  TrainingPair,
} from '../types.js';

const NULL_REDACTOR: PiiRedactorPort = {
  async redact(text: string, _tenantId: string): Promise<string> {
    return text;
  },
};

function pair(id: string, agg: number): TrainingPair {
  return Object.freeze({
    id,
    tenantId: 't1',
    sourceText: `src-${id}`,
    targetText: `tgt-${id}`,
    lang: 'sw',
    utteranceId: null,
    scores: Object.freeze({
      wer: 0.05,
      per: 0.05,
      grammar: 0.95,
      terminology: 0.95,
      aggregate: agg,
      recipientConsent: 'per-user-learn' as const,
    }),
    included: true,
    exclusionReason: null,
    recordedAt: '2026-05-26T10:00:00Z',
    auditHash: 'h',
    prevHash: 'p',
  });
}

function entry(id: string, expected: string): GauntletEntry {
  return Object.freeze({
    id,
    tenantId: 't1',
    lang: 'sw',
    prompt: `prompt-${id}`,
    expectedText: expected,
    expectedIntent: null,
    domain: null,
    dialect: 'bongo' as const,
    category: 'regulatory' as const,
    auditHash: 'h',
  });
}

describe('self-improve-runner end-to-end', () => {
  it('promote outcome — proposed adapter improves on every axis', async () => {
    const trainingPairRepo = createInMemoryTrainingPairRepository();
    const adapterRepo = createInMemoryAdapterRepository();
    const evalRunRepo = createInMemoryEvalRunRepository();
    const loraPort = createInMemoryLoraPort({
      tenantId: 't1',
      baseModel: 'base',
    });

    await trainingPairRepo.upsert(pair('p1', 0.9));
    await trainingPairRepo.upsert(pair('p2', 0.85));

    // Model port: returns expected text for proposed adapter (perfect
    // match); current adapter (null) returns text that trips both a
    // grammar violation (`ki mtu`) and a missing-canonical-term
    // (`Parcel` instead of `parseli`), forcing all four axes to
    // measurably improve when the proposed adapter is evaluated.
    const modelPort: LanguageModelPort = {
      async generate(prompt, adapter, _lang) {
        if (adapter !== null) {
          return prompt.replace('prompt-', '');
        }
        // grammar issue (`ki mtu`) + accepted-not-canonical glossary (`Parcel`)
        return 'ki mtu Parcel zzzz';
      },
    };

    const result = await runSelfImprove(
      {
        tenantId: 't1',
        lang: 'sw',
        baseModel: 'base',
        gauntletVersion: '19k.1',
        loraFloor: 999, // force rag-prefix path (we only have 2 pairs)
      },
      {
        trainingPairRepo,
        adapterRepo,
        evalRunRepo,
        loraPort,
        redactor: NULL_REDACTOR,
        evalRunnerPorts: { model: modelPort },
      },
      [entry('a', 'a'), entry('b', 'b'), entry('c', 'c')],
    );

    expect(result.decision).toBe('promote');
    expect(result.proposedAdapter.adapterKind).toBe('rag-prefix');
    expect(result.ragPrefixText).not.toBeNull();
    // Eval run was persisted.
    const runs = await evalRunRepo.listForTenant('t1');
    expect(runs).toHaveLength(1);
    // Adapter transitioned to live.
    const live = await adapterRepo.findLive('t1', 'sw');
    expect(live?.id).toBe(result.proposedAdapter.id);
  });

  it('rollback outcome — proposed adapter regresses on WER', async () => {
    const trainingPairRepo = createInMemoryTrainingPairRepository();
    const adapterRepo = createInMemoryAdapterRepository();
    const evalRunRepo = createInMemoryEvalRunRepository();
    const loraPort = createInMemoryLoraPort({
      tenantId: 't1',
      baseModel: 'base',
    });

    await trainingPairRepo.upsert(pair('p1', 0.5));
    // Seed a current live adapter.
    const current: Adapter = Object.freeze({
      id: 'current-a',
      tenantId: 't1',
      lang: 'sw',
      version: 'v0',
      adapterKind: 'rag-prefix' as const,
      baseModel: 'base',
      trainingPairCount: 0,
      status: 'staged' as const,
      createdAt: '2026-05-25T00:00:00Z',
      auditHash: 'h',
    });
    await adapterRepo.upsert(current);
    await adapterRepo.transition('current-a', 'live');

    // Model port: current adapter returns expected → low WER.
    // Proposed adapter returns garbage → high WER (regression).
    const modelPort: LanguageModelPort = {
      async generate(prompt, adapter, _lang) {
        if (adapter && adapter.id === 'current-a') {
          return prompt.replace('prompt-', '');
        }
        return 'totally wrong unrelated output xxxx yyyy zzzz';
      },
    };

    const result = await runSelfImprove(
      {
        tenantId: 't1',
        lang: 'sw',
        baseModel: 'base',
        gauntletVersion: '19k.1',
        loraFloor: 999, // force rag-prefix path
      },
      {
        trainingPairRepo,
        adapterRepo,
        evalRunRepo,
        loraPort,
        redactor: NULL_REDACTOR,
        evalRunnerPorts: { model: modelPort },
      },
      [entry('a', 'a'), entry('b', 'b'), entry('c', 'c')],
    );

    expect(result.decision).toBe('rollback');
    // Proposed should have been transitioned to rolled-back.
    const proposed = await adapterRepo.findById(result.proposedAdapter.id);
    expect(proposed?.status).toBe('rolled-back');
    // Previous live remains live.
    const live = await adapterRepo.findLive('t1', 'sw');
    expect(live?.id).toBe('current-a');
  });
});
