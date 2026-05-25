/**
 * Tests for the payout-provider port + env-driven composition.
 */
import { describe, it, expect } from 'vitest';

import {
  createPayoutProviderFromEnv,
  createStubPayoutProvider,
  resolvePayoutProvider,
} from '../stub-payout-provider';

const FULL_MPESA_ENV = {
  MPESA_API_HOST: 'sandbox.safaricom.co.ke',
  MPESA_CONSUMER_KEY: 'CK',
  MPESA_CONSUMER_SECRET: 'CS',
  MPESA_B2C_INITIATOR_NAME: 'INIT',
  MPESA_B2C_SECURITY_CREDENTIAL: 'CRED',
  MPESA_B2C_SHORTCODE: '600000',
  MPESA_B2C_QUEUE_TIMEOUT_URL: 'https://example.com/timeout',
  MPESA_B2C_RESULT_URL: 'https://example.com/result',
};

describe('createStubPayoutProvider', () => {
  it('always returns a completed result with a stub_-prefixed providerRef', async () => {
    const provider = createStubPayoutProvider();
    const result = await provider.send({
      tenantId: 't',
      ownerId: 'o',
      amountMinor: 1,
      currency: 'KES',
      destination: '254712345678',
      idempotencyKey: 'idem-stub',
    });
    expect(result.status).toBe('completed');
    expect(result.providerRef).toContain('stub_');
    expect(result.providerRef).toContain('idem-stub');
  });
});

describe('createPayoutProviderFromEnv', () => {
  it('returns null when no rail is configured', () => {
    expect(createPayoutProviderFromEnv({})).toBeNull();
  });

  it('returns a real provider when the full Mpesa block is configured', () => {
    const provider = createPayoutProviderFromEnv(FULL_MPESA_ENV);
    expect(provider).not.toBeNull();
    expect(typeof provider?.send).toBe('function');
  });

  it('returns null when the Mpesa block is partially configured', () => {
    const partial = { ...FULL_MPESA_ENV, MPESA_B2C_SECURITY_CREDENTIAL: '' };
    expect(createPayoutProviderFromEnv(partial)).toBeNull();
  });

  it('returns an EFT-only provider when PAYOUTS_EFT_ENABLED=true and no Mpesa', () => {
    const provider = createPayoutProviderFromEnv({ PAYOUTS_EFT_ENABLED: 'true' });
    expect(provider).not.toBeNull();
  });
});

describe('resolvePayoutProvider', () => {
  it('falls back to the stub when no rail is configured', async () => {
    const provider = resolvePayoutProvider({});
    const result = await provider.send({
      tenantId: 't',
      ownerId: 'o',
      amountMinor: 1,
      currency: 'KES',
      destination: '254712345678',
      idempotencyKey: 'fallback',
    });
    expect(result.status).toBe('completed');
    expect(result.providerRef).toContain('stub_');
  });

  it('returns the env-derived provider when Mpesa is configured', async () => {
    const provider = resolvePayoutProvider(FULL_MPESA_ENV);
    expect(typeof provider.send).toBe('function');
  });
});
