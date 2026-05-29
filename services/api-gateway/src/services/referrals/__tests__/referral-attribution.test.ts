/**
 * R37 — referral attribution MVP tests.
 *
 * Eight tests covering: code parsing precedence, normalisation,
 * idempotency on tenantId, window math, source labelling, and the
 * listByReferrer aggregation.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  attributeSignup,
  buildAttribution,
  InProcessReferralAttributionStore,
  normaliseReferralCode,
  parseReferralCode,
} from '../referral-attribution';

const store = new InProcessReferralAttributionStore();
afterEach(() => store.clear());

describe('normaliseReferralCode', () => {
  it('rejects empty / null / too-short codes', () => {
    expect(normaliseReferralCode(null)).toBeNull();
    expect(normaliseReferralCode('')).toBeNull();
    expect(normaliseReferralCode('abc')).toBeNull();
  });

  it('accepts valid codes and lowercases them', () => {
    expect(normaliseReferralCode('MWIKILA-2026')).toBe('mwikila-2026');
    expect(normaliseReferralCode('ref_X3_42')).toBe('ref_x3_42');
  });
});

describe('parseReferralCode', () => {
  it('prefers query over header over cookie', () => {
    const result = parseReferralCode({
      query: { ref: 'QQQQ' },
      headers: { 'borjie-referral-code': 'HHHH' },
      cookies: { borjie_ref: 'CCCC' },
    });
    expect(result?.source).toBe('query');
    expect(result?.code).toBe('qqqq');
  });

  it('falls back to header when query absent', () => {
    const result = parseReferralCode({
      headers: { 'borjie-referral-code': 'HHHH' },
      cookies: { borjie_ref: 'CCCC' },
    });
    expect(result?.source).toBe('header');
    expect(result?.code).toBe('hhhh');
  });

  it('falls back to cookie when neither query nor header set', () => {
    const result = parseReferralCode({
      cookies: { borjie_ref: 'CCCC' },
    });
    expect(result?.source).toBe('cookie');
    expect(result?.code).toBe('cccc');
  });

  it('returns null when all sources empty', () => {
    expect(parseReferralCode({})).toBeNull();
  });
});

describe('buildAttribution', () => {
  it('sets the window to 90 days from "now"', () => {
    const fixed = new Date('2026-05-29T00:00:00.000Z');
    const env = buildAttribution({
      tenantId: 't',
      referrerCode: 'r',
      source: 'query',
      now: () => fixed,
    });
    expect(env.attributedAt).toBe('2026-05-29T00:00:00.000Z');
    expect(env.windowEndsAt).toBe('2026-08-27T00:00:00.000Z');
  });
});

describe('attributeSignup', () => {
  it('records when a referral code is present', async () => {
    const env = await attributeSignup(
      'tenant-1',
      { query: { ref: 'MWIKILA' } },
      store,
    );
    expect(env).not.toBeNull();
    expect(env?.referrerCode).toBe('mwikila');
    expect(env?.source).toBe('query');
    const read = await store.read('tenant-1');
    expect(read?.referrerCode).toBe('mwikila');
  });

  it('returns null when no referral code is present', async () => {
    const env = await attributeSignup('tenant-2', {}, store);
    expect(env).toBeNull();
    expect(await store.read('tenant-2')).toBeNull();
  });

  it('is idempotent on tenantId — repeated calls do NOT overwrite', async () => {
    await attributeSignup('tenant-3', { query: { ref: 'FIRST' } }, store);
    const second = await attributeSignup(
      'tenant-3',
      { query: { ref: 'SECOND' } },
      store,
    );
    expect(second?.referrerCode).toBe('first');
    const read = await store.read('tenant-3');
    expect(read?.referrerCode).toBe('first');
  });

  it('aggregates by referrer for the rebate posting', async () => {
    await attributeSignup('tenant-a', { query: { ref: 'MWIKILA' } }, store);
    await attributeSignup('tenant-b', { query: { ref: 'MWIKILA' } }, store);
    await attributeSignup('tenant-c', { query: { ref: 'OTHER' } }, store);
    const mwikilaTenants = await store.listByReferrer('mwikila');
    expect(mwikilaTenants.map((a) => a.tenantId).sort()).toEqual([
      'tenant-a',
      'tenant-b',
    ]);
  });
});
