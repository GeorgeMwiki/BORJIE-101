import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_JUNIORS, MOCK_TENANTS } from '@/lib/internal/mock-data';

const SCREEN = findScreen('killswitch')!;

type SwitchState = 'OK' | 'DEGRADED' | 'HALT';

const TENANT_GLOBAL_STATE: SwitchState = 'OK';

const JUNIOR_STATES: ReadonlyArray<{
  readonly juniorId: string;
  readonly state: SwitchState;
}> = [
  { juniorId: 'jr_master', state: 'OK' },
  { juniorId: 'jr_geology', state: 'OK' },
  { juniorId: 'jr_compliance', state: 'OK' },
  { juniorId: 'jr_cost', state: 'OK' },
  { juniorId: 'jr_sales', state: 'DEGRADED' },
  { juniorId: 'jr_fx', state: 'OK' },
  { juniorId: 'jr_hr', state: 'OK' },
  { juniorId: 'jr_report', state: 'HALT' },
];

function tone(state: SwitchState) {
  if (state === 'OK') return 'success' as const;
  if (state === 'DEGRADED') return 'warn' as const;
  return 'danger' as const;
}

export default function KillswitchPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <StubBadge tone="danger">Mutations require two-operator confirm</StubBadge>
      }
    >
      <section className="rounded-lg border border-danger/40 bg-danger/5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-foreground">Global platform state</h3>
            <p className="text-xs text-neutral-400">
              Hits every junior on every tenant. Use only in true emergencies.
            </p>
          </div>
          <StubBadge tone={tone(TENANT_GLOBAL_STATE)}>{TENANT_GLOBAL_STATE}</StubBadge>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            className="rounded-md bg-warning/20 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/30"
          >
            Set DEGRADED
          </button>
          <button
            type="button"
            className="rounded-md bg-danger/20 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/30"
          >
            Set HALT
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">Per-junior state (platform-wide)</h3>
        <ul className="space-y-2">
          {JUNIOR_STATES.map((row) => {
            const junior = MOCK_JUNIORS.find((j) => j.id === row.juniorId);
            if (!junior) return null;
            return (
              <li
                key={row.juniorId}
                className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-4 py-3"
              >
                <div>
                  <p className="text-sm text-foreground">{junior.name}</p>
                  <p className="text-xs text-neutral-500">{junior.role}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StubBadge tone={tone(row.state)}>{row.state}</StubBadge>
                  <select
                    defaultValue={row.state}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    aria-label={`State for ${junior.name}`}
                  >
                    <option value="OK">OK</option>
                    <option value="DEGRADED">DEGRADED</option>
                    <option value="HALT">HALT</option>
                  </select>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium text-foreground mb-3">Per-tenant overrides</h3>
        <p className="text-xs text-neutral-500 mb-3">
          Optional scoping when a single tenant misbehaves. Empty by default.
        </p>
        <ul className="text-xs text-neutral-400 space-y-1 font-mono">
          {MOCK_TENANTS.slice(0, 3).map((t) => (
            <li key={t.id}>{t.id} — no overrides</li>
          ))}
        </ul>
      </section>
    </ScreenShell>
  );
}
