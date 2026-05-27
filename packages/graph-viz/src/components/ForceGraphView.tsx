'use client';

/**
 * ForceGraphView — d3-force wrapper (no rendering lib).
 *
 * We run `d3-force` headlessly inside an effect, then paint the
 * settled positions into pure SVG. This avoids react-vega / canvas
 * dependencies for the "I just want a force diagram" case and keeps
 * SSR safe (d3 modules are still imported lazily).
 *
 * Sources:
 *  - d3-force 7 — https://d3js.org/d3-force (2025-08)
 *  - "How d3.forceSimulation handles thousands of nodes" — https://observablehq.com/@d3/disjoint-force-directed-graph (2025-02)
 */

import { useEffect, useState } from 'react';
import { ClientOnly } from './ClientOnly';
import { getBrandTheme, pickCategoricalColor } from '../themes/oklch-brand-theme';
import type { GraphVizProps } from '../types';

interface SettledNode {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
}

interface SettledEdge {
  id: string;
  source: string;
  target: string;
}

export function ForceGraphView(props: GraphVizProps): JSX.Element {
  return (
    <ClientOnly fallback={<ForceGraphFallback {...props} />}>
      <ForceGraphViewInner {...props} />
    </ClientOnly>
  );
}

function ForceGraphFallback({ ariaLabel, height = 480, width = 720 }: GraphVizProps): JSX.Element {
  const theme = getBrandTheme();
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      style={{ background: theme.background.hex, borderRadius: 8 }}
    />
  );
}

function ForceGraphViewInner(props: GraphVizProps): JSX.Element {
  const {
    nodes,
    edges,
    height = 480,
    width = 720,
    themeName = 'brand-light',
    ariaLabel,
    testId,
  } = props;

  const widthNum = typeof width === 'number' ? width : 720;
  const heightNum = typeof height === 'number' ? height : 480;

  const [settled, setSettled] = useState<{ nodes: SettledNode[]; edges: SettledEdge[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('d3-force');
        const {
          forceSimulation, forceLink, forceManyBody, forceCenter,
        } = mod as unknown as {
          forceSimulation: (nodes: unknown[]) => unknown;
          forceLink: (links: unknown[]) => unknown;
          forceManyBody: () => unknown;
          forceCenter: (x: number, y: number) => unknown;
        };

        type SimNode = { id: string; label: string; kind: string; x?: number; y?: number };
        const simNodes: SimNode[] = nodes.map((n) => ({
          id: n.id,
          label: n.label ?? n.id,
          kind: n.kind ?? 'default',
        }));
        const simLinks = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));

        const linkForce = (forceLink(simLinks) as unknown as {
          id: (fn: (n: SimNode) => string) => unknown;
          distance: (d: number) => unknown;
        }).id((d) => d.id) as unknown as { distance: (d: number) => unknown };
        (linkForce as unknown as { distance: (d: number) => void }).distance(80);

        const sim = forceSimulation(simNodes) as unknown as {
          force: (name: string, f: unknown) => unknown;
          tick: (n: number) => unknown;
          stop: () => unknown;
        };
        sim.force('link', linkForce);
        sim.force('charge', (forceManyBody() as unknown as { strength: (s: number) => unknown }).strength(-220));
        sim.force('center', forceCenter(widthNum / 2, heightNum / 2));
        sim.tick(150);
        sim.stop();

        if (cancelled) return;
        setSettled({
          nodes: simNodes.map((n) => ({
            id: n.id,
            label: n.label,
            kind: n.kind,
            x: n.x ?? widthNum / 2,
            y: n.y ?? heightNum / 2,
          })),
          edges: simLinks.map((l) => ({
            id: l.id,
            source: typeof l.source === 'string' ? l.source : (l.source as { id: string }).id,
            target: typeof l.target === 'string' ? l.target : (l.target as { id: string }).id,
          })),
        });
      } catch (err) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('graph-viz:engine-error', {
            detail: { engine: 'd3-force', error: String(err) },
          }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [nodes, edges, widthNum, heightNum]);

  const theme = getBrandTheme(themeName);
  if (!settled) return <ForceGraphFallback {...props} />;

  const byId: Record<string, SettledNode> = {};
  settled.nodes.forEach((n) => { byId[n.id] = n; });

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-testid={testId ?? 'graph-viz-force'}
      width={widthNum}
      height={heightNum}
      style={{ background: theme.background.hex, borderRadius: 8 }}
    >
      <title>{ariaLabel}</title>
      {settled.edges.map((e) => {
        const s = byId[e.source]; const t = byId[e.target];
        if (!s || !t) return null;
        return (
          <line
            key={e.id}
            x1={s.x} y1={s.y} x2={t.x} y2={t.y}
            stroke={theme.edgeStroke.hex}
            strokeWidth={1.2}
            strokeOpacity={0.7}
          />
        );
      })}
      {settled.nodes.map((n) => (
        <g key={n.id}>
          <circle
            cx={n.x}
            cy={n.y}
            r={7}
            fill={pickCategoricalColor(theme, n.kind).hex}
            stroke={theme.nodeStroke.hex}
            strokeWidth={1}
          />
          <text
            x={n.x + 10}
            y={n.y + 4}
            fontSize={10}
            fill={theme.foreground.hex}
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
