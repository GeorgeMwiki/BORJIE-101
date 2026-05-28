'use client';

/**
 * DiagramElement — flow / tree / venn / matrix renderer.
 *
 * Flow:    horizontal chain with directional arrows.
 * Tree:    nested indented tree, depth-staggered left-to-right reveal.
 * Venn:    two overlapping circles (sketch quality, not data-bound).
 * Matrix:  2x2 grid of labels (used for "decision matrix" lessons).
 *
 * No external graph layout dep — handcrafted SVG so the bundle stays
 * lean and the renders deterministic for snapshot tests.
 */

import type { ReactElement } from 'react';
import type { z } from 'zod';
import type { boardElementSchema, Bilingual } from '../types';

type DiagramPayload = Extract<z.infer<typeof boardElementSchema>, { type: 'diagram' }>;
type DiagramNode = DiagramPayload['nodes'][number];

function pick(b: Bilingual, lang: 'sw' | 'en'): string {
  return lang === 'sw' ? b.sw : b.en;
}

export interface DiagramElementProps {
  readonly payload: DiagramPayload;
  readonly languagePreference: 'sw' | 'en';
}

export function DiagramElement({ payload, languagePreference }: DiagramElementProps): ReactElement {
  return (
    <article
      data-testid="board-element-diagram"
      data-diagram-kind={payload.kind}
      data-element-id={payload.id}
      className="rounded-xl border border-border bg-surface/60 px-4 py-3"
    >
      {payload.kind === 'flow' ? (
        <FlowView nodes={payload.nodes} lang={languagePreference} />
      ) : null}
      {payload.kind === 'tree' ? (
        <TreeView nodes={payload.nodes} lang={languagePreference} />
      ) : null}
      {payload.kind === 'venn' ? (
        <VennView nodes={payload.nodes} lang={languagePreference} />
      ) : null}
      {payload.kind === 'matrix' ? (
        <MatrixView nodes={payload.nodes} lang={languagePreference} />
      ) : null}
    </article>
  );
}

// ─── Flow ───────────────────────────────────────────────────────────

function FlowView({
  nodes,
  lang,
}: {
  readonly nodes: ReadonlyArray<DiagramNode>;
  readonly lang: 'sw' | 'en';
}): ReactElement {
  return (
    <ol className="m-0 flex list-none flex-wrap items-stretch gap-2 p-0">
      {nodes.map((n, i) => (
        <li
          key={n.id}
          className="flex items-center gap-2"
          style={{ animationDelay: `${i * 90}ms` }}
        >
          <span className="inline-flex flex-col items-start rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-sm text-foreground">
            <span className="font-medium">{pick(n.label, lang)}</span>
            {n.meta ? (
              <span className="text-tiny text-neutral-400">{n.meta}</span>
            ) : null}
          </span>
          {i < nodes.length - 1 ? (
            <span aria-hidden="true" className="text-warning">
              {'→'}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

// ─── Tree ───────────────────────────────────────────────────────────

function TreeView({
  nodes,
  lang,
}: {
  readonly nodes: ReadonlyArray<DiagramNode>;
  readonly lang: 'sw' | 'en';
}): ReactElement {
  const childrenOf = new Map<string, DiagramNode[]>();
  let rootId: string | null = null;
  for (const n of nodes) {
    if (!n.parentId) {
      if (!rootId) rootId = n.id;
      continue;
    }
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n);
    childrenOf.set(n.parentId, list);
  }
  const root = rootId ? nodes.find((n) => n.id === rootId) : nodes[0];
  if (!root) return <p className="text-sm text-neutral-400">(empty tree)</p>;
  return (
    <div className="text-sm" data-testid="board-tree-root">
      <TreeNode node={root} childrenOf={childrenOf} lang={lang} depth={0} />
    </div>
  );
}

function TreeNode({
  node,
  childrenOf,
  lang,
  depth,
}: {
  readonly node: DiagramNode;
  readonly childrenOf: Map<string, DiagramNode[]>;
  readonly lang: 'sw' | 'en';
  readonly depth: number;
}): ReactElement {
  const children = childrenOf.get(node.id) ?? [];
  return (
    <div className="ml-3 border-l border-border pl-3 py-0.5" style={{ animationDelay: `${depth * 80}ms` }}>
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-foreground">{pick(node.label, lang)}</span>
        {node.meta ? <span className="text-tiny text-neutral-400">{node.meta}</span> : null}
      </div>
      {children.length > 0 ? (
        <div className="mt-1">
          {children.map((c) => (
            <TreeNode key={c.id} node={c} childrenOf={childrenOf} lang={lang} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Venn ───────────────────────────────────────────────────────────

function VennView({
  nodes,
  lang,
}: {
  readonly nodes: ReadonlyArray<DiagramNode>;
  readonly lang: 'sw' | 'en';
}): ReactElement {
  const a = nodes[0];
  const b = nodes[1];
  if (!a || !b) return <p className="text-sm text-neutral-400">(venn needs ≥2 nodes)</p>;
  return (
    <svg viewBox="0 0 240 140" className="h-32 w-full" role="img" aria-label="Venn diagram">
      <circle cx="92" cy="70" r="56" fill="hsl(var(--warning) / 0.18)" stroke="hsl(var(--warning))" strokeWidth="2" />
      <circle cx="148" cy="70" r="56" fill="hsl(var(--info) / 0.18)" stroke="hsl(var(--info))" strokeWidth="2" />
      <text x="62" y="74" textAnchor="middle" fontSize="11" fill="currentColor" className="font-medium">
        {pick(a.label, lang)}
      </text>
      <text x="178" y="74" textAnchor="middle" fontSize="11" fill="currentColor" className="font-medium">
        {pick(b.label, lang)}
      </text>
    </svg>
  );
}

// ─── Matrix ─────────────────────────────────────────────────────────

function MatrixView({
  nodes,
  lang,
}: {
  readonly nodes: ReadonlyArray<DiagramNode>;
  readonly lang: 'sw' | 'en';
}): ReactElement {
  const four = nodes.slice(0, 4);
  while (four.length < 4) {
    four.push({ id: `__pad_${four.length}`, label: { en: '—', sw: '—' } });
  }
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      {four.map((n) => (
        <div
          key={n.id}
          className="rounded-md border border-border bg-surface/40 px-3 py-2"
          data-testid="board-matrix-cell"
        >
          <p className="font-medium text-foreground">{pick(n.label, lang)}</p>
          {n.meta ? <p className="text-tiny text-neutral-400">{n.meta}</p> : null}
        </div>
      ))}
    </div>
  );
}
