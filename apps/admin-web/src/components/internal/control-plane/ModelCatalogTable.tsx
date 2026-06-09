'use client';

import { StubBadge } from '../StubBadge';
import { useModelCatalogQuery } from '@/lib/internal/control-plane/queries';
import type { CatalogModel } from '@/lib/internal/control-plane/api';

function capabilityTone(rank: number): 'success' | 'info' | 'neutral' {
  if (rank >= 5) return 'success';
  if (rank >= 3) return 'info';
  return 'neutral';
}

/**
 * MODEL CATALOG — read-only table of the assignable models with their
 * cost / capability / latency metadata, sourced live from GET /model-catalog.
 * Informs the routing pickers; never mutates anything.
 */
export function ModelCatalogTable(): JSX.Element {
  const query = useModelCatalogQuery();

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading model catalog…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const models: ReadonlyArray<CatalogModel> = query.data?.models ?? [];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium">Family</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Capability</th>
              <th className="px-4 py-3 text-right font-medium">Cost / 1M tok</th>
              <th className="px-4 py-3 text-right font-medium">p50 latency</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.model} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <p className="text-foreground">{m.label}</p>
                  <p className="font-mono text-xs text-neutral-500">{m.model}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-300">{m.family}</td>
                <td className="px-4 py-3 text-neutral-300">{m.provider}</td>
                <td className="px-4 py-3">
                  <StubBadge tone={capabilityTone(m.capabilityRank)}>
                    rank {m.capabilityRank}
                  </StubBadge>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  ${m.costPerMillionUsd.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {m.p50LatencyMs} ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.data?.lockedUseCases && query.data.lockedUseCases.length > 0 ? (
        <p className="text-xs text-neutral-500">
          Locked / sovereign use-cases (pinned to their policy floor, not
          reassignable):{' '}
          <span className="font-mono text-neutral-400">
            {query.data.lockedUseCases.join(', ')}
          </span>
        </p>
      ) : null}
    </div>
  );
}
