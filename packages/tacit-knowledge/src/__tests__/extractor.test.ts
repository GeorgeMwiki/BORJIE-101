/**
 * Reference entity extractor — deterministic marker-based extraction.
 */

import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../index.js';
import { createReferenceEntityExtractor } from '../index.js';

const at = '2026-05-26T04:42:00Z';

function turn(text: string, speaker: 'subject' | 'mr-mwikila' = 'subject'): TranscriptTurn {
  return { speaker, text, at };
}

describe('reference entity extractor', () => {
  it('classifies a "rule" sentence with a high-confidence marker', async () => {
    const extractor = createReferenceEntityExtractor();
    const drafts = await extractor.extract({
      tenantId: 'tnt-1',
      mode: 'walk-the-floor',
      chunk: [
        turn(
          "You must leave at 04:40 to clear the Geita weighbridge before the day shift comes on.",
        ),
      ],
    });
    expect(drafts.length).toBe(1);
    const first = drafts[0]!;
    expect(first.entityKind).toBe('rule');
    expect(first.confidence).toBeGreaterThan(0.7);
    expect(first.novel).toBe(true);
    expect(first.entity.text).toContain('You must leave');
    expect(first.entity.citations.length).toBe(1);
  });

  it('classifies "always / never" sentences as patterns', async () => {
    const extractor = createReferenceEntityExtractor();
    const drafts = await extractor.extract({
      tenantId: 'tnt-1',
      mode: 'cross-role',
      chunk: [
        turn(
          'In this district, that always means the vein continues for another six metres before it pinches.',
        ),
      ],
    });
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.entityKind).toBe('pattern');
  });

  it('skips Mr. Mwikila utterances — only subject content yields know-how', async () => {
    const extractor = createReferenceEntityExtractor();
    const drafts = await extractor.extract({
      tenantId: 'tnt-1',
      mode: 'post-incident',
      chunk: [
        turn(
          'What were you expecting to happen, and where did the reality diverge?',
          'mr-mwikila',
        ),
      ],
    });
    expect(drafts.length).toBe(0);
  });

  it('falls back to "fact" for long unmarked subject sentences', async () => {
    const extractor = createReferenceEntityExtractor();
    const drafts = await extractor.extract({
      tenantId: 'tnt-1',
      mode: 'post-incident',
      chunk: [
        turn(
          'The compressor failed twelve minutes after midnight while the night shift was finishing the equipment walk-through.',
        ),
      ],
    });
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.entityKind).toBe('fact');
  });
});
