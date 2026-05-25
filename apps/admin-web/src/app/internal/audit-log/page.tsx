import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_AUDIT_EVENTS } from '@/lib/internal/mock-data';

const SCREEN = findScreen('audit-log')!;

export default function AuditLogPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <>
          <StubBadge tone="info">Append-only</StubBadge>
          <button type="button" className="text-xs text-signal-500 hover:underline">
            Export NDJSON
          </button>
        </>
      }
    >
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex gap-3">
          <select
            className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
            aria-label="Filter by tenant"
            defaultValue=""
          >
            <option value="">All tenants</option>
            <option>Geita Dhahabu Mines</option>
            <option>Kahama Shaba Holdings</option>
            <option>Mererani Tanzanite Cluster</option>
          </select>
          <input
            type="search"
            placeholder="Search actor or action..."
            className="flex-1 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-neutral-500"
            aria-label="Search audit log"
          />
        </div>
      </div>

      <div
        className="rounded-lg border border-border bg-surface"
        role="list"
        aria-label="Audit events (virtualised list stub)"
      >
        {MOCK_AUDIT_EVENTS.map((evt) => (
          <div
            key={evt.id}
            role="listitem"
            className="px-4 py-3 border-b border-border last:border-0 font-mono text-xs flex items-center gap-3"
          >
            <span className="text-neutral-500 tabular-nums shrink-0">{evt.at}</span>
            <span className="text-neutral-300 shrink-0 w-48 truncate">{evt.tenant}</span>
            <span className="text-signal-500 shrink-0 w-24 truncate">{evt.actor}</span>
            <span className="text-foreground truncate">{evt.action}</span>
          </div>
        ))}
        <p className="px-4 py-3 text-xs text-neutral-500 italic">
          ... virtual scroller would mount thousands more rows here ...
        </p>
      </div>
    </ScreenShell>
  );
}
