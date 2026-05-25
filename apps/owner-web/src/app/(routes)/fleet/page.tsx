import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { FLEET_MOCK } from '@/lib/mocks/operations';

/**
 * O-W-09 — Assets & fleet. Polished stub: match-factor read,
 * predictive-maintenance health scores per unit. Working action is
 * "Schedule service" against the lowest health unit.
 */
export default function FleetPage() {
  return (
    <>
      <ScreenHeader slug="fleet" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <SectionCard title="Match factor">
          <div className="text-5xl font-display text-foreground">
            {FLEET_MOCK.matchFactor.toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            target {FLEET_MOCK.matchFactorTarget.toFixed(2)} (1.0 = loader/hauler balanced)
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-warning"
              style={{ width: `${FLEET_MOCK.matchFactor * 100}%` }}
            />
          </div>
        </SectionCard>
        <SectionCard title="Predictive maintenance" className="md:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 text-left">Unit</th>
                <th className="py-1 text-right">Hours</th>
                <th className="py-1 text-right">Health</th>
                <th className="py-1 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {FLEET_MOCK.units.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="py-1.5 text-foreground">{u.label}</td>
                  <td className="py-1.5 text-right font-mono text-neutral-300">
                    {u.hours.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right text-foreground">{u.healthScore}</td>
                  <td className="py-1.5 text-right">
                    <StatusPill
                      tone={
                        u.status === 'ok' ? 'green' : u.status === 'watch' ? 'amber' : 'red'
                      }
                      label={u.status}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="mt-3 rounded-md border border-warning bg-warning-subtle/30 px-3 py-1.5 text-sm text-warning hover:bg-warning-subtle/50"
          >
            Schedule service for HL-2
          </button>
        </SectionCard>
      </div>
    </>
  );
}
