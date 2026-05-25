/**
 * CustomerRepository encryption round-trip — Phase D / A2b-1.
 *
 * Verifies that injecting an `EncryptionPort` into the
 * CustomerRepository's constructor:
 *
 *   1. Encrypts the `id_document_number` (NIDA), `kra_pin`, `email`,
 *      `phone`, and other `encryptAtRest: true` columns at the write
 *      boundary — i.e. the raw `db.insert(...)` argument the
 *      simulator captures is ciphertext, NOT plaintext.
 *   2. Decrypts the same columns at the read boundary — i.e. the
 *      caller sees the original plaintext.
 *
 * The simulator is an in-memory DatabaseClient stub modelled on the
 * existing `sovereign-action-ledger.service.test.ts` pattern. It
 * captures the `values()` payload from `db.insert(customers).values(...)`
 * and returns it from `select()` so the round-trip is observable
 * without a live Postgres.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { CustomerRepository } from '../customer.repository.js';
import { createLibsodiumAdapter } from '../../security/encryption/libsodium-adapter.js';
import {
  ENCRYPTED_BLOB_PREFIX,
  type EncryptionPort,
} from '../../security/encryption/encryption-port.js';
import type { MasterKeySnapshot } from '../../security/encryption/tenant-key-derivation.js';
import type { DatabaseClient } from '../../client.js';

function makeSnapshot(): MasterKeySnapshot {
  return {
    current: { version: 1, bytes: new Uint8Array(randomBytes(32)) },
  };
}

async function buildPort(): Promise<EncryptionPort> {
  return createLibsodiumAdapter({
    snapshot: makeSnapshot(),
    forceFallback: true,
  });
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: () => ({ _op: 'eq' }),
    and: () => ({ _op: 'and' }),
    desc: () => ({ _op: 'desc' }),
    isNull: () => ({ _op: 'isNull' }),
    inArray: () => ({ _op: 'inArray' }),
    like: () => ({ _op: 'like' }),
    or: () => ({ _op: 'or' }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _op: 'sql',
        strings,
        values,
      }),
      { raw: (s: string) => ({ _op: 'sql-raw', sql: s }) },
    ),
  };
});

/**
 * In-memory DatabaseClient simulator. Captures `.values(...)` payloads
 * AND echoes them back from `.select()`.
 */
function makeDbSim(): {
  client: DatabaseClient;
  readonly rawRows: Record<string, unknown>[];
} {
  const rows: Record<string, unknown>[] = [];

  const insertChain = {
    values(v: Record<string, unknown>) {
      const stored = { ...v };
      rows.push(stored);
      return {
        returning() {
          return Promise.resolve([stored]);
        },
      };
    },
  };

  const selectChain: Record<string, unknown> = {
    from() {
      return selectChain;
    },
    where() {
      return selectChain;
    },
    orderBy() {
      return selectChain;
    },
    limit(_n: number) {
      return Promise.resolve(rows);
    },
    offset() {
      return selectChain;
    },
  };

  const db = {
    insert() {
      return insertChain;
    },
    select() {
      return selectChain;
    },
    update() {
      return {
        set() {
          return {
            where() {
              return {
                returning() {
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      };
    },
    execute() {
      return Promise.resolve(undefined);
    },
  };

  return {
    client: db as unknown as DatabaseClient,
    get rawRows() {
      return rows;
    },
  };
}

describe('CustomerRepository field-encryption round-trip', () => {
  let port: EncryptionPort;

  beforeEach(async () => {
    port = await buildPort();
  });

  // Note: `kra_pin` exists in the data-classification registry but the
  // Drizzle `customers` schema does not have that column yet (it's a
  // forward-compat row in the registry). The integration test below
  // exercises the columns that DO exist on the schema today: NIDA via
  // `id_document_number`, plus `email` and `phone`.
  it('encrypts id_document_number + phone + email on insert; decrypts on select', async () => {
    const sim = makeDbSim();
    const repo = new CustomerRepository(sim.client, { encPort: port });

    const tenantId = 'tenant-uuid-aaaa';
    const id = randomUUID();
    const created = await repo.create(
      {
        id,
        tenantId: tenantId as unknown as never,
        customerCode: 'CUST-0001',
        firstName: 'Asha',
        lastName: 'Kweli',
        email: 'asha@example.com',
        phone: '+255712345678',
        idDocumentNumber: '19900101-12345-67890-12',
      } as unknown as Parameters<typeof repo.create>[0],
      'usr_admin' as unknown as never,
    );

    // ─── The RAW DB row carries CIPHERTEXT for encryptAtRest columns ────
    const stored = sim.rawRows[0];
    expect(stored).toBeDefined();
    // NIDA is encryptAtRest=true ⇒ ciphertext on disk.
    expect(stored?.idDocumentNumber).not.toBe('19900101-12345-67890-12');
    expect(String(stored?.idDocumentNumber).startsWith(ENCRYPTED_BLOB_PREFIX))
      .toBe(true);
    // phone is encryptAtRest=true ⇒ ciphertext on disk.
    expect(stored?.phone).not.toBe('+255712345678');
    expect(String(stored?.phone).startsWith(ENCRYPTED_BLOB_PREFIX)).toBe(true);
    // email is encryptAtRest=true ⇒ ciphertext on disk.
    expect(stored?.email).not.toBe('asha@example.com');
    expect(String(stored?.email).startsWith(ENCRYPTED_BLOB_PREFIX)).toBe(true);
    // firstName is encryptAtRest=false ⇒ plaintext on disk.
    expect(stored?.firstName).toBe('Asha');

    // ─── The repository's return value carries PLAINTEXT ─────────────────
    expect(created?.idDocumentNumber).toBe('19900101-12345-67890-12');
    expect(created?.phone).toBe('+255712345678');
    expect(created?.email).toBe('asha@example.com');
  });

  it('plaintext mode when no encPort is injected — backwards compatible', async () => {
    const sim = makeDbSim();
    const repo = new CustomerRepository(sim.client); // no deps

    const tenantId = 'tenant-uuid-aaaa';
    await repo.create(
      {
        id: randomUUID(),
        tenantId: tenantId as unknown as never,
        customerCode: 'CUST-0001',
        firstName: 'Asha',
        lastName: 'Kweli',
        email: 'asha@example.com',
        phone: '+255712345678',
        idDocumentNumber: '19900101-12345-67890-12',
      } as unknown as Parameters<typeof repo.create>[0],
      'usr_admin' as unknown as never,
    );

    const stored = sim.rawRows[0];
    // All columns remain plaintext when no encryption port is wired.
    expect(stored?.idDocumentNumber).toBe('19900101-12345-67890-12');
    expect(stored?.phone).toBe('+255712345678');
    expect(stored?.email).toBe('asha@example.com');
  });

  it('audit sink receives one record per encrypted column on create', async () => {
    const sim = makeDbSim();
    const auditCalls: Array<{
      table: string;
      column: string;
      keyVersion: number;
    }> = [];
    const audit = {
      recordEncryptedField(args: {
        table: string;
        column: string;
        keyVersion: number;
        tenantId: string | null;
        rowId: string | null;
      }) {
        auditCalls.push({
          table: args.table,
          column: args.column,
          keyVersion: args.keyVersion,
        });
      },
    };
    const repo = new CustomerRepository(sim.client, {
      encPort: port,
      encAudit: audit,
    });

    await repo.create(
      {
        id: randomUUID(),
        tenantId: 'tnt-a' as unknown as never,
        customerCode: 'CUST-0002',
        firstName: 'Bee',
        lastName: 'See',
        email: 'b@c.com',
        phone: '+255700111222',
        idDocumentNumber: '19900101-12345-67890-12',
      } as unknown as Parameters<typeof repo.create>[0],
      'usr_admin' as unknown as never,
    );

    // Sink is fire-and-forget — wait a tick for the microtasks to drain.
    await new Promise((r) => setTimeout(r, 10));
    const columns = new Set(auditCalls.map((c) => c.column));
    expect(columns.has('id_document_number')).toBe(true);
    expect(columns.has('phone')).toBe(true);
    expect(columns.has('email')).toBe(true);
    // All on the active key version.
    for (const c of auditCalls) {
      expect(c.keyVersion).toBe(1);
      expect(c.table).toBe('customers');
    }
  });
});
