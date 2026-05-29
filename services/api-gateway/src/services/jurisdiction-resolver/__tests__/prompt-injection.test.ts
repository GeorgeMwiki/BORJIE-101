/**
 * JA-2 prompt injection tests.
 *
 * Verifies the brain-prompt helper (resolveJurisdictionForPrompt)
 * returns an empty section when the DB is null + a real section
 * when the resolver succeeds, AND verifies the user-message
 * override flows through correctly.
 */

import { describe, it, expect } from 'vitest';

import { resolveJurisdictionForPrompt } from '../../brain/jurisdiction-prompt.js';

describe('resolveJurisdictionForPrompt', () => {
  it('returns empty section when db is null (degraded mode)', async () => {
    const out = await resolveJurisdictionForPrompt({
      db: null,
      tenantId: 't-1',
      userMessage: 'hello',
      language: 'en',
    });
    expect(out.section).toBe('');
    expect(out.resolved).toBeNull();
    expect(out.detectedOverride).toBeNull();
  });

  it('returns empty section when default-path db.execute throws (no override mentioned)', async () => {
    // No jurisdiction in message → resolver tries tenant-config DB
    // path → DB throws → helper degrades gracefully to empty section.
    const failingDb = {
      async execute() {
        throw new Error('connection refused');
      },
    };
    const out = await resolveJurisdictionForPrompt({
      db: failingDb,
      tenantId: 't-1',
      userMessage: 'what is my royalty rate?',
      language: 'en',
    });
    expect(out.section).toBe('');
    expect(out.resolved).toBeNull();
  });

  it('still resolves override snapshot even when default-path DB is unavailable', async () => {
    // When a jurisdiction IS mentioned the override path takes the
    // static-authorities branch and never touches the DB — so the
    // section still renders even on a failing DB connection.
    const failingDb = {
      async execute() {
        throw new Error('connection refused');
      },
    };
    const out = await resolveJurisdictionForPrompt({
      db: failingDb,
      tenantId: 't-1',
      userMessage: 'in Kenya what is the rate?',
      language: 'en',
    });
    expect(out.detectedOverride).toBe('KE');
    expect(out.resolved?.country).toBe('KE');
    expect(out.resolved?.source).toBe('override');
    expect(out.section).toContain('KE');
  });

  it('detects override and emits a non-empty section with stubbed tenant row', async () => {
    // Build a fake db.execute that returns a TZ tenant row when
    // queried via tenant-config's SELECT shape.
    const fakeDb = {
      async execute() {
        return {
          rows: [
            {
              country_code: 'TZ',
              primary_currency: 'TZS',
              default_language: 'sw',
              regulator_set: 'TZ-set',
              allowed_minerals: ['gold'],
            },
          ],
        };
      },
    };
    const out = await resolveJurisdictionForPrompt({
      db: fakeDb,
      tenantId: 't-1',
      userMessage: 'in Kenya what about royalties?',
      language: 'en',
    });
    expect(out.section).toContain('## TENANT JURISDICTION');
    expect(out.section).toContain('## JURISDICTION DISCLOSURE RULES');
    expect(out.detectedOverride).toBe('KE');
    expect(out.resolved?.country).toBe('KE');
    expect(out.resolved?.source).toBe('override');
  });

  it('uses tenant default when no jurisdiction mentioned in message', async () => {
    const fakeDb = {
      async execute() {
        return {
          rows: [
            {
              country_code: 'TZ',
              primary_currency: 'TZS',
              default_language: 'sw',
              regulator_set: 'TZ-set',
              allowed_minerals: ['gold'],
            },
          ],
        };
      },
    };
    const out = await resolveJurisdictionForPrompt({
      db: fakeDb,
      tenantId: 't-1',
      userMessage: 'what is my royalty rate?',
      language: 'en',
    });
    expect(out.detectedOverride).toBeNull();
    expect(out.resolved?.country).toBe('TZ');
    expect(out.resolved?.source).toBe('tenant');
  });
});
