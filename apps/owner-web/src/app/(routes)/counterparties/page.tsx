import { PageHero } from '@/components/shared/PageHero';
import { CounterpartiesShell } from '@/components/counterparties/CounterpartiesShell';

/**
 * O-W-24 — Counterparties.
 *
 * Lists every external party the operation touches (upstream, downstream,
 * adjacent). Click a row to open a drawer showing the full engagement
 * timeline and any linked chain-of-custody steps. Live data path:
 *   GET /api/v1/ops/external-parties
 *   GET /api/v1/ops/engagements?partyId=...
 */
export default function CounterpartiesPage() {
  return (
    <>
      <PageHero slug="counterparties" />
      <div className="mt-8">
        <CounterpartiesShell />
      </div>
    </>
  );
}
