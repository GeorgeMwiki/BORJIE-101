import { describe, expect, it, vi } from 'vitest';
import { chatWithDoc } from '../chat-with-doc.js';
import { buildParsedDocument } from '../../ocr/parsed-document-builder.js';
import { leaseAgreementPage } from '../../ocr/__tests__/fixtures.js';
import type { BrainPort } from '../../types.js';

async function leaseDoc() {
  return await buildParsedDocument({
    id: 'lease-001',
    sourceMime: 'application/pdf',
    sourceBytes: new Uint8Array([1, 2, 3]),
    pages: [leaseAgreementPage()],
    producedBy: 'test',
  });
}

function brainReturning(text: string): BrainPort {
  return {
    complete: vi.fn(async () => ({ text, tokensUsed: 42 })),
  };
}

describe('chatWithDoc', () => {
  it('returns brain answer with parsed citations', async () => {
    const doc = await leaseDoc();
    const brain = brainReturning(
      'The monthly rent is TZS 1,250,000 [doc:lease-001#p1:b-3:"Monthly Rent: TZS 1,250,000"].'
    );
    const result = await chatWithDoc({
      doc,
      question: 'What is the rent?',
      brain,
    });
    expect(result.answer).toContain('[1]');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]!.blockId).toBe('b-3');
    expect(result.tokensUsed).toBe(42);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('handles no-matching-chunks gracefully', async () => {
    const doc = await leaseDoc();
    const brain = brainReturning('Should not be called');
    const result = await chatWithDoc({
      doc,
      question: 'pizza taco airplane',
      brain,
    });
    expect(result.confidence).toBe(0);
    expect(brain.complete).not.toHaveBeenCalled();
  });

  it('passes temperature=0 to brain', async () => {
    const doc = await leaseDoc();
    const brain = brainReturning('answer');
    await chatWithDoc({ doc, question: 'rent', brain });
    expect(brain.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ temperature: 0 })
    );
  });

  it('preserves the docId in the prompt context', async () => {
    const doc = await leaseDoc();
    const brain = brainReturning('answer');
    await chatWithDoc({ doc, question: 'tenant', brain });
    const prompt = (brain.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(prompt).toContain('doc:lease-001');
  });
});
