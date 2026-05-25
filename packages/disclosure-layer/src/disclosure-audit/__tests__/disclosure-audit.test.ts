import { describe, expect, it } from 'vitest';

import { DisclosureTier } from '../../tier-taxonomy/index.js';
import {
  InMemoryDisclosureAuditSink,
  buildDisclosureEvent,
  logDisclosure,
} from '../index.js';

const baseInput = {
  principalId: 'usr_george',
  principalRole: 'tenant-customer',
  principalTier: DisclosureTier.SAFE,
  query: 'what can you do?',
  fieldsReturned: ['featureCatalogue', 'identityAsAI'] as const,
  refusedFields: [] as const,
};

describe('disclosure-audit: buildDisclosureEvent', () => {
  it('returns a frozen event', () => {
    const e = buildDisclosureEvent(baseInput);
    expect(Object.isFrozen(e)).toBe(true);
  });

  it('event id starts with "disc-"', () => {
    const e = buildDisclosureEvent(baseInput);
    expect(e.id.startsWith('disc-')).toBe(true);
  });

  it('ts is a valid ISO 8601 timestamp', () => {
    const e = buildDisclosureEvent(baseInput, 1_700_000_000_000);
    expect(Date.parse(e.ts)).toBe(1_700_000_000_000);
  });

  it('copies fieldsReturned + refusedFields (does not alias caller arrays)', () => {
    const fieldsReturned = ['featureCatalogue'] as const;
    const refused = ['systemPromptText'] as const;
    const e = buildDisclosureEvent({ ...baseInput, fieldsReturned, refusedFields: refused });
    expect(e.fieldsReturned).not.toBe(fieldsReturned);
    expect([...e.fieldsReturned]).toEqual([...fieldsReturned]);
    expect(Object.isFrozen(e.fieldsReturned)).toBe(true);
  });

  it('canaryLeakDetected defaults to false', () => {
    const e = buildDisclosureEvent(baseInput);
    expect(e.canaryLeakDetected).toBe(false);
  });

  it('omits optional fields when not provided', () => {
    const e = buildDisclosureEvent(baseInput);
    expect(e.refusalCategory).toBeUndefined();
    expect(e.euAct50EmittedSurface).toBeUndefined();
  });

  it('includes refusalCategory + EU AI Act surface when provided', () => {
    const e = buildDisclosureEvent({
      ...baseInput,
      refusalCategory: 'system-prompt-leak',
      euAct50EmittedSurface: 'chat',
      canaryLeakDetected: true,
    });
    expect(e.refusalCategory).toBe('system-prompt-leak');
    expect(e.euAct50EmittedSurface).toBe('chat');
    expect(e.canaryLeakDetected).toBe(true);
  });
});

describe('disclosure-audit: InMemoryDisclosureAuditSink (append-only)', () => {
  it('starts empty', () => {
    const sink = new InMemoryDisclosureAuditSink();
    expect(sink.size()).toBe(0);
  });

  it('grows monotonically (append-only)', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent(baseInput));
    expect(sink.size()).toBe(1);
    sink.log(buildDisclosureEvent(baseInput));
    expect(sink.size()).toBe(2);
  });

  it('query returns frozen array', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent(baseInput));
    const r = sink.query();
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('filter by principalId', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent({ ...baseInput, principalId: 'usr_a' }));
    sink.log(buildDisclosureEvent({ ...baseInput, principalId: 'usr_b' }));
    const r = sink.query({ principalId: 'usr_a' });
    expect(r).toHaveLength(1);
    expect(r[0]?.principalId).toBe('usr_a');
  });

  it('filter by principalRole', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent({ ...baseInput, principalRole: 'platform-admin' }));
    sink.log(buildDisclosureEvent(baseInput));
    expect(sink.query({ principalRole: 'platform-admin' })).toHaveLength(1);
  });

  it('filter by refusalCategory', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent({ ...baseInput, refusalCategory: 'system-prompt-leak' }));
    sink.log(buildDisclosureEvent({ ...baseInput, refusalCategory: 'cost-cap' }));
    expect(sink.query({ refusalCategory: 'system-prompt-leak' })).toHaveLength(1);
  });

  it('filter by canaryLeakDetected', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent({ ...baseInput, canaryLeakDetected: true }));
    sink.log(buildDisclosureEvent(baseInput));
    expect(sink.query({ canaryLeakDetected: true })).toHaveLength(1);
  });

  it('filter by fieldName (matches fieldsReturned)', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent({ ...baseInput, fieldsReturned: ['featureCatalogue'] }));
    sink.log(buildDisclosureEvent({ ...baseInput, fieldsReturned: ['identityAsAI'] }));
    expect(sink.query({ fieldName: 'featureCatalogue' })).toHaveLength(1);
  });

  it('filter by fieldName (matches refusedFields)', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent({ ...baseInput, refusedFields: ['systemPromptText'] }));
    sink.log(buildDisclosureEvent(baseInput));
    expect(sink.query({ fieldName: 'systemPromptText' })).toHaveLength(1);
  });

  it('filter by time window (tsFrom inclusive, tsTo exclusive)', () => {
    const sink = new InMemoryDisclosureAuditSink();
    sink.log(buildDisclosureEvent(baseInput, 1000));
    sink.log(buildDisclosureEvent(baseInput, 2000));
    sink.log(buildDisclosureEvent(baseInput, 3000));
    const r = sink.query({ tsFrom: 1500, tsTo: 2500 });
    expect(r).toHaveLength(1);
    expect(Date.parse(r[0]?.ts ?? '')).toBe(2000);
  });
});

describe('disclosure-audit: logDisclosure helper', () => {
  it('writes through to the sink and returns the constructed event', async () => {
    const sink = new InMemoryDisclosureAuditSink();
    const e = await logDisclosure(sink, baseInput);
    expect(sink.size()).toBe(1);
    expect(e.principalId).toBe(baseInput.principalId);
  });
});
