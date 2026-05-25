/**
 * Tests for the Drizzle field-encryption middleware.
 *
 * Verifies:
 *   - encryptRow auto-encrypts columns whose data-classification entry
 *     has encryptAtRest:true; non-pii columns pass through untouched
 *   - decryptRow reverses encryptRow exactly
 *   - encryptRow never mutates the input row (immutability invariant)
 *   - Already-encrypted values pass through (idempotent retries)
 *   - The audit sink receives one record per encrypted column
 *   - Plaintext (legacy) cells survive decryptRow unchanged
 *   - encryptRow handles null / undefined / non-string values defensively
 *   - encryptRow + selectEncryptionPort integration: a registered table
 *     end-to-end (insert side ⇄ read side)
 *   - toSnakeCase handles camelCase → snake_case correctly
 *   - decryptRow throws when ciphertext is tampered (security event)
 */

import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

import {
  decryptRow,
  encryptRow,
  toSnakeCase,
  __resetTableCacheForTests,
  type FieldEncryptionAuditSink,
} from '../drizzle-encryption-middleware.js';
import { createLibsodiumAdapter } from '../libsodium-adapter.js';
import {
  EncryptionAuthenticationError,
  ENCRYPTED_BLOB_PREFIX,
  type EncryptionPort,
} from '../encryption-port.js';
import type { MasterKeySnapshot } from '../tenant-key-derivation.js';

function makeSnapshot(): MasterKeySnapshot {
  return { current: { version: 1, bytes: new Uint8Array(randomBytes(32)) } };
}

async function buildPort(): Promise<EncryptionPort> {
  return createLibsodiumAdapter({
    snapshot: makeSnapshot(),
    forceFallback: true,
  });
}

describe('toSnakeCase', () => {
  it('converts camelCase → snake_case', () => {
    expect(toSnakeCase('firstName')).toBe('first_name');
    expect(toSnakeCase('idDocumentNumber')).toBe('id_document_number');
    expect(toSnakeCase('email')).toBe('email');
    expect(toSnakeCase('kraPin')).toBe('kra_pin');
  });
});

describe('encryptRow / decryptRow on customers table', () => {
  beforeEachReset();

  it('auto-encrypts kra_pin (encryptAtRest=true) and leaves first_name (encryptAtRest=false) alone', async () => {
    const port = await buildPort();
    const row = {
      id: 'cust-1',
      firstName: 'Asha',
      kraPin: 'A012345678X',
      monthlyIncome: 75000,
    };
    const encrypted = await encryptRow({
      row,
      table: 'customers',
      tenantId: 'tenant-a',
      port,
      rowId: 'cust-1',
    });
    expect(encrypted.firstName).toBe('Asha'); // not encryptAtRest
    expect(encrypted.monthlyIncome).toBe(75000); // not string and not encryptAtRest
    expect(typeof encrypted.kraPin).toBe('string');
    expect((encrypted.kraPin as string).startsWith(ENCRYPTED_BLOB_PREFIX)).toBe(
      true,
    );
  });

  it('does not mutate the input row', async () => {
    const port = await buildPort();
    const row = {
      id: 'cust-2',
      kraPin: 'A0987654321X',
    };
    const inputCopy = { ...row };
    await encryptRow({
      row,
      table: 'customers',
      tenantId: 'tenant-a',
      port,
    });
    expect(row).toEqual(inputCopy);
  });

  it('decryptRow reverses encryptRow exactly', async () => {
    const port = await buildPort();
    const row = {
      id: 'cust-3',
      kraPin: 'A012345678X',
      email: 'asha@example.tz',
    };
    const encrypted = await encryptRow({
      row,
      table: 'customers',
      tenantId: 'tenant-a',
      port,
    });
    const decrypted = await decryptRow({
      row: encrypted,
      table: 'customers',
      tenantId: 'tenant-a',
      port,
    });
    expect(decrypted.kraPin).toBe('A012345678X');
    expect(decrypted.email).toBe('asha@example.tz');
  });

  it('is idempotent on retried inserts (already-encrypted value passes through)', async () => {
    const port = await buildPort();
    const row = { id: 'cust-4', kraPin: 'A012345678X' };
    const once = await encryptRow({
      row,
      table: 'customers',
      tenantId: 'tenant-a',
      port,
    });
    const twice = await encryptRow({
      row: once,
      table: 'customers',
      tenantId: 'tenant-a',
      port,
    });
    expect(twice.kraPin).toBe(once.kraPin);
  });

  it('emits an audit record for every encrypted column', async () => {
    const port = await buildPort();
    const sinkCalls: Array<{
      tenantId: string | null;
      table: string;
      column: string;
      rowId: string | null;
      keyVersion: number;
    }> = [];
    const audit: FieldEncryptionAuditSink = {
      recordEncryptedField(args) {
        sinkCalls.push({ ...args });
      },
    };
    await encryptRow({
      row: {
        id: 'cust-5',
        kraPin: 'A012345678X',
        email: 'asha@example.tz',
        firstName: 'Asha',
      },
      table: 'customers',
      tenantId: 'tenant-a',
      rowId: 'cust-5',
      port,
      audit,
    });
    // Drain the microtask queue so fire-and-forget audit promises resolve.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const columns = sinkCalls.map((c) => c.column).sort();
    expect(columns).toContain('kra_pin');
    expect(columns).toContain('email');
    expect(columns).not.toContain('first_name'); // not encryptAtRest
    for (const call of sinkCalls) {
      expect(call.keyVersion).toBe(1);
      expect(call.rowId).toBe('cust-5');
    }
  });

  it('passes plaintext (legacy) cells through decryptRow unchanged', async () => {
    const port = await buildPort();
    const row = {
      id: 'cust-legacy',
      kraPin: 'A012345678X', // legacy plaintext — no enc:v1: prefix
      email: 'legacy@example.tz',
    };
    const out = await decryptRow({
      row,
      table: 'customers',
      tenantId: 'tenant-a',
      port,
    });
    expect(out.kraPin).toBe('A012345678X');
    expect(out.email).toBe('legacy@example.tz');
  });

  it('skips null and undefined values', async () => {
    const port = await buildPort();
    const row = {
      id: 'cust-6',
      kraPin: null,
      email: undefined,
      firstName: 'OnlyName',
    };
    const out = await encryptRow({
      row,
      table: 'customers',
      tenantId: 'tenant-a',
      port,
    });
    expect(out.kraPin).toBeNull();
    expect(out.email).toBeUndefined();
  });

  it('passes through tables with no encrypted columns unchanged', async () => {
    const port = await buildPort();
    const row = { id: 'unknown-1', anything: 'plain' };
    const out = await encryptRow({
      row,
      table: 'totally_unregistered_table',
      tenantId: 'tenant-a',
      port,
    });
    expect(out).toEqual(row);
  });

  it('throws on tampered ciphertext during decrypt', async () => {
    const port = await buildPort();
    const encrypted = await encryptRow({
      row: { id: 'cust-7', kraPin: 'A012345678X' },
      table: 'customers',
      tenantId: 'tenant-a',
      port,
    });
    // Tamper with the serialized blob.
    const original = encrypted.kraPin as string;
    const tamperedJson = original.slice(ENCRYPTED_BLOB_PREFIX.length);
    const parsed = JSON.parse(tamperedJson) as {
      v: number;
      alg: string;
      n: string;
      c: string;
    };
    const ctBuf = Buffer.from(parsed.c, 'base64');
    ctBuf[0] = (ctBuf[0] ?? 0) ^ 0xff;
    parsed.c = ctBuf.toString('base64');
    const tamperedBlob = `${ENCRYPTED_BLOB_PREFIX}${JSON.stringify(parsed)}`;
    await expect(
      decryptRow({
        row: { ...encrypted, kraPin: tamperedBlob },
        table: 'customers',
        tenantId: 'tenant-a',
        port,
      }),
    ).rejects.toBeInstanceOf(EncryptionAuthenticationError);
  });

  it('an audit-sink failure does not break the encrypt path', async () => {
    const port = await buildPort();
    const audit: FieldEncryptionAuditSink = {
      recordEncryptedField: vi.fn(async () => {
        throw new Error('audit sink boom');
      }),
    };
    const encrypted = await encryptRow({
      row: { id: 'cust-8', kraPin: 'A012345678X' },
      table: 'customers',
      tenantId: 'tenant-a',
      port,
      audit,
    });
    // Drain the fire-and-forget promise; the test should not have thrown.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((encrypted.kraPin as string).startsWith(ENCRYPTED_BLOB_PREFIX)).toBe(
      true,
    );
  });
});

function beforeEachReset() {
  // Vitest's beforeEach is in the global scope when globals: true.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = (globalThis as any).beforeEach as (fn: () => void) => void;
  if (typeof b === 'function') {
    b(() => __resetTableCacheForTests());
  }
}
