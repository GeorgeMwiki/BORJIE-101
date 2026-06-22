import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { WorkflowEngine } from '@/components/internal/wave9/WorkflowEngine';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('workflow-engine')!;

/**
 * I-W-26 — Workflow engine & flow autonomy (read-first).
 *
 * Live path: /api/platform/workflow/* (BFF proxy) → gateway
 * /api/v1/workflow/runs/my-queue + /api/v1/workflow/flow-autonomy[/pending].
 * Listing only — starting / approving runs and flipping a flow posture are
 * state-changing and ride the durable-saga wave; the inviolable rails still
 * gate every action regardless of posture.
 */
export default async function WorkflowEnginePage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="info">read-first · four-eyes engine</StubBadge>}
    >
      <WorkflowEngine initialLocale={locale} />
    </ScreenShell>
  );
}
