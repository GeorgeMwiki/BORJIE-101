import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { PersonaRegistry } from '@/components/internal/wave9/PersonaRegistry';

const SCREEN = findScreen('persona-registry')!;

/**
 * I-W-25 — Persona registry (SUPER_ADMIN / ADMIN).
 *
 * Every brain persona (platform + tenant). Live path:
 * /api/platform/persona-registry (BFF proxy) → gateway
 * /api/v1/persona-registry. The gateway gates every route on
 * SUPER_ADMIN / ADMIN and hot-swaps personas across the cross-portal bus;
 * this surface lists, refreshes, and removes personas.
 */
export default function PersonaRegistryPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="danger">SUPER_ADMIN · audited</StubBadge>}
    >
      <PersonaRegistry />
    </ScreenShell>
  );
}
