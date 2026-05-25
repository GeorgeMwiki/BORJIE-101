/**
 * AuditContext — request-scoped audit context.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAuditContext,
  setAuditContext,
  clearAuditContext,
  withAuditContext,
} from '../audit-context.js';

beforeEach(() => {
  clearAuditContext();
});

describe('getAuditContext', () => {
  it('returns null fields by default', () => {
    const ctx = getAuditContext();
    expect(ctx.userId).toBeNull();
    expect(ctx.userEmail).toBeNull();
    expect(ctx.ipAddress).toBeNull();
    expect(ctx.userAgent).toBeNull();
  });

  it('returns a fresh copy each call (no mutation leak)', () => {
    const a = getAuditContext();
    const b = getAuditContext();
    expect(a).not.toBe(b);
  });
});

describe('setAuditContext', () => {
  it('merges new fields with existing', () => {
    setAuditContext({ userId: 'u1' });
    setAuditContext({ ipAddress: '1.2.3.4' });
    const ctx = getAuditContext();
    expect(ctx.userId).toBe('u1');
    expect(ctx.ipAddress).toBe('1.2.3.4');
  });

  it('overwrites a previously set field', () => {
    setAuditContext({ userId: 'u1' });
    setAuditContext({ userId: 'u2' });
    expect(getAuditContext().userId).toBe('u2');
  });
});

describe('clearAuditContext', () => {
  it('resets to defaults', () => {
    setAuditContext({ userId: 'u1', userEmail: 'a@x.com' });
    clearAuditContext();
    const ctx = getAuditContext();
    expect(ctx.userId).toBeNull();
    expect(ctx.userEmail).toBeNull();
  });
});

describe('withAuditContext', () => {
  it('applies context only inside the scope', async () => {
    setAuditContext({ userId: 'outer' });
    const inside = await withAuditContext({ userId: 'inner' }, async () => {
      return getAuditContext().userId;
    });
    expect(inside).toBe('inner');
    expect(getAuditContext().userId).toBe('outer');
  });

  it('restores context even when fn throws', async () => {
    setAuditContext({ userId: 'outer' });
    await expect(
      withAuditContext({ userId: 'inner' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(getAuditContext().userId).toBe('outer');
  });

  it('returns the value from fn', async () => {
    const result = await withAuditContext({ userId: 'u' }, async () => 42);
    expect(result).toBe(42);
  });
});
