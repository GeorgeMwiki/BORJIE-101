/**
 * Tests for binding-resolver.ts.
 *
 * Covers:
 *   - resolveDefaultPersonaForUser: isDefault flag + lowest-tier fallback
 *   - setActivePersona / getActivePersona round-trip
 *   - validateBindingTierCompatibility: refuses to elevate a CUSTOMER
 *     title to a T1 persona, allows equal or weaker tier
 *   - in-memory session store
 */
import { describe, expect, it } from 'vitest';
import {
  createInMemorySessionStore,
  getActivePersona,
  resolveDefaultPersonaForUser,
  setActivePersona,
  validateBindingTierCompatibility,
  type PersonaBindingPort,
} from '../binding-resolver.js';
import type { Persona, PersonaBinding } from '../types.js';

function makePersona(slug: string, tier: 1 | 2 | 3 | 4 | 5): Persona {
  return {
    id: `p_${slug}`,
    tenantId: 't_abc',
    slug,
    displayNameEn: slug,
    powerTier: tier,
    scopePredicate: { kind: 'tenant_scope' },
    toolCatalogIds: [],
    channelAllowlist: ['web'],
    maxActionTier: 'LOW',
    memoryNamespaceTemplate: 'tenant:{tenant_id}',
    uiSectionFilter: [],
    isBuiltIn: true,
  };
}

function makeBinding(
  personaId: string,
  isDefault = false,
  createdAt?: Date,
): PersonaBinding {
  const binding: PersonaBinding = {
    id: `b_${personaId}`,
    userId: 'u_1',
    tenantId: 't_abc',
    titleId: 'title_1',
    personaId,
    isDefault,
  };
  if (createdAt !== undefined) {
    return { ...binding, createdAt };
  }
  return binding;
}

function makePort(args: {
  readonly bindings: ReadonlyArray<PersonaBinding>;
  readonly personas: ReadonlyArray<Persona>;
}): PersonaBindingPort {
  return {
    async listBindingsForUser({ userId, tenantId }) {
      return args.bindings.filter(
        (b) => b.userId === userId && b.tenantId === tenantId,
      );
    },
    async getPersonaById({ tenantId, personaId }) {
      return (
        args.personas.find(
          (p) => p.id === personaId && p.tenantId === tenantId,
        ) ?? null
      );
    },
  };
}

describe('resolveDefaultPersonaForUser', () => {
  it('returns null when user has no bindings', async () => {
    const port = makePort({ bindings: [], personas: [] });
    const out = await resolveDefaultPersonaForUser({
      userId: 'u_1',
      tenantId: 't_abc',
      port,
    });
    expect(out).toBeNull();
  });

  it('returns the explicit isDefault binding when present', async () => {
    const personas = [
      makePersona('a', 3),
      makePersona('b', 4),
      makePersona('c', 2),
    ];
    const bindings = [
      makeBinding('p_a'),
      makeBinding('p_b', true), // explicit default — weakest tier wins this flag
      makeBinding('p_c'),
    ];
    const out = await resolveDefaultPersonaForUser({
      userId: 'u_1',
      tenantId: 't_abc',
      port: makePort({ bindings, personas }),
    });
    expect(out?.persona.slug).toBe('b');
  });

  it('falls back to lowest power tier when no explicit default', async () => {
    const personas = [
      makePersona('a', 3),
      makePersona('b', 4),
      makePersona('c', 2),
    ];
    const bindings = [
      makeBinding('p_a'),
      makeBinding('p_b'),
      makeBinding('p_c'),
    ];
    const out = await resolveDefaultPersonaForUser({
      userId: 'u_1',
      tenantId: 't_abc',
      port: makePort({ bindings, personas }),
    });
    expect(out?.persona.slug).toBe('c');
  });

  it('ties on tier broken by earliest createdAt', async () => {
    const personas = [makePersona('a', 3), makePersona('b', 3)];
    const t0 = new Date('2026-01-01');
    const t1 = new Date('2026-02-01');
    const bindings = [makeBinding('p_b', false, t1), makeBinding('p_a', false, t0)];
    const out = await resolveDefaultPersonaForUser({
      userId: 'u_1',
      tenantId: 't_abc',
      port: makePort({ bindings, personas }),
    });
    expect(out?.persona.slug).toBe('a');
  });

  it('explicit isDefault override does NOT require lowest tier', async () => {
    // Explicit default = highest tier among bindings.
    const personas = [makePersona('weak', 5), makePersona('strong', 1)];
    const bindings = [
      makeBinding('p_strong'),
      makeBinding('p_weak', true), // user explicitly picked CUSTOMER as default
    ];
    const out = await resolveDefaultPersonaForUser({
      userId: 'u_1',
      tenantId: 't_abc',
      port: makePort({ bindings, personas }),
    });
    expect(out?.persona.slug).toBe('weak');
  });

  it('falls through to tier fallback when default persona row is missing', async () => {
    // Binding marked default but persona was deleted out from under it.
    const personas = [makePersona('b', 4)];
    const bindings = [
      makeBinding('p_missing', true),
      makeBinding('p_b'),
    ];
    const out = await resolveDefaultPersonaForUser({
      userId: 'u_1',
      tenantId: 't_abc',
      port: makePort({ bindings, personas }),
    });
    expect(out?.persona.slug).toBe('b');
  });
});

describe('setActivePersona / getActivePersona', () => {
  it('round-trips through the in-memory store', async () => {
    const store = createInMemorySessionStore();
    await setActivePersona({
      sessionId: 's_1',
      personaId: 'p_42',
      sessionStore: store,
    });
    expect(
      await getActivePersona({ sessionId: 's_1', sessionStore: store }),
    ).toBe('p_42');
  });

  it('returns null when no persona is set', async () => {
    const store = createInMemorySessionStore();
    expect(
      await getActivePersona({ sessionId: 's_missing', sessionStore: store }),
    ).toBeNull();
  });
});

describe('validateBindingTierCompatibility', () => {
  it('rejects elevating CUSTOMER (T5) title to T1 persona', () => {
    const v = validateBindingTierCompatibility({
      titleTier: 5,
      personaTier: 1,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('stronger');
  });

  it('allows EMPLOYEE (T4) title bound to T5 persona (downgrade)', () => {
    const v = validateBindingTierCompatibility({
      titleTier: 4,
      personaTier: 5,
    });
    expect(v.allowed).toBe(true);
  });

  it('allows equal tier (matched)', () => {
    const v = validateBindingTierCompatibility({
      titleTier: 3,
      personaTier: 3,
    });
    expect(v.allowed).toBe(true);
  });

  it('OWNER (T1) title may bind any persona', () => {
    expect(
      validateBindingTierCompatibility({ titleTier: 1, personaTier: 1 }).allowed,
    ).toBe(true);
    expect(
      validateBindingTierCompatibility({ titleTier: 1, personaTier: 5 }).allowed,
    ).toBe(true);
  });
});
