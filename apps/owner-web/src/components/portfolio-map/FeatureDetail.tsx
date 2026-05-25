'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import type { MapFeature } from '@/lib/mocks/portfolio-map';

interface FeatureDetailProps {
  readonly feature: MapFeature | null;
  readonly onClose: () => void;
}

export function FeatureDetail({ feature, onClose }: FeatureDetailProps) {
  if (!feature) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface/30 px-3 py-4 text-xs text-neutral-400">
        Click a feature to drill in.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">
            {feature.kind}
          </div>
          <div className="mt-0.5 font-medium text-foreground">{feature.name}</div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-md p-1 text-neutral-400 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        {Object.entries(feature.properties).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="text-foreground">{String(v)}</dd>
          </div>
        ))}
      </dl>
      {feature.kind === 'site' ? (
        <Link
          href="/site-cockpit"
          className="mt-3 inline-flex w-full justify-center rounded-md border border-warning bg-warning-subtle/30 px-3 py-1.5 text-xs text-warning"
        >
          Open site cockpit
        </Link>
      ) : null}
    </div>
  );
}
