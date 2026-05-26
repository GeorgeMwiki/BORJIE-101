/**
 * Consent manager — grant / revoke / isGranted.
 */

import { describe, expect, it } from 'vitest';
import {
  createConsentManager,
  createInMemoryTacitConsentRepository,
} from '../index.js';

describe('consent manager', () => {
  it('returns false when no consent row exists for the subject', async () => {
    const repo = createInMemoryTacitConsentRepository();
    const consent = createConsentManager(repo);
    const granted = await consent.isGranted('subj-1', 'tnt-1');
    expect(granted).toBe(false);
  });

  it('grants consent and reports it as granted', async () => {
    const repo = createInMemoryTacitConsentRepository();
    const consent = createConsentManager(repo);
    const row = await consent.grant('subj-1', 'tnt-1');
    expect(row.status).toBe('granted');
    expect(row.revokedAt).toBeNull();
    expect(row.auditHash.length).toBeGreaterThan(0);
    expect(await consent.isGranted('subj-1', 'tnt-1')).toBe(true);
  });

  it('revoke blocks subsequent isGranted checks and chains the audit hash', async () => {
    const repo = createInMemoryTacitConsentRepository();
    const consent = createConsentManager(repo);
    const granted = await consent.grant('subj-1', 'tnt-1');
    const revoked = await consent.revoke('subj-1', 'tnt-1');
    expect(revoked).not.toBeNull();
    expect(revoked!.status).toBe('revoked');
    expect(revoked!.revokedAt).not.toBeNull();
    // Audit chain advanced — new hash must differ from the grant hash.
    expect(revoked!.auditHash).not.toBe(granted.auditHash);
    expect(await consent.isGranted('subj-1', 'tnt-1')).toBe(false);
  });

  it('revoke on missing subject returns null without creating a row', async () => {
    const repo = createInMemoryTacitConsentRepository();
    const consent = createConsentManager(repo);
    const result = await consent.revoke('subj-ghost', 'tnt-1');
    expect(result).toBeNull();
    expect(await consent.isGranted('subj-ghost', 'tnt-1')).toBe(false);
  });
});
