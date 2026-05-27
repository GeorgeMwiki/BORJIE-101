'use client';

/**
 * SankeyView — D3 sankey wrapper.
 *
 * Self-contained SVG rendering. We avoid `react-d3-*` wrappers because
 * they bundle d3 (defeats peer-dep tree-shaking) and lock the brand
 * palette. Instead we lay out the sankey via `d3-sankey` and project
 * the laid-out result into pure JSX <path> + <rect>.
 *
 * Sources:
 *  - d3-sankey 0.12 — https://github.com/d3/d3-sankey (2025-06)
 *  - "Sankey Diagrams in d3.js" — https://www.d3indepth.com/sankey/ (2025-08)
 */

import { useEffect, useMemo, useState } from 'react';
import { ClientOnly } from './ClientOnly';
import { getBrandTheme, pickCategoricalColor } from '../themes/oklch-brand-theme';
import type { SankeyVizProps, SankeyNode, SankeyLink } from '../types';

interface LaidOutNode extends SankeyNode {
  x0: number; x1: number; y0: number; y1: number;
}
interface LaidOutLink extends Omit<SankeyLink, 'source' | 'target'> {
  source: LaidOutNode; target: LaidOutNode; width: number; y0: number; y1: number;
}

export function SankeyView(props: SankeyVizProps): JSX.Element {
  return (
    <ClientOnly fallback={<SankeyFallback {...props} />}>
      <SankeyViewInner {...props} />
    </ClientOnly>
  );
}

function SankeyFallback({ ariaLabel, height = 360, width = 720, testId, themeName }: SankeyVizProps): JSX.Element {
  const theme = getBrandTheme(themeName);
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-testid={testId ?? 'graph-viz-sankey'}
      width={width}
      height={height}
      style={{ background: theme.background.hex, borderRadius: 8 }}
    >
      <title>{ariaLabel}</title>
    </svg>
  );
}

function SankeyViewInner(props: SankeyVizProps): JSX.Element {
  const {
    nodes,
    links,
    height = 360,
    width = 720,
    themeName = 'brand-light',
    unitLabel,
    ariaLabel,
    testId,
  } = props;

  const [laid, setLaid] = useState<{ nodes: LaidOutNode[]; links: LaidOutLink[]; linkPath: (l: LaidOutLink) => string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('d3-sankey');
        const sankey = (mod as unknown as { sankey: () => unknown; sankeyLinkHorizontal: () => unknown }).sankey;
        const sankeyLinkHorizontal = (mod as unknown as { sankeyLinkHorizontal: () => unknown }).sankeyLinkHorizontal;

        const layout = (sankey() as unknown as {
          nodeId: (fn: (n: SankeyNode) => string) => unknown;
          nodeWidth: (w: number) => unknown;
          nodePadding: (p: number) => unknown;
          extent: (ext: number[][]) => unknown;
        })
          .nodeId((n) => n.id) as unknown as {
            nodeWidth: (w: number) => typeof layout;
            nodePadding: (p: number) => typeof layout;
            extent: (e: number[][]) => typeof layout;
            (data: unknown): { nodes: LaidOutNode[]; links: LaidOutLink[] };
          };

        layout.nodeWidth(14).nodePadding(14).extent([[8, 8], [width - 8, height - 8]]);

        const graphInput = {
          nodes: nodes.map((n) => ({ ...n })),
          links: links.map((l) => ({ ...l })),
        };
        const out = (layout as unknown as (g: unknown) => { nodes: LaidOutNode[]; links: LaidOutLink[] })(graphInput);

        const linkPath = sankeyLinkHorizontal() as unknown as (l: LaidOutLink) => string;
        if (!cancelled) setLaid({ nodes: out.nodes, links: out.links, linkPath });
      } catch (err) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('graph-viz:engine-error', {
            detail: { engine: 'd3-sankey', error: String(err) },
          }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [nodes, links, width, height]);

  const theme = getBrandTheme(themeName);
  const totalFlow = useMemo(
    () => links.reduce((acc, l) => acc + (l.value > 0 ? l.value : 0), 0),
    [links],
  );

  if (!laid) {
    return <SankeyFallback {...props} />;
  }

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-testid={testId ?? 'graph-viz-sankey'}
      width={width}
      height={height}
      style={{ background: theme.background.hex, borderRadius: 8 }}
    >
      <title>{ariaLabel}</title>
      <desc>
        {`Sankey diagram, ${laid.nodes.length} nodes, total flow ${totalFlow}${unitLabel ? ' ' + unitLabel : ''}.`}
      </desc>
      {laid.links.map((l, i) => {
        const color = l.color
          ?? pickCategoricalColor(theme, `${l.source.id}->${l.target.id}`).hex;
        return (
          <path
            key={`l-${i}`}
            d={laid.linkPath(l)}
            fill="none"
            stroke={color}
            strokeOpacity={0.45}
            strokeWidth={Math.max(1, l.width)}
          />
        );
      })}
      {laid.nodes.map((n) => {
        const color = n.color ?? pickCategoricalColor(theme, n.category ?? n.id).hex;
        return (
          <g key={`n-${n.id}`}>
            <rect
              x={n.x0}
              y={n.y0}
              width={n.x1 - n.x0}
              height={n.y1 - n.y0}
              fill={color}
              stroke={theme.nodeStroke.hex}
              strokeWidth={1}
            />
            <text
              x={n.x0 < width / 2 ? n.x1 + 6 : n.x0 - 6}
              y={(n.y0 + n.y1) / 2}
              dy="0.35em"
              textAnchor={n.x0 < width / 2 ? 'start' : 'end'}
              fontSize={11}
              fill={theme.foreground.hex}
            >
              {n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
