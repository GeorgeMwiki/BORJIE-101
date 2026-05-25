/**
 * Tests for Ed25519 / stub signing on Agent Cards.
 *
 * The stub is deterministic — sign() returns the same value for the same
 * (message, key) pair — so we can assert exact equality across calls.
 */
import { describe, expect, it } from 'vitest';
import { buildAgentCard, type A2AAgentCardInput } from '../agent-card.js';
import {
  generateStubKey,
  loadSigningKeyFromEnv,
  signAgentCard,
  verifyAgentCard,
} from '../agent-card-signer.js';

function fixture(): A2AAgentCardInput {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'd',
    version: '1.0.0',
    capabilities: [],
    skills: [],
    authentication: { schemes: ['bearer'] },
    endpoints: { tasks: 'https://api.example.com/a2a/tasks' },
  };
}

describe('signAgentCard', () => {
  it('attaches an ed25519 signature block', async () => {
    const key = generateStubKey('test-key-1');
    const card = buildAgentCard(fixture());
    const signed = await signAgentCard(card, {
      key,
      now: () => new Date('2026-05-23T00:00:00Z'),
    });
    expect(signed.signature).toBeDefined();
    expect(signed.signature?.algorithm).toBe('ed25519');
    expect(signed.signature?.keyId).toBe('test-key-1');
    expect(signed.signature?.signedAt).toBe('2026-05-23T00:00:00.000Z');
    expect(signed.signature?.value).toMatch(/^[0-9a-f]+$/);
    expect(signed.signature?.value.length).toBeGreaterThan(0);
  });

  it('returns a NEW card (immutability)', async () => {
    const key = generateStubKey('k');
    const card = buildAgentCard(fixture());
    const signed = await signAgentCard(card, { key });
    expect(signed).not.toBe(card);
    expect(card.signature).toBeUndefined();
  });

  it('is deterministic for the same key + same card', async () => {
    const key = generateStubKey('det');
    const card = buildAgentCard(fixture());
    const a = await signAgentCard(card, {
      key,
      now: () => new Date('2026-05-23T00:00:00Z'),
    });
    const b = await signAgentCard(card, {
      key,
      now: () => new Date('2026-05-23T00:00:00Z'),
    });
    expect(a.signature?.value).toBe(b.signature?.value);
  });

  it('produces different signatures for different cards', async () => {
    const key = generateStubKey('k');
    const a = await signAgentCard(buildAgentCard(fixture()), { key });
    const b = await signAgentCard(
      buildAgentCard({ ...fixture(), version: '2.0.0' }),
      { key },
    );
    expect(a.signature?.value).not.toBe(b.signature?.value);
  });
});

describe('verifyAgentCard', () => {
  it('verifies a card signed with the matching key', async () => {
    const key = generateStubKey('verify-1');
    const signed = await signAgentCard(buildAgentCard(fixture()), { key });
    const ok = await verifyAgentCard(signed, key.publicKey);
    expect(ok).toBe(true);
  });

  it('rejects a card signed with a different key', async () => {
    const keyA = generateStubKey('A');
    const keyB = generateStubKey('B');
    const signed = await signAgentCard(buildAgentCard(fixture()), { key: keyA });
    const ok = await verifyAgentCard(signed, keyB.publicKey);
    expect(ok).toBe(false);
  });

  it('rejects a card with a tampered signature value', async () => {
    const key = generateStubKey('tamper');
    const signed = await signAgentCard(buildAgentCard(fixture()), { key });
    const tampered = {
      ...signed,
      signature: {
        ...signed.signature!,
        // flip the first byte
        value:
          (signed.signature!.value[0] === '0' ? '1' : '0') +
          signed.signature!.value.slice(1),
      },
    };
    const ok = await verifyAgentCard(tampered, key.publicKey);
    expect(ok).toBe(false);
  });

  it('returns false for a card without a signature', async () => {
    const card = buildAgentCard(fixture());
    const ok = await verifyAgentCard(card, generateStubKey('x').publicKey);
    expect(ok).toBe(false);
  });
});

describe('loadSigningKeyFromEnv', () => {
  it('returns null when env vars are missing', () => {
    expect(loadSigningKeyFromEnv({})).toBeNull();
    expect(
      loadSigningKeyFromEnv({ A2A_SIGNING_KEY_ID: 'k' }),
    ).toBeNull();
  });

  it('returns a key when all three env vars are set', () => {
    const key = loadSigningKeyFromEnv({
      A2A_SIGNING_KEY_ID: 'kid',
      A2A_SIGNING_KEY_PRIVATE: 'aa',
      A2A_SIGNING_KEY_PUBLIC: 'bb',
    });
    expect(key).not.toBeNull();
    expect(key?.keyId).toBe('kid');
    expect(key?.privateKey).toBe('aa');
    expect(key?.publicKey).toBe('bb');
  });
});
