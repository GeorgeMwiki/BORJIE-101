import { describe, expect, it, vi } from 'vitest';
import { chatWithDocSet } from '../chat-with-doc-set.js';
import { buildPage, buildParsedDocument } from '../../ocr/parsed-document-builder.js';
import type { BrainPort, TextBlock } from '../../types.js';

function tBlock(id: string, text: string): TextBlock {
  return {
    id,
    text,
    bbox: { x: 0, y: 0, width: 1, height: 0.05 },
    role: 'paragraph',
    confidence: 1,
    language: 'en',
  };
}

async function leaseDoc(id: string, rent: string) {
  return await buildParsedDocument({
    id,
    sourceMime: 'application/pdf',
    sourceBytes: new Uint8Array([id.length]),
    pages: [
      buildPage({
        pageNumber: 1,
        language: 'en',
        blocks: [tBlock('b-0', `Monthly rent is ${rent}.`)],
      }),
    ],
    producedBy: 'test',
  });
}

describe('chatWithDocSet', () => {
  it('returns per-doc contributions and detects cross-doc synthesis', async () => {
    const docA = await leaseDoc('a', 'TZS 1,000,000');
    const docB = await leaseDoc('b', 'KES 50,000');
    const brain: BrainPort = {
      complete: vi.fn(async () => ({
        text:
          'Doc A has monthly rent TZS 1,000,000 [doc:a#p1:b-0:"Monthly rent is TZS 1,000,000."] while Doc B has KES 50,000 [doc:b#p1:b-0:"Monthly rent is KES 50,000."].',
      })),
    };
    const answer = await chatWithDocSet({
      docs: [docA, docB],
      question: 'rent',
      brain,
    });
    expect(answer.crossDocSynthesis).toBe(true);
    expect(answer.citations).toHaveLength(2);
    expect(answer.perDocContribution).toHaveLength(2);
    const total = answer.perDocContribution.reduce((s, p) => s + p.score, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it('respects empty result with zero contribution scores', async () => {
    const docA = await leaseDoc('a', 'TZS 1');
    const brain: BrainPort = {
      complete: vi.fn(async () => ({ text: 'X' })),
    };
    const answer = await chatWithDocSet({
      docs: [docA],
      question: 'pizza taco airplane',
      brain,
    });
    expect(answer.confidence).toBe(0);
    expect(answer.crossDocSynthesis).toBe(false);
    expect(answer.perDocContribution[0]!.score).toBe(0);
  });

  it('caps total chunks at globalChunkBudget', async () => {
    const docA = await leaseDoc('a', 'TZS 1');
    const docB = await leaseDoc('b', 'TZS 2');
    const docC = await leaseDoc('c', 'TZS 3');
    const brain: BrainPort = { complete: vi.fn(async () => ({ text: 'OK' })) };
    await chatWithDocSet({
      docs: [docA, docB, docC],
      question: 'rent',
      brain,
      globalChunkBudget: 2,
    });
    const prompt = (brain.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    const chunkCount = (prompt.match(/\[chunk \d+ \|/g) ?? []).length;
    expect(chunkCount).toBeLessThanOrEqual(2);
  });
});
