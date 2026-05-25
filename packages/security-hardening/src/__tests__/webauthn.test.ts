import { describe, it, expect } from 'vitest';

import { createStubAdapter } from '../webauthn/adapter.js';
import { createWebAuthnService } from '../webauthn/service.js';
import type { WebAuthnCredential } from '../types.js';

function buildService(now = () => 1_000) {
  const adapter = createStubAdapter('seed');
  const svc = createWebAuthnService({
    rpId: 'borjie.test',
    rpName: 'BORJIE Test',
    origin: 'https://app.borjie.test',
    adapter,
    now,
  });
  return { svc, adapter };
}

describe('webauthn / passkeys', () => {
  it('issues registration options bound to the rpId + rpName', async () => {
    const { svc } = buildService();
    const result = await svc.generateRegistrationOptions({
      user: {
        id: 'user-1',
        tenantId: 'tenant-a',
        username: 'george',
        displayName: 'George Mwiki',
      },
    });
    expect(result.options.rp.id).toBe('borjie.test');
    expect(result.options.rp.name).toBe('BORJIE Test');
    expect(result.options.user.id).toBe('user-1');
    expect(result.challenge).toMatch(/^challenge-seed-/);
  });

  it('exclude credentials are passed through to the adapter', async () => {
    const { svc } = buildService();
    const result = await svc.generateRegistrationOptions({
      user: {
        id: 'user-1',
        tenantId: 'tenant-a',
        username: 'george',
        displayName: 'George',
      },
      excludeCredentialIds: ['cred-1', 'cred-2'],
    });
    expect(result.options).toBeDefined();
  });

  it('verifyRegistration tags the credential with the tenantId + userId', async () => {
    const now = () => 5_000;
    const { svc } = buildService(now);
    const reg = await svc.verifyRegistration({
      user: { id: 'user-1', tenantId: 'tenant-a' },
      response: { credentialId: 'cred-abc' },
      expectedChallenge: 'challenge-seed-1',
    });
    expect(reg.ok).toBe(true);
    if (reg.ok) {
      expect(reg.credential.tenantId).toBe('tenant-a');
      expect(reg.credential.userId).toBe('user-1');
      expect(reg.credential.credentialId).toBe('cred-abc');
      expect(reg.credential.createdAt).toBe(5_000);
      expect(reg.credential.deviceType).toBe('multiDevice');
    }
  });

  it('happy-path authentication succeeds + bumps counter + records lastUsedAt', async () => {
    const now = () => 7_777;
    const { svc } = buildService(now);
    const credential: WebAuthnCredential = {
      credentialId: 'cred-1',
      publicKey: 'pk',
      counter: 4,
      tenantId: 'tenant-a',
      userId: 'user-1',
      createdAt: 1_000,
    };
    const auth = await svc.verifyAuthentication({
      user: { id: 'user-1', tenantId: 'tenant-a' },
      response: {},
      expectedChallenge: 'c',
      credential,
    });
    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.credential.counter).toBe(5);
      expect(auth.credential.lastUsedAt).toBe(7_777);
    }
  });

  it('verifyAuthentication REJECTS cross-tenant credential reuse', async () => {
    const { svc } = buildService();
    const credential: WebAuthnCredential = {
      credentialId: 'cred-1',
      publicKey: 'pk',
      counter: 0,
      tenantId: 'tenant-a',
      userId: 'user-1',
      createdAt: 1,
    };
    const auth = await svc.verifyAuthentication({
      // Different tenant — must be rejected even with valid credential.
      user: { id: 'user-1', tenantId: 'tenant-b' },
      response: {},
      expectedChallenge: 'c',
      credential,
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe('tenant_mismatch');
    }
  });

  it('verifyAuthentication REJECTS user mismatch within the same tenant', async () => {
    const { svc } = buildService();
    const credential: WebAuthnCredential = {
      credentialId: 'cred-1',
      publicKey: 'pk',
      counter: 0,
      tenantId: 'tenant-a',
      userId: 'user-1',
      createdAt: 1,
    };
    const auth = await svc.verifyAuthentication({
      user: { id: 'user-2', tenantId: 'tenant-a' },
      response: {},
      expectedChallenge: 'c',
      credential,
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe('user_mismatch');
    }
  });

  it('detects cloned-authenticator (counter does not increase) for singleDevice', async () => {
    const adapter = {
      ...createStubAdapter(),
      async verifyAuthenticationResponse() {
        return {
          verified: true,
          authenticationInfo: { newCounter: 10 },
        } as const;
      },
    };
    const svc = createWebAuthnService({
      rpId: 'r',
      rpName: 'n',
      origin: 'https://x',
      adapter,
    });
    const credential: WebAuthnCredential = {
      credentialId: 'cred-1',
      publicKey: 'pk',
      counter: 10, // same as new counter — cloned
      tenantId: 'tenant-a',
      userId: 'user-1',
      deviceType: 'singleDevice',
      createdAt: 1,
    };
    const auth = await svc.verifyAuthentication({
      user: { id: 'user-1', tenantId: 'tenant-a' },
      response: {},
      expectedChallenge: 'c',
      credential,
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe('counter_not_increasing');
    }
  });

  it('multiDevice credentials skip the counter check (passkey sync)', async () => {
    const adapter = {
      ...createStubAdapter(),
      async verifyAuthenticationResponse() {
        return {
          verified: true,
          authenticationInfo: { newCounter: 0 },
        } as const;
      },
    };
    const svc = createWebAuthnService({
      rpId: 'r',
      rpName: 'n',
      origin: 'https://x',
      adapter,
    });
    const credential: WebAuthnCredential = {
      credentialId: 'cred-1',
      publicKey: 'pk',
      counter: 0,
      tenantId: 'tenant-a',
      userId: 'user-1',
      deviceType: 'multiDevice',
      createdAt: 1,
    };
    const auth = await svc.verifyAuthentication({
      user: { id: 'user-1', tenantId: 'tenant-a' },
      response: {},
      expectedChallenge: 'c',
      credential,
    });
    expect(auth.ok).toBe(true);
  });

  it('returns an explicit error when the adapter says not verified', async () => {
    const adapter = {
      ...createStubAdapter(),
      async verifyAuthenticationResponse() {
        return { verified: false } as const;
      },
    };
    const svc = createWebAuthnService({
      rpId: 'r',
      rpName: 'n',
      origin: 'https://x',
      adapter,
    });
    const credential: WebAuthnCredential = {
      credentialId: 'cred-1',
      publicKey: 'pk',
      counter: 0,
      tenantId: 'tenant-a',
      userId: 'user-1',
      createdAt: 1,
    };
    const auth = await svc.verifyAuthentication({
      user: { id: 'user-1', tenantId: 'tenant-a' },
      response: {},
      expectedChallenge: 'c',
      credential,
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe('authentication_not_verified');
    }
  });
});
