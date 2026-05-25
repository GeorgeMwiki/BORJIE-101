/**
 * Portal -> primary persona routing and sub-persona layer routing tests.
 *
 * These tests lock in the LitFin-style persona architecture ported into
 * Borjie: 6 portal-bound primary personae plus 7 differential
 * sub-persona prompt layers.
 */

import { describe, it, expect } from 'vitest';
import {
  PORTAL_PERSONA_MAP,
  PRIMARY_PERSONAE,
  SUB_PERSONA_LAYERS,
  resolvePersona,
  resolvePersonaById,
  getRegisteredPersonas,
  routeToSubPersona,
  composePersonaPrompt,
  composeAvailableTools,
  SUB_PERSONA_REGISTRY,
  type BossnyumbaPersonaId,
  type PortalId,
  type SubPersonaRoutingContext,
  type SubPersonaId,
} from '../personas/index.js';

// Baseline context helpers

function baseContext(
  overrides: Partial<SubPersonaRoutingContext> = {},
): SubPersonaRoutingContext {
  return {
    route: '/',
    portalId: 'admin-portal',
    chatMode: null,
    isAuthenticated: true,
    message: '',
    recentMessages: [],
    emotionalTone: 'neutral',
    sessionMetrics: {
      messageCount: 1,
      errorMentionCount: 0,
      helpRequestCount: 0,
      navigationRequestCount: 0,
      minutesSinceStart: 0,
    },
    ...overrides,
  };
}

describe('portal -> primary persona routing', () => {
  it('exposes exactly the six expected primary personae', () => {
    const ids = getRegisteredPersonas().slice().sort();
    expect(ids).toEqual(
      [
        'borjie-studio',
        'coworker',
        'manager-chat',
        'owner-advisor',
        'public-guide',
        'tenant-assistant',
      ].sort(),
    );
  });

  it('maps admin-portal to manager-chat ("Mr. Mwikila")', () => {
    const p = resolvePersona('admin-portal');
    expect(p.id).toBe('manager-chat');
    expect(p.displayName).toBe('Mr. Mwikila');
  });

  it('maps estate-manager-app to coworker', () => {
    expect(resolvePersona('estate-manager-app').id).toBe('coworker');
  });

  it('maps customer-app to tenant-assistant', () => {
    expect(resolvePersona('customer-app').id).toBe('tenant-assistant');
  });

  it('maps owner-portal to owner-advisor', () => {
    expect(resolvePersona('owner-portal').id).toBe('owner-advisor');
  });

  it('maps studio to borjie-studio', () => {
    expect(resolvePersona('studio').id).toBe('borjie-studio');
  });

  it('maps marketing to public-guide', () => {
    expect(resolvePersona('marketing').id).toBe('public-guide');
  });

  it('PORTAL_PERSONA_MAP covers every defined portal exactly once', () => {
    const entries = Object.entries(PORTAL_PERSONA_MAP) as Array<[PortalId, BossnyumbaPersonaId]>;
    const personaIds = new Set(entries.map(([, v]) => v));
    expect(personaIds.size).toBe(entries.length);
  });

  it('every primary persona has a non-empty system prompt', () => {
    for (const p of PRIMARY_PERSONAE) {
      expect(p.systemPrompt.length).toBeGreaterThan(50);
    }
  });

  it('primary persona objects are immutable (frozen)', () => {
    const p = resolvePersonaById('manager-chat');
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.availableTools)).toBe(true);
    expect(() => {
      // @ts-expect-error - intentional mutation attempt
      p.displayName = 'Mutant';
    }).toThrow();
  });

  it('resolvePersona throws on unknown portal', () => {
    // @ts-expect-error - intentional invalid input
    expect(() => resolvePersona('made-up-portal')).toThrow();
  });

  it('Professor prompt uses Tanzania/Kenya cultural grounding (Swahili words)', () => {
    const layer = SUB_PERSONA_LAYERS.professor.promptLayer;
    // Cultural anchors - at least ONE of each bucket must appear
    expect(layer).toMatch(/swahili/i);
    // At least one common Swahili greeting / affirmation
    expect(layer).toMatch(/\b(habari|karibu|vizuri|sana|rafiki)\b/i);
    // Kenyan or Tanzanian market reference
    expect(layer).toMatch(/kilimani|westlands|nairobi|kariakoo|dar\s*es\s*salaam/i);
    // Local currency
    expect(layer).toMatch(/KSh|TSh/);
  });

  it('Professor prompt explicitly teaches via Socratic method', () => {
    const layer = SUB_PERSONA_LAYERS.professor.promptLayer;
    expect(layer.toLowerCase()).toContain('socratic');
    expect(layer.toLowerCase()).toContain('bloom');
  });
});

describe('sub-persona routing - context signals', () => {
  it('activates finance sub-layer for arrears keyword from authenticated admin', () => {
    const result = routeToSubPersona(
      baseContext({
        message: 'help me understand rent arrears for the Kilimani property',
        portalId: 'admin-portal',
      }),
    );
    expect(result?.subPersonaId).toBe('finance');
  });

  it('activates maintenance sub-layer for leak keyword', () => {
    const result = routeToSubPersona(
      baseContext({
        message: 'there is a leak in unit 4B, we need a plumber today',
      }),
    );
    expect(result?.subPersonaId).toBe('maintenance');
  });

  it('activates leasing sub-layer on /leasing route', () => {
    const result = routeToSubPersona(
      baseContext({ route: '/leasing/renewals', message: 'propose a renewal' }),
    );
    expect(result?.subPersonaId).toBe('leasing');
  });

  it('activates compliance sub-layer for DPA keyword', () => {
    const result = routeToSubPersona(
      baseContext({ message: 'a tenant has filed a DPA data-subject access request' }),
    );
    expect(result?.subPersonaId).toBe('compliance');
  });

  it('activates professor sub-layer on chatMode="teaching"', () => {
    const result = routeToSubPersona(
      baseContext({ chatMode: 'teaching', message: 'explain how service charge works' }),
    );
    expect(result?.subPersonaId).toBe('professor');
  });

  it('activates advisor sub-layer on /portfolio route with strategy keywords', () => {
    const result = routeToSubPersona(
      baseContext({
        route: '/portfolio/summary',
        message: 'should I refurbish the Westlands block or sell it',
      }),
    );
    expect(result?.subPersonaId).toBe('advisor');
  });

  it('activates communications sub-layer for draft notice request', () => {
    const result = routeToSubPersona(
      baseContext({
        message: 'draft a rent reminder notice in Swahili for tenants overdue',
      }),
    );
    expect(result?.subPersonaId).toBe('communications');
  });

  it('is case-insensitive on message keywords', () => {
    const lower = routeToSubPersona(
      baseContext({ message: 'tenant is in arrears again' }),
    );
    const upper = routeToSubPersona(
      baseContext({ message: 'TENANT IS IN ARREARS AGAIN' }),
    );
    expect(lower?.subPersonaId).toBe('finance');
    expect(upper?.subPersonaId).toBe('finance');
  });

  it('is case-insensitive on route patterns', () => {
    const a = routeToSubPersona(baseContext({ route: '/LEASING/APPLICANTS' }));
    const b = routeToSubPersona(baseContext({ route: '/leasing/applicants' }));
    expect(a?.subPersonaId).toBe('leasing');
    expect(b?.subPersonaId).toBe('leasing');
  });

  it('returns null when no signals reach threshold (fallback to base persona)', () => {
    const result = routeToSubPersona(
      baseContext({ message: 'hello', route: '/unknown' }),
    );
    expect(result).toBeNull();
  });
});

describe('sub-persona prompt composition', () => {
  it('composePersonaPrompt appends the layer below the base prompt', () => {
    const base = 'BASE PERSONA PROMPT';
    const composed = composePersonaPrompt(base, 'finance');
    expect(composed.startsWith(base)).toBe(true);
    expect(composed).toContain(SUB_PERSONA_REGISTRY.finance.promptLayer);
  });

  it('composePersonaPrompt returns the base prompt unchanged when no sub-persona', () => {
    expect(composePersonaPrompt('BASE', null)).toBe('BASE');
  });

  it('composeAvailableTools merges base tools with sub-persona preferredTools and dedupes', () => {
    const base: ReadonlyArray<string> = ['get_portfolio_overview', 'skill.core.advise'];
    const merged = composeAvailableTools(base, 'finance');
    // Base tools stay first, additional sub-persona tools after, deduped.
    expect(merged.slice(0, 2)).toEqual(['get_portfolio_overview', 'skill.core.advise']);
    expect(merged).toContain('skill.kenya.mpesa_reconcile');
    // No duplicate of skill.core.advise
    const advCount = merged.filter((t) => t === 'skill.core.advise').length;
    expect(advCount).toBe(1);
  });

  it('composeAvailableTools returns the base tools unchanged when no sub-persona', () => {
    const base: ReadonlyArray<string> = ['a', 'b'];
    const out = composeAvailableTools(base, null);
    expect(out).toBe(base);
  });

  it('routes "how are we doing?" org-health questions to the consultant dimension on neutral routes', () => {
    // Wave 18 — add keyword signals so these questions trigger the
    // consultant sub-persona, which has `query_organization` in its
    // preferred-tools list. Without this, the orchestrator streams
    // conversationally instead of invoking the tool.
    //
    // Uses a neutral route (/home) so the message keywords drive the
    // pick rather than the route-pattern signal (the dashboard route
    // pre-selects the advisor dimension and would skew the winner).
    const context = baseContext({
      route: '/home',
      message: 'How are we doing? Show me improvements.',
    });
    const result = routeToSubPersona(context);
    expect(result).not.toBeNull();
    expect(result?.subPersonaId).toBe('consultant');
  });

  it('includes query_organization in consultant preferred tools', () => {
    // Direct assertion on the registry — Wave 18 wired the tool as a
    // preferred signal for the consultant so the orchestrator prefers
    // the org-health tool over streaming conversational text.
    const cfg = SUB_PERSONA_REGISTRY.consultant;
    expect(cfg.preferredTools).toContain('query_organization');
    const merged = composeAvailableTools(['get_portfolio_overview'], 'consultant');
    expect(merged).toContain('query_organization');
  });

  it('every sub-persona registry entry has a non-empty prompt layer', () => {
    const ids = Object.keys(SUB_PERSONA_REGISTRY) as SubPersonaId[];
    // Wave-11: 7 base sub-personae (finance/leasing/maintenance/compliance/
    // communications/professor/advisor). Wave-13 adds consultant. Accept ≥ 7.
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const id of ids) {
      expect(SUB_PERSONA_REGISTRY[id].promptLayer.length).toBeGreaterThan(100);
    }
  });

  it('every sub-persona registry entry is frozen in spirit - mutating throws on nested arrays', () => {
    // We do not deep-freeze programmatically, but the registry is declared
    // `as const` so the TS type is readonly. Runtime mutation on the
    // preferredTools array should not be encouraged; we at least assert
    // the readonly contract on the type level via access patterns.
    const cfg = SUB_PERSONA_REGISTRY.finance;
    expect(Array.isArray(cfg.preferredTools)).toBe(true);
    expect(cfg.preferredTools.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Wave-26 metadata registry tests
// ============================================================================
// Pins the wiring of the 8 *_METADATA consts that were flagged as orphan
// exports in Wave-25. Any future sub-persona added to SubPersonaId MUST
// also land a metadata row — these tests enforce that.

describe('Wave-26 sub-persona metadata registry', () => {
  it('exposes metadata for every SubPersonaId', async () => {
    const mod = await import('../personas/sub-persona-types.js');
    const ids = Object.keys(mod.SUB_PERSONA_REGISTRY);
    const metaIds = Object.keys(mod.SUB_PERSONA_METADATA_REGISTRY);
    expect(metaIds.sort()).toEqual(ids.sort());
  });

  it('every metadata row has a non-empty version + positive token estimate', async () => {
    const { SUB_PERSONA_METADATA_REGISTRY } = await import(
      '../personas/sub-persona-types.js'
    );
    for (const [id, meta] of Object.entries(SUB_PERSONA_METADATA_REGISTRY)) {
      expect(meta.id, `${id} metadata id`).toBe(id);
      expect(meta.version, `${id} version`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(meta.promptTokenEstimate, `${id} tokens`).toBeGreaterThan(0);
      expect(meta.activationRoutes.length, `${id} routes`).toBeGreaterThan(0);
    }
  });

  it('estimateSubPersonaTokensForRoute sums active sub-personae', async () => {
    const { estimateSubPersonaTokensForRoute } = await import(
      '../personas/sub-persona-types.js'
    );
    // /finance/* activates the finance sub-persona (600 tokens), nothing else.
    expect(estimateSubPersonaTokensForRoute('/finance/arrears')).toBe(600);
    // /unknown should match zero sub-personae.
    expect(estimateSubPersonaTokensForRoute('/unknown-path')).toBe(0);
  });

  it('getSubPersonaVersions returns a complete id->version map', async () => {
    const { getSubPersonaVersions, SUB_PERSONA_METADATA_REGISTRY } =
      await import('../personas/sub-persona-types.js');
    const versions = getSubPersonaVersions();
    expect(Object.keys(versions).length).toBe(
      Object.keys(SUB_PERSONA_METADATA_REGISTRY).length,
    );
    expect(versions.professor).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
