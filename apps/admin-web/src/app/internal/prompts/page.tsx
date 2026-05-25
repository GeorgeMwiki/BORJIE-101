import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_PROMPTS } from '@/lib/internal/mock-data';

const SCREEN = findScreen('prompts')!;

function tone(status: string) {
  if (status === 'Production') return 'success' as const;
  if (status === 'Canary') return 'info' as const;
  return 'neutral' as const;
}

export default function PromptsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="platform-card">
          <p className="platform-card-title">Promotions (30d)</p>
          <p className="platform-card-value">12</p>
        </div>
        <div className="platform-card">
          <p className="platform-card-title">Avg GEPA gain</p>
          <p className="platform-card-value">+4.2%</p>
        </div>
        <div className="platform-card">
          <p className="platform-card-title">Rollbacks (30d)</p>
          <p className="platform-card-value">1</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Junior</th>
              <th className="px-4 py-3 font-medium">Version</th>
              <th className="px-4 py-3 font-medium text-right">GEPA score</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {MOCK_PROMPTS.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{row.junior}</td>
                <td className="px-4 py-3 text-neutral-300">{row.version}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {row.gepaScore.toFixed(3)}
                </td>
                <td className="px-4 py-3">
                  <StubBadge tone={tone(row.status)}>{row.status}</StubBadge>
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="text-xs text-signal-500 hover:underline">
                    Promote
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
