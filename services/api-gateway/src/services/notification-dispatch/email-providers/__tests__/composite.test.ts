/**
 * Tests for the composite email-provider selector.
 *
 * Asserts the env-var matrix: which combinations of credentials
 * resolve to which adapter (or null), plus the SES_PRIMARY override.
 */
import { describe, it, expect } from 'vitest';

import {
  createConfiguredEmailProvider,
  createConfiguredEmailProviderFromEnv,
} from '../composite';

const SG_ENV = {
  SENDGRID_API_KEY: 'SG.fake',
  SENDGRID_FROM_EMAIL: 'sg@borjie.io',
};
const SES_ENV = {
  AWS_ACCESS_KEY_ID: 'AKIAFAKE',
  AWS_SECRET_ACCESS_KEY: 'fakeSecret',
  AWS_SES_REGION: 'eu-west-1',
  SES_FROM_EMAIL: 'ses@borjie.io',
};

describe('createConfiguredEmailProviderFromEnv', () => {
  it('returns null when no provider envs are present', () => {
    expect(createConfiguredEmailProviderFromEnv({})).toBeNull();
  });

  it('returns SendGrid when only SendGrid env present', () => {
    const p = createConfiguredEmailProviderFromEnv(SG_ENV);
    expect(p?.name).toBe('sendgrid');
  });

  it('returns SES when only SES env present', () => {
    const p = createConfiguredEmailProviderFromEnv(SES_ENV);
    expect(p?.name).toBe('ses');
  });

  it('prefers SendGrid by default when both are configured', () => {
    const p = createConfiguredEmailProviderFromEnv({
      ...SG_ENV,
      ...SES_ENV,
    });
    expect(p?.name).toBe('sendgrid');
  });

  it('flips to SES when SES_PRIMARY=true', () => {
    const p = createConfiguredEmailProviderFromEnv({
      ...SG_ENV,
      ...SES_ENV,
      SES_PRIMARY: 'true',
    });
    expect(p?.name).toBe('ses');
  });

  it('SES_PRIMARY=true with no SES envs still falls back to SendGrid', () => {
    const p = createConfiguredEmailProviderFromEnv({
      ...SG_ENV,
      SES_PRIMARY: 'true',
    });
    expect(p?.name).toBe('sendgrid');
  });
});

describe('createConfiguredEmailProvider (pure)', () => {
  it('returns null when both configs absent', () => {
    expect(createConfiguredEmailProvider({})).toBeNull();
  });

  it('uses sendgrid config when present', () => {
    const p = createConfiguredEmailProvider({
      sendgrid: { apiKey: 'k', fromEmail: 'a@b.io' },
    });
    expect(p?.name).toBe('sendgrid');
  });

  it('uses ses when only ses present', () => {
    const p = createConfiguredEmailProvider({
      ses: {
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        region: 'eu-west-1',
        fromEmail: 'a@b.io',
      },
    });
    expect(p?.name).toBe('ses');
  });

  it('preferSes flips order', () => {
    const p = createConfiguredEmailProvider({
      sendgrid: { apiKey: 'k', fromEmail: 'a@b.io' },
      ses: {
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        region: 'eu-west-1',
        fromEmail: 'a@b.io',
      },
      preferSes: true,
    });
    expect(p?.name).toBe('ses');
  });
});
