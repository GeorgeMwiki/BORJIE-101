import { describe, it, expect } from 'vitest';
import {
  createPolyglotSupport,
  type PolyglotRepository,
  type PolyglotTurn,
} from '../polyglot-support/index.js';
import { DEGRADED_MODEL_VERSION, type ClassifyLLMPort } from '../shared.js';

function makeRepo(): PolyglotRepository & { turns: PolyglotTurn[] } {
  const turns: PolyglotTurn[] = [];
  return {
    turns,
    async insertTurn(t) {
      turns.push(t);
      return t;
    },
    async nextTurnIndex(tenantId, threadId) {
      return turns.filter((t) => t.tenantId === tenantId && t.threadId === threadId).length;
    },
    async listThread(tenantId, threadId) {
      return turns.filter((t) => t.tenantId === tenantId && t.threadId === threadId);
    },
  };
}

describe('polyglot-support', () => {
  it('replies in the detected language (Swahili) and persists both turns', async () => {
    const llm: ClassifyLLMPort = {
      async classify() {
        return {
          raw: JSON.stringify({
            detectedLanguage: 'sw',
            responseLanguage: 'sw',
            reply: 'Habari, tutakusaidia mara moja.',
            translationEn: 'Hello, we will help you right away.',
            confidence: 0.95,
          }),
          modelVersion: 'claude',
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const repo = makeRepo();
    const svc = createPolyglotSupport({ repo, llm });
    const out = await svc.reply({
      tenantId: 't1',
      threadId: 'th1',
      text: 'Nina tatizo la maji!',
    });
    expect(out.assistantTurn.detectedLanguage).toBe('sw');
    expect(out.assistantTurn.responseLanguage).toBe('sw');
    expect(out.assistantTurn.text).toContain('Habari');
    expect(out.assistantTurn.translationEn).toBeTruthy();
    expect(repo.turns).toHaveLength(2);
    expect(repo.turns[0].speaker).toBe('user');
    expect(repo.turns[1].speaker).toBe('assistant');
  });

  it('uses fallback language when LLM is missing (degraded mode)', async () => {
    const repo = makeRepo();
    const svc = createPolyglotSupport({ repo, fallbackLanguage: 'en' });
    const out = await svc.reply({
      tenantId: 't1',
      threadId: 'th2',
      text: 'hello',
    });
    expect(out.assistantTurn.modelVersion).toBe(DEGRADED_MODEL_VERSION);
    expect(out.assistantTurn.responseLanguage).toBe('en');
    expect(repo.turns).toHaveLength(2);
  });

  it('increments turn index across subsequent calls', async () => {
    const repo = makeRepo();
    const svc = createPolyglotSupport({ repo });
    await svc.reply({ tenantId: 't1', threadId: 'th3', text: 'one' });
    await svc.reply({ tenantId: 't1', threadId: 'th3', text: 'two' });
    const thread = await svc.listThread('t1', 'th3');
    expect(thread.map((t) => t.turnIndex)).toEqual([0, 1, 2, 3]);
  });

  it('rejects reply with missing required fields', async () => {
    const repo = makeRepo();
    const svc = createPolyglotSupport({ repo });
    await expect(svc.reply({ tenantId: '', threadId: 'x', text: 'y' })).rejects.toThrow(/missing/);
  });
});
