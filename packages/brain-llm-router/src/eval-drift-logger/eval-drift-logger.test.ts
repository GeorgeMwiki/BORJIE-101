/**
 * Tests for eval-drift-logger/.
 *
 * Coverage:
 *   - fnv1a hashing stable + change-sensitive
 *   - logDrift emits the right event shape
 *   - identical prompt/response yields same hashes
 *   - regressionTriggered detects 5pp drop
 *   - InMemoryEvalDriftSink query filters by task/model/sinceMs
 */

import { describe, expect, it } from 'vitest';
import { fnv1a } from './event.js';
import {
  logDrift,
  passRate,
  regressionTriggered,
  InMemoryEvalDriftSink,
  type PassRateWindow,
} from './drift-logger.js';
import type { BrainLLMRequest, BrainLLMResponse } from '../types.js';

const req: BrainLLMRequest = {
  model: 'anthropic/claude-haiku-4-5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
};
const resp: BrainLLMResponse = {
  id: 'm',
  model: 'anthropic/claude-haiku-4-5',
  provider: 'anthropic',
  content: [{ type: 'text', text: 'reply' }],
  stopReason: 'end_turn',
  usage: { inputTokens: 10, outputTokens: 5 },
  latencyMs: 50,
};

describe('fnv1a', () => {
  it('is deterministic', () => {
    expect(fnv1a('hello world')).toBe(fnv1a('hello world'));
  });

  it('changes on different input', () => {
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });

  it('handles empty string', () => {
    expect(fnv1a('').length).toBeGreaterThan(0);
  });
});

describe('logDrift', () => {
  it('emits an event with all fields populated', async () => {
    const sink = new InMemoryEvalDriftSink();
    const event = await logDrift(
      {
        task: 'chat',
        request: req,
        response: resp,
        confidence: 0.92,
        costUsd: 0.0001,
        tenantId: 'tnt_1',
        conversationId: 'conv_a',
        fallbackDepth: 0,
        cascadeSteps: 1,
        wasHedged: false,
      },
      sink
    );
    expect(event.task).toBe('chat');
    expect(event.model).toBe('anthropic/claude-haiku-4-5');
    expect(event.provider).toBe('anthropic');
    expect(event.confidence).toBe(0.92);
    expect(event.latencyMs).toBe(50);
    expect(event.tenantId).toBe('tnt_1');
    expect(event.promptHash).toMatch(/^[0-9a-z]+$/);
    expect(event.responseHash).toMatch(/^[0-9a-z]+$/);
    expect(sink.count()).toBe(1);
  });

  it('identical prompts produce identical hashes', async () => {
    const sink = new InMemoryEvalDriftSink();
    const e1 = await logDrift({
      task: 'chat', request: req, response: resp, confidence: 1, costUsd: 0, tenantId: 't', conversationId: 'c',
      fallbackDepth: 0, cascadeSteps: 1, wasHedged: false,
    }, sink);
    const e2 = await logDrift({
      task: 'chat', request: req, response: resp, confidence: 1, costUsd: 0, tenantId: 't', conversationId: 'c',
      fallbackDepth: 0, cascadeSteps: 1, wasHedged: false,
    }, sink);
    expect(e1.promptHash).toBe(e2.promptHash);
    expect(e1.responseHash).toBe(e2.responseHash);
  });
});

describe('regressionTriggered', () => {
  const window = (passed: number, total: number): PassRateWindow => ({
    windowStartMs: 0,
    windowEndMs: 1000,
    passed,
    total,
  });

  it('returns triggered=true when current drops > 5pp vs prior mean', () => {
    const current = window(85, 100); // 0.85
    const priors = [window(95, 100), window(92, 100), window(94, 100), window(93, 100)]; // mean ~0.935
    const r = regressionTriggered(current, priors);
    expect(r.triggered).toBe(true);
    expect(r.deltaPp).toBeLessThan(0);
  });

  it('does not trigger on small fluctuations', () => {
    const current = window(92, 100); // 0.92
    const priors = [window(95, 100), window(94, 100), window(93, 100)]; // mean ~0.94
    const r = regressionTriggered(current, priors);
    expect(r.triggered).toBe(false);
  });

  it('returns triggered=false when no prior windows', () => {
    const r = regressionTriggered(window(50, 100), []);
    expect(r.triggered).toBe(false);
  });

  it('passRate handles empty windows', () => {
    expect(passRate(window(0, 0))).toBe(0);
  });
});

describe('InMemoryEvalDriftSink.query', () => {
  it('filters by task', async () => {
    const sink = new InMemoryEvalDriftSink();
    await logDrift({
      task: 'chat', request: req, response: resp, confidence: 1, costUsd: 0,
      tenantId: 't', conversationId: 'c', fallbackDepth: 0, cascadeSteps: 1, wasHedged: false,
    }, sink);
    await logDrift({
      task: 'plan', request: req, response: resp, confidence: 1, costUsd: 0,
      tenantId: 't', conversationId: 'c', fallbackDepth: 0, cascadeSteps: 1, wasHedged: false,
    }, sink);
    const chatOnly = await sink.query({ task: 'chat' });
    expect(chatOnly).toHaveLength(1);
    expect(chatOnly[0]!.task).toBe('chat');
  });

  it('filters by model', async () => {
    const sink = new InMemoryEvalDriftSink();
    await logDrift({
      task: 'chat', request: req, response: resp, confidence: 1, costUsd: 0,
      tenantId: 't', conversationId: 'c', fallbackDepth: 0, cascadeSteps: 1, wasHedged: false,
    }, sink);
    const filtered = await sink.query({ model: 'anthropic/claude-haiku-4-5' });
    expect(filtered).toHaveLength(1);
  });
});
