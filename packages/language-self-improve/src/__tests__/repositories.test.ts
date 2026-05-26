import { describe, expect, it } from 'vitest';

import {
  AdapterTransitionError,
  createInMemoryAdapterRepository,
} from '../repositories/adapter-repository.js';
import {
  createInMemoryEvalRunRepository,
} from '../repositories/eval-run-repository.js';
import {
  createInMemoryGauntletEntryRepository,
  GauntletEntryDuplicateError,
} from '../repositories/gauntlet-entry-repository.js';
import {
  createInMemoryTrainingPairRepository,
} from '../repositories/training-pair-repository.js';
import type {
  Adapter,
  EvalRun,
  GauntletEntry,
  TrainingPair,
} from '../types.js';

function mkPair(id: string, lang: 'sw' | 'en' = 'sw'): TrainingPair {
  return Object.freeze({
    id,
    tenantId: 't1',
    sourceText: 'src',
    targetText: 'tgt',
    lang,
    utteranceId: null,
    scores: Object.freeze({
      wer: 0.05,
      per: 0.05,
      grammar: 0.9,
      terminology: 0.9,
      aggregate: 0.9,
      recipientConsent: 'per-user-learn' as const,
    }),
    included: true,
    exclusionReason: null,
    recordedAt: `2026-05-26T10:00:0${id.length % 10}Z`,
    auditHash: 'h',
    prevHash: 'p',
  });
}

function mkAdapter(id: string, status: 'staged' | 'live' = 'staged'): Adapter {
  return Object.freeze({
    id,
    tenantId: 't1',
    lang: 'sw',
    version: id,
    adapterKind: 'lora' as const,
    baseModel: 'base',
    trainingPairCount: 0,
    status,
    createdAt: `2026-05-26T10:00:0${id.length % 10}Z`,
    auditHash: 'h',
  });
}

function mkRun(id: string, adapterId: string): EvalRun {
  return Object.freeze({
    id,
    tenantId: 't1',
    adapterId,
    gauntletVersion: '19k.1',
    wer: 0.1,
    per: 0.1,
    grammarScore: 0.9,
    terminologyScore: 0.9,
    mos: null,
    decision: 'promote' as const,
    ranAt: `2026-05-26T10:00:0${id.length % 10}Z`,
    auditHash: 'h',
  });
}

function mkEntry(id: string, prompt: string): GauntletEntry {
  return Object.freeze({
    id,
    tenantId: 't1',
    lang: 'sw',
    prompt,
    expectedText: prompt,
    expectedIntent: null,
    domain: null,
    dialect: 'bongo' as const,
    category: 'regulatory' as const,
    auditHash: 'h',
  });
}

describe('training-pair repository', () => {
  it('CRUD: upsert + findById + listForTenant + count', async () => {
    const repo = createInMemoryTrainingPairRepository();
    await repo.upsert(mkPair('a'));
    await repo.upsert(mkPair('b'));
    expect((await repo.findById('a'))?.id).toBe('a');
    const list = await repo.listForTenant('t1', 'sw');
    expect(list).toHaveLength(2);
    expect(await repo.countForTenant('t1', 'sw')).toBe(2);
  });
});

describe('adapter repository', () => {
  it('upsert + findLive + valid transition', async () => {
    const repo = createInMemoryAdapterRepository();
    await repo.upsert(mkAdapter('a', 'staged'));
    expect(await repo.findLive('t1', 'sw')).toBeNull();
    await repo.transition('a', 'live');
    const live = await repo.findLive('t1', 'sw');
    expect(live?.id).toBe('a');
    expect(live?.status).toBe('live');
  });

  it('throws on invalid transition', async () => {
    const repo = createInMemoryAdapterRepository();
    await repo.upsert(mkAdapter('a', 'staged'));
    // staged → training is not allowed.
    await expect(repo.transition('a', 'training')).rejects.toBeInstanceOf(
      AdapterTransitionError,
    );
  });

  it('demotes the previous live when a new one promotes', async () => {
    const repo = createInMemoryAdapterRepository();
    await repo.upsert(mkAdapter('a', 'staged'));
    await repo.transition('a', 'live');
    await repo.upsert(mkAdapter('b', 'staged'));
    await repo.transition('b', 'live');
    const live = await repo.findLive('t1', 'sw');
    expect(live?.id).toBe('b');
    const prior = await repo.findById('a');
    expect(prior?.status).toBe('rolled-back');
  });
});

describe('eval-run repository', () => {
  it('insert + listForAdapter + listForTenant', async () => {
    const repo = createInMemoryEvalRunRepository();
    await repo.insert(mkRun('r1', 'a'));
    await repo.insert(mkRun('r2', 'a'));
    await repo.insert(mkRun('r3', 'b'));
    expect((await repo.listForAdapter('a'))).toHaveLength(2);
    expect((await repo.listForTenant('t1'))).toHaveLength(3);
  });
});

describe('gauntlet-entry repository', () => {
  it('rejects duplicate (tenant, lang, prompt)', async () => {
    const repo = createInMemoryGauntletEntryRepository();
    await repo.insert(mkEntry('e1', 'unique-prompt-1'));
    await expect(
      repo.insert(mkEntry('e2', 'unique-prompt-1')),
    ).rejects.toBeInstanceOf(GauntletEntryDuplicateError);
  });

  it('listForTenant returns inserted entries', async () => {
    const repo = createInMemoryGauntletEntryRepository();
    await repo.insert(mkEntry('e1', 'p1'));
    await repo.insert(mkEntry('e2', 'p2'));
    const list = await repo.listForTenant('t1', 'sw');
    expect(list).toHaveLength(2);
  });
});
