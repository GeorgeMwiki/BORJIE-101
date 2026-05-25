/**
 * Tests for providers/router (buildMultiLLMRouter / buildMultiLLMRouterFromEnv).
 *
 * Coverage: required-arg validation, optional providers when keys are
 * absent, env-var pass-through, ledger plumbing, fallbackChains override.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildMultiLLMRouter,
  buildMultiLLMRouterFromEnv,
} from '../router.js';

function fakeLedger() {
  return {
    assertWithinBudget: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => ({} as never)),
    currentMonthSpend: vi.fn(),
    isOverBudget: vi.fn(),
    getBudget: vi.fn(),
    setBudget: vi.fn(),
    listRecentEntries: vi.fn(),
  } as unknown as Parameters<typeof buildMultiLLMRouter>[0]['ledger'];
}

describe('buildMultiLLMRouter', () => {
  it('throws when ledger is missing', () => {
    expect(() =>
      buildMultiLLMRouter({
        ledger: undefined as unknown as ReturnType<typeof fakeLedger>,
        anthropicApiKey: 'k',
      }),
    ).toThrow(/ledger is required/);
  });

  it('throws when anthropicApiKey is missing', () => {
    expect(() =>
      buildMultiLLMRouter({ ledger: fakeLedger(), anthropicApiKey: '' }),
    ).toThrow(/ANTHROPIC_API_KEY is required/);
  });

  it('returns a router with only Anthropic when no other keys are set', () => {
    const router = buildMultiLLMRouter({
      ledger: fakeLedger(),
      anthropicApiKey: 'k',
    });
    const decision = router.pick({ taskType: 'reasoning' });
    expect(decision?.providerId).toBe('anthropic');
  });

  it('registers OpenAI when openaiApiKey is supplied', () => {
    const router = buildMultiLLMRouter({
      ledger: fakeLedger(),
      anthropicApiKey: 'k',
      openaiApiKey: 'o',
    });
    const conv = router.pick({ taskType: 'conversation' });
    expect(conv?.providerId).toBe('openai');
  });

  it('registers DeepSeek when deepseekApiKey is supplied', () => {
    const router = buildMultiLLMRouter({
      ledger: fakeLedger(),
      anthropicApiKey: 'k',
      deepseekApiKey: 'd',
    });
    const batch = router.pick({ taskType: 'batch' });
    expect(batch?.providerId).toBe('deepseek');
  });

  it('honours fallbackChains override', () => {
    const router = buildMultiLLMRouter({
      ledger: fakeLedger(),
      anthropicApiKey: 'k',
      openaiApiKey: 'o',
      fallbackChains: { conversation: ['anthropic', 'openai'] },
    });
    expect(router.pick({ taskType: 'conversation' })?.providerId).toBe(
      'anthropic',
    );
  });
});

describe('buildMultiLLMRouterFromEnv', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads ANTHROPIC_API_KEY from process.env', () => {
    process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const router = buildMultiLLMRouterFromEnv(fakeLedger());
    expect(router.pick({ taskType: 'reasoning' })?.providerId).toBe('anthropic');
  });

  it('throws when ANTHROPIC_API_KEY is unset', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => buildMultiLLMRouterFromEnv(fakeLedger())).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('opt-in registers OpenAI when env contains OPENAI_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    process.env.OPENAI_API_KEY = 'o';
    delete process.env.DEEPSEEK_API_KEY;
    const router = buildMultiLLMRouterFromEnv(fakeLedger());
    expect(router.pick({ taskType: 'conversation' })?.providerId).toBe('openai');
  });
});
