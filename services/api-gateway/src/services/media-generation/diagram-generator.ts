/**
 * Server-side diagram renderer — nodes + edges to SVG.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Lays out small flow / org / process
 * diagrams (<= 30 nodes) using a simple top-down auto-layout. No
 * external deps; for richer Mermaid / Graphviz semantics we delegate
 * to a future bundle when one ships.
 */

export type DiagramKind = 'flow' | 'org' | 'process';

export interface DiagramNode {
  readonly id: string;
  readonly label: string;
}

export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface GenerateDiagramInput {
  readonly kind: DiagramKind;
  readonly nodes: ReadonlyArray<DiagramNode>;
  readonly edges: ReadonlyArray<DiagramEdge>;
  readonly title?: string;
  readonly width?: number;
}

export interface GenerateDiagramOutput {
  readonly svg: Buffer;
  readonly contentType: string;
  readonly durationMs: number;
}

const NODE_W = 160;
const NODE_H = 48;
const COL_GAP = 40;
const ROW_GAP = 64;

export function generateDiagram(
  input: GenerateDiagramInput,
): GenerateDiagramOutput {
  const start = Date.now();
  if (input.nodes.length === 0) {
    throw new Error('diagram-generator: at least one node required');
  }
  const layers = topologicalLayers(input.nodes, input.edges);
  const cols = Math.max(...layers.map((l) => l.length));
  const width = input.width ?? Math.max(600, cols * (NODE_W + COL_GAP) + COL_GAP);
  const height = 80 + layers.length * (NODE_H + ROW_GAP);

  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, layerIdx) => {
    const totalLayerWidth = layer.length * NODE_W + (layer.length - 1) * COL_GAP;
    const startX = (width - totalLayerWidth) / 2;
    layer.forEach((id, colIdx) => {
      positions.set(id, {
        x: startX + colIdx * (NODE_W + COL_GAP),
        y: 56 + layerIdx * (NODE_H + ROW_GAP),
      });
    });
  });

  const nodeShapes = input.nodes
    .map((n) => {
      const p = positions.get(n.id);
      if (!p) return '';
      return `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="6" ry="6" fill="#F7F5EE" stroke="#C8A24B" stroke-width="1.5"/>
        <text x="${p.x + NODE_W / 2}" y="${p.y + NODE_H / 2 + 4}" text-anchor="middle" font-size="12" fill="#0B0D12">${escape(n.label)}</text>`;
    })
    .join('\n');

  const edgeLines = input.edges
    .map((e) => {
      const a = positions.get(e.from);
      const b = positions.get(e.to);
      if (!a || !b) return '';
      const x1 = a.x + NODE_W / 2;
      const y1 = a.y + NODE_H;
      const x2 = b.x + NODE_W / 2;
      const y2 = b.y;
      const labelTxt = e.label
        ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" font-size="10" fill="#5C5F66" text-anchor="middle">${escape(e.label)}</text>`
        : '';
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5C5F66" stroke-width="1.5" marker-end="url(#arrow)"/>${labelTxt}`;
    })
    .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter,Helvetica,Arial,sans-serif">
  <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#5C5F66"/></marker></defs>
  <rect width="${width}" height="${height}" fill="#FFFFFF"/>
  ${input.title ? `<text x="24" y="28" font-size="14" font-weight="700" fill="#0B0D12">${escape(input.title)}</text>` : ''}
  ${edgeLines}
  ${nodeShapes}
  <text x="${width - 8}" y="${height - 8}" text-anchor="end" font-size="10" fill="#5C5F66">Borjie</text>
</svg>`;

  return {
    svg: Buffer.from(svg, 'utf8'),
    contentType: 'image/svg+xml',
    durationMs: Date.now() - start,
  };
}

function topologicalLayers(
  nodes: ReadonlyArray<DiagramNode>,
  edges: ReadonlyArray<DiagramEdge>,
): string[][] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.get(e.from)?.push(e.to);
  }
  const layers: string[][] = [];
  let current = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  if (current.length === 0) {
    return [nodes.map((n) => n.id)];
  }
  while (current.length > 0) {
    layers.push(current);
    const next: string[] = [];
    for (const id of current) {
      for (const child of adj.get(id) ?? []) {
        indeg.set(child, (indeg.get(child) ?? 1) - 1);
        if ((indeg.get(child) ?? 0) === 0) next.push(child);
      }
    }
    current = next;
  }
  return layers;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
