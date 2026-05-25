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
  return (
    <article className="cockpit-card">
      <div className="cockpit-card-title">FX & gold window</div>
      <div className="cockpit-card-value">
        ${goldSpotUsdOz.toLocaleString()}
        <span className="ml-1 text-base text-neutral-400">/oz</span>
      </div>
      <div className="cockpit-card-meta">
        TZS/USD {tzsUsd.toLocaleString()}
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
