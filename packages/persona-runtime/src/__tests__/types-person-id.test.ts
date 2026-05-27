/**
 * AuthorizationContext.personId — schema extension tests.
 *
 * Coverage (R8 spec):
 *   - Accepts a valid personId string
 *   - Backwards-compatible — existing callers without personId still
 *     parse successfully
 *   - Rejects empty-string personId (must use `undefined` for absent)
 *
 * Companion to Docs/research/unified-personal-kb.md §5 and
 * `packages/persona-runtime/src/types.ts` (AuthorizationContextSchema).
 */

import { describe, it, expect } from 'vitest';
import { AuthorizationContextSchema } from '../types.js';

describe('AuthorizationContext — personId optional extension', () => {
  it('parses a context WITHOUT personId (backwards compat)', () => {
    const out = AuthorizationContextSchema.parse({
      userId: 'u_1',
      tenantId: 't_abc',
      personaId: 'p_owner',
    });
    expect(out.personId).toBeUndefined();
    expect(out.userId).toBe('u_1');
    expect(out.tenantId).toBe('t_abc');
  });

  it('parses a context WITH personId set', () => {
    const out = AuthorizationContextSchema.parse({
      userId: 'u_1',
      tenantId: 't_abc',
      personaId: 'p_owner',
      personId: 'prs_01HXY',
    });
    expect(out.personId).toBe('prs_01HXY');
  });

  it('rejects empty-string personId — undefined for absent, never ""', () => {
    expect(() =>
      AuthorizationContextSchema.parse({
        userId: 'u_1',
        tenantId: 't_abc',
        personaId: 'p_owner',
        personId: '',
      }),
    ).toThrow();
  });

  it('preserves every existing field when personId is present', () => {
    const out = AuthorizationContextSchema.parse({
      userId: 'u_1',
      tenantId: 't_abc',
      personaId: 'p_owner',
      personId: 'prs_01HXY',
      orgId: 'org_north',
      moduleId: 'production',
      regionId: 'mwanza',
      channel: 'mobile',
      killSwitchOpen: false,
      featureFlags: { 'features.personal_kb': true },
    });
    expect(out.orgId).toBe('org_north');
    expect(out.moduleId).toBe('production');
    expect(out.regionId).toBe('mwanza');
    expect(out.channel).toBe('mobile');
    expect(out.featureFlags['features.personal_kb']).toBe(true);
  });
});
