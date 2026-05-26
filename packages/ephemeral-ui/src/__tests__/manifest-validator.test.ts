import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  validateFunctionUIManifest,
  assertValidManifest,
} from '../manifests/manifest-validator.js';

function validManifest(): unknown {
  return {
    function_id: 'project_fx_exposure',
    version: 1,
    dashboard_archetype: 'chart_with_table',
    required_context: [
      { kind: 'scope', required: true },
      { kind: 'locale', required: true },
    ],
    output_shape: z.object({
      exposures: z.array(z.object({ ccy: z.string(), amount: z.number() })),
    }),
    ui_hints: {
      preferred_size: 'tab',
      preferred_colors: ['var(--borjie-color-primary)'],
      preferred_layout: 'split',
      emphasis: 'narrative',
      mobile_strategy: 'simplify',
    },
    authority_tier: 1,
    ephemeral_by_default: true,
    cache_ttl_seconds: 300,
  };
}

describe('validateFunctionUIManifest', () => {
  it('accepts a fully-formed manifest', () => {
    const r = validateFunctionUIManifest(validManifest());
    expect(r.ok).toBe(true);
  });

  it('rejects a non-object', () => {
    const r = validateFunctionUIManifest('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects a missing output_shape', () => {
    const bad = { ...(validManifest() as Record<string, unknown>) };
    delete bad['output_shape'];
    const r = validateFunctionUIManifest(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects a non-Zod output_shape', () => {
    const bad = { ...(validManifest() as Record<string, unknown>) };
    bad['output_shape'] = { not: 'a zod schema' };
    const r = validateFunctionUIManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.join(' ')).toMatch(/output_shape/);
    }
  });

  it('rejects an unknown archetype', () => {
    const bad = { ...(validManifest() as Record<string, unknown>) };
    bad['dashboard_archetype'] = 'not_a_real_archetype';
    const r = validateFunctionUIManifest(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects a non-tier authority value', () => {
    const bad = { ...(validManifest() as Record<string, unknown>) };
    bad['authority_tier'] = 5;
    const r = validateFunctionUIManifest(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects negative cache_ttl_seconds', () => {
    const bad = { ...(validManifest() as Record<string, unknown>) };
    bad['cache_ttl_seconds'] = -1;
    const r = validateFunctionUIManifest(bad);
    expect(r.ok).toBe(false);
  });

  it('assertValidManifest throws on invalid', () => {
    expect(() => assertValidManifest({})).toThrow();
  });

  it('assertValidManifest does not throw on valid', () => {
    expect(() => assertValidManifest(validManifest())).not.toThrow();
  });
});
