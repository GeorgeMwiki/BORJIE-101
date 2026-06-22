import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { ProposalsQueue } from '@/components/internal/wave9/ProposalsQueue';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('proposals')!;

/**
 * I-W-22 — Proposals approval queue.
 *
 * Human-in-the-loop queue over `module_update_proposals`. Live path:
 * /api/platform/proposals (BFF proxy) → gateway /api/v1/proposals. The
 * gateway enforces tenant isolation + four-eye / approver-tier on
 * approve/decline; this surface only lists pending_hitl rows and posts the
 * decision.
 */
export default async function ProposalsPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="warn">four-eye · audited</StubBadge>}
    >
      <ProposalsQueue initialLocale={locale} />
    </ScreenShell>
  );
}
