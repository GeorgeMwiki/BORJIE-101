import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('marketplace')!;

interface Listing {
  readonly id: string;
  readonly title: string;
  readonly seller: string;
  readonly rating: number;
  readonly disputes: number;
  readonly status: 'Live' | 'Flagged' | 'Hidden';
}

const LISTINGS: ReadonlyArray<Listing> = [
  { id: 'l_18kg_dore', title: '18kg gold dore parcel — Geita', seller: 'Geita Dhahabu Mines', rating: 4.8, disputes: 0, status: 'Live' },
  { id: 'l_coltan_24t', title: '2.4t coltan concentrate — Mbeya', seller: 'Kiwira Coltan Cooperative', rating: 4.5, disputes: 1, status: 'Flagged' },
  { id: 'l_copper_22t', title: '22t copper concentrate — Kahama', seller: 'Kahama Shaba Holdings', rating: 4.9, disputes: 0, status: 'Live' },
  { id: 'l_tanzanite_b', title: 'Tanzanite rough Grade-B lot', seller: 'Mererani Tanzanite Cluster', rating: 3.6, disputes: 3, status: 'Hidden' },
];

function tone(status: Listing['status']) {
  if (status === 'Live') return 'success' as const;
  if (status === 'Flagged') return 'warn' as const;
  return 'danger' as const;
}

export default function MarketplacePage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Listing</th>
              <th className="px-4 py-3 font-medium">Seller</th>
              <th className="px-4 py-3 font-medium text-right">Rating</th>
              <th className="px-4 py-3 font-medium text-right">Disputes</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {LISTINGS.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{row.title}</td>
                <td className="px-4 py-3 text-neutral-300">{row.seller}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {row.rating.toFixed(1)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {row.disputes}
                </td>
                <td className="px-4 py-3">
                  <StubBadge tone={tone(row.status)}>{row.status}</StubBadge>
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="text-xs text-signal-500 hover:underline">
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScreenShell>
  );
}
