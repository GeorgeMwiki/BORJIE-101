import { PageHero } from '@/components/shared/PageHero';
import { ChainOfCustodyShell } from '@/components/chain-of-custody/ChainOfCustodyShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

/**
 * O-W-25 — Chain of custody.
 *
 * Per-parcel chain visualizer (pit-stockpile through transport, assay,
 * processing, refining, export, sale). Hash-chain badge proves the
 * append-only invariant. Live data path:
 *   GET /api/v1/ops/chain-of-custody?parcelId=...
 *
 * Resolves the locale ONCE on the server and seeds the client shell so the
 * search placeholder + empty-state paint in the active language on the
 * first frame (no EN-under-SW split-brain).
 */
export default async function ChainOfCustodyPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return (
    <>
      <PageHero slug="chain-of-custody" />
      <div className="mt-8">
        <ChainOfCustodyShell initialLocale={initialLocale} />
      </div>
    </>
  );
}
