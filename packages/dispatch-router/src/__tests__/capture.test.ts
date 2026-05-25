/**
 * Capture hook tests — entity dedup, hallucination prevention, dedup,
 * confidence math, nudge emission, latency budget, refusal rejection.
 */

import { describe, it, expect } from 'vitest';
import { capture, computeExchangeHash } from '../capture.js';
import { createInMemoryAuditChainSink } from '../audit-link.js';
import { createInMemoryCanonicalResolver } from '../canonical-resolver.js';
import { createIntentClassifier } from '../intent-classifier.js';
import {
  createInMemoryCaptureStore,
  createInMemoryEventLogStore,
} from '../store.js';
import type { PersonaContext } from '../types.js';

function setup(extra: { tenantTrust?: number } = {}) {
  const captureStore = createInMemoryCaptureStore();
  const eventLog = createInMemoryEventLogStore();
  const auditSink = createInMemoryAuditChainSink();
  const { store: resolverStore, resolver } = createInMemoryCanonicalResolver();
  const classifier = createIntentClassifier({ disableCache: true });

  // Seed canonical entities.
  resolverStore.add({
    tenant_id: 'trc',
    type: 'customer',
    canonical_id: 'cust_juma_x',
    canonical_name: 'Juma',
  });
  resolverStore.add({
    tenant_id: 'trc',
    type: 'unit',
    canonical_id: 'u_godown_3',
    canonical_name: 'godown 3',
  });

  let counter = 0;
  const randomId = () => `id_${++counter}`;
  const clock = () => new Date('2026-05-22T10:00:00Z');

  const persona: PersonaContext = {
    persona_id: 'trc-emu-officer',
    tier: 2,
    jurisdiction: 'TZ',
  };

  return {
    captureStore,
    eventLog,
    auditSink,
    resolver,
    classifier,
    randomId,
    clock,
    persona,
    extra,
  };
}

describe('capture()', () => {
  it('inserts a capture row with resolved entities', async () => {
    const env = setup();
    const result = await capture(
      {
        tenant_id: 'trc',
        persona: env.persona,
        user_text: 'Mr Juma wants to lease godown 3 for 350k/month from Jan',
        assistant_text:
          'I will start a lease application for Mr Juma in godown 3.',
        decision_kind: 'answer',
      },
      env,
    );
    expect(result.capture.entities.length).toBeGreaterThanOrEqual(2);
    const customer = result.capture.entities.find((e) => e.type === 'customer');
    expect(customer?.canonical_id).toBe('cust_juma_x');
    const unit = result.capture.entities.find((e) => e.type === 'unit');
    expect(unit?.canonical_id).toBe('u_godown_3');
  });

  it('drops entities that fail canonical resolution (no hallucination)', async () => {
    const env = setup();
    const result = await capture(
      {
        tenant_id: 'trc',
        persona: env.persona,
        user_text: 'Mr Hallucination wants to lease unicorn 99',
        assistant_text: 'OK',
        decision_kind: 'answer',
      },
      env,
    );
    // Neither "Hallucination" nor "unicorn 99" is in the resolver store.
    expect(result.capture.entities.length).toBe(0);
  });

  it('emits a proactive_nudge when confidence below threshold', async () => {
    const env = setup();
    const result = await capture(
      {
        tenant_id: 'trc',
        persona: env.persona,
        user_text: 'Mr Hallucination wants to lease unicorn 99',
        assistant_text: 'OK',
        decision_kind: 'answer',
      },
      env,
    );
    expect(result.shouldDispatch).toBe(false);
    const nudges = env.eventLog
      .snapshot()
      .filter((e) => e.event_kind === 'proactive_nudge');
    expect(nudges.length).toBe(1);
  });

  it('deduplicates by exchange_hash', async () => {
    const env = setup();
    const args = {
      tenant_id: 'trc',
      persona: env.persona,
      user_text: 'Mr Juma wants to lease godown 3',
      assistant_text: 'OK',
      decision_kind: 'answer' as const,
    };
    const first = await capture(args, env);
    const second = await capture(args, env);
    expect(second.deduplicated).toBe(true);
    expect(second.capture.id).toBe(first.capture.id);
  });

  it('confidence = min(resolver, intent, persona_trust, tenant_trust)', async () => {
    const env = setup();
    const result = await capture(
      {
        tenant_id: 'trc',
        persona: { ...env.persona, tier: 5 }, // tier 5 has trust 0.4
        user_text: 'Mr Juma wants to lease godown 3 for 350k',
        assistant_text: 'OK',
        decision_kind: 'answer',
        tenant_trust: 0.9,
      },
      env,
    );
    // Persona trust is the floor at 0.4 for T5.
    expect(result.capture.capture_confidence).toBeLessThanOrEqual(0.4);
  });

  it('records latency_ms ≥ 0', async () => {
    const env = setup();
    const result = await capture(
      {
        tenant_id: 'trc',
        persona: env.persona,
        user_text: 'Mr Juma wants to lease godown 3',
        assistant_text: 'OK',
        decision_kind: 'answer',
      },
      env,
    );
    expect(result.capture.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('writes a capture_emitted event to the event log', async () => {
    const env = setup();
    await capture(
      {
        tenant_id: 'trc',
        persona: env.persona,
        user_text: 'Mr Juma wants to lease godown 3',
        assistant_text: 'OK',
        decision_kind: 'answer',
      },
      env,
    );
    const events = env.eventLog
      .snapshot()
      .filter((e) => e.event_kind === 'capture_emitted');
    expect(events.length).toBe(1);
  });

  it('hash-chains an audit row per capture', async () => {
    const env = setup();
    await capture(
      {
        tenant_id: 'trc',
        persona: env.persona,
        user_text: 'Mr Juma wants to lease godown 3',
        assistant_text: 'OK',
        decision_kind: 'answer',
      },
      env,
    );
    const chain = env.auditSink.snapshot('trc');
    expect(chain.length).toBe(1);
    expect(chain[0]?.action).toBe('capture_emitted');
  });

  it('refuses to capture refused/softened decisions on invariant', async () => {
    const env = setup();
    await expect(
      capture(
        {
          tenant_id: 'trc',
          persona: env.persona,
          user_text: 'X',
          assistant_text: 'Y',
          // @ts-expect-error — intentionally bad
          decision_kind: 'refusal',
        },
        env,
      ),
    ).rejects.toThrow(/capture invariant/);
  });

  it('captures softened decisions', async () => {
    const env = setup();
    const result = await capture(
      {
        tenant_id: 'trc',
        persona: env.persona,
        user_text: 'Mr Juma wants to lease godown 3',
        assistant_text: 'I will tentatively start the application.',
        decision_kind: 'softened',
      },
      env,
    );
    expect(result.capture.decision_kind).toBe('softened');
  });

  it('cross-tenant isolation: tenant B sees no t1 captures', async () => {
    const env = setup();
    await capture(
      {
        tenant_id: 'trc',
        persona: env.persona,
        user_text: 'Mr Juma wants to lease godown 3',
        assistant_text: 'OK',
        decision_kind: 'answer',
      },
      env,
    );
    const otherTenantCaptures = await env.captureStore.listByTenant('other');
    expect(otherTenantCaptures.length).toBe(0);
  });
});

describe('computeExchangeHash', () => {
  it('is deterministic', () => {
    const a = computeExchangeHash('hello', 'world');
    const b = computeExchangeHash('hello', 'world');
    expect(a).toBe(b);
  });

  it('differs across content', () => {
    expect(computeExchangeHash('a', 'b')).not.toBe(
      computeExchangeHash('a', 'c'),
    );
  });
});
