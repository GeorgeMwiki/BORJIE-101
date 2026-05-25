import { describe, expect, it } from 'vitest';
import type { PersonalizationExample, PersonalizationUser } from '../../types.js';
import { buildPersonalizedPrompt } from '../prompt-builder.js';

const user: PersonalizationUser = {
  userId: 'u-1',
  tenantId: 't1',
  preferences: {
    locale: 'sw-TZ',
    notifyByEmail: true,
  },
};

function ex(
  id: string,
  content: string,
  embedding: number[],
  createdAt = '2026-05-01T00:00:00Z',
): PersonalizationExample {
  return {
    id,
    userId: 'u-1',
    kind: 'qa',
    content,
    embedding,
    createdAt,
  };
}

describe('buildPersonalizedPrompt', () => {
  it('includes the base prompt + preferences block', () => {
    const prompt = buildPersonalizedPrompt({
      basePrompt: 'You are a helpful agent.',
      user,
      examples: [],
    });
    expect(prompt).toContain('You are a helpful agent.');
    expect(prompt).toContain('locale: sw-TZ');
    expect(prompt).toContain('notifyByEmail: true');
  });

  it('selects the k most semantically similar examples', () => {
    const query = [1, 0, 0];
    const examples = [
      ex('relevant', 'About rent payments', [0.99, 0.01, 0]),
      ex('ok', 'Generic chat', [0.5, 0.5, 0]),
      ex('irrelevant', 'About widgets', [0, 0, 1]),
    ];
    const prompt = buildPersonalizedPrompt({
      basePrompt: 'base',
      user,
      examples,
      queryEmbedding: query,
      k: 2,
    });
    expect(prompt).toContain('About rent payments');
    expect(prompt).toContain('Generic chat');
    expect(prompt).not.toContain('About widgets');
  });

  it('only uses examples for the same userId', () => {
    const otherUser: PersonalizationExample = {
      id: 'leak',
      userId: 'u-other',
      kind: 'qa',
      content: 'should not appear',
      embedding: [1, 0, 0],
      createdAt: '2026-05-01Z',
    };
    const own = ex('own', 'mine', [1, 0, 0]);
    const prompt = buildPersonalizedPrompt({
      basePrompt: 'base',
      user,
      examples: [otherUser, own],
      queryEmbedding: [1, 0, 0],
    });
    expect(prompt).not.toContain('should not appear');
    expect(prompt).toContain('mine');
  });

  it('respects the token budget by trimming examples', () => {
    const long = 'a'.repeat(2000);
    const examples = Array.from({ length: 5 }, (_, i) =>
      ex(`e${i}`, long, [1, 0, 0]),
    );
    const prompt = buildPersonalizedPrompt({
      basePrompt: 'base',
      user,
      examples,
      queryEmbedding: [1, 0, 0],
      tokenBudget: 600, // tight — should drop most examples
      k: 5,
    });
    // count occurrences of the long content to verify trimming.
    const occurrences = prompt.split(long).length - 1;
    expect(occurrences).toBeLessThan(5);
  });

  it('falls back to recency when no query embedding is provided', () => {
    const recent = ex('recent', 'recent ex', [], '2026-05-10T00:00:00Z');
    const old = ex('old', 'old ex', [], '2026-01-10T00:00:00Z');
    const prompt = buildPersonalizedPrompt({
      basePrompt: 'base',
      user,
      examples: [old, recent],
      k: 1,
    });
    expect(prompt).toContain('recent ex');
    expect(prompt).not.toContain('old ex');
  });

  it('produces deterministic output for fixed inputs', () => {
    const examples = [ex('a', 'first', [1, 0]), ex('b', 'second', [0, 1])];
    const a = buildPersonalizedPrompt({
      basePrompt: 'b',
      user,
      examples,
      queryEmbedding: [1, 0],
    });
    const b = buildPersonalizedPrompt({
      basePrompt: 'b',
      user,
      examples,
      queryEmbedding: [1, 0],
    });
    expect(b).toBe(a);
  });
});
