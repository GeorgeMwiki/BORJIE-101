import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('audit-pack')!;

interface Issued {
  readonly id: string;
  readonly tenant: string;
  readonly regulator: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

const ISSUED: ReadonlyArray<Issued> = [
  { id: 'pk_001', tenant: 'Geita Dhahabu Mines', regulator: 'TMAA Q2 audit', issuedAt: '2026-05-22 14:02', expiresAt: '2026-05-29 14:02' },
  { id: 'pk_002', tenant: 'Kahama Shaba Holdings', regulator: 'NEMC site inspection', issuedAt: '2026-05-20 09:11', expiresAt: '2026-05-27 09:11' },
  { id: 'pk_003', tenant: 'Mererani Tanzanite Cluster', regulator: 'BoT FX review', issuedAt: '2026-05-18 16:44', expiresAt: '2026-05-25 16:44' },
];

export default function AuditPackPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <form className="rounded-lg border border-border bg-surface p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="text-sm">
          <span className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Tenant</span>
          <select className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground">
            <option>Geita Dhahabu Mines</option>
            <option>Kahama Shaba Holdings</option>
            <option>Kiwira Coltan Cooperative</option>
            <option>Mererani Tanzanite Cluster</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Regulator</span>
          <select className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground">
            <option>TMAA</option>
            <option>NEMC</option>
            <option>BoT</option>
            <option>Ministry of Minerals</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Expires in</span>
          <select className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground">
            <option>24 hours</option>
            <option>7 days</option>
            <option>30 days</option>
          </select>
        </label>
        <div className="md:col-span-3 flex justify-end">
          <button
            type="button"
            className="rounded-md bg-signal-500 px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-signal-500/90"
          >
            Mint signed URL
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Pack</th>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Purpose</th>
              <th className="px-4 py-3 font-medium">Issued</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {ISSUED.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-neutral-300">{row.id}</td>
                <td className="px-4 py-3 text-foreground">{row.tenant}</td>
                <td className="px-4 py-3 text-neutral-300">{row.regulator}</td>
                <td className="px-4 py-3 text-neutral-300 tabular-nums">{row.issuedAt}</td>
                <td className="px-4 py-3 text-neutral-300 tabular-nums">{row.expiresAt}</td>
                <td className="px-4 py-3 text-right">
                  <StubBadge tone="warn">Revoke</StubBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScreenShell>
  );
}
