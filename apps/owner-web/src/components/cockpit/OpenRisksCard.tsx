'use client';

import { useState } from 'react';
import { Card } from '@borjie/design-system';
import { dispatchMicroAction } from '@/lib/queries/chat-actions';
import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface RiskItem {
  readonly title: string;
  readonly site: string;
  readonly severity: 'low' | 'medium' | 'high';
}

interface OpenRisksCardProps {
  readonly items: ReadonlyArray<RiskItem>;
}

const SEVERITY_TONE: Record<RiskItem['severity'], 'green' | 'amber' | 'red'> = {
  low: 'green',
  medium: 'amber',
  high: 'red',
};

function RiskRow({ item }: { readonly item: RiskItem }) {
  const locale = useLocale();
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
        className="flex w-full items-start gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-surface/60 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        data-testid={`open-risk-item-${item.site}-${item.severity}`}
        aria-label={pickByLocale(
          locale,
          S.risks.investigate(item.title, item.site),
        )}
      >
        <span className="mt-0.5 shrink-0">
          <StatusPill
            tone={SEVERITY_TONE[item.severity]}
            label={pickByLocale(locale, S.risks.sev[item.severity])}
          />
        </span>
        <div className="flex-1">
          <div className="text-sm text-foreground">{item.title}</div>
          <div className="text-xs text-muted-foreground">{item.site}</div>
        </div>
        {busy ? (
          <span className="shrink-0 text-xs text-muted-foreground">…</span>
        ) : (
          <span
            className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
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
  const locale = useLocale();
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.risks.title)}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.risks.none)}
        </p>
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
