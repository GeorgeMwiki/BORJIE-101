/**
 * Tests for PostgresFarRepository using an in-memory drizzle fake.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresFarRepository } from './postgres-far-repository.js';
import type {
  AssetComponent,
  FarAssignment,
  ConditionCheckEvent,
} from './types.js';
import {
  asAssetComponentId,
  asFarAssignmentId,
  asConditionCheckEventId,
} from './types.js';
import type {
  TenantId,
  UserId,
  PropertyId,
  ISOTimestamp,
} from '@borjie/domain-models';

type Row = Record<string, unknown>;

vi.mock('drizzle-orm', () => ({
  and: (...parts: any[]) => (row: Row) =>
    parts.every((p) => (p ? p(row) : true)),
  eq: (col: any, val: unknown) => (row: Row) => row[col.name] === val,
  lte: (col: any, val: any) => (row: Row) => {
    const left = row[col.name];
    if (left instanceof Date && val instanceof Date) return left <= val;
    if (left == null) return false;
    return (left as any) <= val;
  },
}));

vi.mock('@borjie/database', () => {
  const col = (name: string) => ({ name });
  return {
    assetComponents: {
      _table: 'asset_components',
      id: col('id'),
      tenantId: col('tenantId'),
    },
    farAssignments: {
      _table: 'far_assignments',
      id: col('id'),
      tenantId: col('tenantId'),
      status: col('status'),
      nextCheckDueAt: col('nextCheckDueAt'),
    },
    conditionCheckEvents: {
      _table: 'condition_check_events',
      id: col('id'),
      tenantId: col('tenantId'),
      componentId: col('componentId'),
    },
  };
});

function makeFakeDb() {
  const tables: Record<string, Row[]> = {
    asset_components: [],
    far_assignments: [],
    condition_check_events: [],
  };
  const toPred = (p: any) => (typeof p === 'function' ? p : () => true);
  return {
    tables,
    select: () => {
      let predicate: (r: Row) => boolean = () => true;
      let limit = Infinity;
      let currentTable: Row[] = [];
      const chain: any = {
        from: (t: any) => {
          currentTable = tables[t._table] ?? [];
          return chain;
        },
        where: (p: any) => ((predicate = toPred(p)), chain),
        limit: (n: number) => ((limit = n), chain),
        then: (resolve: (r: Row[]) => void) =>
          resolve(currentTable.filter(predicate).slice(0, limit)),
      };
      return chain;
    },
    insert: (t: any) => ({
      values(v: Row) {
        tables[t._table].push({ ...v });
      },
    }),
    update: (t: any) => {
      let patch: Row = {};
      const chain: any = {
        set: (p: Row) => ((patch = p), chain),
        where: (p: any) => {
          const pred = toPred(p);
          for (const row of tables[t._table]) if (pred(row)) Object.assign(row, patch);
          return Promise.resolve();
        },
      };
      return chain;
    },
  };
}

const TENANT = 'tenant_1' as TenantId;
const ACTOR = 'u_1' as UserId;
const PROPERTY = 'prop_1' as PropertyId;

function makeComponent(id: string): AssetComponent {
  const now = new Date().toISOString() as ISOTimestamp;
  return {
    id: asAssetComponentId(id),
    tenantId: TENANT,
    propertyId: PROPERTY,
    unitId: null,
    code: `C-${id}`,
    name: id,
    category: null,
    manufacturer: null,
    modelNumber: null,
    serialNumber: null,
    installedAt: null,
    expectedLifespanMonths: null,
    status: 'active',
    currentCondition: 'good',
    metadata: {},
    createdAt: now,
    updatedAt: now,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  };
}

function makeAssignment(
  id: string,
  componentId: string,
  nextDue: ISOTimestamp | null
): FarAssignment {
  const now = new Date().toISOString() as ISOTimestamp;
  return {
    id: asFarAssignmentId(id),
    tenantId: TENANT,
    componentId: asAssetComponentId(componentId),
    assignedTo: null,
    frequency: 'monthly',
    status: 'active',
    triggerRules: {},
    firstCheckDueAt: nextDue,
    nextCheckDueAt: nextDue,
    lastCheckedAt: null,
    notifyRecipients: [],
    createdAt: now,
    updatedAt: now,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  };
}

describe('PostgresFarRepository', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let repo: PostgresFarRepository;

  beforeEach(() => {
    db = makeFakeDb();
    repo = new PostgresFarRepository(db as any);
  });

  it('createComponent + findComponentById', async () => {
    const c = makeComponent('c1');
    await repo.createComponent(c);
    const found = await repo.findComponentById(c.id, TENANT);
    expect(found?.code).toBe('C-c1');
  });

  it('createAssignment + findAssignmentById + updateAssignment', async () => {
    const c = makeComponent('c2');
    await repo.createComponent(c);
    const pastDue = new Date(Date.now() - 1000).toISOString() as ISOTimestamp;
    const a = makeAssignment('a1', 'c2', pastDue);
    await repo.createAssignment(a);
    const found = await repo.findAssignmentById(a.id, TENANT);
    expect(found?.id).toBe('a1');
    await repo.updateAssignment({ ...a, status: 'paused' });
    const after = await repo.findAssignmentById(a.id, TENANT);
    expect(after?.status).toBe('paused');
  });

  it('findDue returns only assignments past the cutoff and active', async () => {
    await repo.createComponent(makeComponent('c3'));
    const past = new Date(Date.now() - 10_000).toISOString() as ISOTimestamp;
    const future = new Date(Date.now() + 10_000).toISOString() as ISOTimestamp;
    await repo.createAssignment(makeAssignment('a_past', 'c3', past));
    await repo.createAssignment(makeAssignment('a_future', 'c3', future));
    const now = new Date().toISOString() as ISOTimestamp;
    const due = await repo.findDue(TENANT, now);
    const ids = due.map((a) => a.id);
    expect(ids).toContain('a_past');
    expect(ids).not.toContain('a_future');
  });

  it('createCheckEvent + findScheduledChecks', async () => {
    await repo.createComponent(makeComponent('c4'));
    const past = new Date(Date.now() - 1000).toISOString() as ISOTimestamp;
    await repo.createAssignment(makeAssignment('a4', 'c4', past));
    const event: ConditionCheckEvent = {
      id: asConditionCheckEventId('e1'),
      tenantId: TENANT,
      farAssignmentId: asFarAssignmentId('a4'),
      componentId: asAssetComponentId('c4'),
      performedBy: ACTOR,
      dueAt: past,
      performedAt: new Date().toISOString() as ISOTimestamp,
      outcome: 'pass',
      conditionAfter: 'good',
      notes: null,
      photos: [],
      measurements: {},
      notificationsLog: [],
      createdAt: new Date().toISOString() as ISOTimestamp,
      updatedAt: new Date().toISOString() as ISOTimestamp,
    };
    await repo.createCheckEvent(event);
    const list = await repo.findScheduledChecks(TENANT, asAssetComponentId('c4'));
    expect(list).toHaveLength(1);
    expect(list[0].outcome).toBe('pass');
  });
});
