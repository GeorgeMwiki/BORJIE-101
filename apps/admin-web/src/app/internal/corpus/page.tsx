import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('corpus')!;

interface CorpusEntry {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly status: 'Indexed' | 'Re-ingesting' | 'Superseded';
}

const ENTRIES: ReadonlyArray<CorpusEntry> = [
  { id: 'doc_geo_dossier', title: 'TZ Greenstone Belt — gold occurrence dossier', version: 'v4.2', status: 'Indexed' },
  { id: 'doc_coltan_2025', title: 'Mbeya coltan market brief Q2/2025', version: 'v1.0', status: 'Indexed' },
  { id: 'doc_tz_mining_act', title: 'Mining Act 2010 — consolidated', version: 'v7.1', status: 'Re-ingesting' },
  { id: 'doc_copper_assays', title: 'Kahama copper assay reference set', version: 'v2.0', status: 'Superseded' },
];

function tone(status: CorpusEntry['status']) {
  if (status === 'Indexed') return 'success' as const;
  if (status === 'Re-ingesting') return 'info' as const;
  return 'neutral' as const;
}

export default function CorpusPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <button
          type="button"
          className="rounded-md bg-signal-500 px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-signal-500/90"
        >
          Upload dossier
        </button>
      }
    >
      <div className="rounded-lg border border-dashed border-border bg-surface-sunken p-8 text-center">
        <p className="text-sm text-neutral-400">
          Drop research, minerals dossiers, or regulatory PDFs here.
          Re-ingest pipeline will version-bump and supersede stale entries.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {ENTRIES.map((entry) => (
          <div key={entry.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">{entry.title}</p>
              <p className="text-xs text-neutral-500">
                {entry.id} · version {entry.version}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StubBadge tone={tone(entry.status)}>{entry.status}</StubBadge>
              <button type="button" className="text-xs text-signal-500 hover:underline">
                Supersede
              </button>
            </div>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}
