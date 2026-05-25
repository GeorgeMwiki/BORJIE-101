import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { MARKETPLACE_MOCK } from '@/lib/mocks/commercial';
import { fmtUsd } from '@/lib/format';

/**
 * O-W-20 — Marketplace & external partners. Polished stub: outbound
 * listings + inbound services. Working action is "Counter" per
 * outbound listing in counter status.
 */
export default function MarketplacePage() {
  return (
    <>
      <ScreenHeader slug="marketplace" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <SectionCard title="Outbound (sell)">
          <ul className="space-y-2 text-sm">
            {MARKETPLACE_MOCK.outbound.map((o) => (
              <li
                key={o.listing}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
              >
                <div>
                  <div className="text-foreground">{o.listing}</div>
                  <div className="text-xs text-neutral-500">{fmtUsd(o.priceUsd)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`pill ${o.status === 'open' ? 'pill-green' : 'pill-amber'}`}
                  >
                    {o.status}
                  </span>
                  {o.status === 'counter' ? (
                    <button
                      type="button"
                      className="rounded-md border border-warning bg-warning-subtle/30 px-2 py-0.5 text-xs text-warning hover:bg-warning-subtle/50"
                    >
                      Counter
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Inbound (buy)">
          <ul className="space-y-2 text-sm">
            {MARKETPLACE_MOCK.inbound.map((i) => (
              <li
                key={i.partner}
                className="rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-foreground">{i.partner}</span>
                  <span className="text-xs text-neutral-400">★ {i.rating}</span>
                </div>
                <div className="text-xs text-neutral-500">{i.service}</div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
