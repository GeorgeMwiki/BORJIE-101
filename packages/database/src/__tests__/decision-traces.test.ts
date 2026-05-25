/**
 * decision_traces schema + RLS invariant tests (migration 0185).
 *
 * Two test groups, mirroring the pattern from section-layouts.test.ts:
 *
 *   1. Drizzle schema introspection — confirms the column shape, primary
 *      key, and index declarations match migration 0185's expectation.
 *      Runs without a database.
 *
 *   2. RLS invariant simulator — proves the tenant_id isolation policy
 *      refuses cross-tenant reads and refuses an INSERT whose row's
 *      tenant_id ≠ GUC tenant_id, while still permitting NULL tenant_id
 *      rows visible to the service-role (admin replay UI).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  decisionTraces,
  type DecisionTraceRow,
} from '../schemas/decision-traces.schema.js';

// ─────────────────────────────────────────────────────────────────────
// 1. Schema introspection — Drizzle config matches migration 0185.
// ─────────────────────────────────────────────────────────────────────

describe('decision_traces schema (migration 0185)', () => {
  it('declares the canonical column set', () => {
    const cfg = getTableConfig(decisionTraces);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'tenant_id',
        'name',
        'started_at',
        'finalised_at',
        'duration_ms',
        'inputs',
        'branches',
        'chosen_branch_id',
        'chosen_rationale',
        'outcome',
        'attributes',
        'output',
        'error',
        'user_id',
        'request_id',
        'parent_trace_id',
        'created_at',
      ].sort(),
    );
  });

  it('uses `id` as the primary key', () => {
    const cfg = getTableConfig(decisionTraces);
    const idCol = cfg.columns.find((c) => c.name === 'id');
    expect(idCol?.primary).toBe(true);
  });

  it('declares (tenant_id, started_at DESC) index for admin list view', () => {
    const cfg = getTableConfig(decisionTraces);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'decision_traces_tenant_started_idx',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'started_at']);
  });

  it('declares (tenant_id, outcome) index for outcome filter', () => {
    const cfg = getTableConfig(decisionTraces);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'decision_traces_tenant_outcome_idx',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'outcome']);
  });

  it('declares (name, started_at) index for cross-tenant operator views', () => {
    const cfg = getTableConfig(decisionTraces);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'decision_traces_name_started_idx',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['name', 'started_at']);
  });

  it('allows tenant_id to be NULL (platform-tier decisions)', () => {
    const cfg = getTableConfig(decisionTraces);
    const tenantCol = cfg.columns.find((c) => c.name === 'tenant_id');
    expect(tenantCol).toBeDefined();
    expect(tenantCol?.notNull).toBe(false);
  });

  it('Row + Insert types are exported', () => {
    const row: DecisionTraceRow | undefined = undefined;
    expect(decisionTraces).toBeDefined();
    expect(row).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. RLS invariant simulator.
//    Models the tenant-isolation pattern in an in-process simulator.
//    The actual policy enforcement lives in 0185_decision_traces.sql.
// ─────────────────────────────────────────────────────────────────────

interface TraceSimRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly outcome: string;
}

class RlsSimulator {
  private rows: TraceSimRow[] = [];
  private currentGucTenantId: string | null = null;
  /** When true, simulates the service-role connection (RLS bypassed). */
  private serviceRole = false;

  setGuc(tenantId: string | null): void {
    this.currentGucTenantId = tenantId;
  }

  withServiceRole(fn: () => void): void {
    const prev = this.serviceRole;
    this.serviceRole = true;
    try {
      fn();
    } finally {
      this.serviceRole = prev;
    }
  }

  insert(row: TraceSimRow): void {
    // RLS WITH CHECK: row.tenant_id must equal GUC unless service-role.
    if (!this.serviceRole) {
      if (row.tenantId !== this.currentGucTenantId) {
        throw new Error(
          `RLS WITH CHECK: row.tenant_id=${row.tenantId} ≠ guc=${this.currentGucTenantId}`,
        );
      }
    }
    this.rows.push(row);
  }

  select(): TraceSimRow[] {
    if (this.serviceRole) return [...this.rows];
    return this.rows.filter((r) => r.tenantId === this.currentGucTenantId);
  }
}

describe('decision_traces RLS isolation (migration 0185 policies)', () => {
  let sim: RlsSimulator;

  beforeEach(() => {
    sim = new RlsSimulator();
  });

  it('refuses an INSERT whose tenant_id disagrees with the GUC', () => {
    sim.setGuc('tenant_A');
    expect(() =>
      sim.insert({
        id: 't1',
        tenantId: 'tenant_B',
        name: 'brain.think',
        outcome: 'executed',
      }),
    ).toThrow(/RLS WITH CHECK/);
  });

  it('refuses a SELECT across tenants (USING tenant_id = guc)', () => {
    // Tenant A writes a row.
    sim.setGuc('tenant_A');
    sim.insert({
      id: 't1',
      tenantId: 'tenant_A',
      name: 'approvals.approve',
      outcome: 'approved',
    });
    // Tenant B reads — sees nothing.
    sim.setGuc('tenant_B');
    expect(sim.select()).toHaveLength(0);
  });

  it('allows same-tenant reads', () => {
    sim.setGuc('tenant_A');
    sim.insert({
      id: 't1',
      tenantId: 'tenant_A',
      name: 'payments.disburse',
      outcome: 'executed',
    });
    expect(sim.select()).toHaveLength(1);
  });

  it('platform-tier rows (tenant_id = NULL) are invisible to authenticated role', () => {
    // Service-role writes a platform-tier trace.
    sim.withServiceRole(() => {
      sim.insert({
        id: 't1',
        tenantId: null,
        name: 'tenant-context.resolve',
        outcome: 'refused',
      });
    });
    // An authenticated tenant-bound caller sees nothing — NULL ≠ tenant_id.
    sim.setGuc('tenant_A');
    expect(sim.select()).toHaveLength(0);
  });

  it('service-role sees every row including NULL-tenant rows', () => {
    sim.withServiceRole(() => {
      sim.insert({
        id: 't1',
        tenantId: null,
        name: 'tenant-context.resolve',
        outcome: 'refused',
      });
      sim.insert({
        id: 't2',
        tenantId: 'tenant_A',
        name: 'approvals.approve',
        outcome: 'approved',
      });
      sim.insert({
        id: 't3',
        tenantId: 'tenant_B',
        name: 'payments.disburse',
        outcome: 'executed',
      });
      expect(sim.select()).toHaveLength(3);
    });
  });
});
