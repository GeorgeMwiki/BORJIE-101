/**
 * Classification tests — auto-tagger + canonicalisation + tokenisation.
 *
 * Live: every assertion exercises real code paths. No mocks.
 */

import { describe, expect, it } from 'vitest';

import {
  CLASSIFICATIONS,
  CLASSIFICATION_PRECEDENCE,
} from '../types.js';
import {
  canonicalise,
  classifyRecord,
  tagField,
  tokeniseValue,
} from '../classify/auto-tagger.js';

describe('classify/auto-tagger', () => {
  it('tags an email field as pii', () => {
    const tags = tagField({ name: 'tenant_email' });
    expect(tags.has('pii')).toBe(true);
  });

  it('tags a medical-screening field as phi', () => {
    const tags = tagField({ name: 'audiometry_screening_id' });
    expect(tags.has('phi')).toBe(true);
  });

  it('tags an iban field as financial', () => {
    const tags = tagField({ name: 'iban' });
    expect(tags.has('financial')).toBe(true);
  });

  it('tags a kill-switch field as critical', () => {
    const tags = tagField({ name: 'kill_switch_state' });
    expect(tags.has('critical')).toBe(true);
  });

  it('canonicalises overlapping tags via precedence', () => {
    const c = canonicalise(new Set(['pii', 'phi', 'financial']));
    // phi beats pii and financial.
    expect(c).toBe('phi');
  });

  it('falls back to internal when no tags match', () => {
    const c = canonicalise(new Set());
    expect(c).toBe('internal');
  });

  it('classifies a multi-field record', () => {
    const result = classifyRecord({
      tenantId: 't_1',
      entityKind: 'worker_profile',
      entityId: 'w_1',
      fields: [
        { name: 'email' },
        { name: 'medical_diagnosis' },
        { name: 'iban' },
      ],
    });
    expect(result.classification).toBe('phi');
    expect(result.tags.has('pii')).toBe(true);
    expect(result.tags.has('phi')).toBe(true);
    expect(result.tags.has('financial')).toBe(true);
    expect(result.auditHash).toHaveLength(64);
  });

  it('produces a deterministic audit hash', () => {
    const a = classifyRecord({
      tenantId: 't_1',
      entityKind: 'k',
      entityId: 'e',
      fields: [{ name: 'email' }],
    });
    const b = classifyRecord({
      tenantId: 't_1',
      entityKind: 'k',
      entityId: 'e',
      fields: [{ name: 'email' }],
    });
    expect(a.auditHash).toBe(b.auditHash);
  });

  it('tokenises a value deterministically per (tenant, field, value)', () => {
    const t1 = tokeniseValue('tenantA', 'email', 'alice@example.com');
    const t2 = tokeniseValue('tenantA', 'email', 'alice@example.com');
    expect(t1).toBe(t2);
  });

  it('separates tokens per tenant — no cross-tenant correlation', () => {
    const a = tokeniseValue('tenantA', 'email', 'alice@example.com');
    const b = tokeniseValue('tenantB', 'email', 'alice@example.com');
    expect(a).not.toBe(b);
  });

  it('precedence list covers every classification exactly once', () => {
    const list = [...CLASSIFICATION_PRECEDENCE];
    const sorted = [...CLASSIFICATIONS].sort();
    expect(list.sort()).toEqual(sorted);
    expect(new Set(list).size).toBe(CLASSIFICATIONS.length);
  });
});
