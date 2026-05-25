import { describe, expect, it } from 'vitest';
import { makeMultiKeyVerifier, makeSigner } from '../signed-event.js';
import type { CryptoPort, TenantId } from '../types.js';

const realStubCrypto = (): CryptoPort => {
  // Deterministic toy hash; not cryptographically secure but stable.
  const hash = (data: string): string => {
    let h = 0n;
    for (let i = 0; i < data.length; i++) {
      h = (h * 31n + BigInt(data.charCodeAt(i))) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, '0');
  };
  return {
    hmacSha256Hex: async (secret, data) => hash(secret + ':' + data),
    timingSafeEqualHex: (a, b) => a === b,
  };
};

const tid = (s: string) => s as TenantId;

describe('signed-event', () => {
  it('signs and verifies a basic event', async () => {
    const signer = makeSigner({ keyId: 'k1', secret: 's' }, realStubCrypto());
    const event = await signer.sign({
      eventId: 'e1',
      eventType: 'rent.posted',
      tenantId: tid('t1'),
      tsMs: 1000,
      payload: { amount: 100 },
    });
    expect(event.signature.length).toBeGreaterThan(0);
    expect(await signer.verify(event)).toBe(true);
  });

  it('rejects modified payload', async () => {
    const signer = makeSigner({ keyId: 'k1', secret: 's' }, realStubCrypto());
    const event = await signer.sign({
      eventId: 'e1',
      eventType: 'rent.posted',
      tenantId: tid('t1'),
      tsMs: 1000,
      payload: { amount: 100 },
    });
    const tampered = { ...event, payload: { amount: 999 } };
    expect(await signer.verify(tampered)).toBe(false);
  });

  it('rejects wrong keyId', async () => {
    const signer = makeSigner({ keyId: 'k1', secret: 's' }, realStubCrypto());
    const event = await signer.sign({
      eventId: 'e1',
      eventType: 'x',
      tenantId: tid('t1'),
      tsMs: 1,
      payload: {},
    });
    const swapped = { ...event, signingKeyId: 'k9' };
    expect(await signer.verify(swapped)).toBe(false);
  });

  it('produces stable signatures regardless of payload key order', async () => {
    const signer = makeSigner({ keyId: 'k1', secret: 's' }, realStubCrypto());
    const a = await signer.sign({
      eventId: 'e1',
      eventType: 'x',
      tenantId: tid('t1'),
      tsMs: 1,
      payload: { a: 1, b: 2 },
    });
    const b = await signer.sign({
      eventId: 'e1',
      eventType: 'x',
      tenantId: tid('t1'),
      tsMs: 1,
      payload: { b: 2, a: 1 },
    });
    expect(a.signature).toBe(b.signature);
  });

  it('multi-key verifier accepts old + new during rotation', async () => {
    const crypto = realStubCrypto();
    const oldSigner = makeSigner({ keyId: 'old', secret: 's-old' }, crypto);
    const newSigner = makeSigner({ keyId: 'new', secret: 's-new' }, crypto);
    const oldEvent = await oldSigner.sign({
      eventId: 'e1',
      eventType: 'x',
      tenantId: tid('t1'),
      tsMs: 1,
      payload: {},
    });
    const newEvent = await newSigner.sign({
      eventId: 'e2',
      eventType: 'x',
      tenantId: tid('t1'),
      tsMs: 2,
      payload: {},
    });
    const verifier = makeMultiKeyVerifier(
      [
        { keyId: 'old', secret: 's-old' },
        { keyId: 'new', secret: 's-new' },
      ],
      crypto,
    );
    expect(await verifier.verify(oldEvent)).toBe(true);
    expect(await verifier.verify(newEvent)).toBe(true);
  });

  it('multi-key verifier rejects unknown keyId', async () => {
    const crypto = realStubCrypto();
    const stranger = makeSigner({ keyId: 'rogue', secret: 's' }, crypto);
    const evt = await stranger.sign({
      eventId: 'e1',
      eventType: 'x',
      tenantId: tid('t1'),
      tsMs: 1,
      payload: {},
    });
    const verifier = makeMultiKeyVerifier([{ keyId: 'good', secret: 's-good' }], crypto);
    expect(await verifier.verify(evt)).toBe(false);
  });

  it('signer.keyId() returns configured id', () => {
    const signer = makeSigner({ keyId: 'k1', secret: 's' }, realStubCrypto());
    expect(signer.keyId()).toBe('k1');
  });
});
