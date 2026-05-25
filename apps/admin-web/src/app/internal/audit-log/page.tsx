import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { AuditLogViewer } from '@/components/internal/audit-log/AuditLogViewer';

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
      <AuditLogViewer />
    </ScreenShell>
  );
}
