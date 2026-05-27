'use client';

/**
 * TreeGraphView — force-directed cross-reference map of the blackboard.
 *
 * Every post becomes a node (color picks from the OKLCH knowledge-state
 * ramp). Every entry in `post.refs` becomes a directed edge from that
 * post to the referenced post. Clicking a node dispatches the same
 * `BlackboardEntityClickEvent` that `EntityLink` emits, so host portals
 * have a single contract for "user clicked an entity".
 *
 * The component lazy-loads `@borjie/graph-viz` so SSR is safe. When the
 * peer is missing (test bench without the workspace dep) the component
 * falls back to a deterministic SVG node list that exposes the same
 * `data-testid` attributes so behavioural tests still pass.
 *
 * Sources (2025-2026):
 *  - d3-force 7 — <https://d3js.org/d3-force> (2025-08)
 *  - WAI-ARIA — "Graph and node-link diagrams should expose role=img
 *    and ariaLabel".
 *    <https://www.w3.org/WAI/ARIA/apg/practices/landmarks/> (2026-02-22)
 */

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type {
  BlackboardPost,
  BlackboardEntityClickEventDetail,
  ViewProps,
  KnowledgeState,
} from '../types';
import { BLACKBOARD_OKLCH_THEME, tokenForKind } from '../themes/blackboard-oklch';
import { applyFilter } from '../components/SearchBar';

interface ForceGraphProps {
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly label?: string; readonly kind?: string }>;
  readonly edges: ReadonlyArray<{ readonly id: string; readonly source: string; readonly target: string }>;
  readonly ariaLabel: string;
  readonly onNodeSelect?: (nodeId: string) => void;
  readonly testId?: string;
}

interface GraphVizShape {
  readonly ForceGraphView: (props: ForceGraphProps) => JSX.Element;
}

let graphViz: GraphVizShape | null = null;

function tryLoadGraphViz(): GraphVizShape | null {
  if (graphViz !== null) return graphViz;
  if (typeof window === 'undefined') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('@borjie/graph-viz') as Partial<GraphVizShape>;
    if (mod && typeof mod.ForceGraphView === 'function') {
      graphViz = mod as GraphVizShape;
      return graphViz;
    }
    return null;
  } catch {
    return null;
  }
}

interface Node {
  readonly id: string;
  readonly label: string;
  readonly kind: KnowledgeState;
}

interface Edge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

function buildGraph(posts: ReadonlyArray<BlackboardPost>): {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
} {
  const allIds = new Set(posts.map((p) => p.id));
  const nodes: Node[] = posts.map((p) => ({
    id: p.id,
    label: `${p.knowledgeState}: ${p.body.slice(0, 32)}${p.body.length > 32 ? '…' : ''}`,
    kind: p.knowledgeState,
  }));
  const edges: Edge[] = [];
  for (const p of posts) {
    if (p.parentId && allIds.has(p.parentId)) {
      edges.push({ id: `${p.id}->${p.parentId}-parent`, source: p.id, target: p.parentId });
    }
    if (p.refs) {
      for (const target of p.refs) {
        if (allIds.has(target)) {
          edges.push({ id: `${p.id}->${target}`, source: p.id, target });
        }
      }
    }
  }
  return { nodes, edges };
}

function rootStyle(): CSSProperties {
  return {
    background: BLACKBOARD_OKLCH_THEME.background.oklch,
    color: BLACKBOARD_OKLCH_THEME.foreground.oklch,
    border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
    borderRadius: 12,
    padding: 8,
    minHeight: 360,
  };
}

interface FallbackProps {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
  readonly onSelect: (id: string) => void;
}

function FallbackTreeGraph({ nodes, edges, onSelect }: FallbackProps): JSX.Element {
  // Deterministic radial layout — pure function of node count so SSR
  // and CSR agree. Not interactive but exposes the same testid so
  // behavioural tests pass without the heavy peer.
  const cx = 300;
  const cy = 180;
  const radius = Math.min(140, 30 + nodes.length * 4);
  const positions: ReadonlyArray<{ readonly node: Node; readonly x: number; readonly y: number }> = nodes.map(
    (node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
      return {
        node,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      };
    },
  );
  const positionLookup = new Map(positions.map((p) => [p.node.id, p]));
  return (
    <svg
      role="img"
      aria-label="Blackboard cross-reference graph"
      data-testid="tree-graph-fallback"
      viewBox="0 0 600 360"
      style={{ width: '100%', height: 360 }}
    >
      {edges.map((e) => {
        const a = positionLookup.get(e.source);
        const b = positionLookup.get(e.target);
        if (!a || !b) return null;
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={BLACKBOARD_OKLCH_THEME.border.oklch}
            strokeWidth={1}
            data-testid={`edge-${e.id}`}
          />
        );
      })}
      {positions.map(({ node, x, y }) => (
        <g key={node.id} data-testid={`tree-node-${node.id}`} data-knowledge-state={node.kind}>
          <circle
            cx={x}
            cy={y}
            r={8}
            fill={tokenForKind(node.kind).oklch}
            stroke={BLACKBOARD_OKLCH_THEME.surface.oklch}
            strokeWidth={2}
            tabIndex={0}
            onClick={() => onSelect(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(node.id);
              }
            }}
            className="bb-focusable"
            style={{ cursor: 'pointer' }}
            aria-label={node.label}
          />
        </g>
      ))}
    </svg>
  );
}

export function TreeGraphView(props: ViewProps): JSX.Element {
  const { posts, filter, onFocusPost } = props;

  const filteredPosts = useMemo(
    () => (filter ? applyFilter(posts, filter) : posts),
    [posts, filter],
  );

  const graph = useMemo(() => buildGraph(filteredPosts), [filteredPosts]);

  const [viz, setViz] = useState<GraphVizShape | null>(null);
  useEffect(() => {
    setViz(tryLoadGraphViz());
  }, []);

  function handleSelect(nodeId: string): void {
    if (onFocusPost) onFocusPost(nodeId);
    if (typeof window !== 'undefined') {
      const detail: BlackboardEntityClickEventDetail = {
        ref: { kind: 'tool', id: nodeId, label: nodeId },
        originPostId: nodeId,
      };
      window.dispatchEvent(
        new CustomEvent<BlackboardEntityClickEventDetail>('bb:entity-click', { detail }),
      );
    }
  }

  let inner: ReactNode;
  if (graph.nodes.length === 0) {
    inner = (
      <div
        data-testid="tree-graph-empty"
        style={{
          fontSize: 12,
          color: BLACKBOARD_OKLCH_THEME.muted.oklch,
          textAlign: 'center',
          padding: 24,
        }}
      >
        No posts yet.
      </div>
    );
  } else if (viz) {
    inner = (
      <viz.ForceGraphView
        nodes={graph.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind }))}
        edges={graph.edges}
        ariaLabel="Blackboard cross-reference graph"
        onNodeSelect={handleSelect}
        testId="tree-graph-engine"
      />
    );
  } else {
    inner = (
      <FallbackTreeGraph
        nodes={graph.nodes}
        edges={graph.edges}
        onSelect={handleSelect}
      />
    );
  }

  return (
    <div
      data-testid="tree-graph-view"
      role="region"
      aria-label="Tree-graph blackboard view"
      style={rootStyle()}
    >
      {inner}
    </div>
  );
}
