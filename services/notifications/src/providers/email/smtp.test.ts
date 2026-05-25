/**
 * SmtpProvider — fromEmail guard tests.
 *
 * The send() method now refuses to ship mail without an explicit
 * fromEmail (tenant config OR NOTIFICATIONS_FROM_EMAIL env).  The
 * previous fallback to `noreply@borjie.com` risked misattributing
 * outbound mail from an unowned domain.  These tests lock in the new
 * fail-closed behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SmtpProvider, type SmtpConfig } from './smtp.js';

// Tenants use an opaque string id; cast via `as unknown` for the test.
const TENANT_A = 'tenant-a' as unknown as Parameters<
  SmtpProvider['send']
>[0]['tenantId'];

describe('SmtpProvider.send — fromEmail guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('refuses to send when neither tenant fromEmail nor NOTIFICATIONS_FROM_EMAIL is set', async () => {
    delete process.env.NOTIFICATIONS_FROM_EMAIL;
    const cfg: SmtpConfig = { host: 'localhost', port: 587 };
    SmtpProvider.registerConfig(TENANT_A, cfg);
    const provider = new SmtpProvider();

    const result = await provider.send({
      tenantId: TENANT_A,
      to: 'test@example.com',
      subject: 'hi',
      body: 'hello',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/fromEmail not configured/i);
  });

  it('still refuses to send when tenant is not registered at all', async () => {
    const provider = new SmtpProvider();
    const result = await provider.send({
      tenantId: 'ghost-tenant' as unknown as Parameters<SmtpProvider['send']>[0]['tenantId'],
      to: 'test@example.com',
      subject: 'hi',
      body: 'hello',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  it('isConfigured reflects registered tenants', () => {
    const provider = new SmtpProvider();
    SmtpProvider.registerConfig(TENANT_A, { host: 'localhost' });
    expect(provider.isConfigured(TENANT_A)).toBe(true);
    expect(
      provider.isConfigured(
        'unknown' as unknown as Parameters<SmtpProvider['send']>[0]['tenantId']
      )
    ).toBe(false);
  });
});
