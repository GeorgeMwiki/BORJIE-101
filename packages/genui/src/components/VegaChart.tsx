'use client';

/**
 * 1. chart-vega — Vega-Lite v6 chart renderer.
 *
 * Anti-patterns enforced:
 *   - ajv-validate every Vega-Lite spec BEFORE render (R2)
 *   - render only on complete `tool-output-available` payload (R2)
 *   - never stream chart spec piece-by-piece (R2)
 *
 * Dependencies (peer / declared at the consuming app):
 *   - react-vega ^8.0.0
 *   - vega-lite ^6.4.3
 *   - vega ^6.2.0
 *   - vega-embed ^7.1.0
 *
 * The package targets both Next.js and Vite, so we use `React.lazy` +
 * `ClientOnly` mount guard instead of `next/dynamic`. Same effect: the
 * vega bundle stays out of SSR + adds nothing to first-paint on routes
 * without a chart.
 */

import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { ClientOnly } from './ClientOnly';
import { ChartVegaPartSchema } from '../schemas';
import { validateVegaSpec, quickVegaShapeCheck } from '../validate';

// Lazy import — the module is resolved at runtime once the chart actually
// renders. We explicitly type the lazy component as `ComponentType<any>`
// so DTS emission works even when react-vega is only present as a peer
// dependency at consume time (and therefore has no shipped types here).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VegaLite: ComponentType<any> = lazy(async () => {
  // @ts-ignore — module is a peer dep of the consuming app
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = await import('react-vega');
  return { default: m.VegaLite };
});

export type VegaChartProps = AgUiUiPartByKind<'chart-vega'>;

export function VegaChart(props: VegaChartProps): JSX.Element {
  const parsed = ChartVegaPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="chart-vega"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }

  const [ajvOk, setAjvOk] = useState<
    | null
    | {
        ok: boolean;
        errors: ReadonlyArray<string>;
        safeSpec?: Readonly<Record<string, unknown>>;
        strippedPaths?: ReadonlyArray<string>;
      }
  >(null);

  useEffect(() => {
    let alive = true;
    void validateVegaSpec(props.spec).then((res) => {
      if (alive) setAjvOk(res);
    });
    return () => {
      alive = false;
    };
  }, [props.spec]);

  if (!quickVegaShapeCheck(props.spec)) {
    return (
      <GenUiError
        kind="chart-vega"
        message="spec missing mark / encoding / layer composition operator"
      />
    );
  }

  if (ajvOk && !ajvOk.ok) {
    return (
      <GenUiError
        kind="chart-vega"
        message={`invalid Vega-Lite spec: ${ajvOk.errors.slice(0, 3).join('; ')}`}
      />
    );
  }

  // CRITICAL (C2) — hand the EXPRESSION-STRIPPED spec to vega-embed, not
  // the raw `props.spec`. validateVegaSpec returns `safeSpec` with every
  // `signal` / `expr` / `calculate` / `update` / `init` / `params` field
  // pruned recursively, so even if an LLM emits one Vega cannot evaluate
  // it. Falls back to the raw spec only on the first render before ajv
  // has resolved (ajvOk === null) — but that path also gates render
  // behind `ajvOk?.ok` below, so a raw spec never reaches VegaLite.
  const baseSpec = ajvOk?.safeSpec ?? props.spec;
  const fullSpec = {
    ...baseSpec,
    data: { values: props.data },
    width: 'container',
  };

  return (
    <Frame kind="chart-vega" {...(props.title ? { title: props.title } : {})}>
      <div className="w-full" style={{ minHeight: 220 }}>
        {ajvOk?.ok ? (
          <ClientOnly
            fallback={
              <span className="text-xs text-muted-foreground">loading chart…</span>
            }
          >
            <Suspense
              fallback={
                <span className="text-xs text-muted-foreground">loading chart…</span>
              }
            >
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <VegaLite spec={fullSpec as any} actions={false} renderer="canvas" />
            </Suspense>
          </ClientOnly>
        ) : (
          <span className="text-xs text-muted-foreground">validating spec…</span>
        )}
      </div>
    </Frame>
  );
}
