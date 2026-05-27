'use client';

/**
 * ReactFlowView — react-flow 12 wrapper.
 *
 * react-flow is the right default for editable flow diagrams (think
 * workflow builders, pipeline editors) but also works well for
 * read-only graphs in the 100-5k node band where SVG/Canvas hybrids
 * outperform pure SVG. We lazy-load it so SSR is safe.
 *
 * Sources:
 *  - react-flow 12 docs — https://reactflow.dev (xyflow, 2025-04)
 *  - "react-flow 12 release notes" — https://reactflow.dev/blog/react-flow-12 (2025-03)
 */

import { useEffect, useMemo, useState } from 'react';
import { ClientOnly } from './ClientOnly';
import { getBrandTheme, pickCategoricalColor } from '../themes/oklch-brand-theme';
import type { GraphVizProps } from '../types';

interface RfNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string };
  type?: string;
  style?: Record<string, string | number>;
}

interface RfEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  style?: Record<string, string | number>;
}

export function ReactFlowView(props: GraphVizProps): JSX.Element {
  return (
    <ClientOnly fallback={<div data-testid={props.testId ?? 'graph-viz-reactflow-loading'} />}>
      <ReactFlowViewInner {...props} />
    </ClientOnly>
  );
}

function ReactFlowViewInner(props: GraphVizProps): JSX.Element {
  const {
    nodes,
    edges,
    height = 480,
    width = '100%',
    themeName = 'brand-light',
    ariaLabel,
    testId,
  } = props;

  // We capture the dynamically loaded module shape into local state.
  const [mod, setMod] = useState<unknown | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const m = await import('reactflow');
        if (!cancelled) setMod(m);
      } catch (err) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('graph-viz:engine-error', {
            detail: { engine: 'reactflow', error: String(err) },
          }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const theme = getBrandTheme(themeName);

  const rfNodes: ReadonlyArray<RfNode> = useMemo(() => nodes.map((n, i) => ({
    id: n.id,
    position: n.position ?? { x: (i % 10) * 140, y: Math.floor(i / 10) * 96 },
    data: { label: n.label ?? n.id },
    style: {
      background: pickCategoricalColor(theme, n.kind ?? 'default').hex,
      color: theme.foreground.hex,
      border: `1px solid ${theme.nodeStroke.hex}`,
      borderRadius: 8,
      padding: 8,
      fontSize: 11,
    },
  })), [nodes, theme]);

  const rfEdges: ReadonlyArray<RfEdge> = useMemo(() => edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: false,
    style: {
      stroke: theme.edgeStroke.hex,
      strokeWidth: 1.4,
    },
  })), [edges, theme]);

  if (!mod) {
    return (
      <div
        role="img"
        aria-label={ariaLabel}
        data-testid={testId ?? 'graph-viz-reactflow'}
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

  // We loaded reactflow at runtime. Cast through `unknown` because the
  // module shape is not known at compile time in this package.
  const { ReactFlow, Background, Controls } = mod as {
    ReactFlow: (p: Record<string, unknown>) => JSX.Element;
    Background: (p: Record<string, unknown>) => JSX.Element;
    Controls: (p: Record<string, unknown>) => JSX.Element;
  };

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      data-testid={testId ?? 'graph-viz-reactflow'}
      style={{
        height,
        width,
        background: theme.background.hex,
        border: `1px solid ${theme.border.hex}`,
        borderRadius: 8,
      }}
    >
      <ReactFlow nodes={rfNodes} edges={rfEdges} fitView proOptions={{ hideAttribution: true }}>
        <Background color={theme.border.hex} gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
