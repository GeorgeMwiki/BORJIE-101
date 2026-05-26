/**
 * Citation embedder tests — pre-persistence gate refuses docs whose
 * numeric / statute claims are uncited (per spec §6 hard rule).
 */

import { describe, expect, it } from 'vitest';
import { enforceCitationGate, extractCorpus, formatFootnote } from '../citations/embedder.js';
import { CompositionError } from '../types.js';
import type { IRDoc, SpanCitation } from '../types.js';

const CITATION: SpanCitation = {
  id: 'CIT-001',
  claim: 'Approved evidence.',
  source: { kind: 'ledger', ref: 'ledger-row-1' },
};

function baseDoc(): IRDoc {
  return {
    title: 'Test',
    sections: [],
    citations: [CITATION],
    watermark: 'final',
    generated_at: '2026-05-26T08:00:00.000Z',
  };
}

describe('enforceCitationGate', () => {
  it('passes a doc with no numeric claims', () => {
    expect(() => enforceCitationGate(baseDoc())).not.toThrow();
  });

  it('passes a doc whose numeric claim cites a known span', () => {
    const doc: IRDoc = {
      ...baseDoc(),
      sections: [
        {
          id: 's',
          title: 'Money',
          blocks: [
            {
              kind: 'paragraph',
              text: 'Revenue grew by 12% this quarter.',
              citationId: 'CIT-001',
            },
          ],
          citationIds: ['CIT-001'],
        },
      ],
    };
    expect(() => enforceCitationGate(doc)).not.toThrow();
  });

  it('refuses a doc with an uncited numeric claim', () => {
    const doc: IRDoc = {
      ...baseDoc(),
      sections: [
        {
          id: 's',
          title: 'Money',
          blocks: [
            { kind: 'paragraph', text: 'Revenue grew by 12% this quarter.' },
          ],
          citationIds: [],
        },
      ],
    };
    try {
      enforceCitationGate(doc);
      throw new Error('expected gate to refuse');
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionError);
      expect((err as CompositionError).code).toBe('CITATION_GAP');
    }
  });

  it('refuses a doc that cites an unknown id', () => {
    const doc: IRDoc = {
      ...baseDoc(),
      sections: [
        {
          id: 's',
          title: 'Money',
          blocks: [
            {
              kind: 'paragraph',
              text: 'Revenue grew by 12% this quarter.',
              citationId: 'CIT-UNREGISTERED',
            },
          ],
          citationIds: ['CIT-UNREGISTERED'],
        },
      ],
    };
    expect(() => enforceCitationGate(doc)).toThrow(CompositionError);
  });
});

describe('extractCorpus', () => {
  it('threads block + kpi text into one corpus blob', () => {
    const doc: IRDoc = {
      ...baseDoc(),
      sections: [
        {
          id: 'kpi',
          title: 'KPIs',
          blocks: [
            {
              kind: 'kpi_grid',
              kpis: [
                {
                  label: 'Tons',
                  value: '1200',
                  citationId: 'CIT-001',
                },
              ],
            },
          ],
          citationIds: ['CIT-001'],
        },
      ],
    };
    const corpus = extractCorpus(doc);
    expect(corpus).toContain('Tons: 1200');
    expect(corpus).toContain('[CIT-001]');
  });
});

describe('formatFootnote', () => {
  it('produces a stable footnote string', () => {
    const s = formatFootnote(CITATION, '2026-05-26');
    expect(s).toContain('[CIT-001]');
    expect(s).toContain('Approved evidence.');
    expect(s).toContain('retrieved 2026-05-26');
  });
});
