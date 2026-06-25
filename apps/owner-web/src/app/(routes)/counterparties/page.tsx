import { PageHero } from '@/components/shared/PageHero';
import { CounterpartiesShell } from '@/components/counterparties/CounterpartiesShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

/**
 * O-W-24 — Counterparties.
 *
 * Lists every external party the operation touches (upstream, downstream,
 * adjacent). Click a row to open a drawer showing the full engagement
 * timeline and any linked chain-of-custody steps. Live data path:
 *   GET /api/v1/ops/external-parties
 *   GET /api/v1/ops/engagements?partyId=...
 *
 * Resolves the locale ONCE on the server and seeds the client shell so the
 * metric-tile labels + filters paint in the active language on the first
 * frame (no EN-under-SW split-brain).
 */
export default async function CounterpartiesPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return (
    <>
      <PageHero slug="counterparties" />
      <div className="mt-8">
        <CounterpartiesShell initialLocale={initialLocale} />
      </div>
    </>
  );
}
