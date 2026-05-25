import { describe, expect, it } from 'vitest';
import { consentCheck } from '../consent.js';

describe('consentCheck', () => {
  it('returns implicit when db has no exec method', async () => {
    const decision = await consentCheck({
      userId: 'u',
      tenantId: 't',
      purpose: 'advisor',
      db: {},
    });
    expect(decision).toBe('implicit');
  });

  it('returns implicit when the user_consent_preferences table is missing', async () => {
    const decision = await consentCheck({
      userId: 'u',
      tenantId: 't',
      purpose: 'advisor',
      db: {
        execute: async () => {
          throw new Error('relation "user_consent_preferences" does not exist');
        },
      },
    });
    expect(decision).toBe('implicit');
  });

  it('returns granted when row records explicit opt-in', async () => {
    const decision = await consentCheck({
      userId: 'u',
      tenantId: 't',
      purpose: 'advisor',
      db: {
        execute: async () => ({ rows: [{ decision: 'granted' }] }),
      },
    });
    expect(decision).toBe('granted');
  });

  it('returns revoked when row records opt-out', async () => {
    const decision = await consentCheck({
      userId: 'u',
      tenantId: 't',
      purpose: 'advisor',
      db: {
        execute: async () => ({ rows: [{ decision: 'revoked' }] }),
      },
    });
    expect(decision).toBe('revoked');
  });

  it('falls back to implicit for unknown decision values', async () => {
    const decision = await consentCheck({
      userId: 'u',
      tenantId: 't',
      purpose: 'advisor',
      db: {
        execute: async () => ({ rows: [{ decision: '???' }] }),
      },
    });
    expect(decision).toBe('implicit');
  });
});
