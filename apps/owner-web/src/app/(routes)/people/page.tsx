import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { PEOPLE_MOCK } from '@/lib/mocks/operations';
import { fmtTzs } from '@/lib/format';

/**
 * O-W-08 — People & roles. Polished stub: real org list, advances
 * ledger and productivity-by-phase table over the mock dataset; the
 * working action is the per-person link to settle an advance.
 */
export default function PeoplePage() {
  return (
    <>
      <ScreenHeader slug="people" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <SectionCard title="Org chart">
          <ul className="space-y-1 text-sm">
            {PEOPLE_MOCK.orgChart.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <span className="text-foreground">{p.name}</span>
                <span className="text-xs text-neutral-500">{p.role}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Advances ledger">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 text-left">Person</th>
                <th className="py-1 text-right">Advances</th>
                <th className="py-1 text-right">Age</th>
              </tr>
            </thead>
            <tbody>
              {PEOPLE_MOCK.advances.map((a) => (
                <tr key={a.person} className="border-t border-border">
                  <td className="py-1.5 text-foreground">{a.person}</td>
                  <td className="py-1.5 text-right font-mono text-foreground">
                    {fmtTzs(a.advancesTzs)}
                  </td>
                  <td className="py-1.5 text-right text-neutral-400">{a.agedDays}d</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="mt-3 w-full rounded-md border border-warning bg-warning-subtle/30 py-1.5 text-sm text-warning hover:bg-warning-subtle/50"
          >
            Settle advances
          </button>
        </SectionCard>
        <SectionCard title="Productivity by phase">
          <table className="w-full text-sm">
            <tbody>
              {PEOPLE_MOCK.productivity.map((p) => (
                <tr key={p.phase} className="border-t border-border first:border-t-0">
                  <td className="py-1.5 text-neutral-300">{p.phase}</td>
                  <td className="py-1.5 text-right font-mono text-foreground">
                    {p.tphPerCrew} t/h
                  </td>
                  <td className="py-1.5 text-right text-xs text-neutral-500">
                    target {p.target}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </div>
    </>
  );
}
