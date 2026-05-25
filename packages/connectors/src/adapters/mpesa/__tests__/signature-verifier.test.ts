/**
 * signature-verifier — origin verification for Daraja webhooks.
 *
 * Covers constant-time token compare + IP allow-list semantics.
 */

import { describe, it, expect } from 'vitest';
import {
  verifyMpesaWebhookOrigin,
  SAFARICOM_PRODUCTION_IPS,
} from '../signature-verifier.js';

describe('verifyMpesaWebhookOrigin — token match', () => {
  it('accepts a request with matching token and no IP check', () => {
    const r = verifyMpesaWebhookOrigin(
      { presentedToken: 'secret-123' },
      { expectedToken: 'secret-123', allowedIps: [] },
    );
    expect(r.ok).toBe(true);
  });

  it('rejects when presented token differs', () => {
    const r = verifyMpesaWebhookOrigin(
      { presentedToken: 'wrong' },
      { expectedToken: 'secret-123', allowedIps: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not match/);
  });

  it('rejects when presented token length differs (no length leak)', () => {
    const r = verifyMpesaWebhookOrigin(
      { presentedToken: 'shrt' },
      { expectedToken: 'much-longer-secret', allowedIps: [] },
    );
    expect(r.ok).toBe(false);
  });

  it('rejects when presentedToken missing', () => {
    const r = verifyMpesaWebhookOrigin(
      {},
      { expectedToken: 'secret-123', allowedIps: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/missing/);
  });

  it('rejects when expectedToken not configured', () => {
    const r = verifyMpesaWebhookOrigin(
      { presentedToken: 'x' },
      { expectedToken: '', allowedIps: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not configured/);
  });
});

describe('verifyMpesaWebhookOrigin — IP allow-list', () => {
  it('accepts when IP is on the allow-list', () => {
    const okIp = SAFARICOM_PRODUCTION_IPS[0] as string;
    const r = verifyMpesaWebhookOrigin(
      { presentedToken: 'secret-123', remoteIp: okIp },
      { expectedToken: 'secret-123' },
    );
    expect(r.ok).toBe(true);
  });

  it('rejects when IP is missing and allow-list configured', () => {
    const r = verifyMpesaWebhookOrigin(
      { presentedToken: 'secret-123' },
      { expectedToken: 'secret-123' }, // defaults to SAFARICOM_PRODUCTION_IPS
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/remoteIp/);
  });

  it('rejects when IP not on allow-list', () => {
    const r = verifyMpesaWebhookOrigin(
      { presentedToken: 'secret-123', remoteIp: '8.8.8.8' },
      { expectedToken: 'secret-123' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not on Safaricom allow-list/);
  });

  it('skips IP check when allowedIps explicitly empty (sandbox)', () => {
    const r = verifyMpesaWebhookOrigin(
      { presentedToken: 'secret-123', remoteIp: '10.0.0.1' },
      { expectedToken: 'secret-123', allowedIps: [] },
    );
    expect(r.ok).toBe(true);
  });
});
