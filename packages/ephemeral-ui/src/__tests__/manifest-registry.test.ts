import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  __resetRegistryForTests,
  getLatestManifest,
  getManifest,
  listRegisteredManifests,
  registerFunctionUIManifest,
} from '../manifests/manifest-registry.js';

function buildManifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    function_id: 'plan_shift',
    version: 1,
    dashboard_archetype: 'kpi_grid',
    required_context: [{ kind: 'scope', required: true }],
    output_shape: z.object({ kpis: z.array(z.unknown()) }),
    ui_hints: {
      preferred_size: 'tab',
      preferred_colors: ['var(--borjie-color-primary)'],
      preferred_layout: 'cards',
      emphasis: 'actionable',
      mobile_strategy: 'reflow',
    },
    authority_tier: 0,
    ephemeral_by_default: true,
    cache_ttl_seconds: 300,
    ...overrides,
  };
}

beforeEach(() => {
  process.env['VITEST'] = 'true';
  __resetRegistryForTests();
});

describe('manifest-registry', () => {
  it('registers a valid manifest', () => {
    const m = registerFunctionUIManifest(buildManifest());
    expect(m.function_id).toBe('plan_shift');
    expect(m.version).toBe(1);
  });

  it('returns the manifest by exact version', () => {
    registerFunctionUIManifest(buildManifest());
    const got = getManifest('plan_shift', 1);
    expect(got).not.toBeNull();
  });

  it('returns null for unknown function_id', () => {
    expect(getManifest('nope', 1)).toBeNull();
    expect(getLatestManifest('nope')).toBeNull();
  });

  it('tracks the latest version', () => {
    registerFunctionUIManifest(buildManifest({ version: 1 }));
    registerFunctionUIManifest(buildManifest({ version: 2 }));
    registerFunctionUIManifest(buildManifest({ version: 5 }));
    const latest = getLatestManifest('plan_shift');
    expect(latest?.version).toBe(5);
  });

  it('throws on invalid manifest', () => {
    expect(() => registerFunctionUIManifest({})).toThrow();
  });

  it('is idempotent on identical re-register', () => {
    const a = registerFunctionUIManifest(buildManifest());
    const b = registerFunctionUIManifest(buildManifest());
    expect(a).toBe(b);
  });

  it('throws on divergent re-register', () => {
    registerFunctionUIManifest(buildManifest());
    expect(() =>
      registerFunctionUIManifest(
        buildManifest({ dashboard_archetype: 'list_with_filters' }),
      ),
    ).toThrow(/Manifest divergence/);
  });

  it('lists registered manifests', () => {
    registerFunctionUIManifest(buildManifest({ version: 1 }));
    registerFunctionUIManifest(
      buildManifest({ function_id: 'other', version: 1 }),
    );
    const list = listRegisteredManifests();
    expect(list.length).toBe(2);
  });

  it('__resetRegistryForTests throws outside test mode', () => {
    process.env['VITEST'] = 'false';
    process.env['NODE_ENV'] = 'production';
    expect(() => __resetRegistryForTests()).toThrow(
      /only be called in test runs/,
    );
    process.env['VITEST'] = 'true';
  });
});
