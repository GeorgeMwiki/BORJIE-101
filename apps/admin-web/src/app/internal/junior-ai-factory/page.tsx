import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { JuniorAiFactory } from '@/components/internal/wave9/JuniorAiFactory';

const SCREEN = findScreen('junior-ai-factory')!;

/**
 * I-W-23 — Junior-AI factory.
 *
 * Provisioned tenant-scoped junior AIs. Live path:
 * /api/platform/junior-ai (BFF proxy) → gateway /api/v1/junior-ai. The
 * gateway enforces the team-lead role gate + lifecycle rules; this surface
 * lists the caller's juniors and suspends / revokes them.
 */
export default function JuniorAiFactoryPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="info">team-lead · audited</StubBadge>}
    >
      <JuniorAiFactory />
    </ScreenShell>
  );
}
