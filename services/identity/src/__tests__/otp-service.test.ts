/**
 * Unit tests for OtpService.
 *
 * Covers: happy-path verify, TTL expiry, mismatch counter, too-many-attempts,
 * single-use consumption, dispatcher failure rollback.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryOtpStore,
  OtpService,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  type SmsDispatcher,
} from '../otp/otp-service.js';
import type { TenantIdentityId } from '@borjie/domain-models';

const ID = 'tid_1' as TenantIdentityId;

function capturedDispatcher() {
  const sent: Array<{ phone: string; message: string }> = [];
  const dispatcher: SmsDispatcher = {
    async send(phone, message) {
      sent.push({ phone, message });
    },
  };
  return { dispatcher, sent };
}

function extractCode(message: string): string {
  const m = message.match(/(\d{6})/);
  if (!m) throw new Error(`no 6-digit code in "${message}"`);
  return m[1];
}

describe('OtpService', () => {
  it('verifies the code sent by send() (happy path)', async () => {
    const { dispatcher, sent } = capturedDispatcher();
    const svc = new OtpService(new InMemoryOtpStore(), dispatcher);
    await svc.send(ID, '+255712345678');
    const code = extractCode(sent[0].message);
    const result = await svc.verify(ID, code);
    expect(result.verified).toBe(true);
  });

  it('is single-use: the second verify with the same code fails NO_CODE', async () => {
    const { dispatcher, sent } = capturedDispatcher();
    const svc = new OtpService(new InMemoryOtpStore(), dispatcher);
    await svc.send(ID, '+255712345678');
    const code = extractCode(sent[0].message);
    await svc.verify(ID, code);
    const again = await svc.verify(ID, code);
    expect(again).toEqual({ verified: false, reason: 'NO_CODE' });
  });

  it('returns EXPIRED when the TTL elapses', async () => {
    const { dispatcher, sent } = capturedDispatcher();
    let now = 1_000_000;
    const svc = new OtpService(
      new InMemoryOtpStore(),
      dispatcher,
      () => now,
      OTP_TTL_MS
    );
    await svc.send(ID, '+255712345678');
    const code = extractCode(sent[0].message);
    now += OTP_TTL_MS + 1;
    const result = await svc.verify(ID, code);
    expect(result).toEqual({ verified: false, reason: 'EXPIRED' });
  });

  it('counts wrong attempts and invalidates after OTP_MAX_ATTEMPTS', async () => {
    const { dispatcher } = capturedDispatcher();
    const svc = new OtpService(new InMemoryOtpStore(), dispatcher);
    await svc.send(ID, '+255712345678');
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
      const r = await svc.verify(ID, '000000');
      expect(r.reason).toBe('MISMATCH');
    }
    // Final attempt pushes over the edge and returns TOO_MANY_ATTEMPTS.
    const final = await svc.verify(ID, '000000');
    expect(final.reason).toBe('TOO_MANY_ATTEMPTS');
    // Subsequent attempts see NO_CODE since the record was purged.
    const after = await svc.verify(ID, '000000');
    expect(after.reason).toBe('NO_CODE');
  });

  it('returns NO_CODE when verify is called without a prior send', async () => {
    const svc = new OtpService();
    const r = await svc.verify(ID, '123456');
    expect(r).toEqual({ verified: false, reason: 'NO_CODE' });
  });

  it('rolls back the stored record when the SMS dispatcher throws', async () => {
    const store = new InMemoryOtpStore();
    const dispatcher: SmsDispatcher = {
      send: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const svc = new OtpService(store, dispatcher);
    await expect(svc.send(ID, '+255712345678')).rejects.toThrow(/network down/);
    expect(await store.get(ID)).toBeUndefined();
  });

  it('throws when phone is empty', async () => {
    const svc = new OtpService();
    await expect(svc.send(ID, '')).rejects.toThrow(/phone is required/);
  });
});
