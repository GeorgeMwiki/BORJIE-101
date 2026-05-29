import { describe, expect, it } from 'vitest';

import {
  citationsBlockSchema,
  inlineBlockSchema,
  parseInlineBlocks,
  INLINE_BLOCK_TYPES,
  type CitationsBlock,
  type CitationRef,
} from '../index.js';

// ─── schema validation ──────────────────────────────────────────────

describe('citations_block schema', () => {
  it('parses a minimal valid block', () => {
    const block: CitationsBlock = {
      type: 'citations_block',
      citations: [
        {
          id: 'cite-1',
          source: 'Mining Act 2010, §86(1)(a)',
          title: 'Royalty rate for gold',
          excerpt: 'A royalty of six per centum (6%)...',
          kind: 'corpus',
        },
      ],
    };
    const parsed = citationsBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.citations).toHaveLength(1);
      expect(parsed.data.citations[0]!.kind).toBe('corpus');
    }
  });

  it('defaults kind to corpus when omitted', () => {
    const block = {
      type: 'citations_block',
      citations: [
        {
          id: 'cite-1',
          source: 'Borjie LMBM',
          title: 'Geita rate',
          excerpt: 'Tenant rate 6%',
        },
      ],
    };
    const parsed = citationsBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.citations[0]!.kind).toBe('corpus');
    }
  });

  it('rejects empty citations array', () => {
    const block = { type: 'citations_block', citations: [] };
    expect(citationsBlockSchema.safeParse(block).success).toBe(false);
  });

  it('rejects more than 8 citations', () => {
    const ref: CitationRef = {
      id: 'cite-x',
      source: 's',
      title: 't',
      excerpt: 'e',
      kind: 'corpus',
    };
    const block = {
      type: 'citations_block',
      citations: Array.from({ length: 9 }, (_, i) => ({
        ...ref,
        id: `cite-${i + 1}`,
      })),
    };
    expect(citationsBlockSchema.safeParse(block).success).toBe(false);
  });

  it('rejects excerpt longer than 400 chars', () => {
    const block = {
      type: 'citations_block',
      citations: [
        {
          id: 'cite-1',
          source: 's',
          title: 't',
          excerpt: 'x'.repeat(401),
          kind: 'corpus',
        },
      ],
    };
    expect(citationsBlockSchema.safeParse(block).success).toBe(false);
  });

  it('rejects unknown kind', () => {
    const block = {
      type: 'citations_block',
      citations: [
        {
          id: 'cite-1',
          source: 's',
          title: 't',
          excerpt: 'e',
          kind: 'satellite',
        },
      ],
    };
    expect(citationsBlockSchema.safeParse(block).success).toBe(false);
  });

  it('accepts an optional bilingual headline', () => {
    const block = {
      type: 'citations_block',
      headline: { en: 'Sources', sw: 'Vyanzo' },
      citations: [
        {
          id: 'cite-1',
          source: 's',
          title: 't',
          excerpt: 'e',
          kind: 'corpus',
        },
      ],
    };
    const parsed = citationsBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);
  });

  it('rejects sourceUrl that is not a URL', () => {
    const block = {
      type: 'citations_block',
      citations: [
        {
          id: 'cite-1',
          source: 's',
          title: 't',
          excerpt: 'e',
          kind: 'web',
          sourceUrl: 'not-a-url',
        },
      ],
    };
    expect(citationsBlockSchema.safeParse(block).success).toBe(false);
  });
});

// ─── union dispatcher ────────────────────────────────────────────────

describe('inlineBlockSchema includes citations_block', () => {
  it('citations_block is in INLINE_BLOCK_TYPES', () => {
    expect(INLINE_BLOCK_TYPES).toContain('citations_block');
  });

  it('routes via the discriminated union', () => {
    const block = {
      type: 'citations_block',
      citations: [
        {
          id: 'cite-1',
          source: 'Mining Act 2010',
          title: 'Rate',
          excerpt: 'gold 6%',
          kind: 'corpus' as const,
        },
      ],
    };
    const parsed = inlineBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);
  });
});

// ─── parser integration ─────────────────────────────────────────────

describe('parseInlineBlocks extracts citations_block', () => {
  it('extracts a single citations_block from chat text', () => {
    const text =
      'The gold royalty rate is 6%.\n' +
      '<ui_block>{"type":"citations_block","citations":[{"id":"cite-1","source":"Mining Act 2010","title":"Royalty","excerpt":"6%","kind":"corpus"}]}</ui_block>';
    const { body, blocks } = parseInlineBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('citations_block');
    expect(body).not.toContain('<ui_block>');
  });

  it('extracts citations_block alongside other blocks', () => {
    const text =
      '<ui_block>{"type":"mini_metric","name":"X","value":"1"}</ui_block>' +
      '<ui_block>{"type":"citations_block","citations":[{"id":"cite-1","source":"S","title":"T","excerpt":"E","kind":"corpus"}]}</ui_block>';
    const { blocks } = parseInlineBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.type)).toEqual([
      'mini_metric',
      'citations_block',
    ]);
  });
});
