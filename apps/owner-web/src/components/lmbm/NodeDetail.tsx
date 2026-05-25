'use client';

import { X } from 'lucide-react';
import type { LmbmNode } from '@/lib/mocks/lmbm';
import { fmtDate } from '@/lib/format';

interface NodeDetailProps {
  readonly node: LmbmNode | null;
  readonly onClose: () => void;
}

/**
 * Right-side detail panel for the LMBM. Shows attributes, valid_from/
 * valid_to (bi-temporal), and the evidence chain that wrote this node.
 */
export function NodeDetail({ node, onClose }: NodeDetailProps) {
  if (!node) {
    return (
      <aside className="flex h-[520px] w-full flex-col rounded-lg border border-dashed border-border bg-surface/30 px-4 py-4 text-sm text-neutral-400">
        Select a node to see its attributes and evidence chain.
      </aside>
    );
  }
  return (
    <aside className="flex h-[520px] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface/50">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">
            {node.kind}
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">
            {node.label}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-neutral-400 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
        <section>
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
            Validity
          </div>
          <div className="text-foreground">
            {fmtDate(node.validFrom)} → {node.validTo ? fmtDate(node.validTo) : 'open'}
          </div>
        </section>
        <section>
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
            Attributes
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {Object.entries(node.attributes).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="text-foreground">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
            Evidence chain
          </div>
          <ul className="space-y-2 text-xs">
            {node.evidence.map((ev, idx) => (
              <li
                key={idx}
                className="rounded-md border border-border bg-surface px-2 py-2"
              >
                <div className="text-neutral-300">{ev.source}</div>
                <div className="mt-1 italic text-neutral-400">{ev.excerpt}</div>
                <div className="mt-1 text-[10px] text-neutral-500">
                  confidence {(ev.confidence * 100).toFixed(0)}%
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}
