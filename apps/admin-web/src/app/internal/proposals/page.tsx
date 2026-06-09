import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { ProposalsQueue } from '@/components/internal/wave9/ProposalsQueue';

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
export default function ProposalsPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="warn">four-eye · audited</StubBadge>}
    >
      <ProposalsQueue />
    </ScreenShell>
  );
}
