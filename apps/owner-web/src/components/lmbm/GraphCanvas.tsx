'use client';

import { useMemo } from 'react';
import type { LmbmGraph, LmbmNode } from '@/lib/mocks/lmbm';

interface GraphCanvasProps {
  readonly graph: LmbmGraph;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}

const KIND_COLOR: Record<LmbmNode['kind'], string> = {
  company: 'hsl(var(--warning))',
  licence: 'hsl(var(--info))',
  site: 'hsl(var(--success))',
  document: 'hsl(var(--secondary-foreground))',
  person: 'hsl(var(--primary))',
  event: 'hsl(var(--destructive))',
};

/**
 * Deterministic radial layout for the LMBM graph.
 *
 * A real implementation would use d3-force. For the bootstrap surface
 * we place the company at the centre and arrange the rest of the
 * nodes in concentric rings keyed off `kind` so the graph reads
 * meaningfully without any animation cost.
 */
export function GraphCanvas({ graph, selectedId, onSelect }: GraphCanvasProps) {
  const layout = useMemo(() => buildLayout(graph), [graph]);
  return (
    <div className="relative h-[520px] rounded-lg border border-border bg-surface/30">
      <svg viewBox="0 0 800 520" className="h-full w-full">
        {graph.edges.map((edge) => {
          const s = layout.get(edge.source);
          const t = layout.get(edge.target);
          if (!s || !t) return null;
          return (
            <line
              key={edge.id}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke="hsl(var(--border))"
              strokeWidth={1}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const pos = layout.get(node.id);
          if (!pos) return null;
          const color = KIND_COLOR[node.kind];
          const isSelected = node.id === selectedId;
          return (
            <g
              key={node.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(node.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(node.id);
              }}
              className="cursor-pointer focus:outline-none"
            >
              <circle
                r={isSelected ? 14 : 10}
                fill={color}
                fillOpacity={isSelected ? 0.95 : 0.7}
                stroke={isSelected ? 'hsl(var(--foreground))' : 'transparent'}
                strokeWidth={isSelected ? 2 : 0}
              />
              <text
                y={26}
                textAnchor="middle"
                fontSize={10}
                fill="hsl(var(--foreground))"
                fontFamily="var(--font-mono, monospace)"
              >
                {truncate(node.label, 22)}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend />
    </div>
  );
}

function buildLayout(graph: LmbmGraph): Map<string, { x: number; y: number }> {
  const center = { x: 400, y: 260 };
  const map = new Map<string, { x: number; y: number }>();
  const company = graph.nodes.find((n) => n.kind === 'company');
  if (company) map.set(company.id, { ...center });

  const ringByKind: Record<LmbmNode['kind'], number> = {
    company: 0,
    licence: 110,
    site: 200,
    document: 250,
    person: 250,
    event: 200,
  };
  const groups = new Map<LmbmNode['kind'], LmbmNode[]>();
  for (const node of graph.nodes) {
    if (node.kind === 'company') continue;
    const arr = groups.get(node.kind) ?? [];
    arr.push(node);
    groups.set(node.kind, arr);
  }
  for (const [kind, nodes] of groups.entries()) {
    const r = ringByKind[kind] ?? 180;
    nodes.forEach((node, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 + ringAngleOffset(kind);
      map.set(node.id, {
        x: center.x + Math.cos(angle) * r,
        y: center.y + Math.sin(angle) * r,
      });
    });
  }
  return map;
}

function ringAngleOffset(kind: LmbmNode['kind']): number {
  const offsets: Partial<Record<LmbmNode['kind'], number>> = {
    licence: 0,
    site: Math.PI / 4,
    document: Math.PI / 2,
    person: -Math.PI / 2,
    event: Math.PI / 6,
  };
  return offsets[kind] ?? 0;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function Legend() {
  return (
    <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 rounded-md border border-border bg-surface/90 px-2 py-1 text-[10px] text-neutral-300">
      {(Object.keys(KIND_COLOR) as Array<keyof typeof KIND_COLOR>).map((kind) => (
        <span key={kind} className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: KIND_COLOR[kind] }}
          />
          {kind}
        </span>
      ))}
    </div>
  );
}
