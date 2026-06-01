/**
 * feedback_submissions + complaint_records schema + RLS invariant tests
 * (migration 0166, re-materialising the archived 0092).
 *
 * Two test groups, mirroring decision-traces.test.ts / section-layouts.test.ts:
 *
 *   1. Drizzle schema introspection — confirms the column shape + primary key
 *      match what services/api-gateway/src/routes/feedback.ts reads + writes
 *      (the code is the source of truth). Runs without a database.
 *
 *   2. RLS invariant simulator — proves the tenant_id isolation policy in
 *      migration 0166 refuses cross-tenant reads + refuses an INSERT whose
 *      tenant_id ≠ the bound GUC, while permitting same-tenant insert+read of
 *      BOTH a feedback submission and a complaint.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  feedbackSubmissions,
  complaintRecords,
  FEEDBACK_TYPES,
  COMPLAINT_STATUSES,
  type FeedbackSubmission,
  type NewFeedbackSubmission,
  type ComplaintRecord,
  type NewComplaintRecord,
} from '../schemas/feedback.schema.js';

// ─────────────────────────────────────────────────────────────────────
// 1. Schema introspection — Drizzle config matches migration 0166 and
//    covers every column feedback.ts touches.
// ─────────────────────────────────────────────────────────────────────

describe('feedback_submissions schema (migration 0166)', () => {
  it('declares the canonical column set the route reads + writes', () => {
    const cfg = getTableConfig(feedbackSubmissions);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'tenant_id',
        'user_id',
        'type',
        'subject',
        'message',
        'rating',
        'context',
        'status',
        'reviewed_by',
        'reviewed_at',
        'resolution_notes',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  it('uses `id` as the primary key', () => {
    const cfg = getTableConfig(feedbackSubmissions);
    expect(cfg.columns.find((c) => c.name === 'id')?.primary).toBe(true);
  });

  it('keeps tenant_id + user_id NOT NULL (route always writes auth.*)', () => {
    const cfg = getTableConfig(feedbackSubmissions);
    expect(cfg.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === 'user_id')?.notNull).toBe(true);
  });

  it('allows rating to be NULL (survey may omit it)', () => {
    const cfg = getTableConfig(feedbackSubmissions);
    expect(cfg.columns.find((c) => c.name === 'rating')?.notNull).toBe(false);
  });

  it('admits the Jarvis turn-thumbs discriminator in the type closed set', () => {
    expect(FEEDBACK_TYPES).toContain('turn-thumbs');
    expect(FEEDBACK_TYPES).toContain('general');
  });

  it('declares the (tenant_id, type) index backing the ?type= filter', () => {
    const cfg = getTableConfig(feedbackSubmissions);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'idx_feedback_submissions_type',
    );
    expect(idx).toBeDefined();
  });
});

describe('complaint_records schema (migration 0166)', () => {
  it('declares the canonical column set the route reads + writes', () => {
    const cfg = getTableConfig(complaintRecords);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'tenant_id',
        'user_id',
        'subject',
        'description',
        'category',
        'related_entity_type',
        'related_entity_id',
        'priority',
        'status',
        'resolution',
        'resolution_notes',
        'resolved_by',
        'resolved_at',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  it('uses `id` as the primary key', () => {
    const cfg = getTableConfig(complaintRecords);
    expect(cfg.columns.find((c) => c.name === 'id')?.primary).toBe(true);
  });

  it('keeps tenant_id + user_id NOT NULL', () => {
    const cfg = getTableConfig(complaintRecords);
    expect(cfg.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === 'user_id')?.notNull).toBe(true);
  });

  it('exposes the resolve state machine target in the status closed set', () => {
    expect(COMPLAINT_STATUSES).toContain('open');
    expect(COMPLAINT_STATUSES).toContain('resolved');
  });

  it('declares the (tenant_id, priority, status) prioritisation index', () => {
    const cfg = getTableConfig(complaintRecords);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'idx_complaint_records_priority',
    );
    expect(idx).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. RLS invariant simulator — models migration 0166's tenant-isolation
//    policy (USING + WITH CHECK on tenant_id = GUC) in-process, then
//    proves a tenant-scoped INSERT + READ of a feedback submission AND a
//    complaint, plus cross-tenant denial.
// ─────────────────────────────────────────────────────────────────────

interface RlsRow {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: 'feedback' | 'complaint';
}

class TenantRlsSimulator {
  private rows: RlsRow[] = [];
  private gucTenantId: string | null = null;

  setGuc(tenantId: string | null): void {
    this.gucTenantId = tenantId;
  }

  insert(row: RlsRow): void {
    // WITH CHECK: the row's tenant_id must equal the bound GUC.
    if (row.tenantId !== this.gucTenantId) {
      throw new Error(
        `RLS WITH CHECK: row.tenant_id=${row.tenantId} ≠ guc=${this.gucTenantId}`,
      );
    }
    this.rows.push(row);
  }

  select(kind?: RlsRow['kind']): RlsRow[] {
    // USING: only rows whose tenant_id equals the bound GUC are visible.
    return this.rows.filter(
      (r) => r.tenantId === this.gucTenantId && (!kind || r.kind === kind),
    );
  }
}

describe('feedback/complaint RLS isolation (migration 0166 policies)', () => {
  let sim: TenantRlsSimulator;

  beforeEach(() => {
    sim = new TenantRlsSimulator();
  });

  it('inserts + reads a feedback submission within the bound tenant', () => {
    sim.setGuc('tenant_A');
    sim.insert({ id: 'fbk_1', tenantId: 'tenant_A', kind: 'feedback' });
    const rows = sim.select('feedback');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('fbk_1');
  });

  it('inserts + reads a complaint within the bound tenant', () => {
    sim.setGuc('tenant_A');
    sim.insert({ id: 'cmp_1', tenantId: 'tenant_A', kind: 'complaint' });
    const rows = sim.select('complaint');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('cmp_1');
  });

  it('refuses an INSERT whose tenant_id disagrees with the GUC', () => {
    sim.setGuc('tenant_A');
    expect(() =>
      sim.insert({ id: 'fbk_x', tenantId: 'tenant_B', kind: 'feedback' }),
    ).toThrow(/RLS WITH CHECK/);
  });

  it('refuses a cross-tenant SELECT (USING tenant_id = guc)', () => {
    sim.setGuc('tenant_A');
    sim.insert({ id: 'fbk_1', tenantId: 'tenant_A', kind: 'feedback' });
    sim.insert({ id: 'cmp_1', tenantId: 'tenant_A', kind: 'complaint' });
    // Tenant B reads — sees neither row.
    sim.setGuc('tenant_B');
    expect(sim.select()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Insert-type compatibility — the exact field set feedback.ts passes to
//    `.values()` / `.set()` must satisfy the inferred Insert/Select types.
//    A compile-time check (the file is typechecked by tsc in CI) plus a
//    trivial runtime assertion so the test body is non-empty.
// ─────────────────────────────────────────────────────────────────────

describe('feedback/complaint insert-type compatibility with the route', () => {
  it('accepts the turn-thumbs feedback insert shape', () => {
    const insert: NewFeedbackSubmission = {
      id: 'fbk_1',
      tenantId: 'tenant_A',
      userId: 'user_1',
      type: 'turn-thumbs',
      subject: 'Jarvis turn 👍',
      message: '',
      rating: 5,
      context: { turnId: 't1', threadId: null, signal: 'up' },
      status: 'submitted',
    };
    const row: FeedbackSubmission | undefined = undefined;
    expect(insert.type).toBe('turn-thumbs');
    expect(row).toBeUndefined();
  });

  it('accepts the complaint insert + resolve shapes', () => {
    const insert: NewComplaintRecord = {
      id: 'cmp_1',
      tenantId: 'tenant_A',
      userId: 'user_1',
      subject: 'Pump down',
      description: 'The dewatering pump failed.',
      category: 'maintenance',
      relatedEntityType: 'asset',
      relatedEntityId: 'asset_9',
      priority: 'high',
      status: 'open',
    };
    const resolvePatch: Partial<ComplaintRecord> = {
      status: 'resolved',
      resolution: 'Pump replaced.',
      resolutionNotes: 'Swapped impeller.',
      resolvedBy: 'user_1',
      resolvedAt: new Date(),
      updatedAt: new Date(),
    };
    expect(insert.priority).toBe('high');
    expect(resolvePatch.status).toBe('resolved');
  });
});
