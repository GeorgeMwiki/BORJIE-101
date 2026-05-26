import { describe, it, expect } from 'vitest';
import {
  buildWriterRequest,
  renderFallbackSynthesis,
  writeSynthesis,
} from '../pipeline/writer.js';
import { attachCitations } from '../pipeline/citer.js';
import type {
  Chunk,
  CorpusArtifact,
  Disagreement,
  ReconciledCluster,
} from '../types.js';

describe('writer (fallback) + citer', () => {
  const cluster: ReconciledCluster = {
    id: 'cl1',
    topic: 'topic: royalty, tumemadini',
    chunkIds: ['chunk1', 'chunk2'],
    avgScore: 0.78,
    contradictions: [],
    summary: 'topic: royalty, tumemadini: royalty obligations rose 3%.',
  };
  const disagreement: Disagreement = {
    topic: 'topic: permit, regulator',
    positions: [
      {
        stance: 'positive',
        sources: ['audit-a'],
        chunkIds: ['cP'],
      },
      {
        stance: 'negative',
        sources: ['news-b'],
        chunkIds: ['cN'],
      },
    ],
  };

  it('renderFallbackSynthesis produces markdown with the query, findings, and disagreements', async () => {
    const req = buildWriterRequest({
      query: 'tumemadini royalty status',
      tenantId: 't1',
      clusters: [cluster],
      disagreements: [disagreement],
    });
    const body = renderFallbackSynthesis(req);
    expect(body).toContain('Synthesis — tumemadini royalty status');
    expect(body).toContain('topic: royalty, tumemadini');
    expect(body).toContain('## Disagreements');
    expect(body).toContain('topic: permit, regulator');
  });

  it('writeSynthesis uses the injected port when provided', async () => {
    const req = buildWriterRequest({
      query: 'q',
      tenantId: 't1',
      clusters: [],
      disagreements: [],
    });
    const body = await writeSynthesis(req, {
      port: async () => 'LLM-RENDERED',
    });
    expect(body).toBe('LLM-RENDERED');
  });

  it('attachCitations emits one Citation per (cluster, chunk) pair with source provenance', () => {
    const chunks = new Map<string, Chunk>([
      [
        'chunk1',
        { id: 'chunk1', artifactId: 'a1', text: 'x', wordCount: 1, seq: 0 },
      ],
      [
        'chunk2',
        { id: 'chunk2', artifactId: 'a2', text: 'y', wordCount: 1, seq: 0 },
      ],
    ]);
    const corpus = new Map<string, CorpusArtifact>([
      ['a1', { id: 'a1', source: 'audit-2026-01', text: 'x' }],
      ['a2', { id: 'a2', source: 'news-2026-01', text: 'y' }],
    ]);
    const citations = attachCitations({
      clusters: [cluster],
      chunksById: chunks,
      corpusById: corpus,
    });
    expect(citations).toHaveLength(2);
    expect(citations[0]?.confidence).toBeCloseTo(0.78);
    const sources = new Set(citations.map((c) => c.source));
    expect(sources.has('audit-2026-01')).toBe(true);
    expect(sources.has('news-2026-01')).toBe(true);
  });
});
