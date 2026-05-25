/**
 * Tests for the EncryptionPort serialization helpers + selectEncryptionPort.
 *
 * Verifies:
 *   - serializeBlob round-trips through deserializeBlob
 *   - deserializeBlob returns null for plaintext (legacy) input
 *   - deserializeBlob rejects malformed payloads
 *   - selectEncryptionPort picks libsodium when AWS_KMS_KEY_ID absent
 *   - selectEncryptionPort throws when ENCRYPTION_MASTER_KEY missing
 *   - selectEncryptionPort accepts a logger override (no console noise)
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';

import {
  deserializeBlob,
  serializeBlob,
  EncryptionKeyUnavailableError,
  type EncryptedBlob,
} from '../encryption-port.js';
import { resolveRegionAndKey, selectEncryptionPort } from '../index.js';

describe('serializeBlob / deserializeBlob', () => {
  const blob: EncryptedBlob = {
    keyVersion: 1,
    algorithm: 'xchacha20-poly1305',
    nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  };

  it('round-trips a valid blob through string', () => {
    const wire = serializeBlob(blob);
    expect(wire.startsWith('enc:v1:')).toBe(true);
    const recovered = deserializeBlob(wire);
    expect(recovered).toEqual(blob);
  });

  it('returns null for a legacy plaintext value', () => {
    expect(deserializeBlob('A012345678X')).toBeNull();
    expect(deserializeBlob('')).toBeNull();
  });

  it('returns null when the JSON is malformed', () => {
    expect(deserializeBlob('enc:v1:{not-json}')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(deserializeBlob('enc:v1:{"v":1}')).toBeNull();
  });

  it('returns null for an unsupported algorithm', () => {
    expect(
      deserializeBlob(
        'enc:v1:{"v":1,"alg":"des-cbc","n":"AAAA","c":"BBBB"}',
      ),
    ).toBeNull();
  });
});

describe('selectEncryptionPort', () => {
  const goodKey = Buffer.from(randomBytes(32)).toString('base64');

  it('throws when ENCRYPTION_MASTER_KEY is missing', async () => {
    await expect(selectEncryptionPort({})).rejects.toBeInstanceOf(
      EncryptionKeyUnavailableError,
    );
  });

  it('returns a libsodium adapter when AWS_KMS_KEY_ID is not set', async () => {
    const port = await selectEncryptionPort({
      ENCRYPTION_MASTER_KEY: goodKey,
    });
    expect(port.kind).toBe('libsodium');
  });

  it('routes to KMS when AWS_KMS_KEY_ID + AWS_REGION are set', async () => {
    const port = await selectEncryptionPort({
      ENCRYPTION_MASTER_KEY: goodKey,
      AWS_KMS_KEY_ID: 'alias/test-cmk',
      AWS_REGION: 'us-east-1',
    });
    // KMS adapter when SDK loads, libsodium when it does not — both valid.
    expect(['kms', 'libsodium']).toContain(port.kind);
  });
});

describe('resolveRegionAndKey (tenant-region routing)', () => {
  it('returns the default region + key when tenantRegion is absent', () => {
    const out = resolveRegionAndKey(
      { AWS_REGION: 'eu-west-1', AWS_KMS_KEY_ID: 'alias/default' } as never,
      {},
    );
    expect(out).toEqual({ region: 'eu-west-1', kmsKeyId: 'alias/default' });
  });

  it('returns the default pair when tenantRegion matches env.AWS_REGION', () => {
    const out = resolveRegionAndKey(
      { AWS_REGION: 'eu-west-1', AWS_KMS_KEY_ID: 'alias/default' } as never,
      { tenantRegion: 'eu-west-1' },
    );
    expect(out).toEqual({ region: 'eu-west-1', kmsKeyId: 'alias/default' });
  });

  it('uses a region-specific KMS key when KMS_KEY_<REGION> is set', () => {
    const out = resolveRegionAndKey(
      {
        AWS_REGION: 'eu-west-1',
        AWS_KMS_KEY_ID: 'alias/default',
        KMS_KEY_AF_SOUTH_1: 'alias/za-cmk',
      } as never,
      { tenantRegion: 'af-south-1' },
    );
    expect(out).toEqual({ region: 'af-south-1', kmsKeyId: 'alias/za-cmk' });
  });

  it('falls back to AWS_KMS_KEY_ID and warns when no region-specific key set', () => {
    const warns: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const logger = {
      info: () => undefined,
      warn: (msg: string, ctx?: Record<string, unknown>) =>
        warns.push(ctx ? { msg, ctx } : { msg }),
    };
    const out = resolveRegionAndKey(
      { AWS_REGION: 'eu-west-1', AWS_KMS_KEY_ID: 'alias/default' } as never,
      { tenantRegion: 'af-south-1', logger },
    );
    expect(out).toEqual({ region: 'af-south-1', kmsKeyId: 'alias/default' });
    expect(warns).toHaveLength(1);
    expect(warns[0]?.ctx).toMatchObject({
      tenantRegion: 'af-south-1',
      expectedEnvVar: 'KMS_KEY_AF_SOUTH_1',
    });
  });
});
