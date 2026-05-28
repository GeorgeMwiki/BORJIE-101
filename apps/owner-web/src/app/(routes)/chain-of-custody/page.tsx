import { PageHero } from '@/components/shared/PageHero';
import { ChainOfCustodyShell } from '@/components/chain-of-custody/ChainOfCustodyShell';

/**
 * O-W-25 — Chain of custody.
 *
 * Per-parcel chain visualizer (pit-stockpile through transport, assay,
 * processing, refining, export, sale). Hash-chain badge proves the
 * append-only invariant. Live data path:
 *   GET /api/v1/ops/chain-of-custody?parcelId=...
 */
export default function ChainOfCustodyPage() {
  return (
    <>
      <PageHero slug="chain-of-custody" />
      <div className="mt-8">
        <ChainOfCustodyShell />
      </div>
    </>
  );
}
