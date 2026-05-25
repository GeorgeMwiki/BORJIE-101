/**
 * Wave-4 D9 — schema-side verification of query-pattern indexes.
 *
 * The companion migration `0124_wave4_query_indexes.sql` creates
 * matching indexes via `CREATE INDEX IF NOT EXISTS`. These tests
 * pin the Drizzle-side declarations so future schema edits cannot
 * silently drop the indexes the wave-1-3 query patterns rely on.
 *
 * The tests intentionally introspect via `getTableConfig` rather
 * than via SQL — they run without a database and stay fast.
 */

import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { payments, ownerStatements } from '../schemas/payment.schema.js';
import { properties } from '../schemas/property.schema.js';
import { eventOutbox } from '../schemas/outbox.schema.js';
import { notificationDispatchLog } from '../schemas/messaging.schema.js';
import { cases } from '../schemas/cases.schema.js';

function indexNames(table: Parameters<typeof getTableConfig>[0]): readonly string[] {
  return getTableConfig(table).indexes.map((idx) => idx.config.name ?? '');
}

function indexByName(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
) {
  return getTableConfig(table).indexes.find(
    (idx) => idx.config.name === name,
  );
}

describe('wave-4 D9: query-pattern indexes', () => {
  it('payments declares (tenant_id, completed_at) for monthly-close period scans', () => {
    const idx = indexByName(payments, 'payments_tenant_completed_at_idx');
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'completed_at']);
  });

  it('payments declares (tenant_id, created_at) for predictive-interventions trailing-window', () => {
    const idx = indexByName(payments, 'payments_tenant_created_at_idx');
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'created_at']);
  });

  it('properties declares (tenant_id, owner_id) for owner-scoped joins', () => {
    const idx = indexByName(properties, 'properties_tenant_owner_idx');
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'owner_id']);
  });

  it('owner_statements declares (tenant_id, status, period_start) for pdf-renderer drain', () => {
    const idx = indexByName(
      ownerStatements,
      'owner_statements_tenant_status_period_idx',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'status', 'period_start']);
  });

  it('event_outbox declares (event_type, status, created_at) for payouts-worker picker', () => {
    const idx = indexByName(
      eventOutbox,
      'event_outbox_event_type_status_created_idx',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['event_type', 'status', 'created_at']);
  });

  it('notification_dispatch_log declares (tenant_id, delivery_status, created_at) for SKIP-LOCKED claim', () => {
    const idx = indexByName(
      notificationDispatchLog,
      'notification_dispatch_log_tenant_status_created_idx',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'delivery_status', 'created_at']);
  });

  it('cases declares (tenant_id, case_type, created_at) for disputes-90d aggregation', () => {
    const idx = indexByName(cases, 'cases_tenant_type_created_idx');
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'case_type', 'created_at']);
  });

  it('all wave-4 D9 index names appear in their respective tables (no typos in declarations)', () => {
    expect(indexNames(payments)).toEqual(
      expect.arrayContaining([
        'payments_tenant_completed_at_idx',
        'payments_tenant_created_at_idx',
      ]),
    );
    expect(indexNames(properties)).toEqual(
      expect.arrayContaining(['properties_tenant_owner_idx']),
    );
    expect(indexNames(ownerStatements)).toEqual(
      expect.arrayContaining(['owner_statements_tenant_status_period_idx']),
    );
    expect(indexNames(eventOutbox)).toEqual(
      expect.arrayContaining(['event_outbox_event_type_status_created_idx']),
    );
    expect(indexNames(notificationDispatchLog)).toEqual(
      expect.arrayContaining([
        'notification_dispatch_log_tenant_status_created_idx',
      ]),
    );
    expect(indexNames(cases)).toEqual(
      expect.arrayContaining(['cases_tenant_type_created_idx']),
    );
  });
});
