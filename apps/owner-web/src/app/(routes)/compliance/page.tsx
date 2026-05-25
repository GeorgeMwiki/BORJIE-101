import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { COMPLIANCE_MOCK } from '@/lib/mocks/commercial';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red'> = {
  'on-track': 'green',
  'at-risk': 'amber',
  overdue: 'red',
};

/**
 * O-W-14 — Compliance centre. Polished stub: regulator citation
 * library and action checklist with status. Working action is "Mark
 * done" per action.
 */
export default function CompliancePage() {
  return (
    <>
      <ScreenHeader slug="compliance" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <SectionCard title="Citation library">
          <ul className="space-y-2 text-sm">
            {COMPLIANCE_MOCK.citations.map((c) => (
              <li key={c.ref} className="rounded-md border border-border bg-background px-3 py-2">
                <div className="font-mono text-xs text-warning">{c.ref}</div>
                <div className="mt-0.5 text-foreground">{c.label}</div>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Action checklist">
          <ul className="space-y-2 text-sm">
            {COMPLIANCE_MOCK.actions.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-foreground">{a.title}</div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {a.dueDays >= 0 ? `due in ${a.dueDays}d` : `overdue by ${Math.abs(a.dueDays)}d`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={STATUS_TONE[a.status] ?? 'amber'} label={a.status} />
                  <button
                    type="button"
                    className="rounded-md border border-warning bg-warning-subtle/30 px-2 py-0.5 text-xs text-warning hover:bg-warning-subtle/50"
                  >
                    Mark done
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
