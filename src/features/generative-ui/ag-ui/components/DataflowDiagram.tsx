"use client";

/**
 * 35. dataflow-diagram — node/edge view of an upcoming workflow.
 *
 * Pure SVG. Nodes positioned via topological layering (BFS from sources)
 * for stable left-to-right reading. Edges drawn as quadratic curves
 * between node anchors. No d3 / react-flow dependency.
 */

import { useMemo } from "react";

import type { AgUiUiPartByKind, DataflowEdge, DataflowNode } from "../types";
import { Frame, GenUiError } from "./Frame";
import { DataflowDiagramPartSchema } from "../schemas";

export type DataflowDiagramProps = AgUiUiPartByKind<"dataflow-diagram">;

const NODE_WIDTH = 130;
const NODE_HEIGHT = 44;
const LAYER_GAP_X = 70;
const ROW_GAP_Y = 14;

const STATUS_COLOURS = {
  pending: "#94a3b8",
  running: "#3b82f6",
  done: "#10b981",
  failed: "#ef4444",
} as const;

const KIND_FILL = {
  source: "#dbeafe",
  transform: "#f3f4f6",
  sink: "#dcfce7",
  decision: "#fef3c7",
} as const;

interface LayoutNode extends DataflowNode {
  readonly x: number;
  readonly y: number;
}

function computeLayout(
  nodes: ReadonlyArray<DataflowNode>,
  edges: ReadonlyArray<DataflowEdge>,
): { laidOut: ReadonlyArray<LayoutNode>; width: number; height: number } {
  // Topological layering by longest-path from sources.
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges) inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      layer.set(n.id, 0);
      queue.push(n.id);
    }
  }
  const outBy = new Map<string, string[]>();
  for (const e of edges) {
    const arr = outBy.get(e.from);
    if (arr) arr.push(e.to);
    else outBy.set(e.from, [e.to]);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const lvl = layer.get(id) ?? 0;
    for (const to of outBy.get(id) ?? []) {
      const next = Math.max(layer.get(to) ?? 0, lvl + 1);
      layer.set(to, next);
      // Decrement in-degree only when ready — simple BFS approximation.
      queue.push(to);
    }
  }
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  }

  const byLayer = new Map<number, DataflowNode[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = byLayer.get(l);
    if (arr) arr.push(n);
    else byLayer.set(l, [n]);
  }

  const laidOut: LayoutNode[] = [];
  let maxLayer = 0;
  let maxRow = 0;
  for (const [l, arr] of byLayer.entries()) {
    maxLayer = Math.max(maxLayer, l);
    maxRow = Math.max(maxRow, arr.length);
    arr.forEach((n, idx) => {
      laidOut.push({
        ...n,
        x: l * (NODE_WIDTH + LAYER_GAP_X) + 10,
        y: idx * (NODE_HEIGHT + ROW_GAP_Y) + 10,
      });
    });
  }
  const width = (maxLayer + 1) * (NODE_WIDTH + LAYER_GAP_X) + 10;
  const height = maxRow * (NODE_HEIGHT + ROW_GAP_Y) + 30;
  return { laidOut, width, height };
}

export function DataflowDiagram(props: DataflowDiagramProps): JSX.Element {
  const parsed = DataflowDiagramPartSchema.safeParse(props);
  const layout = useMemo(
    () => computeLayout(props.nodes, props.edges),
    [props.nodes, props.edges],
  );

  if (!parsed.success) {
    return (
      <GenUiError
        kind="dataflow-diagram"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  const nodeById = new Map(layout.laidOut.map((n) => [n.id, n]));

  return (
    <Frame
      kind="dataflow-diagram"
      {...(props.title ? { title: props.title } : {})}
    >
      <div className="overflow-x-auto">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={props.title ?? "dataflow diagram"}
        >
          <defs>
            <marker
              id="dataflow-arrow"
              viewBox="0 -5 10 10"
              refX="10"
              refY="0"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,-5L10,0L0,5" fill="#64748b" />
            </marker>
          </defs>
          {props.edges.map((e, i) => {
            const a = nodeById.get(e.from);
            const b = nodeById.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_WIDTH;
            const y1 = a.y + NODE_HEIGHT / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_HEIGHT / 2;
            const cx = (x1 + x2) / 2;
            return (
              <g key={i}>
                <path
                  d={`M ${x1} ${y1} Q ${cx} ${y1} ${cx} ${(y1 + y2) / 2} T ${x2} ${y2}`}
                  stroke="#64748b"
                  strokeWidth="1.5"
                  fill="none"
                  markerEnd="url(#dataflow-arrow)"
                />
                {e.label ? (
                  <text
                    x={cx}
                    y={(y1 + y2) / 2 - 4}
                    fontSize="10"
                    textAnchor="middle"
                    fill="#475569"
                  >
                    {e.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {layout.laidOut.map((n) => (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx="6"
                fill={KIND_FILL[n.kind]}
                stroke={n.status ? STATUS_COLOURS[n.status] : "#cbd5e1"}
                strokeWidth={n.status ? 2 : 1}
              />
              <text
                x={n.x + NODE_WIDTH / 2}
                y={n.y + NODE_HEIGHT / 2 - 2}
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
                fill="#0f172a"
              >
                {n.label.length > 16 ? `${n.label.slice(0, 16)}…` : n.label}
              </text>
              <text
                x={n.x + NODE_WIDTH / 2}
                y={n.y + NODE_HEIGHT / 2 + 12}
                fontSize="9"
                textAnchor="middle"
                fill="#64748b"
              >
                {n.kind}
                {n.status ? ` · ${n.status}` : ""}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </Frame>
  );
}
