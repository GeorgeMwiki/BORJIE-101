/**
 * Brain cache — pattern-family + intent-tiered-TTL coverage.
 *
 * Exercises the LITFIN-parity additions:
 *   - English + Swahili greeting pattern family collapses to one key
 *   - per-user isolation is preserved (no cross-tenant bleed)
 *   - command intent is NEVER cached
 *   - intent-tiered TTLs (greeting 5 min, question 60 s, command 0)
 */

import { describe, it, expect } from 'vitest';
import {
  cacheKeyForRequest,
  classifyIntent,
  createBrainCache,
  DEFAULT_INTENT_TTL_MS,
  type CacheIntent,
} from '../brain-cache.js';
import type { BrainDecision, ThoughtRequest } from '../kernel-types.js';
import type { ScopeContext } from '../../types.js';

const TENANT: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_1',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function decision(text: string): BrainDecision {
  return {
    kind: 'answer',
    text,
    citations: [],
    artifacts: [],
    confidence: {
      groundedness: 1,
      stability: 1,
      review: 1,
      numericalConsistency: 1,
      overall: 1,
    },
  } as unknown as BrainDecision;
}

function req(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'th',
    userMessage: 'hi',
    scope: TENANT,
    tier: 'property',
    stakes: 'low',
    surface: 'estate-manager-app',
    ...over,
  };
}

describe('classifyIntent', () => {
  const cases: ReadonlyArray<readonly [string, CacheIntent]> = [
    ['hi', 'greeting'],
    ['Hello', 'greeting'],
    ['hey', 'greeting'],
    ['habari', 'greeting'],
    ['Jambo', 'greeting'],
    ['mambo!', 'greeting'],
    ['hujambo', 'greeting'],
    ['salama', 'greeting'],
    ['shikamoo', 'greeting'],
    ['good morning', 'greeting'],
    ['Good Afternoon', 'greeting'],
    ['thanks', 'acknowledgment'],
    ['asante sana', 'acknowledgment'],
    ['nashukuru', 'acknowledgment'],
    ['ok', 'acknowledgment'],
    ['noted', 'acknowledgment'],
    ['bye', 'farewell'],
    ['kwaheri', 'farewell'],
    ['tutaonana', 'farewell'],
    ['what is Borjie?', 'platform_intro'],
    ['Who are you?', 'platform_intro'],
    ['what can you do', 'platform_intro'],
    ['Send a notice to tenant 12', 'command'],
    ['please file the MRI return', 'command'],
    ['Approve the payment plan', 'command'],
    ['How is collection trending?', 'question'],
    ['What is the arrears total for Q1?', 'question'],
  ];
  for (const [msg, intent] of cases) {
    it(`"${msg}" → ${intent}`, () => {
      expect(classifyIntent(msg).intent).toBe(intent);
    });
  }
});

describe('cacheKeyForRequest — pattern family', () => {
  it('English and Swahili greetings collapse to one key per user', () => {
    const hi = cacheKeyForRequest(req({ userMessage: 'hi' }));
    const habari = cacheKeyForRequest(req({ userMessage: 'habari' }));
    const jambo = cacheKeyForRequest(req({ userMessage: 'jambo' }));
    expect(hi.intent).toBe('greeting');
    expect(habari.intent).toBe('greeting');
    expect(jambo.intent).toBe('greeting');
    expect(hi.key).toBe(habari.key);
    expect(hi.key).toBe(jambo.key);
  });

  it('greetings from different users do NOT share a key (no cross-user bleed)', () => {
    const alice = cacheKeyForRequest(
      req({ scope: { ...TENANT, actorUserId: 'u_alice' } }),
    );
    const bob = cacheKeyForRequest(
      req({ scope: { ...TENANT, actorUserId: 'u_bob' } }),
    );
    expect(alice.key).not.toBe(bob.key);
  });

  it('greetings from different TENANTS do NOT share a key', () => {
    const t1 = cacheKeyForRequest(req());
    const t2 = cacheKeyForRequest(
      req({ scope: { ...TENANT, tenantId: 't_2' } }),
    );
    expect(t1.key).not.toBe(t2.key);
  });

  it('questions key on the full message hash (no pattern family)', () => {
    const a = cacheKeyForRequest(req({ userMessage: 'how is collection?' }));
    const b = cacheKeyForRequest(req({ userMessage: 'how is occupancy?' }));
    expect(a.intent).toBe('question');
    expect(b.intent).toBe('question');
    expect(a.key).not.toBe(b.key);
  });

  it('returns the intent-tiered TTL alongside the key', () => {
    const greeting = cacheKeyForRequest(req({ userMessage: 'hi' }));
    expect(greeting.ttlMs).toBe(DEFAULT_INTENT_TTL_MS.greeting);

    const question = cacheKeyForRequest(
      req({ userMessage: 'how is collection?' }),
    );
    expect(question.ttlMs).toBe(DEFAULT_INTENT_TTL_MS.question);

    const command = cacheKeyForRequest(
      req({ userMessage: 'send a notice to tenant 12' }),
    );
    expect(command.ttlMs).toBe(0);
  });
});

describe('brain cache — intent-tiered TTL via set(key, value, ttl)', () => {
  it('greeting TTL outlasts a question TTL', () => {
    let now = 0;
    const cache = createBrainCache({ ttlMs: 60_000, clock: () => now });
    cache.set('greeting-key', decision('hello'), DEFAULT_INTENT_TTL_MS.greeting);
    cache.set('question-key', decision('answer'), DEFAULT_INTENT_TTL_MS.question);
    now += 90_000; // 1.5 min — question expires, greeting still alive
    expect(cache.get('question-key')).toBeNull();
    expect(cache.get('greeting-key')).not.toBeNull();
  });

  it('ttl of 0 means do NOT cache', () => {
    const cache = createBrainCache();
    cache.set('cmd-key', decision('done'), 0);
    expect(cache.get('cmd-key')).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('default TTL still applies when no override is passed', () => {
    let now = 0;
    const cache = createBrainCache({ ttlMs: 100, clock: () => now });
    cache.set('k', decision('x'));
    now = 50;
    expect(cache.get('k')).not.toBeNull();
    now = 200;
    expect(cache.get('k')).toBeNull();
  });
});
