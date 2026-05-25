/**
 * counter-model — unit tests.
 *
 * Pins the contract the executor + composition root rely on:
 *
 *   1. verdict 'safe'   → fallback=false, reason carried through
 *   2. verdict 'risky'  → fallback=false, reason carried through
 *   3. verdict 'refuse' → fallback=false, reason carried through
 *   4. unknown verdict in the model response → coerced to 'risky'
 *   5. API throws → fallback='risky', fallback=true, reason names the
 *      underlying error
 *   6. empty content array → 'risky' fallback
 *   7. JSON-with-prose response → parsed correctly
 *   8. confidence clamped to [0,1]
 *
 * Plus 2 small prompt-template assertions to keep the wire-format
 * stable across refactors (the system prompt is part of the
 * counter-model's policy and must not silently shift).
 */

import { describe, it, expect, vi } from 'vitest';
import { createCounterModelReview, type CounterModelLlmClient } from '../counter-model';
import {
  COUNTER_MODEL_SYSTEM_PROMPT,
  buildCounterModelPrompt,
  parseCounterModelResponse,
} from '../prompt-template';

function fakeClient(
  body: string,
): CounterModelLlmClient {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: body }],
      })),
    },
  };
}

function throwingClient(message: string): CounterModelLlmClient {
  return {
    messages: {
      create: vi.fn(async () => {
        throw new Error(message);
      }),
    },
  };
}

describe('createCounterModelReview', () => {
  it('parses a clean "safe" verdict', async () => {
    const client = fakeClient(
      JSON.stringify({
        verdict: 'safe',
        reason: 'no red flags',
        confidence: 0.9,
      }),
    );
    const reviewer = createCounterModelReview({ anthropicClient: client });
    const outcome = await reviewer.review({
      toolName: 'rent-send-reminder',
      payload: { unitId: 'u1' },
    });
    expect(outcome.verdict).toBe('safe');
    expect(outcome.reason).toBe('no red flags');
    expect(outcome.confidence).toBeCloseTo(0.9);
    expect(outcome.fallback).toBe(false);
  });

  it('parses a "risky" verdict and preserves reason', async () => {
    const client = fakeClient(
      JSON.stringify({
        verdict: 'risky',
        reason: 'cross-tenant payload field detected',
        confidence: 0.7,
      }),
    );
    const reviewer = createCounterModelReview({ anthropicClient: client });
    const outcome = await reviewer.review({
      toolName: 'owner-payout-executed',
      payload: { amount: 10000 },
    });
    expect(outcome.verdict).toBe('risky');
    expect(outcome.reason).toContain('cross-tenant');
  });

  it('parses a "refuse" verdict and reports fallback=false', async () => {
    const client = fakeClient(
      JSON.stringify({
        verdict: 'refuse',
        reason: 'irreversible payout without budget context',
        confidence: 0.95,
      }),
    );
    const reviewer = createCounterModelReview({ anthropicClient: client });
    const outcome = await reviewer.review({
      toolName: 'owner-payout-executed',
      payload: { amount: 250000 },
    });
    expect(outcome.verdict).toBe('refuse');
    expect(outcome.fallback).toBe(false);
  });

  it('coerces unknown verdict strings to "risky"', async () => {
    const client = fakeClient(
      JSON.stringify({ verdict: 'looks-good', reason: 'sure' }),
    );
    const reviewer = createCounterModelReview({ anthropicClient: client });
    const outcome = await reviewer.review({
      toolName: 't',
      payload: {},
    });
    expect(outcome.verdict).toBe('risky');
  });

  it('falls back to "risky" on API error', async () => {
    const client = throwingClient('upstream timeout');
    const reviewer = createCounterModelReview({ anthropicClient: client });
    const outcome = await reviewer.review({
      toolName: 'kra-mri-filed',
      payload: {},
    });
    expect(outcome.verdict).toBe('risky');
    expect(outcome.fallback).toBe(true);
    expect(outcome.reason).toContain('upstream timeout');
    expect(outcome.confidence).toBe(0);
  });

  it('falls back to "risky" on empty model response', async () => {
    const client = fakeClient('');
    const reviewer = createCounterModelReview({ anthropicClient: client });
    const outcome = await reviewer.review({
      toolName: 't',
      payload: {},
    });
    expect(outcome.verdict).toBe('risky');
  });

  it('parses JSON when the model wraps it in chatty prose', async () => {
    const client = fakeClient(
      `Sure thing. {"verdict":"safe","reason":"nothing concerning","confidence":1} — happy to help`,
    );
    const reviewer = createCounterModelReview({ anthropicClient: client });
    const outcome = await reviewer.review({
      toolName: 't',
      payload: {},
    });
    expect(outcome.verdict).toBe('safe');
    expect(outcome.reason).toBe('nothing concerning');
  });

  it('clamps confidence to [0,1]', async () => {
    const client = fakeClient(
      JSON.stringify({ verdict: 'safe', reason: 'ok', confidence: 7.2 }),
    );
    const reviewer = createCounterModelReview({ anthropicClient: client });
    const out = await reviewer.review({ toolName: 't', payload: {} });
    expect(out.confidence).toBe(1);

    const client2 = fakeClient(
      JSON.stringify({ verdict: 'safe', reason: 'ok', confidence: -3 }),
    );
    const reviewer2 = createCounterModelReview({ anthropicClient: client2 });
    const out2 = await reviewer2.review({ toolName: 't', payload: {} });
    expect(out2.confidence).toBe(0);
  });
});

describe('buildCounterModelPrompt + parseCounterModelResponse', () => {
  it('system prompt mentions the four red flag categories', () => {
    expect(COUNTER_MODEL_SYSTEM_PROMPT).toMatch(/Cross-tenant/i);
    expect(COUNTER_MODEL_SYSTEM_PROMPT).toMatch(/Compliance/i);
    expect(COUNTER_MODEL_SYSTEM_PROMPT).toMatch(/Financial/i);
    expect(COUNTER_MODEL_SYSTEM_PROMPT).toMatch(/Reversibility/i);
  });

  it('user prompt carries tool name + payload', () => {
    const built = buildCounterModelPrompt({
      toolName: 'tenant-eviction-proposed',
      payload: { tenantId: 't', cause: 'arrears' },
      tenantId: 't_demo',
      userId: 'u_admin',
    });
    expect(built.user).toContain('tenant-eviction-proposed');
    expect(built.user).toContain('t_demo');
  });

  it('parseCounterModelResponse defaults to risky on malformed JSON', () => {
    const parsed = parseCounterModelResponse('not JSON at all');
    expect(parsed.verdict).toBe('risky');
  });
});
