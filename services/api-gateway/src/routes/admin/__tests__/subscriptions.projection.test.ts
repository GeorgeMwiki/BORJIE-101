/**
 * Unit tests for the admin-subscriptions projection — the read-side that maps a
 * `tenants` ⟕ `tenant_subscriptions` row onto the admin Subscription DTO.
 *
 * Guards the money-display correctness that matters most:
 *   - BIGINT minor units → MAJOR units (the 100× risk) — incl. string bigints.
 *   - authoritative subscription status wins; tenant lifecycle is the fallback.
 *   - 0 MRR (never fabricated) when there is no active subscription.
 */

import { describe, it, expect } from 'vitest';
import { projectSubscription } from '../subscriptions.hono';

describe('admin-subscriptions projectSubscription', () => {
  it('converts BIGINT minor units to major units for the client formatter', () => {
    const dto = projectSubscription({
      id: 't1',
      name: 'Demo Mining Estate',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      sub_status: 'active',
      sub_mrr_minor_units: 500000, // 5,000.00 major
      sub_currency: 'TZS',
      sub_plan: 'mkulima',
    });
    expect(dto.mrr).toBe(5000);
    expect(dto.currency).toBe('TZS');
    expect(dto.status).toBe('active');
    expect(dto.plan).toBe('mkulima');
  });

  it('handles a bigint returned as a string (pg driver) without 100x error', () => {
    const dto = projectSubscription({
      id: 't2',
      name: 'X',
      sub_status: 'past_due',
      sub_mrr_minor_units: '1234500', // string bigint → 12,345.00
      sub_currency: 'USD',
    });
    expect(dto.mrr).toBe(12345);
    expect(dto.status).toBe('past_due');
  });

  it('maps the subscription status vocabulary onto the billing vocabulary', () => {
    const base = { id: 't', name: 'N', created_at: '2026-01-01T00:00:00Z' };
    expect(projectSubscription({ ...base, sub_status: 'cancelled' }).status).toBe('canceled');
    expect(projectSubscription({ ...base, sub_status: 'unpaid' }).status).toBe('past_due');
    expect(projectSubscription({ ...base, sub_status: 'trialing' }).status).toBe('trialing');
  });

  it('falls back to the tenant lifecycle status + 0 MRR when no active subscription', () => {
    const dto = projectSubscription({
      id: 't3',
      name: 'No-sub tenant',
      status: 'suspended', // tenant lifecycle → past_due
      created_at: '2026-02-02T00:00:00.000Z',
      // no sub_* fields (LEFT JOIN miss)
    });
    expect(dto.mrr).toBe(0); // never fabricated
    expect(dto.status).toBe('past_due');
    expect(dto.currency).toBe('USD'); // safe default
    expect(dto.plan).toBe('starter');
  });

  it("an 'unknown' subscription status defers to the tenant lifecycle status", () => {
    const dto = projectSubscription({
      id: 't4',
      name: 'N',
      status: 'active',
      sub_status: 'unknown',
      sub_mrr_minor_units: 0,
      sub_currency: 'KES',
    });
    expect(dto.status).toBe('active'); // from tenant, not 'unknown'
    expect(dto.mrr).toBe(0);
  });
});
