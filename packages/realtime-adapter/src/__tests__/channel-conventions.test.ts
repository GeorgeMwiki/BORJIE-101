/**
 * Tests for channel naming conventions.
 */

import { describe, it, expect } from 'vitest';
import {
  tenantChannelName,
  parseTenantChannel,
  REALTIME_TOPICS,
} from '../types.js';

describe('tenantChannelName', () => {
  it('formats as tenant.<id>.<topic>', () => {
    expect(tenantChannelName('t1', 'leases')).toBe('tenant.t1.leases');
  });

  it('rejects tenantId containing dots', () => {
    expect(() => tenantChannelName('t.1', 'leases')).toThrow();
  });

  it('rejects empty tenantId', () => {
    expect(() => tenantChannelName('', 'leases')).toThrow();
  });
});

describe('parseTenantChannel', () => {
  it('parses a canonical channel name', () => {
    expect(parseTenantChannel('tenant.tx.maintenance')).toEqual({
      tenantId: 'tx',
      topic: 'maintenance',
    });
  });

  it('returns null for non-tenant channels', () => {
    expect(parseTenantChannel('global.events.created')).toBeNull();
  });

  it('returns null for unknown topic', () => {
    expect(parseTenantChannel('tenant.tx.unknown')).toBeNull();
  });

  it('returns null for malformed (wrong segment count)', () => {
    expect(parseTenantChannel('tenant.tx')).toBeNull();
    expect(parseTenantChannel('tenant.tx.leases.extra')).toBeNull();
  });
});

describe('REALTIME_TOPICS', () => {
  it('contains all seven topics in canonical order', () => {
    expect(REALTIME_TOPICS).toEqual([
      'leases',
      'maintenance',
      'payments',
      'applications',
      'tabs-updated',
      'reports-generated',
      'field-captures',
    ]);
  });
});
