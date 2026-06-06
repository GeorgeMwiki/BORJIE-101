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
    <ScreenShell screen={SCREEN} stub>
      <div className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium text-foreground mb-1">Mint regulator audit-pack</h3>
        <p className="text-xs text-neutral-500 mb-4">
          Pending gateway wiring — minting needs POST
          /mining/internal/audit-pack/mint. The issuer form re-enables once
          that route lands.
        </p>
        <button
          type="button"
          disabled
          title="Pending gateway wiring — needs POST /mining/internal/audit-pack/mint"
          className="cursor-not-allowed rounded-md border border-border bg-surface-sunken px-4 py-2 text-sm font-medium text-neutral-500 opacity-60"
        >
          Mint signed URL
        </button>
      </div>

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
