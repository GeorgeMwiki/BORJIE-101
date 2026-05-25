'use client';

import { useMemo, useState } from 'react';
import { useLmbmGraph } from '@/lib/queries/lmbm';
import { GraphCanvas } from './GraphCanvas';
import { NodeDetail } from './NodeDetail';
import { TimeTravelSlider } from './TimeTravelSlider';

/**
 * O-W-03 LMBM graph explorer. Owns: as-of date, selected node id.
 * Splits the surface 2:1 — graph canvas left, detail panel right.
 */
export function LmbmSurface() {
  const [asOf, setAsOf] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = useLmbmGraph(asOf);
  const selectedNode = useMemo(
    () => (selectedId ? data?.nodes.find((n) => n.id === selectedId) ?? null : null),
    [data, selectedId],
  );

  return (
    <div className="space-y-4 px-8 py-6">
      <TimeTravelSlider asOf={asOf} onChange={setAsOf} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isLoading || !data ? (
            <div className="h-[520px] animate-pulse rounded-lg border border-border bg-surface/40" />
          ) : (
            <GraphCanvas
              graph={data}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
        <NodeDetail node={selectedNode} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  );
}
