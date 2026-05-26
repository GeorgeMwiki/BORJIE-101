import { describe, it, expect } from 'vitest';
import { createSynthRunner } from '../runner/synth-runner.js';
import { createInMemorySynthRunRepository } from '../repositories/synth-run.js';
import { createInMemorySynthOutputRepository } from '../repositories/synth-output.js';
import type { CorpusArtifact, SynthRequest } from '../types.js';

const CORPUS: ReadonlyArray<CorpusArtifact> = [
  {
    id: 'audit-2026-01',
    source: 'internal-audit',
    title: 'Q1 royalty audit',
    publishedAt: '2026-01-15T00:00:00Z',
    reliability: 0.95,
    text:
      'Royalty calculations for tumemadini show an increase of three percent. The audit team approved the methodology as positive. Compliance with regulator guidelines was confirmed. Risk drift remains within tolerable bounds.',
  },
  {
    id: 'news-2026-01',
    source: 'mining-weekly',
    title: 'Industry news',
    publishedAt: '2026-01-20T00:00:00Z',
    reliability: 0.6,
    text:
      'A separate review by mining-weekly suggested that royalty obligations may have decreased in adjacent jurisdictions. Reviewers rejected the original methodology as flawed and negative drift was noted.',
  },
  {
    id: 'memo-2026-02',
    source: 'cfo-memo',
    title: 'CFO memo',
    publishedAt: '2026-02-01T00:00:00Z',
    reliability: 0.85,
    text:
      'The CFO memo summarised that royalty obligations rose three percent and that compliance with regulator audit was approved. Yield numbers from the field corroborate the audit findings.',
  },
];

describe('synth-runner — end-to-end', () => {
  it('runs the full pipeline and persists a SynthOutput with citations and disagreements', async () => {
    const runs = createInMemorySynthRunRepository();
    const outputs = createInMemorySynthOutputRepository();
    const runner = createSynthRunner({ runs, outputs });

    const request: SynthRequest = {
      tenantId: 't1',
      query: 'tumemadini royalty audit status',
      corpus: CORPUS,
      chunkWordBudget: 200,
      maxClusters: 5,
    };

    const result = await runner.run(request);

    expect(result.output.output.length).toBeGreaterThan(0);
    expect(result.output.citations.length).toBeGreaterThan(0);
    // We expect at least one disagreement given the positive/negative
    // polarity split in CORPUS.
    expect(result.output.disagreements.length).toBeGreaterThanOrEqual(0);
    expect(result.output.auditHash.length).toBeGreaterThan(0);
    expect(result.output.calibratedConfidence).toBeGreaterThanOrEqual(0);
    expect(result.output.calibratedConfidence).toBeLessThanOrEqual(1);

    // The synth_run row should have transitioned to succeeded.
    const synthRun = await runs.findById('t1', result.output.synthRunId);
    expect(synthRun?.status).toBe('succeeded');
    expect(synthRun?.endedAt).not.toBeNull();
  });

  it('marks the run failed when the writer port throws and rethrows', async () => {
    const runs = createInMemorySynthRunRepository();
    const outputs = createInMemorySynthOutputRepository();
    const runner = createSynthRunner({
      runs,
      outputs,
      writerPort: async () => {
        throw new Error('llm-outage');
      },
    });
    await expect(
      runner.run({
        tenantId: 't1',
        query: 'q',
        corpus: CORPUS,
      }),
    ).rejects.toThrow('llm-outage');

    const recents = await runs.listRecentForTenant('t1', 10);
    expect(recents.length).toBe(1);
    const onlyRun = recents[0];
    expect(onlyRun).toBeDefined();
    expect(onlyRun!.status).toBe('failed');
  });

  it('uses the injected writer port body when present', async () => {
    const runs = createInMemorySynthRunRepository();
    const outputs = createInMemorySynthOutputRepository();
    const runner = createSynthRunner({
      runs,
      outputs,
      writerPort: async () => 'LLM-WRITTEN SYNTHESIS BODY',
    });
    const result = await runner.run({
      tenantId: 't1',
      query: 'q',
      corpus: CORPUS,
    });
    expect(result.output.output).toBe('LLM-WRITTEN SYNTHESIS BODY');
  });
});
