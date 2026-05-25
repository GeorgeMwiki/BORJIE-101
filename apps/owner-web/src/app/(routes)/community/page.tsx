import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { COMMUNITY_MOCK } from '@/lib/mocks/commercial';
import { fmtTzs } from '@/lib/format';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red'> = {
  delivered: 'green',
  'in-progress': 'amber',
  pending: 'red',
};

/**
 * O-W-16 — Community & CSR. Polished stub: commitments tracker +
 * grievances list. Working action is "Update progress" per pending
 * commitment.
 */
export default function CommunityPage() {
  return (
    <>
      <ScreenHeader slug="community" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <SectionCard title="CSR commitments">
          <ul className="space-y-2 text-sm">
            {COMMUNITY_MOCK.commitments.map((c) => {
              const pledged = Number(c.pledgedTzs);
              const pct = pledged === 0 ? 0 : (c.deliveredTzs / pledged) * 100;
              return (
                <li key={c.project} className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground">{c.project}</span>
                    <StatusPill tone={STATUS_TONE[c.status] ?? 'amber'} label={c.status} />
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full bg-warning"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {fmtTzs(c.deliveredTzs)} / {fmtTzs(c.pledgedTzs)}
                  </div>
                  {c.status !== 'delivered' ? (
                    <button
                      type="button"
                      className="mt-2 rounded-md border border-warning bg-warning-subtle/30 px-2 py-0.5 text-xs text-warning hover:bg-warning-subtle/50"
                    >
                      Update progress
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </SectionCard>
        <SectionCard title="Grievances">
          <ul className="space-y-2 text-sm">
            {COMMUNITY_MOCK.grievances.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-foreground">{g.topic}</div>
                  <div className="text-xs text-neutral-500">{g.ward}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill
                    tone={g.status === 'resolved' ? 'green' : 'amber'}
                    label={g.status}
                  />
                  {g.status !== 'resolved' ? (
                    <span className="text-xs text-neutral-500">{g.daysOpen}d</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
