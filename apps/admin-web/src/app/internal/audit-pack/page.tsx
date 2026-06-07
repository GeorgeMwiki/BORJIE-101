import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { MintPackForm } from '@/components/internal/audit-pack/MintPackForm';
import { AuditPackList } from '@/components/internal/audit-pack/AuditPackList';

const SCREEN = findScreen('audit-pack')!;

/**
 * Regulator audit-pack issuer. Live data path:
 *   GET  /api/v1/mining/internal/audit-pack       — issued packs.
 *   POST /api/v1/mining/internal/audit-pack/mint  — record a pending pack.
 * Backed by the real `audit_packs` table (migration 0300). A pending pack
 * carries NO signed URL — the gateway never fabricates one.
 */
export default function AuditPackPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <MintPackForm />
      <AuditPackList />
    </ScreenShell>
  );
}
