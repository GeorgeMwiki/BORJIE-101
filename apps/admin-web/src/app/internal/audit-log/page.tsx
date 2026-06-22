import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { AuditLogViewer } from '@/components/internal/audit-log/AuditLogViewer';

const SCREEN = findScreen('audit-log')!;

export default function AuditLogPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      // NDJSON export intentionally NOT rendered: the gateway export
      // endpoint (GET /internal/audit-log/export) has not shipped yet. A
      // permanently-disabled control reads as a real-but-broken affordance
      // (honesty / zero-mock violation) — re-add it only when the route lands.
      actions={<StubBadge tone="info">Append-only</StubBadge>}
    >
      <AuditLogViewer />
    </ScreenShell>
  );
}
