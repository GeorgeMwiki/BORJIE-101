'use client';

import { useState } from 'react';
import { Card } from '@borjie/design-system';
import { dispatchMicroAction } from '@/lib/queries/chat-actions';

interface RiskItem {
  readonly title: string;
  readonly site: string;
  readonly severity: 'low' | 'medium' | 'high';
}

interface OpenRisksCardProps {
  readonly items: ReadonlyArray<RiskItem>;
}

const SEVERITY_PILL: Record<RiskItem['severity'], string> = {
  low: 'pill-green',
  medium: 'pill-amber',
  high: 'pill-red',
};

function RiskRow({ item }: { readonly item: RiskItem }) {
  const [busy, setBusy] = useState(false);

  async function handleTap() {
    if (busy) return;
    setBusy(true);
    try {
      await dispatchMicroAction({
        verb: 'risk.investigate',
        params: { title: item.title, site: item.site, severity: item.severity },
        rationale: `Owner tapped risk item: ${item.title} at ${item.site}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void handleTap()}
        disabled={busy}
        className="flex w-full items-start gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-surface/60 disabled:opacity-60"
        data-testid={`open-risk-item-${item.site}-${item.severity}`}
        aria-label={`Investigate risk: ${item.title} at ${item.site}`}
      >
        <span className={`pill ${SEVERITY_PILL[item.severity]} mt-0.5 shrink-0`}>
          {item.severity}
        </span>
        <div className="flex-1">
          <div className="text-sm text-foreground">{item.title}</div>
          <div className="text-xs text-neutral-500">{item.site}</div>
        </div>
        {busy ? (
          <span className="shrink-0 text-xs text-neutral-400">…</span>
        ) : (
          <span
            className="shrink-0 text-xs text-neutral-500 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          >
            →
          </span>
        )}
      </button>
    </li>
  );
}

export function OpenRisksCard({ items }: OpenRisksCardProps) {
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">Open risks</div>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-500">No open risks</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <RiskRow key={`${item.site}-${item.severity}-${index}`} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}
