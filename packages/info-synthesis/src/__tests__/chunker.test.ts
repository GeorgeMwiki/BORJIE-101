import { describe, it, expect } from 'vitest';
import { chunkArtifact, chunkCorpus } from '../pipeline/chunker.js';
import type { CorpusArtifact } from '../types.js';

describe('chunker', () => {
  it('splits a long artifact into multiple chunks at sentence boundaries', () => {
    const long = Array.from({ length: 12 }, (_, i) =>
      `Sentence number ${i + 1} carries some payload words filling out the prose for measurement.`,
    ).join(' ');
    const artifact: CorpusArtifact = {
      id: 'a1',
      source: 'journal',
      text: long,
    };
    const chunks = chunkArtifact(artifact, { wordBudget: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.artifactId).toBe('a1');
      expect(chunk.wordCount).toBeLessThanOrEqual(75);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
    // seq is monotonically increasing starting at 0
    chunks.forEach((c, i) => {
      expect(c.seq).toBe(i);
    });
  });

  it('returns no chunks for an empty artifact', () => {
    const artifact: CorpusArtifact = { id: 'empty', source: 's', text: '   ' };
    expect(chunkArtifact(artifact)).toHaveLength(0);
  });

  it('chunks every artifact in a corpus and preserves provenance', () => {
    const corpus: ReadonlyArray<CorpusArtifact> = [
      { id: 'a', source: 's1', text: 'Short. Another. Third sentence here.' },
      { id: 'b', source: 's2', text: 'Single sentence b.' },
    ];
    const chunks = chunkCorpus(corpus, { wordBudget: 100 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const artifactIds = new Set(chunks.map((c) => c.artifactId));
    expect(artifactIds.has('a')).toBe(true);
    expect(artifactIds.has('b')).toBe(true);
  });
});
