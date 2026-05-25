/**
 * Tests for the Cases SLA multi-tenant supervisor.
 *
 * These exercise the Wave-26 wiring: a registry with a real-ish
 * `cases.service` + `cases.repo` + `db` is passed in, the supervisor
 * ticks once, and we assert that for each active tenant the worker
 * calls `findOverdue(tenantId)` → escalates or breaches via the
 * injected service + event bus.
 *
 * No timers are exercised (we drive `tickOnce` directly) and no real
 * database is touched — the `db.execute` shim returns a static tenants
 * list and the cases repo is a fake that returns a deterministic
 * overdue case per tenant.
 */

import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { createCaseSLASupervisor } from '../workers/cases-sla-supervisor';
import type { ServiceRegistry } from '../composition/service-registry';

function buildFakeRegistry(opts: {
  readonly activeTenants: readonly string[];
  readonly overdueByTenant: Record<string, readonly { id: string; escalationLevel: number; caseNumber: string }[]>;
}): { registry: ServiceRegistry; escalatedIds: string[]; publishedEventTypes: string[] } {
  const escalatedIds: string[] = [];
  const publishedEventTypes: string[] = [];

  const caseRepo = {
    async findOverdue(tenantId: string) {
      return (opts.overdueByTenant[tenantId] ?? []).map((c) => ({
        id: c.id,
        tenantId,
        caseNumber: c.caseNumber,
        type: 'OTHER',
        severity: 'MEDIUM',
        status: 'OPEN',
        title: 't',
        description: 'd',
        customerId: 'c1',
        timeline: [],
        notices: [],
        evidence: [],
        escalationLevel: c.escalationLevel,
        createdAt: new Date().toISOString(),
        createdBy: 'u1',
        updatedAt: new Date().toISOString(),
        updatedBy: 'u1',
      }));
    },
  };

  const caseService = {
    async escalateCase(caseId: string) {
      escalatedIds.push(caseId);
      return { success: true, value: { id: caseId } };
    },
  };

  const eventBus = {
    async publish(envelope: { event: { eventType: string } }) {
      publishedEventTypes.push(envelope.event.eventType);
    },
    subscribe: () => () => undefined,
  };

  const db = {
    async execute() {
      // Return the tenants-list rows shape the supervisor's
      // `listActiveTenants` reads via `rows.map(r => r.id)`.
      return opts.activeTenants.map((id) => ({ id }));
    },
  };

  const registry = {
    isLive: true,
    db,
    eventBus,
    cases: { service: caseService, repo: caseRepo },
  } as unknown as ServiceRegistry;

  return { registry, escalatedIds, publishedEventTypes };
}

describe('cases-sla-supervisor', () => {
  const logger = pino({ level: 'silent' });

  it('ticks per active tenant, escalating overdue cases below the max level', async () => {
    const { registry, escalatedIds } = buildFakeRegistry({
      activeTenants: ['t1', 't2'],
      overdueByTenant: {
        t1: [{ id: 'case_a', escalationLevel: 0, caseNumber: 'CASE-1' }],
        t2: [{ id: 'case_b', escalationLevel: 1, caseNumber: 'CASE-2' }],
      },
    });

    const sup = createCaseSLASupervisor(registry, logger, {
      enabled: true,
      intervalMs: 60_000,
    });
    await sup.tickOnce();

    expect(escalatedIds).toEqual(['case_a', 'case_b']);
    sup.stop();
  });

  it('emits CaseSLABreached once escalation ceiling is hit', async () => {
    const { registry, publishedEventTypes } = buildFakeRegistry({
      activeTenants: ['t1'],
      overdueByTenant: {
        t1: [{ id: 'case_max', escalationLevel: 3, caseNumber: 'CASE-MAX' }],
      },
    });

    const sup = createCaseSLASupervisor(registry, logger, {
      enabled: true,
      intervalMs: 60_000,
    });
    await sup.tickOnce();

    expect(publishedEventTypes).toContain('CaseSLABreached');
    sup.stop();
  });

  it('is a no-op in degraded mode', async () => {
    const degradedRegistry = {
      isLive: false,
      db: null,
      eventBus: { publish: vi.fn(), subscribe: () => () => undefined },
      cases: { service: null, repo: null },
    } as unknown as ServiceRegistry;

    const sup = createCaseSLASupervisor(degradedRegistry, logger, {
      enabled: true,
    });
    await sup.tickOnce();
    sup.start();
    sup.stop();
    // No throw = pass. No publishes either.
    expect(degradedRegistry.eventBus.publish).not.toHaveBeenCalled();
  });

  it('is disabled when options.enabled=false', async () => {
    const { registry, escalatedIds } = buildFakeRegistry({
      activeTenants: ['t1'],
      overdueByTenant: {
        t1: [{ id: 'case_a', escalationLevel: 0, caseNumber: 'CASE-1' }],
      },
    });

    const sup = createCaseSLASupervisor(registry, logger, {
      enabled: false,
    });
    await sup.tickOnce();

    expect(escalatedIds).toEqual([]);
    sup.stop();
  });
});
