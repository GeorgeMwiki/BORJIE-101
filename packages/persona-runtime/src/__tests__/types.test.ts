/**
 * Tests for persona-runtime/src/types.ts.
 *
 * Verify the locked power-tier table, action-tier ranking, and
 * Zod parsers for Persona / Title / Binding.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION_TIERS,
  CHANNELS,
  POWER_TIER_LABEL,
  POWER_TIERS,
  PersonaSchema,
  PersonaBindingSchema,
  TitleSchema,
  isActionTierAllowed,
} from '../types.js';

describe('Power tiers — locked', () => {
  it('exposes exactly [1,2,3,4,5]', () => {
    expect([...POWER_TIERS]).toEqual([1, 2, 3, 4, 5]);
  });

  it('labels are OWNER, ADMIN, MANAGER, EMPLOYEE, CUSTOMER', () => {
    expect(POWER_TIER_LABEL[1]).toBe('OWNER');
    expect(POWER_TIER_LABEL[2]).toBe('ADMIN');
    expect(POWER_TIER_LABEL[3]).toBe('MANAGER');
    expect(POWER_TIER_LABEL[4]).toBe('EMPLOYEE');
    expect(POWER_TIER_LABEL[5]).toBe('CUSTOMER');
  });
});

describe('Action tier ranking', () => {
  it('LOW ≤ MEDIUM ≤ HIGH ≤ SOVEREIGN', () => {
    expect(isActionTierAllowed('LOW', 'LOW')).toBe(true);
    expect(isActionTierAllowed('LOW', 'MEDIUM')).toBe(true);
    expect(isActionTierAllowed('LOW', 'SOVEREIGN')).toBe(true);
    expect(isActionTierAllowed('MEDIUM', 'LOW')).toBe(false);
    expect(isActionTierAllowed('SOVEREIGN', 'HIGH')).toBe(false);
    expect(isActionTierAllowed('SOVEREIGN', 'SOVEREIGN')).toBe(true);
  });

  it('enumerates 4 tiers', () => {
    expect(ACTION_TIERS.length).toBe(4);
  });
});

describe('Channels', () => {
  it('includes the five expected channels', () => {
    expect([...CHANNELS]).toEqual([
      'web',
      'mobile',
      'whatsapp',
      'sms',
      'voice',
    ]);
  });
});

describe('TitleSchema', () => {
  it('parses a valid title row', () => {
    const out = TitleSchema.parse({
      id: 'title_1',
      tenantId: 't_abc',
      slug: 'director_general',
      displayNameEn: 'Director General',
      powerTier: 2,
      isBuiltIn: false,
    });
    expect(out.slug).toBe('director_general');
    expect(out.powerTier).toBe(2);
  });

  it('rejects power_tier outside 1..5', () => {
    expect(() =>
      TitleSchema.parse({
        id: 'title_1',
        tenantId: 't_abc',
        slug: 'rogue',
        displayNameEn: 'Rogue',
        powerTier: 7,
      }),
    ).toThrow();
  });
});

describe('PersonaSchema', () => {
  it('parses a valid persona', () => {
    const out = PersonaSchema.parse({
      id: 'p_1',
      tenantId: 't_abc',
      slug: 'estate_officer',
      displayNameEn: 'Estate Officer',
      powerTier: 3,
      scopePredicate: { kind: 'module_scope', module: 'maintenance' },
      toolCatalogIds: ['t1', 't2'],
      channelAllowlist: ['web', 'mobile'],
      maxActionTier: 'MEDIUM',
      memoryNamespaceTemplate: 'tenant:{tenant_id}:persona:{persona_slug}',
      uiSectionFilter: [],
    });
    expect(out.maxActionTier).toBe('MEDIUM');
    expect(out.toolCatalogIds.length).toBe(2);
  });

  it('rejects empty channel allowlist', () => {
    expect(() =>
      PersonaSchema.parse({
        id: 'p_1',
        tenantId: 't_abc',
        slug: 'estate_officer',
        displayNameEn: 'Estate Officer',
        powerTier: 3,
        scopePredicate: { kind: 'module_scope' },
        toolCatalogIds: [],
        channelAllowlist: [],
        maxActionTier: 'LOW',
        memoryNamespaceTemplate: 'tenant:{tenant_id}',
      }),
    ).toThrow();
  });
});

describe('PersonaBindingSchema', () => {
  it('parses a binding', () => {
    const out = PersonaBindingSchema.parse({
      id: 'b_1',
      userId: 'u_1',
      tenantId: 't_abc',
      titleId: 'title_1',
      personaId: 'p_1',
      isDefault: true,
    });
    expect(out.isDefault).toBe(true);
  });
});
