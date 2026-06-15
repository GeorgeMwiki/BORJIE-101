interface FxGoldCardProps {
  readonly goldSpotUsdOz: number;
  readonly tzsUsd: number;
  readonly sellWindowOpen: boolean;
  readonly daysToCliff27Mar: number;
}

export function FxGoldCard({
  goldSpotUsdOz,
  tzsUsd,
  sellWindowOpen,
  daysToCliff27Mar,
}: FxGoldCardProps) {
  // The cockpit endpoint does not source FX/gold; it returns 0 until the
  // dedicated fx feed is wired into this slot. Render an honest "feed not
  // wired" placeholder rather than a fabricated $0 /oz or TZS/USD 0.
  const hasGold = goldSpotUsdOz > 0;
  const hasTzsUsd = tzsUsd > 0;
  return (
    <article className="cockpit-card">
      <div className="cockpit-card-title">FX & gold window</div>
      <div className="cockpit-card-value">
        {hasGold ? (
          <>
            ${goldSpotUsdOz.toLocaleString()}
            <span className="ml-1 text-base text-neutral-400">/oz</span>
          </>
        ) : (
          <span className="text-neutral-400">
            —<span className="ml-1 text-base">/oz</span>
          </span>
        )}
      </div>
      <div className="cockpit-card-meta">
        {hasTzsUsd ? `TZS/USD ${tzsUsd.toLocaleString()}` : 'TZS/USD —'}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`pill ${sellWindowOpen ? 'pill-green' : 'pill-amber'}`}>
          sell window {sellWindowOpen ? 'open' : 'closed'}
        </span>
        <span
          className={`pill ${daysToCliff27Mar <= 30 ? 'pill-red' : 'pill-amber'}`}
        >
          27 Mar cliff in {daysToCliff27Mar}d
        </span>
      </div>
    </article>
  );
}
