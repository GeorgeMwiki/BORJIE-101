import { Suspense } from 'react';
import { ActionApprovePanel } from './approve-panel';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Approve action — Borjie',
};

/**
 * /oauth/actions/approve — four-eye landing for a HIGH-risk MCP tool call.
 *
 * An external agent invoked a sovereign / kill_switch / four_eye /
 * policy_rollout tool over MCP. The dispatcher created a pending approval
 * and handed the agent this URL (`buildPendingApprovalResponse`). The
 * OWNER opens it, reviews the pending action, and Approves or Denies —
 * the distinct human eye the four-eye gate requires. Approval flips the
 * shared approval state so the agent's `actions/execute` becomes
 * reachable; denial locks it.
 */
export default async function OAuthActionApprovePage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <main
      className="relative min-h-screen overflow-hidden bg-background p-6"
      id="main-content"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 10%, hsl(var(--signal-500) / 0.12) 0%, transparent 60%)',
        }}
      />
      <div className="relative flex min-h-shell items-center justify-center">
        <Suspense
          fallback={<div className="text-sm text-neutral-500">Loading…</div>}
        >
          <ActionApprovePanel initialLocale={locale} />
        </Suspense>
      </div>
    </main>
  );
}
