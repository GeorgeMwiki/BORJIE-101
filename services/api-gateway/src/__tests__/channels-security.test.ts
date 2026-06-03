/**
 * Channel-ingress security tests (spoof-hardening blocker fix).
 *
 *   - A channel-resolved phone can never inherit owner/manager authority:
 *     the directory tier is CLAMPED to a member tier for the brain turn.
 *   - The optional `BORJIE_AT_IP_ALLOWLIST` gate rejects Africa's-Talking
 *     inbound from un-listed source IPs and is a no-op when unset.
 */

import { describe, it, expect } from 'vitest';
import { __testables } from '../routes/channels.hono.js';

const { buildTierResolver, clampChannelTier, passesAtIpAllowlist } = __testables;

describe('clampChannelTier — privileged tiers demoted', () => {
  it('demotes owner -> employee', () => {
    expect(clampChannelTier('owner')).toBe('employee');
  });

  it('demotes manager -> employee', () => {
    expect(clampChannelTier('manager')).toBe('employee');
  });

  it('passes through already-non-privileged tiers unchanged', () => {
    expect(clampChannelTier('employee')).toBe('employee');
    expect(clampChannelTier('buyer')).toBe('buyer');
    expect(clampChannelTier('anonymous')).toBe('anonymous');
  });
});

describe('buildTierResolver — spoofed phone cannot inherit owner authority', () => {
  it('resolves tenant/actor scope but CLAMPS an owner directory entry', async () => {
    const resolver = buildTierResolver({
      CHANNEL_PHONE_DIRECTORY: '+255700000001=tenant-1:actor-9:owner',
    });
    const resolved = await resolver.resolve({ phone: '+255700000001' });
    // Scope preserved for cross-channel coherence...
    expect(resolved.tenantId).toBe('tenant-1');
    expect(resolved.actorId).toBe('actor-9');
    // ...but the privileged tier is NEVER honoured for the brain turn.
    expect(resolved.tier).toBe('employee');
    expect(resolved.tier).not.toBe('owner');
  });

  it('clamps a manager directory entry to employee', async () => {
    const resolver = buildTierResolver({
      CHANNEL_PHONE_DIRECTORY: '+255700000002=tenant-2::manager',
    });
    const resolved = await resolver.resolve({ phone: '+255700000002' });
    expect(resolved.tier).toBe('employee');
  });

  it('keeps a buyer directory entry as buyer (already non-privileged)', async () => {
    const resolver = buildTierResolver({
      CHANNEL_EMAIL_DIRECTORY: 'buyer@example.com=tenant-3::buyer',
    });
    const resolved = await resolver.resolve({ email: 'buyer@example.com' });
    expect(resolved.tier).toBe('buyer');
  });

  it('an unknown sender stays anonymous with null scope', async () => {
    const resolver = buildTierResolver({});
    const resolved = await resolver.resolve({ phone: '+255700000099' });
    expect(resolved.tenantId).toBeNull();
    expect(resolved.tier).toBe('anonymous');
  });
});

describe('passesAtIpAllowlist — defence-in-depth IP gate', () => {
  const empty = new Set<string>();
  const allow = new Set<string>(['1.2.3.4', '5.6.7.8']);

  it('passes when the allowlist is empty (feature disabled)', () => {
    expect(
      passesAtIpAllowlist({ channel: 'ussd', allowlist: empty, headers: {} }),
    ).toBe(true);
  });

  it('passes a non-Africa-s-Talking channel regardless of allowlist', () => {
    expect(
      passesAtIpAllowlist({ channel: 'web', allowlist: allow, headers: {} }),
    ).toBe(true);
  });

  it('rejects an Africa-s-Talking channel with no source IP when configured', () => {
    expect(
      passesAtIpAllowlist({ channel: 'sms', allowlist: allow, headers: {} }),
    ).toBe(false);
  });

  it('rejects an un-listed source IP', () => {
    expect(
      passesAtIpAllowlist({
        channel: 'voice',
        allowlist: allow,
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
    ).toBe(false);
  });

  it('accepts a listed source IP (cf-connecting-ip preferred)', () => {
    expect(
      passesAtIpAllowlist({
        channel: 'ussd',
        allowlist: allow,
        headers: { 'cf-connecting-ip': '1.2.3.4' },
      }),
    ).toBe(true);
  });

  it('accepts a listed left-most x-forwarded-for hop', () => {
    expect(
      passesAtIpAllowlist({
        channel: 'sms',
        allowlist: allow,
        headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' },
      }),
    ).toBe(true);
  });
});
