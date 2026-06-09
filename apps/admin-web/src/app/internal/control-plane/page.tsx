import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { ControlPlane } from '@/components/internal/control-plane/ControlPlane';

const SCREEN = findScreen('control-plane')!;

/**
 * I-W-21 — Brain control plane (Borjie-internal, SUPER_ADMIN / ADMIN gated).
 *
 * Four admin-set, platform-config knobs (NO tenant business data):
 *   1. POWERS         capability / kill-switch flags, global + per-tenant
 *   2. LLM ROUTING    core + ordered fallbacks + ensemble + per-use-case
 *   3. MODEL CATALOG  read-only cost / capability / latency
 *   4. AI-SUGGEST     suggest-only recommender (review-then-apply, never auto)
 *
 * Live path: /api/platform/control-plane/* (BFF proxy) → gateway
 * /api/v1/admin/control-plane/*. The gateway enforces auth, rejects sovereign
 * rails, drops locked use-cases, and hash-chains every mutation into the audit
 * trail.
 */
export default function ControlPlanePage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="danger">SUPER_ADMIN · audited</StubBadge>}
    >
      <ControlPlane />
    </ScreenShell>
  );
}
