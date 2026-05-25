import { describe, it, expect, vi } from 'vitest';
import {
  createSentimentMonitor,
  type SentimentMonitorRepository,
  type SentimentSignal,
  type SentimentRollup,
  type SentimentEventPublisher,
} from '../sentiment-monitor/index.js';
import type { ClassifyLLMPort } from '../shared.js';
import { DEGRADED_MODEL_VERSION } from '../shared.js';

function makeRepo(): SentimentMonitorRepository & {
  signals: SentimentSignal[];
  rollups: SentimentRollup[];
} {
  const signals: SentimentSignal[] = [];
  const rollups: SentimentRollup[] = [];
  return {
    signals,
    rollups,
    async insertSignal(s) {
      signals.push(s);
      return s;
    },
    async getRollingAverage(tenantId, customerId, _windowHours) {
      const filtered = signals.filter(
        (x) => x.tenantId === tenantId && x.customerId === customerId,
      );
      if (filtered.length === 0) return null;
      const avg =
        filtered.reduce((a, b) => a + b.sentimentScore, 0) / filtered.length;
      return { avg, count: filtered.length };
    },
    async upsertRollup(r) {
      rollups.push(r);
      return r;
    },
    async listRecent(tenantId, params) {
      return signals
        .filter((s) => s.tenantId === tenantId)
        .filter((s) => (params.customerId === undefined || s.customerId === params.customerId))
        .slice(0, params.limit ?? 100);
    },
  };
}

describe('sentiment-monitor', () => {
  it('classifies a message via the LLM and persists an ai_native_signal', async () => {
    const llm: ClassifyLLMPort = {
      async classify() {
        return {
          raw: JSON.stringify({
            languageCode: 'fr',
            sentimentScore: -0.8,
            emotionLabel: 'anger',
            churnSignal: 0.75,
            liabilitySignal: 0.2,
            fraudSignal: 0.05,
            confidence: 0.9,
            explanation: 'Very negative tone about rent hike.',
          }),
          modelVersion: 'claude-3-sonnet',
          inputTokens: 100,
          outputTokens: 50,
        };
      },
    };
    const repo = makeRepo();
    const monitor = createSentimentMonitor({ repo, llm });

    const out = await monitor.ingest({
      tenantId: 't1',
      customerId: 'c1',
      sourceType: 'complaint',
      sourceId: 'cmp1',
      text: 'Cette augmentation est inacceptable!',
    });

    expect(out.sentimentScore).toBeCloseTo(-0.8);
    expect(out.languageCode).toBe('fr');
    expect(out.modelVersion).toBe('claude-3-sonnet');
    expect(out.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repo.signals).toHaveLength(1);
  });

  it('degrades gracefully when LLM port is missing', async () => {
    const repo = makeRepo();
    const monitor = createSentimentMonitor({ repo });

    const out = await monitor.ingest({
      tenantId: 't1',
      sourceType: 'message',
      sourceId: 'msg1',
      text: 'hello',
      languageHint: 'en',
    });

    expect(out.modelVersion).toBe(DEGRADED_MODEL_VERSION);
    expect(out.sentimentScore).toBe(0);
    expect(out.metadata).toEqual({ degraded: true });
    expect(repo.signals).toHaveLength(1);
  });

  it('emits TenantSentimentShift when rolling delta exceeds threshold', async () => {
    const llm: ClassifyLLMPort = {
      async classify() {
        return {
          raw: JSON.stringify({ sentimentScore: 0.6, confidence: 0.9 }),
          modelVersion: 'x',
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const repo = makeRepo();
    // seed 5 positive signals so average is strongly positive
    for (let i = 0; i < 5; i += 1) {
      repo.signals.push({
        id: `s${i}`,
        tenantId: 't1',
        customerId: 'c1',
        sourceType: 'message',
        sourceId: `m${i}`,
        languageCode: 'en',
        sentimentScore: 0.8,
        emotionLabel: null,
        churnSignal: 0,
        liabilitySignal: 0,
        fraudSignal: 0,
        rawExcerpt: '',
        modelVersion: 'x',
        promptHash: 'h',
        confidence: 1,
        explanation: '',
        metadata: {},
        observedAt: new Date().toISOString(),
      });
    }
    const publishShift = vi.fn().mockResolvedValue(undefined);
    const publisher: SentimentEventPublisher = { publishShift };
    const monitor = createSentimentMonitor({
      repo,
      llm: {
        async classify() {
          return {
            raw: JSON.stringify({ sentimentScore: -0.5, confidence: 0.9 }),
            modelVersion: 'x',
            inputTokens: 1,
            outputTokens: 1,
          };
        },
      },
      publisher,
      shiftThreshold: 0.3,
      windowHours: 168,
    });

    await monitor.ingest({
      tenantId: 't1',
      customerId: 'c1',
      sourceType: 'message',
      sourceId: 'm100',
      text: 'bad news',
    });

    expect(publishShift).toHaveBeenCalledTimes(1);
    const args = publishShift.mock.calls[0][0];
    expect(args.type).toBe('TenantSentimentShift');
    expect(args.currentAvg).toBe(-0.5);
  });

  it('rejects ingest with missing required fields', async () => {
    const repo = makeRepo();
    const monitor = createSentimentMonitor({ repo });
    await expect(
      monitor.ingest({
        tenantId: '',
        sourceType: 'message',
        sourceId: 'x',
        text: 'y',
      }),
    ).rejects.toThrow(/missing/);
  });
});
