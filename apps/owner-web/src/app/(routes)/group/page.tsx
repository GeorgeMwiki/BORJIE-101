import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { GROUP_MOCK } from '@/lib/mocks/commercial';
import { fmtTzsM, fmtNum } from '@/lib/format';

/**
 * O-W-19 — Multi-company group view. Polished stub: rollup cards for
 * each tenant in the group. Working action is per-tenant "Open
 * cockpit" link (placeholder).
 */
export default function GroupPage() {
  return (
    <>
      <ScreenHeader slug="group" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        {GROUP_MOCK.tenants.map((t) => (
          <SectionCard
            key={t.id}
            title={t.name}
            subtitle="Cross-tenant rollup"
            actions={
              <button
                type="button"
                className="rounded-md border border-warning bg-warning-subtle/30 px-2 py-0.5 text-xs text-warning hover:bg-warning-subtle/50"
              >
                Open cockpit
              </button>
            }
          >
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-neutral-500">Cash</dt>
              <dd className="text-foreground">{fmtTzsM(t.cashTzsM)}</dd>
              <dt className="text-neutral-500">Production MTD</dt>
              <dd className="text-foreground">{fmtNum(t.productionGTopMtd)} g</dd>
              <dt className="text-neutral-500">Compliance</dt>
              <dd className="text-foreground">
                <span className="pill pill-green">{t.complianceGreen}</span>{' '}
                <span className="pill pill-amber">{t.complianceAmber}</span>{' '}
                <span className="pill pill-red">{t.complianceRed}</span>
              </dd>
            </dl>
          </SectionCard>
        ))}
      </div>
    </>
  );
}
