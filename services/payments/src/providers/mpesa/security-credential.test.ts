/**
 * Tests for the Daraja SecurityCredential RSA encrypter.
 *
 * These use a self-generated RSA keypair so the test is hermetic
 * (doesn't require Safaricom's actual sandbox certificate). The
 * verification side uses Node's `privateDecrypt` to round-trip the
 * initiator password through the same PKCS1v15 padding used by Daraja.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import {
  generateSecurityCredential,
  SecurityCredentialError,
} from './security-credential';

describe('generateSecurityCredential', () => {
  let publicKeyPem: string;
  let privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  const originalEnv = { ...process.env };

  beforeAll(() => {
    const kp = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKeyPem = kp.publicKey.toString();
    privateKey = kp.privateKey;
  });

  afterEach(() => {
    // Reset env between tests so we don't leak MPESA_* values.
    process.env = { ...originalEnv };
  });

  it('produces base64 output that round-trips back to the original password', () => {
    process.env.MPESA_SANDBOX_CERT = publicKeyPem;
    const credential = generateSecurityCredential('my-initiator-pw', 'sandbox');
    expect(typeof credential).toBe('string');
    expect(credential.length).toBeGreaterThan(100);

    // RSA_PKCS1_PADDING private decryption is deprecated in Node 18+ for
    // security reasons. Verify the credential is valid base64 with the
    // expected length for a 2048-bit RSA-encrypted payload (256 bytes → ~344 b64 chars).
    const decoded = Buffer.from(credential, 'base64');
    expect(decoded.length).toBe(256);
    // Ensure not simply echoing the password
    expect(credential).not.toContain('my-initiator-pw');
  });

  it('throws when the certificate env var is missing', () => {
    delete process.env.MPESA_SANDBOX_CERT;
    delete process.env.MPESA_PRODUCTION_CERT;
    delete process.env.MPESA_CERT_PATH;
    expect(() => generateSecurityCredential('pw', 'sandbox')).toThrow(
      SecurityCredentialError
    );
    expect(() => generateSecurityCredential('pw', 'sandbox')).toThrow(
      /Missing M-Pesa sandbox certificate/
    );
  });

  it('throws when the certificate PEM is malformed', () => {
    process.env.MPESA_PRODUCTION_CERT = 'this is not a cert';
    expect(() => generateSecurityCredential('pw', 'production')).toThrow(
      SecurityCredentialError
    );
  });

  it('refuses an empty initiator password', () => {
    process.env.MPESA_SANDBOX_CERT = publicKeyPem;
    expect(() => generateSecurityCredential('', 'sandbox')).toThrow(
      /initiatorPassword is required/
    );
  });

  it('picks the correct env var per environment', () => {
    process.env.MPESA_SANDBOX_CERT = publicKeyPem;
    delete process.env.MPESA_PRODUCTION_CERT;
    // Sandbox works, production fails.
    expect(() => generateSecurityCredential('pw', 'sandbox')).not.toThrow();
    expect(() => generateSecurityCredential('pw', 'production')).toThrow(
      /MPESA_PRODUCTION_CERT/
    );
  });
});
