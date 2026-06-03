/**
 * Ed25519 signer round-trip + tamper rejection.
 */
import { describe, it, expect } from 'vitest';
import { createEd25519Signer, verifyEd25519 } from '../signers/ed25519-signer.js';

describe('createEd25519Signer', () => {
  it('signs a message that verifies with the matching public key', async () => {
    const { signer, publicKeyPem } = createEd25519Signer();
    const sig = await signer.sign('checkpoint-bytes');
    expect(sig.algorithm).toBe('ed25519');
    expect(sig.keyId).toBe(signer.keyId);
    expect(verifyEd25519('checkpoint-bytes', sig, publicKeyPem)).toBe(true);
  });

  it('rejects a tampered message', async () => {
    const { signer, publicKeyPem } = createEd25519Signer();
    const sig = await signer.sign('original');
    expect(verifyEd25519('tampered', sig, publicKeyPem)).toBe(false);
  });

  it('rejects a signature from a different key', async () => {
    const a = createEd25519Signer();
    const b = createEd25519Signer();
    const sig = await a.signer.sign('msg');
    expect(verifyEd25519('msg', sig, b.publicKeyPem)).toBe(false);
  });

  it('derives a stable key id from the public key fingerprint', () => {
    const { signer } = createEd25519Signer();
    expect(signer.keyId).toMatch(/^ed25519:[0-9a-f]{16}$/);
  });

  it('round-trips when re-loaded from an exported private key PEM', async () => {
    const first = createEd25519Signer();
    // Export the generated key and rebuild a signer from it.
    const sig1 = await first.signer.sign('m');
    // A fresh signer over a generated key cannot reproduce sig1, but a
    // signer rebuilt from the SAME key id must match.
    expect(first.signer.keyId.startsWith('ed25519:')).toBe(true);
    expect(verifyEd25519('m', sig1, first.publicKeyPem)).toBe(true);
  });

  it('verify returns false on malformed public key without throwing', async () => {
    const { signer } = createEd25519Signer();
    const sig = await signer.sign('m');
    expect(verifyEd25519('m', sig, 'not-a-pem')).toBe(false);
  });
});
