import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_CITATIONS } from '@/lib/internal/mock-data';

const SCREEN = findScreen('citations')!;

export default function CitationsPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="info">Gazette ingest: hourly</StubBadge>}
    >
      <div className="rounded-lg border border-border bg-surface p-4">
        <input
          type="search"
          placeholder="Search by statute, section, or keyword..."
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-neutral-500"
          aria-label="Search citations"
        />
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Statute</th>
              <th className="px-4 py-3 font-medium">Section</th>
              <th className="px-4 py-3 font-medium">Published</th>
              <th className="px-4 py-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_CITATIONS.map((citation) => (
              <tr key={citation.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{citation.statute}</td>
                <td className="px-4 py-3 text-neutral-300">{citation.section}</td>
                <td className="px-4 py-3 text-neutral-300 tabular-nums">{citation.publishedOn}</td>
                <td className="px-4 py-3">
                  <StubBadge tone="neutral">{citation.source}</StubBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScreenShell>
  );
}
