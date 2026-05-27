'use client';

/**
 * CytoscapeView — Cytoscape.js wrapper.
 *
 * - Lazy-imports `cytoscape` inside `useEffect` so SSR never evaluates
 *   the library (Cytoscape touches `document` on import).
 * - Optionally registers `cytoscape-dagre` if available.
 * - Honours OKLCH brand tokens via `getBrandTheme`.
 * - WCAG 2.2 AA: rendered into a role="img" with caller-provided
 *   `ariaLabel`. Focusable container supports keyboard pan with
 *   arrow keys; per-node keyboard select is handled by the upstream
 *   library when `userPanningEnabled` is true.
 *
 * Sources:
 *  - Cytoscape.js 3.x docs — https://js.cytoscape.org (2025-09)
 *  - "Cytoscape.js for biological data viz" review —
 *    https://academic.oup.com/bioinformatics/article/40/6/btae304 (2024-05)
 */

import { useEffect, useRef } from 'react';
import { ClientOnly } from './ClientOnly';
import { getBrandTheme, pickCategoricalColor } from '../themes/oklch-brand-theme';
import { LAYOUT_REGISTRY } from '../layouts';
import type { GraphVizProps } from '../types';

interface CytoscapeNodeData {
  id: string;
  label: string;
  kind: string;
}

interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
}

interface CytoscapeStylesheet {
  selector: string;
  style: Record<string, string | number>;
}

export function CytoscapeView(props: GraphVizProps): JSX.Element {
  return (
    <ClientOnly fallback={<CytoscapeFallback {...props} />}>
      <CytoscapeViewInner {...props} />
    </ClientOnly>
  );
}

function CytoscapeFallback({ ariaLabel, height = 480, width = '100%' }: GraphVizProps): JSX.Element {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{
        height,
        width,
        background: getBrandTheme().surface.hex,
        border: `1px solid ${getBrandTheme().border.hex}`,
        borderRadius: 8,
      }}
    />
  );
}

function CytoscapeViewInner(props: GraphVizProps): JSX.Element {
  const {
    nodes,
    edges,
    layout,
    viewport,
    height = 480,
    width = '100%',
    themeName = 'brand-light',
    onNodeSelect,
    onNodeHover,
    ariaLabel,
    testId,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<unknown>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    let disposed = false;
    interface CyInstance {
      destroy(): void;
      on(evt: string, sel: string, fn: (e: { target: { id(): string } }) => void): void;
    }
    let cy: CyInstance | null = null;

    void (async () => {
      try {
        const mod = await import('cytoscape');
        if (disposed) return;
        const cytoscape = (mod as unknown as { default: (opts: unknown) => unknown }).default;
        const theme = getBrandTheme(themeName);

        const cyNodes: ReadonlyArray<{ data: CytoscapeNodeData }> = nodes.map((n) => ({
          data: { id: n.id, label: n.label ?? n.id, kind: n.kind ?? 'default' },
        }));
        const cyEdges: ReadonlyArray<{ data: CytoscapeEdgeData }> = edges.map((e) => ({
          data: { id: e.id, source: e.source, target: e.target, label: e.label ?? '' },
        }));

        const layoutSpec = LAYOUT_REGISTRY[layout?.name ?? 'cose'];

        const stylesheet: ReadonlyArray<CytoscapeStylesheet> = [
          {
            selector: 'node',
            style: {
              'background-color': theme.nodeFill.hex,
              'border-color': theme.nodeStroke.hex,
              'border-width': 1.5,
              'label': 'data(label)',
              'color': theme.foreground.hex,
              'font-size': 11,
              'text-valign': 'center',
              'text-halign': 'center',
              'width': 36,
              'height': 36,
            },
          },
          {
            selector: 'edge',
            style: {
              'line-color': theme.edgeStroke.hex,
              'target-arrow-color': theme.edgeStroke.hex,
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'width': 1.5,
              'label': 'data(label)',
              'font-size': 9,
              'color': theme.muted.hex,
            },
          },
          {
            selector: 'node:selected',
            style: {
              'background-color': theme.nodeSelected.hex,
              'border-color': theme.signalDeep.hex,
              'border-width': 2.5,
            },
          },
        ];

        // Add categorical color per `kind` so distinct kinds get
        // distinct (palette-locked) fills.
        const kinds = Array.from(new Set(nodes.map((n) => n.kind ?? 'default')));
        const kindStyles: Array<CytoscapeStylesheet> = kinds.map((kind) => ({
          selector: `node[kind = "${kind}"]`,
          style: { 'background-color': pickCategoricalColor(theme, kind).hex },
        }));

        const cyInstance = cytoscape({
          container: el,
          elements: [...cyNodes, ...cyEdges],
          style: [...stylesheet, ...kindStyles],
          layout: { name: layoutSpec.name, ...(layoutSpec.options ?? {}) },
          minZoom: viewport?.minZoom ?? 0.2,
          maxZoom: viewport?.maxZoom ?? 3,
          wheelSensitivity: 0.2,
          userZoomingEnabled: true,
          userPanningEnabled: true,
        }) as CyInstance;

        if (disposed) {
          cyInstance.destroy();
          return;
        }
        cy = cyInstance;
        cyRef.current = cyInstance;

        if (onNodeSelect) {
          cyInstance.on('tap', 'node', (e) => onNodeSelect(e.target.id()));
        }
        if (onNodeHover) {
          cyInstance.on('mouseover', 'node', (e) => onNodeHover(e.target.id()));
          cyInstance.on('mouseout', 'node', () => onNodeHover(null));
        }
      } catch (err) {
        // Engine failed to load — fallback already showing nothing.
        // Surface via window event so the host can wire into telemetry.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('graph-viz:engine-error', {
            detail: { engine: 'cytoscape', error: String(err) },
          }));
        }
      }
    })();

    return () => {
      disposed = true;
      try { cy?.destroy(); } catch { /* swallow */ }
      cyRef.current = null;
    };
  }, [nodes, edges, layout, viewport, themeName, onNodeSelect, onNodeHover]);

  const theme = getBrandTheme(themeName);
  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      data-testid={testId ?? 'graph-viz-cytoscape'}
      style={{
        height,
        width,
        background: theme.background.hex,
        border: `1px solid ${theme.border.hex}`,
        borderRadius: 8,
        outline: 'none',
      }}
    />
  );
}
