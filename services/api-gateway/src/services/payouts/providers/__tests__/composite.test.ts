/**
 * Tests for the composite payout router.
 */
import { describe, it, expect, vi } from 'vitest';

import { createCompositePayoutProvider } from '../composite';
import type { PayoutProvider, PayoutProviderInput } from '../../stub-payout-provider';

function fake(name: string): PayoutProvider {
  return {
    send: vi.fn(async (input: PayoutProviderInput) => ({
      providerRef: `${name}_${input.idempotencyKey}`,
      status: 'completed' as const,
    })),
  };
}

const KES_INPUT: PayoutProviderInput = {
  tenantId: 'tenant-1',
  ownerId: 'owner-1',
  amountMinor: 100_000,
  currency: 'KES',
  destination: '254712345678',
  idempotencyKey: 'k1',
};

describe('createCompositePayoutProvider', () => {
  it('returns null when no adapters are wired', () => {
    expect(createCompositePayoutProvider({})).toBeNull();
  });

  it('routes KES + msisdn to Mpesa', async () => {
    const mpesa = fake('mpesa');
    const eft = fake('eft');
    const provider = createCompositePayoutProvider({ mpesa, eft });
    expect(provider).not.toBeNull();
    const result = await provider!.send(KES_INPUT);
    expect(result.providerRef).toBe('mpesa_k1');
    expect(mpesa.send).toHaveBeenCalled();
    expect(eft.send).not.toHaveBeenCalled();
  });

  it('routes KES + non-msisdn destination to EFT', async () => {
    const mpesa = fake('mpesa');
    const eft = fake('eft');
    const provider = createCompositePayoutProvider({ mpesa, eft });
    const result = await provider!.send({ ...KES_INPUT, destination: 'iban:KE123' });
    expect(result.providerRef).toBe('eft_k1');
    expect(mpesa.send).not.toHaveBeenCalled();
  });

  it('routes non-KES currency to EFT regardless of destination format', async () => {
    const mpesa = fake('mpesa');
    const eft = fake('eft');
    const provider = createCompositePayoutProvider({ mpesa, eft });
    const result = await provider!.send({ ...KES_INPUT, currency: 'TZS' });
    expect(result.providerRef).toBe('eft_k1');
    expect(mpesa.send).not.toHaveBeenCalled();
  });

  it('uses Mpesa-only when EFT is not wired and the row is Mpesa-eligible', async () => {
    const mpesa = fake('mpesa');
    const provider = createCompositePayoutProvider({ mpesa });
    const result = await provider!.send(KES_INPUT);
    expect(result.providerRef).toBe('mpesa_k1');
  });

  it('fails-loudly when only Mpesa is wired and the row is not Mpesa-eligible', async () => {
    const mpesa = fake('mpesa');
    const provider = createCompositePayoutProvider({ mpesa });
    const result = await provider!.send({ ...KES_INPUT, currency: 'TZS' });
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('composite_no_adapter_for_TZS');
    expect(mpesa.send).not.toHaveBeenCalled();
  });

  it('uses EFT-only when Mpesa is not wired', async () => {
    const eft = fake('eft');
    const provider = createCompositePayoutProvider({ eft });
    const result = await provider!.send(KES_INPUT);
    expect(result.providerRef).toBe('eft_k1');
  });
});
