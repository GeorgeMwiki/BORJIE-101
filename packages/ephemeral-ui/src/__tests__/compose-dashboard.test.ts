import { beforeEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  composeDashboardForFunction,
  hashRecipeShape,
  hashUserContext,
} from '../composer/compose-dashboard.js';
import type {
  FunctionUIManifest,
  UserContext,
} from '../types.js';

function buildManifest(
  overrides: Partial<FunctionUIManifest> = {},
): FunctionUIManifest {
  return {
    function_id: 'query_incident_shifts',
    version: 1,
    dashboard_archetype: 'list_with_filters',
    required_context: [
      { kind: 'scope', required: true },
      { kind: 'locale', required: true },
    ],
    output_shape: z.object({
      items: z.array(z.object({ id: z.string(), shift: z.string() })),
      filters: z.array(z.string()).optional(),
    }),
    ui_hints: {
      preferred_size: 'tab',
      preferred_colors: ['var(--borjie-color-primary)'],
      preferred_layout: 'table',
      emphasis: 'actionable',
      mobile_strategy: 'stack',
    },
    authority_tier: 0,
    ephemeral_by_default: true,
    cache_ttl_seconds: 300,
    ...overrides,
  };
}

function buildContext(): UserContext {
  return {
    tenantId: 'mwadui_coop',
    userId: 'user-1',
    sessionId: 'sess-1',
    scope: { kind: 'site', id: 'mwadui-2' },
    recent_turns: [],
    memory_recall: [],
    brand_dna: {
      tokens_version: 'v3',
      oklch_color_tokens: ['--borjie-color-primary'],
      motion_preset: 'ease-out',
    },
    mastery_tier: 'expert',
    locale: 'en',
  };
}

beforeEach(() => {
  // Each test starts with a fresh context structure.
});

describe('composeDashboardForFunction', () => {
  it('emits a deterministic recipe hash for the same input', () => {
    const manifest = buildManifest();
    const ctx = buildContext();
    const out = { items: [{ id: 'a', shift: 'morning' }] };

    const a = composeDashboardForFunction({
      manifest,
      function_output: out,
      user_context: ctx,
    });
    const b = composeDashboardForFunction({
      manifest,
      function_output: out,
      user_context: ctx,
    });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.recipe_hash).toBe(b.recipe_hash);
    }
  });

  it('returns manifest_schema_mismatch when output does not validate', () => {
    const manifest = buildManifest();
    const r = composeDashboardForFunction({
      manifest,
      function_output: { items: 'not-an-array' },
      user_context: buildContext(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('manifest_schema_mismatch');
    }
  });

  it('returns brand_lock_exhausted when preferred_colors carry raw hex', () => {
    const manifest = buildManifest({
      ui_hints: {
        preferred_size: 'tab',
        preferred_colors: ['#ff00aa'],
        preferred_layout: 'table',
        emphasis: 'actionable',
        mobile_strategy: 'stack',
      },
    });
    const r = composeDashboardForFunction({
      manifest,
      function_output: { items: [] },
      user_context: buildContext(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('brand_lock_exhausted');
      if (r.failure.kind === 'brand_lock_exhausted') {
        expect(r.failure.offenders).toContain('#ff00aa');
      }
    }
  });

  it('attaches an archetype payload with the right kind', () => {
    const manifest = buildManifest({ dashboard_archetype: 'kpi_grid' });
    // kpi_grid accepts a `kpis` field, but our minimal renderer also
    // falls back to plucking numeric top-level fields.
    const r = composeDashboardForFunction({
      manifest: {
        ...manifest,
        output_shape: z.object({ kpis: z.array(z.object({ id: z.string(), value: z.number() })) }),
      },
      function_output: {
        kpis: [
          { id: 'usd_exposure', value: 1200000 },
          { id: 'hedge_ratio', value: 0.42 },
        ],
      },
      user_context: buildContext(),
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.payload) {
      expect(r.payload.archetype).toBe('kpi_grid');
      expect(r.payload.sections[0]?.kind).toBe('kpi');
    }
  });

  it('respects allowed_actions in the recipe-hash fingerprint', () => {
    const base = buildManifest();
    const withActions = buildManifest({
      allowed_actions: [
        {
          action_id: 'export_csv',
          authority_tier: 0,
          label: { en: 'Export', sw: 'Hamisha' },
        },
      ],
    });
    const r1 = composeDashboardForFunction({
      manifest: base,
      function_output: { items: [] },
      user_context: buildContext(),
    });
    const r2 = composeDashboardForFunction({
      manifest: withActions,
      function_output: { items: [] },
      user_context: buildContext(),
    });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.recipe_hash).not.toBe(r2.recipe_hash);
    }
  });

  it('hashUserContext is stable + sensitive to context fields', () => {
    const ctx = buildContext();
    const h1 = hashUserContext(ctx);
    const h2 = hashUserContext(ctx);
    expect(h1).toBe(h2);

    const ctx2 = { ...ctx, locale: 'sw' as const };
    const h3 = hashUserContext(ctx2);
    expect(h3).not.toBe(h1);
  });

  it('hashRecipeShape is order-independent on section_kinds', () => {
    const a = hashRecipeShape({
      function_id: 'f',
      archetype: 'list_with_filters',
      section_kinds: ['filter_bar', 'list'],
      allowed_action_ids: [],
    });
    const b = hashRecipeShape({
      function_id: 'f',
      archetype: 'list_with_filters',
      section_kinds: ['list', 'filter_bar'],
      allowed_action_ids: [],
    });
    expect(a).toBe(b);
  });
});
