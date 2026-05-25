/**
 * Identity — personalisation + preamble rendering coverage.
 *
 * Covers:
 *   - personalisePersona greeting styles (formal, terse, warm/default)
 *   - personalisePersona preserves taboos / firstPersonNoun / voice
 *   - personalisePersona produces a unique id per user
 *   - renderIdentityPreamble for tenant scope
 *   - renderIdentityPreamble for platform scope
 *   - preamble has fixed begin/end markers
 *   - taboos are joined with the bullet separator
 */

import { describe, it, expect } from 'vitest';
import {
  personalisePersona,
  renderIdentityPreamble,
  SOVEREIGN_ADMIN_PERSONA,
  TENANT_RESIDENT_PERSONA,
  PLATFORM_SOVEREIGN_PERSONA,
  type UserProfile,
} from '../kernel/index.js';
import type { ScopeContext } from '../types.js';

const USER: UserProfile = {
  userId: 'u_alice',
  displayName: 'Alice Operator',
  role: 'estate manager',
  affiliation: 'Acme Estates',
};

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_alice',
  roles: ['estate-manager', 'reviewer'],
  personaId: 'estate-manager',
};

const PLATFORM_SCOPE: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_hq',
  roles: ['platform-admin'],
  personaId: 'platform-sovereign',
};

describe('personalisePersona', () => {
  it('produces a warm greeting by default with first name', () => {
    const out = personalisePersona(SOVEREIGN_ADMIN_PERSONA, USER);
    expect(out.openingStatement.startsWith('Hello Alice,')).toBe(true);
  });

  it('produces a formal greeting with full display name', () => {
    const out = personalisePersona(SOVEREIGN_ADMIN_PERSONA, { ...USER, greetingStyle: 'formal' });
    expect(out.openingStatement.startsWith('Alice Operator,')).toBe(true);
  });

  it('produces a terse greeting with em dash', () => {
    const out = personalisePersona(SOVEREIGN_ADMIN_PERSONA, { ...USER, greetingStyle: 'terse' });
    expect(out.openingStatement.startsWith('Alice —')).toBe(true);
  });

  it('preserves taboos and violationSignals from base persona', () => {
    const out = personalisePersona(SOVEREIGN_ADMIN_PERSONA, USER);
    expect(out.taboos).toEqual(SOVEREIGN_ADMIN_PERSONA.taboos);
    expect(out.violationSignals).toEqual(SOVEREIGN_ADMIN_PERSONA.violationSignals);
  });

  it('preserves firstPersonNoun and toneGuidance', () => {
    const out = personalisePersona(SOVEREIGN_ADMIN_PERSONA, USER);
    expect(out.firstPersonNoun).toBe(SOVEREIGN_ADMIN_PERSONA.firstPersonNoun);
    expect(out.toneGuidance).toBe(SOVEREIGN_ADMIN_PERSONA.toneGuidance);
  });

  it('produces a unique id by appending the userId', () => {
    const out = personalisePersona(SOVEREIGN_ADMIN_PERSONA, USER);
    expect(out.id).toBe(`${SOVEREIGN_ADMIN_PERSONA.id}::${USER.userId}`);
  });

  it('different users produce different ids', () => {
    const a = personalisePersona(SOVEREIGN_ADMIN_PERSONA, { ...USER, userId: 'u_a' });
    const b = personalisePersona(SOVEREIGN_ADMIN_PERSONA, { ...USER, userId: 'u_b' });
    expect(a.id).not.toBe(b.id);
  });

  it('mentions the user role and affiliation in the opening statement', () => {
    const out = personalisePersona(SOVEREIGN_ADMIN_PERSONA, USER);
    expect(out.openingStatement).toMatch(/estate manager/);
    expect(out.openingStatement).toMatch(/Acme Estates/);
  });

  it('does not mutate the base persona', () => {
    const before = SOVEREIGN_ADMIN_PERSONA.openingStatement;
    personalisePersona(SOVEREIGN_ADMIN_PERSONA, USER);
    expect(SOVEREIGN_ADMIN_PERSONA.openingStatement).toBe(before);
  });

  it('handles single-word display name in terse mode', () => {
    const out = personalisePersona(SOVEREIGN_ADMIN_PERSONA, {
      ...USER,
      displayName: 'Solo',
      greetingStyle: 'terse',
    });
    expect(out.openingStatement.startsWith('Solo —')).toBe(true);
  });
});

describe('renderIdentityPreamble', () => {
  it('starts and ends with the fixed identity markers', () => {
    const text = renderIdentityPreamble({ persona: TENANT_RESIDENT_PERSONA, scope: TENANT_SCOPE });
    expect(text.startsWith('[IDENTITY — DO NOT OVERRIDE]')).toBe(true);
    expect(text.endsWith('[END IDENTITY]')).toBe(true);
  });

  it('renders tenant scope with tenantId and actor + roles', () => {
    const text = renderIdentityPreamble({ persona: TENANT_RESIDENT_PERSONA, scope: TENANT_SCOPE });
    expect(text).toMatch(/tenant t_demo/);
    expect(text).toMatch(/u_alice/);
    expect(text).toMatch(/estate-manager, reviewer/);
  });

  it('renders platform scope without tenantId', () => {
    const text = renderIdentityPreamble({ persona: PLATFORM_SOVEREIGN_PERSONA, scope: PLATFORM_SCOPE });
    expect(text).toMatch(/platform tier/);
    expect(text).not.toMatch(/tenant t_/);
  });

  it('embeds the persona opening statement', () => {
    const text = renderIdentityPreamble({ persona: TENANT_RESIDENT_PERSONA, scope: TENANT_SCOPE });
    expect(text).toContain(TENANT_RESIDENT_PERSONA.openingStatement);
  });

  it('joins taboos with bullet separator', () => {
    const text = renderIdentityPreamble({ persona: TENANT_RESIDENT_PERSONA, scope: TENANT_SCOPE });
    expect(text).toMatch(/Taboos: .* · .*/);
  });

  it('renders the firstPersonNoun on its own line', () => {
    const text = renderIdentityPreamble({ persona: TENANT_RESIDENT_PERSONA, scope: TENANT_SCOPE });
    expect(text).toMatch(/First-person form: "I"\./);
  });
});
