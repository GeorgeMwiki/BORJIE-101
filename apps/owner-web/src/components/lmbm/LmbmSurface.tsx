'use client';

import { useMemo, useState } from 'react';
import { Skeleton, Alert, Button } from '@borjie/design-system';
import { useLmbmGraph } from '@/lib/queries/lmbm';
import { useLocale, pickByLocale } from '@/lib/locale';
import { lmbmExtra } from '@/i18n/strings/estate-lmbm';
import { GraphCanvas } from './GraphCanvas';
import { NodeDetail } from './NodeDetail';
import { TimeTravelSlider } from './TimeTravelSlider';

/**
 * O-W-03 LMBM graph explorer. Owns: as-of date, selected node id.
 * Splits the surface 2:1 — graph canvas left, detail panel right.
 */
export function LmbmSurface() {
  const locale = useLocale();
  const [asOf, setAsOf] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useLmbmGraph(asOf);
  const selectedNode = useMemo(
    () => (selectedId ? data?.nodes.find((n) => n.id === selectedId) ?? null : null),
    [data, selectedId],
  );

  return (
    <div className="space-y-4 px-8 py-6">
      <TimeTravelSlider asOf={asOf} onChange={setAsOf} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isError ? (
            <Alert variant="error" className="h-chart-md">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="font-medium">
                    {pickByLocale(locale, lmbmExtra.loadErrorTitle)}
                  </p>
                  <p className="text-sm">
                    {pickByLocale(locale, lmbmExtra.loadErrorBody)}
                  </p>
                </div>
                <div>
                  <Button size="sm" variant="outline" onClick={() => void refetch()}>
                    {pickByLocale(locale, lmbmExtra.retry)}
                  </Button>
                </div>
              </div>
            </Alert>
          ) : isLoading || !data ? (
            <Skeleton className="h-chart-md rounded-lg border border-border" />
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
