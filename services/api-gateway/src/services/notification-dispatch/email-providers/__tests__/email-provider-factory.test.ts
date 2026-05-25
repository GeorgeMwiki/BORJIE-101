/**
 * Tests for the env-aware factory exported from email-provider.ts.
 *
 * The factory must always return *some* EmailProvider so the
 * dispatcher can wire deterministically; missing env => stub.
 */
import { describe, it, expect } from 'vitest';

import {
  createEmailProviderFromEnv,
  createStubEmailProvider,
} from '../../email-provider';

describe('createEmailProviderFromEnv', () => {
  it('returns the stub when no provider envs are set', () => {
    const provider = createEmailProviderFromEnv({});
    expect(provider.name).toBe('stub-email');
    expect(provider.configured).toBe(false);
  });

  it('returns SendGrid when SendGrid envs are set', () => {
    const provider = createEmailProviderFromEnv({
      SENDGRID_API_KEY: 'SG.fake',
      SENDGRID_FROM_EMAIL: 'a@b.io',
    });
    expect(provider.name).toBe('sendgrid');
    expect(provider.configured).toBe(true);
  });

  it('returns SES when only SES envs are set', () => {
    const provider = createEmailProviderFromEnv({
      AWS_ACCESS_KEY_ID: 'AK',
      AWS_SECRET_ACCESS_KEY: 'SK',
      AWS_SES_REGION: 'eu-west-1',
      SES_FROM_EMAIL: 'a@b.io',
    });
    expect(provider.name).toBe('ses');
  });

  it('stub still emits a failed result with provider_not_configured (regression)', async () => {
    const stub = createStubEmailProvider();
    const result = await stub.send({
      tenantId: 'tenant-A',
      recipientAddress: 'a@b.io',
      templateKey: 'k',
      locale: 'en',
      payload: {},
      idempotencyKey: null,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('provider_not_configured');
      expect(result.retryable).toBe(true);
    }
  });
});
