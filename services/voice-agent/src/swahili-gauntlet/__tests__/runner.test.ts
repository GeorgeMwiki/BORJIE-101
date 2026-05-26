/**
 * Smoke tests for the gauntlet runner. Uses an in-memory STT stub + the
 * in-memory result repository so the run completes hermetically.
 *
 * The two key assertions:
 *   1. A perfect STT stub (echoes the reference) yields WER 0 and the run
 *      passes the spec threshold.
 *   2. A noisy STT stub flags violations and the run fails.
 */

import { describe, expect, it } from 'vitest';

import { runGauntlet, type GauntletSttProvider } from '../runner.js';
import { createInMemoryResultRepository } from '../storage/result-repository.js';
import { SWAHILI_GAUNTLET_UTTERANCES } from '../test-utterances.js';

describe('runGauntlet', () => {
  it('exposes a 50-utterance test set covering all mining categories', () => {
    expect(SWAHILI_GAUNTLET_UTTERANCES).toHaveLength(50);
    const categories = new Set(SWAHILI_GAUNTLET_UTTERANCES.map((u) => u.category));
    expect(categories).toEqual(
      new Set(['regulatory', 'dimensional', 'governance', 'dialect', 'environment']),
    );
  });

  it('returns WER 0 + passes when STT echoes the reference', async () => {
    const stt: GauntletSttProvider = async (u) => ({
      hypothesis: u.referenceTranscript,
      latencyMs: 100,
    });
    const repo = createInMemoryResultRepository();
    const result = await runGauntlet(stt, repo, {
      runId: 'run-1',
      tenantId: 't1',
      provider: 'mock',
      modelVersion: '0.0.0-test',
    });
    expect(result.summary.aggregateWer).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.perUtterance).toHaveLength(50);
    const persisted = await repo.listUtterancesForRun('run-1');
    expect(persisted).toHaveLength(50);
  });

  it('flags violations + fails when STT corrupts every utterance', async () => {
    const stt: GauntletSttProvider = async () => ({
      hypothesis: 'asilani kabisa',
      latencyMs: 100,
    });
    const repo = createInMemoryResultRepository();
    const result = await runGauntlet(stt, repo, {
      runId: 'run-2',
      tenantId: 't1',
      provider: 'broken-mock',
      modelVersion: '0.0.0-test',
    });
    expect(result.summary.aggregateWer).toBeGreaterThan(0.08);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });

  it('runs against a subset when caller restricts utterances', async () => {
    const stt: GauntletSttProvider = async (u) => ({
      hypothesis: u.referenceTranscript,
      latencyMs: 50,
    });
    const repo = createInMemoryResultRepository();
    const subset = SWAHILI_GAUNTLET_UTTERANCES.slice(0, 3);
    const result = await runGauntlet(stt, repo, {
      runId: 'run-3',
      tenantId: 't1',
      provider: 'mock',
      modelVersion: '0.0.0-test',
      utterances: subset,
    });
    expect(result.summary.utteranceCount).toBe(3);
    expect(result.passed).toBe(true);
  });

  it('persists a run summary on the tenant scope', async () => {
    const stt: GauntletSttProvider = async (u) => ({
      hypothesis: u.referenceTranscript,
      latencyMs: 75,
    });
    const repo = createInMemoryResultRepository();
    await runGauntlet(stt, repo, {
      runId: 'run-4',
      tenantId: 't1',
      provider: 'mock',
      modelVersion: '0.0.0-test',
    });
    const summaries = await repo.listRunSummaries('t1');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.runId).toBe('run-4');
  });
});
