import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { GEOLOGY_MOCK } from '@/lib/mocks/operations';
import { fmtNum } from '@/lib/format';

/**
 * O-W-11 — Geology workbench. Polished stub: resource snapshot and
 * assay QA/QC table with pass-rate vs threshold. Working action is
 * "Export geology pack" placeholder.
 */
export default function GeologyPage() {
  return (
    <>
      <ScreenHeader slug="geology" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <SectionCard title="Resource snapshot" className="md:col-span-2">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-neutral-500">Indicated tonnes</dt>
            <dd className="text-foreground">{fmtNum(GEOLOGY_MOCK.resource.indicatedTonnes)}</dd>
            <dt className="text-neutral-500">Indicated grade</dt>
            <dd className="text-foreground">{GEOLOGY_MOCK.resource.indicatedGradeGpt} g/t</dd>
            <dt className="text-neutral-500">Inferred tonnes</dt>
            <dd className="text-foreground">{fmtNum(GEOLOGY_MOCK.resource.inferredTonnes)}</dd>
            <dt className="text-neutral-500">Inferred grade</dt>
            <dd className="text-foreground">{GEOLOGY_MOCK.resource.inferredGradeGpt} g/t</dd>
            <dt className="text-neutral-500">Signed off</dt>
            <dd className="text-foreground">{GEOLOGY_MOCK.resource.lastSignedOff}</dd>
          </dl>
        </SectionCard>
        <SectionCard title="QA / QC pass rates">
          <ul className="space-y-2 text-sm">
            {GEOLOGY_MOCK.qaqc.map((q) => {
              const ok = q.passRate >= q.threshold;
              return (
                <li key={q.type} className="flex items-center justify-between">
                  <span className="text-foreground">{q.type}</span>
                  <span
                    className={`font-mono ${
                      ok ? 'text-success' : 'text-destructive'
                    }`}
                  >
                    {(q.passRate * 100).toFixed(0)}% / {(q.threshold * 100).toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="mt-3 w-full rounded-md border border-warning bg-warning-subtle/30 py-1.5 text-sm text-warning hover:bg-warning-subtle/50"
          >
            Export geology pack
          </button>
        </SectionCard>
      </div>
    </>
  );
}
