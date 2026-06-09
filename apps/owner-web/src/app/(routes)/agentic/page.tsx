import { PageHero } from '@/components/shared/PageHero';
import { AgenticSandboxQueue } from '@/components/wave9/AgenticSandboxQueue';
import { getOwnerSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * O-W-33 — Agentic plans & sandbox.
 *
 * MD-Agentic sandbox-writes review queue. Live path: /api/md-agentic/* (BFF
 * proxy → gateway /api/v1/md-agentic/sandbox/*). Read-first: the brain
 * stages writes from chat; this surface lists them and lets the MD commit
 * (four-eye high-stakes — the gateway runs the REAL atomic write + audit
 * chain) or reject. The inviolable rails still gate every commit server-side.
 */
export default async function AgenticPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';

  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="agentic" />
      <AgenticSandboxQueue isSw={isSw} />
    </div>
  );
}
