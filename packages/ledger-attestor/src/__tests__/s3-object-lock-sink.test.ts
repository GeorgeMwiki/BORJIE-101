/**
 * S3 object-lock sink — key layout, retention mapping, fail-loud.
 */
import { describe, it, expect } from 'vitest';
import {
  createS3ObjectLockSink,
  type ObjectPutPort,
  type ObjectPutRequest,
} from '../sinks/s3-object-lock-sink.js';
import type { SignedCheckpoint } from '../types.js';

function fakePut(): { port: ObjectPutPort; calls: ObjectPutRequest[] } {
  const calls: ObjectPutRequest[] = [];
  return {
    calls,
    port: {
      async put(req) {
        calls.push(req);
        return { versionId: 'v-123' };
      },
    },
  };
}

const checkpoint: SignedCheckpoint = {
  payload: {
    chainId: 'ledger:tenant-1:account-9',
    merkleRoot: 'abc123',
    leafCount: 10,
    headIndex: 9,
    prevRoot: null,
    attestedAtIso: '2026-06-03T01:00:00.000Z',
  },
  signature: { algorithm: 'ed25519', keyId: 'ed25519:deadbeef', signatureB64: 'sig' },
};

describe('createS3ObjectLockSink', () => {
  it('writes a sortable object key under the prefix and returns an s3 locator', async () => {
    const { port, calls } = fakePut();
    const sink = createS3ObjectLockSink(port, {
      bucket: 'borjie-attest',
      prefix: 'ledger-attestations',
      retentionDays: 365,
      now: () => new Date('2026-06-03T01:00:00.000Z'),
    });

    const receipt = await sink.publish(checkpoint);

    expect(calls).toHaveLength(1);
    expect(calls[0].bucket).toBe('borjie-attest');
    expect(calls[0].key).toBe(
      'ledger-attestations/ledger:tenant-1:account-9/2026-06-03T01:00:00.000Z-abc123.json',
    );
    expect(calls[0].retentionMode).toBe('COMPLIANCE');
    expect(receipt.sink).toBe('s3-object-lock');
    expect(receipt.locator).toContain('s3://borjie-attest/');
    expect(receipt.locator).toContain('#v-123');
  });

  it('maps retentionDays to a retain-until ISO date', async () => {
    const { port, calls } = fakePut();
    const sink = createS3ObjectLockSink(port, {
      bucket: 'b',
      prefix: 'p',
      retentionDays: 10,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    await sink.publish(checkpoint);
    expect(calls[0].retainUntilIso).toBe('2026-01-11T00:00:00.000Z');
  });

  it('propagates a backend failure (fail-loud)', async () => {
    const port: ObjectPutPort = {
      async put() {
        throw new Error('s3 unavailable');
      },
    };
    const sink = createS3ObjectLockSink(port, {
      bucket: 'b',
      prefix: 'p',
      retentionDays: 1,
    });
    await expect(sink.publish(checkpoint)).rejects.toThrow('s3 unavailable');
  });

  it('serialises the full signed checkpoint into the object body', async () => {
    const { port, calls } = fakePut();
    const sink = createS3ObjectLockSink(port, { bucket: 'b', prefix: 'p', retentionDays: 1 });
    await sink.publish(checkpoint);
    const body = JSON.parse(calls[0].body) as SignedCheckpoint;
    expect(body.payload.merkleRoot).toBe('abc123');
    expect(body.signature.keyId).toBe('ed25519:deadbeef');
  });
});
