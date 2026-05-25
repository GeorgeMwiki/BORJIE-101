import { describe, expect, it } from 'vitest';
import type { ProfileFragment, UnifyRules } from '../../types.js';
import { currentUnified } from '../current-unified.js';
import { incorporateFragment, unifyProfile } from '../unify.js';

const RULES_MOST_RECENT: UnifyRules = {
  linkThreshold: 0.7,
  resolveScalarsBy: 'most_recent',
};

const RULES_AUTHORITATIVE: UnifyRules = {
  linkThreshold: 0.7,
  resolveScalarsBy: 'authoritative',
  authoritativeOrder: ['supabase_auth', 'stripe_customer', 'conversation', 'crm'],
};

const baseAuth: ProfileFragment = {
  id: 'frag-auth',
  tenantId: 't1',
  source: 'supabase_auth',
  attributes: {
    email: 'jane@example.com',
    fullName: 'Jane Doe',
  },
  capturedAt: '2026-01-15T10:00:00Z',
};

const stripe: ProfileFragment = {
  id: 'frag-stripe',
  tenantId: 't1',
  source: 'stripe_customer',
  attributes: {
    email: 'jane@example.com',
    fullName: 'Jane Doe Smith',
    stripeCustomerId: 'cus_abc',
    country: 'TZ',
  },
  capturedAt: '2026-02-01T10:00:00Z',
};

const mpesa: ProfileFragment = {
  id: 'frag-mpesa',
  tenantId: 't1',
  source: 'mpesa_txn',
  attributes: {
    phone: '+254700111222',
    mpesaMsisdn: '254700111222',
  },
  capturedAt: '2026-03-01T10:00:00Z',
};

describe('unifyProfile — most_recent strategy', () => {
  it('folds 3 fragments into one canonical view', () => {
    const unified = unifyProfile({
      fragments: [baseAuth, stripe, mpesa],
      rules: RULES_MOST_RECENT,
    });
    expect(unified.fragments).toHaveLength(3);
    expect(unified.attributes.email).toBe('jane@example.com');
    expect(unified.attributes.fullName).toBe('Jane Doe Smith');
    expect(unified.attributes.phone).toBe('+254700111222');
    expect(unified.attributeOrigins.fullName).toBe('stripe_customer');
    expect(unified.attributeOrigins.phone).toBe('mpesa_txn');
    expect(unified.lastFragmentAt).toBe('2026-03-01T10:00:00Z');
  });

  it('is deterministic — subjectId is stable across fragment order', () => {
    const a = unifyProfile({
      fragments: [baseAuth, stripe, mpesa],
      rules: RULES_MOST_RECENT,
    });
    const b = unifyProfile({
      fragments: [mpesa, baseAuth, stripe], // shuffled
      rules: RULES_MOST_RECENT,
    });
    expect(b.subjectId).toBe(a.subjectId);
    expect(b.attributes).toEqual(a.attributes);
    expect(b.attributeOrigins).toEqual(a.attributeOrigins);
  });

  it('re-unifies cleanly when a new fragment arrives', () => {
    const initial = unifyProfile({
      fragments: [baseAuth, stripe],
      rules: RULES_MOST_RECENT,
    });
    const re = incorporateFragment({
      existing: initial,
      fragment: mpesa,
      rules: RULES_MOST_RECENT,
    });
    expect(re.fragments).toHaveLength(3);
    expect(re.attributes.phone).toBe('+254700111222');
    expect(re.subjectId).toBe(initial.subjectId);
  });

  it('rejects cross-tenant fragments', () => {
    const otherTenant: ProfileFragment = { ...mpesa, tenantId: 't-other' };
    expect(() =>
      unifyProfile({
        fragments: [baseAuth, otherTenant],
        rules: RULES_MOST_RECENT,
      }),
    ).toThrow();
  });

  it('rejects empty fragment list', () => {
    expect(() =>
      unifyProfile({ fragments: [], rules: RULES_MOST_RECENT }),
    ).toThrow();
  });
});

describe('unifyProfile — authoritative strategy', () => {
  it('prefers higher-ranked sources regardless of recency', () => {
    const unified = unifyProfile({
      fragments: [baseAuth, stripe],
      rules: RULES_AUTHORITATIVE,
    });
    // supabase_auth is rank 0; should win fullName over stripe even
    // though stripe was captured later.
    expect(unified.attributes.fullName).toBe('Jane Doe');
    expect(unified.attributeOrigins.fullName).toBe('supabase_auth');
    // stripe-only fields still appear.
    expect(unified.attributes.stripeCustomerId).toBe('cus_abc');
    expect(unified.attributeOrigins.stripeCustomerId).toBe('stripe_customer');
  });
});

describe('currentUnified', () => {
  it('returns null when there are no fragments', async () => {
    const store = {
      async fragmentsForSubject() {
        return [] as ProfileFragment[];
      },
    };
    const unified = await currentUnified({
      subjectId: 'subj-1',
      tenantId: 't1',
      store,
      rules: RULES_MOST_RECENT,
    });
    expect(unified).toBeNull();
  });

  it('fetches fragments and returns a unified view', async () => {
    const store = {
      async fragmentsForSubject() {
        return [baseAuth, stripe, mpesa] as ProfileFragment[];
      },
    };
    const unified = await currentUnified({
      subjectId: 'subj-1',
      tenantId: 't1',
      store,
      rules: RULES_MOST_RECENT,
    });
    expect(unified).not.toBeNull();
    expect(unified?.fragments).toHaveLength(3);
    expect(unified?.subjectId).toBe('subj-1');
  });
});
