import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { TaskAgentsRegistry } from '@/components/internal/wave9/TaskAgentsRegistry';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('task-agents')!;

/**
 * I-W-24 — Task-agents registry.
 *
 * Uniform registry of narrow-scope task agents. Live path:
 * /api/platform/task-agents (BFF proxy) → gateway /api/v1/task-agents. The
 * gateway validates each manual run against the agent's own schema and runs
 * the executor; this surface lists the registry and triggers runs.
 */
export default async function TaskAgentsPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="info">guardrailed · audited</StubBadge>}
    >
      <TaskAgentsRegistry initialLocale={locale} />
    </ScreenShell>
  );
}
