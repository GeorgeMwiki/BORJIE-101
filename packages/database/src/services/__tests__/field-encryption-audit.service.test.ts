/**
 * Unit tests for createFieldEncryptionAuditService.
 *
 * Stubs the DatabaseClient so we can assert the SET/VALUES shapes the
 * service hands to drizzle. The stub records all operations as
 * normalised `{op, values?, set?}` entries.
 *
 * Verifies:
 *   - recordEncryptedField INSERTs a well-formed row (id, tenant, table,
 *     column, rowId, keyVersion)
 *   - recordEncryptedField is fire-and-forget: db errors NEVER throw
 *   - recordEncryptedField rejects invalid inputs silently (no INSERT)
 *   - listByScope returns the entries mapped from db rows
 *   - listByScope returns [] on db error (side-channel safety)
 *   - markRotated UPDATEs the rotated_at column
 *   - countByKeyVersion projects the (keyVersion, count) tuples
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFieldEncryptionAuditService } from '../field-encryption-audit.service.js';
import type { DatabaseClient } from '../../client.js';

interface RecordedOp {
  readonly op: 'insert' | 'update' | 'select';
  readonly values?: Record<string, unknown>;
  readonly set?: Record<string, unknown>;
}

interface StubDb {
  readonly client: DatabaseClient;
  readonly ops: ReadonlyArray<RecordedOp>;
  setSelectRows: (rows: ReadonlyArray<Record<string, unknown>>) => void;
  setNextThrow: (err: Error) => void;
}

function makeStub(): StubDb {
  const ops: RecordedOp[] = [];
  let selectRows: ReadonlyArray<Record<string, unknown>> = [];
  let nextThrow: Error | null = null;

  const thenify = <T>(value: T) => ({
    then: (resolve: (v: T) => unknown) => resolve(value),
  });
  const thenifyThrow = (err: Error) => ({
    then: (
      _resolve: (v: unknown) => unknown,
      reject: (e: unknown) => void,
    ) => reject(err),
  });

  const db: Record<string, unknown> = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (nextThrow) {
          const e = nextThrow;
          nextThrow = null;
          return thenifyThrow(e);
        }
        ops.push({ op: 'insert', values: v });
        return thenify(undefined);
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: (_: unknown) => {
          if (nextThrow) {
            const e = nextThrow;
            nextThrow = null;
            return thenifyThrow(e);
          }
          ops.push({ op: 'update', set: s });
          return thenify(undefined);
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (_: unknown) => {
          const terminal = () => {
            if (nextThrow) {
              const e = nextThrow;
              nextThrow = null;
              return thenifyThrow(e);
            }
            ops.push({ op: 'select' });
            return thenify(selectRows);
          };
          const chain: Record<string, unknown> = {
            then: (
              resolve: (v: unknown) => unknown,
              reject?: (e: unknown) => void,
            ) => {
              const t = terminal() as { then: (r: any, j?: any) => void };
              return t.then(resolve, reject);
            },
            orderBy: () => chain,
            limit: () => terminal(),
            groupBy: () => terminal(),
          };
          return chain;
        },
      }),
    }),
  };

  const stub = {
    client: db as unknown as DatabaseClient,
    setSelectRows: (rows: ReadonlyArray<Record<string, unknown>>) => {
      selectRows = rows;
    },
    setNextThrow: (err: Error) => {
      nextThrow = err;
    },
  } as unknown as StubDb;
  Object.defineProperty(stub, 'ops', { get: () => ops });
  return stub;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('createFieldEncryptionAuditService — recordEncryptedField', () => {
  it('INSERTs the expected row when args are valid', async () => {
    const stub = makeStub();
    const service = createFieldEncryptionAuditService(stub.client);
    await service.recordEncryptedField({
      tenantId: 'tenant-a',
      table: 'customers',
      column: 'kra_pin',
      rowId: 'cust-1',
      keyVersion: 1,
    });
    expect(stub.ops).toHaveLength(1);
    const op = stub.ops[0];
    expect(op?.op).toBe('insert');
    expect(op?.values).toMatchObject({
      tenantId: 'tenant-a',
      tableName: 'customers',
      columnName: 'kra_pin',
      rowId: 'cust-1',
      keyVersion: 1,
    });
    expect(typeof op?.values?.id).toBe('string');
  });

  it('SWALLOWS db errors (fire-and-forget contract)', async () => {
    const stub = makeStub();
    stub.setNextThrow(new Error('postgres down'));
    const service = createFieldEncryptionAuditService(stub.client);
    await expect(
      service.recordEncryptedField({
        tenantId: 'tenant-a',
        table: 'customers',
        column: 'kra_pin',
        rowId: 'cust-1',
        keyVersion: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects invalid args silently (no INSERT)', async () => {
    const stub = makeStub();
    const service = createFieldEncryptionAuditService(stub.client);
    await service.recordEncryptedField({
      tenantId: 'tenant-a',
      table: '',
      column: 'kra_pin',
      rowId: 'cust-1',
      keyVersion: 1,
    });
    await service.recordEncryptedField({
      tenantId: 'tenant-a',
      table: 'customers',
      column: 'kra_pin',
      rowId: 'cust-1',
      keyVersion: 0,
    });
    expect(stub.ops).toHaveLength(0);
  });

  it('normalises table/column to lowercase', async () => {
    const stub = makeStub();
    const service = createFieldEncryptionAuditService(stub.client);
    await service.recordEncryptedField({
      tenantId: null,
      table: 'CUSTOMERS',
      column: 'KRA_PIN',
      rowId: null,
      keyVersion: 3,
    });
    const op = stub.ops[0];
    expect(op?.values?.tableName).toBe('customers');
    expect(op?.values?.columnName).toBe('kra_pin');
    expect(op?.values?.tenantId).toBeNull();
  });
});

describe('createFieldEncryptionAuditService — listByScope', () => {
  it('maps db rows into FieldEncryptionAuditEntry shape', async () => {
    const stub = makeStub();
    const date = new Date('2026-05-17T00:00:00.000Z');
    stub.setSelectRows([
      {
        id: 'audit-1',
        tenantId: 'tenant-a',
        tableName: 'customers',
        columnName: 'kra_pin',
        rowId: 'cust-1',
        keyVersion: 1,
        encryptedAt: date,
        rotatedAt: null,
      },
    ]);
    const service = createFieldEncryptionAuditService(stub.client);
    const out = await service.listByScope({
      tenantId: 'tenant-a',
      table: 'customers',
      column: 'kra_pin',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'audit-1',
      tenantId: 'tenant-a',
      table: 'customers',
      column: 'kra_pin',
      rowId: 'cust-1',
      keyVersion: 1,
      rotatedAt: null,
    });
    expect(out[0]?.encryptedAt).toBe(date.toISOString());
  });

  it('returns [] when the db throws', async () => {
    const stub = makeStub();
    stub.setNextThrow(new Error('boom'));
    const service = createFieldEncryptionAuditService(stub.client);
    const out = await service.listByScope({
      tenantId: 'tenant-a',
      table: 'customers',
      column: 'kra_pin',
    });
    expect(out).toEqual([]);
  });
});

describe('createFieldEncryptionAuditService — markRotated / countByKeyVersion', () => {
  it('UPDATEs rotated_at when ids are supplied', async () => {
    const stub = makeStub();
    const service = createFieldEncryptionAuditService(stub.client);
    await service.markRotated(['audit-1', 'audit-2']);
    expect(stub.ops).toHaveLength(1);
    expect(stub.ops[0]?.op).toBe('update');
    expect(stub.ops[0]?.set?.rotatedAt).toBeInstanceOf(Date);
  });

  it('no-ops when the ids array is empty', async () => {
    const stub = makeStub();
    const service = createFieldEncryptionAuditService(stub.client);
    await service.markRotated([]);
    expect(stub.ops).toHaveLength(0);
  });

  it('projects (keyVersion, count) tuples from the db', async () => {
    const stub = makeStub();
    stub.setSelectRows([
      { keyVersion: 1, count: 42 },
      { keyVersion: 2, count: 7 },
    ]);
    const service = createFieldEncryptionAuditService(stub.client);
    const out = await service.countByKeyVersion({
      tenantId: 'tenant-a',
      table: 'customers',
      column: 'kra_pin',
    });
    expect(out).toEqual([
      { keyVersion: 1, count: 42 },
      { keyVersion: 2, count: 7 },
    ]);
  });
});
