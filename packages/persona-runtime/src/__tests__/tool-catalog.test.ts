/**
 * Tests for tool-catalog.ts.
 *
 * Verifies the five-filter pipeline:
 *   1. start from persona.toolCatalogIds
 *   2. kill-switch removes ALL
 *   3. channel allowlist (descriptor + persona)
 *   4. feature flag
 *   5. max_action_tier ceiling
 *
 * Plus immutability of the returned object.
 */
import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAG_PREFIX,
  computeToolCatalog,
  type ToolDescriptorMap,
} from '../tool-catalog.js';
import type { AuthorizationContext, Persona } from '../types.js';

function persona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'p_1',
    tenantId: 't_abc',
    slug: 'test_persona',
    displayNameEn: 'Test Persona',
    powerTier: 3,
    scopePredicate: { kind: 'tenant_scope' },
    toolCatalogIds: ['t.low', 't.medium', 't.high', 't.sovereign'],
    channelAllowlist: ['web', 'mobile'],
    maxActionTier: 'MEDIUM',
    memoryNamespaceTemplate: 'tenant:{tenant_id}',
    uiSectionFilter: [],
    isBuiltIn: false,
    ...overrides,
  };
}

function ctx(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    userId: 'u_1',
    tenantId: 't_abc',
    personaId: 'p_1',
    channel: 'web',
    killSwitchOpen: false,
    featureFlags: {},
    ...overrides,
  };
}

const DESCS: ToolDescriptorMap = Object.freeze({
  't.low': { id: 't.low', stakes: 'LOW' },
  't.medium': { id: 't.medium', stakes: 'MEDIUM' },
  't.high': { id: 't.high', stakes: 'HIGH' },
  't.sovereign': { id: 't.sovereign', stakes: 'SOVEREIGN' },
  't.web_only': { id: 't.web_only', channels: ['web'] },
  't.whatsapp_only': { id: 't.whatsapp_only', channels: ['whatsapp'] },
});

describe('computeToolCatalog — happy path', () => {
  it('returns the catalog as-is when no descriptors and no filters fire', () => {
    const r = computeToolCatalog({
      persona: persona({
        toolCatalogIds: ['a', 'b', 'c'],
        maxActionTier: 'SOVEREIGN',
      }),
      ctx: ctx(),
    });
    expect([...r.toolIds]).toEqual(['a', 'b', 'c']);
    expect(r.removed.length).toBe(0);
  });
});

describe('computeToolCatalog — kill switch', () => {
  it('returns an empty array when kill switch is open', () => {
    const r = computeToolCatalog({
      persona: persona(),
      ctx: ctx({ killSwitchOpen: true }),
    });
    expect(r.toolIds.length).toBe(0);
    expect(r.removed.length).toBe(4);
    expect(r.removed.every((x) => x.reason.includes('kill-switch'))).toBe(
      true,
    );
  });

  it('returned arrays are frozen', () => {
    const r = computeToolCatalog({
      persona: persona(),
      ctx: ctx({ killSwitchOpen: true }),
    });
    // toolIds is frozen — push must throw in strict mode.
    expect(() => (r.toolIds as unknown as string[]).push('x')).toThrow();
  });
});

describe('computeToolCatalog — channel allowlist', () => {
  it('drops tools whose descriptor channels exclude ctx.channel', () => {
    const r = computeToolCatalog({
      persona: persona({
        toolCatalogIds: ['t.web_only', 't.whatsapp_only'],
        channelAllowlist: ['web', 'whatsapp'],
        maxActionTier: 'SOVEREIGN',
      }),
      ctx: ctx({ channel: 'web' }),
      descriptors: DESCS,
    });
    expect([...r.toolIds]).toContain('t.web_only');
    expect([...r.toolIds]).not.toContain('t.whatsapp_only');
  });

  it('drops every tool when persona allowlist excludes the channel', () => {
    const r = computeToolCatalog({
      persona: persona({ channelAllowlist: ['web'] }),
      ctx: ctx({ channel: 'whatsapp' }),
      descriptors: DESCS,
    });
    expect(r.toolIds.length).toBe(0);
    expect(r.removed.length).toBeGreaterThan(0);
  });
});

describe('computeToolCatalog — feature flag', () => {
  it('drops tools whose feature flag is FALSE', () => {
    const r = computeToolCatalog({
      persona: persona({
        toolCatalogIds: ['a', 'b'],
        maxActionTier: 'SOVEREIGN',
      }),
      ctx: ctx({
        featureFlags: { [`${FEATURE_FLAG_PREFIX}a`]: false },
      }),
    });
    expect([...r.toolIds]).toEqual(['b']);
    expect(r.removed[0]?.toolId).toBe('a');
  });

  it('keeps tools when flag is missing (default-on)', () => {
    const r = computeToolCatalog({
      persona: persona({ toolCatalogIds: ['a', 'b'], maxActionTier: 'SOVEREIGN' }),
      ctx: ctx({ featureFlags: { 'other.unrelated': true } }),
    });
    expect([...r.toolIds]).toEqual(['a', 'b']);
  });

  it('keeps tools when flag is explicitly TRUE', () => {
    const r = computeToolCatalog({
      persona: persona({ toolCatalogIds: ['a'], maxActionTier: 'SOVEREIGN' }),
      ctx: ctx({ featureFlags: { [`${FEATURE_FLAG_PREFIX}a`]: true } }),
    });
    expect([...r.toolIds]).toEqual(['a']);
  });
});

describe('computeToolCatalog — max action tier ceiling', () => {
  it('drops tools whose stakes exceed the ceiling', () => {
    const r = computeToolCatalog({
      persona: persona({ maxActionTier: 'MEDIUM' }),
      ctx: ctx(),
      descriptors: DESCS,
    });
    expect([...r.toolIds]).toEqual(['t.low', 't.medium']);
    expect(r.removed.length).toBe(2);
  });

  it('SOVEREIGN ceiling allows everything', () => {
    const r = computeToolCatalog({
      persona: persona({ maxActionTier: 'SOVEREIGN' }),
      ctx: ctx(),
      descriptors: DESCS,
    });
    expect(r.toolIds.length).toBe(4);
  });

  it('LOW ceiling allows only LOW tools', () => {
    const r = computeToolCatalog({
      persona: persona({ maxActionTier: 'LOW' }),
      ctx: ctx(),
      descriptors: DESCS,
    });
    expect([...r.toolIds]).toEqual(['t.low']);
  });
});

describe('computeToolCatalog — composition order', () => {
  it('kill switch wins over everything', () => {
    const r = computeToolCatalog({
      persona: persona({ maxActionTier: 'SOVEREIGN' }),
      ctx: ctx({
        killSwitchOpen: true,
        featureFlags: { [`${FEATURE_FLAG_PREFIX}t.low`]: true },
      }),
      descriptors: DESCS,
    });
    expect(r.toolIds.length).toBe(0);
  });
});
