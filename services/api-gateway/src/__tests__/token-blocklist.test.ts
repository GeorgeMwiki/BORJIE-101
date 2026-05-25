/**
 * Token blocklist tests.
 *
 * The blocklist is what makes /auth/logout and refresh-token rotation
 * actually mean something — without it, a revoked JWT is still valid
 * until its exp. These tests lock in the isRevoked/revoke/TTL contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { tokenBlocklist } from '../middleware/token-blocklist';

describe('tokenBlocklist', () => {
  beforeEach(() => {
    tokenBlocklist.clear();
  });

  it('returns false for jti never revoked', () => {
    expect(tokenBlocklist.isRevoked('never-revoked')).toBe(false);
  });

  it('returns true for a revoked jti within its TTL', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    tokenBlocklist.revoke('jti-abc', futureExp);
    expect(tokenBlocklist.isRevoked('jti-abc')).toBe(true);
  });

  it('expires the blocklist entry after the exp passes', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    tokenBlocklist.revoke('jti-old', pastExp);
    expect(tokenBlocklist.isRevoked('jti-old')).toBe(false);
  });

  it('distinguishes between jtis', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    tokenBlocklist.revoke('jti-a', futureExp);
    expect(tokenBlocklist.isRevoked('jti-a')).toBe(true);
    expect(tokenBlocklist.isRevoked('jti-b')).toBe(false);
  });

  it('clear() empties the blocklist', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    tokenBlocklist.revoke('jti-clear', futureExp);
    expect(tokenBlocklist.isRevoked('jti-clear')).toBe(true);
    tokenBlocklist.clear();
    expect(tokenBlocklist.isRevoked('jti-clear')).toBe(false);
  });
});
