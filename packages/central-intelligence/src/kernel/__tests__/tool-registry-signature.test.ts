/**
 * A2b-2 wire #7 — Ed25519 tool-registry signature verification.
 *
 * The boot-time helper:
 *   - throws when a valid pubkey is paired with a tampered signature
 *   - passes when the pubkey + signature agree on the canonical bytes
 *   - logs a warning + returns when either env var is unset (dev mode)
 */
import { describe, it, expect } from 'vitest';
import { sign as nodeSign, createPrivateKey } from 'node:crypto';
import {
  enforceToolRegistrySignatureAtBoot,
  generateToolSignatureKeyPair,
  verifyRegistryHexSignature,
} from '../tool-spec/tool-registry-signing.js';

const ED25519_PRIVATE_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

function signCanonical(canonical: string, raw32: Uint8Array): string {
  const der = Buffer.concat([ED25519_PRIVATE_PKCS8_PREFIX, Buffer.from(raw32)]);
  const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const sig = nodeSign(null, Buffer.from(canonical, 'utf8'), key);
  return Buffer.from(sig).toString('hex');
}

describe('A2b-2 wire #7 — registry signature verification', () => {
  it('passes when the signature matches the canonical bytes', async () => {
    const { privateKey, publicKey } =
      await generateToolSignatureKeyPair('test-key');
    const canonical = JSON.stringify({ tools: ['evict', 'kra-file'] });
    const signatureHex = signCanonical(canonical, privateKey.privateKey);
    const publicKeyHex = Buffer.from(publicKey.publicKey).toString('hex');
    const out = verifyRegistryHexSignature({
      canonical,
      signatureHex,
      publicKeyHex,
    });
    expect(out.ok).toBe(true);
  });

  it('fails when canonical bytes were tampered', async () => {
    const { privateKey, publicKey } =
      await generateToolSignatureKeyPair('test-key');
    const canonical = JSON.stringify({ tools: ['evict', 'kra-file'] });
    const tampered = JSON.stringify({ tools: ['evict', 'kra-file', 'inject'] });
    const signatureHex = signCanonical(canonical, privateKey.privateKey);
    const publicKeyHex = Buffer.from(publicKey.publicKey).toString('hex');
    const out = verifyRegistryHexSignature({
      canonical: tampered,
      signatureHex,
      publicKeyHex,
    });
    expect(out.ok).toBe(false);
  });

  it('enforce: throws on mismatch with env set', async () => {
    const { privateKey, publicKey } =
      await generateToolSignatureKeyPair('test-key');
    const canonical = 'canonical-A';
    const wrongCanonical = 'canonical-B';
    const signatureHex = signCanonical(canonical, privateKey.privateKey);
    const publicKeyHex = Buffer.from(publicKey.publicKey).toString('hex');
    expect(() =>
      enforceToolRegistrySignatureAtBoot({
        canonical: wrongCanonical,
        env: {
          TOOL_REGISTRY_SIGNATURE_HEX: signatureHex,
          TOOL_REGISTRY_PUBKEY_HEX: publicKeyHex,
        },
      }),
    ).toThrow(/tool registry signature mismatch/);
  });

  it('enforce: passes when env-supplied signature matches', async () => {
    const { privateKey, publicKey } =
      await generateToolSignatureKeyPair('test-key');
    const canonical = 'canonical-payload';
    const signatureHex = signCanonical(canonical, privateKey.privateKey);
    const publicKeyHex = Buffer.from(publicKey.publicKey).toString('hex');
    expect(() =>
      enforceToolRegistrySignatureAtBoot({
        canonical,
        env: {
          TOOL_REGISTRY_SIGNATURE_HEX: signatureHex,
          TOOL_REGISTRY_PUBKEY_HEX: publicKeyHex,
        },
      }),
    ).not.toThrow();
  });

  it('enforce: logs warning + returns when env unset (dev mode)', () => {
    const warnings: string[] = [];
    expect(() =>
      enforceToolRegistrySignatureAtBoot({
        canonical: 'whatever',
        env: {},
        logger: { warn: (m) => warnings.push(m) },
      }),
    ).not.toThrow();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/skipping registry signature verification/);
  });
});
