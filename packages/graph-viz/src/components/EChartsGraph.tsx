'use client';

/**
 * EChartsGraph — Apache ECharts 5 graph-series wrapper.
 *
 * ECharts ships first-class `series: 'graph'` with built-in
 * force/circular/none layouts, plus `series: 'sankey'`, `'sunburst'`,
 * and `'tree'`. We re-use the same OKLCH palette so a Sankey from
 * ECharts looks identical to one from d3-sankey.
 *
 * Sources:
 *  - Apache ECharts 5.5 — https://echarts.apache.org (Apache Foundation, 2025-04)
 *  - "ECharts graph series options" — https://echarts.apache.org/en/option.html#series-graph (2025)
 *  - echarts-for-react — https://github.com/hustcc/echarts-for-react (2024-12)
 */

import { useEffect, useMemo, useState } from 'react';
import { ClientOnly } from './ClientOnly';
import { getBrandTheme, pickCategoricalColor } from '../themes/oklch-brand-theme';
import type { GraphVizProps } from '../types';

export function EChartsGraph(props: GraphVizProps): JSX.Element {
  return (
    <ClientOnly fallback={<div data-testid={props.testId ?? 'graph-viz-echarts-loading'} />}>
      <EChartsGraphInner {...props} />
    </ClientOnly>
  );
}

function EChartsGraphInner(props: GraphVizProps): JSX.Element {
  const {
    nodes,
    edges,
    height = 480,
    width = '100%',
    themeName = 'brand-light',
    ariaLabel,
    testId,
  } = props;

  const [Comp, setComp] = useState<((p: Record<string, unknown>) => JSX.Element) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('echarts-for-react');
        if (cancelled) return;
        setComp(() => (mod as unknown as { default: (p: Record<string, unknown>) => JSX.Element }).default);
      } catch (err) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('graph-viz:engine-error', {
            detail: { engine: 'echarts-for-react', error: String(err) },
          }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const theme = getBrandTheme(themeName);
  const option = useMemo(() => ({
    backgroundColor: theme.background.hex,
    tooltip: {},
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        force: {
          repulsion: 200,
          edgeLength: [60, 140],
        },
        label: { show: true, color: theme.foreground.hex, fontSize: 11 },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 8],
        lineStyle: { color: theme.edgeStroke.hex, width: 1.2, curveness: 0.1 },
        emphasis: { focus: 'adjacency', lineStyle: { width: 2.5, color: theme.edgeHighlight.hex } },
        data: nodes.map((n) => ({
          id: n.id,
          name: n.label ?? n.id,
          symbolSize: 18,
          itemStyle: { color: pickCategoricalColor(theme, n.kind ?? 'default').hex },
        })),
        links: edges.map((e) => ({ source: e.source, target: e.target, value: e.weight ?? 1 })),
      },
    ],
  }), [nodes, edges, theme]);

  if (!Comp) {
    return (
      <div
        role="img"
        aria-label={ariaLabel}
        data-testid={testId ?? 'graph-viz-echarts'}
        style={{
          height,
          width,
          background: theme.background.hex,
          border: `1px solid ${theme.border.hex}`,
          borderRadius: 8,
        }}
      />
    );
  }

  const ReactEChartsComp = Comp;
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      data-testid={testId ?? 'graph-viz-echarts'}
      style={{
        height,
        width,
        background: theme.background.hex,
        border: `1px solid ${theme.border.hex}`,
        borderRadius: 8,
      }}
    >
      <ReactEChartsComp option={option} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
