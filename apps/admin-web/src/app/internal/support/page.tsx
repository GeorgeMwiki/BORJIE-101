import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_TICKETS } from '@/lib/internal/mock-data';
import { TicketAck } from '@/components/internal/support/TicketAck';

const SCREEN = findScreen('support')!;

function slaTone(hoursLeft: number) {
  if (hoursLeft < 0) return 'danger' as const;
  if (hoursLeft < 8) return 'warn' as const;
  return 'success' as const;
}

function slaLabel(hoursLeft: number): string {
  if (hoursLeft < 0) return `Breached ${Math.abs(hoursLeft)}h`;
  return `${hoursLeft}h left`;
}

export default function SupportPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="platform-card">
          <p className="platform-card-title">Open tickets</p>
          <p className="platform-card-value">{MOCK_TICKETS.length}</p>
        </div>
        <div className="platform-card">
          <p className="platform-card-title">CSAT (30d)</p>
          <p className="platform-card-value">4.3 / 5</p>
        </div>
        <div className="platform-card">
          <p className="platform-card-title">SLA breaches (30d)</p>
          <p className="platform-card-value">2</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Ticket</th>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">SLA</th>
              <th className="px-4 py-3 font-medium text-right">CSAT</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {MOCK_TICKETS.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-neutral-300">{row.id}</td>
                <td className="px-4 py-3 text-foreground">{row.tenant}</td>
                <td className="px-4 py-3 text-neutral-300">{row.subject}</td>
                <td className="px-4 py-3">
                  <StubBadge tone={slaTone(row.slaHoursLeft)}>{slaLabel(row.slaHoursLeft)}</StubBadge>
                </td>
                <td className="px-4 py-3 text-right text-neutral-300 tabular-nums">
                  {row.csat == null ? '—' : `${row.csat}/5`}
                </td>
                <td className="px-4 py-3 text-right">
                  <TicketAck id={row.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScreenShell>
  );
}
